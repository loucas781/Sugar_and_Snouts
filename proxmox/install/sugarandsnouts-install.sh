#!/usr/bin/env bash
# Sugar & Snouts — LXC In-Container Install Script
# Called by the host script via: pct exec <ctid> -- bash /tmp/sugarandsnouts-install.sh <env> <admin_email> <admin_password>
# Do NOT run this directly on your workstation.

set -euo pipefail

export LANG=C LC_ALL=C DEBIAN_FRONTEND=noninteractive

GN=$(echo "\033[1;92m"); RD=$(echo "\033[01;31m"); YW=$(echo "\033[33m"); CL=$(echo "\033[m")
msg_info()  { echo -e "  💡  ${YW}${1}...${CL}"; }
msg_ok()    { echo -e "  ✓   ${GN}${1}${CL}"; }
msg_error() { echo -e "  ✖   ${RD}${1}${CL}"; exit 1; }

# ── Environment ────────────────────────────────────────────────────────────────
APP_ENV="${1:-production}"
ADMIN_EMAIL="${2:-admin@sugarandsnouts.co.uk}"
ADMIN_PASSWORD="${3:-Admin1234!}"

if [[ "$APP_ENV" != "development" && "$APP_ENV" != "staging" && "$APP_ENV" != "production" ]]; then
  echo "Usage: $0 [development|staging|production] [admin_email] [admin_password]"; exit 1
fi

COOKIE_SECURE="false"
[[ "$APP_ENV" == "production" || "$APP_ENV" == "staging" ]] && COOKIE_SECURE="true"

BRANCH="develop"
[[ "$APP_ENV" == "staging" ]]    && BRANCH="staging"
[[ "$APP_ENV" == "production" ]] && BRANCH="main"

msg_ok "Deploying environment: ${APP_ENV}  |  Branch: ${BRANCH}"

# ── 1. OS update ───────────────────────────────────────────────────────────────
msg_info "Updating OS packages"
apt-get update -qq
apt-get upgrade -y -qq 2>&1 | tail -3
msg_ok "OS packages updated"

# ── 2. Base dependencies ───────────────────────────────────────────────────────
msg_info "Installing base dependencies"
apt-get install -y -qq curl git gnupg ca-certificates openssl build-essential python3
msg_ok "Base dependencies ready"

# ── 3. Node.js 20 ─────────────────────────────────────────────────────────────
msg_info "Installing Node.js 20"
mkdir -p /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
  | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg 2>/dev/null
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" \
  > /etc/apt/sources.list.d/nodesource.list
apt-get update -qq
apt-get install -y -qq nodejs
msg_ok "Node.js $(node --version) / npm $(npm --version) installed"

# ── 4. Clone Sugar & Snouts ────────────────────────────────────────────────────
msg_info "Cloning Sugar & Snouts (${BRANCH})"
REPO_URL="https://github.com/loucas781/Sugar_and_Snouts.git"
rm -rf /opt/sugarandsnouts
git clone --branch "$BRANCH" --single-branch --quiet "$REPO_URL" /opt/sugarandsnouts 2>/dev/null \
  || git clone --quiet "$REPO_URL" /opt/sugarandsnouts 2>/dev/null \
  || msg_error "Failed to clone repository. Check the REPO_URL in the install script."
msg_ok "Sugar & Snouts cloned"

# ── 5. npm install ─────────────────────────────────────────────────────────────
msg_info "Updating npm to latest"
HOME=/root npm install -g npm --cache /tmp/npm-cache --unsafe-perm --no-audit --no-fund --silent 2>&1 || true
msg_ok "npm $(npm --version) ready"

msg_info "Installing Node.js dependencies"
cd /opt/sugarandsnouts
mkdir -p /tmp/npm-cache /tmp/npm-tmp
chmod 777 /tmp/npm-cache /tmp/npm-tmp

HOME=/root npm install \
  --omit=dev \
  --cache /tmp/npm-cache \
  --unsafe-perm \
  --no-audit \
  --no-fund \
  2>&1 | tail -5 || msg_error "npm install failed — check output above"
msg_ok "Node.js dependencies installed"

# ── 6. Write .env ──────────────────────────────────────────────────────────────
msg_info "Writing configuration"
JWT_SECRET=$(openssl rand -hex 48)
PASSWORD_PEPPER=$(openssl rand -hex 32)
SERVER_IP=$(hostname -I | awk '{print $1}')

mkdir -p /opt/sugarandsnouts/data
mkdir -p /opt/sugarandsnouts/uploads
chmod 755 /opt/sugarandsnouts/uploads

cat > /opt/sugarandsnouts/.env.${APP_ENV} << ENVEOF
NODE_ENV=$([ "$APP_ENV" = "development" ] && echo "development" || echo "production")
PORT=3000
APP_NAME=Sugar & Snouts
APP_ENV=${APP_ENV}
APP_URL=http://${SERVER_IP}:3000
JWT_SECRET=${JWT_SECRET}
PASSWORD_PEPPER=${PASSWORD_PEPPER}
ADMIN_EMAIL=${ADMIN_EMAIL}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
DATABASE_PATH=/opt/sugarandsnouts/data/sugarandsnouts.db
UPLOAD_PATH=/opt/sugarandsnouts/uploads
COOKIE_SECURE=${COOKIE_SECURE}
TRUST_PROXY=false
COOKIE_MAX_AGE_HOURS=72
CONTACT_EMAIL=${ADMIN_EMAIL}
ENVEOF

chmod 600 /opt/sugarandsnouts/.env.${APP_ENV}
msg_ok "Configuration written (.env.${APP_ENV})"

# ── 7. Database migration ──────────────────────────────────────────────────────
msg_info "Running database migration"
cd /opt/sugarandsnouts
HOME=/root NODE_ENV=${APP_ENV} node server/db/migrate.js \
  || msg_error "Database migration failed"
msg_ok "Database schema ready"

# ── 8. systemd service ─────────────────────────────────────────────────────────
msg_info "Creating Sugar & Snouts service"
cat > /etc/systemd/system/sugarandsnouts.service << SVCEOF
[Unit]
Description=Sugar & Snouts Bakery Website
After=network.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/sugarandsnouts
Environment=NODE_ENV=${APP_ENV}
ExecStart=/usr/bin/node server/index.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=sugarandsnouts

[Install]
WantedBy=multi-user.target
SVCEOF

systemctl daemon-reload
systemctl enable sugarandsnouts --now
msg_ok "Sugar & Snouts service started"

# ── 9. Verify service is running ───────────────────────────────────────────────
msg_info "Verifying service"
sleep 3
if systemctl is-active --quiet sugarandsnouts; then
  msg_ok "Service is running"
else
  echo ""
  echo "  ⚠️  Service failed to start. Check logs with: journalctl -u sugarandsnouts -n 50"
  journalctl -u sugarandsnouts -n 20 --no-pager || true
  exit 1
fi

# ── 10. Update helper script ───────────────────────────────────────────────────
cat > /opt/sugarandsnouts/update.sh << 'UPDATEEOF'
#!/usr/bin/env bash
set -e
cd /opt/sugarandsnouts

# Detect environment from whichever .env.* file exists
if   [[ -f .env.production  ]]; then APP_ENV=production
elif [[ -f .env.staging      ]]; then APP_ENV=staging
else                                   APP_ENV=development
fi

echo "Updating Sugar & Snouts (${APP_ENV})..."

# Keep .env files safe
echo ".env.*" >> .git/info/exclude 2>/dev/null || true

git fetch origin
git reset --hard origin/$(git rev-parse --abbrev-ref HEAD)

mkdir -p /tmp/npm-cache
HOME=/root npm install --omit=dev --cache /tmp/npm-cache --unsafe-perm --no-audit --no-fund

HOME=/root NODE_ENV=${APP_ENV} node server/db/migrate.js
systemctl restart sugarandsnouts
echo "✓ Sugar & Snouts updated to $(cat .version 2>/dev/null || echo 'unknown')"
UPDATEEOF
chmod +x /opt/sugarandsnouts/update.sh

echo ""
msg_ok "Sugar & Snouts installation complete — running at http://localhost:3000"
echo ""
echo "  💡  Admin panel: http://$(hostname -I | awk '{print $1}'):3000/admin/"
echo "  💡  Login with: ${ADMIN_EMAIL}"
echo ""
