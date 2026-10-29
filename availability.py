"""Persistent, sampled account availability; no gameplay actions are performed."""
from __future__ import annotations

from contextlib import contextmanager
import hashlib
import json
import math
import logging
import sqlite3
import threading
import time
from pathlib import Path

STATES = ('online', 'downtime', 'stopped', 'unknown')
RETENTION = 30 * 86400
MAX_GAP = 90


class Tracker:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self.lock = threading.Lock()
        with self.connect() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS accounts (
                    id TEXT PRIMARY KEY, name TEXT, edition TEXT, slot INTEGER, first REAL, last_seen REAL);
                CREATE TABLE IF NOT EXISTS intervals (
                    account TEXT, start REAL, end REAL, state TEXT);
                CREATE INDEX IF NOT EXISTS interval_account ON intervals(account, end);
                CREATE TABLE IF NOT EXISTS excluded_accounts (id TEXT PRIMARY KEY);
            ''')
            columns = {row[1] for row in db.execute('PRAGMA table_info(intervals)')}
            if 'source' not in columns:
                db.execute("ALTER TABLE intervals ADD COLUMN source TEXT NOT NULL DEFAULT 'sampled'")
            db.execute('CREATE TABLE IF NOT EXISTS history_imports (digest TEXT PRIMARY KEY, created REAL, rows INTEGER)')

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        try:
            with db:
                yield db
        finally:
            db.close()

    def record(self, health: dict, now: float | None = None):
        now = time.time() if now is None else now
        with self.lock, self.connect() as db:
            db.execute('DELETE FROM accounts WHERE last_seen < ?', (now - RETENTION,))
            excluded = {row[0] for row in db.execute('SELECT id FROM excluded_accounts')}
            known = {row[0]: row for row in db.execute('SELECT id,name,edition,slot,first FROM accounts') if row[0] not in excluded}
            observed = {}
            for account in health.get('accounts', []):
                if not account.get('authenticated') or not account.get('name'):
                    continue
                name, edition = account['name'], account.get('edition', 'java')
                identity = f'{edition}:{name.casefold()}'
                if identity in excluded:
                    continue
                db.execute('INSERT INTO accounts VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,slot=excluded.slot,last_seen=excluded.last_seen',
                           (identity, name, edition, account['slot'], now, now))
                state = 'unknown'
                if (health.get('reachable') and not health.get('health_stale')
                        and account.get('connection_state') not in ('delayed', 'unresponsive')):
                    if account.get('connected'):
                        state = 'online'
                    elif account.get('service') == 'inactive':
                        state = 'stopped'
                    else:
                        state = 'downtime'
                observed[identity] = state
            for identity in known.keys() | observed.keys():
                state = observed.get(identity, 'unknown')
                previous = db.execute("SELECT rowid,start,end,state FROM intervals WHERE account=? AND source='sampled' ORDER BY end DESC,rowid DESC LIMIT 1", (identity,)).fetchone()
                # Never fill a monitoring gap with a guessed bot state.
                if previous and 0 <= now - previous[2] <= MAX_GAP:
                    db.execute('UPDATE intervals SET end=? WHERE rowid=?', (now, previous[0]))
                    if previous[3] == state:
                        continue
                db.execute('INSERT INTO intervals (account,start,end,state) VALUES (?,?,?,?)', (identity, now, now, state))
            db.execute('DELETE FROM intervals WHERE end < ?', (now - RETENTION,))
            db.execute('DELETE FROM intervals WHERE account NOT IN (SELECT id FROM accounts)')

    def set_excluded(self, identity: str, excluded: bool = True):
        """Exclude a saved account from sampling and reports without deleting history."""
        with self.lock, self.connect() as db:
            if excluded:
                db.execute('INSERT OR IGNORE INTO excluded_accounts VALUES (?)', (identity,))
            else:
                db.execute('DELETE FROM excluded_accounts WHERE id=?', (identity,))

    def report(self, days: int = 1, now: float | None = None):
        now = time.time() if now is None else now
        start = now - days * 86400
        count = 24 if days == 1 else days
        step = (now - start) / count
        accounts = []
        with self.lock, self.connect() as db:
            for identity, name, edition, slot, first in db.execute('SELECT id,name,edition,slot,first FROM accounts WHERE id NOT IN (SELECT id FROM excluded_accounts) ORDER BY slot,name'):
                begin = max(start, first)
                if begin > now:
                    continue
                segments, cursor = [], begin
                rows = db.execute('SELECT start,end,state,source FROM intervals WHERE account=? AND end>=? AND start<=? ORDER BY start', (identity, begin, now)).fetchall()
                for a, b, state, source in rows:
                    a, b = max(a, begin), min(b, now)
                    if a > cursor:
                        segments.append({'start': cursor, 'end': a, 'state': 'unknown', 'source': 'unknown'})
                    if b > a:
                        segments.append({'start': a, 'end': b, 'state': state, 'source': source})
                    cursor = max(cursor, b)
                if cursor < now:
                    segments.append({'start': cursor, 'end': now, 'state': 'unknown', 'source': 'unknown'})
                # Merge adjacent states, including explicit and inferred monitoring gaps.
                merged = []
                for segment in segments:
                    if merged and merged[-1]['state'] == segment['state'] and merged[-1]['source'] == segment['source'] and merged[-1]['end'] == segment['start']:
                        merged[-1]['end'] = segment['end']
                    else:
                        merged.append(segment)
                totals = {state: 0 for state in STATES}
                buckets = [{state: 0 for state in STATES} for _ in range(count)]
                for seg in merged:
                    totals[seg['state']] += seg['end'] - seg['start']
                    for i, bucket in enumerate(buckets):
                        bucket[seg['state']] += max(0, min(seg['end'], start + (i+1)*step) - max(seg['start'], start+i*step))
                measured = totals['online'] + totals['downtime']
                accounts.append(dict(id=identity, name=name, edition=edition, slot=slot, first=first,
                                     reconstructed_seconds=sum(seg['end']-seg['start'] for seg in merged if seg['source'] == 'reconstructed'),
                                     totals=totals, downtime_pct=100*totals['downtime']/measured if measured else None,
                                     segments=merged, buckets=buckets))
        return dict(start=start, end=now, days=days, accounts=accounts, interval_seconds=30)

    def import_history(self, entries: list[dict], now: float | None = None):
        """Import reviewed history before sampling began, atomically and idempotently.

        Dates, identity and event matching are resolved by the offline importer.
        Neither existing samples nor earlier imports may be overwritten.
        """
        now = time.time() if now is None else now
        digest = hashlib.sha256(json.dumps(entries, sort_keys=True).encode()).hexdigest()
        with self.lock, self.connect() as db:
            if db.execute('SELECT 1 FROM history_imports WHERE digest=?', (digest,)).fetchone():
                return 0
            count = 0
            for entry in sorted(entries, key=lambda e: (e['account'], e['start'])):
                a, b = float(entry['start']), float(entry['end'])
                if not math.isfinite(a) or not math.isfinite(b) or b <= a or b > now or entry['state'] not in STATES:
                    raise ValueError('Invalid historical interval')
                identity = entry['account']
                account = db.execute('SELECT first FROM accounts WHERE id=?', (identity,)).fetchone()
                if account is None:
                    raise ValueError('History must belong to an existing tracked account')
                sampled = db.execute("SELECT MIN(start) FROM intervals WHERE account=? AND source='sampled'", (identity,)).fetchone()[0]
                if sampled is None:
                    raise ValueError('Account has no sampled history boundary')
                a, b = max(a, now - RETENTION), min(b, sampled)
                if b <= a:
                    continue
                if db.execute('SELECT 1 FROM intervals WHERE account=? AND start<? AND end>?', (identity, b, a)).fetchone():
                    raise ValueError('Historical intervals overlap existing history')
                db.execute("INSERT INTO intervals (account,start,end,state,source) VALUES (?,?,?,?,'reconstructed')", (identity, a, b, entry['state']))
                db.execute('UPDATE accounts SET first=MIN(first,?) WHERE id=?', (a, identity))
                count += 1
            db.execute('INSERT INTO history_imports VALUES (?,?,?)', (digest, now, count))
            return count

    def start(self, probe):
        def worker():
            while True:
                started = time.monotonic()
                try:
                    self.record(probe())
                except Exception:
                    logging.exception('Availability sampling failed')
                time.sleep(max(1, 30 - (time.monotonic() - started)))
        threading.Thread(target=worker, name='availability-monitor', daemon=True).start()
