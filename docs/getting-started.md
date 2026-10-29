# Teammate Getting Started Guide

This guide walks you through setting up your own independent 24/7 Minecraft AFK bot system using Oracle Cloud's Always Free tier.

---

## Table of Contents
1. [Overview & Prerequisites](#1-overview--prerequisites)
2. [Creating an Oracle Cloud Free Account](#2-creating-an-oracle-cloud-free-account)
3. [Installing ALT Pilot in Cloud Shell](#3-installing-alt-pilot-in-cloud-shell)
4. [Accessing the Dashboard](#4-accessing-the-dashboard)
5. [Connecting Your Minecraft Account](#5-connecting-your-minecraft-account)
6. [Configuring Auto-Reconnect & Trusted Players](#6-configuring-auto-reconnect--trusted-players)
7. [Maintenance, Updates & Uninstallation](#7-maintenance-updates--uninstallation)
8. [Troubleshooting & FAQ](#8-troubleshooting--faq)

---

## 1. Overview & Prerequisites

ALT Pilot runs in **your own cloud account**, meaning:
- You have complete control and total privacy.
- Your credentials, Microsoft tokens, and Minecraft logins are never shared with anyone.
- It runs 24/7 in Oracle's data centers, so your home PC can be turned off.
- It uses Oracle Cloud's **Always Free** tier, which costs **€0.00 / $0.00 forever**.

### What you need:
- An Oracle Cloud account (free signup instructions below).
- A Minecraft account (Java Edition or Bedrock Edition).
- A smartphone or browser to complete Microsoft's device-code sign-in.

---

## 2. Creating an Oracle Cloud Free Account

If you do not yet have an Oracle Cloud account:

1. Go to [Oracle Cloud Free Tier Signup](https://signup.cloud.oracle.com).
2. Enter your country and name, then verify your email.
3. **Important — Choose your Home Region carefully:**
   - Select the geographical region closest to you or your Minecraft server (e.g., `Netherlands (Amsterdam)`, `Germany (Frankfurt)`, `UK (London)`, or `US East (Ashburn)`).
   - Your Always Free instances can only be created in this Home Region.
4. Complete payment method verification:
   - Oracle requires a debit or credit card to verify your identity and prevent spam.
   - A small temporary authorization hold (~€1 / $1) is placed and immediately reversed.
   - **You will NOT be charged.** Oracle Cloud will never bill you unless you deliberately click "Upgrade to Paid Account".

---

## 3. Installing ALT Pilot in Cloud Shell

Once logged into your Oracle Cloud Console:

1. Look at the top navigation bar in the upper-right corner.
2. Click the **Developer Tools** icon `>_` and select **Cloud Shell**.
3. A terminal window will open at the bottom of your browser.
4. Copy and paste this single command, then hit **Enter**:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/Jlorenzoo/alt-pilot/main/setup-cloudshell.sh)"
```

### What this script does automatically:
1. Detects your tenancy and Home Region.
2. Checks that you have available Always Free VM and storage quota.
3. Provisions a dedicated `VM.Standard.E2.1.Micro` instance running Ubuntu 22.04 LTS.
4. Configures secure networking, systemd service sandboxes, and unprivileged users.
5. Installs the Minecraft Console Client and Bedrock protocol runtimes.
6. Starts an encrypted HTTPS tunnel (Cloudflare Tunnel or Tailscale).
7. Outputs your private **Dashboard URL** and password.

---

## 4. Accessing the Dashboard

At the end of installation, the Cloud Shell terminal displays:

```text
================================================================
 ORACLE VM READY — public IP: xxx.xxx.xxx.xxx
================================================================

REMOTE CONTROL FROM ANY PC / PHONE:
  https://random-name.trycloudflare.com

Username: control
Password: <randomly-generated-password>
```

1. Click or copy the HTTPS link into your browser.
2. Enter the username `control` and the one-time generated password.
3. You will land on the **ALT Pilot Web Dashboard**, featuring real-time status, account slots, live console logs, and resource monitors.

---

## 5. Connecting Your Minecraft Account

1. In the dashboard, click **Add Account** (or select **Slot 1**).
2. Select your edition:
   - **Java Edition** (uses lightweight Minecraft Console Client).
   - **Bedrock Edition** (uses native Bedrock protocol runtime).
3. Click **Sign in with Microsoft**.
4. The dashboard displays an 8-character device code and a link to `https://microsoft.com/link`.
5. Open that link on your phone or in another browser tab, log in to your Microsoft / Xbox account, and confirm the code.
6. Enter your server IP (for example `hub.mc-complex.com` or your team's server).
7. Click **Start Client**.
8. Once the indicator turns green and reports **Connected**, your bot is live in the game!
   > **You can now safely shut down your personal PC. The bot stays online 24/7.**

---

## 6. Configuring Auto-Reconnect & Trusted Players

### Auto-Reconnect & Watchdog
ALT Pilot includes a background systemd watchdog service that monitors connection health:
- If your bot is kicked, disconnected by server restart, or encounters a network hiccup, ALT Pilot automatically waits for the cooldown period and logs back in.
- You can tune reconnection delays in the **Settings** tab.

### Trusted Players & Chat Whitelist
By default, your bot ignores commands and teleport requests from everyone for safety.
- To allow specific teammates to teleport your alt (`/tpa`) or trigger item drops:
  1. Open the account in the dashboard.
  2. Navigate to **Trusted Players**.
  3. Enter your teammates' exact in-game usernames.
  4. Save changes.

---

## 7. Maintenance, Updates & Uninstallation

### Checking Status from Terminal
If you ever want to check on your VM from Oracle Cloud Shell:
```bash
ssh ubuntu@YOUR_VM_PUBLIC_IP
afk-status   # check status of all slots
afk-logs     # live streaming logs
```

### Updating ALT Pilot
In Oracle Cloud Shell:
```bash
cd ~/alt-pilot
git pull
./setup-afk.sh --configure-existing
```

### Complete Removal
To completely remove ALT Pilot from your Oracle VM:
```bash
sudo /opt/alt-pilot/vm/uninstall.sh
```
To terminate the Oracle VM itself, simply go to the Oracle Cloud Console → **Compute** → **Instances** → select `alt-pilot` → click **Terminate** (check "Permanently delete the attached boot volume").

---

## 8. Troubleshooting & FAQ

### Q: "Out of host capacity" error during provisioning?
In high-demand Oracle regions, Always Free `E2.1.Micro` slots may occasionally be temporarily full.
- The installer automatically retries across available Availability Domains in your region.
- If all domains are temporarily busy, wait a short while or try again later in the day.

### Q: How do I change my dashboard password?
In the dashboard, open **Settings** → **Security** → enter your current password and set a new one.

### Q: Does this cost anything?
**No.** The `VM.Standard.E2.1.Micro` instance and its 47 GB boot volume fall squarely within Oracle's permanent **Always Free** limits (2 micro VMs and 200 GB total storage).
