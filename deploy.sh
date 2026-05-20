#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
#  DIC-NHAI CRM — AWS EC2 Deployment Script
#  Target: Ubuntu 22.04 LTS | Nginx | PostgreSQL | PM2 | Node 20
#
#  Usage:
#    chmod +x deploy.sh
#    sudo ./deploy.sh          # Full fresh install
#    sudo ./deploy.sh update   # Pull latest code and restart
# ═══════════════════════════════════════════════════════════════════

set -euo pipefail
APP_DIR="/var/www/nhai-crm"
APP_USER="nhai-crm"
LOG_DIR="/var/log/nhai-crm"
DOMAIN="nhaidevelopment.dic.org.in"
REPO_URL="https://github.com/rahuldewan1406/CRM.git"

# ── Colours ─────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC}  $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# ── Update-only mode ─────────────────────────────────────────────────
if [ "${1:-}" = "update" ]; then
    info "Pulling latest code..."
    cd $APP_DIR
    sudo -u $APP_USER git pull origin main
    sudo -u $APP_USER npm ci --production
    info "Restarting API..."
    pm2 reload nhai-crm-api
    pm2 reload nhai-crm-smtp
    info "✅ Update complete"
    exit 0
fi

# ════════════════════════════════════════════════════════════════════
#  FULL INSTALL
# ════════════════════════════════════════════════════════════════════

info "Starting DIC-NHAI CRM deployment..."
[[ $EUID -ne 0 ]] && error "Run as root: sudo ./deploy.sh"

# ── 1. System packages ───────────────────────────────────────────────
info "Installing system packages..."
apt-get update -qq
apt-get install -y -qq curl git nginx postgresql postgresql-contrib \
    certbot python3-certbot-nginx ufw fail2ban

# ── 2. Node.js 20 LTS ───────────────────────────────────────────────
info "Installing Node.js 20..."
if ! command -v node &>/dev/null || [[ $(node -v) != v20* ]]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi
npm install -g pm2
info "Node: $(node -v) | npm: $(npm -v) | pm2: $(pm2 -v)"

# ── 3. PostgreSQL setup ──────────────────────────────────────────────
info "Setting up PostgreSQL..."
systemctl enable postgresql --now

# Create DB user and database
DB_PASSWORD=$(openssl rand -base64 32)
sudo -u postgres psql -tc "SELECT 1 FROM pg_user WHERE usename='nhai_crm_user'" | grep -q 1 || \
    sudo -u postgres psql -c "CREATE USER nhai_crm_user WITH PASSWORD '$DB_PASSWORD';"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='nhai_crm'" | grep -q 1 || \
    sudo -u postgres createdb -O nhai_crm_user nhai_crm

info "PostgreSQL database: nhai_crm | user: nhai_crm_user"
warn "DB Password (save this): $DB_PASSWORD"

# ── 4. App user and directory ────────────────────────────────────────
info "Setting up app user..."
id -u $APP_USER &>/dev/null || useradd -r -m -s /bin/bash $APP_USER
mkdir -p $APP_DIR $LOG_DIR
chown -R $APP_USER:$APP_USER $APP_DIR $LOG_DIR

# ── 5. Clone / pull repository ───────────────────────────────────────
info "Deploying application..."
if [ -d "$APP_DIR/.git" ]; then
    sudo -u $APP_USER git -C $APP_DIR pull origin main
else
    sudo -u $APP_USER git clone $REPO_URL $APP_DIR
fi

cd $APP_DIR
sudo -u $APP_USER npm ci --production

# ── 6. Create .env ───────────────────────────────────────────────────
info "Creating .env..."
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")
ADMIN_PASS=$(openssl rand -base64 16)

cat > $APP_DIR/.env << ENVEOF
NODE_ENV=production
PORT=3002
SMTP_SERVER_PORT=3001
DATABASE_URL=postgresql://nhai_crm_user:${DB_PASSWORD}@localhost:5432/nhai_crm
DB_SSL=false
JWT_SECRET=${JWT_SECRET}
ADMIN_PASSWORD=${ADMIN_PASS}
ALLOWED_ORIGIN=https://${DOMAIN}
ENVEOF
chown $APP_USER:$APP_USER $APP_DIR/.env
chmod 600 $APP_DIR/.env

info "Admin credentials:"
warn "  Email:    admin@crm.local"
warn "  Password: $ADMIN_PASS"
warn "  ⚠ Change this password after first login!"

# ── 7. Nginx configuration ───────────────────────────────────────────
info "Configuring Nginx..."
# Add rate limit zone to main nginx.conf
if ! grep -q "api_limit" /etc/nginx/nginx.conf; then
    sed -i '/http {/a\\tlimit_req_zone $binary_remote_addr zone=api_limit:10m rate=30r/m;' /etc/nginx/nginx.conf
fi

cp $APP_DIR/nginx.conf /etc/nginx/sites-available/nhai-crm
ln -sf /etc/nginx/sites-available/nhai-crm /etc/nginx/sites-enabled/nhai-crm
rm -f /etc/nginx/sites-enabled/default

# Temporarily serve HTTP only (before SSL cert)
cat > /etc/nginx/sites-available/nhai-crm-temp << NGINXTMP
server {
    listen 80;
    server_name $DOMAIN;
    root $APP_DIR;
    location /CRM/ { alias $APP_DIR/; try_files \$uri \$uri/ /index.html; }
    location /api/ { proxy_pass http://127.0.0.1:3002/; proxy_set_header Host \$host; }
    location /smtp/ { proxy_pass http://127.0.0.1:3001/; }
}
NGINXTMP
ln -sf /etc/nginx/sites-available/nhai-crm-temp /etc/nginx/sites-enabled/nhai-crm
nginx -t && systemctl reload nginx

# ── 8. SSL Certificate via Let's Encrypt ────────────────────────────
info "Obtaining SSL certificate for $DOMAIN..."
certbot --nginx -d $DOMAIN --non-interactive --agree-tos \
    --email webmaster@nhai.gov.in --redirect || warn "Certbot failed — run manually: certbot --nginx -d $DOMAIN"

# Restore full nginx config after cert
cp $APP_DIR/nginx.conf /etc/nginx/sites-available/nhai-crm
nginx -t && systemctl reload nginx

# ── 9. Firewall (UFW) ────────────────────────────────────────────────
info "Configuring firewall..."
ufw --force enable
ufw allow ssh
ufw allow 'Nginx Full'
ufw delete allow 'Nginx HTTP' 2>/dev/null || true
# Block direct access to API port (only via Nginx)
ufw deny 3002
ufw deny 3001

# ── 10. Fail2ban ─────────────────────────────────────────────────────
info "Configuring fail2ban..."
cat > /etc/fail2ban/jail.d/nhai-crm.conf << F2B
[nginx-http-auth]
enabled = true
[nginx-limit-req]
enabled  = true
logpath  = /var/log/nginx/nhai-crm-access.log
maxretry = 10
F2B
systemctl enable fail2ban --now

# ── 11. Start application with PM2 ──────────────────────────────────
info "Starting application..."
cd $APP_DIR
sudo -u $APP_USER pm2 start ecosystem.config.js --env production
sudo -u $APP_USER pm2 save
pm2 startup systemd -u $APP_USER --hp /home/$APP_USER | tail -1 | bash || true

# ── 12. Auto-renew SSL ───────────────────────────────────────────────
(crontab -l 2>/dev/null; echo "0 3 * * * certbot renew --quiet --post-hook 'systemctl reload nginx'") | crontab -

# ── 13. Log rotation ────────────────────────────────────────────────
cat > /etc/logrotate.d/nhai-crm << LOGROTATE
$LOG_DIR/*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    sharedscripts
    postrotate
        pm2 reloadLogs
    endscript
}
LOGROTATE

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  DIC-NHAI CRM Deployment Complete! ✅${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
echo ""
echo "  URL:      https://$DOMAIN/CRM/"
echo "  Admin:    admin@crm.local"
echo "  Password: $ADMIN_PASS  ← CHANGE THIS!"
echo ""
echo "  Commands:"
echo "    pm2 status              # Check app status"
echo "    pm2 logs nhai-crm-api   # View logs"
echo "    sudo ./deploy.sh update # Deploy updates"
echo ""
