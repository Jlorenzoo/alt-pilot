#!/usr/bin/env python3
"""Enable disk extraction on the verified MCC .NET bundle, preserving its payload.

The official single-file build makes Roslyn copy the embedded assemblies into
managed memory. .NET's extract-all flag gives Assembly.Location a real path so
MCC uses memory-mapped DLL references instead. Only this packaging flag changes;
all embedded code and the original downloaded binary remain unchanged.

Format: dotnet/runtime, Microsoft.NET.HostModel/Bundle/Manifest.cs (v6).
"""
import argparse
import hashlib
import mmap
import os
from pathlib import Path
import shutil
import struct
import tempfile

MCC_SHA256 = '2e0fe135079824d1b02a3ef9bf89c56d95d72a1d1502d7204f93acc0084223db'
SIGNATURE = bytes.fromhex('8b1202b96a612038727b930214d7a03213f5b9e6efae3318ee3b2dce24b36aae')


def flag_offset(data):
    signature = data.find(SIGNATURE)
    if signature < 8:
        raise ValueError('MCC bundle signature is missing.')
    header = struct.unpack_from('<q', data, signature - 8)[0]
    if not 0 < header < len(data) - 64:
        raise ValueError('Invalid MCC bundle header.')
    major, minor, count = struct.unpack_from('<IIi', data, header)
    if (major, minor) != (6, 0) or not 1 <= count <= 10000:
        raise ValueError('Unsupported MCC bundle format.')
    # BinaryWriter UTF-8 string: bounded 7-bit length prefix, then extraction ID.
    position, length, shift = header + 12, 0, 0
    while True:
        if shift > 28 or position >= len(data):
            raise ValueError('Invalid MCC extraction ID.')
        value = data[position]; position += 1
        length |= (value & 127) << shift
        if not value & 128: break
        shift += 7
    position += length + 32  # ID, deps.json location, runtimeconfig.json location
    if length > 1024 or position + 8 > len(data):
        raise ValueError('Invalid MCC bundle flags location.')
    if struct.unpack_from('<Q', data, position)[0] != 0:
        raise ValueError('Unexpected MCC bundle flags; refusing to modify it.')
    return position


def prepare(source, destination, expected=MCC_SHA256):
    source, destination = Path(source), Path(destination)
    if source.resolve() == destination.resolve():
        raise ValueError('Keep the original MCC binary separate from its launcher.')
    with source.open('rb') as stream:
        with mmap.mmap(stream.fileno(), 0, access=mmap.ACCESS_READ) as data:
            if hashlib.sha256(data).hexdigest() != expected:
                raise ValueError('MCC checksum mismatch; refusing to prepare runtime.')
            offset = flag_offset(data)
    destination.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.MinecraftClient-', dir=destination.parent)
    try:
        with os.fdopen(fd, 'wb') as output, source.open('rb') as original:
            shutil.copyfileobj(original, output)
            output.seek(offset)
            output.write(struct.pack('<Q', 1))  # NetcoreApp3CompatMode: extract all
            output.flush()
            os.fsync(output.fileno())
        os.chmod(temporary, 0o750)
        os.replace(temporary, destination)
    finally:
        Path(temporary).unlink(missing_ok=True)
    return offset


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source')
    parser.add_argument('destination')
    parser.add_argument('--sha256', default=MCC_SHA256)
    args = parser.parse_args()
    offset = prepare(args.source, args.destination, args.sha256)
    print(f'Prepared MCC disk-backed assembly loading (packaging flag at {offset}).')
