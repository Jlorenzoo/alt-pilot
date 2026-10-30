#!/usr/bin/env bash
# Pinned official static binaries; no downloaded installer is run as root.
set -Eeuo pipefail
version=1.104.4
sha=624ea093d47d62cf56f17b8332d74b8decda4a1faa610ebc60a1de334b2b3dc9
[[ "$(id -u)" == 0 && "$(uname -m)" == x86_64 ]] || { echo 'Requires root on x86_64 Ubuntu.' >&2; exit 1; }
if [[ ! -x /usr/local/bin/tailscale ]] || [[ "$(/usr/local/bin/tailscale version | head -1)" != "$version" ]]; then
  stage="$(mktemp -d)"
  trap 'rm -rf "$stage"' EXIT
  curl -fsSL --retry 3 "https://pkgs.tailscale.com/stable/tailscale_${version}_amd64.tgz" -o "$stage/tailscale.tgz"
  printf '%s  %s\n' "$sha" "$stage/tailscale.tgz" | sha256sum --check --status
  tar -xzf "$stage/tailscale.tgz" -C "$stage"
  install -o root -g root -m 755 "$stage/tailscale_${version}_amd64/tailscale" /usr/local/bin/tailscale
  install -o root -g root -m 755 "$stage/tailscale_${version}_amd64/tailscaled" /usr/local/sbin/tailscaled
fi
# Preserve an existing package-managed Tailscale installation/service.
if ! systemctl cat tailscaled.service >/dev/null 2>&1; then
  cat > /etc/systemd/system/tailscaled.service <<'UNIT'
[Unit]
Description=Tailscale secure network and persistent dashboard HTTPS
After=network-online.target
Wants=network-online.target
[Service]
ExecStart=/usr/local/sbin/tailscaled --state=/var/lib/tailscale/tailscaled.state --socket=/run/tailscale/tailscaled.sock
Restart=on-failure
RestartSec=5
RuntimeDirectory=tailscale
StateDirectory=tailscale
StateDirectoryMode=0700
UMask=0077
[Install]
WantedBy=multi-user.target
UNIT
  touch /etc/alt-pilot/tailscale-installed-by-afk
fi
systemctl daemon-reload
systemctl enable --now tailscaled.service
