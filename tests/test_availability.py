import tempfile
import unittest
from pathlib import Path

from availability import Tracker


class AvailabilityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'availability.sqlite3'
        self.tracker = Tracker(self.path)

    def sample(self, now, connected=True, service='active', name='Player', slot=1, **extra):
        self.tracker.record(dict(reachable=True, accounts=[dict(
            name=name, slot=slot, edition='java', authenticated=True,
            connected=connected, service=service)], **extra), now)

    def account(self, now):
        return self.tracker.report(1, now)['accounts'][0]

    def test_transitions_and_denominator(self):
        self.sample(100)
        self.sample(130, False)
        self.sample(160, False, 'inactive')
        self.sample(190)
        a = self.account(190)
        self.assertEqual(a['totals'], dict(online=30, downtime=30, stopped=30, unknown=0))
        self.assertEqual(a['downtime_pct'], 50)
        self.assertEqual(sum(sum(b.values()) for b in a['buckets']), 90)

    def test_long_monitor_gap_is_unknown(self):
        self.sample(100)
        self.sample(130)
        self.sample(1000)
        self.assertEqual(self.account(1030)['totals']['online'], 30)
        self.assertEqual(self.account(1030)['totals']['unknown'], 900)

    def test_delayed_heartbeat_is_not_confirmed_downtime(self):
        health = dict(reachable=True, accounts=[dict(name='Player', slot=1,
                     authenticated=True, connected=False, service='active', connection_state='delayed')])
        self.tracker.record(health, 100)
        self.tracker.record(health, 130)
        a = self.account(130)
        self.assertEqual(a['totals']['unknown'], 30)
        self.assertEqual(a['totals']['downtime'], 0)

    def test_stale_health_does_not_count_as_online(self):
        self.sample(100, health_stale=True)
        self.sample(130, health_stale=True)
        a = self.account(130)
        self.assertEqual(a['totals']['unknown'], 30)
        self.assertIsNone(a['downtime_pct'])

    def test_missing_account_and_restore_from_disk(self):
        self.sample(100)
        self.tracker.record({'reachable': False}, 130)
        self.tracker.record({'reachable': False}, 160)
        restored = Tracker(self.path).report(1, 160)['accounts'][0]
        self.assertEqual(restored['totals']['unknown'], 30)
        self.assertEqual(restored['totals']['online'], 30)

    def test_slot_move_keeps_identity_and_replacement_is_separate(self):
        self.sample(100)
        self.sample(130, slot=2)
        self.sample(160, name='Replacement')
        accounts = self.tracker.report(1, 190)['accounts']
        self.assertEqual(len(accounts), 2)
        player = next(a for a in accounts if a['name'] == 'Player')
        self.assertEqual(player['slot'], 2)
        self.assertEqual(player['totals']['online'], 60)

    def test_report_clips_window_and_does_not_invent_prior_history(self):
        self.sample(100)
        self.sample(130)
        a = self.account(86520)
        self.assertEqual(a['totals']['online'], 10)
        self.assertEqual(sum(a['totals'].values()), 86400)

    def test_retention_prunes_old_data(self):
        self.sample(100)
        self.sample(100 + 31*86400, name='New')
        accounts = self.tracker.report(30, 100 + 31*86400)['accounts']
        self.assertEqual([a['name'] for a in accounts], ['New'])

    def test_exclusion_is_persistent_and_only_matches_exact_identity(self):
        self.sample(100, name='JLorenzoo')
        self.sample(130, name='JLorenzoo')
        self.tracker.set_excluded('java:jlorenzoo')
        restored = Tracker(self.path)
        self.assertEqual(restored.report(1, 140)['accounts'], [])
        self.sample(160, name='JLorenzoo')
        self.sample(160, name='_Jlorenzoo_', slot=3)
        self.assertEqual([a['name'] for a in restored.report(1, 190)['accounts']], ['_Jlorenzoo_'])
        with restored.connect() as db:
            self.assertEqual(db.execute('SELECT MAX(end) FROM intervals WHERE account=?', ('java:jlorenzoo',)).fetchone()[0], 130)
        restored.set_excluded('java:jlorenzoo', False)
        self.assertEqual(len(restored.report(1, 190)['accounts']), 2)


class HistoryImportTests(unittest.TestCase):
    setUp = AvailabilityTests.setUp
    sample = AvailabilityTests.sample
    account = AvailabilityTests.account

    def entry(self, start, end, state='online'):
        return dict(account='java:player', start=start, end=end, state=state)

    def test_import_is_labelled_and_does_not_replace_live_samples(self):
        self.sample(1000)
        self.sample(1030)
        rows = [self.entry(800, 900), self.entry(900, 1100, 'downtime')]
        self.assertEqual(self.tracker.import_history(rows, 1100), 2)
        a = self.account(1100)
        self.assertEqual(a['first'], 800)
        self.assertEqual(a['reconstructed_seconds'], 200)
        self.assertEqual(a['totals']['online'], 130)
        self.assertEqual(a['totals']['downtime'], 100)
        self.assertEqual(a['totals']['unknown'], 70)
        self.assertEqual(self.tracker.import_history(rows, 1100), 0)
        self.sample(1060)
        a = self.account(1060)
        self.assertEqual(a['totals']['online'], 160)
        self.assertEqual(a['reconstructed_seconds'], 200)

    def test_overlap_rolls_back_entire_import(self):
        self.sample(1000)
        with self.assertRaises(ValueError):
            self.tracker.import_history([self.entry(800, 900), self.entry(850, 950)], 1100)
        self.assertEqual(self.account(1100)['first'], 1000)
        self.assertEqual(self.account(1100)['reconstructed_seconds'], 0)

    def test_unknown_identity_and_future_are_rejected(self):
        self.sample(1000)
        with self.assertRaises(ValueError):
            self.tracker.import_history([dict(self.entry(800, 900), account='java:other')], 1100)
        with self.assertRaises(ValueError):
            self.tracker.import_history([self.entry(800, 1200)], 1100)

    def test_old_schema_migrates_without_losing_samples(self):
        import sqlite3
        old = Path(self.temp.name) / 'old.sqlite3'
        with sqlite3.connect(old) as db:
            db.execute('CREATE TABLE intervals (account TEXT,start REAL,end REAL,state TEXT)')
            db.execute("INSERT INTO intervals VALUES ('java:player',100,130,'online')")
        tracker = Tracker(old)
        with tracker.connect() as db:
            self.assertEqual(db.execute('SELECT state,source FROM intervals').fetchone(), ('online', 'sampled'))


if __name__ == '__main__':
    unittest.main()
