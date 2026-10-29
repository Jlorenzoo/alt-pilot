"""Exercise the actual watchdog against a fake systemd, without live accounts."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class WatchdogRecoveryTests(unittest.TestCase):
    def run_watchdog(self, state, failed_at='0', reset_status='0', broken_helper=False, bedrock_state=None, runs=1):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'slots/4').mkdir(parents=True)
            (root / 'run').mkdir()
            (root / 'cgroup/test').mkdir(parents=True)
            (root / 'cgroup/test/cgroup.procs').write_text('123\n')
            helper = root / 'hub-recovery.py'
            helper.write_text('raise SystemExit(1)\n')
            (root / 'run/alt-pilot-watchdog-connected-4').write_text('1\n')
            if bedrock_state:
                (root / 'slots/4/account.json').write_text('{"edition":"bedrock"}')
            status_helper = root / 'bedrock-connected'
            status_helper.write_text('#!/bin/bash\necho ' + (bedrock_state or 'disconnected') + '\n')
            status_helper.chmod(0o755)
            commands = root / 'commands'
            systemctl = root / 'systemctl'
            systemctl.write_text('''#!/bin/bash
if [[ "$1" == show ]]; then
  if [[ "$2" == alt-pilot@4.service ]]; then
    printf 'LoadState=loaded\\nActiveState=%s\\nActiveEnterTimestampMonotonic=1\\nInactiveEnterTimestampMonotonic=%s\\nControlGroup=\\n' "$TEST_STATE" "$TEST_FAILED_AT"
  elif [[ "$2" == alt-pilot.service && "$TEST_BROKEN_HELPER" == 1 ]]; then
    printf 'LoadState=loaded\\nActiveState=active\\nActiveEnterTimestampMonotonic=1\\nControlGroup=/test\\n'
  else
    echo LoadState=not-found
  fi
else
  echo "$*" >> "$TEST_COMMANDS"
  if [[ "$1" == reset-failed ]]; then exit "$TEST_RESET_STATUS"; fi
fi
''')
            systemctl.chmod(0o755)
            for tool in ['ss', 'logger']:
                file = root / tool
                file.write_text('#!/bin/bash\necho pid=123\nexit 0\n' if tool == 'ss' else '#!/bin/bash\nexit 0\n')
                file.chmod(0o755)
            script = (ROOT / 'bin/alt-pilot-watchdog').read_text()
            script = script.replace('/usr/local/bin/afk-bedrock-connected', str(status_helper))
            script = script.replace('/etc/alt-pilot/options.env', str(root / 'options.env'))
            script = script.replace('/home/mc/slots', str(root / 'slots'))
            script = script.replace('/sys/fs/cgroup', str(root / 'cgroup'))
            script = script.replace('/usr/local/sbin/alt-pilot-hub-recovery.py', str(helper))
            script = script.replace('/run/alt-pilot', str(root / 'run/alt-pilot'))
            result = subprocess.run(['bash', '-c', '\n'.join([script] * runs)], text=True, capture_output=True,
                                    env={**os.environ, 'PATH': f'{root}:{os.environ["PATH"]}',
                                         'TEST_BROKEN_HELPER': '1' if broken_helper else '0', 'TEST_STATE': state, 'TEST_FAILED_AT': failed_at,
                                         'TEST_RESET_STATUS': reset_status, 'TEST_COMMANDS': str(commands)})
            self.assertEqual(result.returncode, 0, result.stderr)
            return commands.read_text().splitlines() if commands.exists() else []

    def test_delayed_bedrock_heartbeat_does_not_restart_a_live_session(self):
        self.assertEqual(self.run_watchdog('active', bedrock_state='delayed', runs=3), [])

    def test_sustained_bedrock_stall_still_recovers_after_two_confirmations(self):
        self.assertEqual(self.run_watchdog('active', bedrock_state='unresponsive', runs=2),
                         ['restart --no-block alt-pilot@4.service'])

    def test_failed_account_is_rearmed_without_blocking_other_accounts(self):
        self.assertEqual(self.run_watchdog('failed'), [
            'reset-failed alt-pilot@4.service', 'start --no-block alt-pilot@4.service'])

    def test_one_accounts_broken_helper_does_not_strand_later_failed_accounts(self):
        self.assertEqual(self.run_watchdog('failed', broken_helper=True), [
            'reset-failed alt-pilot@4.service', 'start --no-block alt-pilot@4.service'])

    def test_deliberate_stop_is_preserved(self):
        self.assertEqual(self.run_watchdog('inactive'), [])

    def test_new_failure_gets_two_minutes_before_watchdog_retry(self):
        uptime = int(float(Path('/proc/uptime').read_text().split()[0]) * 1000000)
        self.assertEqual(self.run_watchdog('failed', str(uptime)), [])

    def test_reset_failure_does_not_abort_watchdog(self):
        self.assertEqual(self.run_watchdog('failed', reset_status='1'), ['reset-failed alt-pilot@4.service'])

    def test_systemd_retries_cannot_be_exhausted_by_network_outage(self):
        for name in ['alt-pilot.service', 'alt-pilot@.service']:
            text = (ROOT / 'service' / name).read_text()
            self.assertIn('StartLimitIntervalSec=0', text)
            self.assertIn('Restart=on-failure', text)
            self.assertIn('RestartSec=30', text)


if __name__ == '__main__':
    unittest.main()
