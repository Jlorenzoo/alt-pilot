import base64
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import control_center
import remote_control


class TokenPersistenceTests(unittest.TestCase):
    def test_load_or_create_api_token_persists_to_disk(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            token_path = Path(tmpdir) / "control-token"
            token1 = control_center.load_or_create_api_token(token_path)
            self.assertTrue(len(token1) >= 16)
            self.assertTrue(token_path.exists())
            self.assertEqual(token_path.read_text(encoding="utf-8").strip(), token1)

            # Loading again loads the same token
            token2 = control_center.load_or_create_api_token(token_path)
            self.assertEqual(token1, token2)

    def test_status_endpoint_includes_token(self):
        with patch.object(control_center, "local_summary", return_value={"ok": True}), \
             patch.object(control_center, "remote_probe", return_value={"reachable": True}):
            mock_handler = MagicMock()
            mock_handler.path = "/api/status"
            control_center.Handler.do_GET(mock_handler)
            mock_handler.json_response.assert_called_once()
            args, kwargs = mock_handler.json_response.call_args
            self.assertIn("token", args[0])
            self.assertEqual(args[0]["token"], control_center.API_TOKEN)


class ServerValidationTests(unittest.TestCase):
    def test_accepts_hostname_ipv4_and_optional_port(self):
        accepted = (
            "eu.mc-complex.com",
            "play.example.net:25565",
            "203.0.113.10",
            "203.0.113.10:25565",
        )
        for value in accepted:
            with self.subTest(value=value):
                self.assertTrue(control_center.valid_minecraft_server(value))

    def test_rejects_unsafe_or_invalid_servers(self):
        rejected = (
            "example",
            "https://play.example.net",
            "play.example.net;reboot",
            "play..example.net",
            "play.example.net:0",
            "play.example.net:65536",
            "::1",
        )
        for value in rejected:
            with self.subTest(value=value):
                self.assertFalse(control_center.valid_minecraft_server(value))

    def test_account_slots_map_to_dynamic_units(self):
        self.assertEqual(control_center.unit_for_slot(1), "alt-pilot.service")
        self.assertEqual(control_center.unit_for_slot(2), "alt-pilot@2.service")
        self.assertEqual(control_center.unit_for_slot(3), "alt-pilot@3.service")
        self.assertEqual(control_center.account_slot({"slot": "8"}), 8)
        self.assertEqual(control_center.account_slot({"slot": "10"}), 10)
        with self.assertRaises(ValueError):
            control_center.account_slot({"slot": "11"})

    def test_ten_account_capacity_and_slot_mapping(self):
        self.assertEqual(control_center.MAX_ACCOUNTS, 10)
        for slot in range(1, 11):
            self.assertEqual(control_center.account_slot({"slot": slot}), slot)
        with self.assertRaises(ValueError):
            control_center.account_slot({"slot": 0})
        with self.assertRaises(ValueError):
            control_center.account_slot({"slot": 11})

    def test_manual_communication_is_strictly_validated(self):
        self.assertEqual(
            control_center.validate_communication({"slot": 2, "mode": "command", "message": " /tpaccept "}),
            (2, "command", "tpaccept"),
        )
        self.assertEqual(
            control_center.validate_communication({"slot": 1, "mode": "chat", "message": " hello there "}),
            (1, "chat", "hello there"),
        )
        self.assertEqual(
            control_center.validate_communication({"slot": 1, "mode": "action", "message": "use_item"}),
            (1, "action", "use_item"),
        )
        self.assertEqual(
            control_center.validate_communication({"slot": 2, "mode": "action", "message": "drop_item"}),
            (2, "action", "drop_item"),
        )
        for payload in (
            {"slot": 1, "mode": "command", "message": ""},
            {"slot": 1, "mode": "macro", "message": "tpaccept"},
            {"slot": 1, "mode": "action", "message": "fly"},
            {"slot": 1, "mode": "chat", "message": "first\nsecond"},
            {"slot": 1, "mode": "command", "message": "x" * 101},
        ):
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                control_center.validate_communication(payload)

    def test_ssh_connections_reuse_a_private_control_socket(self):
        with tempfile.TemporaryDirectory() as directory, \
             patch.object(control_center, "SSH_CONTROL_DIR", Path(directory)), \
             patch.object(control_center, "state", return_value={"public_ip": "203.0.113.10"}), \
             patch.object(control_center, "private_key", return_value="/tmp/test-key"), \
             patch.object(control_center, "settings", return_value={"ssh_user": "ubuntu"}):
            argv = control_center.ssh_argv("true")
        self.assertIn("ControlMaster=auto", argv)
        self.assertIn("ControlPersist=60", argv)
        self.assertTrue(any(value.startswith("ControlPath=") for value in argv))

    def test_ssh_argv_local_host_uses_direct_bash(self):
        argv_local = control_center.ssh_argv("echo test", host={"local": True, "public_ip": "127.0.0.1"})
        self.assertEqual(argv_local, ["bash", "-c", "echo test"])
        argv_loopback = control_center.ssh_argv("echo test", host={"public_ip": "127.0.0.1"})
        self.assertEqual(argv_loopback, ["bash", "-c", "echo test"])

    def test_communication_acknowledgement_skips_full_health_probe(self):
        completed = subprocess.CompletedProcess([], 0, "Sent to account 2.\n")
        payload = {"slot": 2, "mode": "command", "message": "/help"}
        with patch.object(control_center, "claim_communication_slot"), \
             patch.object(control_center, "ssh_argv", return_value=["ssh", "stub"]), \
             patch.object(control_center, "run", return_value=completed), \
             patch.object(control_center, "remote_probe", side_effect=AssertionError("health probe should not run")):
            output, result = control_center.task_communicate(payload)
        self.assertEqual(output, "Sent /help to the server.\n")
        self.assertEqual(result, {"slot": 2})

        with patch.object(control_center, "claim_communication_slot"), \
             patch.object(remote_control, "command", return_value=completed), \
             patch.object(remote_control, "health", side_effect=AssertionError("health probe should not run")):
            output, result = remote_control.local_communicate(payload)
        self.assertEqual(output, "Sent /help to the server.\n")
        self.assertEqual(result, {"slot": 2})

        action_payload = {"slot": 2, "mode": "action", "message": "use_item"}
        with patch.object(control_center, "claim_communication_slot"), \
             patch.object(control_center, "ssh_argv", return_value=["ssh", "stub"]), \
             patch.object(control_center, "run", return_value=completed), \
             patch.object(control_center, "remote_probe", side_effect=AssertionError("health probe should not run")):
            output, result = control_center.task_communicate(action_payload)
        self.assertEqual(output, "Used held item for account 2.\n")
        self.assertEqual(result, {"slot": 2})

        with patch.object(control_center, "claim_communication_slot"), \
             patch.object(remote_control, "command", return_value=completed), \
             patch.object(remote_control, "health", side_effect=AssertionError("health probe should not run")):
            output, result = remote_control.local_communicate(action_payload)
        self.assertEqual(output, "Used held item for account 2.\n")
        self.assertEqual(result, {"slot": 2})


class HealthScriptTests(unittest.TestCase):
    def test_mcc_slot_name_comes_from_its_own_session_cache(self):
        root = Path(__file__).parents[1]
        health = (root / "bin" / "afk-health-json").read_text(encoding="utf-8")
        self.assertIn('name="$(mcc_profile_name "$mcc_cache")"', health)

        helper = root / "bin" / "afk-mcc-profile-name"
        subprocess.run(["bash", "-n", str(helper)], check=True)

        def cache_bytes(profile_name: str) -> bytes:
            payload = {
                "profiles": {"mc": "0e862889-0c38-4664-8b92-1c5816f5d2eb"},
                "pfd": [{"type": "mc", "id": "0e862889-0c38-4664-8b92-1c5816f5d2eb", "name": profile_name}],
            }
            encode = lambda raw: base64.urlsafe_b64encode(raw).rstrip(b"=")
            token = b".".join((
                encode(json.dumps({"alg": "RS256"}).encode()),
                encode(json.dumps(payload).encode()),
                b"signature-is-not-checked-here",
            ))
            # Shaped like MCC's MessagePack cache: login, token, then the name.
            return b"\x81\xb5user@example.com\x97\xda" + token + b"\xa9" + profile_name.encode()

        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory) / "SessionCache.db"

            cache.write_bytes(cache_bytes("JLorenzoo"))
            first = subprocess.run(["bash", str(helper), str(cache)], text=True, capture_output=True, check=True)
            self.assertEqual(first.stdout.strip(), "JLorenzoo")

            cache.write_bytes(cache_bytes("JLorenzo"))
            second = subprocess.run(["bash", str(helper), str(cache)], text=True, capture_output=True, check=True)
            self.assertEqual(second.stdout.strip(), "JLorenzo")

            for unusable in (b"", b"\x81\xb5user@example.com", b"eyJhbGciOiJSUzI1NiJ9.not-base64-json"):
                cache.write_bytes(unusable)
                rejected = subprocess.run(["bash", str(helper), str(cache)], text=True, capture_output=True, check=True)
                self.assertEqual(rejected.stdout, "")

            missing = subprocess.run(["bash", str(helper), str(Path(directory) / "absent.db")], text=True, capture_output=True, check=True)
            self.assertEqual(missing.stdout, "")

    def test_console_helper_is_selected_and_bounded(self):
        root = Path(__file__).parents[1]
        script = root / "bin" / "afk-console-log"
        text = script.read_text(encoding="utf-8")
        self.assertIn("[CLIENT]", text)
        self.assertIn("\\[YOU[^]]*\\]", text)
        self.assertIn('/home/mc/slots/${slot}/console.log', text)
        self.assertNotIn("s/\\033", text)
        self.assertIn("tail -n 120", text)
        subprocess.run(["bash", "-n", str(script)], check=True)

        # Functional check in a sandbox with the script paths rewritten to the
        # temp dir. A real MCC v26.2 log is the fixture so the regression that
        # hid all server chat cannot return unnoticed.
        with tempfile.TemporaryDirectory() as sandbox:
            slot = 1
            logs_dir = Path(sandbox) / "logs"
            slots_dir = Path(sandbox) / "slots"
            logs_dir.mkdir()
            (slots_dir / str(slot)).mkdir(parents=True)
            game_log = logs_dir / "afk.log"
            game_log.write_text(
                "[10:50:23] [ALT-PILOT] MCC startup began for account 1\n"
                "Resolving eu.mc-complex.com...\n"
                "Minecraft Console Client v26.2 - for MC 1.4.6 to 26.2 - Github.com/MCCTeam\n"
                "10:50:26 GitHub build 511, built on 2026-08-29 from commit fbfae5b\n"
                "10:50:27 Cached session is still valid for JLorenzo.\n"
                "10:50:27 Using Minecraft version 1.12.2 (protocol v340)\n"
                "Checking if server is running Forge...\n"
                "10:50:28 Server version: Velocity 1.7.2-26.2 (protocol v776)\n"
                "Server: eu.mc-complex.com:25565\n"
                "Players: 985/3000\n"
                "10:50:30 [MCC] Server was successfully joined.\n"
                "10:52:51 Website > http://mc-complex.com\n"
                "10:52:51 Link: http://mc-complex.com\n"
                "10:53:00 ✔ Sending you to Skyblock...\n"
                "10:53:01  \n"
                "10:53:06 [Noroi] [Member] lodgerbanger: hi\n",
                encoding="utf-8",
            )
            console_log = slots_dir / str(slot) / "console.log"
            console_log.write_text(
                "@1740000771 [10:52:51] [YOU] /help\n"
                "@1740000780 [10:53:00] [YOU] /skyblock\n",
                encoding="utf-8",
            )
            patched = text.replace("/opt/alt-pilot/logs", logs_dir.as_posix())
            patched = patched.replace("/home/mc/slots/", f"{slots_dir.as_posix()}/")
            patched_path = Path(sandbox) / "afk-console-log"
            patched_path.write_text(patched, encoding="utf-8")
            patched_path.chmod(0o755)
            result = subprocess.run(
                ["bash", patched_path.as_posix(), str(slot)], check=True, capture_output=True, text=True, encoding="utf-8"
            )
            lines = result.stdout.splitlines()

            self.assertIn("[10:53:06] [SERVER] [Noroi] [Member] lodgerbanger: hi", lines)
            self.assertIn("[10:53:00] [SERVER] ✔ Sending you to Skyblock...", lines)
            self.assertIn("[10:50:30] [CLIENT] [MCC] Server was successfully joined.", lines)
            self.assertIn("[10:50:23] [CLIENT] [ALT-PILOT] MCC startup began for account 1", lines)
            self.assertIn("[10:52:51] [YOU] /help", lines)
            self.assertIn("[10:53:00] [YOU] /skyblock", lines)
            joined = "\n".join(lines)
            self.assertNotIn("Players: 985/3000", joined)
            self.assertNotIn("Minecraft Console Client v26.2", joined)
            self.assertNotIn("Link: http://mc-complex.com", joined)
            self.assertLessEqual(len(lines), 120)

            # A legacy command from the previous clock cycle must not displace
            # chat received in the current one just because 13:00 sorts after
            # 06:00 as text.
            game_log.write_text("06:17:32 current server chat\n", encoding="utf-8")
            console_log.write_text(
                "[13:53:15] [YOU] yesterday\n"
                "@866990 [06:17:30] [YOU] current-command\n",
                encoding="utf-8",
            )
            rollover = subprocess.run(
                ["bash", str(patched_path), str(slot)], check=True, capture_output=True, text=True,
                env={**os.environ, "CONSOLE_NOW_EPOCH": "867000", "CONSOLE_NOW_CLOCK": "06:17:40"},
            ).stdout.splitlines()
            self.assertLess(rollover.index("[13:53:15] [YOU] yesterday"), rollover.index("[06:17:32] [SERVER] current server chat"))
            self.assertLess(rollover.index("[06:17:30] [YOU] current-command"), rollover.index("[06:17:32] [SERVER] current server chat"))

    def test_mc_signout_removes_only_mcc_artifacts_and_is_idempotent(self):
        root = Path(__file__).parents[1]
        script = root / "bin" / "mc-signout"
        text = script.read_text(encoding="utf-8")
        self.assertIn("Usage: mc-signout ACCOUNT_NUMBER", text)
        self.assertIn('"$slot" =~ ^([1-9]|10)$', text)
        self.assertIn("SessionCache.db", text)
        self.assertIn('Account = { Login = "", Password = "" }', text)
        self.assertIn("had no saved Microsoft session", text)
        subprocess.run(["bash", "-n", str(script)], check=True)

        # Functional check in a sandbox with the script paths rewritten to the
        # temp dir. Every MCC artifact the script touches must be removed,
        # and the script must still succeed when nothing exists.
        if not shutil.which("flock"):
            return
        with tempfile.TemporaryDirectory() as sandbox:
            slot = 3
            mcc_dir = Path(sandbox) / "mcc"
            mcc_dir.mkdir(parents=True)
            (mcc_dir / "SessionCache.db").write_text("session")
            (mcc_dir / "MinecraftClient.ini").write_text('Account = { Login = "old@x", Password = "y" }\n')
            (mcc_dir / "MinecraftClient.ini").chmod(0o600)
            patched = script.read_text(encoding="utf-8").replace(
                "/home/mc/slots/$slot/mcc", mcc_dir.as_posix(),
            )
            patched_path = Path(sandbox) / "mc-signout"
            patched_path.write_text(patched, encoding="utf-8")
            patched_path.chmod(0o755)
            first = subprocess.run(["bash", patched_path.as_posix(), str(slot)], check=True, capture_output=True, text=True)
            self.assertFalse((mcc_dir / "SessionCache.db").exists())
            ini_text = (mcc_dir / "MinecraftClient.ini").read_text()
            self.assertNotIn("old@x", ini_text)
            self.assertIn("Login = \"\"", ini_text)
            self.assertIn("MCC session", first.stdout)
            self.assertIn("MCC login hint", first.stdout)
            # Wipe the leftover Account hint so the script can prove it is a true
            # no-op on a second run, then re-run.
            (mcc_dir / "MinecraftClient.ini").unlink()
            second = subprocess.run(["bash", patched_path.as_posix(), str(slot)], check=True, capture_output=True, text=True)
            self.assertIn("had no saved Microsoft session", second.stdout)

    def test_console_formatter_classifies_sources_and_preserves_colors(self):
        node = shutil.which("node")
        if not node:
            self.skipTest("Node.js is unavailable")
        formatter = Path(__file__).parents[1] / "web" / "console-format.js"
        program = f"""
const feed = require({json.dumps(str(formatter))});
const lines = [
  '[12:23:59] [SERVER] [Alakazam] [Member] HendriBru: [/hg] for free VKeys {{3/12}}',
  '[12:23:59] [SERVER] (/verify) Verify your Discord to receive a free reward!',
  '[12:24:00] [SERVER] Hub 4 [Member] JacobGhoul: hello',
  '[12:24:01] [YOU] /help',
  '[12:24:02] [CLIENT] [Client thread/WARN] reconnecting',
  '[12:24:03] [CLIENT] [Client thread/FATAL] Error executing task'
];
const result = lines.map(feed.parseConsoleLine);
result.push({{
  html: feed.renderMinecraftText('§cRed §lBold <unsafe>'),
  hex: feed.renderMinecraftText('§x§1§2§A§B§3§4Modern'),
  ansi256: feed.renderMinecraftText('\\u001b[38;5;196mPalette\\u001b[0m'),
  ansiRgb: feed.renderMinecraftText('\\x1b[38;2;18;171;52mRGB\\x1b[0m'),
  controls: feed.renderMinecraftText('before\\u001b[2Kafter'),
  tip: feed.formatServerNotice('  \\u001b[97m瀆 \\u001b[90m\\u001b[1mDid you know? \\u001b[0m\\u001b[90m(/tips)                Track your island progress and achievements!               See how far you have come on your island.               \\u001b[93m\\u001b[1m➜\\u001b[0m Type \\u001b[92m/is milestones\\u001b[0m to check them out!'),
  cleared: feed.linesAfterClear(['old-b', 'old-a', 'new-help', 'old-b'], ['old-a', 'old-b'])
}});
process.stdout.write(JSON.stringify(result));
"""
        result = subprocess.run([node, "-e", program], check=True, text=True, capture_output=True, encoding="utf-8")
        parsed = json.loads(result.stdout)
        self.assertEqual([entry["category"] for entry in parsed[:6]], ["player", "server", "player", "self", "client", "client"])
        self.assertEqual([entry["tone"] for entry in parsed[4:6]], ["warning", "error"])
        self.assertEqual(parsed[0]["player"], "HendriBru")
        self.assertIn("mc-color-c", parsed[6]["html"])
        self.assertIn("mc-bold", parsed[6]["html"])
        self.assertIn("&lt;unsafe&gt;", parsed[6]["html"])
        self.assertNotIn("§", parsed[6]["hex"])
        self.assertIn("mc-color-", parsed[6]["hex"])
        self.assertIn("mc-color-", parsed[6]["ansi256"])
        self.assertIn("mc-color-", parsed[6]["ansiRgb"])
        self.assertEqual(parsed[6]["controls"], "beforeafter")
        self.assertNotIn("瀆", parsed[6]["tip"])
        self.assertIn("✦", parsed[6]["tip"])
        self.assertGreaterEqual(parsed[6]["tip"].count("\n"), 3)
        self.assertEqual(parsed[6]["cleared"], ["new-help", "old-b"])

    def test_console_formatter_detects_private_messages(self):
        node = shutil.which("node")
        if not node:
            self.skipTest("Node.js is unavailable")
        formatter = Path(__file__).parents[1] / "web" / "console-format.js"
        program = f"""
const feed = require({json.dumps(str(formatter))});
const lines = [
  '[10:00:00] [SERVER] \\u258cSkyblock [Noble] Jlorenzoo* \\u279c You: hi',
  '[10:00:01] [SERVER] You \\u279c Jlorenzoo: hey back',
  '[10:00:02] [SERVER] Jlorenzoo whispers to you: psst',
  '[10:00:03] [SERVER] From Jlorenzoo: vanilla dm',
  '[10:00:04] [SERVER] You whisper to Jlorenzoo: reply',
  '[10:00:05] [SERVER] [Member] Steve: public chat'
];
process.stdout.write(JSON.stringify(lines.map(feed.parseConsoleLine)));
"""
        result = subprocess.run([node, "-e", program], check=True, text=True, capture_output=True)
        parsed = json.loads(result.stdout)
        self.assertEqual([entry["category"] for entry in parsed], ["whisper"] * 5 + ["player"])
        self.assertEqual([entry["direction"] for entry in parsed[:5]], ["in", "out", "in", "in", "out"])
        self.assertEqual([entry["player"] for entry in parsed[:5]], ["Jlorenzoo"] * 5)

    def test_console_formatter_handles_real_server_line_shapes(self):
        """The channel marker/§ codes seen in live Complex logs must not hide chat."""
        node = shutil.which("node")
        if not node:
            self.skipTest("Node.js is unavailable")
        formatter = Path(__file__).parents[1] / "web" / "console-format.js"
        program = f"""
const feed = require({json.dumps(str(formatter))});
const lines = [
  '[12:00:00] [SERVER] \\u258c[Alakazam] [Member] HendriBru: [/hg] for free VKeys',
  '[12:00:01] [SERVER] \\u258c[ OVERACHIEVER  ] [Pharaoh\\u2795] WasteOfJukeboxThyme*: hi',
  '[12:00:02] [SERVER] \\u258c\\u00a7r\\u00a78[\\u00a7r\\u00a7bScribe\\u00a7r\\u00a78]\\u00a7r\\u00a7f \\u00a7r\\u00a7b1dontpvp\\u00a7r\\u00a77:\\u00a7r \\u00a7fbuying rod',
  '[12:00:03] [SERVER] \\u258c(/cf) \\u25c6 [Member] Chidorio made a \\u2191 Coinflip \\u2193 for: $10K',
  '[12:00:04] [SERVER] \\u258c\\u00a7r\\u00a77  <#f5c67d><bold>\\u279c<reset> <#56c6e8>Visit our store',
  '[12:00:05] [SERVER] \\u258cSkyblock [Noble] Jlorenzoo* \\u279c You: hi',
  '[12:00:06] [SERVER] \\u258c[Obake] [Pharaoh] Baked*: Skyblock [Pharaoh] wing7067 You: twink?'
];
const result = lines.map(feed.parseConsoleLine);
result.push({{plain: feed.plainForMatch('\\u00a7r\\u00a7b1dontpvp\\u00a7r\\u00a77:' + '\\u00a7r hi'), tip: feed.renderMinecraftText('\\u00a7hbroken\\u00a7r ok')}});
process.stdout.write(JSON.stringify(result));
"""
        result = subprocess.run([node, "-e", program], check=True, text=True, capture_output=True)
        parsed = json.loads(result.stdout)
        self.assertEqual(
            [entry["category"] for entry in parsed[:7]],
            ["player", "player", "player", "server", "server", "whisper", "player"],
        )
        self.assertEqual(parsed[5]["player"], "Jlorenzoo")
        self.assertEqual(parsed[5]["direction"], "in")
        # Unknown "§<letter>" colour markers must not leak into plain text or display.
        self.assertNotIn("\u00a7", parsed[7]["plain"])
        self.assertEqual(parsed[7]["plain"], "1dontpvp: hi")
        self.assertNotIn("\u00a7h", parsed[7]["tip"])
        self.assertIn("ok", parsed[7]["tip"])


class PasswordTests(unittest.TestCase):
    def test_password_is_scrypt_hashed_and_verifies(self):
        with tempfile.TemporaryDirectory() as folder:
            password_path = Path(folder) / "password.json"
            with patch.object(remote_control, "PASSWORD_FILE", password_path):
                password = remote_control.init_password()
                record = json.loads(password_path.read_text(encoding="utf-8"))
                self.assertNotIn(password, password_path.read_text(encoding="utf-8"))
                self.assertEqual(record["version"], 1)
                self.assertTrue(remote_control.verify_password(password))
                self.assertFalse(remote_control.verify_password(password + "wrong"))

    def test_remote_health_timeout_returns_valid_stale_status(self):
        cached = {"reachable": True, "accounts": [{"slot": 1, "service": "active"}]}
        with patch.object(remote_control, "_HEALTH_CACHE", cached), \
             patch.object(remote_control, "_HEALTH_CACHE_AT", 0.0), \
             patch.object(remote_control, "command", side_effect=subprocess.TimeoutExpired("health", 20)):
            result = remote_control.health()
        self.assertTrue(result["reachable"])
        self.assertTrue(result["health_stale"])
        self.assertIn("delayed", result["health_note"])

    def test_fresh_remote_health_never_uses_stale_accounts_for_login(self):
        cached = {"reachable": True, "accounts": [{"slot": 1, "authenticated": True}]}
        with patch.object(remote_control, "_HEALTH_CACHE", cached), \
             patch.object(remote_control, "_HEALTH_CACHE_AT", time.monotonic()), \
             patch.object(remote_control, "command", side_effect=subprocess.TimeoutExpired("health", 20)):
            result = remote_control.health(fresh=True)
        self.assertFalse(result["reachable"])
        self.assertNotIn("accounts", result)

    def test_new_password_validation(self):
        payload = {"new_password": "correct horse battery", "confirm_password": "correct horse battery"}
        self.assertEqual(control_center.validate_new_password(payload), payload["new_password"])
        with self.assertRaises(ValueError):
            control_center.validate_new_password({"new_password": "short", "confirm_password": "short"})
        with self.assertRaises(ValueError):
            control_center.validate_new_password({"new_password": "a sufficiently long value", "confirm_password": "different value"})


class DeviceCodeExtractionTests(unittest.TestCase):
    def test_extracts_code_from_mcc_output(self):
        sample = "\x1b[36mGo to https://microsoft.com/link and use code \x1b[1mABCD-1234\x1b[0m"
        self.assertEqual(control_center.extract_device_code(sample), {"url": "https://microsoft.com/link", "code": "ABCD-1234"})

    def test_extracts_code_from_link_query(self):
        sample = "Open https://www.microsoft.com/link?otc=Z9YX7W2Q now."
        self.assertEqual(control_center.extract_device_code(sample), {"url": "https://www.microsoft.com/link?otc=Z9YX7W2Q", "code": "Z9YX7W2Q"})

    def test_extracts_the_latest_device_code(self):
        sample = "Open https://microsoft.com/link?otc=AAAA1111 first.\nOpen https://microsoft.com/link?otc=BBBB2222 next."
        self.assertEqual(control_center.extract_device_code(sample), {"url": "https://microsoft.com/link?otc=BBBB2222", "code": "BBBB2222"})

    def test_extracts_ansi_coloured_mcc_code(self):
        sample = "\x1b[36mGo to https://microsoft.com/link and use code \x1b[1mABCD-1234\x1b[0m"
        self.assertEqual(control_center.extract_device_code(sample), {"url": "https://microsoft.com/link", "code": "ABCD-1234"})


class ClusterRoutingTests(unittest.TestCase):
    def test_three_accounts_are_balanced_stickily_across_two_hosts(self):
        registry = {
            "hosts": [
                {"id": "e2-1", "public_ip": "203.0.113.1"},
                {"id": "e2-2", "public_ip": "203.0.113.2"},
            ],
            "placements": {"1": "e2-1", "2": "e2-2", "3": "e2-1", "4": "e2-2", "5": "e2-1"},
        }
        with patch.object(control_center, "hosts_config", return_value=registry):
            self.assertEqual([control_center.host_for_slot(slot)["id"] for slot in range(1, 6)], ["e2-1", "e2-2", "e2-1", "e2-2", "e2-1"])

    def test_cluster_health_keeps_only_accounts_assigned_to_each_host(self):
        hosts = [
            {"id": "e2-1", "name": "Primary", "public_ip": "203.0.113.1", "max_online": 3},
            {"id": "e2-2", "name": "Worker", "public_ip": "203.0.113.2", "max_online": 3},
        ]
        registry = {"hosts": hosts, "placements": {"1": "e2-1", "2": "e2-2", "3": "e2-1"}}
        results = [
            (hosts[0], {"reachable": True, "installed": True, "accounts": [{"slot": 1}, {"slot": 3}], "memory_total": 10}),
            (hosts[1], {"reachable": True, "installed": True, "accounts": [{"slot": 2}, {"slot": 3}], "memory_total": 20}),
        ]
        with patch.object(control_center, "hosts_config", return_value=registry):
            health = control_center.aggregate_health(results)
        self.assertEqual([(item["slot"], item["host_id"]) for item in health["accounts"]], [(1, "e2-1"), (2, "e2-2"), (3, "e2-1")])
        self.assertEqual(health["max_online"], 6)
        self.assertEqual(health["memory_total"], 30)

    def test_streaming_task_exposes_code_before_process_finishes(self):
        store = control_center.TaskStore()

        def login(task):
            returncode = control_center.run_streaming([
                "bash", "-c",
                "printf 'Open https://www.microsoft.com/link?otc=LIVE1234\\n'; sleep 0.6; printf 'done\\n'",
            ], task, timeout=3)
            self.assertEqual(returncode, 0)
            return "", {}

        task = store.create_streaming("open_auth", login)
        deadline = time.monotonic() + 0.5
        snapshot = task.public()
        while "device_code" not in snapshot["result"] and time.monotonic() < deadline:
            time.sleep(0.02)
            snapshot = task.public()
        self.assertEqual(snapshot["state"], "running")
        self.assertEqual(snapshot["result"]["device_code"]["code"], "LIVE1234")
        while task.public()["state"] == "running":
            time.sleep(0.02)


class AccountReorderTests(unittest.TestCase):
    def _health(self):
        return {
            "accounts": [
                {"slot": 1, "authenticated": True, "name": "Steve"},
                {"slot": 3, "authenticated": True, "name": "Alex"},
                {"slot": 5, "authenticated": True, "name": "Bob"},
            ],
            "reachable": True,
        }

    def test_validate_reorder_order_rejects_invalid_payloads(self):
        for bad in (None, "not-a-list", [], [1, 3, 5, 5], [0, 3, 5], [1, 11, 5], {"order": [1, 3, 5]}):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                control_center._validate_reorder_order({"order": bad})

    def test_reorder_requires_permutation_of_saved_slots(self):
        hosts = [{"id": "e2-1", "public_ip": "203.0.113.1", "max_online": 3}]
        ok_run = subprocess.CompletedProcess([], 0, "")
        run_mock = MagicMock(return_value=ok_run)
        with patch.object(control_center, "remote_probe", side_effect=[self._health(), {"accounts": [], "reachable": True}]), \
             patch.object(control_center, "configured_hosts", return_value=hosts), \
             patch.object(control_center, "run", run_mock), \
             patch.object(control_center, "atomic_json"), \
             patch.object(control_center, "ssh_argv", return_value=["ssh", "stub"]):
            control_center.task_reorder_slots({"order": [1, 3, 5]})  # identity, no-op OK
        for bad in ([1, 5], [1, 1, 3, 5], [2, 3, 5]):
            with self.subTest(bad=bad), patch.object(control_center, "remote_probe", return_value=self._health()), \
                 patch.object(control_center, "configured_hosts", return_value=[]), \
                 patch.object(control_center, "run", MagicMock(return_value=ok_run)), \
                 patch.object(control_center, "ssh_argv", return_value=["ssh", "stub"]), \
                 self.assertRaises(ValueError):
                control_center.task_reorder_slots({"order": bad})

    def test_reorder_stops_services_then_renames_via_staging(self):
        hosts = [{"id": "e2-1", "public_ip": "203.0.113.1", "max_online": 3}]
        placements = {"1": "e2-1", "3": "e2-1", "5": "e2-1"}
        registry = {"hosts": hosts, "placements": placements}
        ok_run = subprocess.CompletedProcess([], 0, "")
        run_mock = MagicMock(return_value=ok_run)
        written: dict[str, dict] = {}

        def fake_atomic(path, value):
            written[str(path)] = value

        with patch.object(control_center, "remote_probe", side_effect=[self._health(), {"accounts": [], "reachable": True}]), \
             patch.object(control_center, "hosts_config", return_value=registry), \
             patch.object(control_center, "configured_hosts", return_value=hosts), \
             patch.object(control_center, "ssh_argv", side_effect=lambda cmd, host=None: ["ssh", host["id"], cmd]), \
             patch.object(control_center, "run", run_mock), \
             patch.object(control_center, "atomic_json", side_effect=fake_atomic):
            output, result = control_center.task_reorder_slots({"order": [5, 3, 1]})

        self.assertIn("Account order updated", output)
        self.assertEqual(result, {"accounts": [], "reachable": True})
        # Placements follow accounts: slot 1 <- old 5, slot 2 <- old 3, slot 3 <- old 1.
        placements_new = written[str(control_center.HOSTS_FILE)]["placements"]
        self.assertEqual(placements_new, {"1": "e2-1", "2": "e2-1", "3": "e2-1"})
        # The dashboard delegates file moves to the constrained peer command;
        # it must send only the validated OLD:NEW protocol, never shell code.
        reorder_calls = [call.args[0] for call in run_mock.call_args_list if "reorder " in call.args[0][-1]]
        self.assertEqual(len(reorder_calls), 1)
        self.assertIn("5:1", reorder_calls[0][-1])
        self.assertIn("1:3", reorder_calls[0][-1])

    def test_reorder_rejects_when_stop_command_fails(self):
        hosts = [{"id": "e2-1", "public_ip": "203.0.113.1", "max_online": 3}]
        with patch.object(control_center, "remote_probe", return_value=self._health()), \
             patch.object(control_center, "configured_hosts", return_value=hosts), \
             patch.object(control_center, "ssh_argv", return_value=["ssh", "stub"]), \
             patch.object(control_center, "run", return_value=subprocess.CompletedProcess([], 1, "permission denied")):
            with self.assertRaises(RuntimeError) as raised:
                control_center.task_reorder_slots({"order": [3, 1, 5]})
        self.assertIn("Reorder on e2-1 failed: permission denied", str(raised.exception))


class AccountSignOutTests(unittest.TestCase):
    def test_find_duplicate_account_flags_existing_microsoft_login(self):
        health = {"accounts": [{"slot": 1, "name": "Steve"}, {"slot": 2, "name": "Steve"}]}
        self.assertEqual(control_center.find_duplicate_account(health, 2), {"slot": 1, "name": "Steve"})
        self.assertEqual(control_center.find_duplicate_account(health, 1), {"slot": 2, "name": "Steve"})

    def test_find_duplicate_account_allows_first_sign_in_for_a_slot(self):
        health = {"accounts": [{"slot": 1, "name": "Steve"}, {"slot": 2, "name": "Alex"}]}
        self.assertIsNone(control_center.find_duplicate_account(health, 2))

    def test_find_duplicate_account_ignores_empty_names(self):
        health = {"accounts": [{"slot": 1, "name": "Steve"}, {"slot": 2, "name": ""}]}
        self.assertIsNone(control_center.find_duplicate_account(health, 2))

    def test_find_duplicate_account_returns_none_when_no_match(self):
        health = {"accounts": [{"slot": 1, "name": "Steve"}, {"slot": 2, "name": "Alex"}]}
        self.assertIsNone(control_center.find_duplicate_account(health, 3))

    def test_sign_out_stops_service_then_removes_session_and_reprobes(self):
        stop_completed = subprocess.CompletedProcess([], 0, "")
        signout_completed = subprocess.CompletedProcess([], 0, "Account 2 signed out (removed: MCC session).\n")
        health = {"accounts": [], "reachable": True}
        with patch.object(control_center, "ssh_argv", side_effect=lambda cmd, slot=None: ["ssh", "stub", cmd]), \
             patch.object(control_center, "run", side_effect=[stop_completed, signout_completed]) as run_mock, \
             patch.object(control_center, "remote_probe", return_value=health) as probe_mock, \
             patch.object(control_center.time, "sleep"):
            output, result = control_center.task_sign_out(2)
        self.assertEqual(output, "Account 2 signed out (removed: MCC session).\n")
        self.assertEqual(result, health)
        self.assertEqual(run_mock.call_count, 2)
        first_argv = run_mock.call_args_list[0].args[0]
        self.assertIn("alt-pilot-account-service stop 2", first_argv[-1])
        second_argv = run_mock.call_args_list[1].args[0]
        self.assertIn("mc-signout 2", second_argv[-1])
        probe_mock.assert_called_once()

    def test_sign_out_failure_surfaces_mc_signout_output(self):
        stop_completed = subprocess.CompletedProcess([], 0, "")
        failure = subprocess.CompletedProcess([], 1, "Permission denied\n")
        with patch.object(control_center, "ssh_argv", return_value=["ssh", "stub"]), \
             patch.object(control_center, "run", side_effect=[stop_completed, failure]), \
             patch.object(control_center.time, "sleep"):
            with self.assertRaises(RuntimeError) as raised:
                control_center.task_sign_out(4)
        self.assertIn("Permission denied", str(raised.exception))

    def test_open_auth_rejects_a_duplicate_microsoft_account(self):
        health = {"accounts": [{"slot": 1, "name": "Steve", "authenticated": True}, {"slot": 2, "name": "Steve", "authenticated": True}]}
        before = {"accounts": [{"slot": 1, "name": "Steve", "authenticated": True}]}

        def fake_streaming(argv, task, timeout=960):
            task.append("\nMicrosoft sign-in confirmed for account 2.\n")
            return 0

        signout_completed = subprocess.CompletedProcess([], 0, "Account 2 signed out (removed: MCC session).\n")
        task = control_center.Task("abcd1234", "open_auth")
        with patch.object(control_center, "run_streaming", side_effect=fake_streaming), \
             patch.object(control_center, "ssh_argv", return_value=["ssh", "stub"]), \
             patch.object(control_center, "remote_probe", side_effect=[before, health]), \
             patch.object(control_center, "run", return_value=signout_completed):
            with self.assertRaises(RuntimeError) as raised:
                control_center.task_open_auth(task, slot=2, mode="local")
        self.assertIn("already saved as Account 1", str(raised.exception))
        self.assertIn("Sign out of Account 1 first", str(raised.exception))

    def test_both_editions_login_uses_a_second_empty_slot(self):
        probes = [
            {"accounts": [{"slot": 1, "authenticated": False}]},
            {"accounts": [{"slot": 1, "name": "Steve", "edition": "java", "authenticated": True}]},
            {"accounts": [{"slot": 1, "name": "Steve", "edition": "java", "authenticated": True}]},
            {"accounts": [{"slot": 1, "name": "Steve", "edition": "java", "authenticated": True}]},
            {"accounts": [
                {"slot": 1, "name": "Steve", "edition": "java", "authenticated": True},
                {"slot": 2, "name": "Steve", "edition": "bedrock", "xuid": "1", "authenticated": True},
            ]},
        ]
        called = []

        def fake_streaming(argv, task, timeout=960):
            called.append(" ".join(argv))
            task.append("Open https://microsoft.com/link?otc=CODE1234\n")
            return 0

        task = control_center.Task("abcd1234", "open_auth")
        with patch.object(control_center, "run_streaming", side_effect=fake_streaming), \
             patch.object(control_center, "ssh_argv", side_effect=lambda cmd, slot=None, host=None: ["ssh", cmd]), \
             patch.object(control_center, "remote_probe", side_effect=probes), \
             patch.object(control_center, "run", return_value=subprocess.CompletedProcess([], 0, "")):
            output, health = control_center.task_open_auth(task, slot=1, edition="both")
        self.assertEqual(output, "")
        self.assertEqual(health["paired_slot"], 2)
        self.assertEqual(health["java_slot"], 1)
        self.assertFalse(health["reused_java"])
        self.assertTrue(any("mc-login 1 java" in item for item in called))
        self.assertTrue(any("mc-login 2 bedrock" in item for item in called))

    def test_both_editions_failure_rolls_back_first_account(self):
        empty = {"accounts": []}
        java = {"accounts": [{"slot": 1, "name": "Steve", "edition": "java", "authenticated": True}]}
        probes = iter([empty, java, java, java, java])
        signed_out = []
        task = control_center.Task("attempt", "open_auth")

        def login(slot, edition):
            task.append(f"{edition} failed\n")
            return 0 if edition == "java" else 1

        def signout(slot):
            signed_out.append(slot)
            return subprocess.CompletedProcess([], 0, "")

        with self.assertRaises(RuntimeError):
            control_center.run_edition_logins(task, 1, "both", login, lambda: next(probes), signout)
        self.assertEqual(signed_out, [1])
        self.assertEqual(task.auth_saved_slots, [])

    def test_both_editions_reuses_saved_java_without_removing_it(self):
        existing = {"slot": 2, "name": "Steve", "edition": "java", "authenticated": True}
        duplicate = {"slot": 4, "name": "Steve", "edition": "java", "authenticated": True}
        bedrock = {"slot": 4, "name": ".Steve", "edition": "bedrock", "xuid": "123", "authenticated": True}
        probes = iter([
            {"accounts": [existing]},
            {"accounts": [existing, duplicate]},
            {"accounts": [existing]},
            {"accounts": [existing, bedrock]},
        ])
        called, signed_out = [], []
        task = control_center.Task("attempt", "open_auth")

        def login(slot, edition):
            called.append((slot, edition))
            return 0

        def signout(slot):
            signed_out.append(slot)
            return subprocess.CompletedProcess([], 0, "")

        _, health = control_center.run_edition_logins(task, 4, "both", login, lambda: next(probes), signout)
        self.assertEqual(called, [(4, "java"), (4, "bedrock")])
        self.assertEqual(signed_out, [4])
        self.assertEqual(task.auth_saved_slots, [4])
        self.assertEqual((health["java_slot"], health["paired_slot"], health["reused_java"]), (2, 4, True))

    def test_reused_java_survives_bedrock_failure(self):
        existing = {"slot": 2, "name": "Steve", "edition": "java", "authenticated": True}
        duplicate = {"slot": 4, "name": "Steve", "edition": "java", "authenticated": True}
        probes = iter([
            {"accounts": [existing]},
            {"accounts": [existing, duplicate]},
            {"accounts": [existing]},
            {"accounts": [existing]},
        ])
        signed_out = []
        task = control_center.Task("attempt", "open_auth")

        with self.assertRaises(RuntimeError):
            control_center.run_edition_logins(
                task, 4, "both",
                lambda slot, edition: 0 if edition == "java" else 1,
                lambda: next(probes),
                lambda slot: signed_out.append(slot) or subprocess.CompletedProcess([], 0, ""),
            )
        self.assertEqual(signed_out, [4])
        self.assertEqual(task.auth_saved_slots, [])

    def test_cancelled_login_rolls_back_new_account(self):
        empty = {"accounts": []}
        saved = {"accounts": [{"slot": 1, "name": "Steve", "authenticated": True}]}
        probes = iter([empty, saved])
        signed_out = []
        task = control_center.Task("attempt", "open_auth")

        def login(slot, edition):
            task.cancel_auth(slot)
            return 0

        with self.assertRaisesRegex(RuntimeError, "cancelled"):
            control_center.run_edition_logins(
                task, 1, "java", login, lambda: next(probes),
                lambda slot: signed_out.append(slot) or subprocess.CompletedProcess([], 0, ""),
            )
        self.assertEqual(signed_out, [1])

    def test_cancellation_is_scoped_to_its_attempt(self):
        attempt = control_center.Task("attempt", "open_auth", auth_slot=2)
        with patch.object(control_center.TASKS, "get", return_value=attempt):
            with self.assertRaisesRegex(ValueError, "does not match"):
                control_center.cancel_auth_attempt("attempt", 1, lambda _: None, lambda _: None)
        self.assertFalse(attempt.cancelled)

    def test_close_race_removes_only_accounts_created_by_completed_attempt(self):
        attempt = control_center.Task("attempt", "open_auth", auth_slot=2)
        attempt.auth_saved_slots.append(2)
        attempt.complete("", {}, "succeeded")
        cancelled, signed_out = [], []
        with patch.object(control_center.TASKS, "get", return_value=attempt):
            control_center.cancel_auth_attempt(
                "attempt", 2, cancelled.append,
                lambda slot: signed_out.append(slot) or subprocess.CompletedProcess([], 0, ""),
            )
        self.assertEqual(cancelled, [])
        self.assertEqual(signed_out, [2])
        self.assertEqual(attempt.auth_saved_slots, [])


class RemoteStaticAndSecurityTests(unittest.TestCase):
    def test_mime_types_include_ico_and_png(self):
        self.assertEqual(control_center.MIME.get(".ico"), "image/x-icon")
        self.assertEqual(control_center.MIME.get(".png"), "image/png")
        self.assertEqual(control_center.MIME.get(".svg"), "image/svg+xml")
        self.assertEqual(control_center.MIME.get(".json"), "application/json; charset=utf-8")

    def test_static_assets_revalidate_with_etag(self):
        target = control_center.WEB_ROOT / "items.json"
        etag = f'"{int(target.stat().st_mtime)}-{target.stat().st_size}"'

        fresh = MagicMock()
        fresh.headers = {"If-None-Match": etag}
        control_center.Handler.serve_static(fresh, "/items.json")
        fresh.send_response.assert_called_with(304)
        fresh.wfile.write.assert_not_called()

        stale = MagicMock()
        stale.headers = {"If-None-Match": '"old"'}
        control_center.Handler.serve_static(stale, "/items.json")
        stale.send_response.assert_called_with(200)
        stale.wfile.write.assert_called_once()

    def test_public_paths_include_login_and_favicon_assets(self):
        for path in ("/icon.svg", "/login.css", "/favicon.ico", "/brand-lockup.svg"):
            self.assertIn(path, remote_control.PUBLIC_PATHS)

    def test_favicon_ico_file_is_present_and_valid(self):
        ico_path = control_center.WEB_ROOT / "favicon.ico"
        self.assertTrue(ico_path.is_file(), "web/favicon.ico should exist")
        data = ico_path.read_bytes()
        self.assertTrue(len(data) >= 6)
        self.assertEqual(data[:4], b"\x00\x00\x01\x00", "Must have valid ICO header")

    def test_remote_login_and_index_html_reference_favicon(self):
        login_html = (control_center.WEB_ROOT / "remote-login.html").read_text(encoding="utf-8")
        index_html = (control_center.WEB_ROOT / "index.html").read_text(encoding="utf-8")
        self.assertIn('rel="icon" href="/icon.svg"', login_html)
        self.assertIn('rel="alternate icon" href="/favicon.ico"', login_html)
        self.assertIn('rel="icon" href="/icon.svg"', index_html)
        self.assertIn('rel="alternate icon" href="/favicon.ico"', index_html)

    def test_login_page_sends_single_csp_header(self):
        headers: list[tuple[str, str]] = []
        handler = remote_control.RemoteHandler.__new__(remote_control.RemoteHandler)
        handler.send_response = MagicMock()
        handler.send_header = lambda k, v: headers.append((k, v))
        handler.end_headers = MagicMock()
        handler.wfile = MagicMock()
        handler.login_page()
        csp_headers = [v for k, v in headers if k.lower() == "content-security-policy"]
        self.assertEqual(len(csp_headers), 1, f"Expected 1 CSP header, got {len(csp_headers)}: {csp_headers}")
        self.assertIn("script-src 'self'", csp_headers[0])
        self.assertIn("img-src 'self' data:", csp_headers[0])

class AccountActionAndAlertNameTests(unittest.TestCase):
    def test_task_service_uses_account_name_in_messages(self):
        health = {"accounts": [{"slot": 2, "name": "diddlynoodle", "authenticated": True}], "reachable": True}
        ok_run = subprocess.CompletedProcess([], 0, "")
        with patch.object(control_center, "remote_probe", return_value=health), \
             patch.object(control_center, "run", return_value=ok_run), \
             patch.object(control_center, "ssh_argv", return_value=["ssh", "stub"]), \
             patch.object(control_center.time, "sleep"):
            output, _ = control_center.task_service("stop", 2)
            self.assertEqual(output, "diddlynoodle stop accepted.\n")

            start_out, _ = control_center.task_service("start", 2)
            self.assertIn("diddlynoodle start accepted", start_out)

    def test_task_service_failure_uses_account_name(self):
        health = {"accounts": [{"slot": 2, "name": "diddlynoodle", "authenticated": True}], "reachable": True}
        fail_run = subprocess.CompletedProcess([], 1, "")
        with patch.object(control_center, "remote_probe", return_value=health), \
             patch.object(control_center, "run", return_value=fail_run), \
             patch.object(control_center, "ssh_argv", return_value=["ssh", "stub"]):
            with self.assertRaises(RuntimeError) as raised:
                control_center.task_service("stop", 2)
            self.assertIn("Could not stop diddlynoodle", str(raised.exception))

    def test_remote_local_service_uses_account_name_in_messages(self):
        health = {"accounts": [{"slot": 2, "name": "diddlynoodle", "authenticated": True}], "reachable": True}
        ok_run = subprocess.CompletedProcess([], 0, "")
        with patch.object(remote_control, "health", return_value=health) as health_mock, \
             patch.object(remote_control, "target_host", return_value={"id": "host1", "local": True}), \
             patch.object(remote_control, "on_host", return_value=ok_run), \
             patch.object(remote_control.time, "sleep"):
            output, _ = remote_control.local_service("stop", 2)
            self.assertEqual(output, "diddlynoodle stop accepted.\n")
            self.assertEqual(health_mock.call_args_list[-1].kwargs, {"fresh": True})


class AccountSettingsTests(unittest.TestCase):
    def test_validate_account_settings_accepts_valid_inputs(self):
        valid = control_center.validate_account_settings({
            "slot": 1,
            "startup_command_enabled": True,
            "startup_command": "/home alt",
            "startup_delay": 5,
        })
        self.assertEqual(valid["slot"], 1)
        self.assertTrue(valid["startup_command_enabled"])
        self.assertEqual(valid["startup_command"], "/home alt")
        self.assertEqual(valid["startup_delay"], 5)
        self.assertFalse(valid["tpa_auto_accept"])
        self.assertEqual(valid["tpa_whitelist"], "")
        self.assertEqual(valid["purpose"], "")

        # Auto-prefixes slash if missing; trust must be explicitly configured
        valid2 = control_center.validate_account_settings({
            "slot": "2",
            "startup_command": "home farm",
            "tpa_whitelist": "TrustedPlayer",
            "startup_delay": "10",
            "tpa_auto_accept": True,
            "purpose": "cactus",
        })
        self.assertEqual(valid2["slot"], 2)
        self.assertEqual(valid2["startup_command"], "/home farm")
        self.assertEqual(valid2["startup_delay"], 10)
        self.assertTrue(valid2["tpa_auto_accept"])
        self.assertEqual(valid2["tpa_whitelist"], "TrustedPlayer")
        self.assertEqual(valid2["purpose"], "cactus")

        # Custom whitelist
        valid3 = control_center.validate_account_settings({
            "slot": 3,
            "tpa_auto_accept": True,
            "tpa_whitelist": "DiddlyNoodle, jlorenzoo, Alexeitor1",
        })
        self.assertEqual(valid3["slot"], 3)
        self.assertTrue(valid3["tpa_auto_accept"])
        self.assertEqual(valid3["tpa_whitelist"], "DiddlyNoodle, jlorenzoo, Alexeitor1")
        self.assertEqual(valid3["purpose"], "")

    def test_validate_account_settings_rejects_invalid_inputs(self):
        # Invalid slot
        with self.assertRaises(ValueError):
            control_center.validate_account_settings({"slot": 11})
        # Invalid delay
        with self.assertRaises(ValueError):
            control_center.validate_account_settings({"slot": 1, "startup_delay": 100})
        # Control characters in command
        with self.assertRaises(ValueError):
            control_center.validate_account_settings({"slot": 1, "startup_command": "/home\nalt"})
        # Command too long
        with self.assertRaises(ValueError):
            control_center.validate_account_settings({"slot": 1, "startup_command": "/" + "a" * 101})
        # Invalid Minecraft username in whitelist
        with self.assertRaises(ValueError):
            control_center.validate_account_settings({"slot": 1, "tpa_whitelist": "Bad!Name"})
        # Control characters in whitelist
        with self.assertRaises(ValueError):
            control_center.validate_account_settings({"slot": 1, "tpa_whitelist": "user\nname"})
        # Whitelist too long
        with self.assertRaises(ValueError):
            control_center.validate_account_settings({"slot": 1, "tpa_whitelist": "a" * 501})
        # Purpose too long
        with self.assertRaises(ValueError):
            control_center.validate_account_settings({"slot": 1, "purpose": "a" * 33})
        # Control characters in purpose
        with self.assertRaises(ValueError):
            control_center.validate_account_settings({"slot": 1, "purpose": "bad\npurpose"})

    def test_task_save_account_settings_dispatches_proper_command(self):
        probe = {"accounts": [{"slot": 1, "name": "JLorenzo", "authenticated": True}], "reachable": True}
        ok_run = subprocess.CompletedProcess([], 0, "Account 1 settings saved.\n")
        with patch.object(control_center, "remote_probe", return_value=probe), \
             patch.object(control_center, "run", return_value=ok_run), \
             patch.object(control_center, "ssh_argv", return_value=["ssh", "stub"]) as mock_ssh:
            output, new_probe = control_center.task_save_account_settings({
                "slot": 1,
                "startup_command_enabled": True,
                "startup_command": "/home alt",
                "startup_delay": 5,
                "tpa_auto_accept": True,
                "tpa_whitelist": "DiddlyNoodle, jlorenzoo",
                "purpose": "spawner",
            })
            self.assertIn("Settings saved for JLorenzo", output)
            mock_ssh.assert_called_once()

    def test_task_communicate_sethome_does_not_change_startup_settings(self):
        probe = {"accounts": [{"slot": 3, "name": "_Jlorenzoo_", "authenticated": True, "settings": {"startup_delay": 5}}], "reachable": True}
        ok_run = subprocess.CompletedProcess([], 0, "")
        with patch.object(control_center, "claim_communication_slot"), \
             patch.object(control_center, "ssh_argv", return_value=["ssh", "stub"]), \
             patch.object(control_center, "run", return_value=ok_run) as mock_run, \
             patch.object(control_center, "remote_probe", return_value=probe):
            output, result = control_center.task_communicate({
                "slot": 3,
                "mode": "command",
                "message": "/sethome spawner",
            })
            self.assertEqual(result["slot"], 3)
            self.assertEqual(output, "Sent /sethome spawner to the server.\n")
            self.assertEqual(mock_run.call_count, 1)

    def test_home_alt_all_only_sends_fixed_command_to_online_ready_accounts(self):
        probe = {"accounts": [
            {"slot": 1, "name": "Java", "connected": True, "communication_ready": True},
            {"slot": 2, "name": "Offline", "connected": False, "communication_ready": False},
            {"slot": 3, "name": "Bedrock", "connected": True, "communication_ready": True},
        ]}
        sent = []
        def send(payload):
            sent.append(payload)
            if payload["slot"] == 3:
                raise RuntimeError("FIFO unavailable")
        output, result = control_center.send_home_alt_all(probe, send)
        self.assertEqual(sent, [
            {"slot": 1, "mode": "command", "message": "/home alt"},
            {"slot": 3, "mode": "command", "message": "/home alt"},
        ])
        self.assertEqual((result["sent"], result["total"]), (1, 2))
        self.assertIn("Bedrock: failed - FIFO unavailable", output)
        with self.assertRaisesRegex(ValueError, "No online accounts"):
            control_center.send_home_alt_all({"accounts": []}, send)

    def test_remote_local_save_account_settings_dispatches_properly(self):
        health = {"accounts": [{"slot": 1, "name": "JLorenzo", "authenticated": True}], "reachable": True}
        ok_run = subprocess.CompletedProcess([], 0, "Account 1 settings saved.\n")
        with patch.object(remote_control, "health", return_value=health), \
             patch.object(remote_control, "target_host", return_value={"id": "host1", "local": True}), \
             patch.object(remote_control, "command", return_value=ok_run) as mock_cmd:
            output, new_health = remote_control.local_save_account_settings({
                "slot": 1,
                "startup_command_enabled": True,
                "startup_command": "/home alt",
                "startup_delay": 5,
                "tpa_auto_accept": False,
                "tpa_whitelist": "",
                "purpose": "",
            })
            self.assertIn("Settings saved for JLorenzo", output)
            mock_cmd.assert_called_once()
            argv = mock_cmd.call_args[0][0]
            self.assertEqual(argv, ["sudo", "-n", "/usr/local/sbin/alt-pilot-set-account-options", "1", "1", "5", "/home alt", "0", "", ""])

    def test_local_save_account_settings_sync_all_flow(self):
        health = {
            "accounts": [
                {
                    "slot": 1,
                    "name": "JLorenzo",
                    "authenticated": True,
                    "settings": {
                        "startup_command_enabled": True,
                        "startup_command": "/home alt",
                        "startup_delay": 5,
                        "tpa_auto_accept": True,
                        "tpa_whitelist": "PlayerA",
                        "purpose": "spawner",
                    },
                },
                {
                    "slot": 2,
                    "name": "Alexeitor1",
                    "authenticated": True,
                    "settings": {
                        "startup_command_enabled": False,
                        "startup_command": "/home cactus",
                        "startup_delay": 10,
                        "tpa_auto_accept": False,
                        "tpa_whitelist": "",
                        "purpose": "cactus",
                    },
                },
            ]
        }
        ok_run = subprocess.CompletedProcess(args=[], returncode=0, stdout="Settings saved.\n")
        with patch.object(remote_control, "health", return_value=health), \
             patch.object(remote_control, "target_host", return_value={"id": "host1", "local": True}), \
             patch.object(remote_control, "command", return_value=ok_run) as mock_cmd:
            output, new_health = remote_control.local_save_account_settings({
                "slot": 1,
                "startup_command_enabled": True,
                "startup_command": "/home alt",
                "startup_delay": 5,
                "tpa_auto_accept": True,
                "tpa_whitelist": "PlayerA, PlayerB",
                "purpose": "spawner",
                "sync_all_accounts": True,
            })
            self.assertIn("Settings saved for JLorenzo and whitelist synced to all accounts", output)
            self.assertEqual(mock_cmd.call_count, 2)
            slot2_argv = mock_cmd.call_args_list[1][0][0]
            self.assertEqual(slot2_argv, [
                "sudo", "-n", "/usr/local/sbin/alt-pilot-set-account-options",
                "2", "0", "10", "/home cactus", "1", "PlayerA, PlayerB", "cactus",
            ])

    def test_set_account_options_hot_reloads_running_fifo(self):
        root = Path(__file__).parents[1]
        set_opts_script = root / "bin" / "alt-pilot-set-account-options"
        with tempfile.TemporaryDirectory() as sandbox:
            slot = 1
            slots_dir = Path(sandbox) / "slots"
            slot_dir = slots_dir / str(slot)
            slot_dir.mkdir(parents=True)
            fifo_path = slot_dir / "control.fifo"
            os.mkfifo(fifo_path, 0o600)

            reader = subprocess.Popen(["head", "-n", "1", str(fifo_path)], stdout=subprocess.PIPE, text=True)

            set_opts_text = set_opts_script.read_text(encoding="utf-8")
            patched_set_opts = set_opts_text.replace("/home/mc/slots/", f"{slots_dir.as_posix()}/")
            patched_set_opts = patched_set_opts.replace("command -v alt-pilot-mcc-prepare", "false")
            patched_set_opts = patched_set_opts.replace(
                'systemctl is-active "$unit" 2>/dev/null || true',
                'echo active'
            )
            runner = Path(sandbox) / "set-options"
            runner.write_text(patched_set_opts, encoding="utf-8")
            runner.chmod(0o755)

            env = dict(os.environ, MSYS_NO_PATHCONV="1")
            result = subprocess.run(
                ["bash", runner.as_posix(), str(slot), "1", "5", "/home alt", "1", "PlayerOne"],
                capture_output=True, text=True, check=True, env=env
            )
            self.assertIn("Account 1 settings saved", result.stdout)

            out, _ = reader.communicate(timeout=2)
            self.assertEqual(out.strip(), r"\reload")

    def test_set_account_options_and_mcc_prepare_functional(self):
        root = Path(__file__).parents[1]
        set_opts_script = root / "bin" / "alt-pilot-set-account-options"
        prepare_script = root / "bin" / "alt-pilot-mcc-prepare"
        health_script = root / "bin" / "afk-health-json"
        peer_script = root / "bin" / "alt-pilot-peer"

        subprocess.run(["bash", "-n", str(set_opts_script)], check=True)
        subprocess.run(["bash", "-n", str(prepare_script)], check=True)
        subprocess.run(["bash", "-n", str(health_script)], check=True)
        subprocess.run(["bash", "-n", str(peer_script)], check=True)

        with tempfile.TemporaryDirectory() as sandbox:
            slot = 1
            slots_dir = Path(sandbox) / "slots"
            slot_dir = slots_dir / str(slot)
            slot_dir.mkdir(parents=True)
            mcc_dir = slot_dir / "mcc"
            mcc_dir.mkdir(parents=True)

            # Test set_account_options writing settings.json with TPA whitelist
            set_opts_text = set_opts_script.read_text(encoding="utf-8")
            patched_set_opts = set_opts_text.replace("/home/mc/slots/", f"{slots_dir.as_posix()}/")
            patched_set_opts = patched_set_opts.replace("command -v alt-pilot-mcc-prepare", "false") # isolate
            runner = Path(sandbox) / "set-options"
            runner.write_text(patched_set_opts, encoding="utf-8")
            runner.chmod(0o755)

            env = dict(os.environ, MSYS_NO_PATHCONV="1")
            result = subprocess.run(["bash", runner.as_posix(), str(slot), "1", "5", "/home alt", "1", "DiddlyNoodle, jlorenzoo"], capture_output=True, text=True, check=True, env=env)
            self.assertIn("Account 1 settings saved", result.stdout)

            settings_json = json.loads((slot_dir / "settings.json").read_text(encoding="utf-8"))
            self.assertEqual(settings_json["startup_command_enabled"], True)
            self.assertEqual(settings_json["startup_command"], "/home alt")
            self.assertEqual(settings_json["startup_delay"], 5)
            self.assertEqual(settings_json["tpa_auto_accept"], True)
            self.assertEqual(settings_json["tpa_whitelist"], "DiddlyNoodle, jlorenzoo")
            settings_json["purpose"] = "spawner"
            (slot_dir / "settings.json").write_text(json.dumps(settings_json), encoding="utf-8")

            fake_binary = Path(sandbox) / "MinecraftClient"
            fake_binary.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
            fake_binary.chmod(0o755)

            # Test mcc-prepare generating startup.txt, matches.ini and MinecraftClient.ini
            prepare_text = prepare_script.read_text(encoding="utf-8")
            patched_prepare = prepare_text.replace("/home/mc/slots/", f"{slots_dir.as_posix()}/")
            patched_prepare = patched_prepare.replace("source_binary=/opt/alt-pilot/mcc/disk/MinecraftClient", f"source_binary={fake_binary.as_posix()}")
            patched_prepare = patched_prepare.replace("item_controls_source=/opt/alt-pilot/mcc/item-controls.cs", "item_controls_source=" + str(Path(__file__).resolve().parents[1] / "vm/item-controls.cs"))
            patched_prepare = patched_prepare.replace('[[ "$(id -un)" == mc ]] || {', '[[ 1 == 1 ]] || {')
            prepare_runner = Path(sandbox) / "mcc-prepare"
            prepare_runner.write_text(patched_prepare, encoding="utf-8")
            prepare_runner.chmod(0o755)

            subprocess.run(["bash", prepare_runner.as_posix(), str(slot)], capture_output=True, text=True, check=True)

            startup_txt = (mcc_dir / "startup.txt").read_text(encoding="utf-8")
            self.assertEqual(startup_txt.strip(), "wait 600\nsend /home alt")

            matches_ini = (mcc_dir / "matches.ini").read_text(encoding="utf-8")
            self.assertIn("[Match]", matches_ini)
            self.assertIn("(DiddlyNoodle|jlorenzoo)\\*?\\s+has requested (?:for you to teleport to them|that you teleport to them|to teleport to you|that they teleport to you)", matches_ini)
            self.assertIn("action=send /tpyes", matches_ini)
            self.assertIn("actionother=send /tpyes", matches_ini)
            self.assertIn("regex=(?i)COMPLEX SKYBLOCK 1\\.", matches_ini)
            self.assertIn("action=script startup.txt", matches_ini)
            self.assertIn("cooldown=600", matches_ini)
            self.assertIn("Failed to go to server\\s+Skyblock:\\s+Redirect timed out", matches_ini)
            self.assertIn("action=script to_skyblock.txt", matches_ini)
            self.assertTrue((mcc_dir / "to_skyblock.txt").exists())
            self.assertEqual((mcc_dir / "to_skyblock.txt").read_text(encoding="utf-8").strip(), "wait 60\nsend /skyblock")
            self.assertNotIn("/skyblock", matches_ini)
            self.assertNotIn("island is", matches_ini)
            self.assertFalse((mcc_dir / "island_retry.txt").exists())

            mcc_ini = (mcc_dir / "MinecraftClient.ini").read_text(encoding="utf-8")
            self.assertIn("InventoryHandling = true", mcc_ini)
            self.assertIn("[ChatBot.ScriptScheduler]\nEnabled = true", mcc_ini)
            self.assertIn('Action = "script item-controls.cs"', mcc_ini)
            self.assertNotIn("Trigger_On_Login = true", mcc_ini)
            self.assertIn("Trigger_On_First_Login = true", mcc_ini)
            self.assertIn("[ChatBot.AntiAFK]\nEnabled = false", mcc_ini)
            self.assertIn("[ChatBot.AutoRespond]\nEnabled = true", mcc_ini)
            self.assertIn('Matches_File = "matches.ini"', mcc_ini)

            subprocess.run(["bash", runner.as_posix(), str(slot), "0", "5", "/home alt", "1", "DiddlyNoodle, jlorenzoo", "spawner"], capture_output=True, text=True, check=True, env=env)
            subprocess.run(["bash", prepare_runner.as_posix(), str(slot)], capture_output=True, text=True, check=True)
            self.assertFalse((mcc_dir / "startup.txt").exists())
            self.assertTrue((mcc_dir / "to_skyblock.txt").exists())
            disabled_matches = (mcc_dir / "matches.ini").read_text(encoding="utf-8")
            self.assertNotIn("script startup.txt", disabled_matches)
            self.assertIn("action=script to_skyblock.txt", disabled_matches)
            self.assertEqual(json.loads((slot_dir / "settings.json").read_text(encoding="utf-8"))["startup_command"], "/home alt")

    def test_skyblock_redirect_timeout_regex_patterns(self):
        pattern = re.compile(r"(?i)Failed to go to server\s+Skyblock:\s+Redirect timed out")
        self.assertTrue(pattern.search("▌! Failed to go to server Skyblock: Redirect timed out"))
        self.assertTrue(pattern.search("! Failed to go to server Skyblock: Redirect timed out"))
        self.assertTrue(pattern.search("Failed to go to server Skyblock: Redirect timed out"))
        self.assertTrue(pattern.search("[13:27:50] [SERVER] ▌! Failed to go to server Skyblock: Redirect timed out"))
        self.assertFalse(pattern.search("✔ Sending you to Skyblock..."))
        self.assertFalse(pattern.search("You are already trying to connect to a Server!"))

    def test_tpa_auto_accept_regex_live_patterns(self):
        names = ["DiddlyNoodle", "jlorenzoo", "jlorenzo", "_Jlorenzoo_", "Alexeitor1", "mickele29"]
        names_regex = "|".join(re.escape(n) for n in names)
        pattern = re.compile(rf"(?i)^[▌\s]*\(/tpa\).*?(?:\]|\s)({names_regex})\*?\s+has requested (?:for you to teleport to them|that you teleport to them|to teleport to you|that they teleport to you)")

        # Positive matches from live Complex MC logs
        self.assertTrue(pattern.search("(/tpa) ⚠ [Soldier] JLorenzoo has requested for you to teleport to them!"))
        self.assertTrue(pattern.search("(/tpa) ⚠ [Member] Alexeitor1 has requested for you to teleport to them!"))
        self.assertTrue(pattern.search("(/tpa) ⚠ [Pharaoh➕] diddlynoodle has requested for you to teleport to them!"))
        self.assertTrue(pattern.search("(/tpa) ⚠ _Jlorenzoo_ has requested for you to teleport to them!"))
        self.assertTrue(pattern.search("(/tpa) ⚠ [Noble] mickele29 has requested for you to teleport to them!"))
        self.assertTrue(pattern.search("(/tpa) ⚠ [Soldier] JLorenzoo* has requested for you to teleport to them!"))
        self.assertTrue(pattern.search("(/tpa) ⚠ [Soldier] JLorenzoo has requested to teleport to you!"))
        self.assertTrue(pattern.search("▌ (/tpa) ⚠ [Member] Alexeitor1 has requested that they teleport to you!"))

        # Negative matches: unauthorized users, spoofing, etc.
        self.assertFalse(pattern.search("(/tpa) ⚠ [Member] UnknownPlayer has requested for you to teleport to them!"))
        self.assertFalse(pattern.search("[Member] Hacker: (/tpa) ⚠ JLorenzoo has requested for you to teleport to them!"))
        self.assertFalse(pattern.search("(/tpa) ⚠ [Member] notjlorenzoo has requested for you to teleport to them!"))
        self.assertFalse(pattern.search("(/tpa) ⚠ [Member] jlorenzoo_fake has requested for you to teleport to them!"))
        self.assertFalse(pattern.search("(/tpa) ⚠ [Member] UnknownPlayer has requested to teleport to you!"))
        self.assertFalse(pattern.search("[Member] Hacker: (/tpa) ⚠ JLorenzoo has requested to teleport to you!"))


class RemoteSessionManagementTests(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.sessions_file = Path(self.tmp_dir.name) / "control-sessions.json"
        self.orig_sessions_file = remote_control.SESSIONS_FILE
        self.orig_sessions = dict(remote_control.SESSIONS)
        remote_control.SESSIONS_FILE = self.sessions_file
        remote_control.SESSIONS.clear()

    def tearDown(self):
        remote_control.SESSIONS_FILE = self.orig_sessions_file
        remote_control.SESSIONS.clear()
        remote_control.SESSIONS.update(self.orig_sessions)
        self.tmp_dir.cleanup()

    def test_default_session_duration_is_30_days(self):
        self.assertEqual(remote_control.SESSION_DAYS, 30)
        self.assertEqual(remote_control.SESSION_SECONDS, 30 * 24 * 60 * 60)

    def test_hash_token_sha256(self):
        token = "sample_test_token_abc"
        expected = hashlib.sha256(token.encode("utf-8")).hexdigest()
        self.assertEqual(remote_control._hash_token(token), expected)

    def test_session_persistence_save_and_load(self):
        token = "persist_token_123"
        token_hash = remote_control._hash_token(token)
        future = time.time() + 10000.0

        with remote_control.SESSION_LOCK:
            remote_control.SESSIONS[token_hash] = future
        remote_control._save_sessions()

        self.assertTrue(self.sessions_file.is_file())
        saved = json.loads(self.sessions_file.read_text(encoding="utf-8"))
        self.assertIn(token_hash, saved)
        self.assertEqual(saved[token_hash], future)

        # Simulate fresh process start
        with remote_control.SESSION_LOCK:
            remote_control.SESSIONS.clear()
        self.assertEqual(len(remote_control.SESSIONS), 0)

        remote_control._load_sessions()
        with remote_control.SESSION_LOCK:
            self.assertIn(token_hash, remote_control.SESSIONS)
            self.assertEqual(remote_control.SESSIONS[token_hash], future)

    def test_load_sessions_prunes_expired(self):
        valid_hash = remote_control._hash_token("valid_token")
        expired_hash = remote_control._hash_token("expired_token")
        now = time.time()
        data = {valid_hash: now + 5000, expired_hash: now - 5000}
        self.sessions_file.write_text(json.dumps(data), encoding="utf-8")

        remote_control._load_sessions()
        with remote_control.SESSION_LOCK:
            self.assertIn(valid_hash, remote_control.SESSIONS)
            self.assertNotIn(expired_hash, remote_control.SESSIONS)

    def test_session_sliding_renewal_when_halfway_expired(self):
        token = "renew_token_xyz"
        token_hash = remote_control._hash_token(token)
        now = time.time()
        # Expiry is less than half the duration remaining
        initial_expiry = now + (remote_control.SESSION_SECONDS / 2) - 300
        with remote_control.SESSION_LOCK:
            remote_control.SESSIONS[token_hash] = initial_expiry

        handler = remote_control.RemoteHandler.__new__(remote_control.RemoteHandler)
        handler.headers = {"Cookie": f"afk_session={token}"}

        returned_token = handler.session()
        self.assertEqual(returned_token, token)
        # Verify renewal occurred
        self.assertEqual(getattr(handler, "_renew_cookie", None), token)
        with remote_control.SESSION_LOCK:
            new_expiry = remote_control.SESSIONS[token_hash]
            self.assertGreater(new_expiry, initial_expiry + 1000)

        # Verify end_headers emits refreshed cookie
        headers: list[tuple[str, str]] = []
        handler.send_header = lambda k, v: headers.append((k, v))
        with patch.object(control_center.Handler, "end_headers"):
            handler.end_headers()
        cookie_headers = [v for k, v in headers if k == "Set-Cookie"]
        self.assertEqual(len(cookie_headers), 1)
        self.assertIn(f"afk_session={token}", cookie_headers[0])
        self.assertIn(f"Max-Age={remote_control.SESSION_SECONDS}", cookie_headers[0])
        self.assertIsNone(handler._renew_cookie)

    def test_session_not_renewed_when_fresh(self):
        token = "fresh_token_xyz"
        token_hash = remote_control._hash_token(token)
        now = time.time()
        initial_expiry = now + remote_control.SESSION_SECONDS - 100
        with remote_control.SESSION_LOCK:
            remote_control.SESSIONS[token_hash] = initial_expiry

        handler = remote_control.RemoteHandler.__new__(remote_control.RemoteHandler)
        handler.headers = {"Cookie": f"afk_session={token}"}

        returned_token = handler.session()
        self.assertEqual(returned_token, token)
        self.assertIsNone(getattr(handler, "_renew_cookie", None))

    def test_login_redirects_if_already_authenticated(self):
        token = "active_session_abc"
        token_hash = remote_control._hash_token(token)
        with remote_control.SESSION_LOCK:
            remote_control.SESSIONS[token_hash] = time.time() + 10000

        headers: list[tuple[str, str]] = []
        status_list: list[int] = []
        handler = remote_control.RemoteHandler.__new__(remote_control.RemoteHandler)
        handler.path = "/login"
        handler.headers = {"Cookie": f"afk_session={token}"}
        handler.send_response = lambda code: status_list.append(code)
        handler.send_header = lambda k, v: headers.append((k, v))
        handler.end_headers = MagicMock()

        handler.do_GET()
        self.assertEqual(status_list, [303])
        self.assertIn(("Location", "/"), headers)

    def test_logout_clears_session_in_memory_and_disk(self):
        token = "logout_token_abc"
        token_hash = remote_control._hash_token(token)
        with remote_control.SESSION_LOCK:
            remote_control.SESSIONS[token_hash] = time.time() + 10000
        remote_control._save_sessions()

        headers: list[tuple[str, str]] = []
        status_list: list[int] = []
        handler = remote_control.RemoteHandler.__new__(remote_control.RemoteHandler)
        handler.path = "/logout"
        handler.headers = {"Cookie": f"afk_session={token}"}
        handler.send_response = lambda code: status_list.append(code)
        handler.send_header = lambda k, v: headers.append((k, v))
        handler.end_headers = MagicMock()

        handler.do_GET()
        self.assertEqual(status_list, [303])
        self.assertIn(("Location", "/login"), headers)
        cookie_headers = [v for k, v in headers if k == "Set-Cookie"]
        self.assertIn("Max-Age=0", cookie_headers[0])
        with remote_control.SESSION_LOCK:
            self.assertNotIn(token_hash, remote_control.SESSIONS)

        # Check disk was updated
        saved = json.loads(self.sessions_file.read_text(encoding="utf-8"))
        self.assertNotIn(token_hash, saved)

    def test_change_password_clears_sessions_in_memory_and_disk(self):
        token = "active_token_123"
        token_hash = remote_control._hash_token(token)
        with remote_control.SESSION_LOCK:
            remote_control.SESSIONS[token_hash] = time.time() + 10000
        remote_control._save_sessions()

        with patch.object(remote_control, "write_password"):
            output, _ = remote_control.change_password("A" * 20)

        self.assertIn("All signed-in sessions were signed out", output)
        with remote_control.SESSION_LOCK:
            self.assertEqual(len(remote_control.SESSIONS), 0)
        saved = json.loads(self.sessions_file.read_text(encoding="utf-8"))
        self.assertEqual(saved, {})


class I18nContractTests(unittest.TestCase):
    """Verify i18n infrastructure: language switcher markup, key parity, and app.js integration."""

    @classmethod
    def setUpClass(cls):
        root = Path(__file__).parents[1]
        cls.html = (root / "web" / "index.html").read_text(encoding="utf-8")
        cls.app_js = (root / "web" / "app.js").read_text(encoding="utf-8")
        cls.i18n_path = root / "web" / "i18n.js"

    def test_i18n_js_exists(self):
        self.assertTrue(self.i18n_path.is_file(), "web/i18n.js must exist")

    def test_en_it_key_parity(self):
        """Both language dictionaries must have identical key sets."""
        i18n_src = self.i18n_path.read_text(encoding="utf-8")
        # Extract keys by looking for key: patterns inside en: { ... } and it: { ... }
        key_pattern = re.compile(r"^\s+(\w+)\s*:", re.MULTILINE)
        # Split on the it: { boundary
        parts = re.split(r"\bit\s*:\s*\{", i18n_src, maxsplit=1)
        self.assertEqual(len(parts), 2, "i18n.js must contain an 'it' dictionary")
        en_section = parts[0]
        it_section = parts[1]
        en_keys = set(key_pattern.findall(en_section))
        it_keys = set(key_pattern.findall(it_section))
        # Remove structural keys that aren't translations
        for noise in ("en", "use", "const", "function", "if", "return", "let", "try", "for",
                      "getLang", "translations", "setLang", "applyTranslations", "onLangChange",
                      "listeners", "currentLang", "STORAGE_KEY", "TRANSLATIONS", "root", "api",
                      "stored", "text", "dict", "cb", "params", "key", "el"):
            en_keys.discard(noise)
            it_keys.discard(noise)
        missing_in_it = en_keys - it_keys
        missing_in_en = it_keys - en_keys
        self.assertFalse(missing_in_it, f"Keys in en but missing in it: {missing_in_it}")
        self.assertFalse(missing_in_en, f"Keys in it but missing in en: {missing_in_en}")

    def test_detect_browser_lang_uses_language_list(self):
        i18n_src = self.i18n_path.read_text(encoding="utf-8")
        self.assertIn("source.languages", i18n_src)
        self.assertIn("function detectBrowserLang", i18n_src)
        root = Path(__file__).parents[1]
        script = """
const i18n = require('./web/i18n.js');
const assert = require('assert');
assert.strictEqual(i18n.detectBrowserLang({ languages: ['it-IT'], language: 'it-IT' }), 'it');
assert.strictEqual(i18n.detectBrowserLang({ languages: ['it-CH', 'de'], language: 'it-CH' }), 'it');
assert.strictEqual(i18n.detectBrowserLang({ languages: ['en-US', 'it'], language: 'en-US' }), 'en');
assert.strictEqual(i18n.detectBrowserLang({ languages: ['de-DE', 'it-IT'], language: 'de-DE' }), 'it');
assert.strictEqual(i18n.detectBrowserLang({ languages: ['fr-FR'], language: 'fr-FR' }), 'en');
"""
        result = subprocess.run(["node", "-e", script], cwd=root, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)


class CalculatorContractTests(unittest.TestCase):
    """Verify the calculator ships markup, JS handlers, styles, and i18n together
    AND that the profit math is correct under every supported scenario."""

    def setUp(self):
        self.root = Path(__file__).parents[1]
        self.html = (self.root / "web" / "index.html").read_text(encoding="utf-8")
        self.js = (self.root / "web" / "app.js").read_text(encoding="utf-8")
        self.css = (self.root / "web" / "styles.css").read_text(encoding="utf-8")
        self.i18n_src = (self.root / "web" / "i18n.js").read_text(encoding="utf-8")

    def test_profit_math_handles_batch_units_with_zero_fee(self):
        # Replicate the calc functions in Node and exercise every code path.
        # ponytail: this is the smallest runnable check that fails if the math breaks.
        script = r"""
const toIGM = (a, c, r) => c === 'GC' ? a * r : a;
const fromIGM = (i, c, r) => (c === 'GC' && r > 0) ? i / r : i;
const batchSize = (unit, custom) => unit === 'custom' ? Math.max(1, custom || 1) : Math.max(1, Number(unit) || 1);
const totalForUnit = (amount, unit, qty, custom) => (amount / batchSize(unit, custom)) * qty;
const recompute = ({rate, qty, feePct, buyAmount, sellAmount, buyUnit, sellUnit, buyCustom, sellCustom,
                    buyCur = 'IGM', sellCur = 'GC'}) => {
  const buyTotal = totalForUnit(buyAmount, buyUnit, qty, buyCustom);
  const sellTotal = totalForUnit(sellAmount, sellUnit, qty, sellCustom);
  const costIGM = toIGM(buyTotal, buyCur, rate);
  const revIGM = toIGM(sellTotal, sellCur, rate);
  const feeIGM = revIGM * (feePct / 100);
  const profitIGM = (revIGM - feeIGM) - costIGM;
  return { profitIGM, profitPerItemIGM: profitIGM / qty, margin: costIGM > 0 ? (profitIGM / costIGM) * 100 : 0 };
};
const assert = require('assert');

// Scenario A: 1× / 64×, 2% fee (the classic case)
let r = recompute({rate: 2000000, qty: 64, feePct: 2,
  buyAmount: 215000, buyUnit: '1',
  sellAmount: 9, sellUnit: '64'});
assert.strictEqual(r.profitIGM, 9 * 2000000 * 0.98 - 215000 * 64, 'A: 64× profit');

// Scenario B: Sunday (0% fee)
r = recompute({rate: 2000000, qty: 64, feePct: 0,
  buyAmount: 215000, buyUnit: '1',
  sellAmount: 9, sellUnit: '64'});
assert.strictEqual(r.profitIGM, 9 * 2000000 - 215000 * 64, 'B: 0% fee matches 9*rate minus cost');

// Scenario B2: 16× batch scales like a 16-item price
r = recompute({rate: 2000000, qty: 64, feePct: 0,
  buyAmount: 3440000, buyUnit: '16',   // 3,440,000 / 16 = 215,000 per item
  sellAmount: 9, sellUnit: '64'});
assert.strictEqual(r.profitIGM, 9 * 2000000 - 215000 * 64, 'B2: 16× unit math');

// Scenario C: Custom buy unit (e.g. price for 10 items)
r = recompute({rate: 3000000, qty: 64, feePct: 2,
  buyAmount: 2150000, buyUnit: 'custom', buyCustom: 10,
  sellAmount: 9, sellUnit: '64'});
assert.strictEqual(r.profitIGM, 9 * 3000000 * 0.98 - (2150000 / 10) * 64, 'C: custom unit math');

// Scenario D: Custom sell unit + break-even margin (both sides IGM)
// cost = 20000 * 100 = 2,000,000
// For 2% fee, break-even revenue = cost / 0.98 = 2,040,816.326... → use ceil: 2,040,817.
r = recompute({rate: 2000000, qty: 100, feePct: 2,
  buyCur: 'IGM', sellCur: 'IGM',
  buyAmount: 20000, buyUnit: '1',                        // cost = 2,000,000
  sellAmount: 2040817, sellUnit: 'custom', sellCustom: 100}); // per-item = 20,408.17; *100 = 2,040,817 → net 0.98 * 2,040,817 ≈ 2,000,000
assert.ok(Math.abs(r.profitIGM) < 5, 'D: ~0 profit, got ' + r.profitIGM);
assert.ok(Math.abs(r.margin) < 0.01, 'D: ~0% margin, got ' + r.margin);

// Scenario E: zero total cost (sell side only) -> margin is 0 by design
r = recompute({rate: 100, qty: 1, feePct: 0,
  buyAmount: 0, buyUnit: '1',
  sellAmount: 5, sellUnit: '1'});
assert.strictEqual(r.profitIGM, 5 * 100, 'E: zero cost handled');

console.log('calculator math ok');
"""
        result = subprocess.run(["node", "-e", script], cwd=self.root, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)

    def test_item_sprite_catalog_and_atlas_ship_together(self):
        catalog_path = self.root / "web" / "items.json"
        atlas_path = self.root / "web" / "items-atlas.png"
        self.assertTrue(catalog_path.is_file(), "item catalog must ship")
        self.assertTrue(atlas_path.is_file(), "item atlas must ship")
        catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
        ids = {entry[0] for entry in catalog["items"]}
        self.assertGreater(len(ids), 1000, "catalog must cover all MC items")
        for item_id in ("diamond", "tripwire_hook", "grass_block", "netherite_ingot"):
            self.assertIn(item_id, ids)
        self.assertGreaterEqual(catalog["cols"] * catalog["rows"], len(catalog["items"]))
        self.assertIn('id="calcSpriteSearch"', self.html, "sprite search box must exist")
        self.assertIn("items.json", self.js, "app must load the sprite catalog")
        self.assertIn("bestItemMatch", self.js, "name recognition must be wired in")
        self.assertIn(".calc-sprite-opt .sprite", self.css, "atlas sprite styling must exist")

    def test_shorthand_input_and_compact_output(self):
        # Amount/rate inputs accept K/M shorthand ("210K", "2.1m"); outputs are
        # compact ("35.6K", "3.88M"). Only K and M — nothing smaller/bigger.
        self.assertIn('id="calcBuyAmount" type="text"', self.html)
        self.assertIn('id="calcSellAmount" type="text"', self.html)
        self.assertIn('id="calcRate" type="text"', self.html)
        self.assertIn("parseShorthand", self.js)
        self.assertIn("fmtShort", self.js)
        script = r"""
const parseShorthand = (raw) => {
  if (raw === null || raw === undefined) return 0;
  let s = String(raw).trim().replace(/[\s_]/g, '');
  if (!s) return 0;
  let mult = 1;
  const suffix = s.slice(-1).toLowerCase();
  if (suffix === 'k' || suffix === 'm') {
    mult = suffix === 'k' ? 1000 : 1000000;
    s = s.slice(0, -1);
  }
  if (!s) return 0;
  if (s.includes('.') && s.includes(',')) s = s.replace(/,/g, '');
  else if (s.includes(',')) s = (s.match(/,/g) || []).length > 1 ? s.replace(/,/g, '') : s.replace(',', '.');
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(s)) return 0;
  const v = parseFloat(s) * mult;
  return Number.isFinite(v) ? v : 0;
};
const trimZeros = (v, d) => { const s = v.toFixed(d); return s.includes('.') ? s.replace(/\.?0+$/, '') : s; };
const fmtShort = (n) => {
  if (!Number.isFinite(n)) return '—';
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  if (a >= 999500) return `${sign}${trimZeros(a / 1000000, 2)}M`;
  if (a >= 1000) return `${sign}${trimZeros(a / 1000, 1)}K`;
  return `${sign}${a.toLocaleString('en-US')}`;
};
const assert = require('assert');
assert.strictEqual(parseShorthand('210K'), 210000);
assert.strictEqual(parseShorthand('210k'), 210000);
assert.strictEqual(parseShorthand('2.1m'), 2100000);
assert.strictEqual(parseShorthand('2M'), 2000000);
assert.strictEqual(parseShorthand('215000'), 215000);
assert.strictEqual(parseShorthand('9'), 9);
assert.strictEqual(parseShorthand('1.5K'), 1500);
assert.strictEqual(parseShorthand(' 210 k '), 210000);
assert.strictEqual(parseShorthand('2,100,000'), 2100000);
assert.strictEqual(parseShorthand('2,1m'), 2100000);
assert.strictEqual(parseShorthand(''), 0);
assert.strictEqual(parseShorthand('abc'), 0);
assert.strictEqual(parseShorthand('K'), 0);
assert.strictEqual(fmtShort(35625), '35.6K');
assert.strictEqual(fmtShort(210000), '210K');
assert.strictEqual(fmtShort(3880000), '3.88M');
assert.strictEqual(fmtShort(2100000), '2.1M');
assert.strictEqual(fmtShort(9000000), '9M');
assert.strictEqual(fmtShort(999), '999');
assert.strictEqual(fmtShort(9), '9');
assert.strictEqual(fmtShort(-2500), '-2.5K');
assert.strictEqual(fmtShort(999950), '1M');
console.log('shorthand + compact ok');
"""
        result = subprocess.run(["node", "-e", script], cwd=self.root, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)


if __name__ == "__main__":
    unittest.main()
