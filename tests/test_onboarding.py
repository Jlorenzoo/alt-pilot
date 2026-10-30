import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

from tools.oci_environment import PreflightError, home_region, identity, inventory


class OracleEnvironmentTests(unittest.TestCase):
    def test_cloud_shell_uses_active_profile_not_first_region(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'config'
            path.write_text('[other-region]\ntenancy=ocid1.tenancy.oc1..other\nregion=other-region\n[active-region]\ntenancy=ocid1.tenancy.oc1..owner\nregion=active-region\n')
            self.assertEqual(identity({'OCI_CLI_CONFIG_FILE': str(path), 'OCI_CLI_PROFILE': 'active-region'})['tenancy'], 'ocid1.tenancy.oc1..owner')
            with self.assertRaises(PreflightError):
                identity({'OCI_CLI_CONFIG_FILE': str(path), 'OCI_CLI_PROFILE': 'missing'})

    def test_home_region_is_resolved_from_oracle(self):
        def call(*args):
            return [{'region-name': 'wrong-region', 'is-home-region': False}, {'region-name': 'home-region', 'is-home-region': True}]
        self.assertEqual(home_region('owner', call), 'home-region')
        with self.assertRaises(PreflightError):
            home_region('owner', lambda *args: [])

    def fake(self, failure=None):
        def call(*args):
            self.assertIn('--all', args)
            self.assertEqual(args[args.index('--region') + 1], 'home')
            family = args[:3]
            compartment = args[args.index('--compartment-id') + 1]
            if family == ('iam', 'compartment', 'list'):
                return [{'id': 'child', 'lifecycle-state': 'ACTIVE'}]
            if family == ('iam', 'availability-domain', 'list'):
                return [{'name': 'AD1'}, {'name': 'AD2'}]
            if family == ('compute', 'instance', 'list'):
                return [{'shape': 'VM.Standard.E2.1.Micro', 'lifecycle-state': 'RUNNING'}]
            if family == ('bv', 'volume', 'list'):
                return [{'id': compartment + '-disk', 'size-in-gbs': 25, 'lifecycle-state': 'AVAILABLE'}]
            if family == ('bv', 'boot-volume', 'list'):
                if failure: raise PreflightError('Permission denied')
                if args[args.index('--availability-domain') + 1] == 'AD2': return []
                return [{'id': compartment + '-boot', 'size-in-gbs': 50, 'lifecycle-state': 'AVAILABLE'}]
            raise AssertionError(args)
        return call

    def test_usage_includes_all_compartments_and_domains(self):
        result = inventory('owner', 'home', self.fake())
        self.assertEqual(result['e2_count'], 2)
        self.assertEqual(result['storage_gb'], 150)
        self.assertEqual(result['compartments_checked'], 2)

    def test_storage_permissions_never_turn_into_zero_usage(self):
        with self.assertRaises(PreflightError):
            inventory('owner', 'home', self.fake(failure=True))
        with self.assertRaises(PreflightError):
            inventory('owner', 'home', lambda *args: None)

    def test_installer_dry_run_has_valid_defaults_and_makes_no_cloud_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            config = folder / 'config'
            config.write_text('[shell]\ntenancy=ocid1.tenancy.oc1..test\nregion=wrong-region\n')
            executable = folder / 'oci'
            executable.write_text('''#!/usr/bin/env python3
import json,sys
args=sys.argv[1:]; family=args[:3]
if any(word in args for word in ('create','launch','update','action')): raise SystemExit('MUTATION IN DRY RUN')
if family==['iam','region','list']: data=[{'name':'home'}]
elif family==['iam','region-subscription','list']: data=[{'region-name':'home','is-home-region':True}]
elif family==['iam','availability-domain','list']: data=[{'name':'AD1'}]
elif family==['compute','shape','list']: data=[{'shape':'VM.Standard.E2.1.Micro'}]
elif family==['compute','image','list']: data=[{'id':'image','display-name':'Canonical-Ubuntu-22.04-Minimal-test'}]
else: data=[]
print(json.dumps({'data':data}))
''')
            executable.chmod(0o755)
            key = folder / 'test.pub'
            key.write_text('ssh-ed25519 test-fixture')
            # Run a temporary source copy so the test never touches real .state.
            import shutil
            root = Path(__file__).resolve().parents[1]
            checkout = folder / 'source'
            checkout.mkdir()
            for name in ('lib', 'tools'):
                shutil.copytree(root / name, checkout / name, ignore=shutil.ignore_patterns('__pycache__'))
            shutil.copy2(root / 'setup-afk.sh', checkout / 'setup-afk.sh')
            env = dict(os.environ, PATH=str(folder)+os.pathsep+os.environ['PATH'], OCI_CLI_CONFIG_FILE=str(config), OCI_CLI_PROFILE='shell', SSH_KEY=str(key))
            result = subprocess.run(['bash', str(checkout / 'setup-afk.sh'), '--dry-run'], env=env, capture_output=True, text=True, timeout=20)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn('DRY RUN OK', result.stdout)
            self.assertIn('alt-pilot', result.stdout)
            self.assertIn('home', result.stdout)


class BookmarkTests(unittest.TestCase):
    def run_url(self, value, temporary=False):
        import shutil
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            (folder / 'bin').mkdir()
            (folder / '.state').mkdir()
            script = folder / 'bin/afk-url'
            script.write_text((root / 'bin/afk-url').read_text().replace('/etc/alt-pilot/dashboard-url', str(folder / 'no-system-url')))
            fake = folder / 'bin/tailscale'
            fake.write_text('#!/bin/sh\nexit 1\n')
            fake.chmod(0o755)
            (folder / '.state/remote-access.json').write_text(json.dumps({'url': value, 'temporary_url': temporary, 'password': 'never-print-this'}))
            return subprocess.run(['bash', str(script), '--raw'], env=dict(os.environ, PATH=str(folder / 'bin')+os.pathsep+os.environ['PATH']), capture_output=True, text=True)

    def test_bookmark_accepts_https_ip_and_never_displays_password(self):
        result = self.run_url('https://8.8.8.8')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), 'https://8.8.8.8')
        self.assertNotIn('never-print-this', result.stdout + result.stderr)

    def test_no_localhost_temporary_or_credential_bearing_bookmark(self):
        for value, temporary in (('http://127.0.0.1:8765', False), ('https://localhost', False), ('https://example.trycloudflare.com', True), ('https://user:password@8.8.8.8', False)):
            with self.subTest(value=value):
                result = self.run_url(value, temporary)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('not ready', result.stderr)


class EmptyPaginationTests(unittest.TestCase):
    def test_empty_cli_pagination_requires_a_verified_empty_first_page(self):
        from unittest.mock import patch
        from tools.oci_environment import cli
        for verified, succeeds in (('{"data":[]}', True), ('{"data":[{"id":"unexpected"}]}', False), ('', True), ('not JSON', False)):
            with self.subTest(verified=verified), patch('tools.oci_environment.subprocess.run') as run:
                run.side_effect = [subprocess.CompletedProcess([], 0, '', ''), subprocess.CompletedProcess([], 0, verified, '')]
                if succeeds:
                    self.assertEqual(cli('iam', 'compartment', 'list', '--all'), [])
                    self.assertNotIn('--all', run.call_args_list[1].args[0])
                else:
                    with self.assertRaises(PreflightError):
                        cli('iam', 'compartment', 'list', '--all')


class RebootIntentTests(unittest.TestCase):
    def test_start_and_stop_persist_account_choice_across_reboots(self):
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            (folder / 'bin').mkdir()
            (folder / 'slots/2/mcc').mkdir(parents=True)
            (folder / 'slots/2/mcc/SessionCache.db').write_text('local unsigned test fixture')
            ctl = folder / 'bin/systemctl'
            ctl.write_text('''#!/usr/bin/env python3
import os,sys,pathlib
args=sys.argv[1:];base=pathlib.Path(os.environ['FIXTURE_DIR'])
if args[0]=='is-active': print('inactive');sys.exit(3)
if args[0]=='list-units': sys.exit(0)
if args[0] in ('enable','disable'): (base/'enabled').write_text('yes' if args[0]=='enable' else 'no')
if args[0] in ('start','stop'): (base/'active').write_text('yes' if args[0]=='start' else 'no')
''')
            ctl.chmod(0o755)
            script = folder / 'gateway'
            script.write_text((root / 'bin/alt-pilot-account-service').read_text().replace('/home/mc/slots', str(folder / 'slots')).replace('/etc/alt-pilot/bedrock-service.conf', str(folder / 'no-bedrock-config')))
            env = dict(os.environ, PATH=str(folder / 'bin') + os.pathsep + os.environ['PATH'], FIXTURE_DIR=str(folder))
            for action, expected in (('start', 'yes'), ('stop', 'no')):
                result = subprocess.run(['bash', str(script), action, '2'], env=env, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual((folder / 'enabled').read_text(), expected)
                self.assertEqual((folder / 'active').read_text(), expected)


class OracleFirewallTests(unittest.TestCase):
    def test_web_rules_precede_vendor_reject_and_cleanup_preserves_vendor_rules(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            state = folder / 'rules.json'
            state.write_text(json.dumps([['vendor-reject']]))
            executable = folder / 'iptables'
            executable.write_text('''#!/usr/bin/env python3
import json,os,pathlib,sys
args=[a for a in sys.argv[1:] if a!='-w'];p=pathlib.Path(os.environ['RULES_FILE']);rules=json.loads(p.read_text())
if args[0]=='-S': print('-P INPUT DROP');sys.exit(0)
if args[0]=='-C':sys.exit(0 if args[2:] in rules else 1)
if args[0]=='-I':
 assert args[1:3]==['INPUT','1'];rules.insert(0,args[3:])
elif args[0]=='-D':rules.remove(args[2:])
else:raise SystemExit('Must not flush or replace vendor rules')
p.write_text(json.dumps(rules))
''')
            executable.chmod(0o755)
            env = dict(os.environ, PATH=str(folder)+os.pathsep+os.environ['PATH'], RULES_FILE=str(state))
            root = Path(__file__).resolve().parents[1]
            for _ in range(2):
                subprocess.run(['bash', str(root/'bin/alt-pilot-firewall'), 'start'], check=True, env=env)
            rules = json.loads(state.read_text())
            self.assertEqual(len(rules), 3)
            self.assertEqual(rules[-1], ['vendor-reject'])
            self.assertEqual({rule[rule.index('--dport')+1] for rule in rules[:2]}, {'80','443'})
            subprocess.run(['bash', str(root/'bin/alt-pilot-firewall'), 'stop'], check=True, env=env)
            self.assertEqual(json.loads(state.read_text()), [['vendor-reject']])
