import importlib.util
import os
from pathlib import Path
try:
    import fcntl
except ImportError:
    fcntl = None
import signal
import subprocess
import sys
import tempfile
import time
import unittest

import control_center as core

spec = importlib.util.spec_from_file_location('login', Path(__file__).parents[1] / 'bin/alt-pilot-login.py')
login = importlib.util.module_from_spec(spec)
spec.loader.exec_module(login)


class LoginTests(unittest.TestCase):
    def test_edition_validation(self):
        self.assertEqual(core.account_edition({'edition': 'bedrock'}), 'bedrock')
        self.assertEqual(core.account_edition({'edition': 'both'}), 'both')
        for value in ('auto', 'bedrock; sh', '', None, []):
            with self.assertRaises(ValueError):
                core.account_edition({'edition': value})

    def test_success_requires_saved_account(self):
        for health in ({}, {'accounts': [{'slot': 4, 'authenticated': False}]},
                       {'accounts': [{'slot': 1, 'authenticated': True}]}):
            with self.assertRaises(RuntimeError):
                core.require_saved_account(health, 4)
        core.require_saved_account({'accounts': [{'slot': 4, 'authenticated': True}]}, 4)

    def test_duplicate_is_edition_aware_and_uses_xuid(self):
        java = {'slot': 1, 'name': 'Player', 'edition': 'java'}
        bedrock = {'slot': 4, 'name': 'Player', 'edition': 'bedrock', 'xuid': '123'}
        self.assertIsNone(core.find_duplicate_account({'accounts': [java, bedrock]}, 4))
        renamed = {'slot': 5, 'name': 'Renamed', 'edition': 'bedrock', 'xuid': '123'}
        self.assertEqual(core.find_duplicate_account({'accounts': [renamed, bedrock]}, 4), renamed)

    def test_next_free_slot_skips_authenticated_accounts(self):
        health = {'accounts': [
            {'slot': 1, 'authenticated': True},
            {'slot': 2, 'authenticated': False},
            {'slot': 3, 'authenticated': True},
        ]}
        self.assertEqual(core.next_free_slot(health, 1), 2)
        taken = {'accounts': [{'slot': n, 'authenticated': True} for n in range(1, core.MAX_ACCOUNTS + 1)]}
        self.assertIsNone(core.next_free_slot(taken, 1))

    def test_redacts_credentials(self):
        self.assertNotIn('name@example.com', login.redact('name@example.com'))
        self.assertNotIn('eyJ', login.redact('token eyJhbGci.eyJzdWI.signature'))

    def test_failure_output_is_streamed_and_exit_preserved(self):
        output = []
        code = login.stream([sys.executable, '-c', 'print("Xbox rejected this account"); raise SystemExit(7)'], '.', output.append)
        self.assertEqual(code, 7)
        self.assertIn('Xbox rejected', ''.join(output))

    @unittest.skipIf(fcntl is None, "fcntl is not available on Windows")
    def test_timeout_kills_client_and_descendant(self):
        with tempfile.TemporaryDirectory() as directory:
            pidfile = Path(directory) / 'pid'
            script = ('import subprocess,time,pathlib,signal; '
                      'signal.signal(signal.SIGTERM, signal.SIG_IGN); '
                      'p=subprocess.Popen(["sleep","60"]); '
                      f'pathlib.Path({str(pidfile)!r}).write_text(str(p.pid)); time.sleep(60)')
            with self.assertRaises(TimeoutError):
                login.stream([sys.executable, '-c', script], directory, lambda _: None, timeout=0.4)
            pid = int(pidfile.read_text())
            # A reparented zombie is already dead and has no open descriptors.
            state = Path(f'/proc/{pid}/stat')
            self.assertTrue(not state.exists() or state.read_text().split()[2] == 'Z')

    def test_early_success_cleans_up_waiting_client(self):
        start = time.monotonic()
        self.assertEqual(login.stream([sys.executable, '-c', 'import time; time.sleep(60)'], '.', lambda _: None, success=lambda: True), 0)
        self.assertLess(time.monotonic() - start, 4)

    def test_bedrock_license_error_pattern(self):
        output = '{ "path" : "/multiplayer/bedrock/authentication", "error" : "UNAUTHORIZED" } Ensure that you are able to sign-in to Minecraft with this account'
        self.assertTrue(login.BEDROCK_LICENSE_RE.search(output))
        self.assertTrue(login.BEDROCK_LICENSE_RE.search('{"error":"UNAUTHORIZED"}'))
        self.assertTrue(login.BEDROCK_LICENSE_RE.search('Mojang rejected Bedrock multiplayer for this Microsoft account (UNAUTHORIZED).'))
        self.assertFalse(login.BEDROCK_LICENSE_RE.search('unauthorized_client'))
        self.assertFalse(login.BEDROCK_LICENSE_RE.search('401 Unauthorized'))

    def test_incomplete_bedrock_cache_is_discarded(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            leftover = root / 'bedrock'
            leftover.mkdir()
            (leftover / 'alt-pilot_live-cache.json').write_text('{"token":"stale"}')
            login.discard_incomplete_bedrock(root)
            self.assertFalse(leftover.exists())

    @unittest.skipIf(fcntl is None, "fcntl is not available on Windows")
    def test_cancel_releases_a_held_login_lock(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            lock = root / 'login.lock'
            holder = subprocess.Popen(
                [sys.executable, '-c',
                 'import fcntl,time,pathlib,sys\n'
                 f'handle=pathlib.Path({str(lock)!r}).open("a")\n'
                 'fcntl.flock(handle, fcntl.LOCK_EX)\n'
                 'print("locked", flush=True)\n'
                 'time.sleep(30)\n'],
                stdout=subprocess.PIPE, text=True)
            try:
                self.assertEqual(holder.stdout.readline().strip(), 'locked')
                holder.stdout.close()
                self.assertIn(holder.pid, login.pids_holding(lock))
                login.cancel_login(root)
                self.assertIn(holder.wait(timeout=5), (-signal.SIGTERM, -signal.SIGKILL))
                with lock.open('a') as handle:
                    fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            finally:
                holder.kill()
                holder.wait(timeout=2)

    @unittest.skipIf(fcntl is None, "fcntl is not available on Windows")
    def test_cancel_kills_a_term_ignoring_holder(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            lock = root / 'login.lock'
            holder = subprocess.Popen(
                [sys.executable, '-c',
                 'import fcntl,signal,time,pathlib\n'
                 'signal.signal(signal.SIGTERM, signal.SIG_IGN)\n'
                 f'handle=pathlib.Path({str(lock)!r}).open("a")\n'
                 'fcntl.flock(handle, fcntl.LOCK_EX)\n'
                 'print("locked", flush=True)\n'
                 'time.sleep(30)\n'],
                stdout=subprocess.PIPE, text=True)
            try:
                self.assertEqual(holder.stdout.readline().strip(), 'locked')
                holder.stdout.close()
                login.cancel_login(root)
                self.assertEqual(holder.wait(timeout=5), -signal.SIGKILL)
                with lock.open('a') as handle:
                    fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            finally:
                holder.kill()
                holder.wait(timeout=2)

    @unittest.skipIf(fcntl is None, "fcntl is not available on Windows")
    def test_cancel_kills_spawned_microsoft_client(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            lock = root / 'login.lock'
            child_pid = Path(directory) / 'child'
            holder = subprocess.Popen(
                [sys.executable, '-c',
                 'import fcntl,os,subprocess,time,pathlib\n'
                 f'handle=pathlib.Path({str(lock)!r}).open("a")\n'
                 'fcntl.flock(handle, fcntl.LOCK_EX)\n'
                 'child=subprocess.Popen(["sleep","60"], start_new_session=True)\n'
                 f'pathlib.Path({str(child_pid)!r}).write_text(str(child.pid))\n'
                 'print("locked", flush=True)\n'
                 'time.sleep(30)\n'],
                stdout=subprocess.PIPE, text=True)
            try:
                self.assertEqual(holder.stdout.readline().strip(), 'locked')
                holder.stdout.close()
                pid = int(child_pid.read_text())
                self.assertTrue(Path(f'/proc/{pid}').exists())
                login.cancel_login(root)
                holder.wait(timeout=5)
                deadline = time.monotonic() + 2
                while time.monotonic() < deadline:
                    state = Path(f'/proc/{pid}/stat')
                    if not state.exists() or state.read_text().split()[2] == 'Z':
                        break
                    time.sleep(0.05)
                state = Path(f'/proc/{pid}/stat')
                self.assertTrue(not state.exists() or state.read_text().split()[2] == 'Z')
            finally:
                holder.kill()
                holder.wait(timeout=2)

    def test_cancel_discards_incomplete_java_session(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cache = root / 'mcc'
            cache.mkdir()
            (cache / 'SessionCache.db').write_text('partial')
            (root / 'account.json.tmp').write_text('{"name":"partial"}')
            leftover = root / 'bedrock'
            leftover.mkdir()
            (leftover / 'token.json').write_text('{}')
            login.cancel_login(root)
            self.assertFalse((cache / 'SessionCache.db').exists())
            self.assertFalse((root / 'account.json.tmp').exists())
            self.assertFalse(leftover.exists())

    def test_cancel_keeps_a_saved_account(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'account.json').write_text('{"name":"Steve"}')
            cache = root / 'mcc'
            cache.mkdir()
            (cache / 'SessionCache.db').write_text('keep')
            login.cancel_login(root)
            self.assertTrue((cache / 'SessionCache.db').exists())
