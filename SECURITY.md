# Security Policy

ALT Pilot is built with defense-in-depth principles: zero shared credentials, least-privilege systemd sandboxing, and strict network isolation.

## Security Architecture

- **Isolated Tenancy:** Every operator installs ALT Pilot inside their own Oracle Cloud account. No maintainer servers, SSH keys, credentials, or databases are shared.
- **Least-Privilege Execution:**
  - Minecraft game processes run under the unprivileged `mc` user.
  - The web dashboard runs under a dedicated, unprivileged system user (`afk-control`) with strict systemd protection (`PrivateTmp`, `ProtectSystem=strict`, `MemoryMax=80M`).
  - Sudo capabilities are restricted to an explicit command allowlist.
- **Encrypted & Private Remote Access:**
  - Control traffic is password-protected and served through an isolated HTTPS proxy with automatically renewed IP certificates. Tailscale Funnel is an optional alternative.
  - The controller listens only on loopback (`127.0.0.1`). Public HTTP is handled by the HTTPS proxy for certificate validation and redirects, never as an unencrypted dashboard.
  - Login attempts are rate-limited. The IP HTTPS proxy overwrites the client-IP header; only the explicitly configured local proxy is trusted. Expensive password hashes also have a concurrency bound.
- **Safe Authentication:**
  - Minecraft authentication uses Microsoft's official Device Code flow. Microsoft passwords and 2FA codes are never entered into or handled by ALT Pilot.

## Reporting a Vulnerability

If you discover a security vulnerability in ALT Pilot, please report it responsibly:

1. Use GitHub's private **Report a vulnerability** feature on the repository.
2. Include the affected commit, a minimal reproduction in an isolated environment, and expected impact.
3. Please do **not** post credentials, access tokens, private server addresses, or reproduction scripts in public issues or discussion forums.

## Installation boundaries

Oracle configuration comes from the active Cloud Shell profile. The actual home
region and usage across compartments are checked before provisioning. This is
not an account-wide billing enforcement service; other workloads, concurrent
changes, provider eligibility and future prices remain the account owner's
responsibility. An unverifiable read or unavailable free capacity stops setup.

Dependency lifecycle scripts are disabled in VM installation. Native RakNet
source and Node headers are supplied at pinned commits/checksums and built by
a separate user without root access. App configuration consumed by privileged
helpers is root-owned; mutable password/session data lives separately under
`/var/lib/alt-pilot`. Certificate keys are isolated under the HTTPS proxy user.

The dashboard's HTTPS address is stable across ordinary VM stops/restarts. It
is not preserved if the VM/network IP is deleted. Certificate issuance and
renewal require working public 80/443 reachability to the VM and depend on the
certificate authority. Setup does not report success if HTTPS validation fails.
