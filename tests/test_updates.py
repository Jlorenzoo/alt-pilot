import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import remote_control


SCRIPT = Path(__file__).resolve().parents[1] / "vm/apply-release.py"
spec = importlib.util.spec_from_file_location("apply_release", SCRIPT)
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class UpdateTests(unittest.TestCase):
    def test_failed_update_restores_dashboard_files_and_removes_new_files(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            current = root / "web"
            current.mkdir()
            (current / "index.html").write_text("old")
            new = root / "new"
            new.mkdir()
            (new / "index.html").write_text("new")
            new_helper = root / "helper"
            stage = release.FileUpdate()
            stage.stage(new, current)
            stage.stage(new / "index.html", new_helper, 0o755)
            stage.activate()
            self.assertEqual((current / "index.html").read_text(), "new")
            self.assertTrue(new_helper.is_file())
            stage.restore()
            stage.cleanup()
            self.assertEqual((current / "index.html").read_text(), "old")
            self.assertFalse(new_helper.exists())

    def test_status_survives_dashboard_restart(self):
        with tempfile.TemporaryDirectory() as folder:
            request = Path(folder) / "request"
            status = Path(folder) / "status.json"
            with patch.object(remote_control, "UPDATE_REQUEST", request), \
                 patch.object(remote_control, "UPDATE_STATUS", status), \
                 patch.object(remote_control, "UPDATE_VERSION", Path(folder) / "version"), \
                 patch.object(remote_control, "latest_update_tag", return_value=None):
                self.assertEqual(remote_control.update_status(), {"state": "unavailable"})
                request.touch()
                self.assertEqual(remote_control.update_status(), {"state": "idle"})
                status.write_text('{"attempt":"stage.test","state":"updated","version":"v1.0.0"}')
                self.assertEqual(remote_control.update_status()["version"], "v1.0.0")

    def test_available_version_compares_the_installed_release_numerically(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            request, status, version = (root / name for name in ("request", "status.json", "version"))
            request.touch()
            status.write_text('{"state":"updated","version":"v1.0.9"}')
            with patch.object(remote_control, "UPDATE_REQUEST", request), \
                 patch.object(remote_control, "UPDATE_STATUS", status), \
                 patch.object(remote_control, "UPDATE_VERSION", version), \
                 patch.object(remote_control, "latest_update_tag", return_value="v1.0.10") as latest:
                # Existing installs may only have a readable status file.
                self.assertEqual(remote_control.update_status()["available_version"], "v1.0.10")
                version.write_text("v1.0.10\n")
                self.assertNotIn("available_version", remote_control.update_status())
                version.write_text("v1.1.0\n")
                self.assertNotIn("available_version", remote_control.update_status())
                status.write_text('{"state":"running","version":"v1.0.10","attempt":"stage.next"}')
                latest.reset_mock()
                self.assertEqual(remote_control.update_status()["state"], "running")
                latest.assert_not_called()

    def test_release_check_caches_only_an_installable_archive(self):
        asset = {"name": "alt-pilot-vm.tar.gz", "state": "uploaded", "digest": "sha256:" + "a" * 64}
        incomplete = {"tag_name": "v1.0.3", "assets": [{**asset, "digest": None}]}
        complete = {"tag_name": "v1.0.3", "assets": [asset]}
        responses = [io.BytesIO(json.dumps(item).encode()) for item in (incomplete, complete)]
        with patch.object(remote_control, "_update_release_cache", (0.0, None)), \
             patch.object(remote_control, "urlopen", side_effect=responses) as fetch, \
             patch.object(remote_control.time, "monotonic", return_value=1.0) as clock:
            self.assertIsNone(remote_control.latest_update_tag())
            self.assertIsNone(remote_control.latest_update_tag())
            fetch.assert_called_once()
            clock.return_value += remote_control.UPDATE_CHECK_INTERVAL
            self.assertEqual(remote_control.latest_update_tag(), "v1.0.3")
            self.assertEqual(remote_control.latest_update_tag(), "v1.0.3")
            self.assertEqual(fetch.call_count, 2)

    def test_unavailable_feed_leaves_update_hidden(self):
        with patch.object(remote_control, "_update_release_cache", (0.0, None)), \
             patch.object(remote_control, "urlopen", side_effect=TimeoutError) as fetch:
            self.assertIsNone(remote_control.latest_update_tag())
            self.assertIsNone(remote_control.latest_update_tag())
            fetch.assert_called_once()
