import importlib.util
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "bin" / "alt-pilot-hub-recovery.py"
spec = importlib.util.spec_from_file_location("alt_pilot_hub_recovery", SCRIPT)
recovery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recovery)


class HubRecoveryTests(unittest.TestCase):
    def test_reboot_wait_survives_hub_chat_and_transfer_in_progress(self):
        state = recovery.advance({}, "[06:55:07] REBOOT You'll automatically be sent back to Skyblock once it's online again.\n"
                                    "[06:56:00] §r§7Hub 7 §r§8[Member] Player: hello\n"
                                    "[06:57:00] ✔ Sending you to Skyblock...\n", 100)
        self.assertEqual(state["reboot_until"], 400)
        self.assertEqual(recovery.advance(state, "[06:57:11] §r §b§lCOMPLEX SKYBLOCK §r§71.21.11\n", 250), {})

    def test_countdown_defers_restarts_even_after_redirect_timeout(self):
        state = recovery.advance({}, "[06:20:09] ◆ REBOOT ◆ Skyblock will be rebooting in 10 minutes.\n", 100)
        self.assertEqual(state["reboot_until"], 1000)
        self.assertEqual(recovery.advance(state, "[06:29:58] Failed to go to server Skyblock: Redirect timed out\n", 690), state)

    def test_hub_chat_cannot_defer_recovery(self):
        state = recovery.advance({}, "[01:40:10] Hub 4 [Member] Player: REBOOT automatically be sent back to Skyblock\n", 100)
        self.assertEqual(state, {})

    def test_log_rotation_preserves_deadline_without_replaying_old_sessions(self):
        with tempfile.TemporaryDirectory() as folder:
            log = Path(folder) / "afk.log"
            log.write_text("[01:40:10] [ALT-PILOT] MCC startup began for account 1\n"
                           "[01:40:20] REBOOT You'll automatically be sent back to Skyblock.\n"
                           "[01:40:30] [ALT-PILOT] A status message\n")
            state = recovery.read_new(log, {}, "session-1", 100)
            self.assertEqual(state["reboot_until"], 400)
            log.rename(log.with_suffix(".old"))
            log.write_text("[01:41:10] ✔ Sending you to Skyblock...\n")
            state = recovery.read_new(log, state, "session-1", 200)
            self.assertEqual(state["reboot_until"], 400)
            state = recovery.read_new(log, state, "session-2", 210)
            self.assertNotIn("reboot_until", state)


if __name__ == "__main__":
    unittest.main()
