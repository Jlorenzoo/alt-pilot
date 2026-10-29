#!/usr/bin/env python3
"""Prepare reviewed historical intervals from sanitized VM log evidence.

Default: write a manifest only. --apply-db imports it into an existing tracker.
Original sampled history always takes precedence; uncertain gaps remain unknown.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from availability import Tracker


def reconstruct(evidence: dict) -> list[dict]:
    if evidence.get('timezone_offset') != 0:
        raise ValueError('Only verified UTC log timestamps are supported')
    identities = {int(a['slot']): a for a in evidence['identities'] if a.get('since', 0) > 0}
    grouped = defaultdict(list)
    for log in evidence['files']:
        match = re.fullmatch(r'afk(?:-(\d+))?\.log(?:\.\d+(?:\.gz)?)?', log['file'])
        if not match or not log.get('last') or not log['lines'] or log['timestamped']/log['lines'] < .95:
            continue
        slot = int(match[1] or 1)
        identity = identities.get(slot)
        if not identity:
            continue
        # Logrotate preserves file mtime. Anchor the last clock stamp to the
        # latest plausible UTC date, then work back through midnight rollovers.
        day, clock = log['last']
        last = int(log['mtime']//86400)*86400 + clock
        if last > log['mtime'] + 2:
            last -= 86400
        if not 0 <= log['mtime'] - last <= 900:
            continue
        base = last - day*86400 - clock
        account = identity['edition'] + ':' + identity['name'].casefold()
        since = identity['since']
        for a, b in log.get('activity', []):
            a, b = max(base+a, since), base+b
            if b > a:
                grouped[account].append((a, b, 'online'))
        pending = None
        for event in log['events']:
            if event['time'] is None:
                pending = None  # An undated lifecycle event breaks the chain.
                continue
            at = base + event['day']*86400 + event['time']
            if event['kind'] in ('start', 'disconnect'):
                # Repeated restarts do not prove the intervening time offline.
                # Keep only the latest explicit attempt before a successful join.
                pending = at
            elif event['kind'] == 'join':
                if pending is not None and 0 < at-pending <= 1800:
                    a = max(pending, since)
                    if at > a:
                        grouped[account].append((a, at, 'downtime'))
                pending = None
    result = []
    for account, intervals in grouped.items():
        # Split at all evidence boundaries. Conflicting online/offline evidence
        # is left unknown instead of choosing a convenient interpretation.
        changes = defaultdict(lambda: defaultdict(int))
        for a, b, state in intervals:
            changes[a][state] += 1
            changes[b][state] -= 1
        active = defaultdict(int)
        previous = None
        merged = []
        for at in sorted(changes):
            states = [state for state, n in active.items() if n > 0]
            if previous is not None and at > previous and len(states) == 1:
                state = states[0]
                if merged and merged[-1]['end'] == previous and merged[-1]['state'] == state:
                    merged[-1]['end'] = at
                else:
                    merged.append(dict(account=account, start=previous, end=at, state=state))
            for state, delta in changes[at].items():
                active[state] += delta
            previous = at
        result.extend(merged)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('evidence', nargs='+', type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--apply-db', type=Path)
    args = parser.parse_args()
    entries = [row for path in args.evidence for row in reconstruct(json.loads(path.read_text()))]
    args.output.write_text(json.dumps(entries, indent=2)+'\n')
    summary = defaultdict(lambda: defaultdict(float))
    for entry in entries:
        summary[entry['account']][entry['state']] += entry['end'] - entry['start']
    print(json.dumps(dict(rows=len(entries), seconds=summary), indent=2))
    if args.apply_db:
        print('Imported:', Tracker(args.apply_db).import_history(entries))


if __name__ == '__main__':
    main()
