# Installation validation — 30 October 2026

This release replaces temporary dashboard links with automatically renewed HTTPS
on the VM's public IP. Oracle retains that address through ordinary stops and
restarts. The guide includes Cloud Shell Public networking and an account-scoped
permission helper so first-time users do not need to type identifiers or IAM
policy statements themselves.

## Tested

- Oracle profile/home-region discovery, account-wide compartment/storage
  enumeration and CLI request schemas were checked read-only against OCI.
- A real disposable Ubuntu 22.04 VM installed Java/MCC, native Bedrock/WebRTC,
  the controller, least-privilege helpers, firewall and systemd watchdog.
- Re-running installation repaired the same VM without replacing its identity.
- Real controller requests checked password login, protected APIs, cookie flags,
  settings writes as `mc`, refusal to start unsigned accounts, password rotation,
  session invalidation and unprivileged runtime loading.
- Caddy obtained an IP-address certificate from an isolated Pebble ACME CA using
  real TLS-ALPN validation. HTTPS login, protected APIs and certificate reuse after
  proxy restart passed with a trusted client. The test also emulates public-to-
  private NAT and a client that sends no SNI, matching the important Oracle case.
- Production configuration uses Let's Encrypt's public `shortlived` profile.
  The local test CA and its fixtures are not part of installed configuration.
- 168 Python tests, 90 Bedrock tests and 20 browser-logic tests passed locally.
  The CI workflow independently repeats regression tests, a fresh Ubuntu install
  and repair, and the IP HTTPS/ACME test. The security workflow scans history and
  audits production dependencies; the local npm audit reported zero advisories.

## Scope

A fresh VM was not created in an operator's Oracle tenancy during this validation,
and a certificate was not ordered from the public Let's Encrypt CA. Those depend
on the target account's available capacity and public network reachability; setup
checks the actual HTTPS endpoint before reporting success. No live Minecraft
accounts were signed in, restarted or used for cross-account testing. Each owner
must complete their own Microsoft sign-in after installing.

Cloud provider outages, idle-instance reclamation, deletion of the VM/IP, server
version changes and future provider terms are outside the installer's control.
