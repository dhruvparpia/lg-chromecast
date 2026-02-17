#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
DISPLAY_DIR="$REPO_DIR/cast-display"

# ---------- helpers ----------

info()  { printf '\033[1;34m[info]\033[0m  %s\n' "$*"; }
warn()  { printf '\033[1;33m[warn]\033[0m  %s\n' "$*"; }
error() { printf '\033[1;31m[error]\033[0m %s\n' "$*"; exit 1; }

# ---------- ares-package check ----------

check_ares() {
    if ! command -v ares-package &>/dev/null; then
        error "ares-package not found.
  Install the webOS CLI tools:
    npm install -g @aspect-apps/ares-cli
  Or follow: https://webostv.developer.lge.com/develop/tools/cli-installation"
    fi
    info "ares-package found: $(command -v ares-package)"
}

# ---------- package ----------

build_package() {
    if [ ! -d "$DISPLAY_DIR" ]; then
        error "cast-display directory not found at $DISPLAY_DIR"
    fi

    info "Packaging cast-display..."
    cd "$DISPLAY_DIR"
    ares-package .

    IPK_FILE="$(ls -t ./*.ipk 2>/dev/null | head -1)"
    if [ -z "$IPK_FILE" ]; then
        error "Packaging failed - no .ipk file produced"
    fi

    IPK_PATH="$(cd "$(dirname "$IPK_FILE")" && pwd)/$(basename "$IPK_FILE")"
    info "Package created: $IPK_PATH"
}

# ---------- optional install to TV ----------

offer_install() {
    if ! command -v ares-install &>/dev/null; then
        return
    fi

    # Check if any devices are configured
    local devices
    devices="$(ares-setup-device --list 2>/dev/null || true)"
    if [ -z "$devices" ] || echo "$devices" | grep -q "No devices"; then
        warn "No webOS devices configured. Use ares-setup-device to add your TV."
        return
    fi

    printf '\nAvailable devices:\n%s\n\n' "$devices"
    read -rp "Install to TV now? (y/N) " answer
    if [[ "$answer" =~ ^[Yy]$ ]]; then
        ares-install "$IPK_PATH"
        info "Installed to TV"
    fi
}

# ---------- summary ----------

print_summary() {
    printf '\n'
    printf '  .ipk path: %s\n' "$IPK_PATH"
    printf '\n'
    printf '  To install manually:\n'
    printf '    ares-install %s\n' "$IPK_PATH"
    printf '\n'
}

# ---------- main ----------

main() {
    info "webOS packager for cast-display"
    check_ares
    build_package
    offer_install
    print_summary
}

main
