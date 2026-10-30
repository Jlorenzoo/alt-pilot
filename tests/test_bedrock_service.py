"""Exercise edition-specific memory settings through the real service gateway."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class BedrockServiceTests(unittest.TestCase):
    def test_memory_budget_is_applied_once_and_removed_when_switching_to_java(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            slots = root / 'slots/4'
            slots.mkdir(parents=True)
            config = root / 'config'
            config.mkdir()
            (config / 'bedrock-service.conf').write_text('[Service]\nMemoryHigh=384M\nMemoryMax=448M\n')
            systemd = root / 'systemd'
            commands = root / 'commands'
            fake = root / 'fake'
            fake.mkdir()
            for name, body in {
                'systemctl': '#!/bin/bash\nif [[ "$1" == is-active ]]; then echo active; else echo "$*" >> "$TEST_COMMANDS"; fi\n',
                'sleep': '#!/bin/bash\nexit 0\n',
                'jq': '#!/usr/bin/python3\nimport json,sys\nsys.exit(0 if json.load(open(sys.argv[-1])).get("edition") == "bedrock" else 1)\n',
            }.items():
                file = fake / name
                file.write_text(body)
                file.chmod(0o755)
            script = (ROOT / 'bin/alt-pilot-account-service').read_text()
            script = script.replace('/etc/alt-pilot', str(config)).replace('/etc/systemd/system', str(systemd))
            script = script.replace('/home/mc/slots', str(root / 'slots'))
            # Exercise file installation without requiring root in the test runner.
            script = script.replace('-o root -g root', '')
            env = {**os.environ, 'PATH': f'{fake}:{os.environ["PATH"]}', 'TEST_COMMANDS': str(commands)}
            def restart(edition):
                (slots / 'account.json').write_text(json.dumps({'edition': edition}))
                commands.write_text('')
                result = subprocess.run(['bash', '-c', script, 'gateway', 'restart', '4'], env=env,
                                        capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                return commands.read_text().splitlines()
            dropin = systemd / 'alt-pilot@4.service.d/bedrock-runtime.conf'
            self.assertEqual(restart('bedrock'), ['daemon-reload', 'enable alt-pilot@4.service', 'stop alt-pilot@4.service', 'start alt-pilot@4.service'])
            self.assertEqual(dropin.read_text(), (config / 'bedrock-service.conf').read_text())
            self.assertEqual(restart('bedrock'), ['enable alt-pilot@4.service', 'stop alt-pilot@4.service', 'start alt-pilot@4.service'])
            self.assertEqual(restart('java'), ['daemon-reload', 'enable alt-pilot@4.service', 'stop alt-pilot@4.service', 'start alt-pilot@4.service'])
            self.assertFalse(dropin.exists())

    def test_webrtc_budget_retains_shared_vm_cap_and_interface_discovery(self):
        config = (ROOT / 'service/alt-pilot-bedrock.conf').read_text()
        self.assertIn('MemoryHigh=512M', config)
        self.assertIn('MemoryMax=640M', config)
        self.assertIn('AF_NETLINK', config)
        self.assertIn('MemoryMax=820M', (ROOT / 'service/alt-pilot.slice').read_text())


if __name__ == '__main__':
    unittest.main()
