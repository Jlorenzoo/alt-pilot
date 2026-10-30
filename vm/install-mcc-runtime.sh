#!/usr/bin/env bash
# Prepare the pinned MCC bundle without changing its managed code. Run as root.
set -Eeuo pipefail
source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
runtime=/opt/alt-pilot/mcc
python3 "$source_dir/prepare-mcc-runtime.py" "$runtime/MinecraftClient" "$runtime/disk/MinecraftClient" \
  --sha256 "${MCC_SHA256:-2e0fe135079824d1b02a3ef9bf89c56d95d72a1d1502d7204f93acc0084223db}"
# Extract once outside the small client cgroups, then make the shared cache
# read-only. Clients load the same verified assemblies directly from disk.
mkdir -p "$runtime/bundle-cache"
chown -R mc:mc "$runtime/bundle-cache"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
chown mc:mc "$work"
chown root:mc "$runtime/disk" "$runtime/disk/MinecraftClient"
chmod 750 "$runtime/disk" "$runtime/disk/MinecraftClient"
(cd "$work"; /usr/sbin/runuser -u mc -- env DOTNET_BUNDLE_EXTRACT_BASE_DIR="$runtime/bundle-cache" \
  timeout 120 "$runtime/disk/MinecraftClient" --help > /dev/null)
chown -R root:mc "$runtime/disk" "$runtime/bundle-cache"
chmod -R u=rwX,g=rX,o= "$runtime/disk" "$runtime/bundle-cache"
chmod 750 "$runtime/disk/MinecraftClient"
echo 'MCC runtime prepared; the original release binary is preserved.'
