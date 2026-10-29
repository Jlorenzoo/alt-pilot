#!/usr/bin/env bash
# install-desktop.sh — register the ALT Pilot desktop app.
#
# After running this:
#   - Press Super key
#   - Type "minecraft"
#   - Click "ALT Pilot" (with the grass-block icon)
#   - The control center opens in your browser
#
# Idempotent: re-run to update.
# Uninstall: ./install-desktop.sh --uninstall

set -Eeuo pipefail
PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$PKG_DIR/lib/common.sh"

APPS_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
ICONS_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/scalable/apps"

DESKTOP_FILE="$APPS_DIR/alt-pilot.desktop"
ICON_FILE="$ICONS_DIR/alt-pilot.svg"

uninstall() {
  rm -f "$DESKTOP_FILE" "$ICON_FILE"
  update-desktop-database "$APPS_DIR" 2>/dev/null || true
  gtk-update-icon-cache -f -t "$ICONS_DIR/.." 2>/dev/null || true
  echo "Removed. Re-run install-desktop.sh to re-install."
  exit 0
}

[[ "${1:-}" == "--uninstall" || "${1:-}" == "-u" ]] && uninstall

mkdir -p "$APPS_DIR" "$ICONS_DIR"

# Substitute %PKG_DIR% in the template (used for Exec and Icon paths)
sed -e "s|%PKG_DIR%|$PKG_DIR|g" "$PKG_DIR/alt-pilot.desktop.in" > "$DESKTOP_FILE"
chmod 644 "$DESKTOP_FILE"

# Install the grass-block icon
cp "$PKG_DIR/icon.svg" "$ICON_FILE"
chmod 644 "$ICON_FILE"

# Refresh caches so the app appears in the menu immediately
update-desktop-database "$APPS_DIR" 2>/dev/null || true
gtk-update-icon-cache -f -t "${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor" 2>/dev/null || true

cat <<EOF

Installed!

  Desktop file: $DESKTOP_FILE
  Icon file:    $ICON_FILE

To launch:

  1. Press the Super key (Windows/Cmd key).
  2. Type:  minecraft   (or "afk" or "oracle minecraft")
  3. Click "ALT Pilot" (grass-block icon).
  4. The local dashboard and setup wizard open in your browser.

To uninstall:

  ./install-desktop.sh --uninstall

EOF
