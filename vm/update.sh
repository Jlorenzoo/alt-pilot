#!/usr/bin/env bash
# Run as root in the updater unit. Fetch only the public ALT Pilot release.
set -Eeuo pipefail
umask 077

state=/var/lib/alt-pilot-update
repo=https://api.github.com/repos/Jlorenzoo/alt-pilot
stage="$(mktemp -d "$state/stage.XXXXXX")"
attempt="${stage##*/}"
installed=""
[[ ! -f "$state/version" ]] || installed="$(cat "$state/version")"
write_status() {
  jq -n --arg attempt "$attempt" --arg state "$1" --arg version "$installed" \
    '{attempt:$attempt,state:$state,version:$version}' > "$stage/status.json"
  chmod 644 "$stage/status.json"
  mv -fT "$stage/status.json" "$state/status.json"
}
cleanup() {
  if [[ "$1" != 0 ]]; then write_status failed || true; fi
  rm -rf -- "$stage"
}
trap 'cleanup "$?"' EXIT
trap 'exit 143' TERM INT
write_status running
exec 9>/run/alt-pilot-install.lock
flock -n 9 || { echo 'An ALT Pilot install is already running.' >&2; exit 1; }

github=(curl --disable --proto '=https' --proto-redir '=https' --silent --show-error
        --retry 2 --connect-timeout 15 --max-time 120)
status="$("${github[@]}" --write-out '%{http_code}' --output "$stage/release.json" "$repo/releases/latest")"
if [[ "$status" == 404 ]]; then
  write_status no_release
  exit 0
fi
[[ "$status" == 200 ]] || { echo "GitHub release check failed (HTTP $status)." >&2; exit 1; }
version="$(jq -er '.tag_name | select(test("^v(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$"))' "$stage/release.json")"
if [[ -n "$installed" ]] && dpkg --compare-versions "${version#v}" le "${installed#v}"; then
  write_status current
  exit 0
fi
digest="$(jq -er '[.assets[] | select(.name == "alt-pilot-vm.tar.gz" and .state == "uploaded")] |
  select(length == 1) | .[0].digest' "$stage/release.json")"
[[ "$digest" =~ ^sha256:[a-f0-9]{64}$ ]]
"${github[@]}" --fail --location --output "$stage/release.tar.gz" \
  "https://github.com/Jlorenzoo/alt-pilot/releases/download/$version/alt-pilot-vm.tar.gz"
printf '%s  %s\n' "${digest#sha256:}" "$stage/release.tar.gz" | sha256sum --check --status || {
  echo "ALT Pilot $version failed its release checksum." >&2; exit 1
}
mkdir "$stage/source"
tar -xzf "$stage/release.tar.gz" --no-same-owner -C "$stage/source"
python3 "$stage/source/vm/apply-release.py" "$stage/source"
printf '%s\n' "$version" > "$stage/version"
chmod 644 "$stage/version"
mv -fT "$stage/version" "$state/version"
installed="$version"
write_status updated
