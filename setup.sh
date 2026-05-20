#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
#  DIC-NHAI CRM — Auto-Setup Script
#  Upload to S3, download to EC2, run as root
#
#  Usage:
#    sudo bash setup.sh                  # Fresh install
#    sudo bash setup.sh --update         # Pull latest + restart
#    sudo bash setup.sh --status         # Check status
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

# ── Config ─────────────────────────────────────────────────────────
APP_DIR="/home/bhawesh/rahul/CRM"
DOMAIN="nhaidevelopment.dic.org.in"
APP_URL_PATH="/CRM"
NODE_PORT=3002
SMTP_PORT=3001

# ── Colours ────────────────────────────────────────────────────────
R='\033[0;31m' G='\033[0;32m' Y='\033[1;33m' B='\033[0;34m' NC='\033[0m'
info()    { echo -e "${G}[✓]${NC} $1"; }
warn()    { echo -e "${Y}[!]${NC} $1"; }
error()   { echo -e "${R}[✗]${NC} $1"; exit 1; }
section() { echo -e "\n${B}━━━ $1 ━━━${NC}"; }

# ── Mode checks ────────────────────────────────────────────────────
MODE="${1:-install}"

if [ "$MODE" = "--status" ]; then
    section "DIC-NHAI CRM Status"
    echo "Node:    $(node -v 2>/dev/null || echo 'not installed')"
    echo "npm:     $(npm -v 2>/dev/null || echo 'not installed')"
    echo "pm2:     $(pm2 -v 2>/dev/null || echo 'not installed')"
    echo "nginx:   $(nginx -v 2>&1 | head -1 || echo 'not installed')"
    echo "pg:      $(psql --version 2>/dev/null || echo 'not installed')"
    echo ""
    pm2 list 2>/dev/null || echo "PM2 not running"
    echo ""
    echo "API:  $(curl -sf http://127.0.0.1:$NODE_PORT/health 2>/dev/null && echo 'UP' || echo 'DOWN')"
    echo "Nginx: $(systemctl is-active nginx 2>/dev/null || echo 'inactive')"
    exit 0
fi

if [ "$MODE" = "--update" ]; then
    section "Pulling latest code"
    cd $APP_DIR
    git pull origin main
    npm ci --omit=dev
    pm2 reload nhai-crm-api  2>/dev/null || pm2 start ecosystem.config.js --env production
    pm2 reload nhai-crm-smtp 2>/dev/null || true
    pm2 save
    info "Update complete → https://$DOMAIN$APP_URL_PATH/"
    exit 0
fi

# ════════════════════════════════════════════════════════════════════
#  FULL INSTALL
# ════════════════════════════════════════════════════════════════════
[ "$EUID" -ne 0 ] && error "Run as root: sudo bash setup.sh"

section "1. System packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl wget git nginx postgresql postgresql-contrib \
    certbot python3-certbot-nginx ufw fail2ban lsb-release ca-certificates \
    gnupg2 openssl 2>&1 | tail -3
info "System packages ready"

section "2. Node.js 20 LTS"
if ! command -v node &>/dev/null || [[ "$(node -v)" != v20* ]]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - 2>&1 | tail -2
    apt-get install -y -qq nodejs
fi
npm install -g pm2 2>/dev/null
info "Node $(node -v) | PM2 $(pm2 -v)"

section "3. PostgreSQL database"
systemctl enable postgresql --now

DB_PASS=""
DB_EXISTS=$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='nhai_crm'" 2>/dev/null || echo "")

if [ "$DB_EXISTS" != "1" ]; then
    DB_PASS=$(openssl rand -base64 24 | tr -d '/+=')
    sudo -u postgres psql -c "CREATE USER nhai_crm_user WITH PASSWORD '$DB_PASS';" 2>/dev/null || true
    sudo -u postgres createdb -O nhai_crm_user nhai_crm 2>/dev/null
    warn "PostgreSQL created: nhai_crm | user: nhai_crm_user | pass: $DB_PASS"
    warn "⚠ Save this password — shown only once!"
else
    # Try to read from existing .env
    DB_PASS=$(grep DATABASE_URL $APP_DIR/.env 2>/dev/null | sed 's/.*:\(.*\)@.*/\1/' || echo "")
    if [ -z "$DB_PASS" ]; then
        read -sp "Enter existing DB password for nhai_crm_user: " DB_PASS; echo
    fi
    info "Using existing nhai_crm database"
fi

section "4. Application dependencies"
cd $APP_DIR
npm ci --omit=dev 2>&1 | tail -3
info "npm packages installed"

section "5. Environment file"
if [ -f "$APP_DIR/.env" ]; then
    info ".env already exists — skipping generation"
    source $APP_DIR/.env 2>/dev/null || true
else
    JWT_SECRET=$(openssl rand -hex 64)
    ADMIN_PASS=$(openssl rand -base64 12 | tr -d '/+=')

    cat > $APP_DIR/.env << ENVEOF
NODE_ENV=production
PORT=$NODE_PORT
SMTP_SERVER_PORT=$SMTP_PORT

# PostgreSQL
DATABASE_URL=postgresql://nhai_crm_user:${DB_PASS}@localhost:5432/nhai_crm
DB_SSL=false

# JWT — NEVER share this
JWT_SECRET=${JWT_SECRET}

# Admin seed password (used only on first start)
ADMIN_PASSWORD=${ADMIN_PASS}

# CORS — must match your domain exactly
ALLOWED_ORIGIN=https://${DOMAIN}

# SMTP (optional — for email notifications)
# SMTP_HOST=smtp.gmail.com
# SMTP_PORT=587
# SMTP_USER=your@email.com
# SMTP_PASS=your-app-password
ENVEOF
    chmod 600 $APP_DIR/.env
    warn "Admin credentials → admin@crm.local / $ADMIN_PASS"
    warn "⚠ Change this password after first login!"
fi

section "6. Database migration + seed"
node -e "
  require('dotenv').config({ path: '$APP_DIR/.env' });
  require('$APP_DIR/server/db').init()
    .then(() => { console.log('DB ready'); process.exit(0); })
    .catch(e => { console.error('DB error:', e.message); process.exit(1); });
"
info "Database migrated and seeded"

section "7. Nginx configuration"
mkdir -p /var/log/nginx

# Add rate limit zone if not present
grep -q "api_limit" /etc/nginx/nginx.conf 2>/dev/null || \
    sed -i '/http {/a\\tlimit_req_zone $binary_remote_addr zone=api_limit:10m rate=30r/m;' /etc/nginx/nginx.conf

cat > /etc/nginx/sites-available/nhai-crm << NGINXEOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    access_log /var/log/nginx/nhai-crm-access.log;
    error_log  /var/log/nginx/nhai-crm-error.log warn;

    # Security headers
    add_header X-Frame-Options        "SAMEORIGIN"  always;
    add_header X-Content-Type-Options "nosniff"     always;
    add_header X-XSS-Protection       "1; mode=block" always;
    add_header Referrer-Policy        "strict-origin-when-cross-origin" always;

    # ── Frontend — served from /CRM/ ──────────────────────────────
    location ${APP_URL_PATH}/ {
        alias ${APP_DIR}/;
        index index.html;
        try_files \$uri \$uri/ ${APP_URL_PATH}/index.html;

        # Cache static assets
        location ~* \.(css|js|svg|ico|png|woff2|woff|ttf)\$ {
            alias ${APP_DIR}/;
            expires 30d;
            add_header Cache-Control "public, immutable";
            access_log off;
        }
    }

    # ── API proxy ─────────────────────────────────────────────────
    location /api/ {
        proxy_pass         http://127.0.0.1:${NODE_PORT}/;
        proxy_http_version 1.1;
        proxy_set_header   Host              \$host;
        proxy_set_header   X-Real-IP         \$remote_addr;
        proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_read_timeout 30s;
        limit_req          zone=api_limit burst=20 nodelay;
    }

    # ── SMTP proxy ────────────────────────────────────────────────
    location /smtp/ {
        proxy_pass       http://127.0.0.1:${SMTP_PORT}/;
        proxy_set_header Host \$host;
        proxy_read_timeout 15s;
    }

    # ── Health (for load balancer checks) ─────────────────────────
    location = /health {
        proxy_pass http://127.0.0.1:${NODE_PORT}/health;
        access_log off;
    }

    # ── Security blocks ───────────────────────────────────────────
    location ~* \.(env|git|sql|bak|log|json)\$ { return 404; }
    location ~ /\.                              { return 404; }
    location = /                                { return 301 \$scheme://\$host${APP_URL_PATH}/; }
    location = /favicon.ico                     { try_files \$uri =204; access_log off; }
    location = /robots.txt                      { return 200 "User-agent: *\nDisallow: /api/\n"; }
}
NGINXEOF

ln -sf /etc/nginx/sites-available/nhai-crm /etc/nginx/sites-enabled/nhai-crm
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl enable nginx --now && systemctl reload nginx
info "Nginx configured → http://$DOMAIN$APP_URL_PATH/"

section "8. SSL certificate (Let's Encrypt)"
if [ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
    info "SSL certificate already exists"
else
    warn "Getting SSL certificate for $DOMAIN ..."
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos \
        --email "webmaster@nhai.gov.in" --redirect 2>&1 | tail -5 \
        && info "SSL certificate obtained ✅" \
        || warn "Certbot failed — ensure DNS points to this server, then run: sudo certbot --nginx -d $DOMAIN"
fi

section "9. Firewall (UFW)"
ufw --force enable 2>/dev/null
ufw allow ssh        2>/dev/null || true
ufw allow 'Nginx Full' 2>/dev/null || true
ufw deny $NODE_PORT  2>/dev/null || true
ufw deny $SMTP_PORT  2>/dev/null || true
info "Firewall: 80/443 open, $NODE_PORT/$SMTP_PORT blocked externally"

section "10. Start application (PM2)"
cd $APP_DIR
pm2 delete all 2>/dev/null || true
pm2 start ecosystem.config.js --env production
pm2 save

# Auto-start on reboot
env PATH=$PATH:/usr/bin pm2 startup systemd -u root --hp /root 2>/dev/null \
    | grep -E "^sudo" | bash 2>/dev/null || true
systemctl enable pm2-root 2>/dev/null || true

section "11. Log rotation"
cat > /etc/logrotate.d/nhai-crm << LOGROTATE
/var/log/nginx/nhai-crm*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
}
LOGROTATE

# ── SSL auto-renewal ────────────────────────────────────────────────
(crontab -l 2>/dev/null | grep -v certbot; echo "0 3 * * * certbot renew --quiet --post-hook 'systemctl reload nginx'") | crontab -

# ── Final health check ──────────────────────────────────────────────
sleep 4
API_STATUS=$(curl -sf http://127.0.0.1:$NODE_PORT/health 2>/dev/null && echo "✅ UP" || echo "❌ DOWN")

echo ""
echo -e "${G}══════════════════════════════════════════════════════${NC}"
echo -e "${G}  DIC-NHAI CRM — Deployment Complete!${NC}"
echo -e "${G}══════════════════════════════════════════════════════${NC}"
echo ""
echo "  URL:     https://$DOMAIN$APP_URL_PATH/"
echo "  API:     $API_STATUS"
echo "  PM2:     $(pm2 list --no-color 2>/dev/null | grep -E 'online|stopped' | wc -l) process(es) running"
echo ""
echo "  Useful commands:"
echo "    pm2 status                    # App status"
echo "    pm2 logs nhai-crm-api         # Live API logs"
echo "    sudo bash setup.sh --update   # Deploy updates"
echo "    sudo bash setup.sh --status   # Quick status check"
echo ""

# Print credentials only if freshly generated
ADMIN_PASS_PRINT=$(grep ADMIN_PASSWORD $APP_DIR/.env 2>/dev/null | cut -d= -f2)
if [ -n "$ADMIN_PASS_PRINT" ]; then
    echo -e "${Y}  Login: admin@crm.local / $ADMIN_PASS_PRINT${NC}"
    echo -e "${Y}  ⚠ Change this password after first login!${NC}"
fi
echo ""
