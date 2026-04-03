#!/usr/bin/env bash
# Sugar & Snouts — Proxmox LXC Install Script
# Usage: bash -c "$(curl -fsSL https://raw.githubusercontent.com/loucas781/Sugar_and_Snouts/main/proxmox/ct/sugarandsnouts.sh)"

set -euo pipefail

# ── Colours & icons ───────────────────────────────────────────────────────────
YW=$(echo "\033[33m"); YWB=$(echo "\033[93m"); BL=$(echo "\033[36m")
RD=$(echo "\033[01;31m"); BGN=$(echo "\033[4;92m"); GN=$(echo "\033[1;92m")
DGN=$(echo "\033[32m"); CL=$(echo "\033[m"); BOLD=$(echo "\033[1m")
TAB="  "
CM="${TAB}✔️  ${CL}"; CROSS="${TAB}✖️  ${CL}"; INFO="${TAB}💡${TAB}"
CREATING="${TAB}🚀${TAB}"

msg_info()  { echo -e " ${INFO}${YW}${1}${CL}"; }
msg_ok()    { echo -e " ${CM}${GN}${1}${CL}"; }
msg_error() { echo -e " ${CROSS}${RD}${1}${CL}"; cleanup_on_error; exit 1; }

# ── Cleanup on error ──────────────────────────────────────────────────────────
CTID_CREATED=""
cleanup_on_error() {
  if [[ -n "$CTID_CREATED" ]]; then
    echo ""
    echo -e " ${CROSS}${RD}Installation failed — destroying container ${CTID_CREATED} in 60s...${CL}"
    echo -e " ${TAB}${TAB}${YW}(Press Ctrl-C within 60s to keep the container for debugging)${CL}"
    sleep 60
    pct stop "$CTID_CREATED" &>/dev/null || true
    pct destroy "$CTID_CREATED" --purge  &>/dev/null || true
    echo -e " ${CM}${GN}Container ${CTID_CREATED} destroyed.${CL}"
  fi
}
trap 'cleanup_on_error' ERR

# ── Timeout watchdog (20 minutes) ─────────────────────────────────────────────
WATCHDOG_TIMEOUT=1200
(
  sleep $WATCHDOG_TIMEOUT
  echo -e "\033[01;31m  ✖  Timeout: install exceeded ${WATCHDOG_TIMEOUT}s — triggering cleanup\033[m"
  kill -TERM $$ 2>/dev/null
) &
WATCHDOG_PID=$!
trap 'kill $WATCHDOG_PID 2>/dev/null; cleanup_on_error' ERR
trap 'kill $WATCHDOG_PID 2>/dev/null' EXIT

# ── Verify running on Proxmox ─────────────────────────────────────────────────
if ! command -v pct &>/dev/null; then
  echo "This script must be run on a Proxmox VE host."
  exit 1
fi

PVE_VERSION=$(pveversion | grep -oP '(?<=pve-manager/)\S+' || echo "unknown")
PVE_NODE=$(hostname)
INSTALL_URL="https://raw.githubusercontent.com/loucas781/Sugar_and_Snouts/main/proxmox/install/sugarandsnouts-install.sh"

# ── Defaults ──────────────────────────────────────────────────────────────────
CT_TYPE="1"
DISK_SIZE="8"
CORE_COUNT="2"
RAM_SIZE="512"
CT_HOSTNAME="sugarandsnouts"
APP_ENV="development"
CT_PASSWORD=""
BRIDGE="vmbr0"
NET_TYPE="dhcp"
STATIC_IP=""; STATIC_GW=""; STATIC_CIDR="24"
CTID=$(pvesh get /cluster/nextid 2>/dev/null || echo "100")
STORAGE=$(pvesm status -content rootdir 2>/dev/null | awk 'NR>1 {print $1; exit}' || echo "local-lvm")
TEMPLATE_STORAGE="local"

check_whiptail() { command -v whiptail &>/dev/null || apt-get install -y -qq whiptail; }

pick_storage() {
  local menu_items=()
  while read -r name _type _status total used avail _pct; do
    local free_gb=$(( avail / 1024 / 1024 ))
    menu_items+=("$name" "Free: ${free_gb}GB")
  done < <(pvesm status -content rootdir 2>/dev/null | awk 'NR>1')
  if [[ ${#menu_items[@]} -eq 0 ]]; then
    whiptail --backtitle "Sugar & Snouts Install" --msgbox "No suitable storage pools found." 8 50
    exit 1
  fi
  whiptail --backtitle "Sugar & Snouts Install" --title "STORAGE" \
    --menu "Select storage pool:" 18 60 8 "${menu_items[@]}" 3>&1 1>&2 2>&3
}

# ── Interactive setup ─────────────────────────────────────────────────────────
check_whiptail

echo ""
echo -e "${BOLD}  🍰  Sugar & Snouts — Proxmox LXC Setup${CL}"
echo -e "${YW}  PVE: ${PVE_VERSION}  |  Node: ${PVE_NODE}${CL}"
echo ""

# Container ID
CTID=$(whiptail --backtitle "Sugar & Snouts Install" --title "CONTAINER ID" \
  --inputbox "Container ID:" 8 40 "$CTID" 3>&1 1>&2 2>&3) || exit 1

# Hostname
CT_HOSTNAME=$(whiptail --backtitle "Sugar & Snouts Install" --title "HOSTNAME" \
  --inputbox "Container hostname:" 8 40 "$CT_HOSTNAME" 3>&1 1>&2 2>&3) || exit 1

# Environment
APP_ENV=$(whiptail --backtitle "Sugar & Snouts Install" --title "ENVIRONMENT" \
  --menu "Select deployment environment:" 12 50 3 \
  "development" "Dev branch (green badge)" \
  "staging"     "Staging branch (orange badge)" \
  "production"  "Main branch (red badge)" \
  3>&1 1>&2 2>&3) || exit 1

# Storage
STORAGE=$(pick_storage)

# Resources
CORE_COUNT=$(whiptail --backtitle "Sugar & Snouts Install" --title "CPU CORES" \
  --inputbox "Number of CPU cores:" 8 40 "2" 3>&1 1>&2 2>&3) || exit 1
RAM_SIZE=$(whiptail --backtitle "Sugar & Snouts Install" --title "RAM (MB)" \
  --inputbox "RAM in MB:" 8 40 "512" 3>&1 1>&2 2>&3) || exit 1
DISK_SIZE=$(whiptail --backtitle "Sugar & Snouts Install" --title "DISK (GB)" \
  --inputbox "Disk size in GB:" 8 40 "8" 3>&1 1>&2 2>&3) || exit 1

# Network
NET_TYPE=$(whiptail --backtitle "Sugar & Snouts Install" --title "NETWORK" \
  --menu "Network configuration:" 10 50 2 \
  "dhcp"   "DHCP (automatic IP)" \
  "static" "Static IP" \
  3>&1 1>&2 2>&3) || exit 1

if [[ "$NET_TYPE" == "static" ]]; then
  STATIC_IP=$(whiptail --backtitle "Sugar & Snouts Install" --title "STATIC IP" \
    --inputbox "IP address (e.g. 192.168.1.100):" 8 50 "" 3>&1 1>&2 2>&3) || exit 1
  STATIC_GW=$(whiptail --backtitle "Sugar & Snouts Install" --title "GATEWAY" \
    --inputbox "Gateway (e.g. 192.168.1.1):" 8 50 "" 3>&1 1>&2 2>&3) || exit 1
  STATIC_CIDR=$(whiptail --backtitle "Sugar & Snouts Install" --title "CIDR" \
    --inputbox "Subnet prefix (e.g. 24):" 8 50 "24" 3>&1 1>&2 2>&3) || exit 1
fi

# Container type
CT_TYPE=$(whiptail --backtitle "Sugar & Snouts Install" --title "CONTAINER TYPE" \
  --menu "Container privilege level:" 10 50 2 \
  "1" "Unprivileged (recommended)" \
  "0" "Privileged" \
  3>&1 1>&2 2>&3) || exit 1

# Admin credentials
ADMIN_EMAIL=$(whiptail --backtitle "Sugar & Snouts Install" --title "ADMIN EMAIL" \
  --inputbox "Admin email address:" 8 60 "admin@sugarandsnouts.co.uk" 3>&1 1>&2 2>&3) || exit 1
ADMIN_PASSWORD=$(whiptail --backtitle "Sugar & Snouts Install" --title "ADMIN PASSWORD" \
  --passwordbox "Admin password (min 8 chars):" 8 60 3>&1 1>&2 2>&3) || exit 1

# Summary
whiptail --backtitle "Sugar & Snouts Install" --title "SUMMARY" \
  --yesno "Create container with:\n\n  ID:       ${CTID}\n  Host:     ${CT_HOSTNAME}\n  Env:      ${APP_ENV}\n  Storage:  ${STORAGE}\n  Cores:    ${CORE_COUNT}\n  RAM:      ${RAM_SIZE}MB\n  Disk:     ${DISK_SIZE}GB\n  Network:  ${NET_TYPE}\n\nProceed?" 20 55 || exit 1

# ── Find Debian 12 template ───────────────────────────────────────────────────
msg_info "Finding Debian 12 template"
TEMPLATE=$(pveam list $TEMPLATE_STORAGE 2>/dev/null | grep "debian-12" | tail -1 | awk '{print $1}' || true)
if [[ -z "$TEMPLATE" ]]; then
  msg_info "Downloading Debian 12 template"
  pveam update &>/dev/null
  TEMPLATE_NAME=$(pveam available --section system 2>/dev/null | grep "debian-12" | tail -1 | awk '{print $2}')
  [[ -z "$TEMPLATE_NAME" ]] && msg_error "No Debian 12 template available"
  pveam download $TEMPLATE_STORAGE "$TEMPLATE_NAME" &>/dev/null
  TEMPLATE="${TEMPLATE_STORAGE}:vztmpl/${TEMPLATE_NAME}"
fi
msg_ok "Template: $(basename $TEMPLATE)"

# ── Build pct create args ─────────────────────────────────────────────────────
NET_ARG="name=eth0,bridge=${BRIDGE}"
if [[ "$NET_TYPE" == "dhcp" ]]; then
  NET_ARG+=",ip=dhcp"
else
  NET_ARG+=",ip=${STATIC_IP}/${STATIC_CIDR},gw=${STATIC_GW}"
fi

PCT_ARGS=(
  $CTID $TEMPLATE
  --hostname "$CT_HOSTNAME"
  --storage "$STORAGE"
  --rootfs "${STORAGE}:${DISK_SIZE}"
  --cores "$CORE_COUNT"
  --memory "$RAM_SIZE"
  --net0 "$NET_ARG"
  --unprivileged "$CT_TYPE"
  --features nesting=1
  --start 1
  --onboot 1
)
[[ -n "$CT_PASSWORD" ]] && PCT_ARGS+=(--password "$CT_PASSWORD")

# ── Create container ──────────────────────────────────────────────────────────
echo ""
echo -e " ${CREATING}Creating LXC container ${CTID}...${CL}"
pct create "${PCT_ARGS[@]}" &>/dev/null
CTID_CREATED=$CTID
msg_ok "Container ${CTID} created"

# ── Wait for container to boot ────────────────────────────────────────────────
msg_info "Waiting for container to boot"
for i in $(seq 1 30); do
  pct exec $CTID -- hostname &>/dev/null && break || sleep 2
  [[ $i -eq 30 ]] && msg_error "Container did not start in time"
done
msg_ok "Container running"

# ── Run install script inside container ───────────────────────────────────────
echo ""
echo -e " ${CREATING}Running installation inside container...${CL}"
pct push $CTID /dev/stdin /tmp/install.sh <<EOF_PUSH
$(curl -fsSL "$INSTALL_URL" 2>/dev/null || wget -qO- "$INSTALL_URL")
EOF_PUSH
pct exec $CTID -- bash /tmp/install.sh "$APP_ENV" "$ADMIN_EMAIL" "$ADMIN_PASSWORD"

# ── Get IP address ────────────────────────────────────────────────────────────
IP=$(pct exec $CTID -- hostname -I 2>/dev/null | awk '{print $1}')

echo ""
echo -e "${GN}  ✔  Sugar & Snouts installed successfully!${CL}"
echo ""
echo -e "  🌐  URL:       ${BL}http://${IP}:3000${CL}"
echo -e "  🔑  Admin:     ${BL}http://${IP}:3000/admin/${CL}"
echo -e "  📧  Login:     ${YW}${ADMIN_EMAIL}${CL}"
echo -e "  🖥️   Container: ${YW}${CTID}${CL}"
echo ""
echo -e "  ${YW}To update later, run inside the container:${CL}"
echo -e "  ${BL}bash /opt/sugarandsnouts/update.sh${CL}"
echo ""
