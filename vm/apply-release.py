"""Stage official application files on the VM and restore them if activation fails."""

import filecmp
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import urllib.request


APP = Path("/opt/alt-pilot")
CONTROL = "alt-pilot-control.service"
WATCHDOG = "alt-pilot-watchdog.timer"
LIBEXEC = Path("/usr/local/libexec/alt-pilot")
UNITS = Path("/etc/systemd/system")


def ctl(*args, check=True):
    return subprocess.run(("systemctl", *args), check=check, timeout=90).returncode == 0


def wait_for_dashboard():
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for _ in range(20):
        try:
            with opener.open("http://127.0.0.1:8765/login", timeout=1) as response:
                if response.status == 200:
                    return
        except OSError:
            time.sleep(0.5)
    raise RuntimeError("Updated dashboard failed its health check.")


class FileUpdate:
    def __init__(self):
        self.files = []
        self.changed = []
        self.staging = []

    def stage(self, source, destination, mode=0o644, built=False):
        directory = Path(tempfile.mkdtemp(prefix=".alt-pilot-update-", dir=destination.parent))
        self.staging.append(directory)
        candidate = directory / "new"
        if built:
            source.rename(candidate)
        elif source.is_dir():
            shutil.copytree(source, candidate)
            for path in (candidate, *candidate.rglob("*")):
                path.chmod(0o755 if path.is_dir() else mode)
        else:
            shutil.copyfile(source, candidate)
            candidate.chmod(mode)
        self.files.append((candidate, destination))

    def activate(self):
        for candidate, destination in self.files:
            backup = candidate.with_name("old")
            self.changed.append((candidate, destination, backup))
            if destination.exists() or destination.is_symlink():
                destination.rename(backup)
            candidate.rename(destination)

    def restore(self):
        for candidate, destination, backup in reversed(self.changed):
            if not candidate.exists():
                destination.rename(candidate)
            if backup.exists() or backup.is_symlink():
                backup.rename(destination)

    def cleanup(self):
        for directory in self.staging:
            shutil.rmtree(directory)


def stage_application(update, source):
    for name in ("availability.py", "chat_whitelist.py", "control_center.py", "remote_control.py",
                 "mc_server_ping.py", "web"):
        update.stage(source / name, APP / "control" / name)

    for directory, helpers in (
        ("bin", "afk-status afk-url afk-start afk-stop afk-restart afk-logs afk-health-json "
                "afk-mcc-profile-name afk-control-logs afk-console-log mc-login mc-signout "
                "alt-pilot-mcc-prepare alt-pilot-login.py afk-bedrock-connected"),
        ("sbin", "alt-pilot-set-options alt-pilot-set-account-options alt-pilot-send "
                 "alt-pilot-chat-inbox alt-pilot-hub-recovery.py alt-pilot-watchdog "
                 "alt-pilot-peer alt-pilot-reorder alt-pilot-update-request"),
    ):
        for helper in helpers.split():
            update.stage(source / "bin" / helper, Path("/usr/local") / directory / helper, 0o755)
    update.stage(source / "vm/launch-mcc.sh", Path("/usr/local/bin/alt-pilot-mcc-run"), 0o755)
    update.stage(source / "bin/alt-pilot-account-request", Path("/usr/local/sbin/alt-pilot-account-service"), 0o755)
    update.stage(source / "bin/alt-pilot-account-service", LIBEXEC.parent / "alt-pilot-account-action", 0o755)
    update.stage(source / "vm/item-controls.cs", APP / "mcc/item-controls.cs")
    for name in (CONTROL, WATCHDOG, "alt-pilot.service", "alt-pilot@.service", "alt-pilot.slice",
                 "alt-pilot-watchdog.service", "alt-pilot-account-action@.service", "alt-pilot-update.service"):
        update.stage(source / "service" / name, UNITS / name)
    update.stage(source / "service/alt-pilot-bedrock.conf", Path("/etc/alt-pilot/bedrock-service.conf"))
    update.stage(source / "service/logrotate.conf", Path("/etc/logrotate.d/alt-pilot"))
    for name in ("update.sh", "install-bedrock.sh"):
        update.stage(source / "vm" / name, LIBEXEC / name, 0o755)


def stage_bedrock(update, source):
    runtime = APP / "bedrock"
    needs_build = not (runtime / "node_modules").is_dir() or not (APP / "node/bin/node").is_file()
    needs_build = needs_build or any(
        not current.is_file() or not filecmp.cmp(new, current, shallow=False)
        for new, current in (
            (source / "bedrock/package-lock.json", runtime / "package-lock.json"),
            (source / "bedrock/patch-nethernet.js", runtime / ".patch-applied.js"),
            (source / "vm/install-bedrock.sh", LIBEXEC / "install-bedrock.sh"),
        )
    )
    if needs_build:
        build = Path(tempfile.mkdtemp(prefix=".alt-pilot-runtime-", dir=APP))
        build.chmod(0o755)
        update.staging.append(build)
        if (APP / "node/bin/node").is_file():
            shutil.copytree(APP / "node", build / "node", symlinks=True)
        subprocess.run(("bash", source / "vm/install-bedrock.sh", source / "bedrock", build), check=True)
        for name in ("node", "bedrock"):
            update.stage(build / name, APP / name, built=True)
    else:
        for path in (source / "bedrock").iterdir():
            if path.suffix in (".js", ".json"):
                update.stage(path, runtime / path.name)


def apply_release(source):
    for directory in (APP, APP / "control", APP / "node", APP / "bedrock", APP / "mcc"):
        if (directory.resolve() != directory or not directory.is_dir() or
                directory.stat().st_uid != 0 or directory.stat().st_mode & 0o022):
            raise RuntimeError(f"Expected a root-owned application directory at {directory}.")
    watchdog_active = ctl("is-active", "--quiet", WATCHDOG, check=False)
    update = FileUpdate()
    restored_or_committed = False
    try:
        stage_application(update, source)
        stage_bedrock(update, source)
        update.activate()
        ctl("daemon-reload")
        ctl("restart", CONTROL)
        wait_for_dashboard()
        if watchdog_active:
            ctl("restart", WATCHDOG)
        restored_or_committed = True
    except BaseException:
        if update.changed:
            update.restore()
            ctl("daemon-reload", check=False)
            ctl("restart", CONTROL, check=False)
            if watchdog_active:
                ctl("restart", WATCHDOG, check=False)
        restored_or_committed = True
        raise
    finally:
        if restored_or_committed:
            update.cleanup()
        else:
            print("Recovery files retained at:", *update.staging, file=sys.stderr)


def interrupted(_number, _frame):
    raise InterruptedError("ALT Pilot update interrupted.")


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, interrupted)
    apply_release(Path(sys.argv[1]))
