#!/usr/bin/env bash
set -Eeuo pipefail
[[ $EUID -eq 0 ]] || exit 1
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
install -D -o root -g root -m 755 "$root/vm/update.sh" /usr/local/libexec/alt-pilot/update.sh
install -o root -g root -m 755 "$root/vm/install-bedrock.sh" /usr/local/libexec/alt-pilot/install-bedrock.sh
install -o root -g root -m 755 "$root/bin/alt-pilot-update-request" /usr/local/sbin/alt-pilot-update-request
install -o root -g root -m 644 "$root/service/alt-pilot-update.service" /etc/systemd/system/
install -d -o root -g root -m 755 /var/lib/alt-pilot-update
systemctl daemon-reload
