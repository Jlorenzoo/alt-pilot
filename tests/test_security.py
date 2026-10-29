"""Security-boundary regressions; all requests and archives stay local."""
import http.client
import io
import json
import tarfile
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import control_center as core
import remote_control as remote
from tools.restore_client_state import restore


class TrustDefaultsTests(unittest.TestCase):
    def test_auto_accept_requires_explicit_players(self):
        for value in (None, '', ' , '):
            with self.subTest(value=value), self.assertRaises(ValueError):
                core.validate_account_settings({'tpa_auto_accept': True, 'tpa_whitelist': value})
        self.assertEqual(core.validate_account_settings({})['tpa_whitelist'], '')


class RequestBoundaryTests(unittest.TestCase):
    def test_rebinding_host_cannot_read_bootstrap_or_submit_actions(self):
        server = core.BoundedThreadingHTTPServer(('127.0.0.1', 0), core.Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            for method, path in (('GET', '/api/bootstrap'), ('POST', '/api/actions')):
                connection = http.client.HTTPConnection(*server.server_address, timeout=3)
                connection.request(method, path, headers={'Host': 'attacker.example'})
                response = connection.getresponse()
                body = response.read()
                self.assertEqual(response.status, 403)
                self.assertNotIn(core.API_TOKEN.encode(), body)
                connection.close()
            with patch.object(core, 'local_summary', return_value={}), patch.object(core, 'remote_probe', return_value={}):
                connection = http.client.HTTPConnection(*server.server_address, timeout=3)
                connection.request('GET', '/api/bootstrap')
                response = connection.getresponse()
                self.assertEqual(response.status, 200)
                self.assertEqual(json.loads(response.read())['token'], core.API_TOKEN)
                connection.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def test_remote_origin_compares_scheme_host_and_port(self):
        for source, allowed in (
            ('https://control.example', True),
            ('https://control.example:443', True),
            ('https://control.example:444', False),
            ('http://control.example', False),
            ('https://control.example.attacker.example', False),
            ('https://user@control.example', False),
            ('null', False),
            ('https://control.example:bad', False),
        ):
            handler = MagicMock()
            handler.headers = {'Host': 'control.example', 'Origin': source}
            with self.subTest(source=source):
                self.assertEqual(remote._validate_origin(handler, ''), allowed)

    def test_spoofed_cloudflare_header_does_not_reset_login_budget(self):
        handler = MagicMock()
        handler.client_address = ('127.0.0.1', 50000)
        handler.headers = {'CF-Connecting-IP': '203.0.113.12'}
        self.assertEqual(remote.client_key(handler), '127.0.0.1')

    def test_failed_logins_stop_before_seventh_password_check(self):
        with patch.dict(remote.FAILURES, {}, clear=True), patch.object(remote, 'verify_password', return_value=False) as verify, patch.object(remote.time, 'sleep'):
            for index in range(8):
                handler = remote.RemoteHandler.__new__(remote.RemoteHandler)
                handler.path = '/login'
                body = b'password=incorrect'
                handler.rfile = io.BytesIO(body)
                handler.headers = {'Content-Length': str(len(body)), 'CF-Connecting-IP': f'203.0.113.{index}'}
                handler.client_address = ('127.0.0.1', 50000 + index)
                handler.login_page = MagicMock()
                handler.do_POST()
            self.assertEqual(verify.call_count, 6)


class RestoreBoundaryTests(unittest.TestCase):
    def archive(self, root, entries):
        archive = root / 'backup.tar.gz'
        with tarfile.open(archive, 'w:gz') as output:
            for name, kind in entries:
                info = tarfile.TarInfo(name)
                if kind == 'link':
                    info.type = tarfile.SYMTYPE
                    info.linkname = '/tmp/forbidden'
                    output.addfile(info)
                else:
                    data = b'{"safe":true}'
                    info.size = len(data)
                    output.addfile(info, io.BytesIO(data))
        return archive

    def test_valid_state_is_private(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            restore(self.archive(root, [('./.state/vm.json', 'file')]), root)
            self.assertEqual(json.loads((root / '.state/vm.json').read_text()), {'safe': True})
            self.assertEqual((root / '.state/vm.json').stat().st_mode & 0o777, 0o600)

    def test_untrusted_paths_and_links_are_rejected_before_any_write(self):
        for name, kind in (('../outside', 'file'), ('/tmp/outside', 'file'), ('.state/../../outside', 'file'), ('install.sh', 'file'), ('.state/link', 'link'), ('.state', 'file')):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                archive = self.archive(root, [('.state/vm.json', 'file'), (name, kind)])
                with self.assertRaises(ValueError):
                    restore(archive, root)
                self.assertFalse((root / '.state/vm.json').exists())

    def test_existing_symlink_is_not_followed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / '.state').mkdir()
            outside = root / 'outside'
            outside.write_text('unchanged')
            (root / '.state/vm.json').symlink_to(outside)
            with self.assertRaises(ValueError):
                restore(self.archive(root, [('.state/vm.json', 'file')]), root)
            self.assertEqual(outside.read_text(), 'unchanged')


class ProvisioningFailureTests(unittest.TestCase):
    def test_storage_lookup_failure_never_becomes_zero_usage(self):
        import shutil
        import subprocess
        if not shutil.which('jq'):
            self.skipTest('jq is required for the provisioning shell library')
        for failing_kind, expected in (('volume', 'block volume'), ('boot-volume', 'boot volume')):
            script = r'''
source "$1"
oci() {
  if [[ "$1" == bv && "$2" == "$FAIL_KIND" ]]; then return 9; fi
  printf '%s\n' '{"data":[]}'
}
verify_always_free test-compartment
'''
            import os
            env = dict(os.environ, FAIL_KIND=failing_kind)
            result = subprocess.run(['bash', '-c', script, 'test', str(core.ROOT / 'lib/oci-provision.sh')], env=env, capture_output=True, text=True)
            with self.subTest(kind=failing_kind):
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(f'Could not verify {expected} usage.', result.stderr)
