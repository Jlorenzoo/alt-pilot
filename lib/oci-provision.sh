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
  python3 "$OCI_LIB_DIR/../tools/oci_environment.py" home
}

detect_tenancy() {
  python3 "$OCI_LIB_DIR/../tools/oci_environment.py" identity | jq -er .tenancy
}

# --- Detect root compartment (== tenancy for most users) ---
detect_compartment() {
  local tenancy="$1"
  printf '%s' "$tenancy"  # root compartment = tenancy OCID
}

# --- Detect Always-Free-eligible availability domains in the home region ---
# Returns a single AD name, preferring ones that are eligible for E2.1.Micro Always Free.
detect_availability_domain() {
  local compartment="$1" region="$2" ad
  local domains
  domains="$(oci iam availability-domain list --compartment-id "$compartment" --region "$region" --all | jq -er '.data[].name')"
  while IFS= read -r ad; do
    if oci compute shape list --compartment-id "$compartment" --region "$region" --availability-domain "$ad" --all \
        | jq -e '.data | any(.shape == "VM.Standard.E2.1.Micro")' >/dev/null; then
      printf '%s' "$ad"
      return
    fi
  done <<< "$domains"
  die "Oracle has no E2 Micro shape available in your home region. No paid shape will be substituted."
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
    --shape "VM.Standard.E2.1.Micro" \
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
          | select(.["freeform-tags"]["alt-pilot"] == "managed")
          | select(."lifecycle-state" != "TERMINATED" and ."lifecycle-state" != "TERMINATING")
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
                    | select(.["display-name"] == "alt-pilot-vcn")
                    | select(.["freeform-tags"]["alt-pilot"] == "managed")
                  ][0].id // empty')" || die "Could not inspect application networks."
  if [[ -z "$vcn" ]]; then
    info "Creating your dedicated ALT Pilot network (Always Free)" >&2
    if ! vcn_out="$(oci network vcn create \
          --compartment-id "$compartment" \
          --cidr-blocks '["10.0.0.0/24"]' \
          --display-name alt-pilot-vcn \
          --freeform-tags '{"alt-pilot":"managed"}' \
          --dns-label afkvcn --wait-for-state AVAILABLE 2>&1)"; then
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
  # SSH is restricted to the installing Cloud Shell's current public address.
  # The dashboard itself is reached through outbound Tailscale, never port 8765.
  local security_list ingress
  [[ -n "${SSH_SOURCE_CIDR:-}" ]] || die "Could not establish your Cloud Shell network address."
  ingress="$(jq -n --arg source "$SSH_SOURCE_CIDR" --arg access "${AFK_REMOTE_ACCESS:-ip}" '[{protocol:"6",source:$source,sourceType:"CIDR_BLOCK",tcpOptions:{destinationPortRange:{min:22,max:22}}}] + (if $access == "ip" then [80,443] | map({protocol:"6",source:"0.0.0.0/0",sourceType:"CIDR_BLOCK",tcpOptions:{destinationPortRange:{min:.,max:.}}}) else [] end)')"
  security_list="$(oci network security-list list --compartment-id "$compartment" --vcn-id "$vcn" --all | jq -r '[.data[] | select(.["display-name"] == "alt-pilot-ssh")][0].id // empty')"
  if [[ -z "$security_list" ]]; then
    security_list="$(oci network security-list create --compartment-id "$compartment" --vcn-id "$vcn" --display-name alt-pilot-ssh \
      --freeform-tags '{"alt-pilot":"managed"}' --ingress-security-rules "$ingress" \
      --egress-security-rules '[{"protocol":"all","destination":"0.0.0.0/0","destinationType":"CIDR_BLOCK"}]' | jq -er '.data.id')"
  else
    oci network security-list update --security-list-id "$security_list" --ingress-security-rules "$ingress" --force >/dev/null
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
        --security-list-ids "$(jq -n --arg id "$security_list" '[$id]')" \
        --dns-label afksubnet 2>/dev/null \
        | jq -r '.data.id')" || die "Could not create subnet in VCN"
  fi
  [[ -n "$subnet" ]] || die "Oracle did not return your app subnet."
  oci network subnet update --subnet-id "$subnet" --security-list-ids "$(jq -n --arg id "$security_list" '[$id]')" --force >/dev/null
  # CRITICAL: only the subnet ID on stdout, everything else to stderr.
  printf '%s' "$subnet"
}

# A repair must not create cloud resources just to refresh Cloud Shell access.
refresh_ssh_access() {
  local compartment="$1" vm_id="$2" vcn list ingress subnet
  subnet="$(oci compute instance list-vnics --instance-id "$vm_id" | jq -er '.data[] | select(.["is-primary"] == true) | .["subnet-id"]')"
  vcn="$(oci network subnet get --subnet-id "$subnet" | jq -er '.data["vcn-id"]')"
  # Only change this application's explicitly managed security list.
  list="$(oci network security-list list --compartment-id "$compartment" --vcn-id "$vcn" --all | jq -r '[.data[] | select(.["display-name"] == "alt-pilot-ssh") | select(.["freeform-tags"]["alt-pilot"] == "managed")][0].id // empty')"
  if [[ -z "$list" ]]; then
    warn "Your existing server uses an older network. We will keep that network unchanged and set up a stable secure link instead."
    AFK_REMOTE_ACCESS=funnel
    export AFK_REMOTE_ACCESS
    return
  fi
  ingress="$(jq -n --arg source "$SSH_SOURCE_CIDR" --arg access "${AFK_REMOTE_ACCESS:-ip}" '[{protocol:"6",source:$source,sourceType:"CIDR_BLOCK",tcpOptions:{destinationPortRange:{min:22,max:22}}}] + (if $access == "ip" then [80,443] | map({protocol:"6",source:"0.0.0.0/0",sourceType:"CIDR_BLOCK",tcpOptions:{destinationPortRange:{min:.,max:.}}}) else [] end)')"
  oci network security-list update --security-list-id "$list" --ingress-security-rules "$ingress" --force >/dev/null
}

# --- Launch a new E2.1.Micro instance ---
# Always Free verification happens BEFORE launch.
launch_vm() {
  local compartment="$1" ad="$2" subnet="$3" image="$4" name="$5" ssh_key="$6"
  info "Launching VM $name (shape VM.Standard.E2.1.Micro, Always Free)" >&2
  # Explicit 50 GB boot volume, already included in the tenancy-wide check.
  oci compute instance launch \
    --availability-domain "$ad" \
    --compartment-id "$compartment" \
    --display-name "$name" \
    --shape "VM.Standard.E2.1.Micro" \
    --opc-retry-token "${VM_LAUNCH_RETRY_TOKEN:?Launch retry token is required}" \
    --freeform-tags '{"alt-pilot":"managed"}' \
    --source-details "$(jq -n --arg id "$image" '{sourceType:"image",imageId:$id,bootVolumeSizeInGBs:50}')" \
    --subnet-id "$subnet" \
    --assign-public-ip true \
    --metadata "$(jq -n --rawfile key "$ssh_key" '{ssh_authorized_keys:$key}')" \
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
  local audit used total_gb
  audit="$(python3 "$OCI_LIB_DIR/../tools/oci_environment.py" inventory --tenancy "$compartment" --region "${OCI_CLI_REGION:?Home region is required}")" || die "Unable to verify tenancy-wide usage. No resource will be created."
  used="$(jq -er .e2_count <<< "$audit")"
  total_gb="$(jq -er .storage_gb <<< "$audit")"
  if [[ "$mode" != repair && -z "$reusable_id" ]]; then
    (( used < 2 )) || die "Your tenancy already uses $used E2 Micro instances. No paid fallback will be used."
    jq -en --argjson total "$total_gb" '$total + 50 <= 200' >/dev/null || die "Another 50 GB boot volume would exceed the 200 GB free allowance."
  fi
  ok "Tenancy-wide E2 Micro usage: $used/2; boot/block storage: $total_gb/200 GB (50 GB planned for a new VM)"
}
