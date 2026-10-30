#!/usr/bin/env bash
# Automatic public-IP HTTPS, with an isolated proxy and renewable ACME certificate.
set -Eeuo pipefail
ip="${AFK_PUBLIC_IP:?The installer must supply the VM public IP}"
python3 - "$ip" <<'PY'
import ipaddress,sys
ip=ipaddress.IPv4Address(sys.argv[1])
if not ip.is_global: raise SystemExit('HTTPS requires the VM public IPv4 address.')
PY
version=2.11.7
sha=727b91701a392de6ebc5027509f548bf39979e5216340d0faed8fa5e69c84f8b
if [[ ! -x /usr/local/bin/caddy ]] || [[ "$(/usr/local/bin/caddy version | cut -d' ' -f1)" != "v$version" ]]; then
  stage="$(mktemp -d)"
  trap 'rm -rf "$stage"' EXIT
  curl -fsSL --retry 3 "https://github.com/caddyserver/caddy/releases/download/v$version/caddy_${version}_linux_amd64.tar.gz" -o "$stage/caddy.tar.gz"
  printf '%s  %s\n' "$sha" "$stage/caddy.tar.gz" | sha256sum --check --status
  tar -xzf "$stage/caddy.tar.gz" -C "$stage" caddy
  install -o root -g root -m 755 "$stage/caddy" /usr/local/bin/caddy
fi
id -u alt-pilot-proxy >/dev/null 2>&1 || useradd --system --home-dir /var/lib/alt-pilot-proxy --create-home --shell /usr/sbin/nologin alt-pilot-proxy
install -d -o alt-pilot-proxy -g alt-pilot-proxy -m 700 /var/lib/alt-pilot-proxy
cat > /etc/alt-pilot/Caddyfile <<EOF
{
    admin off
    default_sni $ip
}
https://$ip {
    tls {
        issuer acme {
            dir https://acme-v02.api.letsencrypt.org/directory
            profile shortlived
        }
    }
    reverse_proxy 127.0.0.1:8765 {
        header_up X-Alt-Pilot-Client-IP {remote_host}
    }
}
EOF
chmod 644 /etc/alt-pilot/Caddyfile
cat > /etc/systemd/system/alt-pilot-https.service <<'UNIT'
[Unit]
Description=ALT Pilot HTTPS dashboard with automatic certificate renewal
After=network-online.target alt-pilot-control.service alt-pilot-firewall.service
Wants=network-online.target alt-pilot-control.service
Requires=alt-pilot-firewall.service
[Service]
User=alt-pilot-proxy
Group=alt-pilot-proxy
Environment=XDG_DATA_HOME=/var/lib/alt-pilot-proxy/data
Environment=XDG_CONFIG_HOME=/var/lib/alt-pilot-proxy/config
ExecStart=/usr/local/bin/caddy run --config /etc/alt-pilot/Caddyfile --adapter caddyfile
Restart=on-failure
RestartSec=5
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/alt-pilot-proxy
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
UMask=0077
MemoryMax=100M
[Install]
WantedBy=multi-user.target
UNIT
# Validate the public-IP ACME configuration without starting certificate orders.
/usr/sbin/runuser -u alt-pilot-proxy -- env XDG_DATA_HOME=/var/lib/alt-pilot-proxy/data /usr/local/bin/caddy validate --config /etc/alt-pilot/Caddyfile --adapter caddyfile
printf 'AFK_TRUST_LOCAL_PROXY=1\n' > /etc/alt-pilot/proxy.env
chmod 600 /etc/alt-pilot/proxy.env
printf 'https://%s\n' "$ip" > /etc/alt-pilot/dashboard-url
chmod 644 /etc/alt-pilot/dashboard-url
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
install -o root -g root -m 755 "$(dirname "$0")/../bin/alt-pilot-firewall" /usr/local/sbin/alt-pilot-firewall
install -o root -g root -m 644 "$(dirname "$0")/../service/alt-pilot-firewall.service" /etc/systemd/system/alt-pilot-firewall.service
systemctl daemon-reload
systemctl enable --now alt-pilot-firewall.service
systemctl restart alt-pilot-firewall.service
systemctl enable --now alt-pilot-https.service
systemctl restart alt-pilot-https.service
