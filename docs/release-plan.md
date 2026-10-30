# ALT Pilot public release plan

## Outcome

A teammate follows one public guide, creates an independent deployment in their
own Oracle account, and signs in to their own Minecraft account. No maintainer
server, private history, credential, player whitelist, or telemetry is inherited.

## Implementation

- [x] Create a separate source snapshot with no private Git history or evidence.
- [x] Make cloud setup detect the authenticated account, actual home region,
      tenancy-wide compute/storage use, and available E2 capacity; stop on error.
- [x] Create only app-owned networking and restrict SSH to the installing client.
- [x] Provide one copy/paste command in Oracle Cloud Shell, plus resumable setup,
      repair, status and explicit resource removal commands.
- [x] Default to automatic public-IP HTTPS with no extra account; keep Tailscale optional.
- [x] Install pinned, verified runtimes; build dependencies without root and with
      all additional native-build inputs pinned.
- [x] Test first install, repair, privileges, login and service recovery in a clean
      disposable Ubuntu VM; keep production Minecraft sessions untouched.
- [x] Run secrets, dependency, static analysis and regression checks in GitHub CI.
- [ ] Publish the updated installer through a reviewed PR after checks pass; keep GitHub security protections enabled.
- [x] Deliver the teammate guide with setup, Microsoft sign-in, troubleshooting,
      updates, cost limits, privacy, and removal instructions.

## Release criteria

Tests and review must show no unresolved known high/critical security findings,
no detected secrets, least-privilege installation, isolated ownership, and a
working local systemd VM installation. An actual Oracle create test is reported
separately from mocked provisioning tests and read-only Oracle discovery. No
claim of guaranteed uptime, unlimited capacity, unconditional zero cost, or an
absence of all possible future vulnerabilities is made.

## 30 October 2026 continuation

Default remote access is the VM's own HTTPS IP, with automatic Caddy / Let's
Encrypt short-lived certificate renewal. No extra Tailscale signup is required.
The optional Funnel route remains available to administrators.

Validation includes a real clean Ubuntu 22.04 virtual machine, unprivileged
native compilation, repaired installs, controller password rotation, least-
privilege helpers, and an ACME IP-certificate flow against Pebble with real
TLS-ALPN challenge validation. Local CA fixtures are validation-only and never
replace the public Let's Encrypt issuer in the production installer. An actual
new-Oracle-VM create-and-issue run is separate from these tests.

Cloud Shell's default restricted network is addressed before the download step:
the guide shows the Public selector and a standalone, account-specific permission
helper for fresh tenancies. This helper uses only the already-authenticated OCI
CLI and does not require downloading anything from the public internet.
