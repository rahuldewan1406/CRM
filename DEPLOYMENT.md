# DIC-NHAI CRM — Deployment Guide
## Target: AWS EC2 + Nginx + PostgreSQL
**URL:** https://nhaidevelopment.dic.org.in/CRM/

---

## Quick Deploy (Fresh EC2 Instance)

```bash
# 1. SSH into EC2
ssh -i your-key.pem ubuntu@YOUR_EC2_IP

# 2. Clone repo
git clone https://github.com/rahuldewan1406/CRM.git
cd CRM

# 3. Run deploy script (handles everything)
sudo ./deploy.sh
```

## EC2 Instance Requirements
- **OS:** Ubuntu 22.04 LTS
- **Type:** t3.small or larger (2 vCPU, 2GB RAM minimum)
- **Storage:** 20GB SSD
- **Security Groups:** Allow ports 22 (SSH), 80 (HTTP), 443 (HTTPS)
- **Elastic IP:** Recommended for stable DNS

## Architecture

```
Internet
   │
   ▼
[Nginx :443]  ← SSL termination, static files, rate limiting
   │
   ├── /CRM/*     → /var/www/nhai-crm/ (static HTML/CSS/JS)
   ├── /api/*     → 127.0.0.1:3002 (Express API + PostgreSQL)
   └── /smtp/*    → 127.0.0.1:3001 (SMTP server)

[PostgreSQL :5432]  ← localhost only, no external access
[PM2]               ← process manager, auto-restart, clustering
[Fail2ban]          ← brute force protection
[UFW]               ← ports 3001/3002 blocked externally
```

## Manual Steps After deploy.sh

### 1. Point DNS
Add A record: `nhaidevelopment.dic.org.in → YOUR_EC2_ELASTIC_IP`

### 2. Get SSL Certificate
```bash
sudo certbot --nginx -d nhaidevelopment.dic.org.in
```

### 3. Change Default Admin Password
1. Open https://nhaidevelopment.dic.org.in/CRM/
2. Login with `admin@crm.local` and the generated password
3. Go to ⚙ Admin → User Management → Edit your user → change password

### 4. Configure SMTP (optional)
Edit `/var/www/nhai-crm/.env`:
```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@email.com
SMTP_PASS=your-app-password
```

## Deploy Updates
```bash
cd /var/www/nhai-crm
sudo ./deploy.sh update
```

## Useful Commands

```bash
# App status
pm2 status

# View live logs
pm2 logs nhai-crm-api

# Restart
pm2 restart nhai-crm-api

# Nginx
sudo nginx -t                           # Test config
sudo systemctl reload nginx             # Reload

# Database
sudo -u postgres psql nhai_crm          # Connect
\dt                                     # List tables
SELECT count(*) FROM contacts;

# Check health
curl https://nhaidevelopment.dic.org.in/api/health
```

## Environment Variables (.env)

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `JWT_SECRET` | ✅ | 64-char random hex for JWT signing |
| `ADMIN_PASSWORD` | ✅ | Initial admin password (first run only) |
| `ALLOWED_ORIGIN` | ✅ | CORS allowed origin (your domain) |
| `NODE_ENV` | ✅ | `production` |
| `PORT` | ○ | API port (default: 3002) |
| `SMTP_HOST` | ○ | SMTP server hostname |
| `SMTP_PORT` | ○ | SMTP port (default: 587) |
| `SMTP_USER` | ○ | SMTP username |
| `SMTP_PASS` | ○ | SMTP password/app-password |
| `DB_SSL` | ○ | Set `true` for RDS, `false` for local |

## Security Checklist
- [ ] Changed default admin password
- [ ] JWT_SECRET is a random 64-char string
- [ ] .env has `chmod 600` permissions
- [ ] Ports 3001/3002 blocked by UFW
- [ ] SSL certificate obtained and auto-renews
- [ ] fail2ban active (`sudo fail2ban-client status`)
- [ ] Database backup scheduled (`pg_dump`)
