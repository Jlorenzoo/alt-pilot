#!/usr/bin/env bash
# setup-cloudshell.sh — 1-command installer for Oracle Cloud Shell.
# Designed for teammates to deploy their own independent 24/7 ALT Pilot instance.
set -Eeuo pipefail

BOLD='\033[1m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RESET='\033[0m'

echo -e "${CYAN}${BOLD}"
cat << "EOF"
    ___    __  ______     ____  _ __      __ 
   /   |  / / /_  __/    / __ \(_) /___  / /_
  / /| | / /   / /______/ /_/ / / / __ \/ __/
 / ___ |/ /___/ /______/ ____/ / / /_/ / /_  
/_/  |_/_____/_/      /_/   /_/_/\____/\__/  
EOF
echo -e "${RESET}"
echo -e "${BOLD}ALT Pilot — 24/7 Minecraft AFK System on Oracle Cloud Always Free${RESET}"
echo "------------------------------------------------------------------"
echo "This installer will deploy your own private, 24/7 AFK client server"
echo "in your Oracle Cloud account using the 100% Always Free tier."
echo ""

# Pre-flight environment checks
if ! command -v oci >/dev/null 2>&1; then
  echo -e "${YELLOW}[!] Warning: 'oci' CLI not found.${RESET}"
  echo "    This script is designed to run directly inside Oracle Cloud Shell."
  echo "    Log in to https://cloud.oracle.com and click the '>_' (Cloud Shell) icon in the top right."
  exit 1
fi

for cmd in git curl jq ssh; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo -e "${YELLOW}[!] Missing required tool: $cmd${RESET}"
    exit 1
  fi
done

# Ensure SSH key exists
if [[ ! -f "$HOME/.ssh/id_ed25519.pub" && ! -f "$HOME/.ssh/id_rsa.pub" ]]; then
  echo -e "${CYAN}[*] Creating dedicated SSH keypair (~/.ssh/id_ed25519)...${RESET}"
  mkdir -p -m 700 "$HOME/.ssh"
  ssh-keygen -t ed25519 -N "" -f "$HOME/.ssh/id_ed25519" -C "alt-pilot-cloudshell"
fi

REPO_DIR="$HOME/alt-pilot"
if [[ -d "$REPO_DIR/.git" ]]; then
  echo -e "${CYAN}[*] Updating existing ALT Pilot checkout in $REPO_DIR...${RESET}"
  git -C "$REPO_DIR" pull --ff-only 2>/dev/null || true
elif [[ -d "$REPO_DIR" ]]; then
  echo -e "${CYAN}[*] Using directory $REPO_DIR...${RESET}"
else
  echo -e "${CYAN}[*] Downloading ALT Pilot into $REPO_DIR...${RESET}"
  git clone https://github.com/Jlorenzoo/alt-pilot.git "$REPO_DIR"
fi

cd "$REPO_DIR"

echo -e "${CYAN}[*] Starting automated Always Free provisioning & setup...${RESET}"
./setup-afk.sh --apply

echo ""
echo -e "${GREEN}${BOLD}==================================================================${RESET}"
echo -e "${GREEN}${BOLD}             ALT PILOT SETUP COMPLETED SUCCESSFULLY!             ${RESET}"
echo -e "${GREEN}${BOLD}==================================================================${RESET}"
echo ""
echo "Next Steps:"
echo "1. Open your Web Dashboard URL shown above."
echo "2. Log in with the generated password."
echo "3. Click 'Add Account' -> select Java or Bedrock."
echo "4. Follow the Microsoft Device Code prompt (https://microsoft.com/link)."
echo "5. Once connected, your AFK bot is running 24/7 in the cloud —"
echo "   you can safely turn off your PC!"
echo ""
