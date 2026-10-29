#!/usr/bin/env bash
# Run one isolated Minecraft Console Client profile under systemd.
set -Eeuo pipefail

slot="${MC_AFK_SLOT:-1}"
[[ "$slot" =~ ^([1-9]|10)$ ]] || { echo "Invalid account slot: $slot" >&2; exit 2; }
profile="/home/mc/slots/${slot}/mcc"
fifo="/home/mc/slots/${slot}/control.fifo"

if [[ -r "/home/mc/slots/${slot}/account.json" ]] && [[ "$(jq -r '.edition' "/home/mc/slots/${slot}/account.json")" == bedrock ]]; then
  [[ -s "/home/mc/slots/${slot}/bedrock/profile.json" ]] || { echo "Bedrock account is not signed in." >&2; exit 1; }
  if [[ -r /etc/alt-pilot/options.env ]]; then source /etc/alt-pilot/options.env; fi
  export MC_SERVER
  rm -f "$fifo"
  mkfifo -m 600 "$fifo"
  exec 3<> "$fifo"
  printf '[%(%H:%M:%S)T] [ALT-PILOT] Bedrock startup began for account %s\n' -1 "$slot"
  exec /opt/alt-pilot/node/bin/node --max-old-space-size=256 /opt/alt-pilot/bedrock/client.js run "/home/mc/slots/${slot}" <&3
fi

/usr/local/bin/alt-pilot-mcc-prepare "$slot"
[[ -s "$profile/SessionCache.db" ]] \
  || { echo "MCC account $slot is not signed in. Use the dashboard sign-in action first." >&2; exit 1; }

rm -f "$fifo"
mkfifo -m 600 "$fifo"
exec 3<> "$fifo"
printf '[%(%H:%M:%S)T] [ALT-PILOT] MCC startup began for account %s\n' -1 "$slot"
export DOTNET_BUNDLE_EXTRACT_BASE_DIR=/opt/alt-pilot/mcc/bundle-cache
cd "$profile"
exec "$profile/MinecraftClient" "$profile/MinecraftClient.ini" <&3
