#!/usr/bin/env bash
# lib/oci-provision.sh — Oracle Cloud provisioning logic
# - Verifies Always Free eligibility before any create call
# - Detects tenancy, home region, compartment, AD
# - Finds or creates the E2.1.Micro VM with Ubuntu 22.04 minimal
# - Returns the VM's public IP and SSH command

set -Eeuo pipefail
OCI_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$OCI_LIB_DIR/common.sh"

# Silence the "use OCI_API_KEY..." warning that pollutes jq stdin.
export SUPPRESS_LABEL_WARNING="${SUPPRESS_LABEL_WARNING:-True}"

# --- Pre-flight: confirm we are authenticated to OCI ---
require_oci_cli() {
  command -v oci >/dev/null || die "OCI CLI not installed. See https://docs.oracle.com/iaas/Content/SDK/CLI.htm"
  oci iam region list --all 2>/dev/null | jq -e '.data | length > 0' >/dev/null \
    || die "OCI CLI not authenticated. Run: oci setup config (then 'oci setup bootstrap' is NOT needed)"
}

# --- Detect home region from the user's config ---
detect_home_region() {
  local cfg="${OCI_CLI_CONFIG_FILE:-$HOME/.oci/config}"
  local region
  region="$(grep -E '^[[:space:]]*region=' "$cfg" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | tr -d ' ' || true)"
  [[ -n "$region" ]] || die "Could not detect region from $cfg"
  printf '%s' "$region"
}

# --- Detect tenancy OCID from OCI config (also validates auth) ---
detect_tenancy() {
  local cfg="${OCI_CLI_CONFIG_FILE:-$HOME/.oci/config}"
  local tenancy
  tenancy="$(grep -E '^[[:space:]]*tenancy=' "$cfg" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | tr -d ' ' || true)"
  if [[ ! "$tenancy" =~ ^ocid1.tenancy. ]]; then
    die "Could not read tenancy OCID from $cfg"
  fi
  printf '%s' "$tenancy"
}

# --- Detect root compartment (== tenancy for most users) ---
detect_compartment() {
  local tenancy="$1"
  printf '%s' "$tenancy"  # root compartment = tenancy OCID
}

# --- Detect Always-Free-eligible availability domains in the home region ---
# Returns a single AD name, preferring ones that are eligible for E2.1.Micro Always Free.
detect_availability_domain() {
  local compartment="$1" region="$2"
  local ad
  # Try each AD; pick the first one that successfully launches (caller decides).
  ad="$(oci iam availability-domain list --compartment-id "$compartment" --region "$region" \
        | jq -r '.data[0].name // empty')"
  [[ -n "$ad" ]] || die "No availability domains found in $region"
  printf '%s' "$ad"
}

# --- Find an Ubuntu 22.04 minimal x86_64 image marked Always Free eligible ---
# Oracle's image name format dropped the arch suffix for x86. Filter:
#   - starts with "Canonical-Ubuntu-22.04-Minimal"
#   - does NOT contain "aarch64" (those are ARM and won't boot an E2.1.Micro)
find_ubuntu_image() {
  local compartment="$1"
  oci compute image list \
    --compartment-id "$compartment" \
    --all \
    --operating-system "Canonical Ubuntu" \
    --sort-by TIMECREATED --sort-order DESC \
    2>/dev/null \
    | jq -r '
        [.data[]
          | select(.["display-name"] | test("Canonical-Ubuntu-22.04-Minimal"))
          | select(.["display-name"] | test("aarch64") | not)
        ][0].id // empty'
}

# --- Find an existing E2.1.Micro VM, optionally by display-name ---
find_existing_vm() {
  local compartment="$1" name="$2"
  oci compute instance list \
    --compartment-id "$compartment" \
    --all \
    2>/dev/null \
    | jq -r --arg n "$name" --arg shape "VM.Standard.E2.1.Micro" \
        '[(.data // [])
          | .[]
          | select(.shape == $shape)
          | select(.["display-name"] == $n)
          | select(."lifecycle-state" == "RUNNING" or ."lifecycle-state" == "STOPPED")
         ][0].id // empty'
}

# --- Find or create the default VCN + subnet in the home region ---
# Reuse only this application's named network. Never modify an unrelated VCN
# merely because it happens to be first in the tenancy's list.
ensure_subnet() {
  local compartment="$1" region="$2"
  local vcn subnet
  # Send all "ok/info/warn" output to stderr so it doesn't leak into the
  # function's stdout (which the caller captures as the subnet ID).
  vcn="$(oci network vcn list --compartment-id "$compartment" --region "$region" 2>/dev/null \
          | jq -r '[.data[]
                    | select(."lifecycle-state" == "AVAILABLE")
                    | select(.["display-name"] == "afk-vcn")
                  ][0].id // empty')" || die "Could not inspect application networks."
  if [[ -z "$vcn" ]]; then
    info "Creating VCN afk-vcn (Always Free)" >&2
    if ! vcn_out="$(oci network vcn create \
          --compartment-id "$compartment" \
          --cidr-blocks '["10.0.0.0/24"]' \
          --display-name afk-vcn \
          --dns-label afkvcn 2>&1)"; then
      echo "$vcn_out" >&2
      die "Cannot create or find a VCN in region $region. Your VCN quota is full. Delete an unused VCN in the OCI Console (Networking > VCNs) and re-run."
    fi
    vcn="$(echo "$vcn_out" | jq -r '.data.id')"
    ok "Created VCN afk-vcn" >&2
  else
    ok "Reusing existing VCN" >&2
  fi

  # Ensure the VCN has an Internet Gateway and a route rule 0.0.0.0/0 -> IGW.
  # Without this, the launched VM gets a public IP but inbound SSH can't reach
  # it because there's no path from the internet to the subnet.
  local igw rt
  igw="$(oci network internet-gateway list --compartment-id "$compartment" 2>/dev/null \
        | jq -r --arg v "$vcn" '[.data[] | select(.["vcn-id"] == $v and ."is-enabled" == true)][0].id // empty')"
  if [[ -z "$igw" ]]; then
    info "Creating Internet Gateway for VCN" >&2
    igw="$(oci network internet-gateway create \
        --compartment-id "$compartment" --vcn-id "$vcn" \
        --display-name afk-igw --is-enabled true 2>/dev/null \
        | jq -r '.data.id')" || die "Could not create IGW"
    ok "Created IGW" >&2
  else
    ok "Reusing existing IGW" >&2
  fi

  # Update the VCN's default route table to route 0.0.0.0/0 -> IGW.
  rt="$(oci network route-table list --compartment-id "$compartment" 2>/dev/null \
        | jq -r --arg v "$vcn" '[.data[]
              | select(.["vcn-id"] == $v)
              | select(."display-name" | startswith("Default"))
            ][0].id // empty')"
  if [[ -n "$rt" ]]; then
    local has_default
    has_default="$(oci network route-table get --rt-id "$rt" 2>/dev/null \
      | jq -r --arg igw "$igw" '.data."route-rules"[] | select(.destination == "0.0.0.0/0" and ."network-entity-id" == $igw) | .destination')"
    if [[ -z "$has_default" ]]; then
      info "Adding default route 0.0.0.0/0 -> IGW" >&2
      oci network route-table update --rt-id "$rt" \
        --route-rules "$(oci network route-table get --rt-id "$rt" | jq --arg igw "$igw" '(.data["route-rules"] | map({destination: .destination, destinationType: .["destination-type"], networkEntityId: .["network-entity-id"]} + (if .description != null then {description: .description} else {} end))) + [{destination:"0.0.0.0/0", destinationType:"CIDR_BLOCK", networkEntityId:$igw}]')" \
        --force >/dev/null 2>&1 || die "Could not configure the application network route."
      ok "Route added" >&2
    else
      ok "Route already present" >&2
    fi
  fi
  subnet="$(oci network subnet list --compartment-id "$compartment" 2>/dev/null \
            | jq -r --arg v "$vcn" '[.data[] | select(.["vcn-id"] == $v)][0].id // empty')"
  if [[ -z "$subnet" ]]; then
    info "Creating subnet in VCN" >&2
    subnet="$(oci network subnet create \
        --compartment-id "$compartment" \
        --vcn-id "$vcn" \
        --cidr-block "10.0.0.0/24" \
        --display-name afk-subnet \
        --dns-label afksubnet 2>/dev/null \
        | jq -r '.data.id')" || die "Could not create subnet in VCN"
  fi
  # CRITICAL: only the subnet ID on stdout, everything else to stderr.
  printf '%s' "$subnet"
}

# --- Launch a new E2.1.Micro instance ---
# Always Free verification happens BEFORE launch.
launch_vm() {
  local compartment="$1" ad="$2" subnet="$3" image="$4" name="$5" ssh_key="$6"
  info "Launching VM $name (shape VM.Standard.E2.1.Micro, Always Free)"
  # NO --boot-volume-size-in-gbs here. The CLI flag requires min 50 GB.
  # The E2.1.Micro Always Free shape defaults to 47 GB; that's what we want.
  oci compute instance launch \
    --availability-domain "$ad" \
    --compartment-id "$compartment" \
    --display-name "$name" \
    --shape "VM.Standard.E2.1.Micro" \
    --image-id "$image" \
    --subnet-id "$subnet" \
    --assign-public-ip true \
    --metadata "{\"ssh_authorized_keys\":\"$(cat "$ssh_key" | sed 's/[\/&]/\\&/g')\"}" \
    | jq -r '.data.id // (.data["id"] // empty)'
}

# --- Wait until the VM is RUNNING and has a public IP ---
wait_for_vm() {
  local compartment="$1" vm_id="$2"
  local state="" pub_ip=""
  for _ in $(seq 1 60); do
    state="$(oci compute instance get --instance-id "$vm_id" 2>/dev/null | jq -r '.data."lifecycle-state"')"
    if [[ "$state" == "RUNNING" ]]; then
      pub_ip="$(oci compute instance list-vnics --instance-id "$vm_id" \
                | jq -r '[.data[] | select(."is-primary" == true)][0]."public-ip" // empty')"
      [[ -n "$pub_ip" ]] && { printf '%s' "$pub_ip"; return 0; }
    fi
    sleep 5
  done
  return 1
}

# --- Verify a candidate VM is Always Free eligible BEFORE we ever use it ---
# mode: "apply" enforces the 2-instance quota; "repair" only validates storage
# (a repair never creates an instance, so the quota is irrelevant).
verify_always_free() {
  local compartment="$1" reusable_id="${2:-}" mode="${3:-apply}"
  local used volume_json boot_json volume_gb boot_gb total_gb
  used="$(oci compute instance list --compartment-id "$compartment" --all \
          2>/dev/null \
          | jq -r '[(.data // [])
                    | .[]
                    | select(.shape == "VM.Standard.E2.1.Micro")
                    | select(."lifecycle-state" == "RUNNING" or ."lifecycle-state" == "STOPPED")
                  ] | length // 0' 2>/dev/null)"
  used="${used:-0}"
  [[ "$used" =~ ^[0-9]+$ ]] || die "Could not verify existing instance usage."
  if [[ "$used" -ge 2 && -z "$reusable_id" && "$mode" != "repair" ]]; then
    die "You already have $used VM.Standard.E2.1.Micro instances (Always Free allows 2). Not creating another."
  fi
  if [[ -n "$reusable_id" ]]; then
    local shape state
    shape="$(oci compute instance get --instance-id "$reusable_id" 2>/dev/null | jq -r '.data.shape // empty')"
    state="$(oci compute instance get --instance-id "$reusable_id" 2>/dev/null | jq -r '.data."lifecycle-state" // empty')"
    [[ "$shape" == "VM.Standard.E2.1.Micro" ]] || die "Existing VM is not the Always Free E2.1.Micro shape."
    ok "Existing Always Free VM is reusable ($state); no new instance needed"
  else
    ok "Always Free E2.1.Micro usage: $used/2 (one slot available)"
  fi

  # Oracle's 200 GB Always Free allowance is shared by boot and block volumes.
  # Refuse a new instance if its 47 GB minimum boot volume would exceed it.
  volume_json="$(oci bv volume list --compartment-id "$compartment" --all 2>/dev/null)" || die "Could not verify block volume usage."
  boot_json="$(oci bv boot-volume list --compartment-id "$compartment" --all 2>/dev/null)" || die "Could not verify boot volume usage."
  volume_gb="$(printf '%s' "$volume_json" | jq '[.data[] | select(."lifecycle-state" != "TERMINATED") | ."size-in-gbs"] | add // 0')"
  boot_gb="$(printf '%s' "$boot_json" | jq '[.data[] | select(."lifecycle-state" != "TERMINATED") | ."size-in-gbs"] | add // 0')"
  total_gb=$((volume_gb + boot_gb))
  if [[ "$mode" != "repair" && -z "$reusable_id" && $((total_gb + 47)) -gt 200 ]]; then
    die "Block storage is ${total_gb} GB; adding the 47 GB boot volume would exceed the 200 GB Always Free allowance."
  fi
  ok "Always Free block storage: ${total_gb}/200 GB$([[ -z "$reusable_id" ]] && printf ' (47 GB planned)' || true)"
}
