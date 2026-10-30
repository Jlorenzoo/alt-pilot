#!/usr/bin/env python3
"""End-to-end IP TLS/ACME test. Uses only a local test CA, never public issuance."""
import argparse
import http.client
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import ssl
import subprocess
import tempfile
import threading
import time
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
PEBBLE = 'ghcr.io/letsencrypt/pebble@sha256:ddf230642b1a584f519f32e347de1b05a6e4c1f6c35c1863b33effeab5f78199'


def available(port):
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', port))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--caddy', required=True)
    args = parser.parse_args()
    # Fail safely instead of interfering with any service already on these ports.
    for port in (14000, 15000, 18080, 18443):
        available(port)
    import sys
    sys.path.insert(0, str(ROOT))
    import control_center as core
    import remote_control as remote
    name = 'alt-pilot-acme-' + secrets.token_hex(4)
    process = None
    server = None
    with tempfile.TemporaryDirectory(prefix='alt-pilot-https-') as directory:
        folder = Path(directory)
        try:
            subprocess.run(['docker', 'create', '--name', name, PEBBLE], check=True, stdout=subprocess.DEVNULL)
            subprocess.run(['docker', 'cp', name+':/test/config/pebble-config.json', str(folder / 'pebble.json')], check=True)
            subprocess.run(['docker', 'cp', name+':/test/certs/pebble.minica.pem', str(folder / 'pebble-ca.pem')], check=True)
            config = json.loads((folder / 'pebble.json').read_text())
            config['pebble'].update(httpPort=18080, tlsPort=18443)
            (folder / 'pebble.json').write_text(json.dumps(config))
            subprocess.run(['docker', 'rm', name], check=True, stdout=subprocess.DEVNULL)
            subprocess.run(['docker', 'create', '--name', name, '--network', 'host', '-e', 'PEBBLE_VA_NOSLEEP=1', '-e', 'PEBBLE_WFE_NONCEREJECT=0',
                            '-v', str(folder / 'pebble.json') + ':/test/alt-pilot.json:ro', PEBBLE, '-config', '/test/alt-pilot.json'], check=True, stdout=subprocess.DEVNULL)
            subprocess.run(['docker', 'start', name], check=True, stdout=subprocess.DEVNULL)
            ca_context = ssl.create_default_context(cafile=str(folder / 'pebble-ca.pem'))
            for _ in range(40):
                try:
                    with urllib.request.urlopen('https://localhost:15000/roots/0', context=ca_context, timeout=2) as response:
                        (folder / 'issued-ca.pem').write_bytes(response.read())
                    break
                except (OSError, urllib.error.URLError):
                    time.sleep(0.25)
            else:
                raise RuntimeError('Local ACME authority did not become ready.')
            remote.PASSWORD_FILE = folder / 'password.json'
            remote.SESSIONS_FILE = folder / 'sessions.json'
            password = secrets.token_urlsafe(24)
            remote.write_password(password)
            server = core.BoundedThreadingHTTPServer(('127.0.0.1', 0), remote.RemoteHandler)
            threading.Thread(target=server.serve_forever, daemon=True).start()
            # Exercise the production Caddyfile, changing only test ports/CA/IP.
            source = (ROOT / 'vm/install-https.sh').read_text()
            text = source.split('cat > /etc/alt-pilot/Caddyfile <<EOF\n', 1)[1].split('\nEOF', 1)[0]
            text = text.replace('$ip', '127.0.0.1').replace('    admin off', '    admin off\n    http_port 18080\n    https_port 18443')
            text = text.replace('https://acme-v02.api.letsencrypt.org/directory', 'https://localhost:14000/dir\n            test_dir https://localhost:14000/dir\n            trusted_roots '+str(folder / 'pebble-ca.pem'))
            text = text.replace('127.0.0.1:8765', '127.0.0.1:' + str(server.server_address[1]))
            (folder / 'Caddyfile').write_text(text)
            env = dict(os.environ, XDG_DATA_HOME=str(folder / 'data'), XDG_CONFIG_HOME=str(folder / 'config'))
            log = (folder / 'caddy.log').open('w')
            command = [args.caddy, 'run', '--config', str(folder / 'Caddyfile'), '--adapter', 'caddyfile']
            process = subprocess.Popen(command, env=env, stdout=log, stderr=log)
            context = ssl.create_default_context(cafile=str(folder / 'issued-ca.pem'))

            def fetch(method, path, body=None, headers=None):
                # Connect on a different local IP while validating the public identity.
                # This emulates Oracle's public-to-private NAT and catches the
                # missing default_sni bug that ordinary localhost tests miss.
                connection = http.client.HTTPConnection('127.0.0.1', 18443, timeout=3)
                connection.sock = context.wrap_socket(socket.create_connection(('127.0.0.2', 18443), timeout=3), server_hostname='127.0.0.1')
                connection.request(method, path, body=body, headers=headers or {})
                response = connection.getresponse()
                data = response.read()
                certificate = connection.sock.getpeercert() if connection.sock else None
                result = response.status, dict(response.getheaders()), data, certificate
                connection.close()
                return result

            for _ in range(90):
                try:
                    if fetch('GET', '/login')[0] == 200:
                        break
                except (OSError, http.client.HTTPException):
                    pass
                time.sleep(0.5)
            else:
                raise RuntimeError('IP HTTPS did not become ready. ' + (folder / 'caddy.log').read_text()[-2000:])
            with socket.create_connection(('127.0.0.2', 18443)) as sock, context.wrap_socket(sock, server_hostname='127.0.0.1') as tls:
                certificate = tls.getpeercert()
            assert ('IP Address', '127.0.0.1') in certificate['subjectAltName']
            assert ssl.cert_time_to_seconds(certificate['notAfter']) - ssl.cert_time_to_seconds(certificate['notBefore']) <= 7*86400
            assert fetch('GET', '/api/bootstrap')[0] == 401
            status, headers, _, _ = fetch('POST', '/login', urllib.parse.urlencode({'password': password}), {'Content-Type': 'application/x-www-form-urlencoded'})
            assert status == 303 and 'Secure' in headers.get('Set-Cookie', '')
            process.terminate(); process.wait(timeout=10)
            process = subprocess.Popen(command, env=env, stdout=log, stderr=log)
            for _ in range(30):
                try:
                    assert fetch('GET', '/login')[0] == 200
                    break
                except (OSError, AssertionError):
                    time.sleep(0.2)
            else:
                raise RuntimeError('HTTPS did not recover after proxy restart.')
            with socket.create_connection(('127.0.0.2', 18443)) as sock, context.wrap_socket(sock, server_hostname='127.0.0.1') as tls:
                assert tls.getpeercert()['serialNumber'] == certificate['serialNumber']
            print('PASS: IP certificate, real ACME challenge, trusted TLS, HTTPS login, API authentication, and persistent certificate after restart.')
        finally:
            if process:
                process.terminate(); process.wait(timeout=10)
            if server:
                server.shutdown(); server.server_close()
            subprocess.run(['docker', 'rm', '-f', name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


if __name__ == '__main__':
    main()
