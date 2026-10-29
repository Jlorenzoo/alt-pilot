"""Run the installed heartbeat classifier against real JSON and process fixtures."""
import json
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

class BedrockConnectionHealthTests(unittest.TestCase):
    def status(self, age=0, connected=True, reason='', pid=123, members='123\n', invalid=False):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            account = root / 'slots/5/bedrock'; account.mkdir(parents=True)
            cgroup = root / 'cgroup/test'; cgroup.mkdir(parents=True)
            (cgroup / 'cgroup.procs').write_text(members)
            (account / 'status.json').write_text('invalid' if invalid else json.dumps(
                {'pid': pid, 'connected': connected, 'updated': time.time()-age, 'reason': reason}))
            script = (ROOT / 'bin/afk-bedrock-connected').read_text().replace('/home/mc/slots', str(root/'slots')).replace('/sys/fs/cgroup', str(root/'cgroup'))
            status = subprocess.run(['bash', '-c', script, 'helper', '5', '/test', '--status'], text=True, capture_output=True)
            self.assertEqual(status.returncode, 0, status.stderr)
            ready = subprocess.run(['bash', '-c', script, 'helper', '5', '/test'], capture_output=True)
            return status.stdout.strip(), ready.returncode

    def test_live_heartbeat(self):
        self.assertEqual(self.status(), ('connected', 0))

    def test_delayed_heartbeat_is_distinct_from_confirmed_disconnect(self):
        self.assertEqual(self.status(age=60), ('delayed', 1))
        self.assertEqual(self.status(age=200), ('unresponsive', 1))
        self.assertEqual(self.status(connected=False, reason='Connecting'), ('connecting', 1))
        self.assertEqual(self.status(connected=False, reason='Server closed'), ('disconnected', 1))

    def test_old_process_malformed_and_future_heartbeats_cannot_claim_live_connection(self):
        for kwargs in ({'pid': 999}, {'members': ''}, {'age': -30}, {'invalid': True}):
            with self.subTest(kwargs=kwargs):
                self.assertEqual(self.status(**kwargs), ('disconnected', 1))
