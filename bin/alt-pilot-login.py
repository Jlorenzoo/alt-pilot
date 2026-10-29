#!/usr/bin/env python3
"""Bounded host-side login. Never leave client descendants behind after SSH exits."""
try:
    import fcntl
except ImportError:
    fcntl = None
import json
import os
from pathlib import Path
import re
import selectors
import shutil
import signal
import subprocess
import sys
import time

BEDROCK_LICENSE_RE = re.compile(
    r'"error"\s*:\s*"UNAUTHORIZED"|\(UNAUTHORIZED\)|Mojang rejected Bedrock multiplayer|does not own Minecraft Bedrock|Bedrock multiplayer entitlement',
    re.I,
)


def discard_incomplete_bedrock(root):
    """Drop leftover MSA tokens when no account was saved, so retry asks for a new code."""
    bedrock = Path(root) / 'bedrock'
    if bedrock.is_dir():
        shutil.rmtree(bedrock, ignore_errors=True)


def pids_with_fd(path):
    try:
        target = str(Path(path).resolve())
    except FileNotFoundError:
        return []
    pids = []
    try:
        proc_entries = os.scandir('/proc')
    except OSError:
        return []
    with proc_entries:
        for proc in proc_entries:
            if not proc.name.isdigit():
                continue
            try:
                fds = os.scandir(f'/proc/{proc.name}/fd')
            except OSError:
                continue
            with fds:
                for fd in fds:
                    try:
                        if os.readlink(fd.path) == target:
                            pids.append(int(proc.name))
                            break
                    except OSError:
                        continue
    return pids


def pids_locking(path):
    """PIDs with an advisory lock on `path`, from the world-readable lock table."""
    try:
        st = os.stat(path)
    except OSError:
        return []
    needle = f'{os.major(st.st_dev):02x}:{os.minor(st.st_dev):02x}:{st.st_ino}'
    pids = []
    try:
        lines = Path('/proc/locks').read_text().splitlines()
    except OSError:
        return []
    for line in lines:
        parts = line.split()
        if len(parts) < 6 or parts[5] != needle:
            continue
        try:
            pids.append(int(parts[4]))
        except ValueError:
            continue
    return pids


def pids_holding(path):
    return list({*pids_with_fd(path), *pids_locking(path)})


def descendant_pids(pid):
    """All processes under `pid`, including new-session children of the client."""
    by_parent = {}
    try:
        proc_entries = os.scandir('/proc')
    except OSError:
        return []
    with proc_entries:
        for proc in proc_entries:
            if not proc.name.isdigit():
                continue
            child = int(proc.name)
            try:
                stat = Path(f'/proc/{child}/stat').read_text()
                ppid = int(stat[stat.rfind(')') + 2:].split()[1])
            except (OSError, ValueError, IndexError):
                continue
            by_parent.setdefault(ppid, []).append(child)
    found, stack = [], list(by_parent.get(pid, []))
    while stack:
        child = stack.pop()
        found.append(child)
        stack.extend(by_parent.get(child, []))
    return found


def kill_pid(pid, sig):
    try:
        os.kill(pid, sig)
    except ProcessLookupError:
        pass


def discard_incomplete_java(root):
    (Path(root) / 'mcc' / 'SessionCache.db').unlink(missing_ok=True)


def discard_incomplete_login(root):
    if (Path(root) / 'account.json').exists():
        return
    (Path(root) / 'account.json.tmp').unlink(missing_ok=True)
    discard_incomplete_bedrock(root)
    discard_incomplete_java(root)


def cancel_login(root, timeout=8):
    """Stop an unfinished sign-in, including Microsoft clients it spawned."""
    lock = Path(root) / 'login.lock'
    self_pid = os.getpid()
    deadline = time.monotonic() + timeout
    term_sent = set()
    while time.monotonic() < deadline:
        holders = [pid for pid in pids_holding(lock) if pid != self_pid]
        if not holders:
            break
        for pid in holders:
            for child in descendant_pids(pid):
                kill_pid(child, signal.SIGKILL)
            if pid in term_sent:
                kill_pid(pid, signal.SIGKILL)
            else:
                kill_pid(pid, signal.SIGTERM)
                term_sent.add(pid)
        time.sleep(0.1)
    discard_incomplete_login(root)


def redact(text):
    text = re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', text)
    text = re.sub(r'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?', '[token removed]', text)
    text = re.sub(r'[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}', '[email removed]', text)
    return text


def stop_group(process):
    if process.poll() is not None:
        return
    sigkill = getattr(signal, 'SIGKILL', signal.SIGTERM)
    for sig in (signal.SIGTERM, sigkill):
        try:
            if hasattr(os, 'killpg'):
                os.killpg(process.pid, sig)
            else:
                process.send_signal(sig)
        except (ProcessLookupError, OSError):
            break
        try:
            process.wait(timeout=2)
            return
        except subprocess.TimeoutExpired:
            pass
    try:
        process.kill()
    except OSError:
        pass
    process.wait()


_active_child = None


def abort_login(*_):
    """Release the lock immediately; cancel_login SIGKILLs any leftover clients."""
    child = _active_child
    if child is not None:
        sigkill = getattr(signal, 'SIGKILL', signal.SIGTERM)
        try:
            if hasattr(os, 'killpg'):
                os.killpg(child.pid, sigkill)
            else:
                child.kill()
        except (ProcessLookupError, PermissionError, OSError):
            pass
    os._exit(1)


def stream(argv, cwd, emit, success=lambda: False, timeout=600, input_data=None):
    global _active_child
    popen_kwargs = {"start_new_session": True} if os.name != "nt" else {}
    process = subprocess.Popen(argv, cwd=cwd, stdin=subprocess.PIPE if input_data else subprocess.DEVNULL,
                               stdout=subprocess.PIPE, stderr=subprocess.STDOUT, **popen_kwargs)
    _active_child = process
    try:
        if input_data:
            process.stdin.write(input_data)
            process.stdin.close()
        deadline = time.monotonic() + timeout
        if os.name == 'nt':
            import queue
            import threading
            out_q = queue.Queue()
            def reader():
                try:
                    for l in iter(process.stdout.readline, b''):
                        out_q.put(l)
                finally:
                    out_q.put(None)
            t = threading.Thread(target=reader, daemon=True)
            t.start()
            while True:
                if success():
                    return 0
                if time.monotonic() >= deadline:
                    raise TimeoutError('Sign-in expired. Close the old Microsoft page and request a fresh code.')
                try:
                    item = out_q.get(timeout=0.1)
                    if item is None:
                        break
                    emit(item.decode('utf-8', errors='replace'))
                except queue.Empty:
                    if process.poll() is not None and out_q.empty():
                        break
            return process.wait(timeout=3)
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ)
            pending = ''
            while selector.get_map():
                if success():
                    return 0
                if time.monotonic() >= deadline:
                    raise TimeoutError('Sign-in expired. Close the old Microsoft page and request a fresh code.')
                for key, _ in selector.select(0.25):
                    chunk = os.read(key.fileobj.fileno(), 4096)
                    if not chunk:
                        selector.unregister(key.fileobj)
                        if pending:
                            emit(pending)
                    else:
                        pending += chunk.decode('utf-8', errors='replace')
                        while '\n' in pending:
                            line, pending = pending.split('\n', 1)
                            emit(line + '\n')
                        # Bound output even if a client emits no newlines.
                        if len(pending) > 16000:
                            emit(pending[:16000]); pending = pending[16000:]
            return process.wait(timeout=3)
    finally:
        stop_group(process)
        if _active_child is process:
            _active_child = None
        process.stdout.close()


def java_name(profile):
    result = subprocess.run(['/usr/local/bin/afk-mcc-profile-name', str(profile / 'SessionCache.db')],
                            capture_output=True, text=True, timeout=5)
    return result.stdout.strip() if result.returncode == 0 else ''


def main():
    slot = sys.argv[1] if len(sys.argv) > 1 else ''
    edition = sys.argv[2] if len(sys.argv) > 2 else 'java'
    if not (slot.isdigit() and 1 <= int(slot) <= 10) or edition not in ('java', 'bedrock', 'cancel'):
        raise ValueError('Choose an account from 1–10 and Java or Bedrock.')
    os.umask(0o077)
    root = Path('/home/mc/slots') / slot
    if edition == 'cancel':
        cancel_login(root)
        print(f'Cancelled any in-progress sign-in for account {slot}.')
        return
    root.mkdir(parents=True, exist_ok=True)
    cancel_login(root)
    with (root / 'login.lock').open('a') as lock:
        deadline = time.monotonic() + 10
        while True:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise RuntimeError('Could not start a fresh sign-in. Close other sign-in windows for this account and try again.')
                cancel_login(root, timeout=2)
                time.sleep(0.15)
        if (root / 'account.json').exists() or java_name(root / 'mcc'):
            raise RuntimeError('This slot already has a saved account. Remove it before adding a different account.')
        log = root / 'login.log'
        # Retain one previous attempt for diagnosis without unbounded disk growth.
        if log.exists():
            log.replace(root / 'login.previous.log')
        with log.open('w') as out:
            captured = []
            def emit(text):
                captured.append(text)
                clean = redact(text)
                # Device codes belong only in the live response, not the retained log.
                saved = re.sub(r'https://(?:www\.)?microsoft.com/\S+', '[Microsoft sign-in URL]', clean)
                saved = re.sub(r'(?i)(?:code\s*[:=]?\s*)[A-Z0-9-]{6,16}', 'code [removed]', saved)
                out.write(saved); out.flush()
                try:
                    print(clean, end='' if clean.endswith('\n') else '\n', flush=True)
                except BrokenPipeError:
                    raise RuntimeError('Sign-in connection closed. Request a fresh code.')
            try:
                emit(f'Starting {edition.title()} sign-in for account {slot}.\n')
                if edition == 'java':
                    subprocess.run(['/usr/local/bin/alt-pilot-mcc-prepare', slot], check=True, timeout=30)
                    profile = root / 'mcc'
                    config = (profile / 'MinecraftClient.ini').read_text()
                    config = re.sub(r'^Account = .*$', 'Account = { Login = "", Password = "" }', config, flags=re.M)
                    config = config.replace('ExitOnFailure = false', 'ExitOnFailure = true')
                    config = config.replace('[ChatBot.AutoRelog]\nEnabled = true', '[ChatBot.AutoRelog]\nEnabled = false')
                    login_config = profile / 'Login.ini'
                    login_config.write_text(config)
                    try:
                        code = stream([str(profile / 'MinecraftClient'), str(login_config)], profile, emit,
                                      success=lambda: bool(java_name(profile)), input_data=b'2\n')
                    finally:
                        login_config.unlink(missing_ok=True)
                    name = java_name(profile)
                    if not name:
                        # A partial cache must not make a failed account look saved.
                        (profile / 'SessionCache.db').unlink(missing_ok=True)
                        raise RuntimeError('Java sign-in did not produce a Java profile. If you normally play Bedrock, choose Bedrock and sign in again. See the preceding error for other account restrictions.')
                    account = {'edition': 'java', 'name': name}
                else:
                    discard_incomplete_bedrock(root)
                    try:
                        code = stream(['/opt/alt-pilot/node/bin/node', '/opt/alt-pilot/bedrock/client.js', 'login', str(root)], root, emit)
                        output = ''.join(captured)
                        if BEDROCK_LICENSE_RE.search(output):
                            raise RuntimeError('Mojang rejected Bedrock multiplayer for this Microsoft account (UNAUTHORIZED). Seeing Java and Bedrock on minecraft.com is a different check. Launch Bedrock once on Xbox, Windows, Android, or iOS with the same account used at microsoft.com/link, then retry. A PlayStation or Nintendo purchase, and some Game Pass licenses, can show Bedrock on the website and still fail here. If you play Java on Complex (name without a leading dot), sign in as Java instead.')
                        if code:
                            raise RuntimeError('Bedrock sign-in failed. See the preceding Microsoft/Xbox error and try again.')
                        account = json.loads((root / 'bedrock/profile.json').read_text())
                        if not account.get('xuid') or not account.get('name'):
                            raise RuntimeError('Xbox did not return a complete Bedrock profile.')
                        account['edition'] = 'bedrock'
                    except Exception:
                        discard_incomplete_bedrock(root)
                        raise
                temporary = root / 'account.json.tmp'
                temporary.write_text(json.dumps(account))
                temporary.replace(root / 'account.json')
                emit(f"{edition.title()} account {account['name']} saved. You can close this dialog.\n")
            except Exception as error:
                discard_incomplete_login(root)
                emit(f'Login failed: {error}\n')
                raise


if __name__ == '__main__':
    for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(sig, abort_login)
    try:
        main()
    except Exception as error:
        print(redact(str(error)), file=sys.stderr)
        sys.exit(1)
