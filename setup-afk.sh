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

VM_NAME="${VM_NAME:-alt-pilot}"
[[ "$VM_NAME" =~ ^[a-z][a-z0-9-]{0,30}$ ]] || die "Choose a lowercase VM name with letters, digits and hyphens (maximum 31 characters)."
umask 077
AFK_REMOTE_ACCESS="${AFK_REMOTE_ACCESS:-ip}"
[[ "$AFK_REMOTE_ACCESS" == ip || "$AFK_REMOTE_ACCESS" == funnel ]] || die "Choose ip or funnel for remote access."
export AFK_REMOTE_ACCESS
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
exec 8>"$STATE_DIR/provision.lock"
flock -n 8 || die "Setup is already running. Keep that Cloud Shell window open and wait for it to finish."

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
export OCI_CLI_REGION="$REGION"
TENANCY="$(detect_tenancy)"
COMPARTMENT="$(detect_compartment "$TENANCY")"
AD="$(detect_availability_domain "$COMPARTMENT" "$REGION")"
ok "Region:       $REGION"
ok "Tenancy:      ${TENANCY##*.*.}"
ok "Compartment:  root"
ok "Availability: $AD"

section "Verifying Always Free allowance"
EXISTING=""
if [[ -s "$STATE_FILE" ]]; then
  saved_tenancy="$(jq -r '.tenancy // empty' "$STATE_FILE")"
  [[ -z "$saved_tenancy" || "$saved_tenancy" == "$TENANCY" ]] || die "This saved installation belongs to a different Oracle account. No server was changed."
  recorded="$(jq -r '.instance_id // empty' "$STATE_FILE")"
  if [[ -n "$recorded" ]]; then
    instance="$(oci compute instance get --instance-id "$recorded")" || die "Cannot check your saved VM. No replacement will be created."
    [[ "$(jq -r '.data.shape' <<< "$instance")" == VM.Standard.E2.1.Micro ]] || die "Saved VM has an unexpected shape."
    state="$(jq -r '.data["lifecycle-state"]' <<< "$instance")"
    [[ "$state" != TERMINATED && "$state" != TERMINATING ]] || die "Your saved VM was removed. Keep its state file until you deliberately begin a new installation."
    EXISTING="$recorded"
  fi
fi
[[ -n "$EXISTING" ]] || EXISTING="$(find_existing_vm "$COMPARTMENT" "$VM_NAME")"
VERIFY_MODE=apply
[[ "$CONFIGURE_EXISTING" -eq 1 ]] && VERIFY_MODE=repair
verify_always_free "$COMPARTMENT" "$EXISTING" "$VERIFY_MODE"

if [[ "$DRY_RUN" -eq 1 ]]; then
  section "Dry run — stopping before any create"
  IMAGE_ID="$(find_ubuntu_image "$COMPARTMENT")"
  [[ -n "$IMAGE_ID" ]] || die "Oracle has no supported Ubuntu image available. No resources were created."
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
  - Boot volume:      50 GB default (Always Free: 200 GB total per tenancy)
  - Public IP:        ephemeral, free
  - VCN + subnet:     reused when possible; no load balancer or NAT gateway
  - Security list:    SSH (22) from this Cloud Shell; web HTTPS (443) and validation/redirects (80) for IP mode
  - No paid upgrade:  none of --shape-config, --boot-volume-size-in-gbs > 50,
                       or paid Marketplace image is used.

EOF
  exit 0
fi

if [[ -z "${SSH_SOURCE_CIDR:-}" ]]; then
  SSH_SOURCE_CIDR="$(curl --connect-timeout 10 --max-time 20 -fsS https://api.ipify.org | python3 -c 'import ipaddress,sys; ip=ipaddress.IPv4Address(sys.stdin.read().strip()); ip.is_global or sys.exit(1); print(str(ip)+"/32")')" || die "Cannot identify this Cloud Shell address. Check its internet access and run the installer again."
fi
export SSH_SOURCE_CIDR

# Try to reuse an existing matching VM.
if [[ -n "$EXISTING" ]]; then
  ok "Found existing VM '$VM_NAME': $EXISTING"
  VM_ID="$EXISTING"
  # Refresh the app-owned network's SSH source after a new Cloud Shell session.
  refresh_ssh_access "$COMPARTMENT" "$VM_ID"
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
  [[ "$IMAGE" == ocid1.image.* ]] || die "Oracle has no supported Ubuntu image available. No resources were created."
  SUBNET="$(ensure_subnet "$COMPARTMENT" "$REGION")"
  VM_ID="$(launch_vm "$COMPARTMENT" "$AD" "$SUBNET" "$IMAGE" "$VM_NAME" "$SSH_KEY")"
  [[ "$VM_ID" == ocid1.instance.* ]] || die "Oracle did not return a VM identifier. No further setup was attempted."
  # Save immediately: a later SSH or sign-in interruption must not create a duplicate.
  jq -n --arg id "$VM_ID" --arg region "$REGION" --arg tenant "$TENANCY" '{instance_id:$id,region:$region,tenancy:$tenant}' > "$STATE_FILE"
  chmod 600 "$STATE_FILE"
  ok "Your cloud computer has been created."
fi

section "Waiting for your cloud computer to start"
vm_state="$(oci compute instance get --instance-id "$VM_ID" --query 'data."lifecycle-state"' --raw-output)"
if [[ "$vm_state" == STOPPED ]]; then
  oci compute instance action --instance-id "$VM_ID" --action START >/dev/null
fi
PUB_IP="$(wait_for_vm "$COMPARTMENT" "$VM_ID")" || die "VM did not become reachable"
python3 - "$PUB_IP" <<'IPCHECK'
import ipaddress,sys
ipaddress.IPv4Address(sys.argv[1])
IPCHECK
ok "Your cloud computer is online."
jq -n --arg ip "$PUB_IP" --arg id "$VM_ID" --arg region "$REGION" --arg tenant "$TENANCY" \
   '{public_ip:$ip, instance_id:$id, region:$region, tenancy:$tenant}' > "$STATE_FILE"
chmod 600 "$STATE_FILE"

# SSH wait loop
SSH_READY=0
for _ in $(seq 1 60); do
  if ssh -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=5 \
       -o IdentityFile="${SSH_KEY%.pub}" \
       "ubuntu@$PUB_IP" true 2>/dev/null; then
    ok "SSH reachable as ubuntu@$PUB_IP"
    SSH_READY=1
    break
  fi
  sleep 5
done
[[ "$SSH_READY" -eq 1 ]] || die "VM is running, but SSH did not become reachable yet. Wait a few minutes, then run the same installer again."

section "Preparing Java, Bedrock and your dashboard"
ssh -o IdentitiesOnly=yes -o BatchMode=yes -o IdentityFile="${SSH_KEY%.pub}" "ubuntu@$PUB_IP" 'sudo cloud-init status --wait' || die "Ubuntu is not ready yet. Run the same installer again in a few minutes."
section "Copying the application securely"
REMOTE_STAGE="$(ssh -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o IdentityFile="${SSH_KEY%.pub}" \
  "ubuntu@$PUB_IP" 'mktemp -d /tmp/alt-pilot-setup.XXXXXXXX')"
[[ "$REMOTE_STAGE" =~ ^/tmp/alt-pilot-setup\.[A-Za-z0-9]+$ ]] || die "Invalid remote staging directory."
# Tar-over-SSH works in Cloud Shell without rsync or quoting a shell command
# around the private-key path. Local state/dependencies are never transferred.
tar -C "$SETUP_AFK_DIR" \
  --exclude=.git --exclude=.state --exclude=__pycache__ --exclude=node_modules \
  --exclude=storage --exclude=docs --exclude='.env*' --exclude='*.pem' --exclude='*.key' \
  -czf - . \
  | ssh -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o IdentityFile="${SSH_KEY%.pub}" \
      "ubuntu@$PUB_IP" "tar -xzf - -C '$REMOTE_STAGE'" \
  || die "Secure copy was interrupted. Run the same installer again to continue."

section "Running setup-vm.sh on VM"
ssh -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o IdentityFile="${SSH_KEY%.pub}" \
    "ubuntu@$PUB_IP" "sudo -n env AFK_REMOTE_ACCESS='$AFK_REMOTE_ACCESS' AFK_PUBLIC_IP='$PUB_IP' bash '$REMOTE_STAGE/vm/setup-vm.sh' && rm -rf '$REMOTE_STAGE'" || die "setup-vm.sh failed"

section "Checking your dashboard"
ssh -o IdentitiesOnly=yes -o BatchMode=yes -o IdentityFile="${SSH_KEY%.pub}" "ubuntu@$PUB_IP" \
  'sudo systemctl is-active --quiet alt-pilot-control.service && curl --retry 10 --retry-connrefused --retry-delay 2 -fsS http://127.0.0.1:8765/login >/dev/null' \
  || die "Your dashboard did not start correctly. Your VM is saved; run the installer again to repair it."

section "Setting up your permanent dashboard link"
if [[ "$AFK_REMOTE_ACCESS" == funnel ]]; then
cat <<'GUIDE'
We now connect your server to your own free Tailscale account.
1. Open the sign-in link printed below in a new browser tab.
2. Sign in (or create a free account) and approve this server.
3. Return here. Setup continues automatically after approval.
GUIDE
if ! ssh -o IdentitiesOnly=yes -o BatchMode=yes -o IdentityFile="${SSH_KEY%.pub}" "ubuntu@$PUB_IP" 'sudo tailscale status --json' | jq -e '.BackendState == "Running"' >/dev/null; then
  ssh -tt -o IdentitiesOnly=yes -o IdentityFile="${SSH_KEY%.pub}" "ubuntu@$PUB_IP" \
    "sudo tailscale up --hostname='$VM_NAME' --accept-dns=false --timeout=15m" \
    || die "Tailscale sign-in is not complete. Run the same installer again to continue."
fi
cat <<'GUIDE'
Next we enable the HTTPS dashboard address. If Tailscale prints an approval
link, open it, enable HTTPS/Funnel, and return here. This does not require
buying a domain or installing software on your own computer.
GUIDE
ssh -tt -o IdentitiesOnly=yes -o IdentityFile="${SSH_KEY%.pub}" "ubuntu@$PUB_IP" \
  'sudo tailscale funnel --bg --yes --https=443 http://127.0.0.1:8765' \
  || die "The permanent link still needs Tailscale approval. Run the same installer again after approving it."
REMOTE_URL="$(ssh -o IdentitiesOnly=yes -o BatchMode=yes -o IdentityFile="${SSH_KEY%.pub}" "ubuntu@$PUB_IP" 'sudo /usr/local/bin/afk-url --raw')"
[[ "$REMOTE_URL" =~ ^https://[a-z0-9.-]+\.ts\.net/?$ ]] || die "The stable HTTPS link is not ready. No temporary address was substituted."
else
  REMOTE_URL="https://$PUB_IP"
  echo "Your bookmark address is $REMOTE_URL. We are checking its automatic HTTPS certificate."
fi
# Check the real public endpoint, including DNS/certificate readiness.
LINK_READY=0
for _ in $(seq 1 12); do
  if curl --connect-timeout 10 --max-time 20 -fsS "$REMOTE_URL/login" >/dev/null; then LINK_READY=1; break; fi
  echo "Waiting for your HTTPS address to become available..."
  sleep 5
 done
[[ "$LINK_READY" == 1 ]] || die "Your permanent address is saved but its DNS/certificate is not ready. Run the installer again shortly."

section "Saving your private access details"
REMOTE_ACCESS_FILE="$STATE_DIR/remote-access.json"
REMOTE_PASSWORD=""
if [[ "${AFK_RESET_PASSWORD:-0}" == 1 ]]; then
  REMOTE_PASSWORD="$(python3 -c 'import secrets; print(secrets.token_urlsafe(24))')"
  printf '%s' "$REMOTE_PASSWORD" | ssh -o IdentitiesOnly=yes -o BatchMode=yes -o IdentityFile="${SSH_KEY%.pub}" "ubuntu@$PUB_IP" \
    'sudo -n -u afk-control /usr/bin/python3 /opt/alt-pilot/control/remote_control.py --set-password-stdin && sudo -n systemctl restart alt-pilot-control.service'
fi
if ssh -o IdentitiesOnly=yes -o BatchMode=yes -o IdentityFile="${SSH_KEY%.pub}" "ubuntu@$PUB_IP" 'sudo -n test -s /opt/alt-pilot/initial-control-password'; then
  REMOTE_PASSWORD="$(ssh -o IdentitiesOnly=yes -o BatchMode=yes -o IdentityFile="${SSH_KEY%.pub}" "ubuntu@$PUB_IP" 'sudo -n cat /opt/alt-pilot/initial-control-password')"
fi
jq -n --arg url "$REMOTE_URL" --arg password "$REMOTE_PASSWORD" '{url:$url,username:"control",password:$password,temporary_url:false}' > "$REMOTE_ACCESS_FILE"
chmod 600 "$REMOTE_ACCESS_FILE"
ssh -o IdentitiesOnly=yes -o BatchMode=yes -o IdentityFile="${SSH_KEY%.pub}" "ubuntu@$PUB_IP" 'sudo -n rm -f /opt/alt-pilot/initial-control-password'
# Store a connection-only export. Never upload the Cloud Shell private SSH key.
jq -n --arg ip "$PUB_IP" --arg id "$VM_ID" --arg region "$REGION" '{public_ip:$ip,instance_id:$id,region:$region}' > "$STATE_DIR/client-vm.json"
tar -C "$STATE_DIR" --transform='s|^client-vm.json$|.state/vm.json|' -czf - client-vm.json \
  | ssh -o IdentitiesOnly=yes -o BatchMode=yes -o IdentityFile="${SSH_KEY%.pub}" "ubuntu@$PUB_IP" 'sudo -n sh -c "umask 077; cat > /etc/alt-pilot/client-state.tar.gz"'
rm -f "$STATE_DIR/client-vm.json"
cat <<EOF

===============================================================
YOUR CLOUD COMPUTER, JAVA, BEDROCK AND DASHBOARD ARE READY

Open this address in your browser:
  $REMOTE_URL

Initial dashboard password:
  ${REMOTE_PASSWORD:-(Use the password you already set in Settings.)}

Then:
  1. Change the initial password in Settings.
  2. Select Add account, then Java, Bedrock or Both.
  3. Follow the Microsoft sign-in link and enter the displayed code.
  4. Choose your Minecraft server and click Start.
  5. Wait for Connected. You can then close Cloud Shell and turn off your PC.

Your address stays the same across VM restarts and stops. Bookmark it.
Do not delete the VM or detach its network address if you want to keep it.
HTTPS certificates renew automatically while the server is running.

Lost the address? In Cloud Shell run:
  ~/alt-pilot/setup-cloudshell.sh --status
Need a repair? Run the original install command again.
===============================================================
EOF

if [[ "$AFK_REMOTE_ACCESS" == funnel ]]; then
  echo "For unattended Tailscale use, disable this server's key expiration at https://login.tailscale.com/admin/machines"
fi
