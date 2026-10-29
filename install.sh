#!/usr/bin/env bash
# install.sh — Connect this computer to your ALT Pilot server.
#
# Enables running the local Control Center app (http://127.0.0.1:8765/)
# on your desktop or laptop, connecting securely to your Oracle Always Free VM.
#
# For brand new Oracle accounts with no VM yet, use setup-cloudshell.sh.
# See docs/getting-started.md for details.

set -Eeuo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_HOST="${1:-${MC_AFK_HOST:-}}"

if [[ -z "$TARGET_HOST" || "$TARGET_HOST" == --help || "$TARGET_HOST" == -h ]]; then
  cat <<'HELP'
Usage: ./install.sh YOUR_SERVER_HOST_OR_IP

Connect this computer to your existing ALT Pilot Oracle VM.
This configures your local machine so you can run the ALT Pilot
desktop app locally on http://127.0.0.1:8765/ with zero hassle.

Examples:
  ./install.sh 129.151.84.102
  ./install.sh my-server.tailnet.ts.net

Requirements:
  - SSH access (or Tailscale SSH) to the target machine.
  - git, ssh, ssh-keygen, python3.
HELP
  [[ -n "$TARGET_HOST" ]] && exit 0
  exit 2
fi

[[ "$TARGET_HOST" =~ ^[A-Za-z0-9][A-Za-z0-9.-]*$ ]] || {
  echo "Error: Enter a hostname or IPv4 address, without a username or options." >&2
  exit 2
}

for tool in git ssh ssh-keygen python3; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "Error: Required tool is missing: $tool" >&2
    exit 1
  }
done

SSH_DIR="$HOME/.ssh"
mkdir -p -m 700 "$SSH_DIR"
chmod 700 "$SSH_DIR"

DEFAULT_KEY="${MC_AFK_SSH_KEY:-$SSH_DIR/id_ed25519}"
if [[ ! -f "$DEFAULT_KEY" ]]; then
  echo "==> Generating local SSH keypair ($DEFAULT_KEY)..."
  ssh-keygen -q -t ed25519 -N '' -C "alt-pilot-client-$(hostname)" -f "$DEFAULT_KEY"
fi
if [[ ! -f "$DEFAULT_KEY.pub" ]]; then
  ssh-keygen -y -f "$DEFAULT_KEY" > "$DEFAULT_KEY.pub"
fi

SSH_OPTIONS=(-i "$DEFAULT_KEY" -o ConnectTimeout=30 -o StrictHostKeyChecking=ask)
echo "==> Connecting to your deployment at $TARGET_HOST..."
ssh "${SSH_OPTIONS[@]}" "ubuntu@$TARGET_HOST" 'echo "SSH access verified."'

echo "==> Authorizing this computer's SSH key..."
ssh "${SSH_OPTIONS[@]}" "ubuntu@$TARGET_HOST" '
  umask 077
  mkdir -p ~/.ssh
  chmod 700 ~/.ssh
  key=$(cat)
  touch ~/.ssh/authorized_keys
  grep -qxF -- "$key" ~/.ssh/authorized_keys || printf "%s\n" "$key" >> ~/.ssh/authorized_keys
  chmod 600 ~/.ssh/authorized_keys
' < "$DEFAULT_KEY.pub"

STATE_DIR="$ROOT_DIR/.state"
mkdir -p -m 700 "$STATE_DIR"
chmod 700 "$STATE_DIR"

backup="$(mktemp)"
trap 'rm -f "$backup"' EXIT

if ssh "${SSH_OPTIONS[@]}" "ubuntu@$TARGET_HOST" 'sudo -n test -s /etc/alt-pilot/client-state.tar.gz' 2>/dev/null; then
  echo "==> Restoring private client configuration from server..."
  ssh "${SSH_OPTIONS[@]}" "ubuntu@$TARGET_HOST" 'sudo -n cat /etc/alt-pilot/client-state.tar.gz' > "$backup"
  python3 "$ROOT_DIR/tools/restore_client_state.py" "$backup" "$ROOT_DIR"
else
  echo "==> Initializing local cluster connection state..."
  STATE_FILE="$STATE_DIR/vm.json"
  python3 -c "
import json, sys
state = {'public_ip': sys.argv[1]}
with open('$STATE_FILE', 'w', encoding='utf-8') as f:
    json.dump(state, f, indent=2)
" "$TARGET_HOST"
  chmod 600 "$STATE_DIR/vm.json"
fi

echo "==> Running local verification tests..."
python3 -m unittest discover -s "$ROOT_DIR/tests"

echo "==> Checking code syntax..."
python3 -m py_compile control_center.py remote_control.py mc_server_ping.py chat_whitelist.py availability.py
if command -v node >/dev/null 2>&1; then
  node --check web/app.js
  node --check web/console-format.js
fi

echo ""
echo "=================================================================="
echo " ALT PILOT CONNECTED SUCCESSFULLY!"
echo "=================================================================="
echo ""
echo " Your computer is now linked to your 24/7 cloud server ($TARGET_HOST)."
echo ""
echo " Permanent Local App URL:"
echo "   http://127.0.0.1:8765/"
echo ""
echo " Quick Launch Options:"
echo "   1. Start local app directly in terminal:"
echo "      ./app.sh"
echo ""
echo "   2. Install desktop launcher with grass-block icon:"
echo "      ./install-desktop.sh"
echo "      (Then press Super/Windows key, type 'minecraft', and click ALT Pilot)"
echo ""
echo "=================================================================="
