let hosts = [], selected = null, loading = false, loaded = false;
let lastError = '', setupSuccess = '', attentionOnly = false;
let helpInitialized = false;
const $ = id => document.getElementById(id);
const age = iso => Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
const needsAttention = c => c.health === 'unhealthy' || ['restarting', 'dead'].includes(c.state);
function duration(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  if (seconds < 60) return seconds + 's';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm';
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h';
  return Math.floor(seconds / 86400) + 'd';
}
function node(tag, className = '', text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = String(text);
  return el;
}
function hostState(host) {
  return !host.snapshot ? 'Awaiting report' : age(host.snapshot.receivedAt) > 120 ? 'Stale' : 'Reporting';
}
function syncHosts() {
  if (!hosts.length) {
    $('hosts').replaceChildren(node('p', '', loaded ? 'No hosts connected.' : 'Loading hosts…'));
    return;
  }
  for (const child of [...$('hosts').children]) {
    if (!hosts.some(h => h.id === child.dataset.host)) child.remove();
  }
  for (const host of hosts) {
    let button = [...$('hosts').children].find(el => el.dataset.host === host.id);
    if (!button) {
      button = node('button', 'host');
      button.dataset.host = host.id;
      const name = node('span', 'host-name');
      name.append(node('strong'), node('span', 'host-issues'));
      button.append(name, node('span', 'host-state'));
      button.onclick = () => {
        selected = host.id; attentionOnly = false; $('search').value = ''; setupSuccess = '';
        render();
      };
      $('hosts').append(button);
    }
    const state = hostState(host);
    const issueCount = host.snapshot?.containers.filter(needsAttention).length || 0;
    button.className = 'host' + (host.id === selected ? ' selected' : '');
    button.setAttribute('aria-pressed', String(host.id === selected));
    button.querySelector('strong').textContent = host.name;
    button.querySelector('.host-issues').textContent = issueCount ? issueCount + (issueCount === 1 ? ' issue' : ' issues') : '';
    const stateEl = button.querySelector('.host-state');
    stateEl.className = 'host-state' + (state === 'Reporting' ? ' good' : state === 'Stale' ? ' warn' : '');
    const count = host.snapshot?.containers.length;
    stateEl.textContent = state + (host.snapshot ? ' · ' + count + (count === 1 ? ' container' : ' containers') : '');
  }
}
function renderRows(containers) {
  const rows = containers.map(c => {
    const row = node('tr'), name = node('td');
    const uptime = c.state === 'running' && Date.parse(c.startedAt) > 0 ? duration(age(c.startedAt)) : '—';
    name.append(node('strong', 'container-name', c.name), node('span', 'image', c.image));
    name.append(node('span', 'mobile-details', 'Uptime ' + uptime + ' · ' + c.restarts + ' restarts'));
    const state = node('td');
    state.append(node('span', 'pill ' + (c.state === 'running' ? 'good' : ['restarting', 'dead'].includes(c.state) ? 'bad' : ''), c.state));
    const health = node('td');
    health.append(node('span', c.health === 'none' ? 'no-check' : 'pill ' + (c.health === 'healthy' ? 'good' : c.health === 'unhealthy' ? 'bad' : 'warn'), c.health === 'none' ? 'No check' : c.health));
    row.append(name, state, health, node('td', 'desktop-detail', uptime), node('td', 'desktop-detail number', c.restarts));
    return row;
  });
  $('rows').replaceChildren(...rows);
}
function render() {
  syncHosts();
  const reporting = hosts.filter(h => hostState(h) === 'Reporting').length;
  const staleHosts = hosts.filter(h => hostState(h) === 'Stale').length;
  $('host-count').textContent = loaded ? hosts.length : '—';
  $('fleet-summary').textContent = !loaded ? 'Loading your fleet…' : !hosts.length ? 'Connect a host to start watching your containers.' :
    hosts.length + (hosts.length === 1 ? ' host' : ' hosts') + ' · ' + reporting + ' reporting' + (staleHosts ? ' · ' + staleHosts + ' stale' : '');
  const host = hosts.find(h => h.id === selected), snapshot = host?.snapshot;
  const stale = !!snapshot && age(snapshot.receivedAt) > 120;
  $('containers').setAttribute('aria-busy', String(!loaded && loading));
  $('host-title').textContent = host ? host.name : 'Container status';
  $('table-caption').textContent = host ? 'Containers on ' + host.name : 'Containers on the selected Docker host';
  $('engine').textContent = snapshot ? 'Docker Engine ' + snapshot.engineVersion : host ? 'Run the collector to start reporting' : loaded ? 'No host selected' : 'Loading reports…';
  $('host-status').textContent = host ? hostState(host) : loaded ? 'Not connected' : 'Loading';
  $('host-status').className = 'status' + (stale ? ' warn' : snapshot ? ' good' : '');
  const containers = snapshot?.containers || [], issues = containers.filter(needsAttention).length;
  $('summary').hidden = !snapshot;
  $('total').textContent = containers.length;
  $('running').textContent = containers.filter(c => c.state === 'running').length;
  $('attention').textContent = issues;
  $('attention').className = issues ? 'has-issues' : '';
  $('last').textContent = snapshot ? duration(age(snapshot.receivedAt)) + ' ago' : '—';
  $('last').title = snapshot ? new Date(snapshot.receivedAt).toLocaleString() : '';
  $('connection').textContent = stale ? 'Last known status' : 'Every 30 seconds';
  $('notice').hidden = !lastError && !stale && !setupSuccess;
  $('notice').className = 'alert' + (lastError ? ' error' : '');
  $('notice').textContent = lastError || (stale ? 'No report from ' + host.name + ' for ' + duration(age(snapshot.receivedAt)) + '. These are its last known states. Check the collector on this host.' : setupSuccess);
  const query = $('search').value.trim().toLowerCase();
  const visible = containers.filter(c => (!attentionOnly || needsAttention(c)) && (!query || (c.name + ' ' + c.image).toLowerCase().includes(query)))
    .sort((a, b) => Number(needsAttention(b)) - Number(needsAttention(a)) || a.name.localeCompare(b.name));
  $('table-tools').hidden = !containers.length;
  $('attention-filter').setAttribute('aria-pressed', String(attentionOnly));
  $('filter-count').textContent = issues;
  $('table-wrap').hidden = !visible.length;
  $('table-footer').hidden = !containers.length;
  $('row-count').textContent = visible.length + ' of ' + containers.length + ' containers';
  $('empty').hidden = !!visible.length;
  $('empty-add').hidden = !loaded || !!host || !!lastError;
  $('clear-filters').hidden = !containers.length || !!visible.length;
  $('empty-logo').hidden = !!host || !loaded || !!lastError;
  if (loaded && !helpInitialized) {
    $('setup-help').open = !hosts.length && !lastError;
    helpInitialized = true;
  }
  if (lastError && !loaded) {
    $('empty-title').textContent = 'Status unavailable';
    $('empty-copy').textContent = 'Refresh to try loading your hosts again.';
  } else if (!loaded) {
    $('empty-title').textContent = 'Loading container status…';
    $('empty-copy').textContent = 'Fetching the latest reports from your hosts.';
  } else if (!host) {
    $('empty-title').textContent = 'Connect your first Docker host';
    $('empty-copy').textContent = 'Download a small collector and run it on your host. Status arrives here over HTTPS, with no inbound ports required.';
  } else if (!snapshot) {
    $('empty-title').textContent = 'Waiting for ' + host.name;
    $('empty-copy').textContent = 'Run the downloaded setup script on this host. If a report does not arrive within a minute, check the collector logs.';
  } else if (!containers.length) {
    $('empty-title').textContent = 'No containers on this host';
    $('empty-copy').textContent = 'The latest report contains no containers, including stopped containers.';
  } else {
    $('empty-title').textContent = attentionOnly && !query ? 'No containers need attention' : 'No matching containers';
    $('empty-copy').textContent = attentionOnly && !query ? 'No unhealthy, restarting, or dead containers in the latest report.' : 'Try another name or image, or clear the filters to see all containers.';
  }
  renderRows(visible);
}
async function refresh(selectName) {
  if (loading) return;
  loading = true; $('refresh').disabled = true; $('refresh-label').textContent = 'Refreshing…';
  try {
    const response = await fetch('/api/hosts', {cache: 'no-store', signal: AbortSignal.timeout(10000)});
    if (response.status === 401 || response.status === 403) throw new Error('Your session needs attention. Sign in again, then refresh this page.');
    if (!response.ok) throw new Error('Unable to load current status. Last loaded data may be out of date. Try Refresh.');
    const data = await response.json();
    if (!Array.isArray(data.hosts)) throw new Error('Unexpected status response. Try Refresh.');
    hosts = data.hosts;
    if (typeof selectName === 'string') selected = hosts.find(h => h.name === selectName)?.id || selected;
    if (!hosts.some(h => h.id === selected)) selected = hosts[0]?.id || null;
    loaded = true; lastError = '';
    $('poll-status').textContent = 'Refreshes every 15 seconds';
  } catch (error) {
    lastError = error.name === 'TimeoutError' ? 'The status request timed out. Last loaded data may be out of date. Try Refresh.' :
      error instanceof TypeError ? 'Unable to reach the dashboard. Check your connection, then try Refresh.' : error.message;
    $('poll-status').textContent = 'Refresh failed';
  } finally {
    loading = false; $('refresh').disabled = false; $('refresh-label').textContent = 'Refresh';
    render();
  }
}
function openSetup() {
  $('setup-form').reset(); $('hostname').setCustomValidity('');
  $('hostname').removeAttribute('aria-invalid');
  $('setup-message').textContent = ''; $('setup-message').hidden = true;
  $('setup').showModal(); $('hostname').focus();
}
$('add').onclick = openSetup;
$('empty-add').onclick = openSetup;
for (const id of ['cancel', 'cancel-bottom']) $(id).onclick = () => $('setup').close();
$('refresh').onclick = refresh;
$('search').oninput = render;
$('attention-filter').onclick = () => {attentionOnly = !attentionOnly; render();};
$('clear-filters').onclick = () => {attentionOnly = false; $('search').value = ''; render(); $('search').focus();};
$('hostname').oninput = () => {$('hostname').setCustomValidity(''); $('hostname').removeAttribute('aria-invalid');};
$('setup-form').onsubmit = async event => {
  event.preventDefault();
  const name = $('hostname').value.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9 ._-]{0,63}$/.test(name)) {
    $('hostname').setCustomValidity('Use a name starting with a letter or number. Letters, numbers, spaces, dots, dashes, and underscores are allowed.');
    $('hostname').reportValidity(); return;
  }
  $('download').disabled = true; $('download').textContent = 'Preparing collector…';
  $('setup-message').hidden = true; $('hostname').removeAttribute('aria-invalid');
  try {
    const response = await fetch('/api/hosts', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name})});
    if (!response.ok) {
      const error = await response.json();
      if (response.status === 409) $('hostname').setAttribute('aria-invalid', 'true');
      throw new Error(error.error || 'Unable to prepare the collector. Try again.');
    }
    const url = URL.createObjectURL(await response.blob()), link = node('a');
    link.href = url; link.download = 'docker-watch-setup.sh';
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    $('setup').close();
    setupSuccess = 'Collector downloaded. Run bash docker-watch-setup.sh as your normal user on ' + name + '. Keep the script private: it contains reporting credentials.';
    await refresh(name);
  } catch (error) {
    $('setup-message').textContent = error.message; $('setup-message').hidden = false;
  } finally {
    $('download').disabled = false; $('download').textContent = 'Download collector';
  }
};
const context = document.modelContext;
if (context?.registerTool) {
  const lifecycle = new AbortController();
  for (const tool of [{
    name: 'read_docker_status', description: 'Refresh and read the Docker hosts and their latest container reports.',
    inputSchema: {type: 'object', properties: {}, additionalProperties: false},
    annotations: {readOnlyHint: true, untrustedContentHint: true},
    async execute(input) {
      if (!input || typeof input !== 'object' || Object.keys(input).length) throw new Error('Expected empty input');
      await refresh(); if (lastError) throw new Error('Status unavailable'); return {hosts};
    },
  }, {
    name: 'start_docker_host_setup', description: 'Open the collector setup form. This does not register a host or create credentials.',
    inputSchema: {type: 'object', properties: {}, additionalProperties: false},
    annotations: {readOnlyHint: false},
    execute(input) {
      if (!input || typeof input !== 'object' || Object.keys(input).length) throw new Error('Expected empty input');
      openSetup(); return {setupOpen: true};
    },
  }]) {
    try {Promise.resolve(context.registerTool(tool, {signal: lifecycle.signal})).catch(() => {});} catch {}
  }
  window.addEventListener('pagehide', () => lifecycle.abort(), {once: true});
}
refresh();
setInterval(() => {if (!document.hidden) refresh();}, 15000);
