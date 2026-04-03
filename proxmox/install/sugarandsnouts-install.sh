#!/usr/bin/env bash
# Sugar & Snouts — LXC In-Container Install Script
# Called by the host script with: bash install.sh [environment] [admin_email] [admin_password]

set -euo pipefail
export LANG=C LC_ALL=C DEBIAN_FRONTEND=noninteractive

GN=$(echo "\033[1;92m"); RD=$(echo "\033[01;31m"); YW=$(echo "\033[33m"); CL=$(echo "\033[m")
msg_info()  { echo -e "  💡  ${YW}${1}...${CL}"; }
msg_ok()    { echo -e "  ✓   ${GN}${1}${CL}"; }
msg_error() { echo -e "  ✖   ${RD}${1}${CL}"; exit 1; }

# ── Environment args ──────────────────────────────────────────────────────────
APP_ENV="${1:-development}"
ADMIN_EMAIL="${2:-admin@sugarandsnouts.co.uk}"
ADMIN_PASSWORD="${3:-Admin1234!}"

if [[ "$APP_ENV" != "development" && "$APP_ENV" != "staging" && "$APP_ENV" != "production" ]]; then
  echo "Usage: $0 [development|staging|production] [admin_email] [admin_password]"
  exit 1
fi

COOKIE_SECURE="false"
[[ "$APP_ENV" == "production" || "$APP_ENV" == "staging" ]] && COOKIE_SECURE="true"

BRANCH="develop"
[[ "$APP_ENV" == "staging" ]]    && BRANCH="staging"
[[ "$APP_ENV" == "production" ]] && BRANCH="main"

msg_ok "Environment: ${APP_ENV}  |  Branch: ${BRANCH}"

# ── 1. OS update ──────────────────────────────────────────────────────────────
msg_info "Updating OS packages"
apt-get update -qq && apt-get upgrade -y -qq 2>&1 | tail -3
msg_ok "OS packages updated"

# ── 2. Base deps ──────────────────────────────────────────────────────────────
msg_info "Installing base dependencies"
apt-get install -y -qq curl git gnupg ca-certificates openssl
msg_ok "Base dependencies ready"

# ── 3. Node.js 20 ─────────────────────────────────────────────────────────────
msg_info "Installing Node.js 20"
mkdir -p /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
  | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg 2>/dev/null
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" \
  > /etc/apt/sources.list.d/nodesource.list
apt-get update -qq && apt-get install -y -qq nodejs
msg_ok "Node.js $(node --version) / npm $(npm --version) installed"

# ── 4. Clone repo ─────────────────────────────────────────────────────────────
msg_info "Cloning Sugar & Snouts (${BRANCH})"
git clone --depth 1 --branch "$BRANCH" \
  https://github.com/loucas781/Sugar_and_Snouts.git \
  /opt/sugarandsnouts 2>/dev/null
msg_ok "Repository cloned to /opt/sugarandsnouts"

cd /opt/sugarandsnouts

# ── 5. npm install ────────────────────────────────────────────────────────────
msg_info "Installing npm dependencies"
npm install --omit=dev --silent 2>&1 | tail -3
msg_ok "Dependencies installed"

# ── 6. Create data / upload dirs ──────────────────────────────────────────────
msg_info "Creating data directories"
mkdir -p /opt/sugarandsnouts/data
mkdir -p /opt/sugarandsnouts/uploads
chmod 755 /opt/sugarandsnouts/uploads
msg_ok "Directories created"

# ── 7. Generate secrets ───────────────────────────────────────────────────────
msg_info "Generating secrets"
JWT_SECRET=$(openssl rand -hex 48)
PASSWORD_PEPPER=$(openssl rand -hex 32)
msg_ok "Secrets generated"

# ── 8. Create .env file ───────────────────────────────────────────────────────
msg_info "Writing environment file"
cat > /opt/sugarandsnouts/.env.${APP_ENV} <<EOF
NODE_ENV=$([ "$APP_ENV" = "development" ] && echo "development" || echo "production")
PORT=3000
APP_NAME=Sugar & Snouts
APP_ENV=${APP_ENV}
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
EOF
chmod 600 /opt/sugarandsnouts/.env.${APP_ENV}
msg_ok "Environment file written"

# ── 9. Database migration ─────────────────────────────────────────────────────
msg_info "Running database migration"
NODE_ENV=${APP_ENV} node server/db/migrate.js
msg_ok "Database ready"

# ── 10. Create systemd service ────────────────────────────────────────────────
msg_info "Creating systemd service"
cat > /etc/systemd/system/sugarandsnouts.service <<EOF
[Unit]
Description=Sugar & Snouts Bakery Website
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=root
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
EOF

systemctl daemon-reload
systemctl enable sugarandsnouts --now
msg_ok "Service started"

# ── 11. Create update script ──────────────────────────────────────────────────
msg_info "Creating update script"
cat > /opt/sugarandsnouts/update.sh <<'UPDATEEOF'
#!/usr/bin/env bash
set -euo pipefail
GN="\033[1;92m"; YW="\033[33m"; CL="\033[m"
echo -e "  💡  ${YW}Updating Sugar & Snouts...${CL}"
cd /opt/sugarandsnouts
git pull --rebase
npm install --omit=dev --silent 2>&1 | tail -3
systemctl restart sugarandsnouts
echo -e "  ✓   ${GN}Update complete!${CL}"
node -e "const v=require('./package.json').version; console.log('  Version: v'+v)"
UPDATEEOF
chmod +x /opt/sugarandsnouts/update.sh
msg_ok "Update script created at /opt/sugarandsnouts/update.sh"

# ── Done ──────────────────────────────────────────────────────────────────────
IP=$(hostname -I | awk '{print $1}')
echo ""
echo -e "  ${GN}🍰  Sugar & Snouts installation complete!${CL}"
echo ""
echo -e "  🌐  URL:    http://${IP}:3000"
echo -e "  🔑  Admin:  http://${IP}:3000/admin/"
echo -e "  📧  Email:  ${ADMIN_EMAIL}"
echo ""
