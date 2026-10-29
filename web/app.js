const storedSlot = Number(localStorage.getItem('afk-selected-slot') || 1);
const initialSlot = Number.isInteger(storedSlot) && storedSlot >= 1 && storedSlot <= 8 ? storedSlot : 1;
const CONSOLE_FILTERS = ['conversation', 'attention', 'all', 'player', 'whisper', 'server', 'self', 'client'];
const consoleFilterStorageKey = (slot) => `afk-console-filter:${slot}`;
function loadConsoleFilter(slot) {
  let stored = '';
  try {
    stored = localStorage.getItem(consoleFilterStorageKey(slot)) || localStorage.getItem('afk-console-filter') || 'conversation';
  } catch {}
  return CONSOLE_FILTERS.includes(stored) ? stored : 'conversation';
}
const storedConsoleFilter = loadConsoleFilter(initialSlot);
const app = { token: '', local: {}, remote: {}, currentTask: null, serviceOperation: null, statusRefreshActive: false, lastStatusRefresh: 0, taskPollActive: false, savingSettings: false, timer: null, consoleSlot: null, consoleRefreshActive: false, lastConsoleRefresh: 0, consoleLines: readConsoleCache(initialSlot), pendingCommunication: null, pendingStart: null, authAttempt: null, consoleFilter: CONSOLE_FILTERS.includes(storedConsoleFilter) ? storedConsoleFilter : 'all', consoleSearch: '', mode: ['localhost', '127.0.0.1'].includes(location.hostname) ? 'local' : 'remote', selectedSlot: initialSlot, view: 'overview' };

const TOPBAR_TITLES = {
  overview: { eyebrow: 'Complex Gaming · Java & Bedrock' },
  availability: { eyebrow: 'Account availability & downtime' },
  setup: { eyebrow: 'Account setup' },
  voting: { eyebrow: 'Server vote rewards' },
  settings: { eyebrow: 'ALT Pilot dashboard' },
  calculator: { eyebrow: 'IGM / GC profit tools' }
};

function setTopbarTitle(view) {
  const t = TOPBAR_TITLES[view] || TOPBAR_TITLES.overview;
  const eyebrowKey = `topbar_${view}`;
  const translated = (typeof i18n !== 'undefined') ? i18n.t(eyebrowKey) : t.eyebrow;
  $('#topbarEyebrow').textContent = (translated && translated !== eyebrowKey) ? translated : t.eyebrow;
  $('#topbarPower').classList.toggle('hidden', view !== 'overview');
  $('#settingsTabs').classList.toggle('hidden', view !== 'settings');
  app.view = view;
}

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const fmtBytes = (value) => {
  const n = Number(value || 0);
  if (!n) return '0 MB';
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(n < 10 * 1024 ** 3 ? 1 : 0)} GB`;
  return `${Math.round(n / 1024 ** 2)} MB`;
};
const fmtBytesSameUnit = (current, max) => {
  const c = Number(current || 0);
  const m = Number(max || 0);
  const useGb = Math.max(c, m) >= 1024 ** 3;
  if (useGb) {
    const fmt = (v) => `${(v / 1024 ** 3).toFixed(v < 10 * 1024 ** 3 ? 1 : 0)} GB`;
    return [fmt(c), fmt(m)];
  }
  const fmt = (v) => `${Math.round(v / 1024 ** 2)} MB`;
  return [fmt(c), fmt(m)];
};
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const humanSince = (value) => !value || value === 'n/a' ? '—' : value.replace(/ [A-Z]{3,5}$/, '');
const avatarUrl = (name, size = 28) => `https://mc-heads.net/avatar/${encodeURIComponent(name || 'MHF_Steve')}/${size}.png`;
const formatDuration = (seconds) => {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
};

// The primary identity survives slot reordering; selection is shared by every page.
function accountIdentity(account) {
  return account?.name ? `${account.edition || 'java'}:${account.name.toLowerCase()}` : '';
}

function reconcileAccountSelection(accounts) {
  if (!accounts.length) return;
  const storedPrimary = localStorage.getItem('afk-primary-account');
  const primary = accounts.find(account => accountIdentity(account) === storedPrimary) || accounts[0];
  app.primaryAccount = accountIdentity(primary);
  localStorage.setItem('afk-primary-account', app.primaryAccount);
  if (!app.accountSelectionReady || !accounts.some(account => account.slot === app.selectedSlot)) {
    app.selectedSlot = primary.slot;
    app.accountSelectionReady = true;
    localStorage.setItem('afk-selected-slot', String(app.selectedSlot));
  }
  app.accountSettingsSlot = app.selectedSlot;
}

function selectAccount(slot) {
  if (!(app.remote?.accounts || []).some(account => account.slot === slot && account.authenticated && account.name)) return;
  app.selectedSlot = slot;
  app.accountSettingsSlot = slot;
  app.accountSelectionReady = true;
  localStorage.setItem('afk-selected-slot', String(slot));
  render();
}

function makeSelectedAccountPrimary() {
  const account = (app.remote?.accounts || []).find(account => account.slot === app.selectedSlot && account.authenticated && account.name);
  if (!account) return;
  app.primaryAccount = accountIdentity(account);
  localStorage.setItem('afk-primary-account', app.primaryAccount);
  render();
}

function accountDisplayName(slot = app.selectedSlot) {
  const accounts = app.remote?.accounts || [];
  const found = accounts.find(a => a.slot === Number(slot));
  return found?.name || `Account ${slot}`;
}

function readConsoleCache(slot) {
  try {
    const lines = JSON.parse(sessionStorage.getItem(`afk-console-lines:${slot}`) || '[]');
    return Array.isArray(lines) ? lines.filter(line => typeof line === 'string').slice(-400) : [];
  } catch {
    return [];
  }
}

function writeConsoleCache(slot, lines) {
  try {
    sessionStorage.setItem(`afk-console-lines:${slot}`, JSON.stringify(lines.slice(-400)));
  } catch {
    // A private browser session may disable storage; the live console still works.
  }
}

function readConsoleClearBaseline(slot) {
  try {
    const lines = JSON.parse(sessionStorage.getItem(`afk-console-clear:${slot}`) || 'null');
    return Array.isArray(lines) ? lines.filter(line => typeof line === 'string').slice(-400) : null;
  } catch {
    return null;
  }
}

function linesAfterLocalClear(slot, lines) {
  const baseline = readConsoleClearBaseline(slot);
  if (!baseline) return {lines, cleared: false};
  return {lines: ConsoleFeed.linesAfterClear(lines, baseline), cleared: true};
}

function scrollConsoleToBottom(output = $('#consoleOutput')) {
  if (!output) return;
  output.scrollTop = output.scrollHeight;
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => {
      if (output) output.scrollTop = output.scrollHeight;
    });
  }
}

function clearConsole() {
  try {
    sessionStorage.setItem(`afk-console-clear:${app.selectedSlot}`, JSON.stringify(app.consoleLines.slice(-400)));
  } catch {}
  app.pendingCommunication = null;
  const input = $('#communicationInput');
  input.value = '';
  $('#communicationCount').textContent = '0/100';
  $('#communicationHint').className = 'success';
  $('#communicationHint').textContent = 'Console cleared locally. New activity will appear here.';
  renderActivityFeed($('#consoleOutput'), app.consoleLines);
  scrollConsoleToBottom($('#consoleOutput'));
  if (!input.disabled) input.focus();
}

async function api(path, options = {}) {
  const response = await fetch(path, options);
  const raw = await response.text();
  let body;
  try { body = raw ? JSON.parse(raw) : {}; }
  catch { throw new Error('The control service returned an incomplete response. Retrying usually resolves this.'); }
  if (response.status === 401 && app.mode === 'remote') {
    location.assign('/login');
    throw new Error('Your control session expired. Redirecting to sign in…');
  }
  if (response.status === 403 && body.error === 'Invalid control token' && !options._tokenRetried) {
    try {
      const boot = await api('/api/bootstrap', { _tokenRetried: true });
      if (boot && boot.token) {
        app.token = boot.token;
        const newOptions = { ...options, _tokenRetried: true };
        if (newOptions.headers) {
          newOptions.headers = { ...newOptions.headers, 'X-Control-Token': boot.token };
        }
        return await api(path, newOptions);
      }
    } catch {}
  }
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

async function ensureToken() {
  if (app.token) return app.token;
  try {
    const data = await api('/api/bootstrap', { _tokenRetried: true });
    if (data && data.token) app.token = data.token;
  } catch {}
  return app.token;
}

async function bootstrap() {
  try {
    const data = await api('/api/bootstrap');
    app.token = data.token; app.local = data.local; app.remote = data.remote;
    render();
  } catch (error) { showAlert(error.message, true); }
}

async function refreshStatus(silent = false) {
  if (app.statusRefreshActive) return;
  app.statusRefreshActive = true;
  app.lastStatusRefresh = Date.now();
  const button = $('#refreshButton');
  if (button && !silent) button.disabled = true;
  try {
    const data = await api('/api/status');
    if (data.token) app.token = data.token;
    app.local = data.local; app.remote = data.remote;
    reconcileServiceOperation();
    render();
  } catch (error) { if (!silent) showAlert(error.message, true); }
  finally { app.statusRefreshActive = false; if (button) button.disabled = false; }
}

function derived() {
  const global = app.remote || {}, l = app.local || {};
  const selected = (global.accounts || []).find(account => account.slot === app.selectedSlot);
  const r = selected ? {...global, ...selected} : global;
  const checks = Object.values(l.checks || {});
  const localOk = checks.length > 0 && checks.every(x => x.ok);
  const vmOk = Boolean(l.vm?.instance_id && r.reachable);
  const selectedAccountReady = global.slots_supported
    ? Boolean(selected?.authenticated && selected?.name)
    : Boolean(r.authenticated);
  const steps = [localOk, Boolean(l.vm?.instance_id), vmOk, Boolean(r.installed), selectedAccountReady];
  const firstIncomplete = steps.findIndex(x => !x);
  const current = firstIncomplete === -1 ? 4 : firstIncomplete;
  return { r, global, l, localOk, vmOk, selected, selectedAccountReady, steps, current, completed: steps.filter(Boolean).length };
}

function render() {
  const savedAccounts = (app.remote?.accounts || []).filter(account => account.authenticated && account.name);
  reconcileAccountSelection(savedAccounts);
  const d = derived(), r = d.r, global = d.global, settings = d.l.settings || {};
  const active = r.service === 'active';
  const connected = Boolean(r.connected);
  const reachable = Boolean(r.reachable);
  $('#serverValue').textContent = settings.minecraft_server || '—';
  $('#versionValue').textContent = settings.minecraft_version || '—';
  $('#accountValue').textContent = r.name || 'No account added';
  const selectedPurpose = r.authenticated ? (r.settings?.purpose?.trim() || `Alt ${app.selectedSlot || 1}`) : '';
  const overviewBadge = $('#overviewPurposeBadge');
  if (overviewBadge) overviewBadge.textContent = selectedPurpose;
  const setText = (id, value) => { const el = $('#' + id); if (el) el.textContent = value; };
  const memTotal = Number(global.memory_total || 956 * 1024 ** 2);
  const swapTotal = Number(global.swap_total || 0);
  const [memCur, memMax] = fmtBytesSameUnit(r.memory_bytes, memTotal);
  const [swapCur, swapMax] = fmtBytesSameUnit(global.swap_used, swapTotal);
  setText('memoryMetric', memCur);
  setText('memoryLimit', memMax);
  setText('swapMetric', swapCur);
  setText('swapLimit', swapMax);
  setText('diskMetric', fmtBytes(global.disk_used));
  const memItem = $('#memoryMetric')?.parentElement;
  if (memItem) memItem.title = `Selected account · ${fmtBytes(memTotal)} VM total`;

  let mood = 'neutral', labelKey = 'status_pill_not_connected', labelDefault = 'Not connected';
  let titleKey = 'hero_title_stopped', titleDefault = 'Client is stopped';
  let descKey = 'hero_desc_stopped', descDefault = 'Start it when setup and sign-in are complete.', descParams = {};

  if (!reachable) {
    mood = 'error';
    labelKey = 'status_pill_vm_unavailable'; labelDefault = 'VM unavailable';
    titleKey = 'hero_title_vm_unavailable'; titleDefault = 'The VM could not be reached';
    if (r.reason) {
      descKey = null; descDefault = r.reason;
    } else {
      descKey = 'hero_desc_vm_unavailable'; descDefault = 'Check the VM state and SSH connection in the setup wizard.';
    }
  } else if (connected) {
    mood = 'online';
    labelKey = 'status_pill_connected'; labelDefault = 'Connected';
    titleKey = 'hero_title_online'; titleDefault = 'Your alt is online';
    descKey = 'hero_desc_online';
    descParams = { server: settings.minecraft_server || '' };
    descDefault = `The headless client has an active Minecraft connection to ${settings.minecraft_server}.`;
  } else if (active && ['delayed', 'unresponsive'].includes(r.connection_state)) {
    mood = 'warning';
    labelKey = null; labelDefault = 'Client heartbeat delayed';
    titleKey = null; titleDefault = 'The client is not updating its status';
    descKey = null; descDefault = 'The server may still show this player online. Recovery waits for a sustained failure before restarting.';
  } else if (active && r.startup_phase === 'disconnected') {
    mood = 'error';
    labelKey = 'status_pill_connection_dropped'; labelDefault = 'Connection dropped';
    titleKey = 'hero_title_dropped'; titleDefault = 'The client reached the server, then disconnected';
    descKey = 'hero_desc_dropped';
    descDefault = 'The connection watchdog is confirming the drop and will restart this account automatically.';
  } else if (active) {
    mood = 'warning';
    labelKey = 'status_pill_starting'; labelDefault = 'Starting';
    titleKey = 'hero_title_starting'; titleDefault = 'Starting the client';
    descKey = 'hero_desc_starting';
    descDefault = 'Live startup activity appears below.';
  } else if (r.service === 'activating') {
    mood = 'warning';
    labelKey = 'status_pill_retrying'; labelDefault = 'Retrying';
    titleKey = 'hero_title_retrying'; titleDefault = 'The client is retrying startup';
    descKey = 'hero_desc_retrying';
    descDefault = 'A previous launch ended early. The service will retry automatically and this page will keep updating.';
  } else if (r.service === 'failed') {
    mood = 'error';
    labelKey = 'status_pill_start_failed'; labelDefault = 'Start failed';
    titleKey = 'hero_title_failed'; titleDefault = 'The client could not start';
    descKey = 'hero_desc_failed';
    descParams = { status: r.exit_status ?? 'unknown' };
    descDefault = `The service stopped with exit status ${r.exit_status ?? 'unknown'}. Use Restart to try again.`;
  } else if (!r.installed) {
    mood = 'warning';
    labelKey = 'status_pill_setup_needed'; labelDefault = 'Setup needed';
    titleKey = 'hero_title_setup_needed'; titleDefault = 'The VM needs the secure install';
    descKey = 'hero_desc_setup_needed';
    descDefault = 'Continue the guided setup to install and configure the client.';
  } else if (!r.authenticated) {
    mood = 'warning';
    labelKey = 'status_pill_signin_needed'; labelDefault = 'Sign-in needed';
    titleKey = 'hero_title_signin_needed'; titleDefault = 'Minecraft needs authorization';
    descKey = 'hero_desc_signin_needed';
    descDefault = 'Use Microsoft’s device-code flow. Your password never enters this app.';
  }
  const operation = selectedServiceOperation();
  if (operation) {
    mood = 'warning';
    labelKey = null; labelDefault = serviceProgress(operation, 'label');
    titleKey = null; titleDefault = serviceProgress(operation, 'title');
    descKey = null; descDefault = serviceProgress(operation, operation.stage);
  }


  const label = labelKey && typeof i18n !== 'undefined' ? i18n.t(labelKey) : labelDefault;
  const title = titleKey && typeof i18n !== 'undefined' ? i18n.t(titleKey) : titleDefault;
  const description = (descKey && typeof i18n !== 'undefined') ? i18n.t(descKey, descParams) : descDefault;

  $('#connectionPill').className = `state-pill ${mood}`;
  $('#connectionPill').innerHTML = `<span></span>${label}`;
  $('#connectionTitle').textContent = title;
  $('#connectionDescription').textContent = description;

  const detailKey = connected ? 'conn_detail_connected' : active ? 'conn_detail_active' : 'conn_detail_controls';
  const detailDefault = connected
    ? 'Connected to Minecraft and ready for console commands.'
    : active ? 'The client is active; connection state updates automatically.'
    : 'Start and restart controls are in the top-right corner.';
  $('#connectionDetail').textContent = typeof i18n !== 'undefined' ? i18n.t(detailKey) : detailDefault;

  const statusOrb = $('#statusOrb');
  statusOrb.className = `status-orb ${mood}${operation || (active && !connected) ? ' starting' : ''}`;
  statusOrb.textContent = mood === 'online' ? '✓' : mood === 'error' ? '!' : mood === 'warning' ? '…' : '—';
  const primary = $('#primaryControl');
  primary.dataset.action = active ? 'stop' : 'start';
  primary.classList.toggle('is-active', active);
  const primaryTitle = active
    ? (typeof i18n !== 'undefined' ? i18n.t('ctrl_stop_client') : 'Stop client')
    : (typeof i18n !== 'undefined' ? i18n.t('ctrl_start_client') : 'Start client');
  primary.setAttribute('aria-label', primaryTitle);
  primary.setAttribute('title', primaryTitle);
  primary.innerHTML = active ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6h12v12H6V6Z"/></svg>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7V5Z"/></svg>';
  $$('[data-action="start"]').forEach(b => b.disabled = !reachable || !r.installed || !r.authenticated || active);
  $$('[data-action="stop"]').forEach(b => b.disabled = !active);
  $$('[data-action="restart"]').forEach(b => b.disabled = !reachable || !r.installed);
  const serviceBusy = Boolean(app.serviceOperation);
  $$('[data-action="start"], [data-action="stop"], [data-action="restart"], [data-action="start_all"], [data-action="stop_all"]').forEach(button => {
    if (serviceBusy) button.disabled = true;
    button.setAttribute('aria-busy', serviceBusy ? 'true' : 'false');
  });
  primary.classList.toggle('is-pending', Boolean(operation));
  if (operation) {
    const progress = serviceProgress(operation, 'label');
    primary.innerHTML = '<span class="spinner" aria-hidden="true"></span>';
    primary.setAttribute('aria-label', progress);
    primary.title = progress;
    $('#connectionDetail').textContent = `${accountDisplayName(operation.slot)} · ${Math.floor((Date.now() - operation.started) / 1000)}s`;
  }
  renderAccounts(global, d.l);
  renderCommunication(d);
  populateSettings(settings);
  renderRemoteAccess(d.l);
  renderAccountSettings();
  renderWizardAccountScope(d);
  renderWizard(d);
  updateVotingAvatars(global.accounts || []);
  renderVoting();
  document.dispatchEvent(new CustomEvent('account-selection-change'));
}

function renderAccounts(global, local) {
  const accounts = (global.accounts || []).filter(account => account.authenticated && account.name);
  const switcher = $('#accountSwitcher');
  switcher.classList.toggle('hidden', !global.slots_supported);
  if (!global.slots_supported) return;
  const maxAccounts = Number(global.max_accounts || 8);
  $('#accountFleetSummary').textContent = `${accounts.filter(a => a.connected).length} / ${accounts.length} ${i18n.t('accounts_online')}`;
  const tabs = $('#accountTabs');
  const prevScrollLeft = tabs.scrollLeft;
  tabs.innerHTML = accounts.map((account, index) => {
    const active = account.service === 'active';
    const status = account.connected ? 'online' : active ? 'connecting' : 'offline';
    // Two accounts may legitimately share a profile name; keep them tellable apart.
    const shared = accounts.filter(other => other.name === account.name).length > 1;
    const defaultAltLabel = `Alt ${account.slot || (index + 1)}`;
    const label = `${account.name || defaultAltLabel}${shared ? ` (${account.slot})` : ''}`;
    const rawPurpose = account.settings?.purpose?.trim() || '';
    const purpose = account.settings?.purpose?.trim() || defaultAltLabel;
    const isCustom = Boolean(rawPurpose && !/^[Aa]lt[[:space:]_]*[0-9]+$/i.test(rawPurpose));
    const purposeHtml = `<small class="account-tab-purpose${isCustom ? ' is-custom' : ''}">${escapeHtml(purpose)}</small>`;
    const draggable = accounts.length > 1 ? ' draggable="true"' : '';
    const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);
    const optionsHint = typeof i18n !== 'undefined' && i18n.getLang() === 'it' ? 'Tasto destro per opzioni' : 'Right-click for options';
    const isPrimary = accountIdentity(account) === app.primaryAccount;
    const title = `${isPrimary ? 'Primary account · ' : ''}${account.name || defaultAltLabel} [${purpose}] · ${statusLabel} · ${optionsHint}${accounts.length > 1 ? ' — Drag to reorder' : ''}`;
    return `<button class="account-tab ${status}${account.slot === app.selectedSlot ? ' active' : ''}" data-account-slot="${account.slot}"${draggable} title="${escapeHtml(title)}" aria-grabbed="false" aria-pressed="${account.slot === app.selectedSlot}"><span class="account-avatar" data-initials="${escapeHtml(label.slice(0, 2).toUpperCase())}"><img src="${avatarUrl(account.name, 28)}" alt="" loading="lazy"></span><span class="account-tab-text"><strong>${escapeHtml(label)}${isPrimary ? ' <span class="primary-account-mark" aria-label="Primary account">★</span>' : ''}</strong>${purposeHtml}</span><span class="account-dot" aria-hidden="true"></span></button>`;
  }).join('');
  $$('.account-avatar img', tabs).forEach(img => {
    if (img.complete && img.naturalWidth) img.classList.add('loaded');
    else img.addEventListener('load', () => img.classList.add('loaded'), {once: true});
  });
  tabs.scrollLeft = prevScrollLeft;
  $('#accountTabs').classList.remove('hidden');
  $$('[data-account-slot]', tabs).forEach(button => button.addEventListener('click', () => {
    if (button.dataset.dragging === 'true') { button.dataset.dragging = ''; return; }
    const nextSlot = Number(button.dataset.accountSlot);
    const changed = app.selectedSlot !== nextSlot;
    selectAccount(nextSlot);
    if (!changed) {
      scrollConsoleToBottom($('#consoleOutput'));
      refreshConsole(true);
    }
  }));
  const selected = accounts.find(account => account.slot === app.selectedSlot);
  const isPrimary = selected && accountIdentity(selected) === app.primaryAccount;
  const primaryButton = $('#setPrimaryAccount');
  primaryButton.disabled = !selected || Boolean(isPrimary);
  primaryButton.textContent = isPrimary ? '★ Primary account' : 'Make primary';
  primaryButton.title = isPrimary ? 'This account opens by default' : 'Open this account by default';
  bindAccountTabsReorder(tabs, accounts);
  bindAccountContextMenu();
  const missingSlot = Array.from({length: maxAccounts}, (_, i) => i + 1).find(slot => !accounts.some(account => account.slot === slot));
  $('#addAccountButton').disabled = !missingSlot || Boolean(app.authAttempt);
  $('#addAccountButton').dataset.nextSlot = String(missingSlot || '');
  $$('.account-actions').forEach(el => el.classList.remove('hidden'));
  if (!tabs.dataset.wheelBound) {
    tabs.dataset.wheelBound = 'true';
    tabs.addEventListener('wheel', (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        if (tabs.scrollWidth > tabs.clientWidth) {
          const atStart = tabs.scrollLeft <= 0 && e.deltaY < 0;
          const atEnd = tabs.scrollLeft + tabs.clientWidth >= tabs.scrollWidth - 1 && e.deltaY > 0;
          if (!atStart && !atEnd) {
            tabs.scrollLeft += e.deltaY;
            e.preventDefault();
          }
        }
      }
    }, { passive: false });
  }
}

function bindAccountTabsReorder(tabs, accounts) {
  bindReorderTabs(tabs, accounts, 'data-account-slot', submitReorder);
}

function bindReorderTabs(tabs, accounts, attr, submit) {
  if (!tabs || tabs.dataset.reorderBound === 'true' || accounts.length < 2) return;
  tabs.dataset.reorderBound = 'true';
  const slotOf = (el) => Number(el.getAttribute(attr));
  let draggedSlot = null;
  const clearMarkers = () => {
    tabs.querySelectorAll('.dragging, .drop-before, .drop-after')
      .forEach(el => el.classList.remove('dragging', 'drop-before', 'drop-after'));
    tabs.querySelectorAll(`[${attr}]`).forEach(el => {
      el.removeAttribute('aria-grabbed');
      delete el.dataset.dragging;
    });
  };
  const tabSelector = `[${attr}]`;
  tabs.addEventListener('dragstart', event => {
    const tab = event.target.closest(tabSelector);
    if (!tab) { event.preventDefault(); return; }
    draggedSlot = slotOf(tab);
    tab.classList.add('dragging');
    tab.dataset.dragging = 'true';
    tab.setAttribute('aria-grabbed', 'true');
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', String(draggedSlot));
    }
  });
  tabs.addEventListener('dragend', () => {
    draggedSlot = null;
    clearMarkers();
  });
  const findInsertion = (clientX) => {
    const items = [...tabs.querySelectorAll(tabSelector)];
    for (let i = 0; i < items.length; i += 1) {
      const rect = items[i].getBoundingClientRect();
      if (clientX < rect.left + rect.width / 2) return {tab: items[i], position: 'before'};
    }
    const last = items[items.length - 1];
    return last ? {tab: last, position: 'after'} : {tab: null, position: null};
  };
  const showMarker = (tab, position) => {
    tabs.querySelectorAll('.drop-before, .drop-after')
      .forEach(el => el.classList.remove('drop-before', 'drop-after'));
    if (!tab) return;
    tab.classList.add(position === 'after' ? 'drop-after' : 'drop-before');
  };
  tabs.addEventListener('dragover', event => {
    if (draggedSlot === null) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    const target = event.target.closest(tabSelector);
    if (target && slotOf(target) === draggedSlot) return;
    const insertion = findInsertion(event.clientX);
    showMarker(insertion.tab, insertion.position);
  });
  tabs.addEventListener('dragleave', event => {
    const tab = event.target.closest(tabSelector);
    if (tab && (!event.relatedTarget || !tab.contains(event.relatedTarget))) {
      tab.classList.remove('drop-before', 'drop-after');
    }
  });
  tabs.addEventListener('drop', async event => {
    if (draggedSlot === null) return;
    event.preventDefault();
    const items = [...tabs.querySelectorAll(tabSelector)];
    const slots = items.map(slotOf);
    const fromIndex = slots.indexOf(draggedSlot);
    let toIndex = slots.length;
    for (let i = 0; i < items.length; i += 1) {
      if (slotOf(items[i]) === draggedSlot) continue;
      const rect = items[i].getBoundingClientRect();
      if (event.clientX < rect.left + rect.width / 2) { toIndex = i; break; }
    }
    clearMarkers();
    const capture = draggedSlot;
    draggedSlot = null;
    if (fromIndex < 0 || toIndex === fromIndex || toIndex === fromIndex + 1) return;
    const reordered = slots.slice();
    reordered.splice(fromIndex, 1);
    const insertAt = toIndex > fromIndex ? toIndex - 1 : toIndex;
    reordered.splice(insertAt, 0, capture);
    await submit(reordered);
  });
}

async function submitReorder(order) {
  const running = (app.remote?.accounts || []).some(account => account.service === 'active');
  if (running && !confirm('Reordering stops every running Minecraft client. Continue?')) return;
  const previous = app.selectedSlot;
  try {
    await ensureToken();
    const data = await api('/api/actions', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'X-Control-Token': app.token},
      body: JSON.stringify({action: 'reorder_slots', order}),
    });
    const newSelectedSlot = order.indexOf(previous);
    if (newSelectedSlot >= 0) {
      app.selectedSlot = newSelectedSlot + 1;
      localStorage.setItem('afk-selected-slot', String(app.selectedSlot));
    }
    setReorderBusy(true);
    watchTask(data.task);
  } catch (error) {
    setReorderBusy(false);
    const msg = String(error.message || '');
    if (msg.includes('Unknown action') || msg.includes('only available from the private setup')) {
      showAlert('Reorder needs an updated control center. Stop the running app and relaunch it to pick up the change.', true);
    } else {
      showAlert(`Reorder failed: ${msg}`, true);
    }
  }
}

function setReorderBusy(busy) {
  document.body.classList.toggle('reorder-busy', Boolean(busy));
}

function openAccountSettings(slot) {
  hideAccountContextMenu();
  app.accountSettingsSlot = slot;
  app.selectedSlot = slot;
  localStorage.setItem('afk-selected-slot', String(slot));
  const navBtn = $('.nav-item[data-view="settings"]');
  if (navBtn) {
    navBtn.click();
  }
  activateSettingsTab('account');
  renderAccountSettings();
  setTimeout(() => {
    $('#accountPurposeInput')?.focus();
  }, 80);
}

function showAccountContextMenu(x, y, slot) {
  const menu = $('#accountContextMenu');
  if (!menu) return;
  menu.dataset.targetSlot = String(slot);

  const account = (app.remote?.accounts || []).find(a => a.slot === slot);
  const nameEl = $('#contextMenuAccountName');
  const badgeEl = $('#contextMenuAccountBadge');
  if (nameEl) nameEl.textContent = account?.name || accountDisplayName(slot);
  if (badgeEl) {
    const isBedrock = account?.edition === 'bedrock';
    badgeEl.textContent = isBedrock ? 'Bedrock' : 'Java';
    badgeEl.className = `context-menu-account-badge ${isBedrock ? 'bedrock' : 'java'}`;
  }

  const removeBtn = menu.querySelector('[data-action="remove"]');
  if (removeBtn) {
    removeBtn.disabled = Boolean(app.currentTask) || Boolean(app.authAttempt);
  }

  menu.classList.remove('hidden');

  const rect = menu.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width - 8;
  const maxY = window.innerHeight - rect.height - 8;
  const posX = Math.max(8, Math.min(x, maxX));
  const posY = Math.max(8, Math.min(y, maxY));
  menu.style.left = `${posX}px`;
  menu.style.top = `${posY}px`;
}

function hideAccountContextMenu() {
  const menu = $('#accountContextMenu');
  if (menu && !menu.classList.contains('hidden')) {
    menu.classList.add('hidden');
    delete menu.dataset.targetSlot;
  }
}

function bindAccountContextMenu() {
  const tabs = $('#accountTabs');
  if (tabs && tabs.dataset.contextBound !== 'true') {
    tabs.dataset.contextBound = 'true';
    tabs.addEventListener('contextmenu', event => {
      const tab = event.target.closest('[data-account-slot]');
      if (!tab) return;
      event.preventDefault();
      const slot = Number(tab.dataset.accountSlot);
      if (!slot) return;
      showAccountContextMenu(event.clientX, event.clientY, slot);
    });
  }

  const menu = $('#accountContextMenu');
  if (menu && menu.dataset.bound !== 'true') {
    menu.dataset.bound = 'true';
    menu.addEventListener('click', event => {
      const item = event.target.closest('.context-menu-item');
      if (!item || item.disabled) return;
      const targetSlot = Number(menu.dataset.targetSlot);
      if (!targetSlot) return;
      const action = item.dataset.action;
      hideAccountContextMenu();

      if (action === 'edit') {
        openAccountSettings(targetSlot);
      } else if (action === 'remove') {
        startAction('sign_out', {slot: targetSlot});
      }
    });

    document.addEventListener('click', event => {
      if (!menu.contains(event.target)) {
        hideAccountContextMenu();
      }
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') hideAccountContextMenu();
    });
    window.addEventListener('resize', hideAccountContextMenu);
    window.addEventListener('scroll', hideAccountContextMenu, true);
  }
}

function renderCommunication(d) {
  const account = d.selected || {};
  $('#consoleAccountName').textContent = account.name || '';
  const ready = Boolean(account.communication_ready);
  $('#communicationInput').disabled = !ready;
  $('#communicationSend').disabled = !ready;
  const useBtn = $('#useItemBtn');
  if (useBtn) useBtn.disabled = !ready || Boolean(app.currentTask);
  const dropBtn = $('#dropItemBtn');
  if (dropBtn) dropBtn.disabled = !ready || Boolean(app.currentTask);
  const hint = $('#communicationHint');
  if (!ready) {
    hint.className = '';
    hint.textContent = '';
    hint.hidden = true;
  } else if (!hint.classList.contains('success') && !hint.classList.contains('error')) {
    hint.textContent = '';
    hint.hidden = true;
  }
  if (app.consoleSlot !== app.selectedSlot) {
    app.consoleSlot = app.selectedSlot;
    app.consoleFilter = loadConsoleFilter(app.selectedSlot);
    app.consoleSearch = '';
    const search = $('#consoleSearch');
    if (search) search.value = '';
    app.consoleLines = readConsoleCache(app.selectedSlot);
    renderActivityFeed($('#consoleOutput'), app.consoleLines);
    scrollConsoleToBottom($('#consoleOutput'));
    refreshConsole(true);
  }
}

let consoleRequestId = 0;

async function refreshConsole(forceScroll = false) {
  if (app.view !== 'overview' || document.visibilityState !== 'visible') return;
  if (app.consoleRefreshActive && app.consoleRequestSlot === app.selectedSlot) return;
  app.lastConsoleRefresh = Date.now();
  const requestId = ++consoleRequestId;
  app.consoleRefreshActive = true;
  app.consoleRequestSlot = app.selectedSlot;
  const output = $('#consoleOutput');
  const slot = app.selectedSlot;
  try {
    const data = await api(`/api/console?slot=${slot}`);
    if (requestId !== consoleRequestId || slot !== app.selectedSlot) return;
    const lines = Array.isArray(data.lines) ? data.lines : [];
    const follow = forceScroll || (output.scrollHeight - output.scrollTop - output.clientHeight < 36);
    app.consoleLines = lines;
    writeConsoleCache(slot, lines);
    const pending = app.pendingCommunication;
    const pendingText = pending?.displayMessage || pending?.message;
    const pendingLogged = pending?.slot === slot
      && lines.some(line => line.includes('[YOU]') && (line.trimEnd().endsWith(pendingText) || line.trimEnd().endsWith(pending.message)));
    if (pending?.state === 'sent' && pendingLogged) {
      app.pendingCommunication = null;
    }
    renderActivityFeed(output, lines);
    if (follow) scrollConsoleToBottom(output);
  } catch (error) {
    if (requestId !== consoleRequestId || slot !== app.selectedSlot) return;
    if (app.consoleLines.length) {
      renderActivityFeed(output, app.consoleLines);
      if (forceScroll) scrollConsoleToBottom(output);
    } else {
      output.innerHTML = `<p class="console-empty">Console unavailable: ${escapeHtml(error.message)}</p>`;
      output.classList.add('empty');
    }
  } finally {
    if (requestId === consoleRequestId) app.consoleRefreshActive = false;
  }
}

function renderActivityFeed(output, lines) {
  const account = derived().selected || {};
  const localView = linesAfterLocalClear(app.selectedSlot, lines);
  const entries = localView.lines.map(ConsoleFeed.parseConsoleLine)
    .filter(entry => entry.category !== 'server' || ConsoleFeed.plainForMatch(entry.message).length);
  const pending = app.pendingCommunication;
  const pendingText = pending?.displayMessage || pending?.message;
  const pendingLogged = pending && lines.some(line => line.includes('[YOU') && (line.trimEnd().endsWith(pendingText) || line.trimEnd().endsWith(pending.message)));
  if (pending?.slot === app.selectedSlot && !pendingLogged) {
    entries.push({
      time: pending.time,
      kind: pending.state === 'failed' ? 'FAILED' : pending.state === 'sent' ? 'YOU' : 'SENDING',
      category: 'self',
      tone: pending.state === 'failed' ? 'attention' : pending.state === 'sent' ? 'sent' : 'pending',
      message: pendingText,
    });
  }
  if (!localView.cleared || entries.length) {
    if (account.service === 'active' && !account.connected) {
      const delayed = ['delayed', 'unresponsive'].includes(account.connection_state);
      const dropped = account.startup_phase === 'disconnected';
      const elapsed = formatDuration(account.startup_seconds || 0);
      entries.push({
        time: 'NOW', kind: dropped ? 'ATTENTION' : 'STARTUP', category: 'client', tone: dropped ? 'attention' : 'progress',
        message: delayed ? 'Client heartbeat delayed; the server connection is not confirmed lost.' : dropped
          ? 'Connection dropped. Automatic recovery is in progress.'
          : `${account.startup_phase === 'joining' ? 'Joining server' : 'Loading Minecraft'} · ${elapsed}`
      });
    } else if (account.name && !account.connected) {
      entries.push({time: 'NOW', kind: 'OFFLINE', category: 'client', tone: 'client', message: 'Client stopped.'});
    }
  }

  const counts = {all: entries.length, conversation: ConsoleFeed.selectEntries(entries, 'conversation').length, attention: ConsoleFeed.selectEntries(entries, 'attention').length, player: 0, whisper: 0, server: 0, self: 0, client: 0};
  entries.forEach(entry => { if (counts[entry.category] !== undefined) counts[entry.category] += 1; });
  $$('[data-console-count]').forEach(element => { element.textContent = String(counts[element.dataset.consoleCount] || 0); });
  $$('.console-filter').forEach(button => {
    const active = button.dataset.consoleFilter === app.consoleFilter;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const filterNames = {conversation: 'conversation', attention: 'issue', all: 'console', player: 'chat', whisper: 'whisper', server: 'server', self: 'sent', client: 'client'};
  const query = String(app.consoleSearch || '').trim().toLowerCase();
  const visible = ConsoleFeed.selectEntries(entries, app.consoleFilter, query);
  const source = $('#consoleSource');
  if (source) source.value = ['player', 'server', 'self', 'client'].includes(app.consoleFilter) ? app.consoleFilter : '';
  $('#consoleResultSummary').textContent = i18n.t('console_showing', {visible: visible.length, total: entries.length});
  let emptyText;
  if (query) {
    emptyText = 'No messages match your search.';
  } else if (!entries.length) {
    emptyText = localView.cleared ? 'Console cleared. New activity will appear here.' : 'No account activity recorded yet.';
  } else {
    emptyText = `No ${filterNames[app.consoleFilter] || ''} messages in this history.`;
  }
  const rows = ConsoleFeed.selectEntries(ConsoleFeed.compactEntries(entries), app.consoleFilter, query);
  output.innerHTML = rows.length ? rows.map(entry => {
    const borderClass = entry.tone === 'error' ? 'border-error'
      : entry.category === 'whisper' ? (entry.direction === 'out' ? 'border-whisper-out' : 'border-whisper')
      : (entry.category === 'client' || entry.category === 'self') ? 'border-client' : 'border-chat';
    const directionClass = entry.category === 'whisper' ? ` whisper-${entry.direction || 'in'}` : '';
    return `<div class="activity-entry ${entry.category || ''}${directionClass} ${entry.tone} ${borderClass}">
      <time>${escapeHtml(entry.time)}</time>
      <span class="activity-source">${escapeHtml(i18n.t(`console_source_${entry.category}`))}</span>
      <span class="activity-message">${ConsoleFeed.renderMinecraftText(entry.category === 'server' ? ConsoleFeed.formatServerNotice(entry.message) : entry.message)}${entry.repeats > 1 ? `<span class="activity-repeat" title="${entry.repeats} consecutive messages">×${entry.repeats}</span>` : ''}</span>
    </div>`;
  }).join('') : `<p class="console-empty">${emptyText}</p>`;
  output.classList.toggle('empty', !visible.length);
}

function renderRemoteAccess(local) {
  const access = local.remote_access || {};
  const panel = $('#remoteAccessPanel');
  const remoteTab = $('.settings-tab[data-tab="remote"]');
  const onRemoteTab = remoteTab?.classList.contains('active');
  const remoteUnavailable = $('#remoteUnavailable');
  panel.classList.toggle('hidden', !access.url || !onRemoteTab);
  if (access.url && onRemoteTab) {
    $('#remoteUrlValue').textContent = access.url;
    $('#remoteUrlHint').textContent = access.temporary_url ? 'Temporary address; it can change if the tunnel restarts.' : 'Stable address';
    $('#remoteUrlLink').href = access.url;
  }
  $('#logoutLink').classList.toggle('hidden', !local.remote_mode);
  $('#passwordPanel').classList.toggle('hidden', !(local.remote_mode || access.url) || !onRemoteTab);
  remoteUnavailable?.classList.toggle('hidden', Boolean(local.remote_mode || access.url) || !onRemoteTab);
  $('#settingsSaveActions')?.classList.toggle('hidden', onRemoteTab);
  $('#passwordMessage').textContent = local.remote_mode
    ? 'Save the new password safely; this remote page cannot update the private copy on your main PC.'
    : 'The private saved copy on this PC will be updated too.';
  activateSettingsTabIfNeeded();
}

function activateSettingsTabIfNeeded() {
  const active = $('.settings-tab.active');
  if (active && !active.classList.contains('hidden')) return;
  const fallback = $$('.settings-tab').find(tab => !tab.classList.contains('hidden'));
  if (!fallback) return;
  fallback.classList.add('active');
  fallback.setAttribute('aria-selected', 'true');
}

function bindSettingsTabs() {
  $$('.settings-tab').forEach(tab => {
    if (tab.dataset.bound) return;
    tab.dataset.bound = 'true';
    tab.addEventListener('click', () => activateSettingsTab(tab.dataset.tab));
    tab.addEventListener('keydown', event => {
      if (!['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const available = $$('.settings-tab').filter(item => !item.classList.contains('hidden'));
      const current = available.indexOf(tab);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? available.length - 1
        : (current + (event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1) + available.length) % available.length;
      available[next].focus();
      activateSettingsTab(available[next].dataset.tab);
    });
  });
  syncSettingsPanels();
  bindSettingsTabs = function () {};
}

function syncSettingsPanels() {
  const active = $$('.settings-tab').find(tab => tab.classList.contains('active') && !tab.classList.contains('hidden'));
  if (!active) return;
  const target = active.dataset.tab;
  $$(`[data-tab-panel]`).forEach(panel => panel.classList.toggle('hidden', panel.dataset.tabPanel !== target));
  $('#settingsSaveActions')?.classList.toggle('hidden', target === 'remote');
  if (target === 'account') {
    renderAccountSettings(true);
  }
}

function activateSettingsTab(target) {
  $$('.settings-tab').forEach(other => {
    const match = other.dataset.tab === target;
    other.classList.toggle('active', match);
    other.setAttribute('aria-selected', match ? 'true' : 'false');
  });
  syncSettingsPanels();
  renderRemoteAccess(app.local);
}

function createWhitelistItemRow(name) {
  const row = document.createElement('div');
  row.className = 'whitelist-item-row';
  row.setAttribute('role', 'listitem');

  const avatar = document.createElement('img');
  avatar.className = 'whitelist-item-avatar';
  avatar.src = avatarUrl(name, 24);
  avatar.alt = '';
  avatar.loading = 'lazy';

  const input = document.createElement('input');
  input.className = 'whitelist-item-input';
  input.type = 'text';
  input.value = name;
  input.maxLength = 16;
  input.spellcheck = false;
  input.autocomplete = 'off';
  input.placeholder = 'Player username';

  let debounceTimer = null;
  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const val = input.value.trim();
      avatar.src = avatarUrl(val || 'MHF_Steve', 24);
    }, 200);
    syncWhitelistHiddenInput();
  });

  input.addEventListener('blur', () => {
    const val = input.value.trim();
    if (!val) {
      row.remove();
      syncWhitelistHiddenInput();
    } else {
      input.value = val;
      avatar.src = avatarUrl(val, 24);
      syncWhitelistHiddenInput();
    }
  });

  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      const nextRow = row.nextElementSibling;
      if (nextRow && nextRow.querySelector('.whitelist-item-input')) {
        nextRow.querySelector('.whitelist-item-input').focus();
      } else {
        $('#tpaAddInput')?.focus();
      }
    }
  });

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'whitelist-item-remove-btn';
  removeBtn.title = `Remove ${name}`;
  removeBtn.setAttribute('aria-label', `Remove ${name}`);
  removeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';
  removeBtn.addEventListener('click', () => {
    row.remove();
    syncWhitelistHiddenInput();
  });

  row.appendChild(avatar);
  row.appendChild(input);
  row.appendChild(removeBtn);
  return row;
}

function syncWhitelistHiddenInput() {
  const listEl = $('#tpaWhitelistList');
  if (!listEl) return [];
  const inputs = $$('.whitelist-item-input', listEl);
  const names = [];
  const seen = new Set();
  for (const inp of inputs) {
    const val = inp.value.trim();
    if (val && !seen.has(val.toLowerCase())) {
      seen.add(val.toLowerCase());
      names.push(val);
    }
  }
  const serialized = names.join(', ');
  const hiddenInput = $('#accountTpaWhitelist');
  if (hiddenInput) hiddenInput.value = serialized;

  const countEl = $('#tpaWhitelistCount');
  if (countEl) {
    const isI18n = typeof i18n !== 'undefined';
    const s = names.length === 1 ? '' : (isI18n && i18n.getLang() === 'it' ? 'i' : 's');
    countEl.textContent = isI18n
      ? i18n.t('settings_players_count', { count: names.length, s })
      : `${names.length} player${names.length === 1 ? '' : 's'}`;
  }

  const existingEmpty = $('.whitelist-empty-hint', listEl);
  if (names.length === 0 && !existingEmpty) {
    const hint = document.createElement('div');
    hint.className = 'whitelist-empty-hint';
    hint.textContent = typeof i18n !== 'undefined'
      ? i18n.t('settings_whitelist_empty_hint')
      : 'No whitelisted players. Type a player username below and press Enter or click Add.';
    listEl.appendChild(hint);
  } else if (names.length > 0 && existingEmpty) {
    existingEmpty.remove();
  }

  return names;
}

function renderWhitelistList(rawWhitelist) {
  const listEl = $('#tpaWhitelistList');
  if (!listEl) return;
  listEl.innerHTML = '';

  let names = [];
  if (Array.isArray(rawWhitelist)) {
    names = rawWhitelist;
  } else if (typeof rawWhitelist === 'string') {
    names = rawWhitelist.split(',').map(s => s.trim()).filter(Boolean);
  }

  for (const name of names) {
    listEl.appendChild(createWhitelistItemRow(name));
  }
  syncWhitelistHiddenInput();
}

function isValidWhitelistName(name) {
  return /^\.?[a-zA-Z0-9_]{1,32}$/.test(name);
}

function addWhitelistPlayer(rawName) {
  const name = (rawName || '').trim();
  if (!name) return false;

  if (!isValidWhitelistName(name)) {
    showAlert('Player username must be 1–32 characters (letters, numbers, underscores, optional leading .).', true);
    return false;
  }

  const listEl = $('#tpaWhitelistList');
  if (!listEl) return false;

  const existingInputs = $$('.whitelist-item-input', listEl);
  const lower = name.toLowerCase();
  for (const inp of existingInputs) {
    if (inp.value.trim().toLowerCase() === lower) {
      inp.focus();
      inp.select();
      showAlert(`${name} is already in the whitelist.`);
      return false;
    }
  }

  const existingEmpty = $('.whitelist-empty-hint', listEl);
  if (existingEmpty) existingEmpty.remove();

  const newRow = createWhitelistItemRow(name);
  listEl.appendChild(newRow);
  syncWhitelistHiddenInput();
  listEl.scrollTop = listEl.scrollHeight;
  return true;
}

function addWhitelistPlayerFromInput() {
  const addInput = $('#tpaAddInput');
  if (!addInput) return;
  const raw = addInput.value.trim();
  if (!raw) return;

  if (raw.includes(',')) {
    const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
    let addedAny = false;
    for (const part of parts) {
      if (addWhitelistPlayer(part)) addedAny = true;
    }
    if (addedAny) {
      addInput.value = '';
    }
    addInput.focus();
    return;
  }

  if (addWhitelistPlayer(raw)) {
    addInput.value = '';
    addInput.focus();
  }
}

function renderAccountSettings(force = false) {
  const accounts = (app.remote?.accounts || []).filter(acc => acc.authenticated && acc.name);
  const targetSlot = app.selectedSlot || 1;
  const selected = accounts.find(acc => acc.slot === targetSlot) || accounts[0] || (app.remote?.accounts || []).find(acc => acc.slot === targetSlot) || { slot: targetSlot };
  app.accountSettingsSlot = selected.slot || 1;

  const defaultAltLabel = `Alt ${selected.slot || targetSlot}`;
  const name = selected.name || 'No account added';
  const avatarEl = $('#accountSettingsAvatar');
  if (avatarEl) avatarEl.src = avatarUrl(selected.name, 34);
  const nameEl = $('#accountSettingsName');
  if (nameEl) nameEl.textContent = name;
  const slotBadge = $('#accountSettingsSlotBadge');
  if (slotBadge) {
    slotBadge.textContent = selected.name ? `Account ${accounts.findIndex(acc => acc.slot === selected.slot) + 1}` : '';
    slotBadge.classList.toggle('hidden', !selected.name);
  }
  const purposeBadge = $('#accountSettingsPurposeBadge');
  if (purposeBadge) {
    const p = selected.settings?.purpose?.trim() || defaultAltLabel;
    purposeBadge.textContent = p;
    purposeBadge.classList.toggle('hidden', !selected.name);
  }
  const hostEl = $('#accountSettingsHost');
  if (hostEl) hostEl.textContent = selected.host_name ? `Hosted on ${selected.host_name}` : 'Assigned to Oracle VM';

  const settings = selected.settings || {
    startup_command_enabled: false,
    startup_command: '/home alt',
    startup_delay: 5,
    tpa_auto_accept: false,
    tpa_whitelist: '',
    purpose: '',
  };
  const startupToggle = $('#accountStartupToggle');
  const startupCmdInput = $('#accountStartupCommand');
  const startupDelaySelect = $('#accountStartupDelay');
  const tpaToggle = $('#accountTpaToggle');
  const tpaWhitelistInput = $('#accountTpaWhitelist');
  const purposeInput = $('#accountPurposeInput');

  const slotChanged = app._lastRenderedAccountSlot !== app.accountSettingsSlot;
  const shouldPopulate = slotChanged || force || !app._hasRenderedAccountInputs;

  if (shouldPopulate) {
    if (purposeInput) {
      purposeInput.value = settings.purpose || '';
      purposeInput.placeholder = `e.g. ${defaultAltLabel} (Spawner, Cactus, Farm...)`;
    }
    if (startupToggle) startupToggle.checked = Boolean(settings.startup_command_enabled);
    if (startupCmdInput) startupCmdInput.value = settings.startup_command || '/home alt';
    if (startupDelaySelect) startupDelaySelect.value = String(settings.startup_delay ?? 5);
    if (tpaToggle) tpaToggle.checked = Boolean(settings.tpa_auto_accept);

    const wlVal = settings.tpa_whitelist || '';
    if (tpaWhitelistInput) tpaWhitelistInput.value = wlVal;
    renderWhitelistList(wlVal);

    app._lastRenderedAccountSlot = app.accountSettingsSlot;
    app._hasRenderedAccountInputs = true;
  }

  $('#startupCommandFields')?.classList.toggle('disabled', !startupToggle?.checked);
  $('#tpaWhitelistContainer')?.classList.toggle('disabled', !tpaToggle?.checked);
  $('#tpaWhitelistFields')?.classList.toggle('disabled', !tpaToggle?.checked);
}

function renderWizardAccountScope(d) {
  const accounts = (d.global.accounts || []).filter(account => account.authenticated && account.name);
  const account = accounts.find(item => item.slot === app.selectedSlot);
  const accountName = account?.name || 'a new account';
  const hint = typeof i18n !== 'undefined'
    ? i18n.t('setup_scope_hint', { name: accountName })
    : `Steps 1–4 prepare the shared Oracle VM. Step 5 signs in ${accountName} only.`;
  $('#setupScopeHint')?.replaceChildren(hint);
}

function populateSettings(s) {
  if ($('#settingsForm').dataset.loaded) return;
  $('#serverInput').value = s.minecraft_server || '';
  $('#versionInput').value = s.minecraft_version || '';
  $('#heapMinInput').value = s.heap_min || '160m';
  $('#heapMaxInput').value = s.heap_max || '320m';
  $('#sshUserInput').value = s.ssh_user || 'ubuntu';
  $('#settingsForm').dataset.loaded = 'true';
}

const check = (ok, name, detail) => `<div class="check-row"><span class="check-state ${ok ? 'ok' : 'bad'}">${ok ? '✓' : '!'}</span><div><strong>${escapeHtml(name)}</strong><small>${escapeHtml(detail)}</small></div></div>`;
const wizardScope = (shared, accountName) => `<p class="wizard-scope ${shared ? 'shared' : 'account'}">${shared ? 'Shared VM step · applies to every saved account' : `This account only · ${escapeHtml(accountName)}`}</p>`;

function renderWizard(d) {
  $$('#setupSteps li').forEach((li, i) => { li.classList.toggle('complete', d.steps[i]); li.classList.toggle('current', i === d.current); });
  $('#wizardProgressBar').style.width = `${Math.max(8, d.completed / 5 * 100)}%`;
  const c = $('#wizardContent'), step = d.current, r = d.r, l = d.l;
  const accountName = d.selected?.name || 'a new account';
  const isI18n = typeof i18n !== 'undefined';
  const scopeShared = isI18n ? i18n.t('wizard_scope_shared') : 'Shared VM step · applies to every saved account';
  const scopeAccount = isI18n ? i18n.t('wizard_scope_account', { name: escapeHtml(accountName) }) : `This account only · ${escapeHtml(accountName)}`;
  const renderScope = (shared) => `<p class="wizard-scope ${shared ? 'shared' : 'account'}">${shared ? scopeShared : scopeAccount}</p>`;

  if (step === 0) {
    const rows = Object.entries(l.checks || {}).map(([name, value]) => check(value.ok, name === 'ssh_key' ? 'SSH key' : name, value.detail)).join('');
    const s1Title = isI18n ? i18n.t('step1_title') : 'Check this computer';
    const s1Lead = isI18n ? i18n.t('step1_lead') : 'The control center needs a few standard command-line tools. This shared check only needs to pass once, no matter how many Minecraft accounts you add.';
    const s1Note = isI18n ? i18n.t('step1_actions_note') : 'Read-only check';
    const s1Btn = isI18n ? i18n.t('step1_action_btn') : 'Run pre-flight';
    c.innerHTML = `${renderScope(true)}<h2>${s1Title}</h2><p class="lead">${s1Lead}</p><div class="check-list">${rows}</div><div class="wizard-actions"><p>${s1Note}</p><button class="button primary" data-action="preflight">${s1Btn}</button></div>`;
  } else if (step === 1) {
    const s2Title = isI18n ? i18n.t('step2_title') : 'Verify Oracle Cloud';
    const s2Lead = isI18n ? i18n.t('step2_lead', { name: escapeHtml(accountName) }) : `Read the shared tenancy, home region, current instances and storage use. This step creates nothing and does not change ${escapeHtml(accountName)}.`;
    const s2Cost = isI18n ? i18n.t('step2_cost_boundary') : '<strong>Cost boundary:</strong> the Create action stays locked until the shape, image licensing, instance count and total block storage are all shown as within Always Free.';
    const s2Note = isI18n ? i18n.t('step2_actions_note') : 'No Oracle resources are changed';
    const s2Btn = isI18n ? i18n.t('step2_action_btn') : 'Verify free allowance';
    c.innerHTML = `${renderScope(true)}<h2>${s2Title}</h2><p class="lead">${s2Lead}</p><div class="callout warning">${s2Cost}</div><div class="wizard-actions"><p>${s2Note}</p><button class="button primary" data-action="dry_run">${s2Btn}</button></div>`;
  } else if (step === 2) {
    const s3Title = isI18n ? i18n.t(r.reachable ? 'step3_title_existing' : 'step3_title_create') : (r.reachable ? 'Use the existing VM' : 'Create the Always Free VM');
    const s3Lead = isI18n ? i18n.t(r.reachable ? 'step3_lead_existing' : 'step3_lead_create') : (r.reachable ? 'The recorded E2.1.Micro is reachable. This same VM is shared by your saved Minecraft accounts.' : 'Provision one x86 E2.1.Micro only after the dry-run evidence is reviewed. It will be shared by your saved accounts.');
    const s3RecInst = isI18n ? i18n.t('step3_recorded_instance') : 'Recorded instance';
    const s3NoVm = isI18n ? i18n.t('step3_no_vm') : 'No VM recorded';
    const s3TypeConf = isI18n ? i18n.t('step3_type_confirm') : 'Type ALWAYS FREE to unlock provisioning';
    const s3Note = isI18n ? i18n.t(r.reachable ? 'step3_actions_note_existing' : 'step3_actions_note_create') : (r.reachable ? 'No new cloud resources required' : 'Creates an Oracle VM and, only if needed, basic networking');
    const s3Btn = isI18n ? i18n.t(r.reachable ? 'step3_action_btn_existing' : 'step3_action_btn_create') : (r.reachable ? 'Install on this VM' : 'Create free VM');
    c.innerHTML = `${renderScope(true)}<h2>${s3Title}</h2><p class="lead">${s3Lead}</p>${check(Boolean(l.vm?.instance_id), s3RecInst, l.vm?.instance_id || s3NoVm)}${r.reachable ? '' : `<div class="confirmation"><label>${s3TypeConf}<input id="provisionConfirm" autocomplete="off" placeholder="ALWAYS FREE"></label></div>`}<div class="wizard-actions"><p>${s3Note}</p><button class="button primary" data-action="${r.reachable ? 'repair_vm' : 'provision'}">${s3Btn}</button></div>`;
  } else if (step === 3) {
    const s4Title = isI18n ? i18n.t('step4_title') : 'Install and repair safely';
    const s4Lead = isI18n ? i18n.t('step4_lead') : 'Apply the lightweight MCC runtime, memory limits, firewall, persistent logs and helper commands.';
    const s4Ssh = isI18n ? i18n.t('step4_ssh_connection') : 'SSH connection';
    const s4Ready = isI18n ? i18n.t('step4_ready') : 'Ready';
    const s4Cluster = isI18n ? i18n.t('step4_cluster_runtime') : 'Cluster runtime';
    const s4EveryHost = isI18n ? i18n.t('step4_installed_every_host') : 'Installed on every host';
    const s4Repair = isI18n ? i18n.t('step4_needs_repair') : 'Needs repair';
    const s4Note = isI18n ? i18n.t('step4_actions_note') : 'Idempotent and safe to repeat';
    const s4Btn = isI18n ? i18n.t('step4_action_btn') : 'Install or repair';
    c.innerHTML = `${renderScope(true)}<h2>${s4Title}</h2><p class="lead">${s4Lead}</p><div class="check-list">${check(r.reachable, s4Ssh, r.reachable ? s4Ready : r.reason)}${check(r.installed, s4Cluster, r.installed ? s4EveryHost : s4Repair)}</div><div class="wizard-actions"><p>${s4Note}</p><button class="button primary" data-action="repair_vm">${s4Btn}</button></div>`;
  } else if (step === 4) {
    if (d.selectedAccountReady) {
      const signOutText = isI18n ? i18n.t('step5_signout_name', { name: escapeHtml(accountName) }) : `Sign out ${escapeHtml(accountName)}`;
      const signOut = `<button class="button secondary" type="button" data-action="sign_out" data-slot="${app.selectedSlot}">${signOutText || `Sign out ${escapeHtml(accountName)}`}</button>`;
      const s5RTitle = isI18n ? i18n.t('step5_ready_title', { name: escapeHtml(accountName) }) : `${escapeHtml(accountName)} is ready`;
      const s5RLead = isI18n ? i18n.t('step5_ready_lead', { name: escapeHtml(accountName) }) : `The shared VM is prepared and this Minecraft account is signed in. Starting and stopping ${escapeHtml(accountName)} is managed separately from Overview.`;
      const s5SignedAs = isI18n ? i18n.t('step5_signed_in_as', { name: accountName }) : `Signed in as ${accountName}`;
      const s5ReadyToStart = isI18n ? i18n.t('step5_ready_to_start', { slot: app.selectedSlot }) : `Account ${app.selectedSlot} · ready to start when you choose`;
      const s5Complete = isI18n ? i18n.t('step5_setup_complete') : "This account's one-time setup is complete";
      c.innerHTML = `${renderScope(false)}<h2>${s5RTitle}</h2><p class="lead">${s5RLead}</p><div class="check-list">${check(true, s5SignedAs, s5ReadyToStart)}</div><div class="wizard-actions"><p>${s5Complete}</p><div class="wizard-action-buttons">${signOut}</div></div>`;
    } else {
      const signOutTextSlot = isI18n ? i18n.t('step5_signout_slot', { slot: app.selectedSlot }) : `Sign out Account ${app.selectedSlot}`;
      const signOut = d.selected?.authenticated ? `<button class="button secondary" type="button" data-action="sign_out" data-slot="${app.selectedSlot}">${signOutTextSlot || `Sign out Account ${app.selectedSlot}`}</button>` : '';
      const s5Title = isI18n ? i18n.t('step5_signin_title', { name: escapeHtml(accountName) }) : `Sign in ${escapeHtml(accountName)}`;
      const s5Lead = isI18n ? i18n.t('step5_signin_lead') : 'Start a device-code flow for this account only. A dialog will show the official Microsoft link and one-time code for Java or Bedrock.';
      const s5Callout = isI18n ? i18n.t('step5_signin_callout') : "Your Microsoft password never passes through this control center. The refresh token stays inside this account's private profile on its assigned Oracle host.";
      const s5NeedAlt = isI18n ? i18n.t('step5_need_free_alt') : 'Need a Bedrock alt?';
      const s5FreeDesc = isI18n ? i18n.t('step5_free_alt_desc') : 'Bedrock accounts need a Microsoft/Xbox profile and an owned Minecraft Bedrock license.';
      const s5GuideLink = isI18n ? i18n.t('step5_guide_link') : 'View 2-minute step guide →';
      const s5ActionReq = isI18n ? i18n.t('step5_signin_lead') : 'Approve a Microsoft code to add an account.';
      const s5SignInBtn = isI18n ? i18n.t('topbar_add_account') : 'Add account';
      c.innerHTML = `${renderScope(false)}<h2>${s5Title}</h2><p class="lead">${s5Lead}</p><div class="callout">${s5Callout}</div><div class="callout callout-guide-tip"><strong>${s5NeedAlt}</strong> ${s5FreeDesc} <button type="button" class="guide-link-btn" id="wizardGuideLink">${s5GuideLink}</button></div><div class="wizard-actions"><p>${s5ActionReq}</p><div class="wizard-action-buttons"><button class="button primary" data-action="open_auth">${s5SignInBtn}</button>${signOut}</div></div>`;
    }
  }
  bindActionButtons(c);
}

function showAlert(message, type = false) {
  const el = $('#alertBanner');
  if (!el) return;
  el.textContent = message;
  const isError = type === true || type === 'error';
  const isSuccess = type === 'success';
  el.className = `alert${isError ? ' error' : (isSuccess ? ' success' : '')}`;
  el.classList.remove('hidden');
  clearTimeout(showAlert._timer);
  showAlert._timer = setTimeout(() => el.classList.add('hidden'), 8000);
}

function bindActionButtons(root = document) {
  $$('[data-action]', root).forEach(button => {
    if (button.dataset.bound) return;
    if (String(button.dataset.action || '').startsWith('go-to-')) return;
    button.dataset.bound = 'true';
    button.addEventListener('click', () => {
      const slot = button.dataset.slot ? Number(button.dataset.slot) : app.selectedSlot;
      startAction(button.dataset.action, {slot});
    });
  });
}

const SERVICE_ACTIONS = ['start', 'stop', 'restart', 'start_all', 'stop_all', 'start_both', 'stop_both'];

function selectedServiceOperation() {
  const operation = app.serviceOperation;
  return operation && (operation.all || operation.slot === app.selectedSlot) ? operation : null;
}

function serviceProgress(operation, stage) {
  const action = operation.action.startsWith('stop') ? 'stop' : operation.action === 'restart' ? 'restart' : 'start';
  const key = stage === 'label' || stage === 'title' ? `${action}_${stage}` : stage;
  return i18n.t(`service_progress_${key}`);
}

function reconcileServiceOperation(statusUpdated = true) {
  const operation = app.serviceOperation;
  if (!operation || operation.stage !== 'confirming') return;
  const accounts = (app.remote.accounts || []).filter(account => operation.all ? account.authenticated : account.slot === operation.slot);
  const stopping = operation.action.startsWith('stop');
  const confirmed = statusUpdated && !app.remote.health_stale && accounts.length > 0 && accounts.every(account => account.reachable !== false && app.remote.reachable !== false &&
    (stopping ? account.service === 'inactive' : account.service === 'active' || account.service === 'failed'));
  if (confirmed || Date.now() - operation.started > 120000) {
    app.serviceOperation = null;
    if (!confirmed) showAlert(i18n.t('service_progress_timeout'), true);
  }
}

function needsFastStatus() {
  return Boolean(app.serviceOperation) || (app.remote.accounts || []).some(account =>
    account.service === 'activating' || account.service === 'deactivating' || (account.service === 'active' && !account.connected));
}

async function startAction(action, extra = {}) {
  const serviceAction = SERVICE_ACTIONS.includes(action);
  if (serviceAction && (app.serviceOperation || app.currentTask)) return;
  const slot = extra.slot ?? app.selectedSlot;
  const name = accountDisplayName(slot);
  if (action === 'open_auth') {
    if (!extra.edition) {
      if (app.authAttempt) return;
      if (app.currentTask) {
        showAlert(typeof i18n !== 'undefined' ? i18n.t('alert_wait_task') : 'Wait for the current action to finish before adding an account.', true);
        return;
      }
      app.authSlot = slot;
      app.authAttempt = {slot, taskId: null, closing: false};
      showAuthEditionStage(slot);
      return;
    }
    if (!app.authAttempt || app.authAttempt.slot !== slot || app.authAttempt.closing || app.authAttempt.taskId || app.authAttempt.requestPending) return;
    if (app.currentTask) {
      showAlert(typeof i18n !== 'undefined' ? i18n.t('alert_wait_task') : 'Wait for the current action to finish before adding an account.', true);
      return;
    }
    app.authAttempt.requestPending = true;
  }
  const stopConfirmMsg = typeof i18n !== 'undefined' ? i18n.t('confirm_disconnect_name', { name }) : `Disconnect ${name}? The Oracle VM will stay running.`;
  if (action === 'stop' && !confirm(stopConfirmMsg || `Disconnect ${name}? The Oracle VM will stay running.`)) return;
  const startAllMsg = typeof i18n !== 'undefined' ? i18n.t('confirm_start_all') : 'Run every signed-in Minecraft account across the Oracle hosts?';
  if (action === 'start_all' && !confirm(startAllMsg || 'Run every signed-in Minecraft account across the Oracle hosts?')) return;
  const stopAllMsg = typeof i18n !== 'undefined' ? i18n.t('confirm_stop_all') : 'Disconnect every Minecraft account? Both Oracle hosts will stay running.';
  if (action === 'stop_all' && !confirm(stopAllMsg || 'Disconnect every Minecraft account? Both Oracle hosts will stay running.')) return;
  const removeAccount = (app.remote?.accounts || []).find(account => account.slot === slot && account.authenticated);
  const removeName = removeAccount ? `${removeAccount.name} (${removeAccount.edition === 'bedrock' ? 'Bedrock' : 'Java'})` : name;
  const signoutMsg = typeof i18n !== 'undefined' ? i18n.t('confirm_signout_name', { name: removeName }) : `Remove ${removeName}? This stops the client and deletes its saved Microsoft session. You will need to sign in again to add it back.`;
  if (action === 'sign_out' && !confirm(signoutMsg || `Remove ${removeName}? This stops the client and deletes its saved Microsoft session. You will need to sign in again to add it back.`)) return;
  if (serviceAction) {
    app.serviceOperation = {action, slot, all: action.endsWith('_all') || action.endsWith('_both'), stage: 'sending', started: Date.now()};
    render();
  }
  if ((action === 'start' || action === 'restart') && !extra.force) {
    app.serviceOperation.stage = 'checking';
    render();
    try {
      const check = await runTaskAndWait('pre_start_check', {slot});
      const warnings = check?.result?.warnings || [];
      if (warnings.length > 0) {
        app.serviceOperation = null;
        render();
        app.pendingStart = {action, slot};
        showPreStartModal(warnings, name, action);
        return;
      }
    } catch (error) {
      const headsupErr = typeof i18n !== 'undefined' ? i18n.t('alert_headsup_failed', { error: error.message }) : `Heads-up check failed: ${error.message}. Starting anyway.`;
      showAlert(headsupErr || `Heads-up check failed: ${error.message}. Starting anyway.`, true);
    }
  }
  if (serviceAction) { app.serviceOperation.stage = 'sending'; render(); }
  const payload = { action, ...extra, slot };
  if (action === 'provision') payload.confirmation = $('#provisionConfirm')?.value || '';
  if (action === 'open_auth') payload.mode = app.mode;
  if (action === 'open_auth') {
    app.authEdition = extra.edition;
    showAuthDeviceStage(slot, extra.edition);
  }
  const authAttempt = action === 'open_auth' ? app.authAttempt : null;
  try {
    await ensureToken();
    const data = await api('/api/actions', { method: 'POST', headers: {'Content-Type':'application/json','X-Control-Token':app.token}, body: JSON.stringify(payload) });
    if (action === 'open_auth') {
      authAttempt.requestPending = false;
      if (authAttempt.closing || app.authAttempt !== authAttempt) {
        await cancelInProgressAuth(slot, data.task.id);
        if (app.authAttempt === authAttempt) app.authAttempt = null;
        return;
      }
      authAttempt.taskId = data.task.id;
    }
    watchTask(data.task, slot);
  } catch (error) {
    if (authAttempt) {
      authAttempt.requestPending = false;
      if (authAttempt.closing && app.authAttempt === authAttempt) app.authAttempt = null;
    }
    if (serviceAction) { app.serviceOperation = null; render(); }
    if (action === 'open_auth' && !app.authAttempt?.closing) markAuthModalFailed(error.message);
    if (action === 'communicate') finishCommunication(false, error.message);
    if (action === 'save_account_settings' || action === 'save_settings') finishSettingsSave(false, error.message);
    showAlert(error.message, true);
  }
}

function isQuietTask(action) {
  return ['open_auth', 'cancel_auth', 'communicate', 'start', 'restart', 'stop', 'start_all', 'stop_all', 'start_both', 'stop_both', 'reorder_slots', 'save_account_settings', 'save_settings', 'sign_out'].includes(action);
}

function watchTask(task, targetSlot = app.selectedSlot) {
  app.currentTask = task.id;
  app.currentTaskSlot = targetSlot;
  const quiet = isQuietTask(task.action);
  $('#taskDrawer').classList.toggle('open', !quiet); $('#taskDrawer').setAttribute('aria-hidden', quiet ? 'true' : 'false');
  const name = accountDisplayName(targetSlot);
  const isI18n = typeof i18n !== 'undefined';
  const taskLabels = {
    start: isI18n ? i18n.t('task_start_name', { name }) : `Starting ${name}`,
    restart: isI18n ? i18n.t('task_restart_name', { name }) : `Restarting ${name}`,
    stop: isI18n ? i18n.t('task_stop_name', { name }) : `Stopping ${name}`,
    sign_out: isI18n ? i18n.t('task_signout_name', { name }) : `Signing out ${name}`,
    save_account_settings: isI18n ? i18n.t('task_save_account', { name }) : `Saving settings for ${name}`,
    save_settings: isI18n ? i18n.t('task_save_client') : 'Saving client settings'
  };
  $('#taskTitle').textContent = taskLabels[task.action] || task.action.replaceAll('_', ' ');
  const sendingText = isI18n ? i18n.t('task_sending_req') : 'Sending the request to the VM…';
  const startingText = isI18n ? i18n.t('task_starting') : 'Starting…';
  $('#taskOutput').textContent = task.output || (task.action === 'start' || task.action === 'restart' ? sendingText : startingText);
  $('.spinner', $('#taskDrawer')).className = 'spinner';
  if (task.action === 'communicate') {
    $('#communicationForm').classList.add('sending');
    $('#communicationInput').disabled = true;
    $('#communicationSend').disabled = true;
    const useBtn = $('#useItemBtn');
    if (useBtn) useBtn.disabled = true;
    const dropBtn = $('#dropItemBtn');
    if (dropBtn) dropBtn.disabled = true;
    $('#communicationHint').className = '';
    $('#communicationHint').textContent = '';
    $('#communicationHint').hidden = true;
  }
  clearInterval(app.timer); app.timer = setInterval(pollTask, task.action === 'communicate' ? 250 : 900); pollTask();
}

function finishCommunication(succeeded, message) {
  const hint = $('#communicationHint');
  const input = $('#communicationInput');
  const ready = Boolean(derived().selected?.communication_ready);
  $('#communicationForm').classList.remove('sending');
  input.disabled = !ready;
  $('#communicationSend').disabled = !ready;
  const useBtn = $('#useItemBtn');
  if (useBtn) useBtn.disabled = !ready;
  const dropBtn = $('#dropItemBtn');
  if (dropBtn) dropBtn.disabled = !ready;
  if (succeeded) {
    hint.className = '';
    hint.textContent = '';
    hint.hidden = true;
  } else {
    hint.className = 'error';
    hint.textContent = (message || 'The message could not be sent.').trim();
    hint.hidden = false;
  }
  if (app.pendingCommunication) {
    app.pendingCommunication.state = succeeded ? 'sent' : 'failed';
    if (!succeeded && !input.value && app.pendingCommunication.mode !== 'action') {
      input.value = app.pendingCommunication.message;
      $('#communicationCount').textContent = `${input.value.length}/100`;
    }
  }
  renderActivityFeed($('#consoleOutput'), app.consoleLines);
  scrollConsoleToBottom($('#consoleOutput'));
  if (ready) input.focus();
}

function finishSettingsSave(success, detail = '') {
  app.savingSettings = false;
  const saveBtn = $('#settingsSaveBtn');
  const msgEl = $('#settingsMessage');
  const isI18n = typeof i18n !== 'undefined';
  if (saveBtn) {
    saveBtn.disabled = false;
  }
  if (success) {
    if (saveBtn) {
      saveBtn.textContent = isI18n ? i18n.t('settings_saved_btn') : 'Saved ✓';
      clearTimeout(finishSettingsSave._btnTimer);
      finishSettingsSave._btnTimer = setTimeout(() => {
        if (saveBtn && !app.savingSettings) {
          saveBtn.textContent = isI18n ? i18n.t('settings_save_btn') : 'Save';
        }
      }, 2500);
    }
    const succMsg = (detail || '').trim().split('\n')[0] || (isI18n ? i18n.t('alert_settings_saved') : 'Settings saved. Restart the client to apply them.');
    if (msgEl) {
      msgEl.textContent = succMsg;
      msgEl.className = 'settings-status-success';
    }
    showAlert(succMsg, 'success');
  } else {
    if (saveBtn) {
      saveBtn.textContent = isI18n ? i18n.t('settings_save_btn') : 'Save';
    }
    const errMsg = detail || 'Failed to save settings.';
    if (msgEl) {
      msgEl.textContent = errMsg;
      msgEl.className = 'settings-status-error';
    }
    showAlert(errMsg, true);
  }
}

function extractDevicePrompt(output) {
  const text = String(output || '');
  const bedrockMarker = text.lastIndexOf('Starting Bedrock sign-in');
  const searchText = bedrockMarker !== -1 ? text.slice(bedrockMarker) : text;
  const urls = [...searchText.matchAll(/https:\/\/(?:www\.)?microsoft\.com\/(?:link|devicelogin)(?:\?[^\s<>"']*)?/gi)];
  if (!urls.length) return null;
  const url = urls[urls.length - 1][0].replace(/[.,);\]]+$/, '');
  const otc = new URL(url).searchParams.get('otc');
  const nearbyCode = searchText.match(/(?:enter|use)\s+(?:the\s+)?code\s*[:=]?\s*([A-Z0-9-]{6,16})|\bcode\s*[:=]\s*([A-Z0-9-]{6,16})/gi);
  const lastCode = nearbyCode ? nearbyCode[nearbyCode.length - 1].match(/[A-Z0-9-]{6,16}/i) : null;
  return {code: (otc || lastCode?.[0] || '').toUpperCase()};
}

function microsoftSignInUrl(code) {
  // microsoft.com/link is only the device-code field. Send the user through
  // Microsoft’s account picker first, then continue to that field with the
  // one-time code attached so they can choose an alt instead of the browser’s
  // already-signed-in account.
  const device = new URL('https://login.live.com/oauth20_remoteconnect.srf');
  const trimmed = String(code || '').trim();
  if (trimmed) device.searchParams.set('otc', trimmed);
  const signIn = new URL('https://login.live.com/login.srf');
  signIn.searchParams.set('wa', 'wsignin1.0');
  signIn.searchParams.set('prompt', 'select_account');
  signIn.searchParams.set('wreply', device.toString());
  return signIn.toString();
}

async function pollTask() {
  if (!app.currentTask || app.taskPollActive) return;
  app.taskPollActive = true;
  const taskId = app.currentTask;
  try {
    const task = await api(`/api/tasks/${taskId}`);
    if (app.currentTask !== taskId) return;
    $('#taskOutput').textContent = task.output || 'Working…'; $('#taskOutput').scrollTop = $('#taskOutput').scrollHeight;
    if (task.action === 'open_auth') {
      const output = String(task.output || '');
      const isBoth = app.authEdition === 'both' || task.result?.auth_edition === 'both';
      const isBedrockStage = isBoth && (task.result?.auth_stage === 'bedrock' || /Approve the Bedrock code|Starting Bedrock sign-in/i.test(output));
      const activeLabel = $('#authActiveEditionLabel');
      if (activeLabel && isBoth) {
        activeLabel.textContent = typeof i18n !== 'undefined'
          ? (isBedrockStage ? i18n.t('auth_both_step2') : i18n.t('auth_both_step1'))
          : (isBedrockStage ? 'Step 2 of 2: Adding Bedrock Edition' : 'Step 1 of 2: Verifying Java Edition');
      }
      const isApproving = isBedrockStage
        ? /\[msa\] Signed in with Microsoft/i.test(output)
        : /Using Minecraft version|Java account.*saved/i.test(output);
      const prompt = task.result?.device_code || extractDevicePrompt(task.output);
      if (isApproving) {
        setAuthModalState('waiting', typeof i18n !== 'undefined' ? i18n.t('auth_status_approving') : 'Microsoft approved! Validating gamer profile…');
      } else if (prompt) {
        updateAuthModal(prompt.code, isBedrockStage);
      } else if (isBedrockStage) {
        updateAuthModal('', true);
      }
    }
    if (task.state !== 'running') {
      clearInterval(app.timer); app.currentTask = null;
      if (SERVICE_ACTIONS.includes(task.action)) {
        if (task.state === 'succeeded' && app.serviceOperation) app.serviceOperation.stage = 'confirming';
        else app.serviceOperation = null;
        render();
        refreshConsole(true);
      }
      $('.spinner', $('#taskDrawer')).className = `spinner ${task.state === 'succeeded' ? 'done' : 'failed'}`;
      const isI18n = typeof i18n !== 'undefined';
      const accepted = task.state === 'succeeded' && (task.action === 'start' || task.action === 'restart');
      const taskDoneText = isI18n ? (accepted ? i18n.t('task_accepted') : i18n.t('task_done')) : (accepted ? 'Start accepted — loading continues' : 'Done');
      const taskFailedText = isI18n ? i18n.t('task_failed') : 'Action failed';
      $('#taskTitle').textContent = task.state === 'succeeded' ? taskDoneText : taskFailedText;
      if (isQuietTask(task.action) && task.state !== 'succeeded' && task.action !== 'open_auth' && task.action !== 'communicate' && task.action !== 'save_account_settings' && task.action !== 'save_settings') {
        const targetSlot = app.currentTaskSlot || app.selectedSlot;
        const name = accountDisplayName(targetSlot);
        showAlert((task.output || `${name} action failed.`).trim().split('\n').pop(), true);
      }
      if (task.action === 'open_auth' && !app.authAttempt?.closing) {
        if (app.authAttempt) app.authAttempt.taskId = null;
        if (task.state === 'succeeded') {
          const targetSlot = app.currentTaskSlot || app.selectedSlot;
          app.selectedSlot = targetSlot;
          localStorage.setItem('afk-selected-slot', String(targetSlot));
          const accounts = task.result?.accounts || [];
          const javaSlot = Number(task.result?.java_slot || targetSlot);
          const java = accounts.find(a => Number(a.slot) === javaSlot);
          const paired = Number(task.result?.paired_slot);
          const bedrock = Number.isInteger(paired) ? accounts.find(a => Number(a.slot) === paired) : null;
          if (app.authEdition === 'both' && java && bedrock) {
            const javaMessage = task.result?.reused_java ? `${java.name} (Java) was already saved` : `${java.name} (Java) added`;
            setAuthModalState('done', `${javaMessage}; ${bedrock.name} (Bedrock) added. Start either account when you want it online.`);
          } else {
            const name = java?.name || accountDisplayName(targetSlot);
            setAuthModalState('done', `${name} connected. You can close this dialog and start it.`);
          }
          $('#authSwitchPrompt')?.classList.add('hidden');
        } else {
          const detail = authFailureDetail(task.output);
          const reason = detail || (isI18n ? i18n.t('auth_status_failed') : 'Microsoft did not confirm the sign-in. Try again for a new code.');
          markAuthModalFailed(reason);
          const switchPrompt = $('#authSwitchPrompt');
          const switchText = $('#authSwitchPromptText');
          const switchBtn = $('#authSwitchPromptBtn');
          if (switchPrompt && switchText && switchBtn) {
            if (/does not own Minecraft Bedrock|UNAUTHORIZED|Mojang rejected Bedrock multiplayer/i.test(detail)) {
              switchText.textContent = isI18n ? i18n.t('auth_bedrock_no_license') : 'Mojang rejected Bedrock multiplayer for this Microsoft account. If you own Java, Bedrock is already included! However, you must launch Minecraft Bedrock at least once on this account before connecting.';
              switchBtn.textContent = isI18n ? (i18n.t('auth_view_help_btn') || i18n.t('auth_view_guide_btn')) : 'How to set up Bedrock →';
              delete switchBtn.dataset.targetEdition;
              switchBtn.dataset.action = 'open-bedrock-help';
              switchPrompt.classList.remove('hidden');
            } else if (/Java sign-in did not produce a Java profile/i.test(detail)) {
              switchText.textContent = isI18n ? i18n.t('auth_switch_java_not_found') : 'No Java profile found for this Microsoft account. Did you mean to sign in as Bedrock?';
              switchBtn.textContent = isI18n ? i18n.t('auth_switch_java_btn') : 'Switch to Bedrock & Try Again';
              delete switchBtn.dataset.action;
              switchBtn.dataset.targetEdition = 'bedrock';
              switchPrompt.classList.remove('hidden');
            } else if (/Bedrock sign-in failed|did not return a Bedrock profile/i.test(detail)) {
              switchText.textContent = isI18n ? i18n.t('auth_switch_bedrock_not_found') : 'Bedrock profile was not found. Did you mean to sign in as Java?';
              switchBtn.textContent = isI18n ? i18n.t('auth_switch_bedrock_btn') : 'Switch to Java & Try Again';
              delete switchBtn.dataset.action;
              switchBtn.dataset.targetEdition = 'java';
              switchPrompt.classList.remove('hidden');
            } else {
              switchText.textContent = isI18n ? i18n.t('auth_retry_hint') : 'Request a new Microsoft code. The previous sign-in was stopped.';
              switchBtn.textContent = isI18n ? i18n.t('auth_retry_btn') : 'Try again';
              delete switchBtn.dataset.action;
              switchBtn.dataset.targetEdition = app.authEdition || 'java';
              switchPrompt.classList.remove('hidden');
            }
          }
        }
      }
      if (task.action === 'change_password' && task.state === 'succeeded') {
        $('#newPasswordInput').value = ''; $('#confirmPasswordInput').value = '';
        $('#passwordMessage').textContent = isI18n ? i18n.t('alert_password_changed') : 'Password changed successfully.';
      }
      if (task.action === 'save_account_settings' || task.action === 'save_settings') {
        if (task.state === 'succeeded') {
          finishSettingsSave(true, task.output);
        } else {
          const detail = (task.output || '').trim().split('\n').filter(line => line.trim() && !line.includes('ValueError:')).pop() || 'Failed to save settings.';
          finishSettingsSave(false, detail);
        }
      }
      if (task.action === 'communicate') {
        const detail = task.state === 'succeeded'
          ? (task.output || 'Sent.').trim()
          : ((task.output || '').trim().split('\n').pop() || 'The message could not be sent.');
        finishCommunication(task.state === 'succeeded', detail);
        if (task.state === 'succeeded') {
          refreshConsole(true);
        }
      } else {
        await refreshStatus(true);
      }
      if (task.action === 'reorder_slots') setReorderBusy(false);
      if (task.state === 'failed' && task.action !== 'save_account_settings' && task.action !== 'save_settings') {
        if (task.action === 'reorder_slots') setReorderBusy(false);
        const detail = (task.output || '').trim().split('\n').filter(line => line.trim() && !line.includes('ValueError:')).pop() || 'The action failed. Open the activity panel for details.';
        showAlert(detail, true);
      }
    }
  } catch (error) {
    clearInterval(app.timer);
    if (app.authAttempt?.taskId && app.authAttempt.taskId === app.currentTask) {
      const attempt = app.authAttempt;
      markAuthModalFailed(`The sign-in connection was interrupted: ${error.message}. The attempt is being cancelled; you can retry afterward.`);
      await cancelInProgressAuth(attempt.slot, attempt.taskId);
      if (app.authAttempt === attempt) attempt.taskId = null;
      await refreshStatus(true);
    }
    if (app.currentTask && app.pendingCommunication) finishCommunication(false, error.message);
    if (app.savingSettings) finishSettingsSave(false, error.message);
    app.currentTask = null;
    app.serviceOperation = null;
    render();
    showAlert(error.message, true);
  } finally { app.taskPollActive = false; }
}

function showAuthEditionStage(slot) {
  $('#authModalTitle').textContent = typeof i18n !== 'undefined' ? i18n.t('topbar_add_account') : 'Add account';
  $('#authSwitchEditionBtn').disabled = false;
  $('#authEditionStage')?.classList.remove('hidden');
  $('#authDeviceStage')?.classList.add('hidden');
  $('#authSwitchPrompt')?.classList.add('hidden');
  $('#authModal').classList.remove('hidden');
  $('.auth-modal-card').focus();
}

function showAuthDeviceStage(slot, edition) {
  const isI18n = typeof i18n !== 'undefined';
  $('#authModalTitle').textContent = isI18n ? i18n.t('topbar_add_account') : 'Add account';
  $('#authSwitchEditionBtn').disabled = true;
  const label = $('#authActiveEditionLabel');
  if (label) {
    label.textContent = edition === 'both'
      ? (isI18n ? i18n.t('auth_both_step1') : 'Step 1 of 2: Verifying Java Edition')
      : edition === 'bedrock'
        ? (isI18n ? i18n.t('auth_connecting_bedrock') : 'Connecting Bedrock Edition (.alt)')
        : (isI18n ? i18n.t('auth_connecting_java') : 'Connecting Java Edition (PC)');
  }
  $('#authEditionStage')?.classList.add('hidden');
  $('#authDeviceStage')?.classList.remove('hidden');
  $('#authSwitchPrompt')?.classList.add('hidden');
  const link = $('#authModalLink');
  link.removeAttribute('href');
  link.classList.add('disabled');
  link.setAttribute('aria-disabled', 'true');
  link.textContent = isI18n ? i18n.t('auth_link_preparing') : 'Preparing sign-in page…';
  $('#authModalCode').textContent = isI18n ? i18n.t('auth_code_preparing') : 'Preparing…';
  $('#authModalCopy').disabled = true;
  setAuthModalState('waiting', isI18n ? i18n.t('auth_status_starting') : 'Starting a secure sign-in session…');
  $('#authModal').classList.remove('hidden');
  $('.auth-modal-card').focus();
}

function updateAuthModal(code, isSecondStep = false) {
  const isI18n = typeof i18n !== 'undefined';
  const link = $('#authModalLink');
  link.href = microsoftSignInUrl(code);
  if (code) {
    link.classList.remove('disabled');
    link.removeAttribute('aria-disabled');
    link.textContent = isI18n ? i18n.t('auth_open_microsoft') : 'Open Microsoft sign-in';
    $('#authModalCode').textContent = code;
    $('#authModalCopy').disabled = false;
    const readyStatus = isSecondStep
      ? (isI18n ? i18n.t('auth_both_step2_status') : 'Java verified! Enter this second code at Microsoft to connect Bedrock.')
      : (isI18n ? i18n.t('auth_status_ready') : 'Ready. Open Microsoft, choose the account, then confirm the code.');
    setAuthModalState('waiting', readyStatus);
  } else {
    link.classList.add('disabled');
    link.setAttribute('aria-disabled', 'true');
    link.textContent = isI18n ? i18n.t('auth_link_preparing') : 'Preparing sign-in page…';
    $('#authModalCode').textContent = isI18n ? i18n.t('auth_code_preparing') : 'Preparing…';
    $('#authModalCopy').disabled = true;
    const waitingStatus = isSecondStep
      ? (isI18n ? i18n.t('auth_status_preparing_bedrock') : 'Java verified! Preparing Bedrock sign-in code…')
      : (isI18n ? i18n.t('auth_status_waiting_code') : 'Microsoft’s page is ready. Waiting for the one-time code…');
    setAuthModalState('waiting', waitingStatus);
  }
}

function setAuthModalState(state, message) {
  const row = $('#authModalStatus').parentElement;
  row.classList.remove('done', 'failed');
  if (state === 'done' || state === 'failed') row.classList.add(state);
  $('.spinner', row).className = `spinner${state === 'done' ? ' done' : state === 'failed' ? ' failed' : ''}`;
  $('#authModalStatus').textContent = message;
}

function authFailureDetail(output) {
  const lines = String(output || '').split('\n').map(line => line.trim()).filter(line => {
    if (!line) return false;
    if (/^Preparing Microsoft sign-in/i.test(line)) return false;
    if (/^Starting (Java|Bedrock) sign-in/i.test(line)) return false;
    if (/^Signing in Java first/i.test(line)) return false;
    return true;
  });
  const marked = lines.filter(line => /RuntimeError:|Login failed:|Could not start a fresh sign-in|already has a sign-in/i.test(line));
  return (marked.pop() || lines.pop() || '').replace(/^(?:RuntimeError|Login failed):\s*/, '');
}

function markAuthModalFailed(reason) {
  const isI18n = typeof i18n !== 'undefined';
  const link = $('#authModalLink');
  link.removeAttribute('href');
  link.classList.add('disabled');
  link.setAttribute('aria-disabled', 'true');
  link.textContent = isI18n ? i18n.t('auth_link_failed') : 'Sign-in did not finish';
  $('#authModalCode').textContent = '—';
  $('#authModalCopy').disabled = true;
  $('#authSwitchEditionBtn').disabled = false;
  setAuthModalState('failed', reason);
}

function hideAuthModal() {
  if ($('#authModal').classList.contains('hidden')) return;
  $('#authModal').classList.add('hidden');
  clearInterval(app.timer);
  app.currentTask = null;
  const attempt = app.authAttempt;
  if (attempt) {
    attempt.closing = true;
    if (attempt.taskId) {
      cancelInProgressAuth(attempt.slot, attempt.taskId).finally(() => {
        if (app.authAttempt === attempt) app.authAttempt = null;
        refreshStatus(true);
      });
    } else if (!attempt.requestPending) {
      app.authAttempt = null;
      refreshStatus(true);
    }
  }
}

async function cancelInProgressAuth(slot, taskId) {
  if (!slot || !taskId) return;
  try {
    const result = await runTaskAndWait('cancel_auth', {slot, task_id: taskId});
    if (result.state !== 'succeeded') throw new Error(authFailureDetail(result.output) || 'Could not cancel sign-in.');
  } catch (error) {
    showAlert(`Sign-in cancellation could not be confirmed: ${error.message}`, true);
  }
}

$$('[data-auth-edition]').forEach(button => button.addEventListener('click', () => {
  startAction('open_auth', {slot: app.authSlot, edition: button.dataset.authEdition});
}));
$('#authSwitchEditionBtn')?.addEventListener('click', () => {
  showAuthEditionStage(app.authSlot || app.selectedSlot);
});
$('#authSwitchPromptBtn')?.addEventListener('click', () => {
  const btn = $('#authSwitchPromptBtn');
  if (btn?.dataset?.action === 'open-bedrock-help' || btn?.dataset?.action === 'go-to-guide') {
    showBedrockHelpModal();
    return;
  }
  const target = btn?.dataset?.targetEdition || (app.authEdition === 'bedrock' ? 'java' : 'bedrock');
  startAction('open_auth', {slot: app.authSlot || app.selectedSlot, edition: target});
});
$('#authModalClose').addEventListener('click', hideAuthModal);
$('#authModal').addEventListener('click', event => { if (event.target === event.currentTarget) hideAuthModal(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('#authModal').classList.contains('hidden')) hideAuthModal(); });
$('#authModalLink').addEventListener('click', event => { if (event.currentTarget.getAttribute('aria-disabled') === 'true') event.preventDefault(); });
$('#authModalCopy').addEventListener('click', async () => {
  const code = $('#authModalCode').textContent;
  const isI18n = typeof i18n !== 'undefined';
  const copiedText = isI18n ? i18n.t('auth_copied_btn') : 'Copied';
  const copyText = isI18n ? i18n.t('auth_copy_btn') : 'Copy';
  try { await navigator.clipboard.writeText(code); $('#authModalCopy').textContent = copiedText; setTimeout(() => { $('#authModalCopy').textContent = copyText; }, 1500); } catch {}
});

async function runTaskAndWait(action, payload) {
  await ensureToken();
  const data = await api('/api/actions', { method: 'POST', headers: {'Content-Type': 'application/json', 'X-Control-Token': app.token}, body: JSON.stringify({action, ...payload}) });
  while (true) {
    const task = await api(`/api/tasks/${data.task.id}`);
    if (task.state !== 'running') return task;
    await new Promise(resolve => setTimeout(resolve, 350));
  }
}

function showPreStartModal(warnings, name, action) {
  const modal = $('#preStartModal');
  const title = $('#preStartTitle');
  const accountName = $('#preStartName');
  const warningsList = $('#preStartWarnings');
  const confirmButton = $('#preStartConfirm');
  if (!modal || !title || !accountName || !warningsList || !confirmButton) {
    app.pendingStart = null;
    showAlert(typeof i18n !== 'undefined' ? i18n.t('alert_files_out_of_sync') : 'The dashboard files are out of sync. Reload the page before starting this account.', true);
    return;
  }
  const isI18n = typeof i18n !== 'undefined';
  accountName.textContent = name;
  title.textContent = action === 'restart' ? (isI18n ? i18n.t('pre_start_title_restart') : 'Restart may disturb another session') : (isI18n ? i18n.t('pre_start_title') : 'Another session may be active');
  warningsList.innerHTML = warnings.map(warning => `<li><span aria-hidden="true">⚠</span><span>${escapeHtml(warning)}</span></li>`).join('');
  confirmButton.textContent = action === 'restart' ? (isI18n ? i18n.t('pre_start_confirm_restart') : 'Restart anyway') : (isI18n ? i18n.t('pre_start_confirm') : 'Start anyway');
  modal.classList.remove('hidden');
  confirmButton.focus();
}

function hidePreStartModal() {
  $('#preStartModal')?.classList.add('hidden');
  app.pendingStart = null;
}

$('#preStartClose')?.addEventListener('click', hidePreStartModal);
$('#preStartCancel')?.addEventListener('click', hidePreStartModal);
$('#preStartConfirm')?.addEventListener('click', () => {
  if (!app.pendingStart) return;
  const {action, slot} = app.pendingStart;
  hidePreStartModal();
  startAction(action, {slot, force: true});
});
$('#preStartModal')?.addEventListener('click', event => { if (event.target === event.currentTarget) hidePreStartModal(); });
document.addEventListener('keydown', event => {
  const modal = $('#preStartModal');
  if (event.key === 'Escape' && modal && !modal.classList.contains('hidden')) hidePreStartModal();
});

$$('[data-console-filter]').forEach(button => button.addEventListener('click', () => {
  app.consoleFilter = button.dataset.consoleFilter;
  try { localStorage.setItem(consoleFilterStorageKey(app.selectedSlot), app.consoleFilter); } catch {}
  renderActivityFeed($('#consoleOutput'), app.consoleLines);
  scrollConsoleToBottom($('#consoleOutput'));
}));

$('#consoleSource')?.addEventListener('change', event => {
  app.consoleFilter = event.currentTarget.value || 'conversation';
  try { localStorage.setItem(consoleFilterStorageKey(app.selectedSlot), app.consoleFilter); } catch {}
  renderActivityFeed($('#consoleOutput'), app.consoleLines);
  scrollConsoleToBottom($('#consoleOutput'));
});

$('#consoleSearch')?.addEventListener('input', event => {
  app.consoleSearch = event.currentTarget.value;
  renderActivityFeed($('#consoleOutput'), app.consoleLines);
});

$('#communicationInput').addEventListener('input', event => {
  $('#communicationCount').textContent = `${event.currentTarget.value.length}/100`;
  $('#communicationHint').className = '';
  $('#communicationHint').textContent = '';
  $('#communicationHint').hidden = true;
});
$('#communicationForm').addEventListener('submit', event => {
  event.preventDefault();
  const message = $('#communicationInput').value.trim();
  if (!message) { showAlert('Enter a chat message or slash command.', true); return; }
  if (message.toLowerCase() === '/clear') { clearConsole(); return; }
  if (app.currentTask) return;
  const mode = message.startsWith('/') ? 'command' : 'chat';
  const now = new Date();
  app.pendingCommunication = {slot: app.selectedSlot, mode, message, state: 'sending', time: now.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit'})};
  $('#communicationInput').value = '';
  $('#communicationInput').disabled = true;
  $('#communicationSend').disabled = true;
  $('#communicationForm').classList.add('sending');
  $('#communicationHint').className = '';
  $('#communicationHint').textContent = '';
  $('#communicationHint').hidden = true;
  $('#communicationCount').textContent = '0/100';
  renderActivityFeed($('#consoleOutput'), app.consoleLines);
  scrollConsoleToBottom($('#consoleOutput'));
  startAction('communicate', {slot: app.selectedSlot, mode, message});
});
function sendAltAction(actionName) {
  if (app.currentTask) return;
  const ready = Boolean(derived().selected?.communication_ready);
  if (!ready) return;
  const now = new Date();
  const displayMessage = actionName === 'use_item' ? '[ACTION] Use item (right-click)' : '[ACTION] Drop item';
  app.pendingCommunication = {
    slot: app.selectedSlot,
    mode: 'action',
    message: actionName,
    displayMessage,
    state: 'sending',
    time: now.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit'})
  };
  $('#communicationInput').disabled = true;
  $('#communicationSend').disabled = true;
  const useBtn = $('#useItemBtn');
  if (useBtn) useBtn.disabled = true;
  const dropBtn = $('#dropItemBtn');
  if (dropBtn) dropBtn.disabled = true;
  $('#communicationForm').classList.add('sending');
  $('#communicationHint').className = '';
  $('#communicationHint').textContent = '';
  $('#communicationHint').hidden = true;
  renderActivityFeed($('#consoleOutput'), app.consoleLines);
  scrollConsoleToBottom($('#consoleOutput'));
  startAction('communicate', {slot: app.selectedSlot, mode: 'action', message: actionName});
}

$('#setPrimaryAccount')?.addEventListener('click', makeSelectedAccountPrimary);

$('#useItemBtn')?.addEventListener('click', () => sendAltAction('use_item'));
$('#dropItemBtn')?.addEventListener('click', () => sendAltAction('drop_item'));

$$('.nav-item, .sidebar-subtle-btn').forEach(button => button.addEventListener('click', () => {
  $$('.nav-item, .sidebar-subtle-btn').forEach(x => x.classList.toggle('active', x === button));
  $$('.view').forEach(x => x.classList.toggle('active', x.id === `view-${button.dataset.view}`));
  setTopbarTitle(button.dataset.view);
  const onCalc = button.dataset.view === 'calculator';
  const chip = $('#rateChip');
  if (chip) chip.classList.toggle('hidden', !onCalc);
  const feeChip = $('#feeChip');
  if (feeChip) feeChip.classList.toggle('hidden', !onCalc);
  renderAccounts(app.remote, app.local);
  if (button.dataset.view === 'overview') {
    scrollConsoleToBottom($('#consoleOutput'));
    refreshConsole(true);
  }
  if (button.dataset.view === 'settings') bindSettingsTabs();
  history.replaceState(null, '', `#${button.dataset.view}`);
}));
$('#closeDrawer').addEventListener('click', () => { $('#taskDrawer').classList.remove('open'); $('#taskDrawer').setAttribute('aria-hidden', 'true'); });
$('#settingsForm').addEventListener('submit', event => { event.preventDefault(); $('#settingsSaveBtn').click(); });
$('#settingsSaveBtn').addEventListener('click', () => {
  if (app.savingSettings) return;
  const activeTab = $$('.settings-tab').find(t => t.classList.contains('active'));
  const target = activeTab?.dataset.tab;
  const saveBtn = $('#settingsSaveBtn');
  const msgEl = $('#settingsMessage');
  const isI18n = typeof i18n !== 'undefined';

  if (target === 'account') {
    if (!(app.remote?.accounts || []).some(account => account.slot === app.accountSettingsSlot && account.authenticated && account.name)) {
      showAlert('Add an account before saving account settings.', true);
      return;
    }
    const slot = app.accountSettingsSlot || app.selectedSlot || 1;
    const startup_command_enabled = $('#accountStartupToggle')?.checked ?? false;
    let startup_command = $('#accountStartupCommand')?.value.trim() || '/home alt';
    if (startup_command && !startup_command.startsWith('/')) {
      startup_command = '/' + startup_command;
      if ($('#accountStartupCommand')) $('#accountStartupCommand').value = startup_command;
    }
    const startup_delay = Number($('#accountStartupDelay')?.value) || 5;
    const tpa_auto_accept = $('#accountTpaToggle')?.checked ?? false;

    const addInput = $('#tpaAddInput');
    if (addInput && addInput.value.trim()) {
      const pending = addInput.value.trim();
      if (addWhitelistPlayer(pending)) {
        addInput.value = '';
      }
    }

    syncWhitelistHiddenInput();
    const tpa_whitelist = $('#accountTpaWhitelist')?.value.trim() || '';
    const purpose = $('#accountPurposeInput')?.value.trim() || '';
    const sync_all_accounts = $('#accountTpaSyncAllToggle')?.checked ?? false;

    app.savingSettings = true;
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = isI18n ? i18n.t('settings_saving_btn') : 'Saving…';
    }
    if (msgEl) {
      msgEl.textContent = isI18n ? i18n.t('settings_saving_btn') : 'Saving settings…';
      msgEl.className = 'settings-status-saving';
    }

    const acc = (app.remote?.accounts || []).find(a => a.slot === slot);
    if (acc) {
      acc.settings = {
        ...(acc.settings || {}),
        startup_command_enabled,
        startup_command,
        startup_delay,
        tpa_auto_accept,
        tpa_whitelist,
        purpose,
      };
    }
    if (sync_all_accounts && Array.isArray(app.remote?.accounts)) {
      for (const a of app.remote.accounts) {
        if (a && a.settings) {
          a.settings.tpa_auto_accept = tpa_auto_accept;
          a.settings.tpa_whitelist = tpa_whitelist;
        }
      }
    }

    startAction('save_account_settings', {
      slot,
      startup_command_enabled,
      startup_command,
      startup_delay,
      tpa_auto_accept,
      tpa_whitelist,
      purpose,
      sync_all_accounts,
    });
  } else {
    app.savingSettings = true;
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = isI18n ? i18n.t('settings_saving_btn') : 'Saving…';
    }
    if (msgEl) {
      msgEl.textContent = isI18n ? i18n.t('settings_saving_btn') : 'Saving settings…';
      msgEl.className = 'settings-status-saving';
    }
    startAction('save_settings', Object.fromEntries(new FormData($('#settingsForm'))));
  }
});
$('#overviewAccountSettingsBtn')?.addEventListener('click', () => {
  app.accountSettingsSlot = app.selectedSlot;
  const settingsNavBtn = $('.nav-item[data-view="settings"]');
  if (settingsNavBtn) settingsNavBtn.click();
  activateSettingsTab('account');
});
$('#accountStartupToggle')?.addEventListener('change', event => {
  $('#startupCommandFields')?.classList.toggle('disabled', !event.currentTarget.checked);
});
$('#accountTpaToggle')?.addEventListener('change', event => {
  $('#tpaWhitelistContainer')?.classList.toggle('disabled', !event.currentTarget.checked);
  $('#tpaWhitelistFields')?.classList.toggle('disabled', !event.currentTarget.checked);
});
$('#tpaAddBtn')?.addEventListener('click', () => addWhitelistPlayerFromInput());
$('#tpaAddInput')?.addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    event.preventDefault();
    addWhitelistPlayerFromInput();
  }
});
$('#changePasswordButton').addEventListener('click', () => {
  const password = $('#newPasswordInput').value;
  const confirmation = $('#confirmPasswordInput').value;
  if (password.length < 12) { showAlert('Use at least 12 characters for the control password.', true); return; }
  if (password !== confirmation) { showAlert('The password confirmation does not match.', true); return; }
  startAction('change_password', {new_password: password, confirm_password: confirmation});
});
$('#addAccountButton').addEventListener('click', event => {
  const slot = Number(event.currentTarget.dataset.nextSlot);
  if (!slot) return;
  startAction('open_auth', {slot});
});
bindAccountContextMenu();
bindActionButtons();
bindVotingEvents();

/* Voting Module */
const DEFAULT_VOTE_SITES = [
  {
    id: 'minecraft_buzz',
    name: 'Minecraft.Buzz',
    url: 'https://minecraft.buzz/vote/complex-gaming?utm_source=chatgpt.com',
    durationHours: 24
  },
  {
    id: 'minecraftservers_org',
    name: 'MinecraftServers.org',
    url: 'https://minecraftservers.org/vote/467177?utm_source=chatgpt.com',
    durationHours: 18
  },
  {
    id: 'topminecraftservers_org',
    name: 'TopMinecraftServers.org',
    url: 'https://topminecraftservers.org/vote/2515?utm_source=chatgpt.com',
    durationHours: 24
  },
  {
    id: 'minecraft_server_list',
    name: 'Minecraft-Server-List',
    url: 'https://minecraft-server-list.com/server/411920/vote/?utm_source=chatgpt.com',
    durationHours: 18
  },
  {
    id: 'minecraft_mp',
    name: 'Minecraft-MP.com',
    url: 'https://minecraft-mp.com/server/179012/vote/?utm_source=chatgpt.com',
    durationHours: 24
  },
  {
    id: 'play_minecraft_servers',
    name: 'Play-Minecraft-Servers',
    url: 'https://play-minecraft-servers.com/minecraft-servers/complex-gaming/?tab=vote&utm_source=chatgpt.com',
    durationHours: 18
  },
  {
    id: 'minecraftpocket_servers',
    name: 'MinecraftPocket-Servers',
    url: 'https://minecraftpocket-servers.com/server/120962/vote/?utm_source=chatgpt.com',
    durationHours: 24
  },
  {
    id: 'curseforge_servers',
    name: 'CurseForge Servers',
    url: 'https://www.curseforge.com/servers/minecraft/game/complex-gaming/vote?utm_source=chatgpt.com',
    durationHours: 24
  }
];

function loadCustomSiteDurations() {
  try {
    const raw = localStorage.getItem('afk-voting-site-durations-v1');
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveCustomSiteDurations(durations) {
  try {
    localStorage.setItem('afk-voting-site-durations-v1', JSON.stringify(durations));
  } catch {}
}

function getVoteSites() {
  const customDurations = loadCustomSiteDurations();
  return DEFAULT_VOTE_SITES.map(site => {
    const customHours = customDurations[site.id];
    const durationHours = typeof customHours === 'number' && customHours > 0 ? customHours : site.durationHours;
    return {
      ...site,
      durationHours,
      durationMs: durationHours * 60 * 60 * 1000,
      ruleLabel: `${durationHours}h cooldown`
    };
  });
}

function parseUserInputTime(input) {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const timeOfDayMatch = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (timeOfDayMatch && (timeOfDayMatch[4] || (!trimmed.includes('h') && !trimmed.includes('m')))) {
    let hours = parseInt(timeOfDayMatch[1], 10);
    const mins = parseInt(timeOfDayMatch[2], 10);
    const secs = timeOfDayMatch[3] ? parseInt(timeOfDayMatch[3], 10) : 0;
    const ampm = timeOfDayMatch[4]?.toLowerCase();
    if (ampm === 'pm' && hours < 12) hours += 12;
    if (ampm === 'am' && hours === 12) hours = 0;
    if (hours >= 0 && hours < 24 && mins >= 0 && mins < 60) {
      const d = new Date();
      d.setHours(hours, mins, secs, 0);
      if (d.getTime() > Date.now()) {
        d.setDate(d.getDate() - 1);
      }
      return {
        type: 'voted_at',
        timestamp: d.getTime(),
        label: `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
      };
    }
  }

  let totalMs = 0;
  let hasDurationMatch = false;
  const hMatch = trimmed.match(/(\d+(?:\.\d+)?)\s*h(?:ours?)?/i);
  const mMatch = trimmed.match(/(\d+(?:\.\d+)?)\s*m(?:in(?:ute)?s?)?/i);
  const sMatch = trimmed.match(/(\d+(?:\.\d+)?)\s*s(?:ec(?:ond)?s?)?/i);

  if (hMatch || mMatch || sMatch) {
    hasDurationMatch = true;
    if (hMatch) totalMs += parseFloat(hMatch[1]) * 3600 * 1000;
    if (mMatch) totalMs += parseFloat(mMatch[1]) * 60 * 1000;
    if (sMatch) totalMs += parseFloat(sMatch[1]) * 1000;
  } else if (!isNaN(parseFloat(trimmed))) {
    hasDurationMatch = true;
    totalMs = parseFloat(trimmed) * 3600 * 1000;
  }

  if (hasDurationMatch && totalMs > 0 && totalMs <= 72 * 3600 * 1000) {
    return {
      type: 'remaining',
      remainingMs: totalMs,
      hours: totalMs / (3600 * 1000)
    };
  }

  return null;
}

const VOTING_PLAYERS = ['jeremy'];

function loadVotingState() {
  try {
    const raw = localStorage.getItem('afk-voting-state-v1');
    if (!raw) return { jeremy: {} };
    const parsed = JSON.parse(raw);
    return {
      jeremy: parsed?.jeremy && typeof parsed.jeremy === 'object' ? parsed.jeremy : {}
    };
  } catch {
    return { jeremy: {} };
  }
}

function saveVotingState(state) {
  try {
    localStorage.setItem('afk-voting-state-v1', JSON.stringify(state));
  } catch {}
}

function getSiteVoteStatus(site, lastVotedAt, now = Date.now()) {
  if (!lastVotedAt || typeof lastVotedAt !== 'number') {
    return { isReady: true, remainingMs: 0, progress: 100, label: 'Ready now' };
  }

  const duration = site.durationMs || (24 * 60 * 60 * 1000);
  const expiresAt = lastVotedAt + duration;
  const remainingMs = Math.max(0, expiresAt - now);
  if (remainingMs <= 0) {
    return { isReady: true, remainingMs: 0, progress: 100, label: 'Ready now' };
  }
  const progress = Math.min(100, Math.max(0, ((duration - remainingMs) / duration) * 100));
  return { isReady: false, remainingMs, progress, label: formatHms(remainingMs) };
}

function formatHms(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
}

function showVotingNotice(message, undoAction = null) {
  const banner = $('#votingNotice');
  if (!banner) return;
  banner.className = 'alert';
  if (undoAction) {
    banner.innerHTML = `<span>${escapeHtml(message)}</span> <button type="button" id="votingNoticeUndo" class="text-button">Undo</button>`;
    const undoBtn = $('#votingNoticeUndo');
    if (undoBtn) undoBtn.addEventListener('click', () => {
      undoAction();
      banner.classList.add('hidden');
    });
  } else {
    banner.textContent = message;
  }
  banner.classList.remove('hidden');
  clearTimeout(banner._timeout);
  banner._timeout = setTimeout(() => { banner.classList.add('hidden'); }, 8000);
}

const PLAYER_IGNS = {
  jeremy: 'Jlorenzoo'
};

function isPlayerAlertEnabled(player) {
  try {
    const raw = localStorage.getItem('afk-voting-player-alerts-v1');
    if (!raw) return player.toLowerCase() === 'jeremy';
    const parsed = JSON.parse(raw);
    return parsed[player.toLowerCase()] === true;
  } catch {
    return player.toLowerCase() === 'jeremy';
  }
}

function setPlayerAlertEnabled(player, enabled) {
  try {
    let alerts = {};
    const raw = localStorage.getItem('afk-voting-player-alerts-v1');
    if (raw) alerts = JSON.parse(raw) || {};
    alerts[player.toLowerCase()] = enabled;
    localStorage.setItem('afk-voting-player-alerts-v1', JSON.stringify(alerts));
  } catch {}
}

function updateVotingAvatars() {
  const jeremyImg = $('#jeremyAvatarImg');
  if (jeremyImg) jeremyImg.src = avatarUrl('Jlorenzoo', 34);
}

function renderVotingSection(player, state, now = Date.now()) {
  const container = $(`#votingCards${player.charAt(0).toUpperCase() + player.slice(1)}`);
  const voteSites = getVoteSites();
  if (!container) return { readyCount: 0, total: voteSites.length };

  const playerState = state[player] || {};
  let readyCount = 0;
  const isI18n = typeof i18n !== 'undefined';
  const readyLabel = isI18n ? i18n.t('voting_site_ready') : 'Ready';
  const voteLabel = isI18n ? i18n.t('voting_site_vote') : 'Vote';

  const html = voteSites.map((site, index) => {
    const lastVotedAt = playerState[site.id]?.lastVotedAt;
    const status = getSiteVoteStatus(site, lastVotedAt, now);
    if (status.isReady) readyCount += 1;

    const progressWidth = status.isReady ? 100 : Math.round(status.progress);
    const voteNum = index + 1;

    return `
      <div class="voting-card ${status.isReady ? 'is-ready' : 'is-cooling'}" data-site-card="${site.id}">
        <div class="voting-card-left">
          <span class="voting-num">${voteNum}</span>
          <a href="${site.url}" target="_blank" rel="noopener noreferrer" class="voting-site-link" data-vote-action="vote" data-player="${player}" data-site-id="${site.id}" title="Open ${escapeHtml(site.name)} and start timer">
            <span class="voting-site-name">${escapeHtml(site.name)}</span>
            <svg class="external-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>
          </a>
          <button type="button" class="voting-rule-tag" data-edit-site-cooldown="${site.id}" title="Cooldown: ${site.durationHours}h (click to edit)">
            ${site.durationHours}h
          </button>
        </div>

        <div class="voting-card-center">
          ${status.isReady ? `
            <div class="voting-ready-pill">
              <span class="voting-state-dot ready"></span>
              <span>${readyLabel}</span>
            </div>
          ` : `
            <div class="voting-timer-group">
              <div class="voting-timer-readout">
                <span class="voting-state-dot cooling"></span>
                <strong class="voting-timer-val">${escapeHtml(status.label)}</strong>
              </div>
              <div class="voting-progress-track" aria-hidden="true">
                <div class="voting-progress-fill cooling" data-progress="${progressWidth}"></div>
              </div>
            </div>
          `}
        </div>

        <div class="voting-card-right">
          ${status.isReady ? `
            <a href="${site.url}" target="_blank" rel="noopener noreferrer" class="voting-vote-btn" data-vote-action="vote" data-player="${player}" data-site-id="${site.id}" title="Open site & record vote">
              <span>${voteLabel}</span>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M5 13h11.86l-5.43 5.43 1.42 1.42L21.14 12l-8.29-8.29-1.42 1.42L16.86 11H5v2z"/></svg>
            </a>
            <button type="button" class="voting-ghost-btn voting-hover-ghost" data-vote-action="mark" data-player="${player}" data-site-id="${site.id}" title="Mark as voted now without opening link">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>
            </button>
          ` : `
            <div class="voting-row-actions">
              <button type="button" class="voting-ghost-btn" data-vote-action="mark" data-player="${player}" data-site-id="${site.id}" title="Mark as voted now">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>
              </button>
              <button type="button" class="voting-ghost-btn" data-vote-action="adjust" data-player="${player}" data-site-id="${site.id}" title="Calibrate timer or set vote time">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>
              </button>
              <button type="button" class="voting-ghost-btn" data-vote-action="reset" data-player="${player}" data-site-id="${site.id}" title="Reset timer to ready">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
              </button>
            </div>
          `}
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = html;
  container.querySelectorAll('.voting-progress-fill[data-progress]').forEach(el => {
    el.style.width = `${el.dataset.progress}%`;
  });

  const badge = $(`#${player}VoteBadge`);
  if (badge) {
    badge.textContent = isI18n ? i18n.t('voting_status_ready', { count: readyCount }) : `${readyCount}/${voteSites.length} ready`;
    badge.classList.toggle('has-ready', readyCount > 0);
  }

  return { readyCount, total: voteSites.length };
}

const prevVotingStatuses = {};

function playVoteChime() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime);
    osc.frequency.setValueAtTime(880.00, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.46);
  } catch {}
}

function sendVoteAlert(player, siteName) {
  if (!isPlayerAlertEnabled(player)) return;
  const ign = PLAYER_IGNS[player.toLowerCase()] || (player.charAt(0).toUpperCase() + player.slice(1));
  const title = `🔔 Vote Ready: ${ign}`;
  const body = `${ign} is ready to vote on ${siteName}!`;

  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(title, { body, icon: '/icon.svg' });
    } catch {}
  }

  if (localStorage.getItem('afk-voting-sound') !== 'false') {
    playVoteChime();
  }

  showVotingNotice(`🎉 Vote Ready: ${ign} can now vote on ${siteName}!`);
}

function updateVotingAlertsUI() {
  const notifyBtn = $('#votingNotifyBtn');
  const notifyLabel = $('#votingNotifyLabel');
  const soundBtn = $('#votingSoundBtn');
  const soundLabel = $('#votingSoundLabel');
  const isI18n = typeof i18n !== 'undefined';

  if (notifyBtn && notifyLabel) {
    const hasNotification = 'Notification' in window;
    const permission = hasNotification ? Notification.permission : 'denied';
    const active = permission === 'granted';
    notifyBtn.classList.toggle('active', active);
    notifyLabel.textContent = active
      ? (isI18n ? i18n.t('voting_notify_on') : 'Alerts: On')
      : (permission === 'denied' ? (isI18n ? i18n.t('voting_notify_blocked') : 'Alerts: Blocked') : (isI18n ? i18n.t('voting_notify_off') : 'Alerts: Off'));
  }

  if (soundBtn && soundLabel) {
    const soundOn = localStorage.getItem('afk-voting-sound') !== 'false';
    soundBtn.classList.toggle('active', soundOn);
    soundLabel.textContent = soundOn
      ? (isI18n ? i18n.t('voting_sound_on') : 'Sound: On')
      : (isI18n ? i18n.t('voting_sound_off') : 'Sound: Off');
  }

  for (const player of VOTING_PLAYERS) {
    const btn = $(`#${player}AlertToggleBtn`);
    if (btn) {
      const enabled = isPlayerAlertEnabled(player);
      btn.classList.toggle('active', enabled);
      const ign = PLAYER_IGNS[player] || player;
      btn.title = `Toggle alerts for ${ign} (Currently ${enabled ? 'On' : 'Off'})`;
    }
  }
}

function renderVoting() {
  const state = loadVotingState();
  const now = Date.now();
  const voteSites = getVoteSites();

  for (const player of VOTING_PLAYERS) {
    renderVotingSection(player, state, now);

    for (const site of voteSites) {
      const lastVotedAt = state[player]?.[site.id]?.lastVotedAt;
      const status = getSiteVoteStatus(site, lastVotedAt, now);
      const key = `${player}:${site.id}`;
      if (prevVotingStatuses[key] === false && status.isReady) {
        sendVoteAlert(player, site.name);
      }
      prevVotingStatuses[key] = !status.isReady ? false : true;
    }
  }

  updateVotingAlertsUI();
}

function bindVotingEvents() {
  $$('.voting-player-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.voting-player-tab').forEach(b => {
        const isActive = b === btn;
        b.classList.toggle('active', isActive);
        b.setAttribute('aria-selected', String(isActive));
      });
      const filter = btn.dataset.votingFilter;
      const grid = $('#votingGrid');
      if (grid) {
        grid.className = 'voting-grid';
        if (filter === 'jeremy') grid.classList.add('single-jeremy');
        else if (filter === 'jason') grid.classList.add('single-jason');
      }
    });
  });

  const notifyBtn = $('#votingNotifyBtn');
  if (notifyBtn) {
    notifyBtn.addEventListener('click', async () => {
      if (!('Notification' in window)) {
        showAlert('Desktop notifications are not supported in this browser.', true);
        return;
      }
      if (Notification.permission === 'default') {
        const res = await Notification.requestPermission();
        updateVotingAlertsUI();
        if (res === 'granted') {
          new Notification('ALT Pilot Voting Alerts', {
            body: 'Voting alerts are now enabled! We will notify you when timers complete.',
            icon: '/icon.svg'
          });
          showVotingNotice('Desktop notifications enabled!');
        }
      } else if (Notification.permission === 'denied') {
        alert('Notifications are blocked in your browser site permissions. Please allow notifications for this site to receive desktop alerts.');
      } else {
        showVotingNotice('Desktop notifications are active and enabled.');
      }
    });
  }

  const soundBtn = $('#votingSoundBtn');
  if (soundBtn) {
    soundBtn.addEventListener('click', () => {
      const current = localStorage.getItem('afk-voting-sound') !== 'false';
      const next = !current;
      localStorage.setItem('afk-voting-sound', String(next));
      updateVotingAlertsUI();
      if (next) playVoteChime();
      showVotingNotice(`Audio alert chime ${next ? 'enabled' : 'disabled'}.`);
    });
  }

  const testAlertBtn = $('#votingTestAlertBtn');
  if (testAlertBtn) {
    testAlertBtn.addEventListener('click', () => {
      sendVoteAlert('Jeremy', 'Minecraft.Buzz');
    });
  }

  const container = $('#view-voting');
  if (!container) return;

  container.addEventListener('click', event => {
    const editTag = event.target.closest('[data-edit-site-cooldown]');
    if (editTag) {
      const siteId = editTag.dataset.editSiteCooldown;
      const sites = getVoteSites();
      const site = sites.find(s => s.id === siteId);
      const currentHours = site?.durationHours || 24;
      const input = prompt(
        `Edit cooldown length for ${site?.name}:\n\n` +
        `Enter the cooldown duration in hours (e.g. 18, 24, 12, 20):`,
        String(currentHours)
      );
      if (input === null) return;
      const hours = parseFloat(input.trim());
      if (!isNaN(hours) && hours > 0 && hours <= 168) {
        const customDurations = loadCustomSiteDurations();
        customDurations[siteId] = hours;
        saveCustomSiteDurations(customDurations);
        renderVoting();
        showVotingNotice(`Updated ${site?.name} cooldown duration to ${hours}h.`);
      } else {
        alert('Invalid duration. Please enter a positive number of hours (e.g. 18).');
      }
      return;
    }

    const voteLink = event.target.closest('[data-vote-action="vote"]');
    if (voteLink) {
      const player = voteLink.dataset.player;
      const siteId = voteLink.dataset.siteId;
      const sites = getVoteSites();
      const site = sites.find(s => s.id === siteId);
      const state = loadVotingState();
      const prev = state[player]?.[siteId];
      if (!state[player]) state[player] = {};
      state[player][siteId] = { lastVotedAt: Date.now() };
      saveVotingState(state);
      renderVoting();
      const playerName = player.charAt(0).toUpperCase() + player.slice(1);
      showVotingNotice(`Started timer for ${playerName} on ${site?.name || 'voting site'}.`, () => {
        const current = loadVotingState();
        if (prev) current[player][siteId] = prev;
        else delete current[player]?.[siteId];
        saveVotingState(current);
        renderVoting();
      });
      return;
    }

    const markBtn = event.target.closest('[data-vote-action="mark"]');
    if (markBtn) {
      const player = markBtn.dataset.player;
      const siteId = markBtn.dataset.siteId;
      const sites = getVoteSites();
      const site = sites.find(s => s.id === siteId);
      const state = loadVotingState();
      const prev = state[player]?.[siteId];
      if (!state[player]) state[player] = {};
      state[player][siteId] = { lastVotedAt: Date.now() };
      saveVotingState(state);
      renderVoting();
      const playerName = player.charAt(0).toUpperCase() + player.slice(1);
      showVotingNotice(`Marked ${site?.name || 'site'} as voted for ${playerName}.`, () => {
        const current = loadVotingState();
        if (prev) current[player][siteId] = prev;
        else delete current[player]?.[siteId];
        saveVotingState(current);
        renderVoting();
      });
      return;
    }

    const playerAlertBtn = event.target.closest('[data-toggle-player-alert]');
    if (playerAlertBtn) {
      const player = playerAlertBtn.dataset.togglePlayerAlert;
      const next = !isPlayerAlertEnabled(player);
      setPlayerAlertEnabled(player, next);
      updateVotingAlertsUI();
      const ign = PLAYER_IGNS[player] || player;
      showVotingNotice(`Alerts for ${ign} ${next ? 'enabled' : 'disabled'}.`);
      return;
    }

    const adjustBtn = event.target.closest('[data-vote-action="adjust"]');
    if (adjustBtn) {
      const player = adjustBtn.dataset.player;
      const siteId = adjustBtn.dataset.siteId;
      const sites = getVoteSites();
      const site = sites.find(s => s.id === siteId);
      const state = loadVotingState();
      const currentVoteTime = state[player]?.[siteId]?.lastVotedAt;
      const ign = PLAYER_IGNS[player] || player;
      const durationHours = site?.durationHours || 24;

      let promptMsg = `Smart Calibrator for ${ign} on ${site?.name} (Current cooldown: ${durationHours}h):\n\n`;
      if (currentVoteTime) {
        const elapsedMs = Math.max(0, Date.now() - currentVoteTime);
        promptMsg += `• Recorded vote time: ${new Date(currentVoteTime).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})} (${formatHms(elapsedMs)} ago)\n\n`;
      }
      promptMsg +=
        `Choose an action:\n` +
        `1. Enter remaining time from website (e.g. "10h 52m", "10:52", "10.5") to auto-learn & calibrate\n` +
        `2. OR enter the time you voted today (e.g. "06:09", "6:09 am")`;

      const answer = prompt(promptMsg, "06:09");
      if (answer === null) return;
      const parsed = parseUserInputTime(answer);
      if (!parsed) {
        alert('Invalid time format. Please enter remaining time (e.g. 10h 52m) or vote time (e.g. 06:09).');
        return;
      }

      if (parsed.type === 'voted_at') {
        if (!state[player]) state[player] = {};
        state[player][siteId] = { lastVotedAt: parsed.timestamp };
        saveVotingState(state);
        renderVoting();
        showVotingNotice(`Set vote time to ${parsed.label} for ${ign} on ${site?.name}.`);
      } else if (parsed.type === 'remaining') {
        let learnedCooldownHours = durationHours;
        if (currentVoteTime) {
          const elapsedMs = Math.max(0, Date.now() - currentVoteTime);
          const totalCycleMs = elapsedMs + parsed.remainingMs;
          const cycleHours = totalCycleMs / (3600 * 1000);
          const roundedCycle = Math.round(cycleHours * 10) / 10;

          const confirmMsg =
            `Auto-Calibration Insights:\n\n` +
            `• Elapsed since vote (${new Date(currentVoteTime).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}): ${formatHms(elapsedMs)}\n` +
            `• Website remaining time: ${formatHms(parsed.remainingMs)}\n` +
            `• Calculated Total Cycle: ~${roundedCycle}h\n\n` +
            `Update ${site?.name} cooldown duration to ${roundedCycle}h?`;

          if (confirm(confirmMsg)) {
            learnedCooldownHours = roundedCycle;
            const customDurations = loadCustomSiteDurations();
            customDurations[siteId] = roundedCycle;
            saveCustomSiteDurations(customDurations);
          }
        }

        const calculatedVoteTimestamp = Date.now() + parsed.remainingMs - (learnedCooldownHours * 3600 * 1000);
        if (!state[player]) state[player] = {};
        state[player][siteId] = { lastVotedAt: calculatedVoteTimestamp };
        saveVotingState(state);
        renderVoting();
        showVotingNotice(`Calibrated ${site?.name} for ${ign}: ${formatHms(parsed.remainingMs)} remaining (${learnedCooldownHours}h cooldown).`);
      }
      return;
    }

    const resetBtn = event.target.closest('[data-vote-action="reset"]');
    if (resetBtn) {
      const player = resetBtn.dataset.player;
      const siteId = resetBtn.dataset.siteId;
      const sites = getVoteSites();
      const site = sites.find(s => s.id === siteId);
      const state = loadVotingState();
      if (state[player]?.[siteId]) {
        delete state[player][siteId];
        saveVotingState(state);
        renderVoting();
        const ign = PLAYER_IGNS[player] || player;
        showVotingNotice(`Reset timer for ${ign} on ${site?.name || 'site'}.`);
      }
      return;
    }

    const batchBtn = event.target.closest('[data-batch-action]');
    if (batchBtn) {
      const action = batchBtn.dataset.batchAction;
      const player = batchBtn.dataset.player;
      const state = loadVotingState();
      const sites = getVoteSites();
      const ign = PLAYER_IGNS[player] || player;

      if (action === 'mark_all') {
        const now = Date.now();
        if (!state[player]) state[player] = {};
        for (const site of sites) {
          state[player][site.id] = { lastVotedAt: now };
        }
        saveVotingState(state);
        renderVoting();
        showVotingNotice(`Marked all ${sites.length} voting sites as voted for ${ign}.`);
      } else if (action === 'reset_all') {
        if (state[player]) {
          state[player] = {};
          saveVotingState(state);
          renderVoting();
          showVotingNotice(`Reset all timers for ${ign} to ready.`);
        }
      } else if (action === 'set_vote_time') {
        const answer = prompt(
          `Set vote time for all ${sites.length} sites for ${ign}:\n\n` +
          `Enter the time you voted today (e.g. "06:09", "6:09 am", "7:30"):`,
          "06:09"
        );
        if (answer === null) return;
        const parsed = parseUserInputTime(answer);
        if (parsed && parsed.type === 'voted_at') {
          if (!state[player]) state[player] = {};
          for (const site of sites) {
            state[player][site.id] = { lastVotedAt: parsed.timestamp };
          }
          saveVotingState(state);
          renderVoting();
          showVotingNotice(`Anchored all voting timers to ${parsed.label} for ${ign}.`);
        } else {
          alert('Invalid time format. Please enter a valid time of day (e.g. 06:09 or 6:09 am).');
        }
      }
    }
  });
}

function showBedrockHelpModal() {
  const modal = $('#bedrockHelpModal');
  if (!modal) return;
  modal.classList.remove('hidden');
  $('.auth-modal-card', modal)?.focus();
}

function hideBedrockHelpModal() {
  const modal = $('#bedrockHelpModal');
  if (modal) modal.classList.add('hidden');
}

function selectEmptySlotForGuide() {
  const accts = (app.remote?.accounts || []).filter(a => a.authenticated && a.name);
  const max = Number(app.remote?.max_accounts || 8);
  const empty = Array.from({length: max}, (_, i) => i + 1).find(s => !accts.some(a => a.slot === s));
  return empty || null;
}

function openSetupForNewAccount() {
  const slot = selectEmptySlotForGuide();
  if (!slot) {
    showAlert('The account limit is reached. Sign out an account first.', true);
    return;
  }
  startAction('open_auth', {slot});
}

function bindBedrockHelpEvents() {
  $('#bedrockHelpClose')?.addEventListener('click', hideBedrockHelpModal);
  $('#bedrockHelpDismiss')?.addEventListener('click', hideBedrockHelpModal);
  $('#bedrockHelpModal')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) hideBedrockHelpModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#bedrockHelpModal')?.classList.contains('hidden')) {
      hideBedrockHelpModal();
    }
  });

  document.addEventListener('click', (e) => {
    const setupTarget = e.target.closest('[data-action="go-to-setup"]');
    if (setupTarget) {
      hideBedrockHelpModal();
      openSetupForNewAccount();
      return;
    }
    const guideActionTarget = e.target.closest('[data-action="go-to-guide"], [data-action="open-bedrock-help"]');
    if (guideActionTarget) {
      e.preventDefault();
      showBedrockHelpModal();
      return;
    }
    const wizardGuideTarget = e.target.closest('#wizardGuideLink');
    if (wizardGuideTarget) {
      e.preventDefault();
      showBedrockHelpModal();
      return;
    }
    const authGuideTarget = e.target.closest('#authGuideLink');
    if (authGuideTarget) {
      e.preventDefault();
      showBedrockHelpModal();
      return;
    }
  });
}

function bindLanguageSwitcher() {
  document.addEventListener('click', event => {
    const btn = event.target.closest('.lang-btn');
    if (!btn) return;
    const lang = btn.dataset.lang;
    if (typeof i18n !== 'undefined' && i18n.setLang) i18n.setLang(lang);
  });
}

const initialView = location.hash.slice(1);
if (['setup','voting','settings','calculator','availability'].includes(initialView)) $(`[data-view="${initialView}"]`)?.click();
if (app.consoleLines.length) {
  renderActivityFeed($('#consoleOutput'), app.consoleLines);
  scrollConsoleToBottom($('#consoleOutput'));
}
bindLanguageSwitcher();
if (typeof i18n !== 'undefined') {
  i18n.applyTranslations(document);
  setTopbarTitle(app.view);
  i18n.onLangChange(() => {
    setTopbarTitle(app.view);
    render();
  });
}
bootstrap();
renderVoting();
bindBedrockHelpEvents();

for (const help of document.querySelectorAll('.console-help')) {
  help.addEventListener('mouseenter', () => { help.open = true; });
  help.addEventListener('mouseleave', () => { help.open = false; });
}

setInterval(() => {
  if (document.visibilityState !== 'visible') return;
  const hadOperation = Boolean(app.serviceOperation);
  reconcileServiceOperation(false);
  const fast = needsFastStatus();
  if ((!app.currentTask || fast) && Date.now() - app.lastStatusRefresh >= (fast ? 1500 : 20000)) refreshStatus(true);
  if (hadOperation) render();
}, 1000);
setInterval(() => {
  if (document.visibilityState === 'visible' && app.view === 'overview' &&
      Date.now() - app.lastConsoleRefresh >= (needsFastStatus() ? 2000 : 8000)) refreshConsole();
}, 1000);
setInterval(() => { if (document.visibilityState === 'visible') renderVoting(); }, 1000);

// --- IGM / GC profit calculator ---
// ponytail: rate is local-only — the trader is on one device and the rate changes every minute.
(function initCalculator() {
  const RATE_KEY = 'afk-calc-rate-igm-per-gc';
  const FEE_KEY = 'afk-calc-fee-mode';
  const fmt = (n, dp = 0) => {
    if (!Number.isFinite(n)) return '—';
    return (Math.round(n * Math.pow(10, dp)) / Math.pow(10, dp)).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  };
  // Compact display: 999 stays "999", 35625 becomes "35.6K", 3880000 "3.88M".
  // Only K and M — no hundreds abbreviations, no billions/trillions.
  const fmtShort = (n, dp) => {
    if (!Number.isFinite(n)) return '—';
    const sign = n < 0 ? '-' : '';
    const a = Math.abs(n);
    const trimZeros = (v, d) => {
      const s = v.toFixed(d);
      return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
    };
    if (a >= 999500) return `${sign}${trimZeros(a / 1000000, 2)}M`;
    if (a >= 1000) return `${sign}${trimZeros(a / 1000, 1)}K`;
    return `${sign}${fmt(a, dp === undefined ? 0 : dp)}`;
  };
  // Shorthand input: "210K" -> 210000, "2.1m" -> 2100000, plain numbers pass
  // through. Commas work as thousand separators ("2,100,000") or as a single
  // decimal comma ("2,1m"). Anything unparseable is 0 (treated as missing).
  const parseShorthand = (raw) => {
    if (raw === null || raw === undefined) return 0;
    let s = String(raw).trim().replace(/[\s_]/g, '');
    if (!s) return 0;
    let mult = 1;
    const suffix = s.slice(-1).toLowerCase();
    if (suffix === 'k' || suffix === 'm') {
      mult = suffix === 'k' ? 1000 : 1000000;
      s = s.slice(0, -1);
    }
    if (!s) return 0;
    if (s.includes('.') && s.includes(',')) {
      s = s.replace(/,/g, '');
    } else if (s.includes(',')) {
      s = (s.match(/,/g) || []).length > 1 ? s.replace(/,/g, '') : s.replace(',', '.');
    }
    if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(s)) return 0;
    const v = parseFloat(s) * mult;
    return Number.isFinite(v) ? v : 0;
  };
  const fmtIGM = (n) => `${fmtShort(n)} IGM`;
  const fmtGC = (n, dp) => `${fmtShort(n, dp === undefined ? (n % 1 ? 2 : 0) : dp)} GC`;
  const fmtAny = (n, cur) => cur === 'GC' ? fmtGC(n) : fmtIGM(n);
  const fmtSigned = (n, cur) => `${n > 0 ? '+' : n < 0 ? '-' : ''}${cur === 'GC' ? fmtGC(Math.abs(n)) : fmtIGM(Math.abs(n))}`;
  const t = (key, fallback) => (typeof i18n !== 'undefined' ? i18n.t(key) : fallback);

  const rateInput = $('#calcRate');
  const chip = $('#rateChip');
  const chipValue = $('#rateChipValue');
  const chipEdit = $('#rateChipEdit');
  const popover = $('#rateChipPopover');
  const savedEl = $('#calcRateSaved');
  const out = $('#calcResult');
  if (!rateInput || !chip || !out) return;

  const fields = {
    buyAmount: $('#calcBuyAmount'),
    buyCurrency: $('#calcBuyCurrency'),
    buyCustom: $('#calcBuyCustom'),
    sellAmount: $('#calcSellAmount'),
    sellCurrency: $('#calcSellCurrency'),
    sellCustom: $('#calcSellCustom'),
  };
  const buyUnitRadios = document.querySelectorAll('input[name="calcBuyUnit"]');
  const sellUnitRadios = document.querySelectorAll('input[name="calcSellUnit"]');
  const feeButtons = document.querySelectorAll('.calc-fee-opt');
  const buyLabel = document.querySelector('.calc-buy-currency-label');
  const sellLabel = document.querySelector('.calc-sell-currency-label');

  const getRate = () => { const v = parseShorthand(rateInput.value); return v > 0 ? v : 0; };
  const getUnit = (radios) => {
    for (const r of radios) if (r.checked) return r.value;
    return '1';
  };
  // Batch sizes before 1/16/64 replaced the old 'each'/'stack' wording.
  const normUnit = (u) => u === 'each' ? '1' : u === 'stack' ? '64' : (u || '1');
  let feePct = 2;
  const toIGM = (amount, currency, rate) => currency === 'GC' ? amount * rate : amount;
  const fromIGM = (igm, currency, rate) => (currency === 'GC' && rate > 0) ? igm / rate : igm;

  const isSunday = (d = new Date()) => d.getDay() === 0;

  const updateChip = () => {
    const r = getRate();
    chipValue.textContent = r ? fmtShort(r) : '—';
    document.querySelectorAll('.rate-preset').forEach(b => {
      b.classList.toggle('active', Number(b.dataset.preset) === r);
    });
  };
  const flashSaved = () => {
    if (!savedEl) return;
    savedEl.classList.add('show', 'visible');
    clearTimeout(flashSaved._t);
    flashSaved._t = setTimeout(() => savedEl.classList.remove('show', 'visible'), 1200);
  };
  const stored = (() => { try { return localStorage.getItem(RATE_KEY) || ''; } catch (_) { return ''; } })();
  if (stored) rateInput.value = stored;

  rateInput.addEventListener('input', () => {
    try { localStorage.setItem(RATE_KEY, String(parseShorthand(rateInput.value) || '')); } catch (_) {}
    flashSaved(); updateChip(); recalc();
  });
  document.querySelectorAll('.rate-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      rateInput.value = btn.dataset.preset;
      rateInput.dispatchEvent(new Event('input'));
    });
  });
  chipEdit.addEventListener('click', (e) => {
    e.stopPropagation();
    const wasHidden = popover.classList.contains('hidden');
    popover.classList.toggle('hidden');
    if (wasHidden) {
      const r = chipEdit.getBoundingClientRect();
      popover.style.top = `${Math.round(r.bottom + 8)}px`;
      popover.style.left = `${Math.max(8, Math.round(r.right - 240))}px`;
      rateInput.focus();
    }
  });
  const repositionPopover = () => {
    if (popover.classList.contains('hidden')) return;
    const r = chipEdit.getBoundingClientRect();
    popover.style.top = `${Math.round(r.bottom + 8)}px`;
    popover.style.left = `${Math.max(8, Math.round(r.right - 240))}px`;
  };
  window.addEventListener('resize', repositionPopover);
  window.addEventListener('scroll', repositionPopover, true);
  document.addEventListener('click', (e) => {
    if (!popover.classList.contains('hidden') && !popover.contains(e.target) && e.target !== chipEdit) {
      popover.classList.add('hidden');
    }
  });
  const syncChipVisibility = () => {
    const onCalc = app.view === 'calculator';
    chip.classList.toggle('hidden', !onCalc);
    const feeChip = $('#feeChip');
    if (feeChip) feeChip.classList.toggle('hidden', !onCalc);
  };

  // Currency toggle buttons live inside the inputs; the hidden <select>
  // elements stay in the DOM so the pricing logic keeps one source of truth.
  // NOTE: defined before applyFee/recalc run — recalc() calls syncLabels()
  // on every pass, including the initial applyFee() during init.
  const buyToggle = $('#calcBuyCurToggle');
  const sellToggle = $('#calcSellCurToggle');
  function syncLabels() {
    if (buyLabel) buyLabel.textContent = fields.buyCurrency.value;
    if (sellLabel) sellLabel.textContent = fields.sellCurrency.value;
    if (buyToggle) {
      buyToggle.textContent = fields.buyCurrency.value;
      buyToggle.setAttribute('aria-label', `Buy currency: ${fields.buyCurrency.value}. Activate to switch.`);
    }
    if (sellToggle) {
      sellToggle.textContent = fields.sellCurrency.value;
      sellToggle.setAttribute('aria-label', `Sell currency: ${fields.sellCurrency.value}. Activate to switch.`);
    }
  }
  const flipCurrency = (select) => {
    if (!select) return;
    select.value = select.value === 'IGM' ? 'GC' : 'IGM';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    syncLabels();
    recalc();
  };
  if (buyToggle) buyToggle.addEventListener('click', () => flipCurrency(fields.buyCurrency));
  if (sellToggle) sellToggle.addEventListener('click', () => flipCurrency(fields.sellCurrency));

  // AH fee pill toggle (2% / 0%) — default 2%, auto-suggest 0% on Sundays.
  const applyFee = (pct, persist) => {
    feePct = pct;
    feeButtons.forEach(b => {
      const active = Number(b.dataset.fee) === pct;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-checked', active ? 'true' : 'false');
    });
    if (persist) {
      try { localStorage.setItem(FEE_KEY, String(pct)); } catch (_) {}
    }
    recalc();
  };
  feeButtons.forEach(b => {
    b.addEventListener('click', () => applyFee(Number(b.dataset.fee), true));
  });
  const storedFee = (() => { try { return localStorage.getItem(FEE_KEY); } catch (_) { return null; } })();
  // Sundays always start at 0%; other days keep the last manual choice.
  applyFee(isSunday() ? 0 : (storedFee !== null ? Number(storedFee) : 2), false);

  fields.buyCurrency.addEventListener('change', () => { syncLabels(); recalc(); });
  fields.sellCurrency.addEventListener('change', () => { syncLabels(); recalc(); });

  function batchSize(unit, custom) {
    return unit === 'custom' ? Math.max(1, custom || 1) : Math.max(1, Number(unit) || 1);
  }
  // The entered amount is the price for `batch` items; normalize it to the
  // fixed 64-item comparison basis. ponytail: qty stays 64, add a qty input only if asked.
  function totalForUnit(amount, unit, qty, custom) {
    return (amount / batchSize(unit, custom)) * qty;
  }
  function unitLabel(unit, custom) {
    return `${t('calc_for_n', 'for')} ${batchSize(unit, custom)}×`;
  }

  function recalc() {
    syncLabels();
    const rate = getRate();
    const qty = 64; // one full Minecraft stack — no separate quantity input
    const buyAmount = Math.max(0, parseShorthand(fields.buyAmount.value));
    const sellAmount = Math.max(0, parseShorthand(fields.sellAmount.value));
    const buyUnit = getUnit(buyUnitRadios);
    const sellUnit = getUnit(sellUnitRadios);
    const buyCur = fields.buyCurrency.value;
    const sellCur = fields.sellCurrency.value;

    if (!rate || !buyAmount || !sellAmount) {
      out.className = 'calc-result empty';
      const missing = [];
      if (!rate) missing.push(t('calc_miss_rate', 'rate'));
      if (!buyAmount) missing.push(t('calc_miss_buy', 'buy price'));
      if (!sellAmount) missing.push(t('calc_miss_sell', 'sell price'));
      out.innerHTML = `<em>${t('calc_enter_prefix', 'Enter')} ${missing.join(', ')} ${t('calc_enter_suffix', 'to see profit.')}</em>`;
      return;
    }

    const buyTotal = totalForUnit(buyAmount, buyUnit, qty, Number(fields.buyCustom.value));
    const sellTotal = totalForUnit(sellAmount, sellUnit, qty, Number(fields.sellCustom.value));

    const totalCostIGM = toIGM(buyTotal, buyCur, rate);
    const totalRevenueIGM = toIGM(sellTotal, sellCur, rate);
    const feeIGM = totalRevenueIGM * (feePct / 100);
    const netRevenueIGM = totalRevenueIGM - feeIGM;
    const profitIGM = netRevenueIGM - totalCostIGM;
    const profitPerItemIGM = profitIGM / qty;

    const margin = totalCostIGM > 0 ? (profitIGM / totalCostIGM) * 100 : 0;
    const cls = profitIGM > 0.5 ? 'profit' : profitIGM < -0.5 ? 'loss' : 'zero';
    const verdictKey = profitIGM > 0.5 ? 'calc_profit_yes' : profitIGM < -0.5 ? 'calc_profit_no' : 'calc_profit_zero';
    const verdict = t(verdictKey, profitIGM > 0.5 ? 'Profitable' : profitIGM < -0.5 ? 'Loss' : 'Break-even');

    out.className = `calc-result ${cls}`;
    out.innerHTML = `
      <div class="calc-result-hero">
        <div class="calc-result-hero-main">
          <div class="calc-result-eyebrow">${t('calc_net_profit', 'Net profit · 64 stack')}</div>
          <div class="calc-result-amount ${cls}">${fmtSigned(profitIGM, 'IGM')}</div>
          <div class="calc-result-sub">${fmtSigned(profitPerItemIGM, 'IGM')} ${t('calc_per_item', 'per item')}</div>
        </div>
        <div class="calc-result-hero-side">
          <span class="calc-verdict-pill ${cls}">${verdict}</span>
          <span class="calc-result-margin">${profitIGM >= 0 ? '+' : ''}${fmt(margin, 1)}%</span>
        </div>
      </div>
      <div class="calc-result-rows">
        <div><span>${t('calc_total_cost', 'Total cost')} <small class="calc-row-note">(${unitLabel(buyUnit, Number(fields.buyCustom.value))})</small></span><strong>${fmtAny(buyTotal, buyCur)}</strong></div>
        <div><span>${t('calc_total_revenue', 'Total revenue (gross)')} <small class="calc-row-note">(${unitLabel(sellUnit, Number(fields.sellCustom.value))})</small></span><strong>${fmtAny(sellTotal, sellCur)}</strong></div>
        <div><span>${t('calc_fee_label', 'AH fee')} (${fmt(feePct, 0)}%)</span><strong>−${fmtAny(fromIGM(feeIGM, sellCur, rate), sellCur)}</strong></div>
        <div><span>${t('calc_net_revenue', 'Net revenue')}</span><strong>${fmtAny(fromIGM(netRevenueIGM, sellCur, rate), sellCur)}</strong></div>
      </div>
    `;
  }

  ['input', 'change'].forEach(ev => Object.values(fields).forEach(el => el && el.addEventListener(ev, recalc)));
  [...buyUnitRadios, ...sellUnitRadios].forEach(r => r.addEventListener('change', recalc));

  // --- Item presets (e.g. Votekeys) with MC item-sprite icons, stored locally ---
  const PRESETS_KEY = 'afk-calc-item-presets';
  const SPRITE_BASE = '/items';
  const SPRITE_CATALOG_URL = '/items.json';
  // Full item catalog + packed atlas (see tools/build_item_atlas.py), loaded
  // once. Until it arrives, presets fall back to their stored per-item icon URL.
  let ITEM_ATLAS = null;
  let chosenSprite = 'tripwire_hook';
  let autoSprite = null; // sprite set by name recognition, cleared on a manual pick
  let spriteTouched = false; // a manual pick disables name auto-recognition
  let spriteQuery = '';
  const SPRITE_RESULT_LIMIT = 240;

  // Map one atlas cell onto the element box using only percentages, so an icon
  // scales to any slot size without the JS knowing that size up front. Styles
  // are set through CSSOM: the app's CSP forbids inline style attributes.
  const applySpriteStyle = (el, id) => {
    const it = ITEM_ATLAS && ITEM_ATLAS.byId[id];
    if (!el || !it) return false;
    const { cols, rows } = ITEM_ATLAS;
    const col = it.index % cols;
    const row = Math.floor(it.index / cols);
    el.style.backgroundImage = `url('/${ITEM_ATLAS.file}')`;
    el.style.backgroundRepeat = 'no-repeat';
    el.style.backgroundSize = `${cols * 100}% ${rows * 100}%`;
    el.style.backgroundPosition =
      `${cols > 1 ? (col / (cols - 1)) * 100 : 0}% ${rows > 1 ? (row / (rows - 1)) * 100 : 0}%`;
    return true;
  };
  const loadItemAtlas = async () => {
    try {
      const res = await fetch(SPRITE_CATALOG_URL);
      if (!res.ok) return;
      const data = await res.json();
      if (!data || !Array.isArray(data.items)) return;
      data.byId = {};
      // Precompute lowercased names once instead of on every keystroke.
      data.list = data.items.map(([id, name], index) => {
        const rec = { id, name, index, lname: name.toLowerCase() };
        data.byId[id] = rec;
        return rec;
      });
      ITEM_ATLAS = data;
      // Only paint the grid if the picker is actually open; openPresetDialog
      // renders it otherwise, so an eager hidden-dialog build is wasted work.
      if (presetDialog && !presetDialog.classList.contains('hidden')) renderSpriteGrid();
      renderPresets();
    } catch (_) { /* keep the legacy per-item icon fallback */ }
  };
  const normalizeItemQuery = (raw) => String(raw || '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  // Single source of truth for matching operator text against the catalog, so
  // the search box and name recognition cannot disagree.
  const searchItems = (raw) => {
    if (!ITEM_ATLAS) return [];
    const text = String(raw || '').trim().toLowerCase();
    const q = normalizeItemQuery(raw);
    if (!text && !q) return ITEM_ATLAS.list;
    return ITEM_ATLAS.list.filter(rec =>
      (q && rec.id.includes(q)) || rec.lname.includes(text) || (q && rec.lname.includes(q)));
  };
  // Recognize a sprite from the preset name the operator typed.
  const bestItemMatch = (raw) => {
    if (!ITEM_ATLAS) return null;
    const q = normalizeItemQuery(raw);
    if (!q) return null;
    const list = ITEM_ATLAS.list;
    const hit = list.find(r => r.id === q)
      || list.find(r => r.id.startsWith(q))
      || list.find(r => r.id.endsWith(`_${q}`))
      || list.find(r => r.id.includes(q))
      || list.find(r => r.lname.includes(String(raw).trim().toLowerCase()));
    return hit ? hit.id : null;
  };
  const DEFAULT_PRESETS = [
    {
      id: 'votekeys', name: 'Votekeys', icon: '🔑', iconUrl: '', sprite: 'tripwire_hook',
      qty: 64, buyAmount: 215000, buyUnit: '1', buyCustom: 1, buyCur: 'IGM',
      sellAmount: 9, sellUnit: '64', sellCustom: 1, sellCur: 'GC',
    },
  ];
  const loadPresets = () => {
    try {
      const raw = localStorage.getItem(PRESETS_KEY);
      if (!raw) return [...DEFAULT_PRESETS];
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [...DEFAULT_PRESETS];
      return arr;
    } catch (_) { return [...DEFAULT_PRESETS]; }
  };
  const savePresets = (arr) => { try { localStorage.setItem(PRESETS_KEY, JSON.stringify(arr)); } catch (_) {} };
  let itemPresets = loadPresets();
  // Migrate legacy 'each'/'stack' units and refresh the built-in Votekeys entry
  // (old emoji version -> tripwire-hook sprite).
  itemPresets = itemPresets.map(p => {
    const next = { ...p, buyUnit: normUnit(p.buyUnit), sellUnit: normUnit(p.sellUnit) };
    if (next.id === 'votekeys' && !next.sprite) return { ...next, sprite: 'tripwire_hook' };
    return next;
  });
  const presetWrap = $('#calcItemPresets');
  const presetSaveBtn = $('#calcPresetSave');

  const setUnit = (radios, val) => {
    for (const r of radios) r.checked = (r.value === val);
  };
  const snapshotCurrent = () => ({
    qty: 64,
    buyAmount: parseShorthand(fields.buyAmount.value),
    buyUnit: getUnit(buyUnitRadios),
    buyCustom: Math.max(1, Number(fields.buyCustom.value) || 1),
    buyCur: fields.buyCurrency.value,
    sellAmount: parseShorthand(fields.sellAmount.value),
    sellUnit: getUnit(sellUnitRadios),
    sellCustom: Math.max(1, Number(fields.sellCustom.value) || 1),
    sellCur: fields.sellCurrency.value,
  });
  const applyPreset = (p) => {
    fields.buyAmount.value = p.buyAmount;
    fields.buyCustom.value = p.buyCustom || 1;
    fields.buyCurrency.value = p.buyCur || 'IGM';
    fields.sellAmount.value = p.sellAmount;
    fields.sellCustom.value = p.sellCustom || 1;
    fields.sellCurrency.value = p.sellCur || 'GC';
    setUnit(buyUnitRadios, normUnit(p.buyUnit) || '1');
    setUnit(sellUnitRadios, normUnit(p.sellUnit) || '64');
    syncLabels();
    document.querySelectorAll('.calc-item-preset').forEach(el => {
      el.classList.toggle('is-active', el.dataset.presetId === p.id);
    });
    recalc();
  };
  const presetIcon = (p) => {
    const fallback = (p.icon || '📦').replace(/'/g, '');
    if (p.sprite && ITEM_ATLAS && ITEM_ATLAS.byId[p.sprite]) {
      return `<span class="mc-slot-icon"></span>`;
    }
    if (p.iconUrl && /^(https?:\/\/|\/items\/)/i.test(p.iconUrl)) {
      return `<img src="${p.iconUrl.replace(/"/g, '&quot;')}" alt="" loading="lazy">`;
    }
    return `<span class="mc-slot-emoji">${escapeHtml(fallback)}</span>`;
  };
  const renderPresets = () => {
    if (!presetWrap) return;
    presetWrap.innerHTML = '';
    for (const p of itemPresets) {
      const btn = document.createElement('div');
      btn.className = 'calc-item-preset';
      btn.dataset.presetId = p.id;
      btn.setAttribute('role', 'button');
      btn.tabIndex = 0;
      const sub = `${p.qty || ''}× · ${fmtShort(p.buyAmount || 0)} ${p.buyCur || ''} → ${fmtShort(p.sellAmount || 0)} ${p.sellCur || ''}`;
      btn.innerHTML = `
        <span class="mc-slot">${presetIcon(p)}</span>
        <span class="preset-meta"><span class="preset-name"></span><span class="preset-sub"></span></span>
        <button type="button" class="preset-del" title="${t('calc_preset_delete', 'Delete preset')}" aria-label="${t('calc_preset_delete', 'Delete preset')}">×</button>
      `;
      const iconEl = btn.querySelector('.mc-slot-icon');
      if (iconEl && !applySpriteStyle(iconEl, p.sprite)) iconEl.remove();
      const imgEl = btn.querySelector('.mc-slot img');
      if (imgEl) imgEl.addEventListener('error', () => {
        const emoji = document.createElement('span');
        emoji.className = 'mc-slot-emoji';
        emoji.textContent = (p.icon || '📦');
        imgEl.replaceWith(emoji);
      });
      btn.querySelector('.preset-name').textContent = p.name;
      btn.querySelector('.preset-sub').textContent = sub;
      btn.addEventListener('click', (e) => { if (e.target.closest('.preset-del')) return; applyPreset(p); });
      btn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); applyPreset(p); } });
      const del = btn.querySelector('.preset-del');
      if (del) del.addEventListener('click', (e) => {
        e.stopPropagation();
        itemPresets = itemPresets.filter(x => x.id !== p.id);
        savePresets(itemPresets);
        renderPresets();
      });
      presetWrap.appendChild(btn);
    }
  };
  // Save flow: small dialog with name + sprite picker
  // (replaces the old double window.prompt).
  const presetDialog = $('#calcPresetDialog');
  const presetNameInput = $('#calcPresetName');
  const spriteGrid = $('#calcSpriteGrid');
  const presetCancelBtn = $('#calcPresetCancel');
  const presetConfirmBtn = $('#calcPresetConfirm');
  const spriteSearchInput = $('#calcSpriteSearch');
  const spriteSelectedLabel = $('#calcSpriteSelected');
  const renderSpriteGrid = () => {
    if (!spriteGrid) return;
    spriteGrid.innerHTML = '';
    if (!ITEM_ATLAS) {
      spriteGrid.innerHTML = `<span class="calc-sprite-empty">${t('calc_sprite_loading', 'Loading items…')}</span>`;
      return;
    }
    const matches = searchItems(spriteQuery);
    if (!matches.length) {
      spriteGrid.innerHTML = `<span class="calc-sprite-empty">${t('calc_sprite_empty', 'No matching items')}</span>`;
      return;
    }
    const shown = matches.slice(0, SPRITE_RESULT_LIMIT);
    // Keep the current selection visible even when it sorts past the cap.
    if (!shown.some(rec => rec.id === chosenSprite)) {
      const picked = matches.find(rec => rec.id === chosenSprite);
      if (picked) shown.unshift(picked);
    }
    for (const { id, name } of shown) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `calc-sprite-opt${id === chosenSprite ? ' is-selected' : ''}`;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', id === chosenSprite ? 'true' : 'false');
      b.title = name;
      b.setAttribute('aria-label', name);
      b.innerHTML = '<span class="sprite"></span>';
      applySpriteStyle(b.firstChild, id);
      b.addEventListener('click', () => {
        chosenSprite = id; spriteTouched = true; autoSprite = null; renderSpriteGrid();
      });
      spriteGrid.appendChild(b);
    }
    if (matches.length > shown.length) {
      const more = document.createElement('span');
      more.className = 'calc-sprite-more';
      more.textContent = `+${matches.length - shown.length} ${t('calc_sprite_more', 'more — type to narrow')}`;
      spriteGrid.appendChild(more);
    }
    const selected = spriteGrid.querySelector('.calc-sprite-opt.is-selected');
    if (selected && typeof selected.scrollIntoView === 'function') selected.scrollIntoView({ block: 'nearest' });
    const picked = ITEM_ATLAS.byId[chosenSprite];
    if (spriteSelectedLabel) {
      spriteSelectedLabel.textContent = picked
        ? `${t('calc_sprite_selected', 'Selected')}: ${picked.name}` : '';
    }
  };
  const openPresetDialog = () => {
    if (!presetDialog) return;
    if (presetNameInput) presetNameInput.value = '';
    if (spriteSearchInput) spriteSearchInput.value = '';
    chosenSprite = 'tripwire_hook';
    autoSprite = null;
    spriteTouched = false;
    spriteQuery = '';
    renderSpriteGrid();
    presetDialog.classList.remove('hidden');
    setTimeout(() => presetNameInput && presetNameInput.focus(), 50);
  };
  const closePresetDialog = () => { if (presetDialog) presetDialog.classList.add('hidden'); };
  const confirmPresetDialog = () => {
    const name = (presetNameInput && presetNameInput.value.trim()) || '';
    if (!name) { if (presetNameInput) presetNameInput.focus(); return; }
    const cur = snapshotCurrent();
    itemPresets.push({
      id: `custom-${Date.now()}`, name,
      icon: '📦',
      iconUrl: `${SPRITE_BASE}/${chosenSprite}.png`,
      sprite: chosenSprite,
      ...cur,
    });
    savePresets(itemPresets);
    renderPresets();
    closePresetDialog();
  };
  if (presetSaveBtn) presetSaveBtn.addEventListener('click', openPresetDialog);
  if (presetCancelBtn) presetCancelBtn.addEventListener('click', closePresetDialog);
  if (presetConfirmBtn) presetConfirmBtn.addEventListener('click', confirmPresetDialog);
  // The grid can hold hundreds of nodes; coalesce rapid keystrokes into one paint.
  let spriteRenderTimer = null;
  const scheduleSpriteRender = () => {
    clearTimeout(spriteRenderTimer);
    spriteRenderTimer = setTimeout(renderSpriteGrid, 120);
  };
  if (spriteSearchInput) spriteSearchInput.addEventListener('input', () => {
    spriteQuery = spriteSearchInput.value;
    scheduleSpriteRender();
  });
  // Typing a preset name auto-selects a matching item icon until the operator
  // picks one by hand. A name that stops matching resets to the default sprite
  // instead of keeping a stale partial hit (e.g. "V" matching "vault").
  if (presetNameInput) presetNameInput.addEventListener('input', () => {
    if (spriteTouched || !ITEM_ATLAS) return;
    const match = bestItemMatch(presetNameInput.value);
    if (match) {
      if (match !== chosenSprite) { chosenSprite = match; autoSprite = match; scheduleSpriteRender(); }
    } else if (autoSprite) {
      chosenSprite = 'tripwire_hook';
      autoSprite = null;
      scheduleSpriteRender();
    }
  });
  if (presetDialog) {
    presetDialog.addEventListener('click', (e) => { if (e.target === presetDialog) closePresetDialog(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && presetDialog && !presetDialog.classList.contains('hidden')) closePresetDialog();
    });
    if (presetNameInput) presetNameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); confirmPresetDialog(); }
    });
  }
  renderPresets();
  loadItemAtlas();
  updateChip(); syncLabels(); syncChipVisibility();
  recalc();
})();
