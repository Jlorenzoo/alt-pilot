# Security Policy

ALT Pilot is built with defense-in-depth principles: zero shared credentials, least-privilege systemd sandboxing, and strict network isolation.

## Security Architecture

- **Isolated Tenancy:** Every operator installs ALT Pilot inside their own Oracle Cloud account. No maintainer servers, SSH keys, credentials, or databases are shared.
- **Least-Privilege Execution:**
  - Minecraft game processes run under the unprivileged `mc` user.
  - The web dashboard runs under a dedicated, unprivileged system user (`afk-control`) with strict systemd protection (`PrivateTmp`, `ProtectSystem=strict`, `MemoryMax=80M`).
  - Sudo capabilities are restricted to an explicit command allowlist.
- **Encrypted & Private Remote Access:**
  - Control traffic is served over authenticated, encrypted HTTPS via Cloudflare Tunnel or Tailscale Funnel.
  - Plain HTTP listeners remain strictly bound to loopback (`127.0.0.1`).
  - Login attempts are globally rate-limited to mitigate credential brute-forcing.
- **Safe Authentication:**
  - Minecraft authentication uses Microsoft's official Device Code flow. Microsoft passwords and 2FA codes are never entered into or handled by ALT Pilot.

## Reporting a Vulnerability

If you discover a security vulnerability in ALT Pilot, please report it responsibly:

1. Use GitHub's private **Report a vulnerability** feature on the repository.
2. Include the affected commit, a minimal reproduction in an isolated environment, and expected impact.
3. Please do **not** post credentials, access tokens, private server addresses, or reproduction scripts in public issues or discussion forums.
