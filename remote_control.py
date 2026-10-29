#!/usr/bin/env python3
"""Password-protected, VM-local edition of the AFK control center."""

from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import os
import secrets
import subprocess
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from http import HTTPStatus
from http.cookies import SimpleCookie
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import control_center as core


PASSWORD_FILE = Path("/etc/alt-pilot/control-password.json")
SESSIONS_FILE = Path("/etc/alt-pilot/control-sessions.json")
CLUSTER_FILE = Path("/etc/alt-pilot/cluster.json")
PEER_KEY = Path("/etc/alt-pilot/peer_ed25519")
PEER_KNOWN_HOSTS = Path("/etc/alt-pilot/peer_known_hosts")
core.HOSTS_FILE = CLUSTER_FILE
SESSIONS: dict[str, float] = {}
FAILURES: dict[str, list[float]] = {}
SESSION_LOCK = threading.RLock()
SESSION_DAYS = int(os.environ.get("AFK_SESSION_DAYS", "30"))
SESSION_SECONDS = SESSION_DAYS * 24 * 60 * 60
PUBLIC_PATHS = {"/login.css", "/icon.svg", "/brand-lockup.svg", "/favicon.ico"}


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _load_sessions() -> None:
    global SESSIONS
    if not SESSIONS_FILE.is_file():
        return
    try:
        data = json.loads(SESSIONS_FILE.read_text(encoding="utf-8"))
        now = time.time()
        with SESSION_LOCK:
            SESSIONS = {
                str(token_hash): float(expiry)
                for token_hash, expiry in data.items()
                if isinstance(token_hash, str) and isinstance(expiry, (int, float)) and expiry > now
            }
    except Exception:
        pass


def _save_sessions() -> None:
    try:
        SESSIONS_FILE.parent.mkdir(parents=True, exist_ok=True)
        temporary = SESSIONS_FILE.with_suffix(".json.tmp")
        with SESSION_LOCK:
            payload = json.dumps(SESSIONS) + "\n"
        try:
            fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o660)
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                handle.write(payload)
            try:
                os.chmod(temporary, 0o660)
            except OSError:
                pass
            os.replace(temporary, SESSIONS_FILE)
        except PermissionError:
            fd = os.open(SESSIONS_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o660)
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                handle.write(payload)
    except Exception:
        pass


_load_sessions()


def _prune_sessions() -> None:
    """Drop expired session tokens. Called from a background thread and on login."""
    now = time.time()
    changed = False
    with SESSION_LOCK:
        expired = [token for token, expiry in SESSIONS.items() if expiry < now]
        if expired:
            for token in expired:
                SESSIONS.pop(token, None)
            changed = True
    if changed:
        _save_sessions()


def _validate_origin(handler: core.Handler, expected_host: str) -> bool:
    """Reject cross-origin POSTs. The remote tunnel always serves the same origin
    that authenticated the user, so a foreign Origin/Referer cannot issue actions."""
    origin = handler.headers.get("Origin")
    referer = handler.headers.get("Referer")
    source = origin or referer
    if not source:
        return False
    try:
        parsed = urlparse(source)
    except ValueError:
        return False
    if parsed.scheme not in ("https", "http"):
        return False
    # Tunnel traffic is HTTPS. Compare the complete authority, including port;
    # a same-host page served from a different port is a different origin.
    try:
        expected = urlparse("https://" + (handler.headers.get("Host") or expected_host))
        return (
            parsed.scheme == "https"
            and bool(parsed.hostname) and bool(expected.hostname)
            and parsed.username is None and parsed.password is None
            and parsed.hostname == expected.hostname
            and (parsed.port or 443) == (expected.port or 443)
        )
    except ValueError:
        return False



def _ensure_json_content_type(handler: core.Handler, length: int) -> bool:
    if length <= 0:
        return True
    ctype = handler.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
    return ctype == "application/json"


def _start_session_janitor() -> threading.Thread:
    def run() -> None:
        while True:
            time.sleep(300)
            try:
                _prune_sessions()
            except Exception:  # the janitor must never die
                pass

    thread = threading.Thread(target=run, name="afk-session-janitor", daemon=True)
    thread.start()
    return thread
_HEALTH_CACHE: dict = {}
_HEALTH_CACHE_AT = 0.0
_HEALTH_LOCK = threading.Lock()
_CONSOLE_CACHE: dict[int, tuple[float, dict]] = {}
_CONSOLE_LOCK = threading.Lock()
PEER_SSH_CONTROL_DIR = Path("/tmp" if os.name != "nt" else tempfile.gettempdir()) / f"alt-pilot-peer-{getattr(os, 'getuid', lambda: 'local')()}"


def command(argv: list[str], timeout: int = 30, input_data: str | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(argv, text=True, input=input_data, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout, check=False)


def target_host(slot: int) -> dict:
    if not CLUSTER_FILE.is_file():
        return {"id": "e2-1", "name": "alt-pilot", "public_ip": "127.0.0.1", "local": True, "max_online": 5}
    return core.host_for_slot(slot)


def remote_hosts() -> list[dict]:
    """Use the installed cluster registry, or this VM as a single-host fallback."""
    if not CLUSTER_FILE.is_file():
        return [target_host(1)]
    return core.configured_hosts()


def on_host(host: dict, local_argv: list[str], peer_verb: str, timeout: int = 30, input_data: str | None = None) -> subprocess.CompletedProcess[str]:
    if host.get("local"):
        return command(local_argv, timeout, input_data)
    if not PEER_KEY.is_file() or not PEER_KNOWN_HOSTS.is_file():
        return subprocess.CompletedProcess([], 1, "Worker connection is not configured.")
    PEER_SSH_CONTROL_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
    PEER_SSH_CONTROL_DIR.chmod(0o700)
    details = PEER_SSH_CONTROL_DIR.stat()
    if hasattr(os, "getuid") and (details.st_uid != os.getuid() or details.st_mode & 0o077):
        return subprocess.CompletedProcess([], 1, "Worker SSH connection cache has unsafe permissions.")
    return command([
        "ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8",
        "-o", "ControlMaster=auto", "-o", "ControlPersist=60",
        "-o", f"ControlPath={PEER_SSH_CONTROL_DIR / '%C'}",
        "-o", "StrictHostKeyChecking=yes", "-o", f"UserKnownHostsFile={PEER_KNOWN_HOSTS}",
        "-i", str(PEER_KEY), f"ubuntu@{host['public_ip']}", peer_verb,
    ], timeout, input_data)


def health_for_host(host: dict) -> dict:
    result = on_host(host, ["sudo", "-n", "/usr/local/bin/afk-health-json"], "health", 20)
    if result.returncode:
        return {"reachable": False, "reason": result.stdout.strip() or "Health helper failed", "host_id": host["id"]}
    try:
        value = json.loads(result.stdout.strip().splitlines()[-1])
        value.update({"host_id": host["id"], "host_name": host.get("name", host["id"])})
        return value
    except (json.JSONDecodeError, IndexError) as exc:
        return {"reachable": False, "reason": f"Invalid health response: {exc}", "host_id": host["id"]}


def health(fresh: bool = False) -> dict:
    global _HEALTH_CACHE, _HEALTH_CACHE_AT
    now = time.monotonic()
    if not fresh and _HEALTH_CACHE and now - _HEALTH_CACHE_AT < 3:
        return dict(_HEALTH_CACHE)
    with _HEALTH_LOCK:
        now = time.monotonic()
        if not fresh and _HEALTH_CACHE and now - _HEALTH_CACHE_AT < 3:
            return dict(_HEALTH_CACHE)
        try:
            hosts = remote_hosts()
            with ThreadPoolExecutor(max_workers=min(4, max(1, len(hosts)))) as pool:
                currents = list(pool.map(health_for_host, hosts))
            if len(hosts) == 1 and not CLUSTER_FILE.is_file():
                current = currents[0]
            else:
                current = core.aggregate_health(list(zip(hosts, currents)))
            if not fresh and not current.get("reachable") and _HEALTH_CACHE:
                stale = dict(_HEALTH_CACHE)
                stale["health_stale"] = True
                stale["health_note"] = "Status refresh is delayed; showing the last successful check."
                return stale
            _HEALTH_CACHE, _HEALTH_CACHE_AT = current, time.monotonic()
            return dict(current)
        except (subprocess.TimeoutExpired, RuntimeError, json.JSONDecodeError, IndexError) as exc:
            if not fresh and _HEALTH_CACHE:
                stale = dict(_HEALTH_CACHE)
                stale["health_stale"] = True
                stale["health_note"] = "Status refresh is delayed; showing the last successful check."
                return stale
            return {"reachable": False, "reason": f"Status refresh delayed: {exc}"}


def remote_summary(include_oci: bool = False) -> dict:
    current = health()
    available = current.get("reachable", False)
    checks = {name: {"ok": available, "detail": "Available on the Oracle VM" if available else "Unavailable"} for name in ("python3", "oci", "ssh", "jq", "ssh_key")}
    return {
        "checks": checks,
        "vm": {"instance_id": "this-vm", "public_ip": "private", "region": "eu-amsterdam-1"},
        "settings": current.get("settings", dict(core.DEFAULTS)),
        "remote_mode": True,
    }


def local_service(action: str, slot: int = 1) -> tuple[str, dict]:
    host = target_host(slot)
    name = core.account_name(health(), slot)
    result = on_host(host, ["sudo", "-n", "/usr/local/sbin/alt-pilot-account-service", action, str(slot)], f"service {action} {slot}", 45)
    if result.returncode:
        raise RuntimeError(result.stdout.strip() or f"Could not {action} {name}")
    new_health = health(fresh=True)
    return result.stdout or core.service_message(action, core.account_name(new_health, slot, name)), new_health


def local_all(action: str) -> tuple[str, dict]:
    return core.all_accounts(action, health(), local_service, health)


def local_logs() -> tuple[str, dict]:
    output = []
    for host in remote_hosts():
        result = on_host(host, ["sudo", "-n", "/usr/local/bin/afk-control-logs"], "logs", 20)
        output.append(f"\n[{host.get('name', host['id'])}]\n{result.stdout}")
    return "".join(output), health()


def local_console_history(slot: int) -> dict:
    now = time.monotonic()
    with _CONSOLE_LOCK:
        cached = _CONSOLE_CACHE.get(slot)
        if cached and now - cached[0] < 3:
            return dict(cached[1])
    host = target_host(slot)
    result = on_host(host, ["sudo", "-n", "/usr/local/bin/afk-console-log", str(slot)], f"console {slot}", 10)
    if result.returncode:
        raise RuntimeError(result.stdout.strip() or f"Could not read account {slot} console.")
    value = {"slot": slot, "lines": result.stdout.splitlines()[-120:]}
    with _CONSOLE_LOCK:
        _CONSOLE_CACHE[slot] = (time.monotonic(), value)
    return dict(value)


def local_communicate(payload: dict) -> tuple[str, dict]:
    slot, mode, message = core.validate_communication(payload)
    core.claim_communication_slot(slot)
    host = target_host(slot)
    result = on_host(host, ["sudo", "-n", "/usr/local/sbin/alt-pilot-send", mode, str(slot)], f"send {mode} {slot}", 10, message + "\n")
    if result.returncode:
        raise RuntimeError(result.stdout.strip() or f"Could not send to account {slot}.")
    with _CONSOLE_LOCK:
        _CONSOLE_CACHE.pop(slot, None)
    # Sending is complete once the private FIFO accepts the line.
    if mode == "action":
        action_name = "Used held item" if message in ("use_item", "use") else "Dropped held item"
        confirmation = f"{action_name} for account {slot}.\n"
    else:
        confirmation = f"Sent {'/' if mode == 'command' else ''}{message} to the server.\n"

    return confirmation, {"slot": slot}


def local_home_alt_all() -> tuple[str, dict]:
    return core.send_home_alt_all(health(fresh=True), local_communicate)


def local_save_settings(payload: dict) -> tuple[str, dict]:
    candidate = {k: str(payload.get(k, remote_summary()["settings"].get(k, core.DEFAULTS[k]))).strip() for k in core.DEFAULTS}
    # Reuse the exact validation rules from the local control center.
    if not core.valid_minecraft_server(candidate["minecraft_server"]):
        raise ValueError("Server must be a valid hostname or IPv4 address, optionally followed by :port.")
    if not core.VERSION_RE.fullmatch(candidate["minecraft_version"]):
        raise ValueError("Minecraft version contains unsupported characters.")
    if not core.HEAP_RE.fullmatch(candidate["heap_min"]) or not core.HEAP_RE.fullmatch(candidate["heap_max"]):
        raise ValueError("Choose one of the supported conservative heap sizes.")
    if int(candidate["heap_min"][:-1]) > int(candidate["heap_max"][:-1]):
        raise ValueError("Minimum heap cannot exceed maximum heap.")
    failed = []
    peer_verb = f"settings {candidate['minecraft_version']} {candidate['minecraft_server']} {candidate['heap_min']} {candidate['heap_max']}"
    for host in remote_hosts():
        result = on_host(host, ["sudo", "-n", "/usr/local/sbin/alt-pilot-set-options", candidate["minecraft_version"], candidate["minecraft_server"], candidate["heap_min"], candidate["heap_max"]], peer_verb)
        if result.returncode:
            failed.append(str(host.get("name", host["id"])))
    if failed:
        raise RuntimeError("Could not save settings on: " + ", ".join(failed))
    return "Settings saved. Restart the client to apply them.\n", {"settings": candidate}


def local_save_account_settings(payload: dict) -> tuple[str, dict]:
    validated = core.validate_account_settings(payload)
    slot = validated["slot"]
    enabled_flag = "1" if validated["startup_command_enabled"] else "0"
    delay_val = str(validated["startup_delay"])
    cmd_val = validated["startup_command"]
    tpa_flag = "1" if validated["tpa_auto_accept"] else "0"
    tpa_wl = validated["tpa_whitelist"]
    purpose_val = validated.get("purpose", "")
    host = target_host(slot)
    if host.get("local"):
        argv = [
            "sudo", "-n", "/usr/local/sbin/alt-pilot-set-account-options",
            str(slot), enabled_flag, delay_val, cmd_val, tpa_flag, tpa_wl, purpose_val,
        ]
        result = command(argv, 20)
    else:
        b64_cmd = base64.b64encode(cmd_val.encode()).decode()
        b64_wl = base64.b64encode(tpa_wl.encode()).decode()
        b64_purpose = base64.b64encode(purpose_val.encode()).decode()
        peer_verb = f"account_settings {slot} {enabled_flag} {delay_val} {tpa_flag} {b64_cmd} {b64_wl} {b64_purpose}"
        result = on_host(
            host,
            [
                "sudo", "-n", "/usr/local/sbin/alt-pilot-set-account-options",
                str(slot), enabled_flag, delay_val, cmd_val, tpa_flag, tpa_wl, purpose_val,
            ],
            peer_verb,
        )
    if result.returncode:
        raise RuntimeError(result.stdout.strip() or f"Could not save settings for account {slot}.")
    new_health = health()
    name = core.account_name(new_health, slot)
    sync_all = bool(payload.get("sync_all_accounts") or payload.get("apply_all_slots") or payload.get("tpa_sync_all"))
    if sync_all:
        for acc in new_health.get("accounts", []):
            other_slot = acc.get("slot")
            if not other_slot or other_slot == slot or not acc.get("authenticated") or not acc.get("name"):
                continue
            other_settings = acc.get("settings", {})
            other_enabled = "1" if other_settings.get("startup_command_enabled") else "0"
            other_delay = str(other_settings.get("startup_delay", 5))
            other_cmd = other_settings.get("startup_command", "/home alt")
            other_purpose = other_settings.get("purpose", "")
            other_host = target_host(other_slot)
            if other_host.get("local"):
                command([
                    "sudo", "-n", "/usr/local/sbin/alt-pilot-set-account-options",
                    str(other_slot), other_enabled, other_delay, other_cmd, tpa_flag, tpa_wl, other_purpose,
                ], 20)
            else:
                o_cmd = base64.b64encode(other_cmd.encode()).decode()
                o_wl = base64.b64encode(tpa_wl.encode()).decode()
                o_purp = base64.b64encode(other_purpose.encode()).decode()
                on_host(
                    other_host,
                    [
                        "sudo", "-n", "/usr/local/sbin/alt-pilot-set-account-options",
                        str(other_slot), other_enabled, other_delay, other_cmd, tpa_flag, tpa_wl, other_purpose,
                    ],
                    f"account_settings {other_slot} {other_enabled} {other_delay} {tpa_flag} {o_cmd} {o_wl} {o_purp}",
                )
        new_health = health()
        return (
            f"Settings saved for {name} and whitelist synced to all accounts. "
            "TPA auto-accept takes effect live on all running clients without restarting; "
            "startup command and purpose apply on the next login.\n"
        ), new_health

    return (
        f"Settings saved for {name}. "
        "TPA auto-accept takes effect live on the running client without restarting; "
        "startup command and purpose apply on the next login.\n"
    ), new_health


def local_login(task: core.Task, slot: int, edition: str = "java") -> tuple[str, dict]:
    def login(target: int, target_edition: str) -> int:
        try:
            local_cancel_auth(target)
        except Exception:
            pass
        host = target_host(target)
        task.append(f"Preparing Microsoft sign-in for account {target}…\n")
        if host.get("local"):
            argv = ["sudo", "-n", "-u", "mc", "-H", "/usr/local/bin/mc-login", str(target), target_edition]
        else:
            argv = ["ssh", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", f"UserKnownHostsFile={PEER_KNOWN_HOSTS}", "-i", str(PEER_KEY), f"ubuntu@{host['public_ip']}", f"login {target} {target_edition}"]
        return core.run_streaming(argv, task)

    def signout(target: int):
        host = target_host(target)
        return on_host(host, ["sudo", "-n", "-u", "mc", "-H", "/usr/local/bin/mc-signout", str(target)], f"signout {target}", 15)

    def fresh_health() -> dict:
        current = health(fresh=True)
        if not current.get("reachable") or not current.get("cluster_ready", True):
            raise RuntimeError("Account status could not be verified on every Oracle host. No account was added; please try again.")
        return current

    return core.run_edition_logins(task, slot, edition, login, fresh_health, signout)


def local_cancel_auth(slot: int) -> tuple[str, dict]:
    host = target_host(slot)
    if host.get("local"):
        result = on_host(host, ["sudo", "-n", "-u", "mc", "-H", "/usr/local/bin/mc-login", str(slot), "cancel"], f"login {slot} cancel", 15)
    else:
        result = on_host(host, ["/usr/local/bin/mc-login", str(slot), "cancel"], f"login {slot} cancel", 15)
    if result.returncode:
        raise RuntimeError(result.stdout.strip() or f"Could not cancel sign-in for account {slot}")
    return (result.stdout.strip() + "\n") if result.stdout.strip() else "Cancelled.\n", {}


def local_sign_out(slot: int) -> tuple[str, dict]:
    host = target_host(slot)
    stop = on_host(host, ["sudo", "-n", "/usr/local/sbin/alt-pilot-account-service", "stop", str(slot)], f"service stop {slot}", 30)
    if stop.returncode:
        raise RuntimeError(stop.stdout.strip() or f"Could not stop account {slot}")
    if host.get("local"):
        signout = on_host(host, ["sudo", "-n", "-u", "mc", "-H", "/usr/local/bin/mc-signout", str(slot)], f"signout {slot}", 15)
    else:
        signout = on_host(host, ["/usr/local/bin/mc-signout", str(slot)], f"signout {slot}", 15)
    if signout.returncode:
        raise RuntimeError(signout.stdout.strip() or f"Could not sign out account {slot}")
    time.sleep(2)
    return f"{signout.stdout.strip()}\n", health(fresh=True)


def remote_pre_start_check(slot: int) -> tuple[str, dict]:
    current = health()
    warnings = core.pre_start_warnings(current, current.get("settings", {}) or {}, slot)
    return json.dumps({"warnings": warnings}), {"warnings": warnings}


def remote_task(action: str, payload: dict) -> core.Task:
    if action == "pre_start_check":
        slot = core.account_slot(payload)
        return core.TASKS.create(action, lambda: remote_pre_start_check(slot))
    if action in ("start", "stop", "restart"):
        slot = core.account_slot(payload)
        return core.TASKS.create(action, lambda: local_service(action, slot))
    if action in ("start_all", "start_both"):
        return core.TASKS.create(action, lambda: local_all("start"))
    if action in ("stop_all", "stop_both"):
        return core.TASKS.create(action, lambda: local_all("stop"))
    if action == "logs":
        return core.TASKS.create(action, local_logs)
    if action == "communicate":
        return core.TASKS.create(action, lambda: local_communicate(payload))
    if action == "home_alt_all":
        return core.TASKS.create(action, local_home_alt_all)
    if action == "save_settings":
        return core.TASKS.create(action, lambda: local_save_settings(payload))
    if action == "save_account_settings":
        return core.TASKS.create(action, lambda: local_save_account_settings(payload))
    if action == "change_password":
        password = core.validate_new_password(payload)
        return core.TASKS.create(action, lambda: change_password(password))
    if action == "open_auth":
        slot = core.account_slot(payload)
        edition = core.account_edition(payload)
        return core.TASKS.create_streaming(action, lambda task: local_login(task, slot, edition))
    if action == "cancel_auth":
        slot = core.account_slot(payload)
        if payload.get("task_id"):
            def signout(target: int):
                host = target_host(target)
                return on_host(host, ["sudo", "-n", "-u", "mc", "-H", "/usr/local/bin/mc-signout", str(target)], f"signout {target}", 15)
            return core.TASKS.create(action, lambda: core.cancel_auth_attempt(str(payload["task_id"]), slot, local_cancel_auth, signout))
        return core.TASKS.create(action, lambda: local_cancel_auth(slot))
    if action == "sign_out":
        slot = core.account_slot(payload)
        return core.TASKS.create(action, lambda: local_sign_out(slot))
    if action == "reorder_slots":
        return core.TASKS.create(action, lambda: core.task_reorder_slots(payload))
    raise ValueError("That action is only available from the private setup application.")


def password_record() -> dict:
    try:
        return json.loads(PASSWORD_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"Password file unavailable: {exc}") from exc


def verify_password(value: str) -> bool:
    record = password_record()
    salt = base64.b64decode(record["salt"])
    expected = base64.b64decode(record["hash"])
    actual = hashlib.scrypt(value.encode(), salt=salt, n=16384, r=8, p=1, dklen=32)
    return hmac.compare_digest(actual, expected)


def client_key(handler: core.Handler) -> str:
    # Both supported tunnels connect from loopback. Request headers are not a
    # trusted identity: Tailscale does not promise to overwrite Cloudflare's
    # header, so accepting it lets a caller choose a new rate-limit bucket.
    # The bound is deliberately shared by all users of this control endpoint.
    return handler.client_address[0]


class RemoteHandler(core.Handler):
    def allowed_request_host(self) -> bool:
        # Public authorities are supplied by the HTTPS tunnel. This handler
        # authenticates all private routes before calling the local handler.
        return True

    def session(self) -> str | None:
        cookie = SimpleCookie(self.headers.get("Cookie", ""))
        token = cookie.get("afk_session")
        if not token or not token.value:
            return None
        token_hash = _hash_token(token.value)
        now = time.time()
        with SESSION_LOCK:
            expiry = SESSIONS.get(token_hash, 0)
            if not expiry and token.value in SESSIONS:
                expiry = SESSIONS.pop(token.value)
                SESSIONS[token_hash] = expiry
            if expiry < now:
                SESSIONS.pop(token_hash, None)
                _save_sessions()
                return None
            if expiry - now < SESSION_SECONDS / 2:
                SESSIONS[token_hash] = now + SESSION_SECONDS
                self._renew_cookie = token.value
                _save_sessions()
        return token.value

    def end_headers(self) -> None:
        if getattr(self, "_renew_cookie", None):
            self.send_header(
                "Set-Cookie",
                f"afk_session={self._renew_cookie}; Max-Age={SESSION_SECONDS}; Path=/; Secure; HttpOnly; SameSite=Strict"
            )
            self._renew_cookie = None
        super().end_headers()

    def security_headers(self, extra_csp: str = "") -> None:
        base_csp = "default-src 'self'; img-src 'self' data: https://mc-heads.net; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
        self.send_header("Content-Security-Policy", extra_csp or base_csp)
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Permissions-Policy", "geolocation=(), microphone=(), camera=(), payment=()")
        # 6 months, include subdomains. The tunnel is HTTPS-only by design.
        self.send_header("Strict-Transport-Security", "max-age=15552000; includeSubDomains")

    def login_page(self, error: str = "") -> None:
        template = (core.WEB_ROOT / "remote-login.html").read_text(encoding="utf-8")
        data = template.replace("{{ERROR}}", core.html_escape(error)).encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.security_headers("default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            return

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/login":
            if self.session():
                self.send_response(303)
                self.send_header("Location", "/")
                self.end_headers()
                return
            self.login_page()
            return
        if path in PUBLIC_PATHS:
            self.serve_static(path)
            return
        if path == "/logout":
            cookie = SimpleCookie(self.headers.get("Cookie", ""))
            token = cookie.get("afk_session")
            if token and token.value:
                token_hash = _hash_token(token.value)
                with SESSION_LOCK:
                    SESSIONS.pop(token_hash, None)
                    SESSIONS.pop(token.value, None)
                _save_sessions()
            self.send_response(303)
            self.send_header("Set-Cookie", "afk_session=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Strict")
            self.send_header("Location", "/login")
            self.end_headers()
            return
        if not self.session():
            if path.startswith("/api/"):
                self.json_response({"error": "Authentication required"}, 401)
            else:
                self.send_response(303); self.send_header("Location", "/login"); self.end_headers()
            return
        super().do_GET()

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if path == "/login":
            key = client_key(self)
            now = time.time()
            with SESSION_LOCK:
                # Cap the map as well as each client's attempt list: an
                # internet-facing tunnel must not retain one entry per scan.
                if len(FAILURES) >= 4096 and key not in FAILURES:
                    stale_key = min(FAILURES, key=lambda item: FAILURES[item][-1] if FAILURES[item] else 0)
                    FAILURES.pop(stale_key, None)
                recent = [stamp for stamp in FAILURES.get(key, []) if stamp > now - 900]
                if len(recent) >= 6:
                    self.login_page("Too many attempts. Wait 15 minutes and try again.")
                    return
                # Reserve an attempt before hashing: simultaneous requests
                # must not all pass the same six-attempt check.
                FAILURES[key] = recent + [now]
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                self.login_page("Invalid request length.")
                return
            if not 0 <= length <= 4096:
                self.login_page("Invalid request length.")
                return
            supplied = parse_qs(self.rfile.read(length).decode(errors="replace")).get("password", [""])[0]
            if not verify_password(supplied):
                time.sleep(0.35)
                self.login_page("That password is not correct.")
                return
            with SESSION_LOCK:
                FAILURES.pop(key, None)
            _prune_sessions()
            token = secrets.token_urlsafe(32)
            token_hash = _hash_token(token)
            with SESSION_LOCK:
                SESSIONS[token_hash] = now + SESSION_SECONDS
            _save_sessions()
            self.send_response(303)
            self.send_header("Set-Cookie", f"afk_session={token}; Max-Age={SESSION_SECONDS}; Path=/; Secure; HttpOnly; SameSite=Strict")
            self.send_header("Location", "/")
            self.end_headers()
            return
        if not self.session():
            self.json_response({"error": "Authentication required"}, 401)
            return
        if path != "/api/actions":
            self.json_response({"error": "Not found"}, 404)
            return
        if self.headers.get("X-Control-Token") != core.API_TOKEN:
            self.json_response({"error": "Invalid control token"}, 403)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.json_response({"error": "Content-Length must be a non-negative integer"}, 400)
            return
        if not 0 <= length <= 32768:
            self.json_response({"error": "Request body is too large"}, 413)
            return
        if not _ensure_json_content_type(self, length):
            self.json_response({"error": "Content-Type must be application/json"}, 415)
            return
        # SameSite=Strict already blocks cross-site form submissions, but an
        # explicit Origin/Referer check costs nothing and blocks exotic clients.
        expected_host = self.headers.get("X-Forwarded-Host") or self.headers.get("Host") or ""
        if not _validate_origin(self, expected_host):
            self.json_response({"error": "Cross-origin request blocked"}, 403)
            return
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
            if not isinstance(payload, dict):
                raise ValueError("Request body must be a JSON object.")
            task = remote_task(str(payload.get("action", "")), payload)
            self.json_response({"task": task.public()}, 202)
        except (ValueError, RuntimeError, json.JSONDecodeError) as exc:
            self.json_response({"error": str(exc)}, 400)


def write_password(password: str) -> None:
    PASSWORD_FILE.parent.mkdir(parents=True, exist_ok=True)
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1, dklen=32)
    record = {"version": 1, "salt": base64.b64encode(salt).decode(), "hash": base64.b64encode(digest).decode()}
    temporary = PASSWORD_FILE.with_suffix(".json.tmp")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o660)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(json.dumps(record) + "\n")
    try:
        os.chmod(temporary, 0o660)
        os.replace(temporary, PASSWORD_FILE)
    except PermissionError:
        # During an in-app rotation the restricted process has group write
        # access but deliberately cannot change ownership or mode bits.
        temporary.unlink(missing_ok=True)
        raise RuntimeError("Password file permissions do not allow a safe update.")


def init_password() -> str:
    password = "AFK-" + secrets.token_urlsafe(15)
    write_password(password)
    return password


def change_password(password: str) -> tuple[str, dict]:
    write_password(password)
    # Invalidate every existing session so a stolen cookie cannot outlive a
    # password rotation. Legitimate users must sign in again with the new one.
    _prune_sessions()
    with SESSION_LOCK:
        SESSIONS.clear()
    _save_sessions()
    return "Control password changed. All signed-in sessions were signed out.\n", {}


def run_server(port: int) -> None:
    core.remote_probe = health
    core.local_summary = remote_summary
    core.console_history = local_console_history
    core.start_availability(Path("/etc/alt-pilot/availability.sqlite3"), lambda: health(fresh=True))
    _load_sessions()
    _start_session_janitor()
    import chat_whitelist
    chat_whitelist.start(__import__(__name__))
    server = core.BoundedThreadingHTTPServer(("127.0.0.1", port), RemoteHandler)
    print(f"Remote AFK Control Center listening on 127.0.0.1:{port}")
    server.serve_forever()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--init-password", action="store_true")
    parser.add_argument("--set-password-stdin", action="store_true")
    args = parser.parse_args()
    if args.init_password:
        print(init_password())
        return
    if args.set_password_stdin:
        password = __import__("sys").stdin.read()
        if not 12 <= len(password) <= 128:
            raise SystemExit("Password must be between 12 and 128 characters.")
        write_password(password)
        # Any signed-in browser sessions are now stale; force a fresh login.
        with SESSION_LOCK:
            SESSIONS.clear()
        _save_sessions()
        print("Password updated.")
        return
    run_server(args.port)


if __name__ == "__main__":
    main()
