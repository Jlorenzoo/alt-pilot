#!/usr/bin/env bash
# vm/setup-vm.sh — runs ON the Oracle VM as root via SSH.
# Idempotent: safe to re-run. Does NOT touch auth or service state.
#
# Phases:
#   1. Harden sysctl/swap/disk
#   2. Create unprivileged user `mc`
#   3. Install lightweight Minecraft Console Client under /opt/alt-pilot
#   4. Configure launcher + helper commands
#   5. Configure systemd units, password-protected remote UI + logrotate
#   6. Print post-install summary

set -Eeuo pipefail
SETUP_VM_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SETUP_VM_DIR/../lib/common.sh"

require_root
# Keep account runtimes running, but stop the controller before safely migrating
# its private password/session/SQLite state during a repair.
systemctl stop alt-pilot-control.service 2>/dev/null || true
export OPTIONS_FILE="${OPTIONS_FILE:-/etc/alt-pilot/options.env}"
AFK_HOST_ROLE="${AFK_HOST_ROLE:-primary}"
AFK_REMOTE_ACCESS="${AFK_REMOTE_ACCESS:-ip}"
[[ "$AFK_REMOTE_ACCESS" == ip || "$AFK_REMOTE_ACCESS" == funnel || "$AFK_REMOTE_ACCESS" == none ]] || die "AFK_REMOTE_ACCESS must be ip, funnel or none."
[[ "$AFK_HOST_ROLE" == primary || "$AFK_HOST_ROLE" == worker ]] \
  || die "AFK_HOST_ROLE must be primary or worker."

# ---------- 1. System tuning ----------
section "1/6 System tuning (swap, sysctl, packages)"

# 2 GB swap (E2.1.Micro has 1 GB RAM; emergency headroom)
if ! swapon --show=name | grep -q '^/swapfile$'; then
  if [[ ! -f /swapfile ]]; then
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
  fi
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  ok "2 GB swap file ready"
else
  ok "Swap already configured"
fi

# vm.swappiness: prefer RAM, swap only as emergency
sysctl -w vm.swappiness=10 >/dev/null
grep -q '^vm.swappiness=' /etc/sysctl.d/99-alt-pilot.conf 2>/dev/null \
  || echo 'vm.swappiness=10' > /etc/sysctl.d/99-alt-pilot.conf

# vfs_cache_pressure: keep dentries/inodes cached
sysctl -w vm.vfs_cache_pressure=50 >/dev/null
grep -q '^vm.vfs_cache_pressure=' /etc/sysctl.d/99-alt-pilot.conf \
  || echo 'vm.vfs_cache_pressure=50' >> /etc/sysctl.d/99-alt-pilot.conf

# Disable transparent hugepages for predictable Java behavior
echo madvise > /sys/kernel/mm/transparent_hugepage/enabled 2>/dev/null || true

# Apt update + minimal packages
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
packages=(curl jq ca-certificates openssh-server ufw logrotate haveged)
apt-get install -y --no-install-recommends "${packages[@]}" >/dev/null
ok "Minimal host packages installed"

# Disable optional services that are wasteful on this single-purpose VM.
# Keep unattended-upgrades: automatic security patches are worth its small,
# intermittent cost and the old installer weakened the VM by disabling it.
for svc in snapd.service snapd.socket snapd.seeded.service \
           apport.service apport-forward.socket \
           lvm2-monitor.service mdmonitor.service \
           multipathd.service multipathd.socket \
           fwupd.service fwupd-refresh.timer \
           ua-messaging.service ua-timer.service; do
  systemctl disable --now "$svc" 2>/dev/null || true
done
ok "Disabled unnecessary daemons"

# Firewall: default deny inbound, with SSH connection-rate limiting. OCI's
# security list/NSG should additionally restrict this to the operator's CIDR.
ufw --force reset >/dev/null
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw limit 22/tcp >/dev/null
ufw --force enable >/dev/null
# Oracle Ubuntu images can also restore vendor iptables rules at boot. Apply
# UFW after that restore so the app's HTTPS allowances survive a VM restart.
install -d -m 755 /etc/systemd/system/ufw.service.d
cat > /etc/systemd/system/ufw.service.d/alt-pilot.conf <<'FIREWALL'
[Unit]
After=netfilter-persistent.service
FIREWALL
systemctl enable ufw.service >/dev/null
ok "UFW: inbound denied, SSH rate-limited, outbound allowed"

# Enforce the SSH posture required by the dashboard rather than inheriting
# permissive settings from a reused Oracle image. Do not add AllowUsers here:
# the local control center supports a deliberately configurable SSH username.
install -d -m 755 /etc/ssh/sshd_config.d
cat > /etc/ssh/sshd_config.d/99-alt-pilot.conf <<'EOF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
MaxAuthTries 3
LoginGraceTime 30
X11Forwarding no
EOF
install -d -m 755 /run/sshd
sshd -t
systemctl reload-or-restart ssh 2>/dev/null || systemctl reload-or-restart sshd
ok "SSH: root and password login disabled; connection attempts constrained"

# ---------- 2. User ----------
section "2/7 Dedicated user 'mc'"
if ! id -u mc >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" --shell /bin/bash mc
  ok "User mc created"
else
  ok "User mc already exists"
fi
if ! id -u afk-control >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/afk-control --create-home --shell /usr/sbin/nologin afk-control
  ok "Restricted remote-control user created"
fi
mkdir -p /opt/alt-pilot/{logs,run,assets} /etc/alt-pilot
# Configuration consumed by privileged helpers is never dashboard-writable.
chown root:root /etc/alt-pilot
chmod 755 /etc/alt-pilot
[[ ! -L /var/lib/alt-pilot ]] || die "Private runtime directory must not be a symlink."
install -d -o root -g afk-control -m 700 /var/lib/alt-pilot
for name in control-password.json control-sessions.json control-token; do
  [[ ! -L "/var/lib/alt-pilot/$name" ]] || die "Private runtime state must not contain symlinks."
done
# Migrate old mutable state without following attacker-controlled links.
for name in control-password.json control-sessions.json availability.sqlite3 control-token; do
  if [[ -f "/etc/alt-pilot/$name" && ! -L "/etc/alt-pilot/$name" && ! -e "/var/lib/alt-pilot/$name" ]]; then
    install -o afk-control -g afk-control -m 600 "/etc/alt-pilot/$name" "/var/lib/alt-pilot/$name"
    rm -f "/etc/alt-pilot/$name"
  fi
done
mkdir -p /home/mc/slots/1/game
# The game process must not be able to replace the control service or runtimes.
# In particular, never recursively transfer this tree to the untrusted mc user
# during a repair: it contains root-managed executables and Python source.
[[ ! -L /opt/alt-pilot ]] || die "Application directory must not be a symlink."
chown -hR root:mc /opt/alt-pilot
chmod -R go-w /opt/alt-pilot
chown -R mc:mc /home/mc/slots
chmod 751 /opt/alt-pilot
if [[ ! -f /etc/alt-pilot/options.env ]]; then
  cat > /etc/alt-pilot/options.env <<'EOF'
MC_VERSION=1.12.2
MC_SERVER=eu.mc-complex.com
JVM_HEAP_XMS=160m
JVM_HEAP_XMX=320m
EOF
fi
chown root:mc /etc/alt-pilot/options.env
chmod 640 /etc/alt-pilot/options.env

# ---------- 3. Lightweight MCC ----------
section "3/6 Minecraft Console Client"

MCC_BUILD="${MCC_BUILD:-20260829-511}"
MCC_SHA256="${MCC_SHA256:-2e0fe135079824d1b02a3ef9bf89c56d95d72a1d1502d7204f93acc0084223db}"
MCC_DIR=/opt/alt-pilot/mcc
MCC_BINARY="$MCC_DIR/MinecraftClient"
mkdir -p "$MCC_DIR"
if [[ ! -f "$MCC_BINARY" ]]; then
  curl -fsSL \
    "https://github.com/MCCTeam/Minecraft-Console-Client/releases/download/${MCC_BUILD}/MinecraftClient-${MCC_BUILD}-linux-x64" \
    -o "$MCC_BINARY"
fi
printf '%s  %s\n' "$MCC_SHA256" "$MCC_BINARY" | sha256sum --check --status \
  || die "Minecraft Console Client checksum mismatch. Refusing to execute it."
chown root:mc "$MCC_BINARY"
chmod 750 "$MCC_BINARY"
MCC_SHA256="$MCC_SHA256" bash "$SETUP_VM_DIR/install-mcc-runtime.sh"
ok "Minecraft Console Client ${MCC_BUILD} ready"

# Drop artifacts left behind by an earlier HeadlessMC-based install so a
# re-run truly returns the VM to a single-runtime state. None of these are
# read anymore; the HMC launcher, sign-in shim, and per-slot profile dirs
# only consume disk.
removed_legacy=0
for legacy_path in \
  /usr/local/bin/mc-login-headlessmc \
  /usr/local/bin/alt-pilot-headlessmc-run \
  /usr/local/bin/alt-pilot-run \
  /usr/local/bin/mc-console \
  /usr/local/bin/mc-launch \
  /usr/local/bin/mc-console-profile \
  /usr/local/bin/afk-wizard; do
  if [[ -e "$legacy_path" ]]; then rm -f "$legacy_path"; removed_legacy=1; fi
done
# Slot 2 now uses the alt-pilot@.service template.
if [[ -e /etc/systemd/system/alt-pilot-alt.service ]]; then
  systemctl disable --now alt-pilot-alt.service 2>/dev/null || true
  rm -f /etc/systemd/system/alt-pilot-alt.service
  removed_legacy=1
fi
if id -u mc > /dev/null 2>&1; then
  for legacy_dir in /home/mc/HeadlessMC /home/mc/.minecraft; do
    if [[ -d "$legacy_dir" ]]; then
      find "$legacy_dir" -maxdepth 2 -name '*1.12.2*forge*' -exec rm -rf {} + 2>/dev/null || true
    fi
  done
  rm -rf /home/mc/HeadlessMC 2>/dev/null || true
  for slot in {1..10}; do
    rm -rf "/home/mc/slots/${slot}/HeadlessMC" 2>/dev/null || true
  done
  removed_legacy=1
fi
if dpkg -s openjdk-17-jre-headless >/dev/null 2>&1; then
  apt-get purge -y openjdk-17-jre-headless >/dev/null 2>&1 || true
  removed_legacy=1
fi
if (( removed_legacy )); then ok "Removed leftover HeadlessMC artifacts"; fi

# Bedrock is separate from the saved MCC/Java sessions.
bash "$SETUP_VM_DIR/install-bedrock.sh" "$SETUP_VM_DIR/../bedrock"
install -m 755 "$SETUP_VM_DIR/../bin/alt-pilot-login.py" /usr/local/bin/alt-pilot-login.py
install -m 755 "$SETUP_VM_DIR/../bin/afk-bedrock-connected" /usr/local/bin/afk-bedrock-connected

# ---------- 4. Launcher + helper scripts ----------
section "4/6 Launcher + helpers"

install -m 755 "$SETUP_VM_DIR/launch-mcc.sh" /usr/local/bin/alt-pilot-mcc-run
for helper in afk-status afk-url afk-start afk-stop afk-restart afk-logs afk-health-json afk-mcc-profile-name; do
  install -m 755 "$SETUP_VM_DIR/../bin/$helper" "/usr/local/bin/$helper"
done
install -m 755 "$SETUP_VM_DIR/../bin/afk-control-logs" /usr/local/bin/afk-control-logs
install -m 755 "$SETUP_VM_DIR/../bin/afk-console-log" /usr/local/bin/afk-console-log
install -m 755 "$SETUP_VM_DIR/../bin/mc-login" /usr/local/bin/mc-login
install -m 755 "$SETUP_VM_DIR/../bin/mc-signout" /usr/local/bin/mc-signout
install -m 755 "$SETUP_VM_DIR/../bin/alt-pilot-mcc-prepare" /usr/local/bin/alt-pilot-mcc-prepare
install -m 755 "$SETUP_VM_DIR/../bin/alt-pilot-account-service" /usr/local/sbin/alt-pilot-account-service
install -m 755 "$SETUP_VM_DIR/../bin/alt-pilot-set-options" /usr/local/sbin/alt-pilot-set-options
install -m 755 "$SETUP_VM_DIR/../bin/alt-pilot-set-account-options" /usr/local/sbin/alt-pilot-set-account-options
install -m 755 "$SETUP_VM_DIR/../bin/alt-pilot-send" /usr/local/sbin/alt-pilot-send
install -m 755 "$SETUP_VM_DIR/../bin/alt-pilot-chat-inbox" /usr/local/sbin/alt-pilot-chat-inbox
install -m 755 "$SETUP_VM_DIR/../bin/alt-pilot-hub-recovery.py" /usr/local/sbin/alt-pilot-hub-recovery.py
install -m 755 "$SETUP_VM_DIR/../bin/alt-pilot-watchdog" /usr/local/sbin/alt-pilot-watchdog
install -m 755 "$SETUP_VM_DIR/../bin/alt-pilot-peer" /usr/local/sbin/alt-pilot-peer
install -m 755 "$SETUP_VM_DIR/../bin/alt-pilot-reorder" /usr/local/sbin/alt-pilot-reorder
mkdir -p /opt/alt-pilot/mcc
install -m 644 "$SETUP_VM_DIR/item-controls.cs" /opt/alt-pilot/mcc/item-controls.cs

# systemd opens these log paths before dropping privilege. Only root may
# replace them; otherwise a compromised game process could plant a symlink.
[[ ! -L /opt/alt-pilot/logs ]] || die "Log directory must not be a symlink."
mkdir -p /opt/alt-pilot/logs
chown root:mc /opt/alt-pilot/logs
chmod 750 /opt/alt-pilot/logs
for slot in {1..10}; do
  if [[ "$slot" == 1 ]]; then log=/opt/alt-pilot/logs/afk.log; else log="/opt/alt-pilot/logs/afk-${slot}.log"; fi
  for file in "$log" "/opt/alt-pilot/logs/console-${slot}.log"; do
    [[ ! -L "$file" ]] || die "Log file must not be a symlink."
    touch "$file"
    chown root:mc "$file"
    chmod 640 "$file"
  done
  # Never create or chmod game-owned paths as root: mc can replace them.
  /usr/sbin/runuser -u mc -- bash -c '
    umask 077
    mkdir -p "/home/mc/slots/$1"
    touch "/home/mc/slots/$1/console.log"
    chmod 750 "/home/mc/slots/$1"
    chmod 600 "/home/mc/slots/$1/console.log"
  ' bash "$slot"
done

# ---------- 5. systemd + logrotate + remote control ----------
section "5/6 systemd, logs + password-protected remote control"

cp "$SETUP_VM_DIR/../service/alt-pilot.service" /etc/systemd/system/alt-pilot.service
cp "$SETUP_VM_DIR/../service/alt-pilot@.service" /etc/systemd/system/alt-pilot@.service
cp "$SETUP_VM_DIR/../service/alt-pilot.slice" /etc/systemd/system/alt-pilot.slice
cp "$SETUP_VM_DIR/../service/alt-pilot-watchdog.service" /etc/systemd/system/alt-pilot-watchdog.service
cp "$SETUP_VM_DIR/../service/alt-pilot-watchdog.timer" /etc/systemd/system/alt-pilot-watchdog.timer
cp "$SETUP_VM_DIR/../service/alt-pilot-control.service" /etc/systemd/system/alt-pilot-control.service
cp "$SETUP_VM_DIR/../service/alt-pilot-tunnel.service" /etc/systemd/system/alt-pilot-tunnel.service
cp "$SETUP_VM_DIR/../service/logrotate.conf"        /etc/logrotate.d/alt-pilot

if [[ "$AFK_HOST_ROLE" == primary ]]; then
  CONTROL_DIR=/opt/alt-pilot/control
  mkdir -p "$CONTROL_DIR/web"
  chmod 751 /opt/alt-pilot
  chown root:afk-control "$CONTROL_DIR"
  chmod 750 "$CONTROL_DIR"
  install -o root -g root -m 644 "$SETUP_VM_DIR/../availability.py" "$CONTROL_DIR/availability.py"
  install -o root -g root -m 644 "$SETUP_VM_DIR/../control_center.py" "$CONTROL_DIR/control_center.py"
  install -o root -g root -m 644 "$SETUP_VM_DIR/../remote_control.py" "$CONTROL_DIR/remote_control.py"
  install -o root -g root -m 644 "$SETUP_VM_DIR/../mc_server_ping.py" "$CONTROL_DIR/mc_server_ping.py"
  install -o root -g root -m 644 "$SETUP_VM_DIR/../chat_whitelist.py" "$CONTROL_DIR/chat_whitelist.py"
  cp -a "$SETUP_VM_DIR/../web/." "$CONTROL_DIR/web/"
  chown -R root:root "$CONTROL_DIR/web"
  chmod -R a+rX "$CONTROL_DIR/web"

  cat > /etc/sudoers.d/alt-pilot-control <<'EOF'
afk-control ALL=(root) NOPASSWD: /usr/local/sbin/alt-pilot-account-service *, /usr/local/bin/afk-health-json, /usr/local/bin/afk-control-logs, /usr/local/bin/afk-console-log *, /usr/local/sbin/alt-pilot-set-options *, /usr/local/sbin/alt-pilot-set-account-options *, /usr/local/sbin/alt-pilot-send *, /usr/local/sbin/alt-pilot-chat-inbox *
afk-control ALL=(mc) NOPASSWD: /usr/local/bin/mc-login, /usr/local/bin/mc-signout
EOF
  chmod 440 /etc/sudoers.d/alt-pilot-control
  visudo -cf /etc/sudoers.d/alt-pilot-control >/dev/null

  if [[ ! -s /var/lib/alt-pilot/control-password.json ]]; then
    (cd "$CONTROL_DIR" && python3 remote_control.py --init-password) > /opt/alt-pilot/initial-control-password
    chmod 600 /opt/alt-pilot/initial-control-password
  fi
  chown root:afk-control /var/lib/alt-pilot/control-password.json
  # The restricted control process owns password rotation; the file contains
  # only a salted scrypt hash, never the plaintext password.
  chmod 660 /var/lib/alt-pilot/control-password.json
  touch /var/lib/alt-pilot/control-sessions.json
  chown root:afk-control /var/lib/alt-pilot/control-sessions.json
  chmod 660 /var/lib/alt-pilot/control-sessions.json

  chown -hR afk-control:afk-control /var/lib/alt-pilot
  chmod 770 /var/lib/alt-pilot
  if [[ "$AFK_REMOTE_ACCESS" == funnel ]]; then
    printf 'AFK_TRUST_LOCAL_PROXY=0\n' > /etc/alt-pilot/proxy.env
    rm -f /etc/alt-pilot/dashboard-url
    systemctl disable --now alt-pilot-https.service alt-pilot-firewall.service 2>/dev/null || true
    bash "$SETUP_VM_DIR/install-tailscale.sh"
  elif [[ "$AFK_REMOTE_ACCESS" == ip ]]; then
    bash "$SETUP_VM_DIR/install-https.sh"
  fi

fi

systemctl daemon-reload
if [[ "$AFK_HOST_ROLE" == primary ]]; then
  systemctl enable alt-pilot-control.service alt-pilot-watchdog.timer
  if [[ -s /etc/alt-pilot/cluster.json ]]; then
    local_host_id="$(jq -r '.hosts[] | select(.local == true) | .id' /etc/alt-pilot/cluster.json | head -n 1)"
    slot_one_host="$(jq -r '.placements["1"] // ""' /etc/alt-pilot/cluster.json)"
    if [[ -z "$local_host_id" || "$slot_one_host" != "$local_host_id" ]]; then
      # Do not stop a live session during a repair install; only prevent the
      # unassigned legacy slot from returning on the next VM boot.
      systemctl disable alt-pilot.service 2>/dev/null || true
    fi
  elif [[ ! -s /home/mc/slots/1/mcc/SessionCache.db && ! -s /home/mc/slots/1/account.json ]]; then
    systemctl disable alt-pilot.service 2>/dev/null || true
  fi
  # Signed-in accounts retain their prior enabled/stopped choice on repair.
  # Start/Stop in the dashboard manages persistence through the gateway.
  systemctl restart alt-pilot-control.service alt-pilot-watchdog.timer
  # Never substitute a temporary public link for the configured HTTPS endpoint.
  systemctl disable --now alt-pilot-tunnel.service 2>/dev/null || true
  ok "Minecraft service and protected remote control enabled"
else
  systemctl disable --now alt-pilot.service alt-pilot-control.service alt-pilot-tunnel.service 2>/dev/null || true
  systemctl enable --now alt-pilot-watchdog.timer
  rm -f /etc/sudoers.d/alt-pilot-control
  ok "Worker host ready without a duplicate dashboard or tunnel"
fi

# ---------- 6. Summary ----------
section "6/6 Done"
cat <<EOF

Installation complete on this VM.

Manage setup and normal operation from the local Control Center:

  ./app.sh

The terminal fallback was removed: the dashboard handles every account action.

EOF
