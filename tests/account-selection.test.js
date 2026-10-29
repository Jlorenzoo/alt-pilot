const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../web/app.js'), 'utf8');

function harness(stored = {}) {
  const storage = new Map(Object.entries(stored));
  const accounts = [{slot: 1, name: 'First', authenticated: true},
    {slot: 3, name: 'Preferred', edition: 'bedrock', authenticated: true}];
  const app = {selectedSlot: 1, remote: {accounts}};
  const context = vm.createContext({app, localStorage: {
    getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value),
  }, render: () => context.reconcileAccountSelection(accounts)});
  vm.runInContext(source.slice(source.indexOf('function accountIdentity'), source.indexOf('function accountDisplayName')), context);
  return {app, accounts, context, storage};
}

test('startup selects the primary account, then preserves deliberate tab changes', () => {
  const h = harness({'afk-primary-account': 'bedrock:preferred'});
  h.context.reconcileAccountSelection(h.accounts);
  assert.equal(h.app.selectedSlot, 3);
  h.context.selectAccount(1);
  h.context.reconcileAccountSelection(h.accounts);
  assert.equal(h.app.selectedSlot, 1);
  assert.equal(h.app.accountSettingsSlot, 1);
  assert.equal(h.app.primaryAccount, 'bedrock:preferred');
});

test('primary identity survives reordering and falls back when removed', () => {
  const h = harness({'afk-primary-account': 'bedrock:preferred'});
  h.accounts[1].slot = 4;
  h.context.reconcileAccountSelection(h.accounts);
  assert.equal(h.app.selectedSlot, 4);
  h.context.reconcileAccountSelection([h.accounts[0]]);
  assert.equal(h.app.selectedSlot, 1);
  assert.equal(h.storage.get('afk-primary-account'), 'java:first');
});

test('there is always one primary when accounts exist and it can be changed', () => {
  const h = harness();
  h.context.reconcileAccountSelection([]);
  assert.equal(h.storage.has('afk-primary-account'), false);
  h.context.reconcileAccountSelection(h.accounts);
  assert.equal(h.app.primaryAccount, 'java:first');
  h.context.selectAccount(3);
  h.context.makeSelectedAccountPrimary();
  assert.equal(h.storage.get('afk-primary-account'), 'bedrock:preferred');
  h.app.accountSelectionReady = false;
  h.app.selectedSlot = 1;
  h.context.reconcileAccountSelection(h.accounts);
  assert.equal(h.app.selectedSlot, 3);
});

test('invalid selections leave the selected and primary accounts intact', () => {
  const h = harness();
  h.context.reconcileAccountSelection(h.accounts);
  h.context.selectAccount(99);
  assert.equal(h.app.selectedSlot, 1);
  assert.equal(h.app.primaryAccount, 'java:first');
});
