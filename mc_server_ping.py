"""Minecraft Server List Ping (SLP) for Java Edition.

Pure-Python implementation with no third-party dependencies.  Returns the
player sample list from the server's status response, which can be used to
check whether a specific username is currently online.

The SLP player sample is best-effort: vanilla servers cap it at 12 random
names.  A positive match is reliable; a miss does not guarantee the player
is offline.

Reference: https://wiki.vg/Server_List_Ping
"""

from __future__ import annotations

import json
import socket
import struct
from dataclasses import dataclass, field
from typing import Any


@dataclass
class PingResult:
    """Parsed SLP response."""
    online_players: int = 0
    max_players: int = 0
    sample: list[str] = field(default_factory=list)
    description: str = ""
    raw: dict[str, Any] = field(default_factory=dict)
    error: str | None = None


def _pack_varint(value: int) -> bytes:
    """Encode a signed 32-bit integer as a Minecraft protocol VarInt."""
    parts: list[int] = []
    for _ in range(5):
        byte = value & 0x7F
        value >>= 7
        if value:
            byte |= 0x80
        parts.append(byte)
        if not value:
            break
    return bytes(parts)


def _read_varint(sock: socket.socket) -> int:
    """Read a VarInt from a socket, one byte at a time."""
    result = 0
    for i in range(5):
        byte = sock.recv(1)
        if not byte:
            raise ConnectionError("Connection closed while reading VarInt")
        value = byte[0]
        result |= (value & 0x7F) << (7 * i)
        if not (value & 0x80):
            break
    else:
        raise ValueError("VarInt is too big")
    # Sign-extend for negative values.
    if result & (1 << 31):
        result -= 1 << 32
    return result


def _recv_exact(sock: socket.socket, count: int) -> bytes:
    """Read exactly *count* bytes from a socket."""
    buffer = bytearray()
    while len(buffer) < count:
        chunk = sock.recv(count - len(buffer))
        if not chunk:
            raise ConnectionError("Connection closed while reading data")
        buffer.extend(chunk)
    return bytes(buffer)


def _build_handshake(host: str, port: int) -> bytes:
    """Build a Handshake packet (id 0x00) with Next State = Status (1)."""
    host_bytes = host.encode("utf-8")
    payload = (
        _pack_varint(0x00)              # Packet ID
        + _pack_varint(-1)              # Protocol version (-1 = unspecified)
        + _pack_varint(len(host_bytes)) # Server address length
        + host_bytes                    # Server address
        + struct.pack(">H", port)       # Server port
        + _pack_varint(1)               # Next state: Status
    )
    return _pack_varint(len(payload)) + payload


def _build_status_request() -> bytes:
    """Build a Status Request packet (id 0x00, empty payload)."""
    payload = _pack_varint(0x00)
    return _pack_varint(len(payload)) + payload


def ping(host: str, port: int = 25565, timeout: float = 3.0) -> PingResult:
    """Query a Minecraft Java server for its status and online player sample.

    Returns a PingResult with the player sample names (if the server exposes
    them).  On any error, returns a PingResult with the ``error`` field set.
    """
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(timeout)
            sock.connect((host, port))

            # Send Handshake + Status Request.
            sock.sendall(_build_handshake(host, port))
            sock.sendall(_build_status_request())

            # Read the response: length, packet ID, then JSON string.
            _total_length = _read_varint(sock)
            packet_id = _read_varint(sock)
            if packet_id != 0x00:
                return PingResult(error=f"Unexpected packet ID: {packet_id:#x}")

            json_length = _read_varint(sock)
            if json_length <= 0 or json_length > 1_048_576:
                return PingResult(error=f"JSON payload length out of range: {json_length}")

            raw_json = _recv_exact(sock, json_length).decode("utf-8")

        data = json.loads(raw_json)
        players = data.get("players", {})
        sample_entries = players.get("sample", [])
        sample_names = [
            str(entry.get("name", ""))
            for entry in sample_entries
            if isinstance(entry, dict) and entry.get("name")
        ]

        description = ""
        desc_raw = data.get("description", "")
        if isinstance(desc_raw, str):
            description = desc_raw
        elif isinstance(desc_raw, dict):
            description = str(desc_raw.get("text", ""))

        return PingResult(
            online_players=int(players.get("online", 0)),
            max_players=int(players.get("max", 0)),
            sample=sample_names,
            description=description,
            raw=data,
        )

    except (OSError, ConnectionError, TimeoutError, ValueError, json.JSONDecodeError) as exc:
        return PingResult(error=str(exc))
