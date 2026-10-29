# ALT Pilot — 24/7 Minecraft AFK System

[![CI](https://github.com/Jlorenzoo/alt-pilot/actions/workflows/ci.yml/badge.svg)](https://github.com/Jlorenzoo/alt-pilot/actions/workflows/ci.yml)
[![Security](https://github.com/Jlorenzoo/alt-pilot/actions/workflows/security.yml/badge.svg)](https://github.com/Jlorenzoo/alt-pilot/actions/workflows/security.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**ALT Pilot** is an automated, self-hosted 24/7 Minecraft AFK client system designed to run on Oracle Cloud's **100% Always Free tier** (zero cost forever).

It includes a lightweight client runner supporting both **Java Edition** and **Bedrock Edition**, coupled with a responsive, password-protected web dashboard accessible from your phone or desktop browser.

---

## ⚡ Quick Start (5 Minutes — No PC Software Needed)

You do **not** need to install anything on your personal computer. Setup runs entirely in your browser using Oracle's built-in Cloud Shell.

### 1. Open Oracle Cloud Shell
1. Sign in to your [Oracle Cloud Console](https://cloud.oracle.com).
2. Click the **Developer Tools** icon `>_` (**Cloud Shell**) in the top-right navigation bar.

### 2. Run the 1-Command Installer
Paste this single command into the Cloud Shell terminal and press **Enter**:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/Jlorenzoo/alt-pilot/main/setup-cloudshell.sh)"
```

### 3. What Happens Automatically
- Verifies your tenancy's Always Free quota.
- Launches an Always Free `VM.Standard.E2.1.Micro` instance with Ubuntu 22.04 LTS.
- Configures dedicated, unprivileged system users (`mc` and `afk-control`).
- Installs the client runtimes, watchdog services, and web dashboard.
- Establishes a secure, encrypted HTTPS tunnel (Cloudflare Tunnel or Tailscale).
- Prints your **Dashboard URL** and **Initial Password**.

### 4. Connect Your Minecraft Account
1. Open the **Dashboard URL** from your terminal in any browser.
2. Log in using the generated password.
3. Click **Add Account** → choose **Java** or **Bedrock**.
4. Click **Sign in with Microsoft** and follow the standard device-code link (`https://microsoft.com/link`).
5. Enter the Minecraft server address (e.g. `hub.mc-complex.com`).
6. Once the dashboard shows **Connected**, your bot is running 24/7 in the cloud. **You can safely turn off your PC!**

---

## ✨ Features

- **Java & Bedrock Support:** Run vanilla Minecraft Java 1.12.2+ sessions or Bedrock protocol sessions side-by-side.
- **Multi-Account Slots:** Manage up to 10 independent AFK accounts from one dashboard.
- **Web Dashboard:** Mobile-optimized, responsive web control center with live console logs, RAM/swap/disk meters, and connection status.
- **Smart Reconnection Watchdog:** Automatically recovers from server restarts, network timeouts, or kicks without manual intervention.
- **Chat Whitelist & Item Drop Controls:** Authorized team players can trigger whitelisted in-game actions (e.g. `/tpa` auto-accept or XP drops) without opening the account to strangers.
- **Zero Local Footprint:** Server runs entirely in the cloud; manage everything via browser.

---

## 🔒 Security & Privacy

- **100% Isolated Tenancy:** Every teammate installs into their own personal Oracle account. No shared servers, tokens, keys, or player whitelists.
- **Least-Privilege Isolation:**
  - Minecraft game processes run under the unprivileged `mc` user.
  - The dashboard runs under a restricted `afk-control` service with strict systemd filesystem sandboxing (`ProtectSystem=strict`, `PrivateTmp`).
- **Official Microsoft OAuth:** All account authentication uses official Microsoft Device Code OAuth. Passwords and credentials never touch ALT Pilot.
- **Encrypted Remote Access:** The web dashboard listens strictly on loopback (`127.0.0.1`) and is served remotely through encrypted HTTPS tunnels with login rate-limiting.

---

## 📖 In-Depth Guides

- [**Step-by-Step Teammate Guide**](docs/getting-started.md) — Detailed illustrated walkthrough, Oracle Free Tier signup instructions, troubleshooting, updates, and uninstallation.
- [**Security Policy**](SECURITY.md) — Security boundaries and vulnerability reporting.

---

## 🛠️ Management & Commands

From the Oracle Cloud Shell (or via SSH on your VM):

```bash
# Check status of all running AFK accounts
afk-status

# View live console logs
afk-logs

# Start, stop, or restart an account
afk-start
afk-stop
afk-restart

# Run the local Control Center UI locally
./app.sh
```

---

## 📄 License

ALT Pilot is released under the [MIT License](LICENSE).
