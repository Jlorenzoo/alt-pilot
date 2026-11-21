import importlib.util
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
            with patch.object(remote_control, "UPDATE_REQUEST", request), patch.object(remote_control, "UPDATE_STATUS", status):
                self.assertEqual(remote_control.update_status(), {"state": "unavailable"})
                request.touch()
                self.assertEqual(remote_control.update_status(), {"state": "idle"})
                status.write_text('{"attempt":"stage.test","state":"updated","version":"v1.0.0"}')
                self.assertEqual(remote_control.update_status()["version"], "v1.0.0")
