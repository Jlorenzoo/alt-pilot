"""Validate that runtime preparation preserves code and rejects unverified input."""
import hashlib
import os
import importlib.util
from pathlib import Path
import struct
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('prepare_mcc_runtime', Path(__file__).resolve().parents[1] / 'vm/prepare-mcc-runtime.py')
runtime = importlib.util.module_from_spec(spec); spec.loader.exec_module(runtime)


class RuntimeTests(unittest.TestCase):
    def bundle(self):
        data = bytearray(512)
        data[16:48] = runtime.SIGNATURE
        struct.pack_into('<q', data, 8, 256)
        struct.pack_into('<IIi', data, 256, 6, 0, 1)
        data[268:274] = b'\x05hello'
        return data

    def test_only_extract_all_flag_changes_and_original_is_preserved(self):
        with tempfile.TemporaryDirectory() as folder:
            original = self.bundle(); source = Path(folder)/'original'; destination = Path(folder)/'disk'/'MinecraftClient'
            source.write_bytes(original)
            offset = runtime.prepare(source, destination, hashlib.sha256(original).hexdigest())
            expected = bytearray(original); struct.pack_into('<Q', expected, offset, 1)
            self.assertEqual(source.read_bytes(), original)
            self.assertEqual(destination.read_bytes(), expected)
            if os.name == "posix":
                self.assertEqual(destination.stat().st_mode & 0o777, 0o750)

    def test_bad_checksum_never_replaces_destination(self):
        with tempfile.TemporaryDirectory() as folder:
            source, destination = Path(folder)/'source', Path(folder)/'destination'
            source.write_bytes(self.bundle()); destination.write_bytes(b'previous')
            with self.assertRaisesRegex(ValueError, 'checksum'):
                runtime.prepare(source, destination)
            self.assertEqual(destination.read_bytes(), b'previous')
            with self.assertRaises(ValueError): runtime.prepare(source, source)

    def test_invalid_headers_and_unknown_flags_are_rejected(self):
        for mutation in ('signature', 'offset', 'version', 'count', 'string', 'flags'):
            data = self.bundle()
            if mutation == 'signature': data[16] = 0
            elif mutation == 'offset': struct.pack_into('<q', data, 8, 9999)
            elif mutation == 'version': struct.pack_into('<I', data, 256, 7)
            elif mutation == 'count': struct.pack_into('<i', data, 264, -1)
            elif mutation == 'string': data[268:274] = b'\xff'*6
            else: struct.pack_into('<Q', data, 306, 2)
            with self.subTest(mutation=mutation), self.assertRaises(ValueError): runtime.flag_offset(data)
