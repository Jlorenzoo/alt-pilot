import unittest
from tools.backfill_availability import reconstruct


class HistoryReconstructionTests(unittest.TestCase):
    def evidence(self, **changes):
        log = dict(file='afk-3.log.1', mtime=3*86400+5, last=[1,4], first=[0,10],
                   lines=100, timestamped=100, activity=[[100,200]],
                   events=[dict(day=0,time=200,kind='start'), dict(day=0,time=230,kind='join')])
        log.update(changes)
        return dict(timezone_offset=0, identities=[dict(slot=3,name='Player',edition='java',since=1)], files=[log])

    def test_rotated_file_midnight_anchor(self):
        rows = reconstruct(self.evidence())
        self.assertEqual(rows, [dict(account='java:player',start=2*86400+100,end=2*86400+200,state='online'),
                                dict(account='java:player',start=2*86400+200,end=2*86400+230,state='downtime')])

    def test_sparse_or_undated_history_is_not_guessed(self):
        self.assertEqual(reconstruct(self.evidence(timestamped=5)), [])
        self.assertEqual(reconstruct(self.evidence(mtime=3*86400+1000)), [])
        evidence=self.evidence()
        evidence['identities'][0]['since']=0
        self.assertEqual(reconstruct(evidence), [])

    def test_identity_boundary_is_respected(self):
        evidence=self.evidence()
        evidence['identities'][0]['since']=2*86400+220
        self.assertEqual(reconstruct(evidence), [dict(account='java:player',start=2*86400+220,end=2*86400+230,state='downtime')])

    def test_conflicting_evidence_leaves_unknown_gap(self):
        rows=reconstruct(self.evidence(activity=[[100,220]]))
        self.assertEqual([(r['start']%86400,r['end']%86400,r['state']) for r in rows],
                         [(100,200,'online'),(220,230,'downtime')])

    def test_repeated_restarts_do_not_fill_unobserved_time(self):
        rows=reconstruct(self.evidence(activity=[],events=[dict(day=0,time=200,kind='start'),
                         dict(day=0,time=300,kind='start'),dict(day=0,time=330,kind='join')]))
        self.assertEqual(rows[0]['end']-rows[0]['start'],30)

    def test_untimestamped_event_breaks_downtime_chain(self):
        rows=reconstruct(self.evidence(activity=[],events=[dict(day=0,time=200,kind='start'),
                         dict(day=0,time=None,kind='disconnect'),dict(day=0,time=330,kind='join')]))
        self.assertEqual(rows, [])

    def test_unverified_timezone_is_rejected(self):
        evidence=self.evidence();evidence['timezone_offset']=3600
        with self.assertRaises(ValueError):reconstruct(evidence)
