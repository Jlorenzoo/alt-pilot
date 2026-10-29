#!/usr/bin/env bash
# app.sh — launch the loopback-only web control center.
set -Eeuo pipefail
PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "$PKG_DIR/control_center.py" "$@"
