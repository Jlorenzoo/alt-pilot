"""Exercise the privileged inbox reader against real files, without sudo or MC."""
import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

if os.name == "posix":
    loader = importlib.machinery.SourceFileLoader('chat_inbox', str(Path(__file__).resolve().parents[1] / 'bin/alt-pilot-chat-inbox'))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    inbox = importlib.util.module_from_spec(spec)
    loader.exec_module(inbox)
else:
    inbox = None


@unittest.skipUnless(os.name == "posix", "Privileged inbox is a Linux host helper")
class InboxTests(unittest.TestCase):
    def test_valid_requests_and_unsafe_files(self):
        with tempfile.TemporaryDirectory() as folder:
            file = Path(folder) / 'request.json'
            request = {'sender': 'Admin', 'target': 'Other', 'operation': 'add', 'created': 123}
            file.write_text(json.dumps(request))
            self.assertEqual(inbox.read_request(file, os.getuid()), request)
            with self.assertRaises(ValueError): inbox.read_request(file, os.getuid()+1)
            link = Path(folder) / 'link.json'; link.symlink_to(file)
            with self.assertRaises(OSError): inbox.read_request(link, os.getuid())
            fifo = Path(folder) / 'fifo.json'; os.mkfifo(fifo)
            with self.assertRaises(ValueError): inbox.read_request(fifo, os.getuid())
            for invalid in ([], None, {'sender': None}, dict(request, target=None),
                            dict(request, operation='shell'), dict(request, sender='Admin\nrestart')):
                file.write_text(json.dumps(invalid))
                with self.assertRaises(ValueError): inbox.read_request(file, os.getuid())
            file.write_text(' '*2049)
            with self.assertRaises(ValueError): inbox.read_request(file, os.getuid())

    def test_symlinked_inbox_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder) / 'slots'; (base / '1').mkdir(parents=True)
            (base / '1' / 'chat-requests').symlink_to(Path(folder))
            previous = inbox.BASE
            try:
                inbox.BASE = base
                with self.assertRaises(ValueError): inbox.folder(1)
            finally:
                inbox.BASE = previous
