#!/usr/bin/env bash
# Install the validated gateway and its host-side systemd service.
set -Eeuo pipefail

[[ $EUID -eq 0 ]] || { echo 'Run on the ALT Pilot VM with sudo.' >&2; exit 1; }
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
systemd=/etc/systemd/system
gateway=/usr/local/sbin/alt-pilot-account-service
install -D -o root -g root -m 755 "$root/bin/alt-pilot-account-service" /usr/local/libexec/alt-pilot-account-action
install -o root -g root -m 644 "$root/service/alt-pilot-account-action@.service" "$systemd/"
systemctl daemon-reload

stage="$(mktemp /usr/local/sbin/.alt-pilot-account-service.XXXXXX)"
trap 'rm -f -- "$stage"' EXIT
install -o root -g root -m 755 "$root/bin/alt-pilot-account-request" "$stage"
mv -fT -- "$stage" "$gateway"
