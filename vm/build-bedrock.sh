#!/usr/bin/env bash
# Executed only as the dedicated, unprivileged build user.
set -Eeuo pipefail
[[ "$(id -u)" != 0 ]] || { echo 'Never build dependencies as root.' >&2; exit 1; }
stage="${1:?Build directory required}"
cd "$stage/runtime"
# Lockfile integrity covers registry and pinned GitHub tarball dependencies.
npm ci --ignore-scripts --omit=dev --no-audit --no-fund
mkdir -p node_modules/raknet-native/raknet "$stage/headers"
tar -xzf "$stage/raknet.tar.gz" --strip-components=1 -C node_modules/raknet-native/raknet
tar -xzf "$stage/headers.tar.gz" --strip-components=1 -C "$stage/headers"
# Do not run raknet-native's install hook (it can clone an unpinned submodule).
# Pre-verified source and Node headers are supplied directly to its build tool.
node - "$stage/headers" <<'JS'
const path = require('node:path')
const { BuildSystem } = require('cmake-js')
const build = new BuildSystem({ directory: path.resolve('node_modules/raknet-native') })
build.options.runtimeDirectory = process.argv[2]
build.compile().catch(error => { console.error(error.message); process.exit(1) })
JS
node patch-nethernet.js
node -e "require('raknet-native'); require('bedrock-protocol'); require('@roamhq/wrtc'); require('./client.js')"
