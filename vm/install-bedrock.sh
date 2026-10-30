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
if ! cmp -s "$source_dir/package-lock.json" "$runtime/package-lock.json" || ! cmp -s "$source_dir/patch-nethernet.js" "$runtime/.patch-applied.js" || [[ ! -d "$runtime/node_modules" ]]; then
  id -u alt-pilot-build >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/alt-pilot-build --shell /usr/sbin/nologin alt-pilot-build
  build="$(mktemp -d /var/tmp/alt-pilot-build.XXXXXXXX)"
  trap 'rm -rf "${download:-}" "${build:-}"' EXIT
  mkdir "$build/runtime"
  install -m 644 "$source_dir/"*.js "$source_dir/package.json" "$source_dir/package-lock.json" "$build/runtime/"
  curl -fsSL --retry 3 https://codeload.github.com/extremeheat/fb-raknet/tar.gz/424ae0fcb5902171c10b5aa4fcc48c45dc984633 -o "$build/raknet.tar.gz"
  printf '%s  %s\n' be90df5bb5ea2a0dcdf5941d26f37aac4a69b488cfb3148b44e19d83ea441da3 "$build/raknet.tar.gz" | sha256sum --check --status
  curl -fsSL --retry 3 "https://nodejs.org/dist/$node_version/node-$node_version-headers.tar.gz" -o "$build/headers.tar.gz"
  printf '%s  %s\n' ee3466c7ed5101cdc82978a5164148204bfffae0ddacda24ef6d9805bdf4fc07 "$build/headers.tar.gz" | sha256sum --check --status
  install -m 755 "$(dirname "$0")/build-bedrock.sh" "$build/build.sh"
  chown -hR alt-pilot-build:alt-pilot-build "$build"
  /usr/sbin/runuser -u alt-pilot-build -- env PATH="$PATH" CMAKE_BUILD_PARALLEL_LEVEL=1 bash "$build/build.sh" "$build"
  # Copy rather than move: the build user never owns the installed tree.
  candidate="$(mktemp -d /opt/alt-pilot/bedrock-install.XXXXXXXX)"
  cp -a "$build/runtime/." "$candidate/"
  chown -hR root:root "$candidate"
  chmod -R go-w "$candidate"
  chmod 755 "$candidate"
  rm -rf /opt/alt-pilot/bedrock.previous
  [[ ! -d "$runtime" ]] || mv "$runtime" /opt/alt-pilot/bedrock.previous
  mv "$candidate" "$runtime"
fi
install -o root -g root -m 644 "$source_dir/"*.js "$runtime/"
# Apply only our reviewed compatibility script, without root privileges.
# Its files are root-owned, so patch a private copy before replacing them.
if ! cmp -s "$source_dir/patch-nethernet.js" "$runtime/.patch-applied.js"; then
  # A changed compatibility patch requires rebuilding the private tree.
  # New installs were already patched by the build user above.
  install -o root -g root -m 644 "$source_dir/patch-nethernet.js" "$runtime/.patch-applied.js"
fi
chown -hR root:root "$runtime" /opt/alt-pilot/node
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
