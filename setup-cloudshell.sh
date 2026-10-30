#!/usr/bin/env bash
# Run in Oracle Cloud Shell; users need no local development software.
set -Eeuo pipefail
trap 'echo >&2; echo "Setup paused. Your progress is saved. Run the same command again to continue." >&2' ERR
for cmd in oci git curl jq ssh ssh-keygen python3 flock; do
  command -v "$cmd" >/dev/null || { echo "Open Oracle Cloud Console, click >_ then Cloud Shell, and paste the command there. Missing tool: $cmd" >&2; exit 1; }
done
mode="${1:-install}"
case "$mode" in install|--status|--repair|--reset-password) ;; *) echo 'Usage: setup-cloudshell.sh [--status|--repair|--reset-password]' >&2; exit 2;; esac
REPO_DIR="$HOME/alt-pilot"
if [[ -d "$REPO_DIR/.git" ]]; then
  if [[ "$mode" != --status ]]; then
    git -C "$REPO_DIR" diff --quiet && git -C "$REPO_DIR" diff --cached --quiet || { echo "Your installer files were edited. Your server is safe; keep these edits before updating." >&2; exit 1; }
    git -C "$REPO_DIR" pull --ff-only
  fi
elif [[ -e "$REPO_DIR" ]]; then
  echo "The folder $REPO_DIR already exists but is not an ALT Pilot checkout. No files were changed." >&2; exit 1
else
  git clone https://github.com/Jlorenzoo/alt-pilot.git "$REPO_DIR"
fi
cd "$REPO_DIR"
if [[ "$mode" == --status ]]; then exec bash bin/afk-url; fi
umask 077
mkdir -p .state
chmod 700 .state
exec 9>.state/onboarding.lock
flock -n 9 || { echo 'Setup is already running in another Cloud Shell window. Wait for that window to finish.' >&2; exit 1; }
# This installation gets its own key; existing personal SSH keys are untouched.
export SSH_KEY="$REPO_DIR/.state/oracle_ed25519.pub"
if [[ ! -f "${SSH_KEY%.pub}" ]]; then ssh-keygen -q -t ed25519 -N '' -C alt-pilot-cloudshell -f "${SSH_KEY%.pub}"; fi
[[ -f "$SSH_KEY" ]] || ssh-keygen -y -f "${SSH_KEY%.pub}" > "$SSH_KEY"
printf '\nWelcome to ALT Pilot.\n\n'
echo 'We will set up your cloud computer, Java and Bedrock clients, and your dashboard.'
echo 'Your own Oracle, Tailscale and Microsoft accounts stay under your control.'
echo 'First we check Oracle. Nothing is created until you confirm the result.'
if [[ ! -s .state/vm.json && "$mode" != --repair ]]; then
  bash ./setup-afk.sh --dry-run
  echo
  echo 'The checks passed. This installs one E2 Micro VM with a 50 GB boot disk.'
  echo 'No paid shape or paid-capacity fallback will be selected.'
  read -r -p 'Ready to set up your cloud computer? Type YES and press Enter: ' answer
  [[ "$answer" == YES ]] || { echo 'Nothing created. Run the same command whenever you are ready.'; exit 0; }
fi
if [[ "$mode" == --repair || "$mode" == --reset-password ]]; then
  [[ -s .state/vm.json ]] || { echo 'There is no saved server to repair. Run the original install command first.' >&2; exit 1; }
  if [[ "$mode" == --reset-password ]]; then export AFK_RESET_PASSWORD=1; fi
  bash ./setup-afk.sh --configure-existing
else
  bash ./setup-afk.sh --apply
fi
