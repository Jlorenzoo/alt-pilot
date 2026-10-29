# ALT Pilot public release plan

## Outcome

A teammate follows one public guide, creates an independent deployment in their
own Oracle account, and signs in to their own Minecraft account. No maintainer
server, private history, credential, player whitelist, or telemetry is inherited.

## Implementation

- [x] Create a separate source snapshot with no private Git history or evidence.
- [ ] Make cloud setup detect the authenticated account, actual home region,
      tenancy-wide compute/storage use, and available E2 capacity; stop on error.
- [ ] Create only app-owned networking and restrict SSH to the installing client.
- [ ] Provide one copy/paste command in Oracle Cloud Shell, plus resumable setup,
      repair, status and explicit resource removal commands.
- [ ] Default to private HTTPS dashboard access through the operator's Tailscale.
- [ ] Install pinned, verified runtimes; build dependencies without root and with
      all additional native-build inputs pinned.
- [ ] Test first install, repair, privileges, login and service recovery in a clean
      disposable Ubuntu VM; keep production Minecraft sessions untouched.
- [ ] Run secrets, dependency, static analysis and regression checks in GitHub CI.
- [ ] Publish the reviewed snapshot and a versioned install command only after
      checks pass; enable public GitHub security protections.
- [ ] Deliver the teammate guide with setup, Microsoft sign-in, troubleshooting,
      updates, cost limits, privacy, and removal instructions.

## Release criteria

Tests and review must show no unresolved known high/critical security findings,
no detected secrets, least-privilege installation, isolated ownership, and a
working local systemd VM installation. An actual Oracle create test is reported
separately from mocked provisioning tests and read-only Oracle discovery. No
claim of guaranteed uptime, unlimited capacity, unconditional zero cost, or an
absence of all possible future vulnerabilities is made.
