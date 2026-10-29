#!/usr/bin/env python3
"""Recover after an explicit failed Skyblock transfer, never from chat labels."""
import fcntl
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

GRACE = 30
HUB_GRACE = 45
ANSI = re.compile(r'\x1b\[[0-9;?]*[ -/]*[@-~]|§.')
ROW = re.compile(r'^\[?\d{2}:\d{2}:\d{2}\]?\s+(?:\[SERVER\]\s+|\[Bedrock\]\s+)?(.*)$')


def advance(previous, text, now):
    state = dict(previous)
    for line in ANSI.sub('', text).splitlines():
        if '[ALT-PILOT]' in line and 'startup began' in line:
            state.pop('failure_since', None)
            state.pop('hub_since', None)
            continue
        match = ROW.match(line)
        if not match:
            continue
        message = match[1].lstrip(' \t▌✔✓➜')
        countdown = re.search(r'REBOOT.*Skyblock will be rebooting in\s+(\d+)\s+(minutes?|seconds?)', message, re.I)
        if countdown:
            remaining = int(countdown[1]) * (60 if countdown[2].lower().startswith('minute') else 1)
            state['reboot_until'] = max(state.get('reboot_until', 0), now + remaining + 300)
        elif re.search(r'REBOOT.*automatically be sent back to Skyblock', message, re.I):
            state['reboot_until'] = max(state.get('reboot_until', 0), now + 300)
        if (message == 'Timed out'
                or re.match(r'^!?\s*Failed to go to server\s+Skyblock:\s+Redirect timed out$', message, re.I)):
            state.setdefault('failure_since', now)
        elif re.match(r'^Hub\s+\d+\b', message, re.I) or re.search(r'\bHub\s+\d+\s+will be rebooting\b', message, re.I):
            state.setdefault('hub_since', now)
        elif re.match(r'^COMPLEX SKYBLOCK\s', message, re.I):
            state.pop('failure_since', None)
            state.pop('hub_since', None)
            state.pop('reboot_until', None)
        elif re.match(r'^Sending you to Skyblock\b', message, re.I):
            state.pop('failure_since', None)
            state.pop('hub_since', None)
    not_rebooting = now >= state.get('reboot_until', 0)
    transfer_failed = ('failure_since' in state and now - state['failure_since'] >= GRACE)
    stranded_in_hub = ('hub_since' in state and now - state['hub_since'] >= HUB_GRACE)
    due = not_rebooting and (transfer_failed or stranded_in_hub)
    if due:
        if 'failure_since' in state:
            state['failure_since'] = now
        if 'hub_since' in state:
            state['hub_since'] = now
    return state, due


def read_new(log, previous, session, now):
    with log.open('rb') as stream:
        stat = os.fstat(stream.fileno())
        identity = [stat.st_dev, stat.st_ino]
        if (previous.get('session') != session or previous.get('identity') != identity
                or stat.st_size < previous.get('offset', 0)
                or now - previous.get('checked', 0) > 90):
            # Deployment, restart, rotation, truncation, or a stopped watchdog:
            # find where the current session started (within recent bytes), or start from EOF if older.
            tail_len = min(stat.st_size, 65536)
            stream.seek(stat.st_size - tail_len)
            chunk = stream.read(tail_len)
            marker = chunk.rfind(b'[ALT-PILOT]')
            if marker != -1:
                start_offset = (stat.st_size - tail_len) + marker
                stream.seek(start_offset)
                data = stream.read(stat.st_size - start_offset)
                end = data.rfind(b'\n') + 1
                state, due = advance({}, data[:end].decode('utf-8', errors='replace'), now)
                state.update(session=session, identity=identity, offset=start_offset + end, checked=now)
                return state, due
            return dict(session=session, identity=identity, offset=stat.st_size, checked=now), False
        stream.seek(previous['offset'])
        data = stream.read(1024 * 1024 + 1)
        if len(data) > 1024 * 1024:
            return dict(session=session, identity=identity, offset=stat.st_size, checked=now), False
        end = data.rfind(b'\n') + 1
        state, due = advance(previous, data[:end].decode('utf-8', errors='replace'), now)
        state.update(offset=previous['offset'] + end, checked=now)
        return state, due


def main():
    if len(sys.argv) not in (3, 4):
        raise SystemExit(2)
    slot, session = sys.argv[1:3]
    defer_restart = len(sys.argv) == 4 and sys.argv[3] == '--defer-restart'
    if len(sys.argv) == 4 and not defer_restart:
        raise SystemExit(2)
    if not re.fullmatch(r'(?:[1-9]|10)', slot) or not session.isdigit():
        raise SystemExit(2)
    folder = Path('/run/alt-pilot-watchdog')
    folder.mkdir(mode=0o700, exist_ok=True)
    log = Path('/opt/alt-pilot/logs') / ('afk.log' if slot == '1' else f'afk-{slot}.log')
    file = folder / f'recovery-{slot}.json'
    with (folder / f'recovery-{slot}.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            previous = json.loads(file.read_text())
        except (OSError, ValueError):
            previous = {}
        now = time.monotonic()
        state, due = read_new(log, previous, session, now)
        if due and not defer_restart:
            # Re-read immediately before sending: arrivals during the check win.
            checked, _ = read_new(log, state, session, now)
            due = ('failure_since' in checked or 'hub_since' in checked)
            state = checked
        tmp = file.with_suffix('.tmp')
        tmp.write_text(json.dumps(state))
        tmp.replace(file)
        if defer_restart:
            raise SystemExit(0 if now < state.get('reboot_until', 0) else 1)
        if due:
            print(f'Account {slot}: Skyblock transfer failed or stranded in Hub; recovering', flush=True)
            subprocess.run(['/usr/local/sbin/alt-pilot-send', 'command', slot],
                           input='/skyblock\n', text=True, timeout=5, check=True)


if __name__ == '__main__':
    main()
