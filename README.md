# ALT Pilot — your Minecraft accounts, running in the cloud

[![CI](https://github.com/Jlorenzoo/alt-pilot/actions/workflows/ci.yml/badge.svg)](https://github.com/Jlorenzoo/alt-pilot/actions/workflows/ci.yml)
[![Security](https://github.com/Jlorenzoo/alt-pilot/actions/workflows/security.yml/badge.svg)](https://github.com/Jlorenzoo/alt-pilot/actions/workflows/security.yml)

Set up your own Minecraft Java and Bedrock client system in your own Oracle
account. Manage it through a password-protected HTTPS dashboard. Once an account
is connected, your computer can be turned off.

## Start here — no coding or PC installation

1. [Create or sign in to your Oracle account](https://cloud.oracle.com).
2. In Oracle, click **Developer Tools / >_ → Cloud Shell**, then choose **Network → Public**. If Public is missing, the guide has a copy/paste fix.
3. Paste this line into Cloud Shell and press Enter:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/Jlorenzoo/alt-pilot/main/setup-cloudshell.sh)"
```

4. Read the check result, type **YES**, and let setup run. Keep that tab open.
5. Open the **HTTPS address** it prints and save it as a bookmark.
6. In the dashboard, choose **Add account → Java, Bedrock or Both** and follow
   Microsoft's sign-in. Choose your Minecraft server, then select **Start**.

**Follow the [step-by-step guide](docs/getting-started.md)** if you have never
used Oracle Cloud Shell before. It explains each screen and what to do next.

The installer does the technical work: cloud checks, VM creation, SSH keys,
firewall, both runtimes, dashboard, HTTPS certificates and background services.
You do not need a domain name, Tailscale account, or extra software on your PC.

## Your bookmark

Your dashboard uses the VM's own address, for example `https://203.0.113.10`.
The example address is only an illustration; setup prints your real address.
Its certificate is obtained and renewed automatically. The IP stays assigned
through Oracle VM stops and restarts. Deleting the VM or its network address
can change it. No localhost or temporary tunnel is presented as a permanent link.

Lost the address? In Oracle Cloud Shell paste:

```bash
~/alt-pilot/setup-cloudshell.sh --status
```

If setup was interrupted, run the original command again. It resumes your saved
VM rather than creating another one. Your saved Minecraft sign-ins are retained
when repairing the app.

## Cost and capacity

The installer selects one Always Free-eligible E2 Micro and a 50 GB boot disk in
your actual Oracle home region. It checks existing E2 and boot/block storage
usage across compartments and stops if it cannot verify usage or there is no
room in the free allowance. It never changes to a paid VM shape to bypass an
error. Oracle still controls eligibility, capacity and idle-instance reclamation;
this project cannot promise unlimited uptime or unchanging provider terms.

Start with one Minecraft account. Up to ten accounts can be saved; the number
that can run together depends on the 1 GB VM's available memory and editions.
Both Java and Bedrock runtimes are installed automatically. The destination
Minecraft server must support the selected client version and permit the account.

## Security and ownership

Each person uses their own Oracle and Microsoft accounts. No maintainer server,
SSH key, trusted-player list, or Microsoft token is inherited. Minecraft passwords
are entered only on Microsoft's official sign-in page; the app stores the tokens
needed to keep the session running privately on your VM.

The dashboard requires a password, listens on loopback, and is exposed through
an isolated HTTPS proxy. Privileged settings files are kept separate from mutable
session data. Dependency builds run without root; runtimes and additional build
inputs are pinned and checked. See [SECURITY.md](SECURITY.md).

## For developers

Run `python3 -m unittest discover -s tests` and
`node --test tests/*.test.js bedrock/*.test.js` after installing the locked Bedrock
dependencies. See the workflows for the clean VM smoke test and security scans.

[MIT license](LICENSE).
