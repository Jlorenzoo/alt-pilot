import json
import time
import types
import unittest
from unittest.mock import Mock, patch
from chat_whitelist import Broker, changed_whitelist

class WhitelistTests(unittest.TestCase):
    def test_membership_and_exact_names(self):
        self.assertEqual(changed_whitelist('Admin, Other', '.ADMIN', 'add', 'New_User'), 'Admin, Other, New_User')
        self.assertEqual(changed_whitelist('Admin, .Other', 'Admin', 'remove', 'other'), 'Admin')
        with self.assertRaises(PermissionError): changed_whitelist('Admin', 'AdminExtra', 'add', 'Attacker')
        with self.assertRaises(ValueError): changed_whitelist('Admin', 'Admin', 'remove', 'Admin')
        with self.assertRaises(ValueError): changed_whitelist('Admin', 'Admin', 'add', 'Bad;Command')
    def api(self):
        host = {'id': 'primary', 'local': True}
        result = types.SimpleNamespace(returncode=0, stdout='[]')
        api = types.SimpleNamespace(target_host=lambda slot: host, on_host=Mock(return_value=result),
            local_save_account_settings=Mock(), health=Mock(return_value={'accounts': [
                {'slot': 1, 'authenticated': True, 'name': 'Alt1', 'settings': {'tpa_whitelist': 'Admin, Other', 'startup_command': '/home one', 'tpa_auto_accept': False}},
                {'slot': 2, 'authenticated': True, 'name': 'Alt2', 'settings': {'tpa_whitelist': 'Admin, Other', 'startup_command': '/home two', 'tpa_auto_accept': True}},
            ]}))
        return host, api
    def request(self, operation='add', target='New_User'):
        return {'id': 'a'*32, 'slot': 1, 'sender': 'Admin', 'operation': operation, 'target': target, 'created': time.time()}
    def test_global_update_preserves_each_accounts_options(self):
        host, api = self.api(); broker = Broker(api); broker.process(host, self.request())
        saved = sorted((x.args[0] for x in api.local_save_account_settings.call_args_list), key=lambda x: x['slot'])
        self.assertEqual([x['tpa_auto_accept'] for x in saved], [False, True])
        self.assertEqual([x['startup_command'] for x in saved], ['/home one', '/home two'])
        self.assertTrue(all(x['tpa_whitelist'] == 'Admin, Other, New_User' for x in saved))
        self.assertIn('Added New_User', api.on_host.call_args_list[0].args[-1])
        broker.process(host, self.request())
        self.assertEqual(api.local_save_account_settings.call_count, 2)
    def test_failed_sync_never_claims_success(self):
        host, api = self.api(); api.local_save_account_settings.side_effect = RuntimeError('offline')
        Broker(api).process(host, self.request())
        self.assertIn('did not finish', api.on_host.call_args_list[0].args[-1])
    def test_restart_is_scoped_to_the_origin_and_rate_limited(self):
        host, api = self.api(); broker = Broker(api)
        with patch('chat_whitelist.time.sleep'):
            broker.process(host, self.request('restart', ''))
            request = self.request('restart', ''); request['id'] = 'b'*32
            broker.process(host, request)
        calls = [x for x in api.on_host.call_args_list if 'service restart' in x.args[2]]
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0].args[2], 'service restart 1')
        api.local_save_account_settings.assert_not_called()

    def test_removed_sender_expired_requests_and_malformed_input_cannot_mutate(self):
        host, api = self.api(); broker = Broker(api)
        for update in ({'sender': 'Evil'}, {'created': time.time()-601}, {'created': float('nan')},
                       {'slot': True}, {'operation': 'stop'}, {'sender': []}, {'target': None}):
            request = self.request(); request.update(update)
            broker.process(host, request)
        for request in (None, [], 'invalid'): broker.process(host, request)
        api.local_save_account_settings.assert_not_called()
        self.assertFalse(any('service restart' in x.args[2] for x in api.on_host.call_args_list))

    def test_restart_failure_is_reported_and_is_not_replayed(self):
        host, api = self.api(); broker = Broker(api)
        def result(*args):
            return types.SimpleNamespace(returncode=1 if 'service restart' in args[2] else 0, stdout='')
        api.on_host.side_effect = result
        with patch('chat_whitelist.time.sleep'):
            broker.process(host, self.request('restart', ''))
            broker.process(host, self.request('restart', ''))
        self.assertEqual(sum('service restart' in x.args[2] for x in api.on_host.call_args_list), 1)
        self.assertTrue(any('Restart failed' in str(x.args[-1]) for x in api.on_host.call_args_list))

    def test_completed_update_is_not_reapplied_after_reply_failure(self):
        host, api = self.api(); broker = Broker(api)
        def result(*args):
            if 'send command' in args[2]: raise RuntimeError('FIFO unavailable')
            return types.SimpleNamespace(returncode=0, stdout='')
        api.on_host.side_effect = result
        with self.assertRaises(RuntimeError): broker.process(host, self.request())
        broker.process(host, self.request())
        self.assertEqual(api.local_save_account_settings.call_count, 2)

    def test_unreachable_cluster_never_claims_global_sync(self):
        host, api = self.api()
        api.health.return_value['cluster_ready'] = False
        Broker(api).process(host, self.request())
        api.local_save_account_settings.assert_not_called()
        self.assertIn('did not finish', api.on_host.call_args_list[0].args[-1])

    def test_poll_continues_after_a_bad_host_and_bad_request(self):
        host, api = self.api(); other = {'id': 'other'}
        api.remote_hosts = lambda: [other, host]
        request = self.request()
        def result(*args):
            if args[0] == other: raise RuntimeError('offline')
            return types.SimpleNamespace(returncode=0, stdout=json.dumps([None, request]))
        api.on_host.side_effect = result
        Broker(api).poll()
        self.assertEqual(api.local_save_account_settings.call_count, 2)
