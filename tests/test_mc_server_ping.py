"""Smoke test for the Minecraft Server List Ping (SLP) parser.

Runs a tiny in-process TCP server that emits a canned status response and
checks that mc_server_ping.ping parses the player sample correctly.
"""

from __future__ import annotations

import socket
import threading
import unittest

import mc_server_ping


CANNED = (
    '{"version":{"name":"1.12.2","protocol":340},'
    '"players":{"max":100,"online":2,'
    '"sample":[{"name":"Notch","id":"069a79f4-44e9-4726-a5be-fca90e38aaf5"},'
    '{"name":"jeb","id":"853c80ef-3c37-49fd-aa54-59d2dc4d51d7"}]},'
    '"description":{"text":"A Minecraft Server"},"favicon":""}'
)


def _handshake_response() -> bytes:
    payload = CANNED.encode("utf-8")
    inner = mc_server_ping._pack_varint(0x00) + mc_server_ping._pack_varint(len(payload)) + payload
    return mc_server_ping._pack_varint(len(inner)) + inner


class SLPTests(unittest.TestCase):
    def _serve_one(self) -> int:
        ready = threading.Event()
        port_holder: list[int] = []

        def server() -> None:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                sock.bind(("127.0.0.1", 0))
                port_holder.append(sock.getsockname()[1])
                sock.listen(1)
                ready.set()
                conn, _ = sock.accept()
                with conn:
                    conn.settimeout(0.5)
                    conn.sendall(_handshake_response())
                    try:
                        while conn.recv(4096):
                            pass
                    except OSError:
                        pass

        threading.Thread(target=server, daemon=True).start()
        ready.wait()
        return port_holder[0]

    def test_ping_parses_sample(self) -> None:
        port = self._serve_one()
        result = mc_server_ping.ping("127.0.0.1", port, timeout=2.0)
        self.assertIsNone(result.error, msg=result.error)
        self.assertEqual(result.online_players, 2)
        self.assertEqual(result.max_players, 100)
        self.assertIn("Notch", result.sample)
        self.assertIn("jeb", result.sample)

    def test_ping_handles_unreachable(self) -> None:
        result = mc_server_ping.ping("127.0.0.1", 1, timeout=0.5)
        self.assertIsNotNone(result.error)


if __name__ == "__main__":
    unittest.main()
