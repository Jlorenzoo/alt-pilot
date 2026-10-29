#!/usr/bin/env bash
# lib/common.sh — shared logging, error handling, and helpers
# Source this from every script. Do not execute directly.

set -Eeuo pipefail

# --- Colors (auto-disabled when not a TTY) ---
if [[ -t 1 ]]; then
  C_RED=$'\033[0;31m'; C_GRN=$'\033[0;32m'; C_YEL=$'\033[0;33m'
  C_BLU=$'\033[0;34m'; C_DIM=$'\033[2m'; C_BLD=$'\033[1m'; C_RST=$'\033[0m'
else
  C_RED=''; C_GRN=''; C_YEL=''; C_BLU=''; C_DIM=''; C_BLD=''; C_RST=''
fi

log()   { printf '%s[%s]%s %s\n' "$C_DIM" "$(date +%H:%M:%S)" "$C_RST" "$*"; }
info()  { printf '%s[i]%s %s\n' "$C_BLU" "$C_RST" "$*"; }
ok()    { printf '%s[+]%s %s\n' "$C_GRN" "$C_RST" "$*"; }
warn()  { printf '%s[!]%s %s\n' "$C_YEL" "$C_RST" "$*" >&2; }
err()   { printf '%s[x]%s %s\n' "$C_RED" "$C_RST" "$*" >&2; }
die()   { err "$*"; exit 1; }

section() {
  printf '\n%s%s%s\n' "$C_BLD" "===== $* =====" "$C_RST"
}

# Trap to surface failed line numbers in stack traces
trap 'err "Failed at line $LINENO: ${BASH_COMMAND}"; exit 1' ERR

# Detect root
require_root() {
  [[ $EUID -eq 0 ]] || die "Must run as root (use sudo)."
}

# Read a config value from /etc/alt-pilot/options.env (key=value)
opt() {
  local key="$1" default="${2:-}"
  local file="${OPTIONS_FILE:-/etc/alt-pilot/options.env}"
  [[ -f "$file" ]] || { [[ -n "$default" ]] && printf '%s' "$default" || return 1; }
  local val
  val="$(grep -E "^${key}=" "$file" 2>/dev/null | tail -1 | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/' || true)"
  [[ -n "$val" ]] && printf '%s' "$val" || printf '%s' "$default"
}
