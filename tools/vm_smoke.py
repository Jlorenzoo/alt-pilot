#!/usr/bin/env python3
"""Post-install checks for a DISPOSABLE VM. Never signs into Minecraft."""
import http.client
import json
import os
from pathlib import Path
import secrets
import subprocess
import time
import urllib.parse


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def request(method, path, body=None, headers=None):
    connection = http.client.HTTPConnection('127.0.0.1', 8765, timeout=30)
    connection.request(method, path, body=body, headers=headers or {})
    response = connection.getresponse()
    result = response.status, dict(response.getheaders()), response.read()
    connection.close()
    return result


def main():
    require(os.environ.get('AFK_DISPOSABLE_TEST') == '1' and os.geteuid() == 0,
            'Run only as root in a disposable VM with AFK_DISPOSABLE_TEST=1.')
    slots = Path('/home/mc/slots')
    require(not list(slots.glob('*/account.json')) and not list(slots.glob('*/mcc/SessionCache.db')),
            'Refusing to run on a machine with saved Minecraft accounts.')
    for service in ('alt-pilot-control.service', 'alt-pilot-watchdog.timer'):
        subprocess.run(['systemctl', 'is-active', '--quiet', service], check=True)
    require(request('GET', '/login')[0] == 200, 'Login page is unavailable.')
    require(request('GET', '/api/bootstrap')[0] == 401, 'Unauthenticated API access was accepted.')
    password = Path('/opt/alt-pilot/initial-control-password').read_text().strip()

    def login(value):
        status, headers, _ = request('POST', '/login', urllib.parse.urlencode({'password': value}),
                                     {'Content-Type': 'application/x-www-form-urlencoded'})
        require(status == 303, 'Dashboard login failed.')
        cookie = headers.get('Set-Cookie', '')
        require('Secure' in cookie and 'HttpOnly' in cookie and 'SameSite=Strict' in cookie, 'Session cookie lacks security flags.')
        return {'Cookie': cookie.split(';', 1)[0]}

    session = login(password)
    status, _, data = request('GET', '/api/bootstrap', headers=session)
    require(status == 200, 'Authenticated dashboard bootstrap failed.')
    bootstrap = json.loads(data)
    token = bootstrap['token']
    session.update({'Content-Type': 'application/json', 'X-Control-Token': token,
                    'Origin': 'https://127.0.0.1:8765'})

    def action(payload):
        status, _, data = request('POST', '/api/actions', json.dumps(payload), session)
        require(status == 202, 'Dashboard rejected the smoke action.')
        task_id = json.loads(data)['task']['id']
        for _ in range(60):
            _, _, data = request('GET', '/api/tasks/' + task_id, headers=session)
            task = json.loads(data)
            if task['state'] != 'running':
                return task
            time.sleep(0.25)
        raise RuntimeError('Dashboard action did not finish.')

    try:
        task = action({'action': 'save_account_settings', 'slot': 10, 'startup_command_enabled': False,
                       'tpa_auto_accept': False, 'tpa_whitelist': 'FixturePlayer', 'startup_delay': 5})
        require(task['state'] == 'succeeded', 'Restricted per-account settings writer failed.')
        record = slots / '10/settings.json'
        require(record.exists() and record.stat().st_uid == __import__('pwd').getpwnam('mc').pw_uid,
                'Settings were not written as the game user.')
        task = action({'action': 'start', 'slot': 10})
        require(task['state'] == 'failed', 'An unsigned account was allowed to start.')
    finally:
        import shutil
        # This slot has no identity or token: it was created only by this test.
        shutil.rmtree(slots / '10', ignore_errors=True)

    new_password = secrets.token_urlsafe(24)
    status, _, _ = request('POST', '/api/actions', json.dumps({'action': 'change_password', 'new_password': new_password, 'confirm_password': new_password}), session)
    require(status == 202, 'Password rotation was rejected.')
    for _ in range(30):
        if request('GET', '/api/bootstrap', headers=session)[0] == 401:
            break
        time.sleep(0.1)
    else:
        raise RuntimeError('Password rotation did not invalidate the old session.')
    login(new_password)
    Path('/opt/alt-pilot/initial-control-password').write_text(new_password+'\n')
    Path('/opt/alt-pilot/initial-control-password').chmod(0o600)
    require(Path('/etc/alt-pilot').stat().st_mode & 0o022 == 0, 'Privileged configuration is writable by unprivileged users.')
    subprocess.run(['runuser', '-u', 'mc', '--', '/opt/alt-pilot/node/bin/node', '-e',
                    "require('/opt/alt-pilot/bedrock/node_modules/bedrock-protocol'); require('/opt/alt-pilot/bedrock/node_modules/@roamhq/wrtc')"], check=True)
    subprocess.run(['runuser', '-u', 'afk-control', '--', 'sudo', '-n', '/usr/local/bin/afk-health-json'],
                   check=True, stdout=subprocess.DEVNULL)
    print('PASS: services, authentication, cookies, least-privilege settings, unsigned-account rejection, password rotation, Java/Bedrock runtime health.')


if __name__ == '__main__':
    main()
