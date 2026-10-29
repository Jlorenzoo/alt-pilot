#!/usr/bin/env bash
# setup-afk.sh — single entrypoint.
# Runs LOCALLY on the operator's machine.
# Requires: OCI CLI authenticated, ssh, jq.
#
# Flags:
#   --dry-run             Detect and report; never create or configure.
#   --apply               Provision if necessary, then configure the VM.
#   --configure-existing  Configure only the recorded/named existing VM.
#
# Flow:
#   1. Verify OCI CLI auth
#   2. Detect region / tenancy / compartment / AD
#   3. Verify Always Free allowance
#   4. Reuse an existing E2.1.Micro named "alt-pilot" or launch a new one
#   5. Wait for SSH, push setup scripts
#   6. SSH into VM, run setup-vm.sh
#   7. Hand off to the user for the one-time Microsoft auth

set -Eeuo pipefail
SETUP_AFK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SETUP_AFK_DIR/lib/common.sh"

DRY_RUN=0
APPLY=0
CONFIGURE_EXISTING=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --apply) APPLY=1 ;;
    --configure-existing) CONFIGURE_EXISTING=1 ;;
    -h|--help)
      cat <<EOF
Usage: $0 --dry-run | --apply | --configure-existing

  --dry-run   Detect Oracle tenancy, region, AD, and check Always Free quota.
              Do NOT create or modify any Oracle resource. Exit with summary.
  --apply     Create a VM only when no matching VM exists, then configure it.
  --configure-existing
              Never create cloud resources; repair/configure an existing VM.

This script provisions an Always Free VM.Standard.E2.1.Micro (Ubuntu 22.04 minimal),
configures it for a headless Minecraft Java 1.12.2 AFK client connecting to
Complex Gaming (hub.mc-complex.com), and hands off to the user for one-time
Microsoft device-code authentication.

After setup finishes on the VM, see README.md for the auth step.
EOF
      exit 0 ;;
    *) die "Unknown flag: $arg" ;;
  esac
done

if [[ "$DRY_RUN" -eq 0 && "$APPLY" -eq 0 && "$CONFIGURE_EXISTING" -eq 0 ]]; then
  die "Choose an explicit mode: --dry-run, --apply, or --configure-existing"
fi
if [[ $((DRY_RUN + APPLY + CONFIGURE_EXISTING)) -ne 1 ]]; then
  die "Choose exactly one mode."
fi

if [[ -z "${SSH_KEY:-}" ]]; then
  if [[ -f "$HOME/.ssh/id_ed25519.pub" ]]; then
    SSH_KEY="$HOME/.ssh/id_ed25519.pub"
  elif [[ -f "$HOME/.ssh/id_rsa.pub" ]]; then
    SSH_KEY="$HOME/.ssh/id_rsa.pub"
  else
    SSH_KEY="$HOME/.ssh/id_ed25519.pub"
  fi
fi
STATE_DIR="$SETUP_AFK_DIR/.state"
mkdir -p -m 700 "$STATE_DIR"
chmod 700 "$STATE_DIR"
STATE_FILE="$STATE_DIR/vm.json"

section "Pre-flight"
command -v oci >/dev/null || die "Install OCI CLI first."
command -v jq >/dev/null || die "Install jq."
command -v ssh >/dev/null || die "Install ssh."
[[ -f "$SSH_KEY" ]] || { info "Generating SSH keypair"; mkdir -p "${SSH_KEY%/*}"; ssh-keygen -t ed25519 -N "" -f "${SSH_KEY%.pub}"; }

# shellcheck disable=SC1091
source "$SETUP_AFK_DIR/lib/oci-provision.sh"
require_oci_cli

section "Detecting Oracle Cloud environment"
REGION="$(detect_home_region)"
TENANCY="$(detect_tenancy)"
COMPARTMENT="$(detect_compartment "$TENANCY")"
AD="$(detect_availability_domain "$COMPARTMENT" "$REGION")"
ok "Region:       $REGION"
ok "Tenancy:      ${TENANCY##*.*.}"
ok "Compartment:  root"
ok "Availability: $AD"

section "Verifying Always Free allowance"
EXISTING="$(find_existing_vm "$COMPARTMENT" "$VM_NAME" || true)"
VERIFY_MODE=apply
[[ "$CONFIGURE_EXISTING" -eq 1 ]] && VERIFY_MODE=repair
verify_always_free "$COMPARTMENT" "$EXISTING" "$VERIFY_MODE"

if [[ "$DRY_RUN" -eq 1 ]]; then
  section "Dry run — stopping before any create"
  IMAGE_ID="$(find_ubuntu_image "$COMPARTMENT")"
  ok "Would use image:  $IMAGE_ID"
  if [[ -n "$EXISTING" ]]; then
    ok "Would reuse existing VM: $EXISTING"
  else
    ok "Would create new VM:    $VM_NAME"
  fi
  cat <<EOF

DRY RUN OK.

No resources created. Re-run with --apply to provision/configure, or use
--configure-existing to repair the VM without allowing cloud creation.

Always Free verification:
  - Shape:            VM.Standard.E2.1.Micro (Always Free)
  - Image:            Canonical-Ubuntu-22.04-Minimal (Always Free eligible)
  - Boot volume:      47 GB default (Always Free: 200 GB total per tenancy)
  - Public IP:        ephemeral, free
  - VCN + subnet:     reused when possible; no load balancer or NAT gateway
  - Security list:    SSH (22) inbound only, all outbound
  - No paid upgrade:  none of --shape-config, --boot-volume-size-in-gbs > 47,
                       or paid Marketplace image is used.

EOF
  exit 0
fi

# Try to reuse an existing matching VM.
if [[ -n "$EXISTING" ]]; then
  ok "Found existing VM '$VM_NAME': $EXISTING"
  VM_ID="$EXISTING"
else
  if [[ "$CONFIGURE_EXISTING" -eq 1 ]]; then
    AVAILABLE="$(oci compute instance list --compartment-id "$COMPARTMENT" --all 2>/dev/null \
      | jq -r '.data[] | select(.shape=="VM.Standard.E2.1.Micro") | .["display-name"]' \
      | paste -sd, -)"
    if [[ -n "$AVAILABLE" ]]; then
      die "No existing E2.1.Micro named '$VM_NAME' was found. E2.1.Micro VMs in this compartment: $AVAILABLE. Re-run with VM_NAME=<name> set, or rename one to '$VM_NAME'."
    else
      die "No existing E2.1.Micro named '$VM_NAME' was found. No resource was created."
    fi
  fi
  section "Provisioning E2.1.Micro (Always Free)"
  IMAGE="$(find_ubuntu_image "$COMPARTMENT")"
  SUBNET="$(ensure_subnet "$COMPARTMENT" "$REGION")"
  VM_ID="$(launch_vm "$COMPARTMENT" "$AD" "$SUBNET" "$IMAGE" "$VM_NAME" "$SSH_KEY")"
  ok "Launched VM: $VM_ID"
fi

section "Waiting for public IP + SSH"
PUB_IP="$(wait_for_vm "$COMPARTMENT" "$VM_ID")" || die "VM did not become reachable"
ok "Public IP: $PUB_IP"
jq -n --arg ip "$PUB_IP" --arg id "$VM_ID" --arg region "$REGION" \
   '{public_ip:$ip, instance_id:$id, region:$region}' > "$STATE_FILE"
chmod 600 "$STATE_FILE"

# SSH wait loop
SSH_READY=0
for _ in $(seq 1 30); do
  if ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=5 \
       -o IdentityFile="${SSH_KEY%.pub}" \
       "ubuntu@$PUB_IP" true 2>/dev/null; then
    ok "SSH reachable as ubuntu@$PUB_IP"
    SSH_READY=1
    break
  fi
  sleep 5
done
[[ "$SSH_READY" -eq 1 ]] || die "VM is running, but SSH did not become reachable within 150 seconds."

section "Pushing scripts to VM"
REMOTE_STAGE="$(ssh -o StrictHostKeyChecking=yes -o IdentityFile="${SSH_KEY%.pub}" \
  "ubuntu@$PUB_IP" 'mktemp -d /tmp/alt-pilot-setup.XXXXXXXX')"
[[ "$REMOTE_STAGE" =~ ^/tmp/alt-pilot-setup\.[A-Za-z0-9]+$ ]] || die "Invalid remote staging directory."
RSYNC_SSH="ssh -o StrictHostKeyChecking=yes -o IdentityFile=${SSH_KEY%.pub}"
if ssh -o StrictHostKeyChecking=yes -o IdentityFile="${SSH_KEY%.pub}" \
     "ubuntu@$PUB_IP" 'command -v rsync >/dev/null 2>&1'; then
  rsync -az -e "$RSYNC_SSH" --delete \
    --exclude .git --exclude .state --exclude __pycache__ --exclude node_modules \
    --exclude storage --exclude docs --exclude '.env*' --exclude '*.pem' --exclude '*.key' \
    "$SETUP_AFK_DIR/" "ubuntu@$PUB_IP:$REMOTE_STAGE/" || die "rsync failed"
else
  info "Remote rsync is unavailable; using the built-in tar-over-SSH transfer"
  tar -C "$SETUP_AFK_DIR" \
    --exclude=.git --exclude=.state --exclude=__pycache__ --exclude=node_modules \
    --exclude=storage --exclude=docs --exclude='.env*' --exclude='*.pem' --exclude='*.key' \
    -czf - . \
    | ssh -o StrictHostKeyChecking=yes -o IdentityFile="${SSH_KEY%.pub}" \
        "ubuntu@$PUB_IP" "tar -xzf - -C '$REMOTE_STAGE'" \
    || die "SSH file transfer failed"
fi

section "Running setup-vm.sh on VM"
ssh -o StrictHostKeyChecking=yes -o IdentityFile="${SSH_KEY%.pub}" \
    "ubuntu@$PUB_IP" "sudo -n bash '$REMOTE_STAGE/vm/setup-vm.sh' && rm -rf '$REMOTE_STAGE'" || die "setup-vm.sh failed"

section "Recording protected remote access"
REMOTE_ACCESS_FILE="$STATE_DIR/remote-access.json"
REMOTE_PASSWORD=""
if ssh -o BatchMode=yes -o IdentityFile="${SSH_KEY%.pub}" "ubuntu@$PUB_IP" \
     'sudo -n test -s /opt/alt-pilot/initial-control-password'; then
  REMOTE_PASSWORD="$(ssh -o BatchMode=yes -o IdentityFile="${SSH_KEY%.pub}" "ubuntu@$PUB_IP" \
    'sudo -n cat /opt/alt-pilot/initial-control-password')"
fi

REMOTE_URL=""
REMOTE_TEMPORARY=true
REMOTE_URL="$(ssh -o BatchMode=yes -o IdentityFile="${SSH_KEY%.pub}" "ubuntu@$PUB_IP" \
  'tailscale funnel status --json 2>/dev/null | jq -r '\''(.Web // {}) | to_entries | map(select(.value.Handlers // {} | to_entries | any(.value.Proxy == "http://127.0.0.1:8765"))) | first | .key // empty'\''' \
  | sed -E 's/:443$//' || true)"
if [[ -n "$REMOTE_URL" ]]; then
  REMOTE_URL="https://$REMOTE_URL"
  REMOTE_TEMPORARY=false
fi
for _ in $(seq 1 30); do
  [[ -n "$REMOTE_URL" ]] && break
  REMOTE_URL="$(ssh -o BatchMode=yes -o IdentityFile="${SSH_KEY%.pub}" "ubuntu@$PUB_IP" \
    'invocation=$(systemctl show alt-pilot-tunnel.service -p InvocationID --value); sudo -n journalctl "_SYSTEMD_INVOCATION_ID=$invocation" --no-pager 2>/dev/null' \
    | grep -Eo 'https://[-a-z0-9]+\.trycloudflare\.com' | tail -1 || true)"
  [[ -n "$REMOTE_URL" ]] && break
  sleep 2
done

if [[ -n "$REMOTE_PASSWORD" ]]; then
  jq -n --arg url "$REMOTE_URL" --arg password "$REMOTE_PASSWORD" --argjson temporary "$REMOTE_TEMPORARY" \
    '{url:$url, username:"control", password:$password, temporary_url:$temporary}' > "$REMOTE_ACCESS_FILE"
  chmod 600 "$REMOTE_ACCESS_FILE"
  ssh -o BatchMode=yes -o IdentityFile="${SSH_KEY%.pub}" "ubuntu@$PUB_IP" \
    'sudo -n shred -u /opt/alt-pilot/initial-control-password' || true
  ok "Saved the one-time generated control password to $REMOTE_ACCESS_FILE"
elif [[ -f "$REMOTE_ACCESS_FILE" && -n "$REMOTE_URL" ]]; then
  jq --arg url "$REMOTE_URL" --argjson temporary "$REMOTE_TEMPORARY" '.url=$url | .temporary_url=$temporary' "$REMOTE_ACCESS_FILE" > "$REMOTE_ACCESS_FILE.tmp"
  mv "$REMOTE_ACCESS_FILE.tmp" "$REMOTE_ACCESS_FILE"
  chmod 600 "$REMOTE_ACCESS_FILE"
fi
[[ -n "$REMOTE_URL" ]] && ok "Remote control URL: $REMOTE_URL" \
  || warn "The remote control URL was not ready yet; check Tailscale or tunnel service status."

# Backup client state to the VM so client computers can run ./install.sh <IP>
tar -C "$SETUP_AFK_DIR" -czf - .state \
  | ssh -o BatchMode=yes -o IdentityFile="${SSH_KEY%.pub}" "ubuntu@$PUB_IP" \
      'sudo -n sh -c "cat > /etc/alt-pilot/client-state.tar.gz && chmod 600 /etc/alt-pilot/client-state.tar.gz"' 2>/dev/null || true

section "Hand-off"
cat <<EOF

================================================================
 ALT PILOT IS READY! — Public IP: $PUB_IP
================================================================

TWO WAYS TO USE YOUR DASHBOARD:

1. 🖥️ LOCAL DESKTOP APP (Permanent URL — Just like my app):
   Run on your own PC/laptop:
     git clone https://github.com/Jlorenzoo/alt-pilot.git
     cd alt-pilot
     ./install.sh $PUB_IP
     ./app.sh

   Permanent local address: http://127.0.0.1:8765/
   (Optional: run ./install-desktop.sh to add the grass-block desktop launcher)

2. 🌐 CLOUD REMOTE ACCESS (Direct via Phone or Web Browser):
   URL:      ${REMOTE_URL:-(tunnel starting, run 'afk-url' in 10s)}
   Username: control
   Password: ${REMOTE_PASSWORD:-Check $REMOTE_ACCESS_FILE}

Save these credentials! You can change your password anytime in
the dashboard under Settings -> Security.

To connect your Minecraft account:
1. Open either URL in your browser.
2. Sign in with username 'control' and the password above (or zero-login on local app).
3. Click "Add Account" and sign in with Microsoft (https://microsoft.com/link).
4. Enter your Minecraft server address and click Start.
   Once connected, your alt runs 24/7 in the cloud!

Lost your URL later?
- In Cloud Shell or SSH: run 'afk-url'
- Credentials saved locally: $REMOTE_ACCESS_FILE
================================================================
EOF

