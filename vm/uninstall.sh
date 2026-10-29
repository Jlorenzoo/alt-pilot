#!/usr/bin/env bash
# vm/uninstall.sh — remove AFK setup but DO NOT delete the VM itself.
set -e
systemctl disable --now alt-pilot-tunnel.service \
  alt-pilot-control.service alt-pilot-watchdog.timer \
  alt-pilot.service alt-pilot-alt.service 'alt-pilot@*.service' 2>/dev/null || true
rm -f /etc/systemd/system/alt-pilot.service \
  /etc/systemd/system/alt-pilot-alt.service \
  /etc/systemd/system/alt-pilot-control.service \
  /etc/systemd/system/alt-pilot-tunnel.service \
  /etc/systemd/system/alt-pilot@.service \
  /etc/systemd/system/alt-pilot-watchdog.service \
  /etc/systemd/system/alt-pilot-watchdog.timer \
  /etc/systemd/system/alt-pilot.slice
rm -f /etc/systemd/system/multi-user.target.wants/alt-pilot@*.service
rm -f /etc/logrotate.d/alt-pilot
rm -f /etc/sudoers.d/alt-pilot-control
systemctl daemon-reload
if [[ -f /etc/alt-pilot/cloudflared-installed-by-afk ]]; then
  rm -f /usr/local/bin/cloudflared
fi
rm -rf /opt/alt-pilot
rm -f /usr/local/bin/afk-status /usr/local/bin/afk-start \
      /usr/local/bin/afk-stop /usr/local/bin/afk-restart \
      /usr/local/bin/afk-logs /usr/local/bin/afk-health-json \
      /usr/local/bin/alt-pilot-mcc-run /usr/local/bin/afk-wizard \
      /usr/local/bin/afk-console-log \
      /usr/local/sbin/alt-pilot-send \
      /usr/local/sbin/alt-pilot-watchdog \
      /usr/local/bin/mc-login /usr/local/bin/mc-signout \
      /usr/local/sbin/alt-pilot-account-service \
      /usr/local/bin/afk-control-logs \
      /usr/local/sbin/alt-pilot-set-options
rm -rf /etc/alt-pilot
# Remove user + saved Minecraft data (auth tokens live here)
userdel -r mc 2>/dev/null || true
userdel -r afk-control 2>/dev/null || true
echo "Uninstalled. OCI VM was NOT deleted."
