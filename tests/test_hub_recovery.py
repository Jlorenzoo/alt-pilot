import importlib.util
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "bin" / "alt-pilot-hub-recovery.py"
spec = importlib.util.spec_from_file_location("alt_pilot_hub_recovery", SCRIPT)
recovery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recovery)


class HubRecoveryTests(unittest.TestCase):
    def test_global_hub_chat_and_reboot_wait_for_server_return(self):
        state, due = recovery.advance({}, "[06:55:07] REBOOT You'll automatically be sent back to Skyblock once it's online again.\n"
                                      "[06:56:00] §r§7Hub 7 §r§8[Member] Player: hello\n", 100)
        self.assertFalse(due)
        self.assertNotIn("failure_since", state)
        self.assertEqual(state["reboot_until"], 400)
        state, due = recovery.advance(state, "[06:57:11] §r §b§lCOMPLEX SKYBLOCK §r§71.21.11\n", 500)
        self.assertFalse(due)
        self.assertNotIn("reboot_until", state)

    def test_reboot_countdown_defers_disconnect_recovery_until_grace_expires(self):
        state, due = recovery.advance({}, "[06:20:09] ◆ REBOOT ◆ Skyblock will be rebooting in 10 minutes.\n", 100)
        self.assertFalse(due)
        self.assertEqual(state["reboot_until"], 1000)
        state, due = recovery.advance(state, "[06:29:58] Failed to go to server Skyblock: Redirect timed out\n", 690)
        self.assertFalse(due)
        state, due = recovery.advance(state, "", 999)
        self.assertFalse(due)
        state, due = recovery.advance(state, "", 1001)
        self.assertTrue(due)

    def test_explicit_transfer_failure_requires_grace_and_clears_on_arrival(self):
        state, due = recovery.advance({}, "[01:40:10] Failed to go to server Skyblock: Redirect timed out\n", 100)
        self.assertFalse(due)
        state, due = recovery.advance(state, "[01:40:20] Hub 4 [Member] Player: hi\n", 129)
        self.assertFalse(due)
        state, due = recovery.advance(state, "", 130)
        self.assertTrue(due)
        state, due = recovery.advance(state, "[01:40:31] ✔ Sending you to Skyblock...\n", 131)
        self.assertFalse(due)
        self.assertNotIn("failure_since", state)
        self.assertNotIn("hub_since", state)

    def test_hub_chat_stranding_recovers_without_explicit_failure(self):
        state, due = recovery.advance({}, "[01:40:10] Hub 4 [Member] Player: hi\n", 100)
        self.assertFalse(due)
        self.assertEqual(state["hub_since"], 100)
        state, due = recovery.advance(state, "", 144)
        self.assertFalse(due)
        state, due = recovery.advance(state, "", 145)
        self.assertTrue(due)
        state, due = recovery.advance(state, "[01:42:10] §r §b§lCOMPLEX SKYBLOCK §r§71.21.11\n", 146)
        self.assertFalse(due)
        self.assertNotIn("hub_since", state)

    def test_log_rotation_and_new_session_do_not_replay_old_failures(self):
        with tempfile.TemporaryDirectory() as folder:
            log = Path(folder) / "afk.log"
            log.write_text("[01:40:10] Timed out\n")
            state, due = recovery.read_new(log, {}, "session-1", 100)
            self.assertFalse(due)
            self.assertNotIn("failure_since", state)
            with log.open("a") as stream:
                stream.write("[01:41:10] Timed out\n")
            state, due = recovery.read_new(log, state, "session-1", 120)
            self.assertFalse(due)
            self.assertEqual(state["failure_since"], 120)
            state, due = recovery.read_new(log, state, "session-2", 500)
            self.assertFalse(due)
            self.assertNotIn("failure_since", state)

    def test_new_session_captures_startup_redirect_timeout(self):
        with tempfile.TemporaryDirectory() as folder:
            log = Path(folder) / "afk.log"
            log.write_text("[01:00:00] Old session lines\n")
            with log.open("a") as stream:
                stream.write("[13:27:26] [ALT-PILOT] MCC startup began for account 1\n"
                             "[13:27:44] [MCC] Server was successfully joined.\n"
                             "[13:27:50] ▌! Failed to go to server Skyblock: Redirect timed out\n")
            state, due = recovery.read_new(log, {}, "session-3", 100)
            self.assertFalse(due)
            self.assertEqual(state["failure_since"], 100)
            state, due = recovery.read_new(log, state, "session-3", 130)
            self.assertTrue(due)


if __name__ == "__main__":
    unittest.main()
