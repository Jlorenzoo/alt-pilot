#!/usr/bin/env python3
"""Loopback-only control center for ALT Pilot.

The server deliberately has no third-party dependencies.  Every mutating API
call requires a per-process token and all remote commands use an allowlist.
"""

from __future__ import annotations

import argparse
import html
import ipaddress
import json
import os
import re
import secrets
import selectors
import shlex
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import webbrowser
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

import mc_server_ping
from availability import Tracker


ROOT = Path(__file__).resolve().parent
WEB_ROOT = ROOT / "web"
STATE_DIR = ROOT / ".state"
STATE_FILE = STATE_DIR / "vm.json"
HOSTS_FILE = STATE_DIR / "hosts.json"
SETTINGS_FILE = STATE_DIR / "control-center.json"
# OpenSSH Unix sockets have a small platform path limit. Keep the private,
# per-user multiplexing directory short even when this checkout lives deeply.
SSH_CONTROL_DIR = Path("/tmp" if os.name != "nt" else tempfile.gettempdir()) / f"alt-pilot-{getattr(os, 'getuid', lambda: 'local')()}"
DEFAULTS = {
    "ssh_user": "ubuntu",
    "minecraft_version": "1.12.2",
    "minecraft_server": "eu.mc-complex.com",
    "heap_min": "160m",
    "heap_max": "320m",
}
HOST_RE = re.compile(r"^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$")
VERSION_RE = re.compile(r"^[0-9A-Za-z._:+-]{1,40}$")
HEAP_RE = re.compile(r"^(?:128|160|192|224|256|320|384|448|512)m$")
MAX_ACCOUNTS = 10
MAX_ONLINE_ACCOUNTS = 10
MAX_COMMUNICATION_LENGTH = 100
MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".png": "image/png",
    ".json": "application/json; charset=utf-8",
}
html_escape = html.escape
_COMMUNICATION_LOCK = threading.Lock()
_COMMUNICATION_LAST_SENT: dict[int, float] = {}


DEVICE_URL_RE = re.compile(
    r"https://(?:www\.)?microsoft\.com/(?:link|devicelogin)(?:\?[^\s<>\"']*)?",
    re.IGNORECASE,
)
DEVICE_CODE_RE = re.compile(
    r"(?:enter|use)\s+(?:the\s+)?code\s*[:=]?\s*([A-Z0-9-]{6,16})|\bcode\s*[:=]\s*([A-Z0-9-]{6,16})",
    re.IGNORECASE,
)
ANSI_ESCAPE_RE = re.compile(r"\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))")


def extract_device_code(output: str) -> dict[str, str] | None:
    """Extract Microsoft's device-login URL and code from live launcher output."""
    # MCC uses terminal colours even during the device-code prompt. Strip the
    # control sequences so they cannot split the URL or one-time code.
    output = ANSI_ESCAPE_RE.sub("", output)
    bedrock_marker = output.rfind("Starting Bedrock sign-in")
    if bedrock_marker != -1:
        output = output[bedrock_marker:]
    matches = list(DEVICE_URL_RE.finditer(output))
    if not matches:
        return None
    url_match = matches[-1]
    url = url_match.group(0).rstrip(".,);]")
    code = ""
    try:
        query = parse_qs(urlparse(url).query)
        code = str(query.get("otc", [""])[0]).upper()
    except (AttributeError, TypeError, ValueError):
        pass
    if not code:
        nearby = output[max(0, url_match.start() - 160):url_match.end() + 320]
        code_match = DEVICE_CODE_RE.search(nearby)
        if code_match:
            code = next((group for group in code_match.groups() if group), "").upper()
    return {"url": url, "code": code}


def read_json(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default


def atomic_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    # The state directory can contain infrastructure details and, for remote
    # access, a locally retained password.  Do not let the caller's umask turn
    # an atomic replacement into a world-readable file.
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(json.dumps(value, indent=2) + "\n")
    os.replace(tmp, path)
    os.chmod(path, 0o600)


def harden_state_directory() -> None:
    """Keep local infrastructure state private even when created by a loose umask."""
    STATE_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
    details = STATE_DIR.stat()
    if details.st_uid != os.getuid():
        raise RuntimeError("The local state directory is not owned by this user.")
    os.chmod(STATE_DIR, 0o700)
    for path in STATE_DIR.iterdir():
        if path.is_file() and not path.is_symlink():
            os.chmod(path, 0o600)


def safe_ip(value: str) -> str:
    return str(ipaddress.ip_address(value))


def valid_minecraft_server(value: str) -> bool:
    """Accept a DNS hostname or IPv4 address, with an optional TCP port."""
    host = value
    if ":" in value:
        if value.count(":") != 1:
            return False
        host, port_text = value.rsplit(":", 1)
        if not port_text.isdigit() or not 1 <= int(port_text) <= 65535:
            return False
    if HOST_RE.fullmatch(host):
        return True
    try:
        return ipaddress.ip_address(host).version == 4
    except ValueError:
        return False


def settings() -> dict[str, str]:
    result = dict(DEFAULTS)
    stored = read_json(SETTINGS_FILE, {})
    if isinstance(stored, dict):
        result.update({k: str(v) for k, v in stored.items() if k in result})
    return result


def state() -> dict[str, Any]:
    value = read_json(STATE_FILE, {})
    return value if isinstance(value, dict) else {}


def hosts_config() -> dict[str, Any]:
    """Return the cluster registry, with the legacy single VM as fallback."""
    configured = read_json(HOSTS_FILE, {})
    if not (isinstance(configured, dict) and isinstance(configured.get("hosts"), list) and configured["hosts"]):
        cluster_file = Path("/etc/alt-pilot/cluster.json")
        if cluster_file.is_file():
            configured = read_json(cluster_file, {})
    if isinstance(configured, dict) and isinstance(configured.get("hosts"), list) and configured["hosts"]:
        return configured
    vm = state()
    if not vm.get("public_ip"):
        return {"version": 1, "hosts": [], "placements": {}}
    return {
        "version": 1,
        "hosts": [{
            "id": "e2-1", "name": "alt-pilot", "public_ip": vm["public_ip"],
            "instance_id": vm.get("instance_id", ""), "region": vm.get("region", ""),
            "ssh_user": settings()["ssh_user"], "max_online": 5,
        }],
        "placements": {str(slot): "e2-1" for slot in range(1, MAX_ACCOUNTS + 1)},
    }


def configured_hosts() -> list[dict[str, Any]]:
    result = []
    for raw in hosts_config().get("hosts", []):
        if not isinstance(raw, dict):
            continue
        try:
            ip = safe_ip(str(raw.get("public_ip", "")))
        except ValueError:
            continue
        host_id = str(raw.get("id", ""))
        if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,31}", host_id):
            continue
        result.append({**raw, "id": host_id, "public_ip": ip})
    return result


def host_for_slot(slot: int) -> dict[str, Any]:
    registry = hosts_config()
    hosts = {str(item["id"]): item for item in configured_hosts()}
    host_id = str(registry.get("placements", {}).get(str(slot), ""))
    if not host_id and hosts:
        host_id = list(hosts)[(slot - 1) % len(hosts)]
    if host_id not in hosts:
        raise RuntimeError(f"No Oracle host is assigned to account {slot}.")
    return hosts[host_id]


def private_key() -> str | None:
    configured = os.environ.get("MC_AFK_SSH_KEY")
    candidates = [
        configured,
        str(Path.home() / ".ssh" / "id_ed25519"),
        str(Path.home() / ".ssh" / "id_rsa"),
        "/etc/alt-pilot/peer_ed25519",
    ]
    return next((p for p in candidates if p and Path(p).is_file()), None)


def run(argv: list[str], timeout: int = 30, cwd: Path = ROOT, input_data: str | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(argv, cwd=cwd, text=True, input=input_data, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout, check=False)


def ssh_argv(remote_command: str, slot: int | None = None, host: dict[str, Any] | None = None) -> list[str]:
    target = host or (host_for_slot(slot) if slot is not None else (configured_hosts()[0] if configured_hosts() else {}))
    ip = safe_ip(str(target.get("public_ip", "")))
    if target.get("local") or ip in ("127.0.0.1", "localhost"):
        return ["bash", "-c", remote_command]
    key = private_key()
    if not key:
        raise RuntimeError("No SSH private key found. Set MC_AFK_SSH_KEY or add ~/.ssh/id_ed25519.")
    user = str(target.get("ssh_user", settings()["ssh_user"]))
    if not re.fullmatch(r"[a-z_][a-z0-9_-]{0,31}", user):
        raise RuntimeError("Invalid SSH user in settings.")
    SSH_CONTROL_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        SSH_CONTROL_DIR.chmod(0o700)
        control_dir_stat = SSH_CONTROL_DIR.stat()
    except OSError as exc:
        raise RuntimeError("Could not prepare the private SSH connection cache.") from exc
    if hasattr(os, "getuid") and (control_dir_stat.st_uid != os.getuid() or control_dir_stat.st_mode & 0o077):
        raise RuntimeError("The SSH connection cache has unsafe ownership or permissions.")
    control_path = str(SSH_CONTROL_DIR / "%C")
    return [
        "ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8",
        "-o", "ControlMaster=auto", "-o", "ControlPersist=60",
        "-o", f"ControlPath={control_path}",
        "-o", "StrictHostKeyChecking=accept-new", "-i", key,
        f"{user}@{ip}", remote_command,
    ]


REMOTE_PROBE = r'''set -eu
if command -v afk-health-json >/dev/null 2>&1; then
  exec sudo -n /usr/local/bin/afk-health-json
fi
printf '%s\n' '{"reachable":true,"installed":false,"authenticated":false,"service":"inactive","connected":false,"pid":0,"memory_bytes":0}'
'''


def remote_probe_host(host: dict[str, Any]) -> dict[str, Any]:
    try:
        result = run(ssh_argv(REMOTE_PROBE, host=host), timeout=15)
        if result.returncode != 0:
            return {"reachable": False, "reason": result.stdout.strip()[-500:] or "SSH failed", "host_id": host["id"], "host_name": host.get("name", host["id"])}
        value = json.loads(result.stdout.strip().splitlines()[-1])
        value.update({"host_id": host["id"], "host_name": host.get("name", host["id"])})
        return value
    except (RuntimeError, subprocess.TimeoutExpired, json.JSONDecodeError, ValueError) as exc:
        return {"reachable": False, "reason": str(exc), "host_id": host.get("id", "unknown"), "host_name": host.get("name", "Unknown host")}


def aggregate_health(results: list[tuple[dict[str, Any], dict[str, Any]]]) -> dict[str, Any]:
    registry = hosts_config()
    placements = {int(slot): str(host_id) for slot, host_id in registry.get("placements", {}).items() if str(slot).isdigit()}
    accounts: dict[int, dict[str, Any]] = {}
    host_rows = []
    for host, current in results:
        row = {k: current.get(k) for k in ("reachable", "installed", "memory_total", "memory_available", "swap_total", "swap_used", "disk_used", "reason")}
        row.update({"id": host["id"], "name": host.get("name", host["id"]), "max_online": int(host.get("max_online", 5))})
        host_rows.append(row)
        for account in current.get("accounts", []):
            try:
                slot = int(account.get("slot"))
            except (TypeError, ValueError):
                continue
            if placements.get(slot, host["id"]) != host["id"]:
                continue
            accounts[slot] = {**account, "host_id": host["id"], "host_name": host.get("name", host["id"])}
    ordered = [accounts[slot] for slot in sorted(accounts)]
    reachable_rows = [row for row in host_rows if row.get("reachable")]
    primary = accounts.get(1, {"authenticated": False, "service": "inactive", "enabled": "disabled", "connected": False, "pid": 0, "memory_bytes": 0, "since": ""})
    primary_result = results[0][1] if results else {}
    return {
        "reachable": bool(reachable_rows),
        "cluster_ready": len(reachable_rows) == len(host_rows) and bool(host_rows),
        "installed": bool(host_rows) and all(row.get("installed") for row in host_rows),
        "slots_supported": True,
        "max_accounts": MAX_ACCOUNTS,
        "max_online": sum(row["max_online"] for row in host_rows if row.get("reachable")),
        "accounts": ordered,
        "hosts": host_rows,
        "authenticated": primary.get("authenticated", False), "service": primary.get("service", "inactive"),
        "enabled": primary.get("enabled", "disabled"), "connected": primary.get("connected", False),
        "pid": primary.get("pid", 0), "memory_bytes": primary.get("memory_bytes", 0), "since": primary.get("since", ""),
        "memory_total": sum(int(row.get("memory_total") or 0) for row in reachable_rows),
        "memory_available": sum(int(row.get("memory_available") or 0) for row in reachable_rows),
        "swap_total": sum(int(row.get("swap_total") or 0) for row in reachable_rows),
        "swap_used": sum(int(row.get("swap_used") or 0) for row in reachable_rows),
        "disk_used": sum(int(row.get("disk_used") or 0) for row in reachable_rows),
        "settings": primary_result.get("settings", settings()),
    }


def remote_probe() -> dict[str, Any]:
    hosts = configured_hosts()
    if not hosts:
        return {"reachable": False, "reason": "No VM has been recorded yet.", "hosts": []}
    with ThreadPoolExecutor(max_workers=len(hosts)) as pool:
        currents = list(pool.map(remote_probe_host, hosts))
    return aggregate_health(list(zip(hosts, currents)))


def local_summary(include_oci: bool = False) -> dict[str, Any]:
    vm = state()
    checks = {
        name: {"ok": shutil.which(name) is not None, "detail": shutil.which(name) or "Not installed"}
        for name in ("python3", "oci", "ssh", "jq")
    }
    checks["ssh_key"] = {"ok": private_key() is not None, "detail": private_key() or "No key found"}
    access = read_json(ROOT / ".state" / "remote-access.json", {})
    public_access = {}
    if isinstance(access, dict) and access.get("url"):
        public_access = {"url": str(access["url"]), "username": str(access.get("username", "control")), "password_saved": bool(access.get("password")), "credentials_file": str(ROOT / ".state" / "remote-access.json"), "temporary_url": bool(access.get("temporary_url", True))}
    result: dict[str, Any] = {"checks": checks, "vm": vm, "hosts": configured_hosts(), "settings": settings(), "remote_access": public_access}
    if include_oci and checks["oci"]["ok"]:
        auth = run(["oci", "iam", "region", "list", "--all"], timeout=20)
        result["oci_authenticated"] = auth.returncode == 0
        if vm.get("instance_id") and auth.returncode == 0:
            instance = run(["oci", "compute", "instance", "get", "--instance-id", str(vm["instance_id"])], timeout=20)
            if instance.returncode == 0:
                try:
                    data = json.loads(instance.stdout)["data"]
                    result["instance"] = {k: data.get(k) for k in ("display-name", "shape", "lifecycle-state", "region", "availability-domain", "time-created")}
                except (KeyError, json.JSONDecodeError):
                    pass
    return result


@dataclass
class Task:
    id: str
    action: str
    state: str = "running"
    output: str = ""
    result: dict[str, Any] = field(default_factory=dict)
    started: float = field(default_factory=time.time)
    finished: float | None = None
    auth_slot: int | None = None
    auth_partner: int | None = None
    auth_active_slot: int | None = None
    auth_saved_slots: list[int] = field(default_factory=list)
    cancelled: bool = False
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def public(self) -> dict[str, Any]:
        with self._lock:
            return {"id": self.id, "action": self.action, "state": self.state, "output": self.output[-30000:], "result": dict(self.result), "started": self.started, "finished": self.finished}

    def append(self, value: str) -> None:
        if not value:
            return
        with self._lock:
            self.output = (self.output + value)[-30000:]
            if self.action == "open_auth":
                device_code = extract_device_code(self.output)
                if device_code:
                    self.result["device_code"] = device_code

    def complete(self, output: str, result: dict[str, Any], state: str) -> None:
        with self._lock:
            if output:
                self.output = output[-30000:]
            self.result.update(result)
            self.state = state
            self.finished = time.time()

    def cancel_auth(self, slot: int) -> None:
        with self._lock:
            if self.action != "open_auth" or self.auth_slot not in (None, slot):
                raise ValueError("Sign-in attempt does not match this account.")
            self.auth_slot = slot
            self.cancelled = True


class TaskStore:
    MAX_TASKS = 100
    RETENTION_SECONDS = 60 * 60
    MAX_ACTIVE_TASKS = 8

    def __init__(self) -> None:
        self.tasks: dict[str, Task] = {}
        self.lock = threading.Lock()
        self.active_slots = threading.BoundedSemaphore(self.MAX_ACTIVE_TASKS)

    def _create(self, action: str, fn: Any, streaming: bool) -> Task:
        if not self.active_slots.acquire(blocking=False):
            raise RuntimeError("The control center is busy. Wait for an active operation to finish.")
        task = Task(secrets.token_hex(8), action)
        with self.lock:
            self._prune_locked()
            self.tasks[task.id] = task

        def worker() -> None:
            try:
                output, result = fn(task) if streaming else fn()
                task.complete(output, result, "succeeded")
            except Exception as exc:  # surfaced to the local UI
                task.append(f"\n{type(exc).__name__}: {exc}\n")
                task.complete("", {}, "failed")
            finally:
                self.active_slots.release()

        threading.Thread(target=worker, name=f"task-{task.id}", daemon=True).start()
        return task

    def create(self, action: str, fn: Any) -> Task:
        return self._create(action, fn, False)

    def create_streaming(self, action: str, fn: Any) -> Task:
        return self._create(action, fn, True)

    def get(self, task_id: str) -> Task | None:
        with self.lock:
            self._prune_locked()
            return self.tasks.get(task_id)

    def _prune_locked(self) -> None:
        """Keep short-lived UI task output from becoming an unbounded cache."""
        now = time.time()
        expired = [task_id for task_id, task in self.tasks.items()
                   if task.finished is not None and now - task.finished > self.RETENTION_SECONDS]
        for task_id in expired:
            self.tasks.pop(task_id, None)
        if len(self.tasks) <= self.MAX_TASKS:
            return
        completed = sorted(
            (task for task in self.tasks.values() if task.finished is not None),
            key=lambda task: task.finished or now,
        )
        for task in completed[:max(0, len(self.tasks) - self.MAX_TASKS)]:
            self.tasks.pop(task.id, None)


TOKEN_FILE = Path("/var/lib/alt-pilot/control-token")


def load_or_create_api_token(token_path: Path | None = None) -> str:
    path = token_path or (TOKEN_FILE if TOKEN_FILE.parent.exists() else STATE_DIR / "control-token")
    try:
        if path.exists():
            token = path.read_text(encoding="utf-8").strip()
            if len(token) >= 16:
                return token
    except OSError:
        pass
    token = secrets.token_urlsafe(24)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(token, encoding="utf-8")
        try:
            path.chmod(0o660 if TOKEN_FILE.parent.exists() and path == TOKEN_FILE else 0o600)
        except OSError:
            pass
    except OSError:
        pass
    return token


TASKS = TaskStore()
API_TOKEN = load_or_create_api_token()


def task_command(argv: list[str], timeout: int = 1800) -> tuple[str, dict[str, Any]]:
    result = run(argv, timeout=timeout)
    if result.returncode != 0:
        raise RuntimeError(f"Command exited with {result.returncode}:\n{result.stdout[-12000:]}")
    return result.stdout, {}


def run_streaming(argv: list[str], task: Task, timeout: int = 960) -> int:
    """Run a command while publishing output to its task as soon as it arrives."""
    process = subprocess.Popen(
        argv,
        cwd=ROOT,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    assert process.stdout is not None
    if os.name == "nt":
        for line in iter(process.stdout.readline, b""):
            task.append(line.decode("utf-8", errors="replace"))
        return process.wait(timeout=5)
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ)
    deadline = time.monotonic() + timeout
    try:
        while selector.get_map():
            if task.cancelled:
                raise RuntimeError("Sign-in cancelled.")
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                process.terminate()
                try:
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    process.kill()
                raise TimeoutError("Microsoft sign-in expired. Start it again to get a new code.")
            for key, _ in selector.select(min(0.25, remaining)):
                chunk = os.read(key.fileobj.fileno(), 4096)
                if chunk:
                    task.append(chunk.decode("utf-8", errors="replace"))
                else:
                    selector.unregister(key.fileobj)
        return process.wait(timeout=5)
    finally:
        selector.close()
        if process.poll() is None:
            import signal
            try:
                os.killpg(process.pid, signal.SIGTERM)
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
            except ProcessLookupError:
                pass
        process.stdout.close()


def account_slot(payload: dict[str, Any]) -> int:
    try:
        slot = int(payload.get("slot", 1))
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Account slot must be between 1 and {MAX_ACCOUNTS}.") from exc
    if not 1 <= slot <= MAX_ACCOUNTS:
        raise ValueError(f"Account slot must be between 1 and {MAX_ACCOUNTS}.")
    return slot


def unit_for_slot(slot: int) -> str:
    return "alt-pilot.service" if slot == 1 else f"alt-pilot@{slot}.service"


def account_name(probe: dict[str, Any], slot: int, fallback: str | None = None) -> str:
    return next((acc.get("name") for acc in probe.get("accounts", []) if int(acc.get("slot", 0)) == slot and acc.get("name")), fallback or f"Account {slot}")


def service_message(action: str, name: str) -> str:
    if action == "start":
        return f"{name} start accepted. Minecraft is loading on the VM; Overview will update automatically.\n"
    if action == "restart":
        return f"{name} restart accepted. Minecraft is loading again; Overview will update automatically.\n"
    return f"{name} stop accepted.\n"


def all_accounts(action: str, probe: dict[str, Any], service: Any, refresh: Any) -> tuple[str, dict[str, Any]]:
    slots = [int(account["slot"]) for account in probe.get("accounts", []) if account.get("authenticated")]
    if not slots:
        raise RuntimeError("No signed-in account is available.")
    if action == "start" and len(slots) > int(probe.get("max_online", MAX_ONLINE_ACCOUNTS)):
        raise RuntimeError("The signed-in accounts exceed the cluster's current online capacity.")
    return "".join(service(action, slot)[0] for slot in slots), refresh()


def pre_start_warnings(probe: dict[str, Any], settings: dict[str, Any], slot: int) -> list[str]:
    warnings: list[str] = []
    account = next((acc for acc in probe.get("accounts", []) if int(acc.get("slot", 0)) == slot), None)
    player_name = (account or {}).get("name", "")
    if not player_name:
        return warnings
    if account and account.get("connected"):
        warnings.append(
            f"{player_name} is already connected through this system. "
            f"Restarting will briefly disconnect and reconnect the session."
        )
    server_addr = settings.get("minecraft_server", "eu.mc-complex.com")
    host, port = server_addr, 25565
    if ":" in server_addr:
        host, port_str = server_addr.rsplit(":", 1)
        try:
            port = int(port_str)
        except ValueError:
            port = 25565
    result = mc_server_ping.ping(host, port, timeout=3.0)
    if not result.error and result.sample and not (account and account.get("connected")):
        if player_name.lower() in [name.lower() for name in result.sample]:
            warnings.append(
                f'"{player_name}" appears to be online on {server_addr} right now. '
                f"Starting the alt will disconnect that session."
            )
    return warnings


def validate_communication(payload: dict[str, Any]) -> tuple[int, str, str]:
    slot = account_slot(payload)
    mode = str(payload.get("mode", ""))
    if mode not in ("command", "chat", "action"):
        raise ValueError("Choose command, chat, or action mode.")
    message = str(payload.get("message", "")).strip()
    if mode == "command":
        message = message.removeprefix("/").strip()
    elif mode == "action":
        if message not in ("use_item", "drop_item", "use", "drop"):
            raise ValueError("Supported actions are use_item and drop_item.")
    if not message:
        raise ValueError("Enter a slash command." if mode == "command" else "Enter a chat message.")
    if len(message) > MAX_COMMUNICATION_LENGTH:
        raise ValueError(f"Minecraft messages are limited to {MAX_COMMUNICATION_LENGTH} characters.")
    if any(ord(character) < 32 or ord(character) == 127 for character in message):
        raise ValueError("Messages cannot contain control characters or line breaks.")
    return slot, mode, message


def claim_communication_slot(slot: int) -> None:
    now = time.monotonic()
    with _COMMUNICATION_LOCK:
        if now - _COMMUNICATION_LAST_SENT.get(slot, 0.0) < 1.0:
            raise ValueError("Wait a moment before sending another message.")
        _COMMUNICATION_LAST_SENT[slot] = now


def task_service(action: str, slot: int = 1) -> tuple[str, dict[str, Any]]:
    probe = remote_probe()
    name = account_name(probe, slot)
    result = run(ssh_argv(f"sudo -n /usr/local/sbin/alt-pilot-account-service {action} {slot}", slot=slot), timeout=45)
    if result.returncode != 0:
        raise RuntimeError(result.stdout.strip() or f"Could not {action} {name}")
    new_probe = remote_probe()
    return result.stdout or service_message(action, account_name(new_probe, slot, name)), new_probe


def task_all(action: str) -> tuple[str, dict[str, Any]]:
    return all_accounts(action, remote_probe(), task_service, remote_probe)


def task_logs() -> tuple[str, dict[str, Any]]:
    cmd = "sudo -n /usr/local/bin/afk-control-logs"
    output = []
    for host in configured_hosts():
        result = run(ssh_argv(cmd, host=host), timeout=20)
        output.append(f"\n[{host.get('name', host['id'])}]\n{result.stdout}")
    return "".join(output), remote_probe()


def console_history(slot: int) -> dict[str, Any]:
    result = run(ssh_argv(f"sudo -n /usr/local/bin/afk-console-log {slot}", slot=slot), timeout=10)
    return {"slot": slot, "lines": result.stdout.splitlines()[-120:]}


def task_communicate(payload: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    slot, mode, message = validate_communication(payload)
    claim_communication_slot(slot)
    result = run(
        ssh_argv(f"sudo -n /usr/local/sbin/alt-pilot-send {mode} {slot}", slot=slot),
        timeout=10,
        input_data=message + "\n",
    )
    if result.returncode != 0:
        raise RuntimeError(result.stdout.strip() or f"Could not send to account {slot}.")
    if mode == "action":
        action_name = "Used held item" if message in ("use_item", "use") else "Dropped held item"
        confirmation = f"{action_name} for account {slot}.\n"
    else:
        confirmation = f"Sent {'/' if mode == 'command' else ''}{message} to the server.\n"

    return confirmation, {"slot": slot}


def send_home_alt_all(probe: dict[str, Any], sender: Any) -> tuple[str, dict[str, Any]]:
    """Send the fixed command once to each connected account that can receive it."""
    targets = [account for account in probe.get("accounts", [])
               if account.get("connected") and account.get("communication_ready")]
    if not targets:
        raise ValueError("No online accounts are ready for commands.")
    results = []
    for account in targets:
        slot = int(account["slot"])
        name = account.get("name") or f"Account {slot}"
        try:
            sender({"slot": slot, "mode": "command", "message": "/home alt"})
            results.append({"slot": slot, "name": name, "sent": True})
        except Exception as exc:
            results.append({"slot": slot, "name": name, "sent": False, "error": str(exc)})
    sent = sum(item["sent"] for item in results)
    output = "\n".join(f"{item['name']}: {'sent /home alt' if item['sent'] else 'failed - ' + item['error']}" for item in results) + "\n"
    return output, {"sent": sent, "total": len(results), "accounts": results}


def task_home_alt_all() -> tuple[str, dict[str, Any]]:
    return send_home_alt_all(remote_probe(), task_communicate)


def _validate_reorder_order(payload: dict[str, Any]) -> list[int]:
    order = payload.get("order")
    if not isinstance(order, list) or not order:
        raise ValueError("order must be a list of saved slot numbers.")
    try:
        parsed = [int(value) for value in order]
    except (TypeError, ValueError) as exc:
        raise ValueError("order entries must be integers.") from exc
    if any(not 1 <= slot <= MAX_ACCOUNTS for slot in parsed):
        raise ValueError(f"Slot numbers must be between 1 and {MAX_ACCOUNTS}.")
    if len(parsed) != len(set(parsed)):
        raise ValueError("order entries must be unique.")
    return parsed


def _reorder_move_pairs(parsed: list[int], saved_slots: set[int]) -> list[tuple[int, int]]:
    moves: list[tuple[int, int]] = []
    for new_slot, old_slot in enumerate(parsed, start=1):
        if old_slot == new_slot:
            continue
        if old_slot not in saved_slots and new_slot not in saved_slots:
            continue
        moves.append((old_slot, new_slot))
    return moves


def task_reorder_slots(payload: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    parsed = _validate_reorder_order(payload)
    health = remote_probe()
    saved_slots: set[int] = {
        int(acc["slot"])
        for acc in (health.get("accounts") or [])
        if acc.get("authenticated") and acc.get("slot") is not None
    }
    if set(parsed) != saved_slots:
        raise ValueError(
            "order must be a permutation of the currently signed-in account slots: "
            + ", ".join(str(s) for s in sorted(saved_slots))
        )
    moves = _reorder_move_pairs(parsed, saved_slots)

    registry = hosts_config()
    placements = dict(registry.get("placements") or {})
    hosts = configured_hosts()
    host_ids = {host["id"] for host in hosts}

    def host_for(slot: int) -> str | None:
        host_id = placements.get(str(slot))
        if host_id in host_ids:
            return host_id
        if hosts:
            return sorted(host_ids)[(slot - 1) % len(host_ids)]
        return None

    account_hosts: dict[int, str] = {slot: host_for(slot) for slot in saved_slots}

    by_host: dict[str, list[tuple[int, int]]] = {}
    for old_slot, new_slot in moves:
        host_id = account_hosts.get(old_slot)
        if not host_id:
            continue
        by_host.setdefault(host_id, []).append((old_slot, new_slot))

    for host in hosts:
        host_moves = by_host.get(host["id"]) or []
        if not host_moves:
            continue
        pairs = [f"{o}:{n}" for o, n in host_moves]
        pair_argv = " ".join(pairs)
        if host.get("local"):
            argv = ["sudo", "-n", "/usr/local/sbin/alt-pilot-reorder", *pairs]
        else:
            argv = ssh_argv(f"reorder {pair_argv}", host=host)
        result = run(argv, timeout=180)
        if result.returncode != 0:
            raise RuntimeError(
                f"Reorder on {host.get('name', host['id'])} failed: {result.stdout.strip()}"
            )

    placements_new: dict[str, str] = {}
    for new_slot, old_slot in enumerate(parsed, start=1):
        if old_slot in saved_slots:
            placements_new[str(new_slot)] = account_hosts[old_slot]
    registry["placements"] = {k: v for k, v in placements_new.items() if v}
    atomic_json(HOSTS_FILE, registry)

    return (
        "Account order updated. Restart the clients you want online.\n",
        remote_probe(),
    )


def task_save_settings(payload: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    candidate = {k: str(payload.get(k, settings()[k])).strip() for k in DEFAULTS}
    if not re.fullmatch(r"[a-z_][a-z0-9_-]{0,31}", candidate["ssh_user"]):
        raise ValueError("SSH user is invalid.")
    if not valid_minecraft_server(candidate["minecraft_server"]):
        raise ValueError("Server must be a valid hostname or IPv4 address, optionally followed by :port.")
    if not VERSION_RE.fullmatch(candidate["minecraft_version"]):
        raise ValueError("Minecraft version contains unsupported characters.")
    if not HEAP_RE.fullmatch(candidate["heap_min"]) or not HEAP_RE.fullmatch(candidate["heap_max"]):
        raise ValueError("Heap values must use one of the supported conservative sizes.")
    if int(candidate["heap_min"][:-1]) > int(candidate["heap_max"][:-1]):
        raise ValueError("Minimum heap cannot exceed maximum heap.")
    if int(candidate["heap_max"][:-1]) > 512:
        raise ValueError("This 1 GB VM is capped at a 512 MB Java heap.")
    atomic_json(SETTINGS_FILE, candidate)
    if configured_hosts() and remote_probe().get("reachable"):
        env = "\n".join([
            f"MC_VERSION={candidate['minecraft_version']}",
            f"MC_SERVER={candidate['minecraft_server']}",
            f"JVM_HEAP_XMS={candidate['heap_min']}",
            f"JVM_HEAP_XMX={candidate['heap_max']}",
        ]) + "\n"
        encoded = __import__("base64").b64encode(env.encode()).decode()
        remote = f"printf %s {shlex.quote(encoded)} | base64 -d | sudo -n tee /etc/alt-pilot/options.env >/dev/null && sudo -n chmod 640 /etc/alt-pilot/options.env && sudo -n chown root:mc /etc/alt-pilot/options.env"
        failures = []
        for host in configured_hosts():
            result = run(ssh_argv(remote, host=host), timeout=20)
            if result.returncode != 0:
                failures.append(str(host.get("name", host["id"])))
        if failures:
            raise RuntimeError("Saved locally, but could not update: " + ", ".join(failures))
    return "Settings saved. Restart the client to apply changed runtime settings.\n", {"settings": candidate}


def validate_account_settings(payload: dict[str, Any]) -> dict[str, Any]:
    slot = account_slot(payload)
    startup_enabled = bool(payload.get("startup_command_enabled", False))
    startup_cmd = str(payload.get("startup_command", "/home alt")).strip()
    if startup_cmd and not startup_cmd.startswith("/"):
        startup_cmd = f"/{startup_cmd}"
    if not startup_cmd:
        startup_cmd = "/home alt"
    if len(startup_cmd) > MAX_COMMUNICATION_LENGTH:
        raise ValueError(f"Startup command is limited to {MAX_COMMUNICATION_LENGTH} characters.")
    if any(ord(c) < 32 or ord(c) == 127 for c in startup_cmd):
        raise ValueError("Startup command cannot contain control characters.")
    try:
        startup_delay = int(payload.get("startup_delay", 5))
    except (TypeError, ValueError) as exc:
        raise ValueError("Startup delay must be an integer between 0 and 60 seconds.") from exc
    if not 0 <= startup_delay <= 60:
        raise ValueError("Startup delay must be between 0 and 60 seconds.")

    tpa_auto_accept = bool(payload.get("tpa_auto_accept", False))
    tpa_whitelist_str = str(payload.get("tpa_whitelist") or "").strip()
    if len(tpa_whitelist_str) > 500:
        raise ValueError("TPA whitelist cannot exceed 500 characters.")
    if any(ord(c) < 32 or ord(c) == 127 for c in tpa_whitelist_str):
        raise ValueError("TPA whitelist cannot contain control characters.")
    names = []
    for item in re.split(r"[, \t]+", tpa_whitelist_str):
        name = item.strip()
        if not name:
            continue
        if not re.fullmatch(r"\.?[a-zA-Z0-9_]{1,32}", name):
            raise ValueError(f"Invalid Minecraft username in whitelist: '{name}'")
        if name not in names:
            names.append(name)
    if not names and tpa_auto_accept:
        raise ValueError("TPA auto-accept requires an explicit non-empty whitelist.")
    tpa_whitelist = ", ".join(names)

    raw_purpose = payload.get("purpose")
    purpose = str(raw_purpose or "").strip()
    if len(purpose) > 32:
        raise ValueError("Purpose cannot exceed 32 characters.")
    if any(ord(c) < 32 or ord(c) == 127 for c in purpose):
        raise ValueError("Purpose cannot contain control characters.")

    return {
        "slot": slot,
        "startup_command_enabled": startup_enabled,
        "startup_command": startup_cmd,
        "startup_delay": startup_delay,
        "tpa_auto_accept": tpa_auto_accept,
        "tpa_whitelist": tpa_whitelist,
        "purpose": purpose,
    }


def task_save_account_settings(payload: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    validated = validate_account_settings(payload)
    slot = validated["slot"]
    enabled_flag = "1" if validated["startup_command_enabled"] else "0"
    delay_val = str(validated["startup_delay"])
    cmd_val = validated["startup_command"]
    tpa_flag = "1" if validated["tpa_auto_accept"] else "0"
    tpa_wl = validated["tpa_whitelist"]
    purpose_val = validated["purpose"]
    remote_cmd = (
        f"sudo -n /usr/local/sbin/alt-pilot-set-account-options "
        f"{slot} {enabled_flag} {delay_val} {shlex.quote(cmd_val)} {tpa_flag} {shlex.quote(tpa_wl)} {shlex.quote(purpose_val)}"
    )
    result = run(ssh_argv(remote_cmd, slot=slot), timeout=20)
    if result.returncode != 0:
        raise RuntimeError(result.stdout.strip() or f"Could not save settings for account {slot}.")
    new_probe = remote_probe()
    name = account_name(new_probe, slot)
    sync_all = bool(payload.get("sync_all_accounts") or payload.get("apply_all_slots") or payload.get("tpa_sync_all"))
    if sync_all:
        for acc in new_probe.get("accounts", []):
            other_slot = acc.get("slot")
            if not other_slot or other_slot == slot or not acc.get("authenticated") or not acc.get("name"):
                continue
            other_settings = acc.get("settings", {})
            other_enabled = "1" if other_settings.get("startup_command_enabled") else "0"
            other_delay = str(other_settings.get("startup_delay", 5))
            other_cmd = other_settings.get("startup_command", "/home alt")
            other_purpose = other_settings.get("purpose", "")
            other_remote_cmd = (
                f"sudo -n /usr/local/sbin/alt-pilot-set-account-options "
                f"{other_slot} {other_enabled} {other_delay} {shlex.quote(other_cmd)} {tpa_flag} {shlex.quote(tpa_wl)} {shlex.quote(other_purpose)}"
            )
            run(ssh_argv(other_remote_cmd, slot=other_slot), timeout=20)
        new_probe = remote_probe()
        return (
            f"Settings saved for {name} and whitelist synced to all accounts. "
            "TPA auto-accept takes effect live on all running clients without restarting; "
            "startup command and purpose apply on the next login.\n"
        ), new_probe

    return (
        f"Settings saved for {name}. "
        "TPA auto-accept takes effect live on the running client without restarting; "
        "startup command and purpose apply on the next login.\n"
    ), new_probe


def validate_new_password(payload: dict[str, Any]) -> str:
    password = str(payload.get("new_password", ""))
    confirmation = str(payload.get("confirm_password", ""))
    if password != confirmation:
        raise ValueError("The password confirmation does not match.")
    if not 12 <= len(password) <= 128:
        raise ValueError("Choose a password between 12 and 128 characters.")
    return password


def task_change_password(payload: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    password = validate_new_password(payload)
    result = run(
        ssh_argv("sudo -n /usr/bin/python3 /opt/alt-pilot/control/remote_control.py --set-password-stdin"),
        timeout=20,
        input_data=password,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stdout.strip() or "Could not change the remote-control password.")
    access_file = ROOT / ".state" / "remote-access.json"
    access = read_json(access_file, {})
    if isinstance(access, dict):
        # The plaintext password is stored only so the local dashboard can
        # re-authenticate after the tunnel address rotates. The file MUST stay
        # mode 0600 (owner-only). Wipe it if you no longer want this behaviour.
        access["password"] = password
        atomic_json(access_file, access)
        os.chmod(access_file, 0o600)
    return "Control password changed. All signed-in sessions were signed out.\n", {}


def account_edition(payload: dict[str, Any]) -> str:
    edition = payload.get("edition", "java")
    if edition not in ("java", "bedrock", "both"):
        raise ValueError("Choose Java, Bedrock, or both before signing in.")
    return edition


def next_free_slot(health: dict[str, Any], occupied: int) -> int | None:
    taken = set()
    for account in health.get("accounts") or []:
        if not account.get("authenticated"):
            continue
        try:
            taken.add(int(account["slot"]))
        except (TypeError, ValueError, KeyError):
            continue
    taken.add(int(occupied))
    for slot in range(1, MAX_ACCOUNTS + 1):
        if slot not in taken:
            return slot
    return None


def finalize_saved_login(task: Task, slot: int, health: dict[str, Any], signout) -> dict[str, Any]:
    require_saved_account(health, slot)
    duplicate = find_duplicate_account(health, slot)
    if duplicate is not None:
        cleanup = signout(slot)
        task.append("\nDetected an existing saved account for this Minecraft profile; removing the new session.\n")
        extra = ""
        stdout = getattr(cleanup, "stdout", "") or ""
        if getattr(cleanup, "returncode", 0):
            extra = f" (mc-signout: {stdout.strip()})"
        raise RuntimeError(
            f"'{duplicate['name']}' is already saved as Account {duplicate['slot']}. "
            f"Sign out of Account {duplicate['slot']} first if you want to move the Microsoft account here."
            + extra
        )
    return health


def run_edition_logins(task: Task, slot: int, edition: str, login, probe, signout) -> tuple[str, dict[str, Any]]:
    """Run Java, Bedrock, or both. `login(slot, edition)` returns a process exit code."""
    task.auth_slot = slot
    created: list[int] = []

    def checked_probe() -> dict[str, Any]:
        current = probe()
        if current.get("health_stale") or current.get("reachable") is False or current.get("cluster_ready") is False:
            raise RuntimeError("Account status could not be verified. No account was added; please try again.")
        return current

    def verified_login(target: int, target_edition: str, reuse_java: bool = False) -> tuple[dict[str, Any], int | None]:
        if task.cancelled:
            raise RuntimeError("Sign-in cancelled.")
        if any(int(account.get("slot", 0)) == target and account.get("authenticated")
               for account in checked_probe().get("accounts", [])):
            raise RuntimeError("This account position is already in use. Refresh and try again.")
        task.auth_active_slot = target
        try:
            code = login(target, target_edition)
        except Exception:
            # SSH can fail after the remote process commits. In that case this
            # attempt still owns the newly saved account and must roll it back.
            try:
                require_saved_account(checked_probe(), target)
            except Exception:
                pass
            else:
                created.append(target)
                task.auth_saved_slots.append(target)
            raise
        finally:
            task.auth_active_slot = None
        # The remote login may have saved credentials just before a transport
        # error or cancellation. Record ownership before probing/validation.
        if code == 0:
            created.append(target)
            task.auth_saved_slots.append(target)
        else:
            try:
                require_saved_account(checked_probe(), target)
            except RuntimeError:
                pass
            else:
                created.append(target)
                task.auth_saved_slots.append(target)
            raise RuntimeError(login_failure(task.output, code))
        health = checked_probe()
        require_saved_account(health, target)
        duplicate = find_duplicate_account(health, target)
        if reuse_java and duplicate is not None:
            # The user has already added this Java identity. Discard only the
            # temporary duplicate and use its position for Bedrock instead.
            cleanup = signout(target)
            if getattr(cleanup, "returncode", 0):
                raise RuntimeError(f"Could not discard the temporary Java sign-in: {getattr(cleanup, 'stdout', '').strip()}")
            created.remove(target)
            task.auth_saved_slots.remove(target)
            if task.cancelled:
                raise RuntimeError("Sign-in cancelled.")
            return health, int(duplicate["slot"])
        health = finalize_saved_login(task, target, health, signout)
        if task.cancelled:
            raise RuntimeError("Sign-in cancelled.")
        return health, None

    try:
        if edition == "both":
            task.result["auth_edition"] = "both"
            task.result["auth_stage"] = "java"
            task.append("Verifying Java first. If this Java account is already saved, it will be reused.\n")
            _, existing_java = verified_login(slot, "java", reuse_java=True)
            if existing_java is not None:
                bedrock_slot = slot
                task.append("Java is already saved. Approve the Bedrock code to add its second edition.\n")
            else:
                bedrock_slot = next_free_slot(checked_probe(), slot)
                if bedrock_slot is None:
                    raise RuntimeError("Java was verified, but a second account cannot be added because the account limit is reached. No new account was kept.")
                task.auth_partner = bedrock_slot
                task.append("Java verified. Approve the Bedrock code to finish adding both editions.\n")
            task.result["auth_stage"] = "bedrock"
            task.result.pop("device_code", None)
            health, _ = verified_login(bedrock_slot, "bedrock")
            if task.cancelled:
                raise RuntimeError("Sign-in cancelled.")
            return "", {**health, "java_slot": existing_java or slot, "paired_slot": bedrock_slot, "reused_java": existing_java is not None}
        health, _ = verified_login(slot, edition)
        return "", health
    except Exception:
        cleanup_failures = []
        for target in reversed(created):
            try:
                cleanup = signout(target)
                if getattr(cleanup, "returncode", 0):
                    cleanup_failures.append(f"account {target}: {getattr(cleanup, 'stdout', '').strip()}")
                else:
                    task.auth_saved_slots.remove(target)
            except Exception as error:
                cleanup_failures.append(f"account {target}: {error}")
        if cleanup_failures:
            raise RuntimeError("Sign-in failed and cleanup needs attention: " + "; ".join(cleanup_failures))
        raise


def require_saved_account(health: dict[str, Any], slot: int) -> None:
    if not any(int(a.get("slot", 0)) == slot and a.get("authenticated")
               for a in health.get("accounts", [])):
        raise RuntimeError("Sign-in finished but no verified Minecraft account was saved. Please try again.")


def login_failure(output: str, returncode: int) -> str:
    lines = [line.strip() for line in output.splitlines() if line.strip()]
    return lines[-1] if lines else f"Sign-in failed (exit {returncode}). Please try again."


def task_cancel_auth(slot: int = 1) -> tuple[str, dict[str, Any]]:
    ssh = ssh_argv(f"sudo -n -u mc -H /usr/local/bin/mc-login {slot} cancel", slot=slot)
    result = run(ssh, timeout=15)
    if result.returncode != 0:
        raise RuntimeError(result.stdout.strip() or f"Could not cancel sign-in for account {slot}")
    return result.stdout.strip() + "\n", {}


def task_open_auth(task: Task, slot: int = 1, mode: str = "local", edition: str = "java") -> tuple[str, dict[str, Any]]:
    # Use the same browser-native flow locally and remotely. `mode` remains in
    # the API for compatibility with older installed control pages.

    def login(target: int, target_edition: str) -> int:
        try:
            task_cancel_auth(target)
        except Exception:
            pass
        ssh = ssh_argv(f"sudo -n -u mc -H /usr/local/bin/mc-login {target} {target_edition}", slot=target)
        ssh.insert(1, "-tt")
        task.append(f"Preparing Microsoft sign-in for account {target}…\n")
        return run_streaming(ssh, task)

    def signout(target: int):
        return run(ssh_argv(f"sudo -n -u mc -H /usr/local/bin/mc-signout {target}", slot=target), timeout=15)

    return run_edition_logins(task, slot, edition, login, remote_probe, signout)


def cancel_auth_attempt(task_id: str, slot: int, cancel, signout) -> tuple[str, dict[str, Any]]:
    attempt = TASKS.get(task_id)
    if attempt is None:
        raise ValueError("Sign-in attempt expired. Refresh account status before retrying.")
    attempt.cancel_auth(slot)
    # Cancel only the phase this task is actually running. A reserved second
    # position may now belong to a different browser's sign-in.
    targets = [attempt.auth_active_slot] if attempt.auth_active_slot is not None else []
    failures = []
    for target in targets:
        try:
            cancel(target)
        except Exception as error:
            failures.append(str(error))
    deadline = time.monotonic() + 20
    while attempt.state == "running" and time.monotonic() < deadline:
        time.sleep(0.05)
    if attempt.state == "running":
        failures.append("The sign-in has not stopped yet. Refresh account status before retrying.")
    # Completion can beat the browser's close request. Retry rollback after
    # a failed cleanup too, but never touch an older saved account.
    if attempt.state != "running":
        for target in reversed(attempt.auth_saved_slots):
            result = signout(target)
            if getattr(result, "returncode", 0):
                failures.append(f"Could not remove account {target}: {result.stdout.strip()}")
            else:
                attempt.auth_saved_slots.remove(target)
    if failures:
        raise RuntimeError("Could not stop sign-in: " + "; ".join(failures))
    return "Sign-in cancelled.\n", {}


def find_duplicate_account(health: dict[str, Any], slot: int) -> dict[str, Any] | None:
    """Return the already-saved account whose Minecraft name matches `slot`.

    The Minecraft profile name is the only public, globally-unique identifier
    Microsoft exposes after device-code auth, and it is what the dashboard uses
    to label accounts, so a name match is the same Microsoft account.
    """
    accounts = health.get("accounts") or []
    signed = next((account for account in accounts if int(account.get("slot", 0)) == slot), None)
    name = (signed or {}).get("name") or ""
    if not name:
        return None
    for other in accounts:
        if int(other.get("slot", 0)) == slot:
            continue
        if other.get("edition", "java") != (signed or {}).get("edition", "java"):
            continue
        same_xuid = bool((signed or {}).get("xuid")) and other.get("xuid") == signed["xuid"]
        if same_xuid or (other.get("name") and other["name"].casefold() == name.casefold()):
            return other
    return None


def task_sign_out(slot: int) -> tuple[str, dict[str, Any]]:
    # Stop the service first; a running JVM keeps its auth file descriptor open.
    run(ssh_argv(f"sudo -n /usr/local/sbin/alt-pilot-account-service stop {slot}", slot=slot), timeout=30)
    result = run(ssh_argv(f"sudo -n -u mc -H /usr/local/bin/mc-signout {slot}", slot=slot), timeout=15)
    if result.returncode != 0:
        raise RuntimeError(result.stdout.strip() or f"Could not sign out account {slot}")
    time.sleep(2)
    return f"{result.stdout.strip()}\n", remote_probe()


def task_pre_start_check(slot: int) -> tuple[str, dict[str, Any]]:
    """Check whether the account for *slot* is already online on the server.

    Uses Minecraft Server List Ping to look for the player's username in the
    server's player sample.  Returns a list of warning strings (empty when
    no issues are detected).  This is best-effort: the SLP sample is capped
    and some servers hide it entirely.
    """
    warnings = pre_start_warnings(remote_probe(), settings(), slot)
    return json.dumps({"warnings": warnings}), {"warnings": warnings}


def build_task(action: str, payload: dict[str, Any]) -> Task:
    if action == "preflight":
        def preflight() -> tuple[str, dict[str, Any]]:
            summary = local_summary(True)
            return json.dumps(summary, indent=2), summary
        return TASKS.create(action, preflight)
    if action == "dry_run":
        return TASKS.create(action, lambda: task_command([str(ROOT / "setup-afk.sh"), "--dry-run"]))
    if action == "provision":
        if payload.get("confirmation") != "ALWAYS FREE":
            raise ValueError("Type ALWAYS FREE to authorize provisioning.")
        return TASKS.create(action, lambda: task_command([str(ROOT / "setup-afk.sh"), "--apply"], 2400))
    if action == "repair_vm":
        return TASKS.create(action, lambda: task_command([str(ROOT / "setup-afk.sh"), "--configure-existing"], 1800))
    if action == "pre_start_check":
        slot = account_slot(payload)
        return TASKS.create(action, lambda: task_pre_start_check(slot))
    if action in ("start", "stop", "restart"):
        slot = account_slot(payload)
        return TASKS.create(action, lambda: task_service(action, slot))
    if action in ("start_all", "start_both"):
        return TASKS.create(action, lambda: task_all("start"))
    if action in ("stop_all", "stop_both"):
        return TASKS.create(action, lambda: task_all("stop"))
    if action == "logs":
        return TASKS.create(action, task_logs)
    if action == "communicate":
        return TASKS.create(action, lambda: task_communicate(payload))
    if action == "home_alt_all":
        return TASKS.create(action, task_home_alt_all)
    if action == "save_settings":
        return TASKS.create(action, lambda: task_save_settings(payload))
    if action == "save_account_settings":
        return TASKS.create(action, lambda: task_save_account_settings(payload))
    if action == "reorder_slots":
        return TASKS.create(action, lambda: task_reorder_slots(payload))
    if action == "change_password":
        return TASKS.create(action, lambda: task_change_password(payload))
    if action == "open_auth":
        slot = account_slot(payload)
        mode = payload.get("mode", "local")
        edition = account_edition(payload)
        return TASKS.create_streaming(action, lambda task: task_open_auth(task, slot, mode, edition))
    if action == "cancel_auth":
        slot = account_slot(payload)
        if payload.get("task_id"):
            def signout(target: int):
                return run(ssh_argv(f"sudo -n -u mc -H /usr/local/bin/mc-signout {target}", slot=target), timeout=15)
            return TASKS.create(action, lambda: cancel_auth_attempt(str(payload["task_id"]), slot, task_cancel_auth, signout))
        return TASKS.create(action, lambda: task_cancel_auth(slot))
    if action == "sign_out":
        slot = account_slot(payload)
        return TASKS.create(action, lambda: task_sign_out(slot))
    raise ValueError("Unknown action.")


class Handler(BaseHTTPRequestHandler):
    server_version = "ALTPilotControl/1.0"

    def allowed_request_host(self) -> bool:
        # A malicious site can resolve its own hostname to loopback (DNS
        # rebinding). Binding to 127.0.0.1 alone does not protect the bootstrap
        # endpoint that returns the control token and cloud metadata.
        try:
            authority = urlparse("http://" + self.headers.get("Host", ""))
            return (
                authority.hostname in ("127.0.0.1", "localhost", "::1")
                and authority.username is None and authority.password is None
                and not authority.path and not authority.query and not authority.fragment
                and (authority.port or 80) == self.server.server_address[1]
            )
        except ValueError:
            return False

    def parse_request(self) -> bool:
        if not super().parse_request():
            return False
        if not self.allowed_request_host():
            self.json_response({"error": "Untrusted Host header"}, 403)
            return False
        return True

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"[{self.log_date_time_string()}] {fmt % args}")

    def json_response(self, value: Any, status: int = 200) -> None:
        data = json.dumps(value, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            # Browsers may abandon a slow status refresh during navigation.
            # That is not an application error and should not produce a noisy
            # server traceback.
            return

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/api/bootstrap":
            self.json_response({"token": API_TOKEN, "local": local_summary(), "remote": remote_probe()})
            return
        if path == "/api/status":
            self.json_response({"token": API_TOKEN, "local": local_summary(), "remote": remote_probe()})
            return
        if path == "/api/availability":
            days = parse_qs(parsed.query).get("days", ["1"])[0]
            if days not in ("1", "7", "30"):
                self.json_response({"error": "Choose 1, 7 or 30 days"}, 400)
            elif AVAILABILITY is None:
                self.json_response({"error": "Availability monitoring is unavailable"}, 503)
            else:
                self.json_response(AVAILABILITY.report(int(days)))
            return
        if path == "/api/console":
            slot = account_slot({"slot": parse_qs(parsed.query).get("slot", ["1"])[0]})
            self.json_response(console_history(slot))
            return
        if path.startswith("/api/tasks/"):
            task = TASKS.get(path.rsplit("/", 1)[-1])
            self.json_response(task.public() if task else {"error": "Task not found"}, 200 if task else 404)
            return
        self.serve_static(path)

    def do_POST(self) -> None:
        if urlparse(self.path).path != "/api/actions":
            self.json_response({"error": "Not found"}, 404)
            return
        if self.headers.get("X-Control-Token") != API_TOKEN:
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
        if length and self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower() != "application/json":
            self.json_response({"error": "Content-Type must be application/json"}, 415)
            return
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
            if not isinstance(payload, dict):
                raise ValueError("Request body must be a JSON object.")
            task = build_task(str(payload.get("action", "")), payload)
            self.json_response({"task": task.public()}, 202)
        except (ValueError, RuntimeError, json.JSONDecodeError) as exc:
            self.json_response({"error": str(exc)}, 400)

    def serve_static(self, path: str) -> None:
        relative = "index.html" if path in ("", "/") else path.lstrip("/")
        target = (WEB_ROOT / relative).resolve()
        try:
            target.relative_to(WEB_ROOT.resolve())
        except ValueError:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        if not target.is_file():
            if target.suffix:
                self.send_error(HTTPStatus.NOT_FOUND)
                return
            target = WEB_ROOT / "index.html"
        # Revalidate instead of re-sending: the item atlas is ~0.7 MB, so a
        # matching ETag must return 304 without reading the body.
        stat = target.stat()
        etag = f'"{int(stat.st_mtime)}-{stat.st_size}"'
        if self.headers.get("If-None-Match") == etag:
            self.send_response(HTTPStatus.NOT_MODIFIED)
            self.send_header("ETag", etag)
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            return
        data = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", MIME.get(target.suffix, "application/octet-stream"))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("ETag", etag)
        self.send_header("Content-Security-Policy", "default-src 'self'; img-src 'self' data: https://mc-heads.net; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Permissions-Policy", "geolocation=(), microphone=(), camera=(), payment=()")
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            return


class BoundedThreadingHTTPServer(ThreadingHTTPServer):
    """Threaded server with a finite connection budget for small VM deployments."""
    daemon_threads = True
    block_on_close = False
    request_queue_size = 32

    def __init__(self, address: tuple[str, int], handler: type[BaseHTTPRequestHandler], max_workers: int = 16) -> None:
        self._request_slots = threading.BoundedSemaphore(max_workers)
        super().__init__(address, handler)

    def get_request(self) -> tuple[socket.socket, tuple[str, int]]:
        request, client_address = super().get_request()
        request.settimeout(15)
        return request, client_address

    def process_request(self, request: socket.socket, client_address: tuple[str, int]) -> None:
        if not self._request_slots.acquire(blocking=False):
            request.close()
            return
        super().process_request(request, client_address)

    def process_request_thread(self, request: socket.socket, client_address: tuple[str, int]) -> None:
        try:
            super().process_request_thread(request, client_address)
        finally:
            self._request_slots.release()


def pick_port(host: str, requested: int) -> int:
    if requested:
        return requested
    with socket.socket() as sock:
        sock.bind((host, 0))
        return int(sock.getsockname()[1])


AVAILABILITY: Tracker | None = None


def start_availability(path: Path, probe) -> None:
    global AVAILABILITY
    AVAILABILITY = Tracker(path)
    AVAILABILITY.start(probe)


def main() -> None:
    parser = argparse.ArgumentParser(description="ALT Pilot local control center")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    if args.host not in ("127.0.0.1", "::1", "localhost"):
        raise SystemExit("Refusing to bind outside loopback.")
    harden_state_directory()
    start_availability(STATE_DIR / "availability.sqlite3", remote_probe)
    port = pick_port(args.host, args.port)
    server = BoundedThreadingHTTPServer((args.host, port), Handler)
    url = f"http://127.0.0.1:{port}/"
    print(f"ALT Pilot: {url}")
    if not args.no_browser:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
