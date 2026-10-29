#!/usr/bin/env bash
# Install the pinned Bedrock runtime on an x86_64 Oracle host. Run as root.
set -Eeuo pipefail
source_dir="${1:?Provide the Bedrock source directory}"
[[ "$(uname -m)" == x86_64 ]] || { echo 'Bedrock installer currently requires x86_64.' >&2; exit 1; }
node_version=v24.16.0
node_sha=d804845d34eddc21dc1092b519d643ef40b1f58ec5dec5c22b1f4bd8fabde6c9
if [[ ! -x /opt/alt-pilot/node/bin/node ]] || [[ "$(/opt/alt-pilot/node/bin/node --version)" != "$node_version" ]]; then
  download="$(mktemp -d)"
  trap 'rm -rf "$download"' EXIT
  curl -fsSL --retry 3 "https://nodejs.org/dist/$node_version/node-$node_version-linux-x64.tar.xz" -o "$download/node.tar.xz"
  printf '%s  %s\n' "$node_sha" "$download/node.tar.xz" | sha256sum --check --status
  mkdir "$download/node"
  tar -xJf "$download/node.tar.xz" --strip-components=1 -C "$download/node"
  mkdir -p /opt/alt-pilot
  rm -rf /opt/alt-pilot/node.previous
  [[ ! -d /opt/alt-pilot/node ]] || mv /opt/alt-pilot/node /opt/alt-pilot/node.previous
  mv "$download/node" /opt/alt-pilot/node
fi
export PATH="/opt/alt-pilot/node/bin:$PATH"
if ! command -v cmake >/dev/null || ! command -v g++ >/dev/null; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=180 install -y -qq cmake build-essential
fi
runtime=/opt/alt-pilot/bedrock
mkdir -p "$runtime"
# npm postinstall applies the verified Geyser operator-key compatibility patch.
install -m 644 "$source_dir/patch-nethernet.js" "$runtime/"
if ! cmp -s "$source_dir/package-lock.json" "$runtime/package-lock.json" || [[ ! -d "$runtime/node_modules" ]]; then
  install -m 644 "$source_dir/package.json" "$source_dir/package-lock.json" "$runtime/"
  # Limit compilation on the 1 GB hosts. npm's lifecycle scripts build RakNet.
  (cd "$runtime"; CMAKE_BUILD_PARALLEL_LEVEL=1 npm ci --omit=dev --no-audit --no-fund)
fi
install -m 644 "$source_dir/"*.js "$runtime/"
# Compatibility fixes can change without a dependency lockfile change.
node "$runtime/patch-nethernet.js"
node -e "require('$runtime/node_modules/bedrock-protocol'); require('$runtime/client.js')"
chown -R root:root "$runtime" /opt/alt-pilot/node
chmod -R go-w "$runtime" /opt/alt-pilot/node
install -D -o root -g root -m 644 "$source_dir/../service/alt-pilot-bedrock.conf" /etc/alt-pilot/bedrock-service.conf
# Existing accounts must receive their WebRTC budget before the next restart.
for account in /home/mc/slots/*/account.json; do
  [[ -f "$account" ]] || continue
  [[ "$(jq -r '.edition // "java"' "$account")" == bedrock ]] || continue
  slot="$(basename "$(dirname "$account")")"
  [[ "$slot" =~ ^([1-9]|10)$ ]] || continue
  if [[ "$slot" == 1 ]]; then unit=alt-pilot.service; else unit="alt-pilot@${slot}.service"; fi
  install -D -o root -g root -m 644 /etc/alt-pilot/bedrock-service.conf \
    "/etc/systemd/system/${unit}.d/bedrock-runtime.conf"
done
echo 'Bedrock runtime installed and verified.'
