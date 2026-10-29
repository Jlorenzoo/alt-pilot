"""Global whitelist mutations requested by already-whitelisted in-game players."""
import json
import re
import math
import threading
import time

NAME = re.compile(r'^\.?[A-Za-z0-9_]{1,32}$')
REQUEST_ID = re.compile(r'^[a-f0-9]{32}$')
def canonical(name): return name.lower().lstrip('.')

def changed_whitelist(current, sender, operation, target):
    if not NAME.fullmatch(sender) or not NAME.fullmatch(target) or operation not in ('add', 'remove'):
        raise ValueError('Invalid whitelist command.')
    names = [x for x in re.split(r'[\s,]+', current) if NAME.fullmatch(x)]
    if not any(canonical(x) == canonical(sender) for x in names):
        raise PermissionError('You are no longer on the whitelist.')
    if operation == 'add':
        if not any(canonical(x) == canonical(target) for x in names): names.append(target)
    else:
        names = [x for x in names if canonical(x) != canonical(target)]
        if not names: raise ValueError('Cannot remove the last whitelisted player.')
    result = ', '.join(dict.fromkeys(names))
    if len(result) > 500: raise ValueError('The whitelist is full.')
    return result

class Broker:
    def __init__(self, api):
        self.api = api
        self.completed = {}
        self.restart_times = {}
    def process(self, host, request):
        if not isinstance(request, dict): return
        slot, ident = request.get('slot'), request.get('id')
        if type(slot) is not int or not 1 <= slot <= 10 or not isinstance(ident, str) or not REQUEST_ID.fullmatch(ident):
            return
        if self.api.target_host(slot)['id'] != host['id']: return
        sender, target, operation = request.get('sender'), request.get('target'), request.get('operation')
        if operation not in ('add', 'remove', 'restart'): return
        if not isinstance(sender, str) or not NAME.fullmatch(sender): return
        if operation != 'restart' and (not isinstance(target, str) or not NAME.fullmatch(target)): return
        stamp = request.get('created')
        def ack():
            return self.api.on_host(host, ['sudo', '-n', '/usr/local/sbin/alt-pilot-chat-inbox', 'ack', str(slot), ident], f'chat_ack {slot} {ident}', 10)
        def reply(message):
            prefix = '/msg ' + sender + ' '
            # Multiple bounded lines keep errors and help readable for long names.
            line = prefix
            for word in message.split():
                if len(line + word) > 100:
                    self.api.on_host(host, ['sudo', '-n', '/usr/local/sbin/alt-pilot-send', 'command', str(slot)], f'send command {slot}', 10, line.rstrip() + '\n')
                    line = prefix
                line += word + ' '
            if line != prefix:
                self.api.on_host(host, ['sudo', '-n', '/usr/local/sbin/alt-pilot-send', 'command', str(slot)], f'send command {slot}', 10, line.rstrip() + '\n')
        now = time.monotonic()
        self.completed = {k: v for k, v in self.completed.items() if now-v < 900}
        key = (host['id'], ident)
        if key in self.completed:
            ack(); return
        if type(stamp) not in (int, float) or not math.isfinite(stamp) or not 0 <= time.time() - stamp <= 600:
            ack(); return
        try:
            current = self.api.health(fresh=True)
            accounts = [x for x in current.get('accounts', []) if x.get('authenticated') and x.get('name')]
            origin = next(x for x in accounts if x.get('slot') == slot)
            current_whitelist = origin.get('settings', {}).get('tpa_whitelist', '')
            names = re.split(r'[\s,]+', current_whitelist)
            if not any(NAME.fullmatch(x) and canonical(x) == canonical(sender) for x in names):
                ack(); return
            if operation == 'restart':
                if time.monotonic() - self.restart_times.get(slot, -9999) < 60:
                    message = 'Please wait one minute between restart requests.'
                else:
                    reply('Restarting this alt.')
                    # Do not repeat a restart when the reply/ack is lost. A new
                    # explicit request can retry after the cooldown.
                    self.completed[key] = time.monotonic()
                    self.restart_times[slot] = time.monotonic()
                    try:
                        time.sleep(1)
                        result = self.api.on_host(host, ['sudo', '-n', '/usr/local/sbin/alt-pilot-account-service', 'restart', str(slot)], f'service restart {slot}', 45)
                        if result.returncode:
                            reply('Restart failed. Please check the dashboard and try again.')
                    finally:
                        ack()
                    return
            else:
                if current.get('cluster_ready') is False or current.get('reachable') is False or current.get('health_stale'):
                    raise RuntimeError('All hosts must be reachable before syncing the whitelist.')
                whitelist = changed_whitelist(current_whitelist, sender, operation, target)
                # Preserve startup, purpose and TPA-enable state per account.
                # Update the origin last so a failed self-removal can still be
                # retried by the requester on the receiving alt.
                for account in sorted(accounts, key=lambda account: account['slot'] == slot):
                    settings = dict(account.get('settings', {}))
                    settings.update(slot=account['slot'], tpa_whitelist=whitelist)
                    self.api.local_save_account_settings(settings)
                message = ('Added ' if operation == 'add' else 'Removed ') + target + (' to' if operation == 'add' else ' from') + ' the whitelist on all accounts.'
        except PermissionError:
            ack(); return
        except (ValueError, StopIteration) as error:
            message = str(error) or 'Account settings are unavailable.'
        except Exception:
            message = ('Restart could not be confirmed. Check the dashboard.' if operation == 'restart'
                       else 'Whitelist sync did not finish. Please retry or use Settings.')
        # Mutation is complete even if sending its reply fails. Never repeat a
        # self-removal or overwrite subsequent settings just to retry feedback.
        self.completed[key] = time.monotonic()
        try:
            reply(message)
        finally:
            ack()
    def poll(self):
        for host in self.api.remote_hosts():
            try:
                result = self.api.on_host(host, ['sudo', '-n', '/usr/local/sbin/alt-pilot-chat-inbox', 'list'], 'chat_inbox', 15)
                if result.returncode: continue
                requests = json.loads(result.stdout)
                if not isinstance(requests, list): continue
                for request in requests:
                    try: self.process(host, request)
                    except Exception as error:
                        print('Chat command delayed: ' + type(error).__name__, flush=True)
            except Exception as error:
                print('Chat inbox delayed: ' + type(error).__name__, flush=True)
    def run(self):
        while True:
            try: self.poll()
            except Exception as error: print('Chat whitelist polling delayed: ' + type(error).__name__, flush=True)
            time.sleep(5)

def start(api):
    broker = Broker(api)
    threading.Thread(target=broker.run, name='chat-whitelist', daemon=True).start()
    return broker
