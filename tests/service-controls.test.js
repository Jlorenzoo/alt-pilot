const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../web/app.js'), 'utf8');
function harness() {
  const app = {selectedSlot: 1, remote: {reachable: true, accounts: [{slot: 1, authenticated: true, service: 'inactive'}]}};
  const renders = [], calls = [], alerts = [];
  let resolveCheck;
  const check = new Promise(resolve => {resolveCheck = resolve;});
  const context = vm.createContext({app, Date, console, i18n: {t: key => key},
    accountDisplayName: slot => `Account ${slot}`, confirm: () => true,
    render: () => renders.push(app.serviceOperation?.stage || 'idle'),
    runTaskAndWait: () => check, showPreStartModal: () => calls.push('modal'),
    showAlert: (...args) => alerts.push(args), ensureToken: async () => {},
    api: async () => {calls.push('post'); return {task: {id: 'test'}};},
    watchTask: () => calls.push('watch')});
  vm.runInContext(source.slice(source.indexOf('const SERVICE_ACTIONS'), source.indexOf('function isQuietTask')), context);
  return {app, renders, calls, alerts, resolveCheck, context};
}
test('start acknowledges before the slow check and suppresses duplicate clicks', async () => {
  const h = harness();
  const pending = h.context.startAction('start');
  assert.equal(h.app.serviceOperation.stage, 'checking');
  await h.context.startAction('start');
  assert.deepEqual(h.calls, []);
  h.resolveCheck({result: {warnings: []}});
  await pending;
  assert.deepEqual(h.calls, ['post', 'watch']);
  assert.equal(h.app.serviceOperation.stage, 'sending');
});
test('stop and restart give immediate, distinct pending feedback', async () => {
  for (const action of ['stop', 'restart']) {
    const h = harness();
    const pending = h.context.startAction(action, {force: true});
    assert.equal(h.app.serviceOperation.action, action);
    assert.equal(h.app.serviceOperation.stage, 'sending');
    assert.equal(h.context.serviceProgress(h.app.serviceOperation, 'label'), `service_progress_${action}_label`);
    await pending;
  }
});
test('warnings release pending controls before asking to continue', async () => {
  const h = harness();
  const pending = h.context.startAction('start');
  h.resolveCheck({result: {warnings: ['Another session']}});
  await pending;
  assert.equal(h.app.serviceOperation, null);
  assert.equal(h.app.pendingStart.action, 'start');
  assert.deepEqual(h.calls, ['modal']);
});
test('a rejected request clears pending state and surfaces its error', async () => {
  const h = harness();
  h.context.api = async () => {throw new Error('VM unavailable');};
  await h.context.startAction('stop');
  assert.equal(h.app.serviceOperation, null);
  assert.equal(h.alerts[0][0], 'VM unavailable');
});
test('confirmation waits for observed state and keeps startup polling fast', () => {
  const h = harness();
  h.app.serviceOperation = {action: 'start', slot: 1, stage: 'confirming', started: Date.now()};
  h.context.reconcileServiceOperation();
  assert.ok(h.app.serviceOperation);
  h.app.remote.accounts[0].service = 'active';
  h.context.reconcileServiceOperation();
  assert.equal(h.app.serviceOperation, null);
  assert.equal(h.context.needsFastStatus(), true);
  h.app.remote.accounts[0].connected = true;
  assert.equal(h.context.needsFastStatus(), false);
});
test('unreachable status cannot confirm a stop; confirmation has a bounded wait', () => {
  const h = harness();
  h.app.serviceOperation = {action: 'stop', slot: 1, stage: 'confirming', started: Date.now()};
  h.app.remote.reachable = false;
  h.context.reconcileServiceOperation();
  assert.ok(h.app.serviceOperation);
  h.app.serviceOperation.started -= 121000;
  h.context.reconcileServiceOperation();
  assert.equal(h.app.serviceOperation, null);
  assert.equal(h.alerts.length, 1);
});
test('switching accounts keeps pending feedback scoped to its target', () => {
  const h = harness();
  h.app.serviceOperation = {action: 'stop', slot: 1};
  h.app.selectedSlot = 2;
  assert.equal(h.context.selectedServiceOperation(), null);
  h.app.serviceOperation.all = true;
  assert.ok(h.context.selectedServiceOperation());
});

test('the timeout works even when status requests fail', () => {
  const h = harness();
  h.app.serviceOperation = {action: 'stop', slot: 1, stage: 'confirming', started: Date.now()};
  h.context.reconcileServiceOperation(false);
  assert.ok(h.app.serviceOperation, 'a timer must not confirm stale status');
  h.app.serviceOperation.started -= 121000;
  h.context.reconcileServiceOperation(false);
  assert.equal(h.app.serviceOperation, null);
  assert.equal(h.alerts.length, 1);
});

test('a stale cached response cannot confirm completion', () => {
  const h = harness();
  h.app.serviceOperation = {action: 'stop', slot: 1, stage: 'confirming', started: Date.now()};
  h.app.remote.health_stale = true;
  h.context.reconcileServiceOperation();
  assert.ok(h.app.serviceOperation);
});
