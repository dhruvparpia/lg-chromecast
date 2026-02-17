#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
DEFAULT_DEVICE_NAME="Cast Bridge"

# ---------- helpers ----------

info()  { printf '\033[1;34m[info]\033[0m  %s\n' "$*"; }
warn()  { printf '\033[1;33m[warn]\033[0m  %s\n' "$*"; }
error() { printf '\033[1;31m[error]\033[0m %s\n' "$*"; exit 1; }

# ---------- Node.js check ----------

check_node() {
    if ! command -v node &>/dev/null; then
        error "Node.js is not installed.
  Install Node.js 18+ via NodeSource:
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs
  Or use nvm: https://github.com/nvm-sh/nvm"
    fi

    local node_version
    node_version="$(node --version | sed 's/^v//')"
    local major="${node_version%%.*}"

    if [ "$major" -lt 18 ]; then
        error "Node.js $node_version is too old (need 18+).
  Install a newer version via NodeSource:
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs
  Or use nvm: https://github.com/nvm-sh/nvm"
    fi

    info "Node.js v${node_version} detected"
}

# ---------- repo detection ----------

locate_repo() {
    if [ -f "$REPO_DIR/cast-bridge/package.json" ]; then
        info "Running from repo at $REPO_DIR"
        return
    fi

    if [ -f "./cast-bridge/package.json" ]; then
        REPO_DIR="$(pwd)"
        info "Found repo in current directory"
        return
    fi

    warn "cast-bridge/package.json not found in expected locations."
    read -rp "Clone the repo? (y/N) " answer
    if [[ "$answer" =~ ^[Yy]$ ]]; then
        git clone https://github.com/dhruvparpia/lg-chromecast.git /opt/lg-chromecast
        REPO_DIR="/opt/lg-chromecast"
        info "Cloned to $REPO_DIR"
    else
        error "Cannot continue without the cast-bridge source."
    fi
}

# ---------- npm install ----------

install_deps() {
    info "Installing production dependencies..."
    cd "$REPO_DIR/cast-bridge"
    npm install --production
    cd "$REPO_DIR"
}

# ---------- device name prompt ----------

prompt_device_name() {
    read -rp "Device name [$DEFAULT_DEVICE_NAME]: " device_name
    device_name="${device_name:-$DEFAULT_DEVICE_NAME}"
}

# ---------- env file ----------

write_env() {
    info "Writing /etc/cast-bridge.env (requires sudo)"
    sudo tee /etc/cast-bridge.env >/dev/null <<EOF
DEVICE_NAME="${device_name}"
# DEBUG=1
EOF
    info "Environment written to /etc/cast-bridge.env"
}

# ---------- systemd service ----------

install_service() {
    local service_src="$SCRIPT_DIR/cast-bridge.service"
    local service_dest="/etc/systemd/system/cast-bridge.service"
    local current_user
    current_user="$(whoami)"
    local current_group
    current_group="$(id -gn)"

    if [ ! -f "$service_src" ]; then
        error "Service template not found at $service_src"
    fi

    info "Installing systemd service (requires sudo)"

    # Replace placeholders with actual user/group and working directory
    sed \
        -e "s|^User=.*|User=${current_user}|" \
        -e "s|^Group=.*|Group=${current_group}|" \
        -e "s|^WorkingDirectory=.*|WorkingDirectory=${REPO_DIR}/cast-bridge|" \
        "$service_src" | sudo tee "$service_dest" >/dev/null

    sudo systemctl daemon-reload
    sudo systemctl enable cast-bridge.service
    info "Service installed and enabled"
}

# ---------- firewall ----------

configure_firewall() {
    if ! command -v ufw &>/dev/null; then
        return
    fi

    if ! sudo ufw status | grep -q "Status: active"; then
        return
    fi

    info "ufw is active."
    read -rp "Open ports 8008, 8009, 8010 for Cast Bridge? (y/N) " answer
    if [[ "$answer" =~ ^[Yy]$ ]]; then
        sudo ufw allow 5353/udp comment "Cast Bridge - mDNS"
        sudo ufw allow 8008/tcp comment "Cast Bridge - DIAL"
        sudo ufw allow 8009/tcp comment "Cast Bridge - CastV2"
        sudo ufw allow 8010/tcp comment "Cast Bridge - WebSocket"
        info "Firewall ports opened"
    fi
}

# ---------- summary ----------

print_summary() {
    printf '\n'
    info "Installation complete!"
    printf '\n'
    printf '  Service:      cast-bridge.service (enabled)\n'
    printf '  Config:       /etc/cast-bridge.env\n'
    printf '  Device name:  %s\n' "$device_name"
    printf '  Working dir:  %s/cast-bridge\n' "$REPO_DIR"
    printf '\n'
    printf '  Start now:    sudo systemctl start cast-bridge\n'
    printf '  View logs:    journalctl -u cast-bridge -f\n'
    printf '\n'
    printf '  Next: set up cast-display on your webOS TV.\n'
    printf '  See scripts/package-webos.sh to build the .ipk.\n'
    printf '\n'
}

# ---------- main ----------

main() {
    info "Cast Bridge installer"
    check_node
    locate_repo
    install_deps
    prompt_device_name
    write_env
    install_service
    configure_firewall
    print_summary
}

main
