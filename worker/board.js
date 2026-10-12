let hosts = [], selected = null, loading = false, loaded = false;
let lastError = '', setupSuccess = '', attentionOnly = false;
let helpInitialized = false, groupByProject = false;
let view = 'containers', historyEvents = [], historyError = '', historyLoading = false, historySequence = 0;
let enrollmentId = null, packageUrl = null, configUrl = null, managedId = null, rotationRevision = null, rotationExpiry = 0;
let setupCommand = '';
const $ = id => document.getElementById(id);
const age = iso => Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
const needsAttention = c => c.health === 'unhealthy' || ['restarting', 'dead'].includes(c.state);
const inMaintenance = h => Date.parse(h?.maintenanceUntil) > Date.now();
const maintenanceText = h => 'Notifications paused until '+new Date(h.maintenanceUntil).toLocaleString();
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
        selectHost(host.id);
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
    stateEl.textContent = inMaintenance(host) ? 'Maintenance · '+state : state + (host.snapshot ? ' · ' + count + (count === 1 ? ' container' : ' containers') : '');
  }
}
function renderRows(containers) {
  const rows = [];
  const groups = new Map();
  for(const c of containers) {
    const key=JSON.stringify([c.hostId,c.composeProject??null]);
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(c);
  }
  const grouped=groupByProject?[...groups.values()].sort((a,b)=>a[0].hostName.localeCompare(b[0].hostName)||(a[0].composeProject||'').localeCompare(b[0].composeProject||'')):[containers];
  for(const group of grouped) {
    if(groupByProject) {
      const first=group[0], label=first.composeProject===undefined?'Project metadata unavailable — update collector':first.composeProject||'Standalone containers';
      const row=node('tr','project-heading'), heading=node('th','',label+(selected===null?' · '+first.hostName:''));
      heading.colSpan=5;heading.scope='rowgroup';
      const issues=group.filter(needsAttention).length;
      heading.append(node('span','project-summary',group.length+' container'+(group.length===1?'':'s')+(issues?' · '+issues+' need attention':'')));
      row.append(heading);rows.push(row);
    }
    for(const c of group) {
    const row = node('tr'), name = node('td');
    const uptime = c.state === 'running' && Date.parse(c.startedAt) > 0 ? duration(age(c.startedAt)) : '—';
    name.append(node('strong', 'container-name', c.name), node('span', 'image', c.image));
    if(selected===null) name.append(node('span','row-host',c.hostName+(c.stale?' · last known status':'')));
    if(c.composeService)name.append(node('span','image','Service: '+c.composeService));
    name.append(node('span', 'mobile-details', 'Uptime ' + uptime + ' · ' + c.restarts + ' restarts'));
    const state = node('td');
    state.append(node('span', 'pill ' + (c.state === 'running' ? 'good' : ['restarting', 'dead'].includes(c.state) ? 'bad' : ''), c.state));
    const health = node('td');
    health.append(node('span', c.health === 'none' ? 'no-check' : 'pill ' + (c.health === 'healthy' ? 'good' : c.health === 'unhealthy' ? 'bad' : 'warn'), c.health === 'none' ? 'No check' : c.health));
    row.append(name, state, health, node('td', 'desktop-detail', uptime), node('td', 'desktop-detail number', c.restarts));
    rows.push(row);
    }
  }
  $('rows').replaceChildren(...rows);
}
function render() {
  syncHosts();
  $('fleet-view').className = 'host' + (selected === null ? ' selected' : '');
  $('fleet-view').setAttribute('aria-pressed', String(selected === null));
  const reporting = hosts.filter(h => hostState(h) === 'Reporting').length;
  const staleHosts = hosts.filter(h => hostState(h) === 'Stale').length;
  $('host-count').textContent = loaded ? hosts.length : '—';
  $('fleet-summary').textContent = !loaded ? 'Loading your fleet…' : !hosts.length ? 'Connect a host to start watching your containers.' :
    hosts.length + (hosts.length === 1 ? ' host' : ' hosts') + ' · ' + reporting + ' reporting' + (staleHosts ? ' · ' + staleHosts + ' stale' : '');
  const host = hosts.find(h => h.id === selected), snapshot = host?.snapshot, fleet = selected === null;
  const paused=hosts.filter(h=>(fleet || h.id===selected) && inMaintenance(h));
  $('maintenance-banner').hidden=!paused.length;
  $('maintenance-banner').textContent=host && paused.length?host.name+': '+maintenanceText(host)+'. Health and activity stay visible.':paused.length+' host'+(paused.length===1?' is':'s are')+' in maintenance. Automatic notifications are paused for those hosts; health and activity stay visible.';
  $('search').placeholder=fleet?'Search containers, images, or hosts':'Search containers or images';
  $('search').setAttribute('aria-label',$('search').placeholder);
  const stale = !!snapshot && age(snapshot.receivedAt) > 120;
  $('containers').setAttribute('aria-busy', String(!loaded && loading));
  $('host-title').textContent = host ? host.name : 'All hosts';
  $('table-caption').textContent = host ? 'Containers on ' + host.name : 'Containers across all Docker hosts';
  $('engine').textContent = snapshot ? 'Docker Engine ' + snapshot.engineVersion : host ? 'Start the collector to begin reporting' : loaded ? 'Search containers, images, or hosts across your fleet' : 'Loading reports…';
  $('host-status').textContent = host ? hostState(host) : loaded ? reporting + ' reporting' : 'Loading';
  $('host-status').className = 'status' + (stale ? ' warn' : snapshot ? ' good' : '');
  $('manage-host').hidden = !host;
  $('resume-setup').hidden = !host || !!snapshot;
  const containers = hosts.filter(h=>fleet || h.id===selected).flatMap(h=>(h.snapshot?.containers||[]).map(c=>({...c,hostId:h.id,hostName:h.name,stale:hostState(h)==='Stale'})));
  const issues = containers.filter(needsAttention).length;
  $('summary').hidden = view !== 'containers' || (!snapshot && !fleet) || !hosts.length;
  $('total').textContent = containers.length;
  $('running').textContent = containers.filter(c => c.state === 'running').length;
  $('attention').textContent = issues;
  $('attention').className = issues ? 'has-issues' : '';
  const latest = fleet ? hosts.map(h=>h.snapshot?.receivedAt).filter(Boolean).sort().at(-1) : snapshot?.receivedAt;
  $('last').textContent = latest ? duration(age(latest)) + ' ago' : '—';
  $('last').title = latest ? new Date(latest).toLocaleString() : '';
  $('connection').textContent = stale ? 'Last known status' : fleet ? 'Latest across hosts' : 'Every 30 seconds';
  $('notice').hidden = !lastError && !stale && !setupSuccess;
  $('notice').className = 'alert' + (lastError ? ' error' : '');
  $('notice').textContent = lastError || (stale ? 'No report from ' + host.name + ' for ' + duration(age(snapshot.receivedAt)) + '. These are its last known states. Check the collector on this host.' : setupSuccess);
  const query = $('search').value.trim().toLowerCase();
  const visible = containers.filter(c => (!attentionOnly || needsAttention(c)) && (!query || [c.name,c.image,c.hostName,c.composeProject,c.composeService].join(' ').toLowerCase().includes(query)))
    .sort((a, b) => Number(needsAttention(b)) - Number(needsAttention(a)) || a.name.localeCompare(b.name));
  $('table-tools').hidden = view !== 'containers' || !containers.length;
  $('attention-filter').setAttribute('aria-pressed', String(attentionOnly));
  $('compose-group').setAttribute('aria-pressed',String(groupByProject));
  $('filter-count').textContent = issues;
  $('table-wrap').hidden = view !== 'containers' || !visible.length;
  $('table-footer').hidden = view !== 'containers' || !containers.length;
  $('row-count').textContent = visible.length + ' of ' + containers.length + ' containers';
  $('empty').hidden = view !== 'containers' || !!visible.length;
  $('empty-add').hidden = !loaded || !!host || !!lastError || !!hosts.length;
  $('clear-filters').hidden = !containers.length || !!visible.length;
  $('empty-logo').hidden = !!hosts.length || !loaded || !!lastError;
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
  } else if (!hosts.length) {
    $('empty-title').textContent = 'Connect your first Docker host';
    $('empty-copy').textContent = 'Deploy a collector with Docker Compose. Status arrives here over HTTPS, with no inbound ports required.';
  } else if (!snapshot && !fleet) {
    $('empty-title').textContent = 'Waiting for ' + host.name;
    $('empty-copy').textContent = 'Choose Continue setup for the Compose package and deployment steps. Check the collector logs if no report arrives.';
  } else if (!containers.length) {
    $('empty-title').textContent = 'No containers on this host';
    $('empty-copy').textContent = 'The latest report contains no containers, including stopped containers.';
  } else {
    $('empty-title').textContent = attentionOnly && !query ? 'No containers need attention' : 'No matching containers';
    $('empty-copy').textContent = attentionOnly && !query ? 'No unhealthy, restarting, or dead containers in the latest report.' : 'Try another name or image, or clear the filters to see all containers.';
  }
  renderRows(visible);
  renderPanels();
  updateEnrollment();
  updateMaintenance();
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
    if (selected !== null && !hosts.some(h => h.id === selected)) selected = null;
    loaded = true; lastError = '';
    $('poll-status').textContent = 'Refreshes every 15 seconds';
  } catch (error) {
    lastError = error.name === 'TimeoutError' ? 'The status request timed out. Last loaded data may be out of date. Try Refresh.' :
      error instanceof TypeError ? 'Unable to reach the dashboard. Check your connection, then try Refresh.' : error.message;
    $('poll-status').textContent = 'Refresh failed';
  } finally {
    loading = false; $('refresh').disabled = false; $('refresh-label').textContent = 'Refresh';
    render();
    if(view==='activity') loadHistory();
  }
}
function selectHost(id) {
  selected=id; attentionOnly=false; $('search').value=''; setupSuccess='';
  historyEvents=[]; historyError=''; historySequence++;
  render(); if(view==='activity') loadHistory();
}
function alerts() {
  const result=[];
  for(const h of hosts.filter(h=>selected===null || h.id===selected)) {
    const state=hostState(h);
    if(state==='Stale') result.push({host:h,text:'No report for '+duration(age(h.snapshot.receivedAt))+'. Container states are last known.'});
    if(!h.snapshot && age(h.createdAt)>600) result.push({host:h,text:'Enrollment has not received a first report. Continue setup or check collector logs.'});
    for(const c of h.snapshot?.containers||[]) if(needsAttention(c)) result.push({host:h,text:c.name+' · '+c.state+' · '+c.health+(state==='Stale'?' (last known)':'')});
  }
  return result;
}
function renderPanels() {
  for(const key of ['containers','activity','alerts']) $('view-'+key).setAttribute('aria-pressed',String(view===key));
  $('activity-panel').hidden=view!=='activity'; $('alerts-panel').hidden=view!=='alerts';
  const current=alerts(); $('alert-count').textContent=current.length;
  if(view==='alerts') {
    $('alerts-status').textContent=current.length?current.length+' current alert(s)':'No current alerts for this view.';
    $('alerts-list').replaceChildren(...current.map(a=>{const li=node('li');const button=node('button','event-link',a.host.name);button.onclick=()=>{view='containers';selectHost(a.host.id);};li.append(button,node('p','',a.text));if(inMaintenance(a.host))li.append(node('p','input-help',maintenanceText(a.host)));return li;}));
  }
  if(view==='activity') {
    $('activity-status').textContent=historyError || (historyLoading?'Loading recent activity…':!historyEvents.length?'No recent changes recorded. Activity will appear as reports arrive.':'Showing '+historyEvents.length+' recent events.');
    $('activity-list').replaceChildren(...historyEvents.map(e=>{const li=node('li'), time=node('time','event-time',new Date(e.at).toLocaleString());time.dateTime=e.at;li.append(time,node('strong','',e.hostName),node('p','',e.text));return li;}));
  }
}
async function loadHistory() {
  const sequence=++historySequence, id=selected;
  historyLoading=true; historyError='';renderPanels();
  try {
    const response=await fetch('/api/history'+(id?'?host='+encodeURIComponent(id):''),{cache:'no-store',signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw new Error('Unable to load activity. Try Refresh.');
    const data=await response.json();if(!Array.isArray(data.events))throw new Error('Unexpected activity response.');
    if(sequence===historySequence)historyEvents=data.events;
  }catch(error){if(sequence===historySequence)historyError=error.message;}
  finally{if(sequence===historySequence){historyLoading=false;renderPanels();}}
}
async function mutate(path,method,data) {
  const response=await fetch(path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(15000)});
  if(!response.ok){let error;try{error=await response.json();}catch{}throw new Error(error?.error||'The request failed. Try again.');}
  return response;
}
function showError(id,error) {$(id).textContent=error.message;$(id).hidden=false;}
function setupStage(stage) {
  for(const [index,id] of ['name','deploy','start','report'].entries()) {
    $('step-'+id).removeAttribute('aria-current');
    if(index===stage)$('step-'+id).setAttribute('aria-current','step');
  }
  $('setup-form').hidden=stage!==0; $('setup-deploy').hidden=stage!==1; $('setup-start').hidden=stage!==2; $('setup-wait').hidden=stage!==3;
}
function updateCommands() {
  const docker=$('sudo-docker').checked?'sudo docker':'docker';
  $('deploy-commands').textContent='cd /srv/docker/docker-dashboard-collector &&\n'+docker+' compose config --quiet &&\n'+docker+' compose up -d';
  $('transfer-commands').textContent='test ! -e /srv/docker/docker-dashboard-collector &&\nsudo install -d -m 0700 -o "$(id -u)" -g "$(id -g)" /srv/docker/docker-dashboard-collector &&\ncd /srv/docker/docker-dashboard-collector &&\n(umask 077\n tar --keep-old-files -xf ~/Downloads/crowsnest-collector.tar &&\n printf \'COLLECTOR_UID=%s\\nCOLLECTOR_GID=%s\\n\' "$(id -u)" "$(id -g)" > .env)';
  $('log-command').textContent='cd /srv/docker/docker-dashboard-collector\n'+docker+' compose logs --tail=30 collector';
}
function openSetup() {
  enrollmentId=null;
  $('setup-form').reset();$('sudo-docker').checked=true;$('hostname').setCustomValidity('');
  $('hostname').removeAttribute('aria-invalid');$('setup-message').hidden=true;
  setupStage(0);$('setup').showModal();$('hostname').focus();
}
async function preparePackage(response,name,resumed=false) {
  if(!$('setup').open){await response.body?.cancel();return;}
  const data=await response.json();
  if(!$('setup').open)return;
  if(!/^[a-f0-9-]{36}$/.test(data.hostId) || typeof data.setupCommand!=='string' || !data.setupCommand || typeof data.packageBase64!=='string')throw new Error('The setup response is incomplete. Close and choose Continue setup.');
  const archive=Uint8Array.from(atob(data.packageBase64),c=>c.charCodeAt(0));
  if(packageUrl)URL.revokeObjectURL(packageUrl);
  enrollmentId=data.hostId;setupCommand=data.setupCommand;
  $('setup-copy-text').value='';$('setup-copy-fallback').hidden=true;$('setup-copy-status').textContent='';$('transfer-details').open=false;
  $('copy-deploy').textContent='Copy start commands';$('copy-transfer').textContent='Copy commands';
  packageUrl=URL.createObjectURL(new Blob([archive],{type:'application/x-tar'}));
  $('package-download').href=packageUrl;$('setup-host-name').textContent=name;
  $('setup-expiry').textContent=resumed?'Start this collector within ten minutes. If that window expires, close and choose Continue setup again.':'';
  updateCommands(); setupStage(1);
  await refresh(name);
  if($('setup').open)$('copy-setup').focus();
}
function updateEnrollment() {
  if(enrollmentId && $('setup').open) {
    const host=hosts.find(h=>h.id===enrollmentId), connected=!!host?.snapshot;
    $('enrollment-title').textContent=connected?host.name+' is reporting':'Waiting for the first report';
    $('enrollment-status').textContent=connected?'Connected. The latest report contains '+host.snapshot.containers.length+' containers.':lastError||'Checking every 15 seconds while your collector starts.';
    $('enrollment-help').hidden=connected;$('log-command').parentElement.hidden=connected;
    $('finish-setup').textContent=connected?'View host':'Close';
    if(connected){const changed=$('setup-wait').hidden;setupStage(3);if(changed)$('finish-setup').focus();}
  }
  const managed=hosts.find(h=>h.id===managedId);
  if(rotationRevision!==null && managed) {
    $('rotation-status').textContent=managed.credentialRevision>rotationRevision?'Replacement activated. The previous reporting token is now invalid.':Date.now()>rotationExpiry?'Activation window expired. The original token is still valid; prepare new credentials to try again.':'Waiting for a report using the replacement. Apply this configuration within ten minutes.';
  }
}
async function resumeSetup() {
  const host=hosts.find(h=>h.id===selected);if(!host)return;
  openSetup();$('hostname').value=host.name;$('prepare').disabled=true;
  try{await preparePackage(await mutate('/api/hosts/'+host.id+'/collector','POST',{format:'setup'}),host.name,true);}
  catch(error){showError('setup-message',error);}
  finally{$('prepare').disabled=false;}
}
async function copyCommands(commandId,buttonId,label) {
  try{await navigator.clipboard.writeText($(commandId).textContent);$(buttonId).textContent='Copied';setTimeout(()=>$(buttonId).textContent=label,2000);}
  catch{showError('setup-message',new Error('Clipboard access was blocked. Select and copy the commands above.'));}
}
async function copySetup() {
  if(!setupCommand)return;
  try{await navigator.clipboard.writeText(setupCommand);$('setup-copy-fallback').hidden=true;$('setup-copy-text').value='';$('setup-copy-status').textContent='Copied. Paste and run in Bash on '+$('setup-host-name').textContent+'. Continue when the terminal says files are prepared.';}
  catch{$('setup-copy-status').textContent='Clipboard access was blocked. Copy the setup below.';$('setup-copy-fallback').hidden=false;$('setup-copy-text').value=setupCommand;$('setup-copy-text').focus();$('setup-copy-text').select();}
}
$('add').onclick=openSetup;$('empty-add').onclick=openSetup;
for(const id of ['cancel','cancel-bottom','finish-setup'])$(id).onclick=()=>{$('setup').close();};
$('setup').addEventListener('close',()=>{if(packageUrl){URL.revokeObjectURL(packageUrl);packageUrl=null;}setupCommand='';$('setup-copy-text').value='';$('setup-copy-fallback').hidden=true;$('setup-copy-status').textContent='';$('package-download').removeAttribute('href');});
$('refresh').onclick=()=>refresh();$('fleet-view').onclick=()=>selectHost(null);
$('search').oninput=render;$('sudo-docker').onchange=updateCommands;$('copy-setup').onclick=copySetup;
$('copy-deploy').onclick=()=>copyCommands('deploy-commands','copy-deploy','Copy start commands');
$('copy-transfer').onclick=()=>copyCommands('transfer-commands','copy-transfer','Copy commands');
$('files-prepared').onclick=()=>{setupStage(2);$('copy-deploy').focus();};
$('back-prepare').onclick=()=>{setupStage(1);$('copy-setup').focus();};
$('wait-report').onclick=()=>{setupStage(3);updateEnrollment();refresh();$('finish-setup').focus();};
$('back-deploy').onclick=()=>{setupStage(2);$('copy-deploy').focus();};
$('resume-setup').onclick=resumeSetup;
for(const key of ['containers','activity','alerts'])$('view-'+key).onclick=()=>{view=key;render();if(key==='activity')loadHistory();if(key==='alerts')loadNotifications();};
$('attention-filter').onclick=()=>{attentionOnly=!attentionOnly;render();};
$('compose-group').onclick=()=>{groupByProject=!groupByProject;render();};
$('clear-filters').onclick=()=>{attentionOnly=false;$('search').value='';render();$('search').focus();};
$('hostname').oninput=()=>{$('hostname').setCustomValidity('');$('hostname').removeAttribute('aria-invalid');};
$('setup-form').onsubmit=async event=>{
  event.preventDefault();const name=$('hostname').value.trim();
  if(!/^[a-zA-Z0-9][a-zA-Z0-9 ._-]{0,63}$/.test(name)){$('hostname').setCustomValidity('Start with a letter or number. Use letters, numbers, spaces, dots, dashes, or underscores.');$('hostname').reportValidity();return;}
  $('prepare').disabled=true;$('prepare').textContent='Preparing…';$('setup-message').hidden=true;
  try{await preparePackage(await mutate('/api/hosts','POST',{name,format:'setup'}),name);}
  catch(error){showError('setup-message',error);}
  finally{$('prepare').disabled=false;$('prepare').textContent='Prepare setup';}
};
$('manage-host').onclick=()=>{
  const host=hosts.find(h=>h.id===selected);if(!host)return;managedId=host.id;
  $('management-title').textContent='Manage '+host.name;$('rename-host').value=host.name;
  $('remove-name').value='';$('remove-host').disabled=true;$('remove-label').textContent='Enter “'+host.name+'” to confirm';
  $('management-message').hidden=true;$('rotation-result').hidden=true;
  $('collector-update').hidden=true;$('collector-update-command').value='';$('collector-update-status').textContent='';updateMaintenance();
  for(const details of $('management').querySelectorAll('details'))details.open=false;
  $('management').showModal();$('rename-host').focus();
};
$('close-management').onclick=()=>$('management').close();
$('management').addEventListener('close',()=>{if(configUrl){URL.revokeObjectURL(configUrl);configUrl=null;}$('config-download').removeAttribute('href');$('collector-update-command').value='';rotationRevision=null;});
function updateMaintenance() {
  const host=hosts.find(h=>h.id===managedId);if(!host)return;
  const active=inMaintenance(host);
  $('maintenance-status').textContent=active?maintenanceText(host)+'.':'Automatic notifications follow the fleet settings.';
  $('maintenance-end').hidden=!active;$('maintenance-save').textContent=active?'Reset pause timer':'Pause notifications';
}
async function setMaintenance(minutes) {
  $('maintenance-save').disabled=true;$('maintenance-end').disabled=true;$('management-message').hidden=true;
  try{await mutate('/api/hosts/'+managedId+'/maintenance','POST',{minutes});await refresh();}
  catch(error){showError('management-message',error);}
  finally{$('maintenance-save').disabled=false;$('maintenance-end').disabled=false;}
}
$('maintenance-save').onclick=()=>setMaintenance(Number($('maintenance-duration').value));
$('maintenance-end').onclick=()=>setMaintenance(0);
$('prepare-update').onclick=async()=>{
  $('prepare-update').disabled=true;$('management-message').hidden=true;
  try{const data=await (await mutate('/api/hosts/'+managedId+'/collector','POST',{format:'update'})).json();if(typeof data.updateCommand!=='string')throw new Error('Incomplete update response. Try again.');$('collector-update-command').value=data.updateCommand;$('collector-update').hidden=false;$('copy-update').focus();}
  catch(error){showError('management-message',error);}finally{$('prepare-update').disabled=false;}
};
$('copy-update').onclick=async()=>{
  try{await navigator.clipboard.writeText($('collector-update-command').value);$('collector-update-status').textContent='Copied. Paste and run on the host as the installation owner.';}
  catch{$('collector-update-status').textContent='Clipboard blocked. Select and copy the command above.';$('collector-update-command').focus();$('collector-update-command').select();}
};
$('rename-form').onsubmit=async event=>{
  event.preventDefault();$('rename-save').disabled=true;$('management-message').hidden=true;
  try{await mutate('/api/hosts/'+managedId,'PATCH',{name:$('rename-host').value.trim()});$('management').close();setupSuccess='Host name updated.';await refresh();}
  catch(error){showError('management-message',error);}finally{$('rename-save').disabled=false;}
};
$('remove-name').oninput=()=>{$('remove-host').disabled=$('remove-name').value!==hosts.find(h=>h.id===managedId)?.name;};
$('remove-host').onclick=async()=>{
  $('remove-host').disabled=true;
  try{await mutate('/api/hosts/'+managedId,'DELETE',{confirmName:$('remove-name').value});$('management').close();selected=null;setupSuccess='Host removed. Stop its collector on the host with docker compose down.';await refresh();}
  catch(error){showError('management-message',error);$('remove-host').disabled=false;}
};
$('rotate-token').onclick=async()=>{
  $('rotate-token').disabled=true;$('management-message').hidden=true;
  try {
    const response=await mutate('/api/hosts/'+managedId+'/collector','POST',{format:'config'});
    if(configUrl)URL.revokeObjectURL(configUrl);configUrl=URL.createObjectURL(await response.blob());
    $('config-download').href=configUrl;rotationRevision=hosts.find(h=>h.id===managedId)?.credentialRevision||0;rotationExpiry=Date.now()+600000;
    $('rotation-commands').textContent='cd /srv/docker/docker-dashboard-collector\ninstall -m 0600 ~/Downloads/collector.json ./collector.json\nsudo docker compose up -d --force-recreate collector';
    $('rotation-result').hidden=false;updateEnrollment();$('config-download').focus();
  }catch(error){showError('management-message',error);}finally{$('rotate-token').disabled=false;}
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
let notificationBusy=false, notificationConfigured=false;
function setSubscription(value) {
  let url;
  try{url=new URL(value);if(url.protocol!=='https:' || url.username || url.password || url.search || url.hash || !/^\/[a-zA-Z0-9_-]{1,64}$/.test(url.pathname))url=null;}catch{}
  $('notification-subscription').hidden=!url;$('notification-topic').value=url?url.href:'';
  $('subscription-status').textContent='';$('ntfy-android').removeAttribute('href');
  if(url)$('ntfy-android').href='ntfy://'+url.host+url.pathname+'?display=Crowsnest';
}
$('copy-topic').onclick=async()=>{
  try{await navigator.clipboard.writeText($('notification-topic').value);$('subscription-status').textContent='Topic URL copied. Add it as a subscription in ntfy.';}
  catch{$('subscription-status').textContent='Clipboard blocked. Select and copy the topic URL above.';$('notification-topic').focus();$('notification-topic').select();}
};
function notificationControls() {
  for(const id of ['notifications-enabled','notifications-recoveries','notifications-save','notifications-test'])$(id).disabled=notificationBusy || !notificationConfigured;
}
async function loadNotifications() {
  if(notificationBusy)return;
  notificationBusy=true;notificationControls();
  try {
    const response=await fetch('/api/notifications',{cache:'no-store',signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw new Error('Unable to load ntfy settings. Open Alerts again to retry.');
    const data=await response.json();notificationConfigured=data.configured;setSubscription(data.destination);
    $('notification-destination').textContent=data.destination?'Topic: '+data.destination:'ntfy is not configured. Set NTFY_URL and the secret NTFY_TOKEN in the Site runtime, then publish.';
    $('notifications-enabled').checked=data.enabled;$('notifications-recoveries').checked=data.recoveries;
    $('notification-delivery').textContent=data.lastError?'Delivery failed: '+data.lastError+'. Automatic alerts retry with backoff. Check ntfy access and the runtime token.':data.lastSuccessAt?'Last accepted by ntfy: '+new Date(data.lastSuccessAt).toLocaleString()+'.':'No notifications have been accepted yet.';
    $('notification-delivery').textContent+=' '+(data.lastSweepAt?'Last background check: '+new Date(data.lastSweepAt).toLocaleString()+'.':'No background check recorded. Configure a scheduled sweep for stale-host alerts.');
  }catch(error){notificationConfigured=false;setSubscription(null);$('notification-destination').textContent='Notification settings unavailable.';$('notification-message').textContent=error.message;}
  finally{notificationBusy=false;notificationControls();}
}
$('notification-form').onsubmit=async event=>{
  event.preventDefault();notificationBusy=true;notificationControls();$('notification-message').textContent='Saving…';
  try{await mutate('/api/notifications','PATCH',{enabled:$('notifications-enabled').checked,recoveries:$('notifications-recoveries').checked});$('notification-message').textContent='Settings saved. Changes apply to the whole fleet.';}
  catch(error){$('notification-message').textContent=error.message;}
  finally{notificationBusy=false;notificationControls();}
};
$('notifications-test').onclick=async()=>{
  notificationBusy=true;notificationControls();$('notification-message').textContent='Sending test…';
  try{await mutate('/api/notifications/test','POST',{});$('notification-message').textContent='Test accepted by ntfy. Check your subscribed devices.';}
  catch(error){$('notification-message').textContent=error.message;}
  finally{notificationBusy=false;notificationControls();await loadNotifications();}
};
refresh();
setInterval(() => {if (!document.hidden) refresh();}, 15000);
