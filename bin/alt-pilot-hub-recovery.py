#!/usr/bin/env python3
"""Keep the current session alive while Complex handles a Skyblock reboot."""
import json
import os
import re
import sys
import time
from pathlib import Path

REBOOT_GRACE = 300
ANSI = re.compile(r'\x1b\[[0-9;?]*[ -/]*[@-~]|§.')
ROW = re.compile(r'^\[?\d{2}:\d{2}:\d{2}\]?\s+(?:\[(?:SERVER|MCC|Bedrock)\]\s+)?(.*)$')
LAUNCH = re.compile(rb'^.*\[ALT-PILOT\] (?:MCC|Bedrock) startup began for account \d+\r?$', re.M)


def advance(previous, text, now):
    state = dict(previous)
    for line in ANSI.sub('', text).splitlines():
        match = ROW.match(line)
        if not match:
            continue
        message = match[1].lstrip(' \t▌✔✓➜◆!')
        countdown = re.match(r'REBOOT\b.*Skyblock will be rebooting in\s+(\d{1,3})\s+(minutes?|seconds?)', message, re.I)
        if countdown:
            remaining = int(countdown[1]) * (60 if countdown[2].lower().startswith('minute') else 1)
            state['reboot_until'] = max(state.get('reboot_until', 0), now + min(remaining, 1800) + REBOOT_GRACE)
        elif re.match(r'REBOOT\b.*automatically be sent back to Skyblock', message, re.I):
            state['reboot_until'] = max(state.get('reboot_until', 0), now + REBOOT_GRACE)
        elif re.match(r'^COMPLEX SKYBLOCK\b', message, re.I):
            state.pop('reboot_until', None)
    return state


def read_new(log, previous, session, now):
    with log.open('rb') as stream:
        stat = os.fstat(stream.fileno())
        identity = [stat.st_dev, stat.st_ino]
        same_session = previous.get('session') == session
        offset = previous.get('offset', 0)
        state = {'reboot_until': previous.get('reboot_until', 0)} if same_session else {}
        if same_session and previous.get('identity') == identity and offset <= stat.st_size:
            # Retain the reboot deadline through a noisy log or rotation.
            offset = max(offset, stat.st_size - 65536)
            stream.seek(offset)
            data = stream.read(65536)
        else:
            offset = max(0, stat.st_size - 65536)
            stream.seek(offset)
            data = stream.read(65536)
            if not same_session:
                launches = list(LAUNCH.finditer(data))
                if not launches:
                    return dict(session=session, identity=identity, offset=stat.st_size)
                offset += launches[-1].start()
                data = data[launches[-1].start():]
        end = data.rfind(b'\n') + 1
        state = advance(state, data[:end].decode('utf-8', errors='replace'), now)
        state.update(session=session, identity=identity, offset=offset + end)
        return state


def main():
    if len(sys.argv) != 3:
        raise SystemExit(2)
    slot, session = sys.argv[1:3]
    if not re.fullmatch(r'(?:[1-9]|10)', slot) or not session.isdigit():
        raise SystemExit(2)
    folder = Path(os.environ.get('RUNTIME_DIRECTORY', '/run/alt-pilot-watchdog'))
    log = Path('/opt/alt-pilot/logs') / ('afk.log' if slot == '1' else f'afk-{slot}.log')
    file = folder / f'recovery-{slot}.json'
    try:
        previous = json.loads(file.read_text())
    except (OSError, ValueError):
        previous = {}
    now = time.monotonic()
    try:
        state = read_new(log, previous, session, now)
    except FileNotFoundError:
        state = previous if previous.get('session') == session else {}
    tmp = file.with_suffix('.tmp')
    tmp.write_text(json.dumps(state))
    tmp.replace(file)
    raise SystemExit(0 if now < state.get('reboot_until', 0) else 1)


if __name__ == '__main__':
    main()
