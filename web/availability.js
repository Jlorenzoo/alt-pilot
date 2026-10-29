/* Availability is collected by the control server even when this page is closed. */
(() => {
  const root = document.querySelector('#view-availability');
  const report = document.querySelector('#availabilityReport');
  const notice = document.querySelector('#availabilityNotice');
  const period = document.querySelector('#availabilityPeriod');
  const refresh = document.querySelector('#availabilityRefresh');
  const names = {online: 'Online', downtime: 'Downtime', stopped: 'Stopped', unknown: 'Unmonitored'};
  const states = Object.keys(names);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const duration = seconds => {
    if (seconds < 60) return `${Math.floor(seconds)}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  };
  const stamp = value => new Date(value * 1000).toLocaleString([], {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'});
  const pct = value => value == null ? '—' : `${value.toFixed(2)}%`;
  let data = null, busy = false;

  async function load() {
    if (busy) return;
    busy = true;
    refresh.disabled = true;
    const days = period.value;
    try {
      const response = await fetch(`/api/availability?days=${days}`, {cache:'no-store'});
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not load availability');
      if (period.value !== days) return;
      data = result;
      draw();
      notice.textContent = `Updated ${stamp(data.end)} · Checks approximately every 30 seconds · Times shown in ${Intl.DateTimeFormat().resolvedOptions().timeZone}`;
    } catch (error) {
      notice.textContent = `${error.message}. ${data ? 'Showing the previous report.' : 'Try refreshing.'}`;
    } finally {
      busy = false;
      refresh.disabled = false;
      if (period.value !== days) load();
    }
  }

  function draw() {
    if (!data) return;
    const selected = (app.remote?.accounts || []).find(a => a.slot === app.selectedSlot && a.authenticated && a.name);
    const accounts = selected ? data.accounts.filter(a => a.id === accountIdentity(selected)) : [];
    if (!accounts.length) {
      report.innerHTML = `<div class="panel availability-empty"><h2>${selected ? esc(selected.name) : 'Choose an account'}</h2><p>${selected ? 'No availability history is shown for this account. It may be excluded from tracking or awaiting its first check.' : 'Select an account in the header to view its connection history.'}</p></div>`;
      return;
    }
    const totals = Object.fromEntries(states.map(state => [state, accounts.reduce((sum, a) => sum + a.totals[state], 0)]));
    const reconstructed = accounts.reduce((sum, a) => sum + (a.reconstructed_seconds || 0), 0);
    const measured = totals.online + totals.downtime;
    const tracked = states.reduce((sum, state) => sum + totals[state], 0);
    const outages = accounts.flatMap(a => a.segments.filter(s => s.state === 'downtime').map(s => ({...s, name:a.name, accountId:a.id})));
    const longest = Math.max(0, ...outages.map(s => s.end-s.start));
    const buckets = accounts[0].buckets.map((_, i) => Object.fromEntries(states.map(s => [s, accounts.reduce((sum,a) => sum+a.buckets[i][s],0)])));
    const coverage = tracked ? (totals.online + totals.downtime + totals.stopped) / tracked * 100 : null;
    const metric = (label, value, sub) => `<div><span>${label}</span><strong>${value}</strong><small>${sub}</small></div>`;
    report.innerHTML = `
      <div class="availability-metrics">
        ${metric('Downtime', pct(measured ? totals.downtime / measured * 100 : null), `${duration(totals.downtime)} disconnected`)}
        ${metric('Online', pct(measured ? totals.online / measured * 100 : null), `${duration(totals.online)} connected`)}
        ${metric('Interruptions', outages.length, `Longest: ${duration(longest)}`)}
        ${metric('History coverage', pct(coverage), `${duration(totals.unknown)} unmonitored`)}
      </div>
      ${reconstructed ? `<div class="availability-history-note" role="note"><strong>Includes reconstructed history</strong><p>${duration(reconstructed)} recovered from saved logs. Historical connection times are estimates; missing periods remain unmonitored. Percentages combine reconstructed and sampled history.</p></div>` : ''}
      <p class="availability-method">${accounts.length > 1 ? `Combined totals use account-hours across ${accounts.length} accounts: two accounts offline for one hour count as two hours. ` : ''}Downtime % = disconnected time ÷ (online + disconnected time). Stopped time (${duration(totals.stopped)}) and unmonitored time are excluded. History begins with each account’s earliest recorded evidence; interruptions shorter than the sampling interval may be missed.</p>
      <section class="panel availability-chart"><div class="availability-section-heading"><div><h2>Connection history</h2><p>${data.days === 1 ? 'Hourly' : 'Daily'} breakdown · ${stamp(data.start)} – ${stamp(data.end)}</p></div><div class="availability-legend">${states.map(s => `<span><i class="availability-${s}"></i>${names[s]}</span>`).join('')}</div></div>
        ${chart(buckets)}
        <p class="availability-chart-help" id="availabilityBucketDetail">Each bar shows the share of tracked account-time. Empty space before tracking began has no data. Select a bar for exact durations.</p>
      </section>
      <section class="panel availability-accounts"><h2>Account detail</h2><p>History for the account selected in the header.</p><div class="availability-table-wrap"><table><thead><tr><th>Account</th><th>Downtime</th><th>Offline time</th><th>Online time</th><th>Stopped</th><th>Unmonitored</th></tr></thead><tbody>${accounts.map(a => `<tr><th>${esc(a.name)}<small>${esc(a.edition)} · Slot ${a.slot}</small><small>Since ${stamp(a.first)}${a.reconstructed_seconds ? ' · Includes reconstructed history' : ''}</small></th><td>${pct(a.downtime_pct)}</td><td>${duration(a.totals.downtime)}</td><td>${duration(a.totals.online)}</td><td>${duration(a.totals.stopped)}</td><td>${duration(a.totals.unknown)}</td></tr>`).join('')}</tbody></table></div></section>
      <section class="panel availability-incidents"><h2>Interruption log</h2><p>Connection failures in this period. Start and recovery times are approximate; entries at a period boundary are clipped.</p>${outages.length ? `<div class="availability-table-wrap"><table><thead><tr><th>Account</th><th>Disconnected</th><th>End / recovery</th><th>Duration</th></tr></thead><tbody>${outages.sort((a,b) => b.start-a.start).slice(0,100).map(s => {
        const owner = accounts.find(a => a.id === s.accountId);
        const next = owner.segments.find(seg => seg.start === s.end);
        const ending = next?.state === 'online' ? stamp(s.end) : next ? `${stamp(s.end)} · ${names[next.state]}` : `${stamp(s.end)} · Last check`;
        return `<tr><th>${esc(s.name)}${s.source === 'reconstructed' ? '<small>Reconstructed</small>' : ''}</th><td>${stamp(s.start)}</td><td>${ending}</td><td>${duration(s.end-s.start)}</td></tr>`;
      }).join('')}</tbody></table></div>${outages.length > 100 ? '<p>Showing the latest 100 interruptions.</p>' : ''}` : '<div class="availability-empty">No connection failures recorded in this period.</div>'}</section>
      <p class="availability-footnote">30 days retained. Stopped means the client service was inactive; this does not prove why it stopped. Unmonitored means no reliable status was available. Java connection status follows the existing network connection check.</p>`;
    report.querySelectorAll('[data-availability-bucket]').forEach(bar => {
      const show = () => { document.querySelector('#availabilityBucketDetail').textContent = bar.getAttribute('aria-label'); };
      bar.addEventListener('click', show);
      bar.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); show(); } });
    });

  }

  function chart(buckets) {
    const width = 960, height = 180, step = width / buckets.length;
    const colors = {online:'var(--success)',downtime:'var(--danger)',stopped:'var(--warning)',unknown:'var(--border-strong)'};
    let svg = '';
    buckets.forEach((b,i) => {
      const total = states.reduce((sum,s) => sum+b[s],0);
      const time = data.start + (data.end-data.start)*i/buckets.length;
      const label = `${stamp(time)}: ${states.map(s => `${names[s]} ${duration(b[s])}`).join(', ')}`;
      let y = height;
      svg += `<g tabindex="0" role="button" data-availability-bucket="${i}" aria-label="${esc(label)}"><title>${esc(label)}</title><rect x="${i*step+2}" y="0" width="${step-4}" height="${height}" fill="var(--surface-2)"/>`;
      states.forEach(s => {
        const h = total ? b[s]/total*height : 0;
        y -= h;
        svg += `<rect x="${i*step+2}" y="${y}" width="${step-4}" height="${h}" fill="${colors[s]}"/>`;
      });
      svg += '</g>';
    });
    return `<div class="availability-plot"><div class="availability-y"><span>100%</span><span>50%</span><span>0%</span></div><div><svg class="availability-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="group" aria-label="Connection status share by time">${svg}</svg><div class="availability-axis"><span>${stamp(data.start)}</span><span>${stamp((data.start+data.end)/2)}</span><span>${stamp(data.end)}</span></div></div></div>`;
  }
  document.addEventListener('account-selection-change', draw);
  period.addEventListener('change', load);
  refresh.addEventListener('click', load);
  document.querySelector('[data-view="availability"]').addEventListener('click', load);
  if (location.hash === '#availability') load();
  setInterval(() => { if (root.classList.contains('active') && !document.hidden) load(); }, 30000);
})();
