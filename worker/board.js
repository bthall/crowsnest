let hosts = [], selected = null, loading = false, loaded = false;
let lastError = '', setupSuccess = '', attentionOnly = false;
let helpInitialized = false, groupByProject = false;
let view = 'containers', historyEvents = [], historyError = '', historyLoading = false, historySequence = 0;
let enrollmentId = null, packageUrl = null, configUrl = null, managedId = null, rotationRevision = null, rotationExpiry = 0;
let setupCommand = '', setupSession = 0, managementSession = 0;
let refreshPromise = null;
let hostGroup = '', groupOptionsKey = '';
let initialLinkApplied = false;
let resourceHost = null, resourceSamples = [], resourceError = '', resourceLoading = false, resourceSequence = 0, resourceController = null;
let availableCollectorVersion = null, collectorUpdateTarget = null, collectorUpdateRequestedAt = 0, collectorUpdatePreviousVersion = null, collectorUpdateBusy = false;
let collectorProtocol = null, minimumCollectorProtocol = null;
let detailSelection = null, detailEvents = [], detailHistoryError = '', detailHistoryLoading = false, detailHistorySequence = 0, detailHistoryController = null, detailLegacyMatches = false;
const $ = id => document.getElementById(id);
if(document.body.dataset.authMode==='standalone'){
  $('sign-out').hidden=false;
  $('sign-out').onclick=async()=>{
    $('sign-out').disabled=true;
    try{const response=await fetch('/auth/logout',{method:'POST',signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error();location.assign('/login');}
    catch{$('notice').hidden=false;$('notice').textContent='Unable to sign out. Check your connection and try again.';$('sign-out').disabled=false;}
  };
}
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
function groupMatches(host) {return !hostGroup || (hostGroup==='_ungrouped'?!host.group:host.group===hostGroup);}
function scopedHosts() {return hosts.filter(h=>selected!==null?h.id===selected:groupMatches(h));}
function syncGroupControl() {
  const groups=[...new Set(hosts.map(h=>h.group).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  const ungrouped=hosts.some(h=>!h.group), key=JSON.stringify([groups,ungrouped]);
  if(hostGroup && !(hostGroup==='_ungrouped'?ungrouped:groups.includes(hostGroup)))hostGroup='';
  if(selected && !groupMatches(hosts.find(h=>h.id===selected)||{}))hostGroup='';
  $('host-group-control').hidden=!groups.length;
  if(key!==groupOptionsKey){
    const options=[node('option','','All groups')];options[0].value='';
    for(const group of groups){const option=node('option','',group);option.value=group;options.push(option);}
    if(ungrouped && groups.length){const option=node('option','','Ungrouped');option.value='_ungrouped';options.push(option);}
    $('host-group-filter').replaceChildren(...options);groupOptionsKey=key;
  }
  $('host-group-filter').value=hostGroup;
}
function collectorInfo(host) {
  const version=host?.snapshot?.collectorVersion;
  const comparison=compareCollectorVersions(version,availableCollectorVersion);
  if(!host?.snapshot)return {text:'Collector awaiting first report',short:'',comparison};
  if(!validCollectorVersion(version))return {text:'Collector version unknown — update for version reporting',short:'Collector version unknown',comparison};
  const fresh=hostState(host)==='Reporting' && !lastError;
  const protocol=host.snapshot.collectorProtocol;
  const required=Number.isSafeInteger(protocol) && minimumCollectorProtocol!==null && protocol<minimumCollectorProtocol;
  const dashboardRequired=Number.isSafeInteger(protocol) && collectorProtocol!==null && protocol>collectorProtocol;
  const status=required?'update required for protocol compatibility':dashboardRequired?'dashboard update required for protocol compatibility':comparison===0?'current':comparison===-1?'update available to v'+availableCollectorVersion:comparison===1?'newer than the recommended collector':'available version unknown';
  return {text:'Collector v'+version+' · '+status+(fresh?'':' (last reported)'),short:'Collector v'+version+(required?' · update required':dashboardRequired?' · update dashboard':comparison===-1?' · update available':''),comparison,required,dashboardRequired};
}
function updaterInfo(host) {
  const status=host?.snapshot?.updateStatus;
  if(!status)return {policy:'Updater status not reported. Automatic updates require explicit setup on the host.',result:''};
  const suffix=hostState(host)==='Reporting' && !lastError?'':' (last reported)';
  const policy=(status.autoUpdates?'Automatic updates enabled on this host':'Automatic updates disabled; updates are manual')+suffix+'.';
  const results={updated:'Update succeeded',rolled_back:'Update failed; previous deployment restored',failed:'Update failed',rollback_failed:'Update and rollback failed; host intervention required',no_update:'No compatible update available'};
  let result=results[status.lastResult]||'No update attempt reported';
  if(status.fromVersion && status.toVersion)result+=' (v'+status.fromVersion+' → v'+status.toVersion+')';
  if(status.rollback==='succeeded' && status.lastResult!=='rolled_back')result+='; rollback succeeded';
  if(status.rollback==='failed' && status.lastResult!=='rollback_failed')result+='; rollback failed';
  if(status.lastAttempt)result+=' · '+reportDate(status.lastAttempt);
  return {policy,result:result+'.'};
}
function syncHosts() {
  const focusedHost=document.activeElement?.dataset.host;
  if (!hosts.length) {
    $('hosts').replaceChildren(node('p', '', loaded ? 'No hosts connected.' : 'Loading hosts…'));
    return;
  }
  const visibleHosts=hosts.filter(groupMatches),hostIds=new Set(visibleHosts.map(h=>h.id));
  for (const child of [...$('hosts').children])if(!hostIds.has(child.dataset.host))child.remove();
  const buttons=new Map([...$('hosts').children].map(child=>[child.dataset.host,child]));
  for (const host of visibleHosts) {
    let button = buttons.get(host.id);
    if (!button) {
      button = node('button', 'host');
      button.dataset.host = host.id;
      const name = node('span', 'host-name');
      name.append(node('strong'), node('span', 'host-issues'));
      button.append(name, node('span', 'host-state'),node('span','host-collector'),node('span','host-group-name'));
      button.onclick = () => {
        selectHost(host.id);
      };
      $('hosts').append(button);
      buttons.set(host.id,button);
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
    const collector=collectorInfo(host), collectorEl=button.querySelector('.host-collector');
    collectorEl.textContent=collector.short;collectorEl.className='host-collector'+(collector.comparison===-1?' warn':'');
    button.querySelector('.host-group-name').textContent=host.group||'';
  }
  const ordered=visibleHosts.map(h=>buttons.get(h.id));
  if(ordered.some((button,index)=>$('hosts').children[index]!==button))$('hosts').append(...ordered);
  if(focusedHost && document.activeElement?.dataset.host!==focusedHost)ordered.find(button=>button.dataset.host===focusedHost)?.focus({preventScroll:true});
}
function renderRows(containers) {
  const focused=document.activeElement?.classList.contains('container-link')?document.activeElement.dataset.containerKey:null;
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
    const lastKnown=c.stale || !!lastError;
    const row = node('tr', (needsAttention(c)?'row-attention ':'')+(lastKnown?'row-stale':'')), name = node('td');
    const observedAt=lastKnown?Date.parse(c.reportAt):Date.now();
    const uptime = c.state === 'running' && Date.parse(c.startedAt) > 0 ? duration(Math.max(0,Math.floor((observedAt-Date.parse(c.startedAt))/1000))) : '—';
    const link=node('button','container-link',c.name);
    link.dataset.containerKey=c.hostId+':'+c.id;link.setAttribute('aria-label','View '+c.name+' on '+c.hostName);link.onclick=()=>openContainerDetails(c.hostId,c.id);
    name.append(link, node('span', 'image', c.image));
    if(selected===null) name.append(node('span','row-host',c.hostName+(lastKnown?' · last known status':'')));
    if(c.composeService && c.composeService!==c.name)name.append(node('span','image','Service: '+c.composeService));
    name.append(node('span', 'mobile-details', 'Uptime ' + uptime + (lastKnown && uptime!=='—'?' at last report':'')+' · ' + c.restarts + ' restarts'));
    const state = node('td');
    state.append(node('span', 'pill ' + (c.state === 'running' ? 'good' : ['restarting', 'dead'].includes(c.state) ? 'bad' : ''), c.state));
    const health = node('td');
    health.append(node('span', c.health === 'none' ? 'no-check' : 'pill ' + (c.health === 'healthy' ? 'good' : c.health === 'unhealthy' ? 'bad' : 'warn'), c.health === 'none' ? 'No check' : c.health));
    const uptimeCell=node('td','desktop-detail',uptime);
    if(lastKnown && uptime!=='—')uptimeCell.append(node('span','uptime-note','At last report'));
    row.append(name, state, health, uptimeCell, node('td', 'desktop-detail number', c.restarts));
    rows.push(row);
    }
  }
  $('rows').replaceChildren(...rows);
  if(focused)[...$('rows').querySelectorAll('.container-link')].find(el=>el.dataset.containerKey===focused)?.focus({preventScroll:true});
}
function render() {
  syncGroupControl();
  syncHosts();
  $('fleet-view').className = 'host' + (selected === null ? ' selected' : '');
  $('fleet-view').setAttribute('aria-pressed', String(selected === null));
  const reporting = hosts.filter(h => hostState(h) === 'Reporting').length;
  const staleHosts = hosts.filter(h => hostState(h) === 'Stale').length;
  $('host-count').textContent = loaded ? (hostGroup?hosts.filter(groupMatches).length+' / ':'')+hosts.length : '—';
  $('fleet-summary').textContent = !loaded ? 'Loading your fleet…' : !hosts.length ? 'Connect a host to start watching your containers.' :
    hosts.length + (hosts.length === 1 ? ' host' : ' hosts') + ' · ' + reporting + ' reporting' + (staleHosts ? ' · ' + staleHosts + ' stale' : '');
  const host = hosts.find(h => h.id === selected), snapshot = host?.snapshot, fleet = selected === null;
  if(detailSelection && !hosts.some(h=>h.id===detailSelection.hostId))closeContainerDetails(false);
  const inspecting=!!detailSelection && view==='containers';
  $('container-details').hidden=!inspecting;
  $('collector-summary').hidden=!host;$('collector-summary').textContent=host?collectorInfo(host).text:'';
  const scope=scopedHosts(),paused=scope.filter(inMaintenance);
  $('maintenance-banner').hidden=!paused.length;
  $('maintenance-banner').textContent=host && paused.length?host.name+': '+maintenanceText(host)+'. Health and activity stay visible.':paused.length+' host'+(paused.length===1?' is':'s are')+' in maintenance. Automatic notifications are paused for those hosts; health and activity stay visible.';
  $('search').placeholder=fleet?'Search containers, images, or hosts':'Search containers or images';
  $('search').setAttribute('aria-label',$('search').placeholder);
  const stale = !!snapshot && age(snapshot.receivedAt) > 120;
  $('containers').setAttribute('aria-busy', String(!loaded && loading));
  $('host-title').textContent = host ? host.name : hostGroup?(hostGroup==='_ungrouped'?'Ungrouped':hostGroup)+' hosts':'All hosts';
  $('fleet-view').querySelector('strong').textContent=hostGroup?'All hosts in group':'All hosts';
  $('table-caption').textContent = host ? 'Containers on ' + host.name : hostGroup?'Containers in '+$('host-title').textContent:'Containers across all Docker hosts';
  $('engine').textContent = snapshot ? 'Docker Engine ' + snapshot.engineVersion : host ? 'Start the collector to begin reporting' : loaded ? 'Latest collector reports across your fleet' : 'Loading reports…';
  $('host-status').textContent = host ? hostState(host) : loaded ? scope.filter(h=>hostState(h)==='Reporting').length + ' reporting' : 'Loading';
  $('host-status').className = 'status' + (stale ? ' warn' : snapshot ? ' good' : '');
  $('manage-host').hidden = !host;
  $('resume-setup').hidden = !host || !!snapshot;
  const containers = scope.flatMap(h=>(h.snapshot?.containers||[]).map(c=>({...c,hostId:h.id,hostName:h.name,reportAt:h.snapshot.receivedAt,stale:hostState(h)==='Stale'})));
  const issues = containers.filter(needsAttention).length;
  $('summary').hidden = inspecting || view !== 'containers' || (!snapshot && !fleet) || !hosts.length;
  $('total').textContent = containers.length;
  $('running').textContent = containers.filter(c => c.state === 'running').length;
  $('attention').textContent = issues;
  $('attention').className = issues ? 'has-issues' : '';
  const latest = fleet ? scope.map(h=>h.snapshot?.receivedAt).filter(Boolean).sort().at(-1) : snapshot?.receivedAt;
  $('last').textContent = latest ? duration(age(latest)) + ' ago' : '—';
  $('last').title = latest ? new Date(latest).toLocaleString() : '';
  $('connection').textContent = stale ? 'Last known status' : fleet ? 'Latest across hosts' : 'Every 30 seconds';
  $('notice').hidden = !lastError && !stale && !setupSuccess;
  $('notice').className = 'alert' + (lastError ? ' error' : '');
  $('notice').textContent = lastError || (stale ? 'No report from ' + host.name + ' for ' + duration(age(snapshot.receivedAt)) + '. These are its last known states. Check the collector on this host.' : setupSuccess);
  const query = $('search').value.trim().toLowerCase();
  const visible = containers.filter(c => (!attentionOnly || needsAttention(c)) && (!query || [c.name,c.image,c.hostName,c.composeProject,c.composeService].join(' ').toLowerCase().includes(query)))
    .sort((a, b) => Number(needsAttention(b)) - Number(needsAttention(a)) || a.name.localeCompare(b.name));
  $('table-tools').hidden = inspecting || view !== 'containers' || !containers.length;
  $('attention-filter').setAttribute('aria-pressed', String(attentionOnly));
  $('compose-group').setAttribute('aria-pressed',String(groupByProject));
  $('filter-count').textContent = issues;
  $('table-wrap').hidden = inspecting || view !== 'containers' || !visible.length;
  $('table-footer').hidden = inspecting || view !== 'containers' || !containers.length;
  $('row-count').textContent = visible.length + ' of ' + containers.length + ' containers';
  $('empty').hidden = inspecting || view !== 'containers' || !!visible.length;
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
    $('empty-title').textContent = fleet?'No containers in this view':'No containers on this host';
    $('empty-copy').textContent = 'The latest report contains no containers, including stopped containers.';
  } else {
    $('empty-title').textContent = attentionOnly && !query ? 'No containers need attention' : 'No matching containers';
    $('empty-copy').textContent = attentionOnly && !query ? 'No unhealthy, restarting, or dead containers in the latest report.' : 'Try another name or image, or clear the filters to see all containers.';
  }
  if(view==='containers' && !inspecting)renderRows(visible);
  renderPanels();
  updateEnrollment();
  updateMaintenance();
  renderContainerDetails();
  renderResourceOverview();
  updateCollectorVersion();
}
async function refresh(selectName) {
  if(!refreshPromise)refreshPromise=loadHosts().finally(()=>{refreshPromise=null;});
  await refreshPromise;
  if(typeof selectName==='string'){
    const id=hosts.find(h=>h.name===selectName)?.id;
    if(id && id!==selected)selectHost(id);
  }
}
async function loadHosts() {
  const focused = document.activeElement;
  loading = true; $('refresh').disabled = true; $('refresh-label').textContent = 'Refreshing…';
  try {
    const response = await fetch('/api/hosts', {cache: 'no-store', signal: AbortSignal.timeout(10000)});
    if (response.status === 401 || response.status === 403) throw new Error('Your session needs attention. Sign in again, then refresh this page.');
    if (!response.ok) throw new Error('Unable to load current status. Last loaded data may be out of date. Try Refresh.');
    const data = await response.json();
    if (!Array.isArray(data.hosts)) throw new Error('Unexpected status response. Try Refresh.');
    hosts = data.hosts;availableCollectorVersion=validCollectorVersion(data.availableCollectorVersion)?data.availableCollectorVersion:null;
    collectorProtocol=Number.isSafeInteger(data.collectorProtocol) && data.collectorProtocol>0?data.collectorProtocol:null;
    minimumCollectorProtocol=Number.isSafeInteger(data.minimumCollectorProtocol) && data.minimumCollectorProtocol>0?data.minimumCollectorProtocol:null;
    if (selected !== null && !hosts.some(h => h.id === selected)) selected = null;
    loaded = true; lastError = '';
    if(!initialLinkApplied){initialLinkApplied=true;applyDashboardLink();}
    $('poll-status').textContent = 'Refreshes every 15 seconds';
  } catch (error) {
    lastError = error.name === 'TimeoutError' ? 'The status request timed out. Last loaded data may be out of date. Try Refresh.' :
      error instanceof TypeError ? 'Unable to reach the dashboard. Check your connection, then try Refresh.' : error.message;
    $('poll-status').textContent = 'Refresh failed';
  } finally {
    loading = false; $('refresh').disabled = false; $('refresh-label').textContent = 'Refresh';
    render();
    restoreFocus(focused, $('fleet-view'));
    if(view==='activity') loadHistory();
    if(detailSelection && !detailHistoryLoading)loadContainerHistory();
    if($('resource-history').open && (selected || detailSelection) && !resourceLoading)loadResourceHistory();
  }
}
function selectHost(id) {
  closeContainerDetails(false);
  selected=id; attentionOnly=false; $('search').value=''; setupSuccess='';
  setDashboardLink(id);
  historyEvents=[]; historyError=''; historySequence++;
  render(); if(view==='activity') loadHistory();
}
function setDashboardLink(hostId,containerId=null) {
  const url=new URL(location.href);
  for(const key of ['host','container'])url.searchParams.delete(key);
  if(hostId)url.searchParams.set('host',hostId);
  if(containerId)url.searchParams.set('container',containerId);
  history.replaceState(null,'',url.pathname+url.search);
}
function applyDashboardLink() {
  const params=new URLSearchParams(location.search),id=params.get('host'),containerId=params.get('container');
  if(!id)return;
  const host=hosts.find(h=>h.id===id);
  if(!host){setupSuccess='The linked host is no longer registered. Showing your fleet.';return;}
  view='containers';selectHost(id);
  if(containerId && /^[a-f0-9]{64}$/.test(containerId)) {
    if(host.snapshot?.containers.some(c=>c.id===containerId))openContainerDetails(id,containerId);
    else setupSuccess='The linked container is no longer in this host’s latest report. Showing '+host.name+'.';
  }
}
$('host-group-filter').onchange=()=>{hostGroup=$('host-group-filter').value;selectHost(null);};
function closeContainerDetails(restoreFocus=true) {
  const key=detailSelection?detailSelection.hostId+':'+detailSelection.containerId:null;
  detailSelection=null;detailHistorySequence++;detailHistoryController?.abort();detailHistoryLoading=false;
  if(restoreFocus)setDashboardLink(selected);
  $('container-details').hidden=true;
  if(restoreFocus){render();const link=[...$('rows').querySelectorAll('.container-link')].find(el=>el.dataset.containerKey===key);(link||(!$('table-tools').hidden?$('search'):$('containers'))).focus({preventScroll:true});}
}
function openContainerDetails(hostId,containerId) {
  const host=hosts.find(h=>h.id===hostId), container=host?.snapshot?.containers.find(c=>c.id===containerId);if(!container)return;
  detailHistoryController?.abort();detailHistorySequence++;
  detailSelection={hostId,containerId,lastKnown:container,lastSeenAt:host.snapshot.receivedAt};detailEvents=[];detailHistoryError='';detailLegacyMatches=false;detailHistoryLoading=false;
  setDashboardLink(hostId,containerId);
  $('detail-copy-status').textContent='';$('container-details').querySelector('details').open=false;
  render();$('detail-title').focus({preventScroll:true});$('container-details').scrollIntoView({block:'start'});loadContainerHistory();
}
function reportDate(value,fallback='Not recorded') {
  return Date.parse(value)>0?new Date(value).toLocaleString():fallback;
}
function formatCpu(value) {return value==null?'Unavailable':value.toLocaleString(undefined,{maximumFractionDigits:1})+'%';}
function formatBytes(value) {
  if(value==null)return 'Unavailable';
  if(value<1024)return value+' B';
  const units=['KiB','MiB','GiB','TiB','PiB'], power=Math.min(5,Math.floor(Math.log(value)/Math.log(1024)));
  return (value/1024**power).toLocaleString(undefined,{maximumFractionDigits:1})+' '+units[power-1];
}
function renderResourceOverview() {
  const host=hosts.find(h=>h.id===(detailSelection?.hostId||selected)), id=host?host.id+':'+(detailSelection?.containerId||''):null;
  if(resourceHost!==id){
    resourceHost=id;resourceSamples=[];resourceError='';resourceLoading=false;resourceSequence++;resourceController?.abort();
    $('resource-history').open=false;$('resource-readings').open=false;
  }
  $('resource-history').hidden=!host || view!=='containers';
  if(!host)return;
  const report=host.snapshot, running=report?.containers.filter(c=>c.state==='running')||[];
  const container=detailSelection?report?.containers.find(c=>c.id===detailSelection.containerId):null;
  const total=key=>detailSelection?(container?.state==='running'?container.resources?.[key]:null):report?.resourceSampling && running.every(c=>c.resources?.[key]!=null)?running.reduce((n,c)=>n+c.resources[key],0):null;
  $('resource-title').textContent=detailSelection?'Resource history · '+detailSelection.lastKnown.name:'Container resources';
  $('resource-help').textContent=detailSelection?'Readings belong to this full container ID. A replacement container starts its own history.':'Running-container totals for this host; these are container workloads, not whole-host utilization.';
  $('resource-caption').textContent=detailSelection?'Resource readings for '+detailSelection.lastKnown.name:'Container workload measurements for this host';
  const lastKnown=hostState(host)==='Stale' || !!lastError;
  $('resource-current').textContent=report?'CPU '+formatCpu(total('cpuPercent'))+' · Memory '+formatBytes(total('memoryBytes'))+(lastKnown?' · last reported':''):'Awaiting first report';
  const warnings={warming:'CPU needs two valid readings and may be warming up. Available memory is shown now.',partial:'Some resource measurements are missing. Host totals are unavailable when a running container is missing a measurement.',unavailable:'Resource measurements are unavailable. Update both collector files, then check the restricted proxy and Docker API.',unsupported:'This Docker API does not support bounded resource sampling. Container status still reports.',report_limit:'Resource measurements were omitted to keep this report within the size limit.'};
  $('resource-warning').textContent=!report?'Start this host’s collector to begin reporting.':!report.resourceSampling?'This collector does not report resources yet. Use Manage host → Update collector.':warnings[report.resourceSampling]||'';
  if(lastKnown)$('resource-warning').textContent+=' Values are from the last report at '+reportDate(report?.receivedAt)+'.';
  if($('resource-history').open)renderResourceHistory();
}
function resourceChart(key,label,format) {
  const figure=node('figure');figure.append(node('figcaption','',label));
  const width=Math.max(240,Math.round($('resource-charts').clientWidth/(matchMedia('(max-width: 700px)').matches?1:2)-12)),height=170;
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox','0 0 '+width+' '+height);svg.setAttribute('role','img');svg.setAttribute('aria-label',label+' over the last 24 hours. Missing readings leave gaps. Values are in the readings table.');
  const make=(tag,attributes,text)=>{const el=document.createElementNS(svg.namespaceURI,tag);for(const [k,v] of Object.entries(attributes))el.setAttribute(k,String(v));if(text!==undefined)el.textContent=text;svg.append(el);return el;};
  const values=resourceSamples.map(s=>s[key]).filter(v=>v!==null && Number.isFinite(v));
  const maximum=Math.max(key==='cpuPercent'?100:1048576,...values), magnitude=10**Math.floor(Math.log10(maximum)), ceiling=Math.ceil(maximum/magnitude)*magnitude;
  const left=4,right=width-4,top=26,bottom=136,end=Date.now(),start=end-86400000;
  for(const fraction of [0,0.5,1])make('line',{x1:left,y1:bottom-(bottom-top)*fraction,x2:right,y2:bottom-(bottom-top)*fraction,class:'chart-grid'});
  make('text',{x:left,y:14,class:'chart-label'},format(ceiling));
  make('text',{x:left,y:bottom-5,class:'chart-label'},'0');
  const clock=value=>new Date(value).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'});
  make('text',{x:left,y:159,class:'chart-label'},'Yesterday '+clock(start));
  make('text',{x:right,y:159,'text-anchor':'end',class:'chart-label'},'Today '+clock(end));
  let path='',previousWindow=null;
  for(const sample of resourceSamples) {
    const at=Date.parse(sample.at), value=sample[key],window=Math.floor(at/300000);
    if(value===null || !Number.isFinite(value) || at<start || at>end){previousWindow=null;continue;}
    const x=left+(at-start)/86400000*(right-left),y=bottom-value/ceiling*(bottom-top);
    path+=(previousWindow===window-1?' L':' M')+x.toFixed(2)+' '+y.toFixed(2);
    // Isolated reports remain visible without bridging missing windows.
    make('circle',{cx:x,cy:y,r:1.8,class:'chart-point'+(key==='memoryBytes'?' chart-memory':'')});
    previousWindow=window;
  }
  if(path)make('path',{d:path,class:'chart-series'+(key==='memoryBytes'?' chart-memory':'')});
  if(!values.length)make('text',{x:width/2,y:85,'text-anchor':'middle',class:'chart-label'},'No measured values yet');
  figure.append(svg);return figure;
}
function renderResourceHistory() {
  $('resource-status').textContent=resourceError || (resourceLoading?'Loading resource history…':resourceSamples.length?resourceSamples.length+' retained reading'+(resourceSamples.length===1?'':'s')+'. Times use your local timezone.':detailSelection?'No resource history for this container yet. Readings begin after the dashboard update; earlier host totals cannot be attributed to a container.':'No resource history yet. Readings start with a collector that reports resources.');
  $('resource-retry').hidden=!resourceError;$('resource-retry').disabled=resourceLoading;
  $('resource-readings').hidden=!resourceSamples.length;
  $('resource-charts').hidden=!resourceSamples.length;
  $('resource-values').replaceChildren(...[...resourceSamples].reverse().map(s=>{const row=node('tr');row.append(node('td','',reportDate(s.at)),node('td','',formatCpu(s.cpuPercent)),node('td','',formatBytes(s.memoryBytes)),node('td','',s.sampling||'Unknown'));return row;}));
  $('resource-charts').replaceChildren(...resourceSamples.length?[resourceChart('cpuPercent','Container CPU',formatCpu),resourceChart('memoryBytes','Container memory',formatBytes)]:[]);
}
async function loadResourceHistory() {
  const id=detailSelection?.hostId||selected,container=detailSelection?.containerId;if(!id || !$('resource-history').open)return;
  const sequence=++resourceSequence, focused=document.activeElement;resourceController?.abort();resourceController=new AbortController();resourceLoading=true;resourceError='';renderResourceHistory();
  try {
    const response=await fetch('/api/resources?host='+encodeURIComponent(id)+(container?'&container='+encodeURIComponent(container):''),{cache:'no-store',signal:AbortSignal.any([resourceController.signal,AbortSignal.timeout(10000)])});
    if(!response.ok)throw new Error('Unable to refresh resource history. Earlier readings may be out of date. Choose Retry resources.');
    const data=await response.json();if(!Array.isArray(data.samples))throw new Error('Unexpected resource response. Choose Retry resources.');
    if(sequence===resourceSequence)resourceSamples=data.samples;
  }catch(error){if(sequence===resourceSequence && error.name!=='AbortError')resourceError=error.name==='TimeoutError'?'Resource request timed out. Choose Retry resources.':error.message;}
  finally{if(sequence===resourceSequence){resourceLoading=false;renderResourceHistory();restoreFocus(focused, $('resource-history').querySelector('summary'));}}
}
$('resource-history').addEventListener('toggle',()=>{if($('resource-history').open)loadResourceHistory();else{resourceSequence++;resourceController?.abort();resourceLoading=false;}});
$('resource-retry').onclick=loadResourceHistory;
function renderContainerDetails() {
  if(!detailSelection)return;
  const host=hosts.find(h=>h.id===detailSelection.hostId);if(!host)return;
  const current=host.snapshot?.containers.find(c=>c.id===detailSelection.containerId);
  if(current){detailSelection.lastKnown=current;detailSelection.lastSeenAt=host.snapshot.receivedAt;}
  const c=current||detailSelection.lastKnown, stale=hostState(host)==='Stale';
  $('detail-title').textContent=c.name;$('detail-host').textContent=host.name+' · Docker Engine '+(host.snapshot?.engineVersion||'unknown');
  $('detail-status').textContent=!current?'No longer reported':stale?'Last known status':needsAttention(c)?'Needs attention':'Reported';
  $('detail-status').className='pill '+(!current||stale?'warn':needsAttention(c)?'bad':'');
  const warning=lastError || (!current?'This container is missing from the latest report. The information below is its last reported state. It may have been removed or replaced.':stale?'The host has not reported for '+duration(age(host.snapshot.receivedAt))+'. These are last known values.':'');
  $('detail-warning').hidden=!warning;$('detail-warning').textContent=warning;
  $('detail-image').textContent=c.image;$('detail-state').textContent=c.state;
  $('detail-health').textContent=c.health==='none'?'No Docker health check':c.health;
  $('detail-restarts').textContent=c.restarts;$('detail-started').textContent=reportDate(c.startedAt,'Not started');$('detail-finished').textContent=reportDate(c.finishedAt,'No finish recorded');
  const resourceNote=c.state!=='running'?'Not running':!c.resources?(host.snapshot?.resourceSampling?'Unavailable in this report':'Not reported — update collector'):null;
  $('detail-cpu').textContent=resourceNote || (c.resources.cpuPercent===null?'Warming up or unavailable':formatCpu(c.resources.cpuPercent)+(c.resources.sampleSeconds?' over '+duration(Math.round(c.resources.sampleSeconds)):''));
  $('detail-memory').textContent=resourceNote || formatBytes(c.resources.memoryBytes);
  $('detail-memory-limit').textContent=resourceNote || formatBytes(c.resources.memoryLimitBytes);
  const live=!!current && !stale && !lastError;
  $('detail-uptime').textContent=c.state==='running' && Date.parse(c.startedAt)>0?duration(Math.max(0,Math.floor(((live?Date.now():Date.parse(detailSelection.lastSeenAt))-Date.parse(c.startedAt))/1000)))+(live?'':' (at last report)'):'Not running';
  $('detail-project').textContent=c.composeProject===undefined?'Not reported by this collector':c.composeProject||'Standalone container';
  $('detail-service').textContent=c.composeService===undefined?'Not reported by this collector':c.composeService||'None';
  $('detail-report').textContent=reportDate(detailSelection.lastSeenAt)+' · '+duration(age(detailSelection.lastSeenAt))+' ago';$('detail-id').textContent=c.id;
  $('detail-history-status').textContent=detailHistoryError || (detailHistoryLoading?'Loading recent changes…':detailEvents.length?detailEvents.length+' retained change'+(detailEvents.length===1?'':'s')+'.':'No retained changes for this container. New changes appear as reports arrive.');
  $('detail-history-retry').hidden=!detailHistoryError;$('detail-history-retry').disabled=detailHistoryLoading;
  $('detail-history-legacy').hidden=!detailLegacyMatches;
  $('detail-history').replaceChildren(...detailEvents.map(e=>{const li=node('li'),time=node('time','event-time',reportDate(e.at));time.dateTime=e.at;li.append(time,node('p','',e.text));if(e.matchedBy==='name')li.append(node('p','input-help','Earlier event matched by name'));return li;}));
}
async function loadContainerHistory() {
  if(!detailSelection)return;
  const sequence=++detailHistorySequence,{hostId,containerId}=detailSelection, focused=document.activeElement;
  detailHistoryController?.abort();detailHistoryController=new AbortController();
  detailHistoryLoading=true;detailHistoryError='';renderContainerDetails();
  try {
    const response=await fetch('/api/history?host='+encodeURIComponent(hostId)+'&container='+encodeURIComponent(containerId),{cache:'no-store',signal:AbortSignal.any([detailHistoryController.signal,AbortSignal.timeout(10000)])});
    if(!response.ok)throw new Error('Unable to refresh activity. Previously loaded events may be out of date. Choose Retry activity.');
    const data=await response.json();if(!Array.isArray(data.events))throw new Error('Unexpected activity response. Choose Retry activity.');
    if(sequence===detailHistorySequence){detailEvents=data.events;detailLegacyMatches=!!data.legacyMatches;}
  }catch(error){if(sequence===detailHistorySequence && error.name!=='AbortError')detailHistoryError=error.name==='TimeoutError'?'Activity request timed out. Choose Retry activity.':error.message;}
  finally{if(sequence===detailHistorySequence){detailHistoryLoading=false;renderContainerDetails();restoreFocus(focused, $('detail-title'));}}
}
$('close-details').onclick=()=>closeContainerDetails();$('detail-history-retry').onclick=loadContainerHistory;
$('container-details').addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();closeContainerDetails();}});
$('copy-container-id').onclick=async()=>{
  const selection=detailSelection,id=$('detail-id').textContent;if(!selection)return;
  try{await navigator.clipboard.writeText(id);if(detailSelection===selection)$('detail-copy-status').textContent='Container ID copied.';}
  catch{if(detailSelection!==selection)return;const range=document.createRange();range.selectNodeContents($('detail-id'));const selectedText=window.getSelection();selectedText.removeAllRanges();selectedText.addRange(range);$('detail-copy-status').textContent='Clipboard blocked. Copy the selected container ID.';}
};
function updateCollectorVersion() {
  const host=hosts.find(h=>h.id===managedId);if(!host)return;
  const info=collectorInfo(host);
  const updater=updaterInfo(host);
  $('managed-collector-version').textContent=info.text;
  $('managed-collector-freshness').textContent=host.snapshot?'Last report: '+reportDate(host.snapshot.receivedAt)+'. Recommended collector: '+(availableCollectorVersion?'v'+availableCollectorVersion:'unknown')+'.':'The first report will show this collector’s version.';
  $('managed-auto-updates').textContent=updater.policy;
  $('managed-update-result').textContent=updater.result;
  $('prepare-update').disabled=collectorUpdateBusy || info.comparison===1 || info.dashboardRequired;
  if(info.comparison===1)$('managed-collector-freshness').textContent+=' This collector is newer; update the dashboard before preparing an older collector.';
  if(collectorUpdateTarget){
    const confirmed=host.snapshot?.collectorVersion===collectorUpdateTarget && Date.parse(host.snapshot.receivedAt)>collectorUpdateRequestedAt;
    $('collector-update-confirmation').textContent=collectorUpdatePreviousVersion===collectorUpdateTarget?'The collector already reports v'+collectorUpdateTarget+'.':confirmed?'Version confirmed: this host reported v'+collectorUpdateTarget+' at '+reportDate(host.snapshot.receivedAt)+'.':'Run the copied command on this host. Waiting for a report with v'+collectorUpdateTarget+'.';
  }
}
function alerts() {
  const result=[];
  for(const h of scopedHosts()) {
    const state=hostState(h);
    if(state==='Stale') result.push({host:h,text:'No report for '+duration(age(h.snapshot.receivedAt))+'. Container states are last known.'});
    if(!h.snapshot && age(h.createdAt)>600) result.push({host:h,text:'Enrollment has not received a first report. Continue setup or check collector logs.'});
    for(const c of h.snapshot?.containers||[]) if(needsAttention(c)) result.push({host:h,containerId:c.id,text:c.name+' · '+c.state+' · '+c.health+(state==='Stale'?' (last known)':'')});
    if(state!=='Stale' && !lastError)for(const signal of h.alertSignals||[])result.push({host:h,containerId:signal.containerId,text:signal.text});
  }
  return result;
}
function renderPanels() {
  for(const key of ['containers','activity','alerts']) $('view-'+key).setAttribute('aria-pressed',String(view===key));
  $('activity-panel').hidden=view!=='activity'; $('alerts-panel').hidden=view!=='alerts';
  const current=alerts(); $('alert-count').textContent=current.length;
  if(view==='alerts') {
    $('alerts-status').textContent=current.length?current.length+' current alert(s)':'No current alerts for this view.';
    $('alerts-list').replaceChildren(...current.map(a=>{const li=node('li');const button=node('button','event-link',a.host.name);button.setAttribute('aria-label','View '+a.host.name+': '+a.text);button.onclick=()=>{view='containers';selectHost(a.host.id);if(a.containerId)openContainerDetails(a.host.id,a.containerId);};li.append(button,node('p','',a.text));if(inMaintenance(a.host))li.append(node('p','input-help',maintenanceText(a.host)));return li;}));
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
    const response=await fetch('/api/history'+(id?'?host='+encodeURIComponent(id):hostGroup?'?group='+encodeURIComponent(hostGroup):''),{cache:'no-store',signal:AbortSignal.timeout(10000)});
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
function restoreFocus(focused, fallback) {
  if (document.activeElement && document.activeElement !== document.body) return;
  const available = element => element && typeof element.focus === 'function' && document.body.contains(element) && !element.disabled && !element.closest('[hidden], [inert]') && element.getClientRects().length > 0;
  const target = available(focused) ? focused : available(fallback) ? fallback : null;
  target?.focus({preventScroll: true});
}
function setupStage(stage) {
  for(const [index,id] of ['name','deploy','start','report'].entries()) {
    $('step-'+id).removeAttribute('aria-current');
    $('step-'+id).dataset.complete=String(index<stage);
    if(index===stage)$('step-'+id).setAttribute('aria-current','step');
  }
  const name=$('setup-host-name').textContent;
  $('setup-description').textContent=stage===0?'Name your host here. Prepare and start its collector in a terminal on that host.':stage===3?'Crowsnest checks for a real collector report from '+name+'.':'Run these steps in a terminal on '+name+', then continue here.';
  $('setup-form').hidden=stage!==0; $('setup-deploy').hidden=stage!==1; $('setup-start').hidden=stage!==2; $('setup-wait').hidden=stage!==3;
}
function updateCommands() {
  const docker=$('sudo-docker').checked?'sudo docker':'docker';
  $('deploy-commands').textContent='cd /srv/docker/crowsnest-collector &&\n'+docker+' compose config --quiet &&\n'+docker+' compose up -d';
  $('transfer-commands').textContent='test ! -e /srv/docker/crowsnest-collector &&\nsudo install -d -m 0700 -o "$(id -u)" -g "$(id -g)" /srv/docker/crowsnest-collector &&\ncd /srv/docker/crowsnest-collector &&\n(umask 077\n tar --keep-old-files -xf ~/Downloads/crowsnest-collector.tar &&\n printf \'COLLECTOR_UID=%s\\nCOLLECTOR_GID=%s\\n\' "$(id -u)" "$(id -g)" > .env)';
  $('log-command').textContent='cd /srv/docker/crowsnest-collector\n'+docker+' compose logs --tail=30 collector';
}
function openSetup() {
  setupSession++;enrollmentId=null;clearSetupPackage();
  $('prepare').disabled=false;$('prepare').textContent='Prepare setup';
  $('setup-form').reset();$('sudo-docker').checked=true;$('hostname').setCustomValidity('');
  $('hostname').removeAttribute('aria-invalid');$('setup-message').hidden=true;
  setupStage(0);$('setup').showModal();$('hostname').focus();
}
function setupCurrent(session) {return $('setup').open && setupSession===session;}
function managementCurrent(session,id) {return $('management').open && managementSession===session && managedId===id;}
function clearSetupPackage() {
  if(packageUrl){URL.revokeObjectURL(packageUrl);packageUrl=null;}
  setupCommand='';$('setup-copy-text').value='';$('setup-copy-fallback').hidden=true;$('setup-copy-status').textContent='';$('deploy-copy-status').textContent='';$('transfer-copy-status').textContent='';$('package-download').removeAttribute('href');
}
async function preparePackage(response,name,resumed,session) {
  if(!setupCurrent(session)){await response.body?.cancel();return;}
  const data=await response.json();
  if(!setupCurrent(session))return;
  if(!/^[a-f0-9-]{36}$/.test(data.hostId) || typeof data.setupCommand!=='string' || !data.setupCommand || typeof data.packageBase64!=='string')throw new Error('The setup response is incomplete. Close and choose Continue setup.');
  const archive=Uint8Array.from(atob(data.packageBase64),c=>c.charCodeAt(0));
  if(packageUrl)URL.revokeObjectURL(packageUrl);
  enrollmentId=data.hostId;setupCommand=data.setupCommand;
  $('setup-copy-text').value='';$('setup-copy-fallback').hidden=true;$('setup-copy-status').textContent='';$('deploy-copy-status').textContent='';$('transfer-copy-status').textContent='';$('transfer-details').open=false;
  $('copy-deploy').textContent='Copy start commands';$('copy-transfer').textContent='Copy commands';
  packageUrl=URL.createObjectURL(new Blob([archive],{type:'application/x-tar'}));
  $('package-download').href=packageUrl;$('setup-host-name').textContent=name;
  $('setup-terminal-host').textContent=name;$('setup-start-host').textContent=name;
  $('setup-expiry').textContent=resumed?'Start this collector within ten minutes. If that window expires, close and choose Continue setup again.':'';
  updateCommands(); setupStage(1);
  await refresh();
  if(setupCurrent(session)){selectHost(data.hostId);$('copy-setup').focus();}
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
  const session=setupSession;
  try{await preparePackage(await mutate('/api/hosts/'+host.id+'/collector','POST',{format:'setup'}),host.name,true,session);}
  catch(error){if(setupCurrent(session))showError('setup-message',error);}
  finally{if(setupCurrent(session))$('prepare').disabled=false;}
}
async function copyCommands(commandId,buttonId,statusId,label,actionName) {
  const session=setupSession,command=$(commandId).textContent,name=$('setup-host-name').textContent;
  try{await navigator.clipboard.writeText(command);if(!setupCurrent(session))return;$(buttonId).textContent='Copied';if(statusId)$(statusId).textContent=actionName+' copied. Paste and run in Bash on '+name+'.';setTimeout(()=>{if(setupCurrent(session))$(buttonId).textContent=label;},2000);}
  catch{if(!setupCurrent(session))return;if(statusId)$(statusId).textContent='Clipboard access was blocked. Select and copy the commands above.';else showError('setup-message',new Error('Clipboard access was blocked. Select and copy the commands above.'));}
}
async function copySetup() {
  if(!setupCommand)return;
  const session=setupSession,command=setupCommand,name=$('setup-host-name').textContent;
  try{await navigator.clipboard.writeText(command);if(!setupCurrent(session))return;$('setup-copy-fallback').hidden=true;$('setup-copy-text').value='';$('setup-copy-status').textContent='Copied. Paste and run in Bash on '+name+'. Continue when the terminal says files are prepared.';}
  catch{if(!setupCurrent(session))return;$('setup-copy-status').textContent='Clipboard access was blocked. Copy the setup below.';$('setup-copy-fallback').hidden=false;$('setup-copy-text').value=command;$('setup-copy-text').focus();$('setup-copy-text').select();}
}
$('add').onclick=openSetup;$('empty-add').onclick=openSetup;
for(const id of ['cancel','cancel-bottom','finish-setup'])$(id).onclick=()=>{$('setup').close();};
$('setup').addEventListener('close',()=>{if($('setup').open)return;setupSession++;enrollmentId=null;clearSetupPackage();});
$('refresh').onclick=()=>refresh();$('fleet-view').onclick=()=>selectHost(null);
$('search').oninput=render;$('sudo-docker').onchange=updateCommands;$('copy-setup').onclick=copySetup;
$('copy-deploy').onclick=()=>copyCommands('deploy-commands','copy-deploy','deploy-copy-status','Copy start commands','Start commands');
$('copy-transfer').onclick=()=>copyCommands('transfer-commands','copy-transfer','transfer-copy-status','Copy commands','Extract commands');
$('files-prepared').onclick=()=>{setupStage(2);$('copy-deploy').focus();};
$('back-prepare').onclick=()=>{setupStage(1);$('copy-setup').focus();};
$('wait-report').onclick=()=>{setupStage(3);updateEnrollment();refresh();$('finish-setup').focus();};
$('back-deploy').onclick=()=>{setupStage(2);$('copy-deploy').focus();};
$('resume-setup').onclick=resumeSetup;
for(const key of ['containers','activity','alerts'])$('view-'+key).onclick=()=>{closeContainerDetails(false);view=key;render();if(key==='activity')loadHistory();if(key==='alerts')loadNotifications();};
$('attention-filter').onclick=()=>{attentionOnly=!attentionOnly;render();};
$('compose-group').onclick=()=>{groupByProject=!groupByProject;render();};
$('clear-filters').onclick=()=>{attentionOnly=false;$('search').value='';render();$('search').focus();};
$('hostname').oninput=()=>{$('hostname').setCustomValidity('');$('hostname').removeAttribute('aria-invalid');};
$('setup-form').onsubmit=async event=>{
  event.preventDefault();const name=$('hostname').value.trim();
  if(!/^[a-zA-Z0-9][a-zA-Z0-9 ._-]{0,63}$/.test(name)){$('hostname').setCustomValidity('Start with a letter or number. Use letters, numbers, spaces, dots, dashes, or underscores.');$('hostname').reportValidity();return;}
  $('prepare').disabled=true;$('prepare').textContent='Preparing…';$('setup-message').hidden=true;
  const session=setupSession;
  try{await preparePackage(await mutate('/api/hosts','POST',{name,format:'setup'}),name,false,session);}
  catch(error){if(setupCurrent(session))showError('setup-message',error);}
  finally{if(setupCurrent(session)){$('prepare').disabled=false;$('prepare').textContent='Prepare setup';}}
};
$('manage-host').onclick=()=>{
  const host=hosts.find(h=>h.id===selected);if(!host)return;managementSession++;managedId=host.id;
  collectorUpdateBusy=false;for(const id of ['rename-save','maintenance-save','maintenance-end','rotate-token'])$(id).disabled=false;
  $('management-title').textContent='Manage '+host.name;$('rename-host').value=host.name;
  $('rename-group').value=host.group||'';
  $('host-groups').replaceChildren(...[...new Set(hosts.map(h=>h.group).filter(Boolean))].sort().map(group=>{const option=node('option');option.value=group;return option;}));
  $('remove-name').value='';$('remove-host').disabled=true;$('remove-label').textContent='Enter “'+host.name+'” to confirm';
  $('management-message').hidden=true;$('rotation-result').hidden=true;
  $('collector-update').hidden=true;$('collector-update-command').value='';$('collector-update-status').textContent='';$('collector-update-confirmation').textContent='';collectorUpdateTarget=null;updateMaintenance();updateCollectorVersion();
  for(const details of $('management').querySelectorAll('details'))details.open=false;
  $('management').showModal();$('rename-host').focus();
};
$('close-management').onclick=()=>$('management').close();
$('management').addEventListener('close',()=>{if($('management').open)return;managementSession++;managedId=null;if(configUrl){URL.revokeObjectURL(configUrl);configUrl=null;}$('config-download').removeAttribute('href');$('collector-update-command').value='';collectorUpdateTarget=null;rotationRevision=null;});
function updateMaintenance() {
  const host=hosts.find(h=>h.id===managedId);if(!host)return;
  const active=inMaintenance(host);
  $('maintenance-status').textContent=active?maintenanceText(host)+'.':'Automatic notifications follow the fleet settings.';
  $('maintenance-end').hidden=!active;$('maintenance-save').textContent=active?'Reset pause timer':'Pause notifications';
}
async function setMaintenance(minutes) {
  const id=managedId, session=managementSession, focused=document.activeElement;
  $('maintenance-save').disabled=true;$('maintenance-end').disabled=true;$('management-message').hidden=true;
  try{await mutate('/api/hosts/'+id+'/maintenance','POST',{minutes});await refresh();}
  catch(error){if(managementCurrent(session,id))showError('management-message',error);}
  finally{if(managementCurrent(session,id)){$('maintenance-save').disabled=false;$('maintenance-end').disabled=false;restoreFocus(focused);}}
}
$('maintenance-save').onclick=()=>setMaintenance(Number($('maintenance-duration').value));
$('maintenance-end').onclick=()=>setMaintenance(0);
$('prepare-update').onclick=async()=>{
  const id=managedId, session=managementSession;collectorUpdateBusy=true;$('prepare-update').disabled=true;$('management-message').hidden=true;
  try{const data=await (await mutate('/api/hosts/'+id+'/collector','POST',{format:'update'})).json();if(!managementCurrent(session,id))return;if(typeof data.updateCommand!=='string' || !validCollectorVersion(data.collectorVersion))throw new Error('Incomplete update response. Try again.');collectorUpdateTarget=data.collectorVersion;collectorUpdateRequestedAt=Date.parse(hosts.find(h=>h.id===id)?.snapshot?.receivedAt)||0;collectorUpdatePreviousVersion=hosts.find(h=>h.id===id)?.snapshot?.collectorVersion;$('collector-update-command').value=data.updateCommand;$('collector-update').hidden=false;updateCollectorVersion();$('copy-update').focus();}
  catch(error){if(managementCurrent(session,id))showError('management-message',error);}finally{if(managementCurrent(session,id)){collectorUpdateBusy=false;updateCollectorVersion();}}
};
$('copy-update').onclick=async()=>{
  const session=managementSession,id=managedId,command=$('collector-update-command').value;
  try{await navigator.clipboard.writeText(command);if(managementCurrent(session,id))$('collector-update-status').textContent='Copied. Paste and run on the host as the installation owner.';}
  catch{if(!managementCurrent(session,id))return;$('collector-update-status').textContent='Clipboard blocked. Select and copy the command above.';$('collector-update-command').focus();$('collector-update-command').select();}
};
$('rename-form').onsubmit=async event=>{
  const id=managedId, session=managementSession;
  event.preventDefault();$('rename-save').disabled=true;$('management-message').hidden=true;
  try{await mutate('/api/hosts/'+id,'PATCH',{name:$('rename-host').value.trim(),group:$('rename-group').value.trim()});if(managementCurrent(session,id))$('management').close();setupSuccess='Host updated.';await refresh();}
  catch(error){if(managementCurrent(session,id))showError('management-message',error);}finally{if(managementCurrent(session,id))$('rename-save').disabled=false;}
};
$('remove-name').oninput=()=>{$('remove-host').disabled=$('remove-name').value!==hosts.find(h=>h.id===managedId)?.name;};
$('remove-form').onsubmit=async event=>{
  event.preventDefault();
  const host=hosts.find(h=>h.id===managedId);
  if(!host || $('remove-name').value!==host.name)return;
  const id=managedId, session=managementSession;
  $('remove-host').disabled=true;
  try{await mutate('/api/hosts/'+id,'DELETE',{confirmName:$('remove-name').value});if(managementCurrent(session,id))$('management').close();if(selected===id)selected=null;setupSuccess='Host removed. Stop its collector on the host with docker compose down.';await refresh();}
  catch(error){if(managementCurrent(session,id)){showError('management-message',error);$('remove-host').disabled=false;}}
};
$('rotate-token').onclick=async()=>{
  const id=managedId, session=managementSession, revision=hosts.find(h=>h.id===managedId)?.credentialRevision||0;
  $('rotate-token').disabled=true;$('management-message').hidden=true;
  try {
    const response=await mutate('/api/hosts/'+id+'/collector','POST',{format:'config'});
    if(!managementCurrent(session,id)){await response.body?.cancel();return;}
    const blob=await response.blob();if(!managementCurrent(session,id))return;
    if(configUrl)URL.revokeObjectURL(configUrl);configUrl=URL.createObjectURL(blob);
    $('config-download').href=configUrl;rotationRevision=revision;rotationExpiry=Date.now()+600000;
    $('rotation-commands').textContent="bash <<'CROWSNEST_ROTATE'\nset -eu\n"+collectorDirectoryCommands().join('\n')+'\ntest -O .\ninstall -m 0600 ~/Downloads/collector.json ./collector.json\nsudo docker compose up -d --force-recreate collector\nCROWSNEST_ROTATE';
    $('rotation-result').hidden=false;updateEnrollment();$('config-download').focus();
  }catch(error){if(managementCurrent(session,id))showError('management-message',error);}finally{if(managementCurrent(session,id))$('rotate-token').disabled=false;}
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
const signalCheckboxes=['cpuAlerts','memoryAlerts','restartBursts'];
const signalValues={cpuThreshold:150,memoryMiB:1024,resourceMinutes:5,restartCount:5,restartWindowMinutes:10,cooldownMinutes:10};
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
  for(const id of ['notifications-enabled','notifications-recoveries','notifications-hostReports','notifications-unhealthy','notifications-restarting','notifications-dead','notifications-delay','notifications-priority','notifications-save','notifications-test'])$(id).disabled=notificationBusy || !notificationConfigured;
  $('notifications-delay').disabled ||= !$('notifications-hostReports').checked;
  for(const key of [...signalCheckboxes,...Object.keys(signalValues)])$('notifications-'+key).disabled=notificationBusy || !notificationConfigured;
  $('notifications-cpuThreshold').disabled ||= !$('notifications-cpuAlerts').checked;
  $('notifications-memoryMiB').disabled ||= !$('notifications-memoryAlerts').checked;
  $('notifications-resourceMinutes').disabled ||= !$('notifications-cpuAlerts').checked && !$('notifications-memoryAlerts').checked;
  for(const key of ['restartCount','restartWindowMinutes'])$('notifications-'+key).disabled ||= !$('notifications-restartBursts').checked;
  $('notifications-cooldownMinutes').disabled ||= !signalCheckboxes.some(key=>$('notifications-'+key).checked);
}
$('notifications-hostReports').onchange=notificationControls;
for(const key of signalCheckboxes)$('notifications-'+key).onchange=notificationControls;
async function loadNotifications() {
  if(notificationBusy)return;
  const focused=document.activeElement;
  notificationBusy=true;notificationControls();
  try {
    const response=await fetch('/api/notifications',{cache:'no-store',signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw new Error('Unable to load ntfy settings. Open Alerts again to retry.');
    const data=await response.json();notificationConfigured=data.configured;setSubscription(data.destination);
    $('notification-destination').textContent=data.destination?'Topic: '+data.destination:'ntfy is not configured. Set NTFY_URL and the secret NTFY_TOKEN in your deployment environment. For Docker, recreate the dashboard container; for Sites, publish the updated runtime configuration.';
    $('notifications-enabled').checked=data.enabled;$('notifications-recoveries').checked=data.recoveries;
    for(const key of ['hostReports','unhealthy','restarting','dead'])$('notifications-'+key).checked=data[key]!==false;
    $('notifications-delay').value=String(data.staleMinutes||2);$('notifications-priority').value=String(data.priority||4);
    for(const key of signalCheckboxes)$('notifications-'+key).checked=data[key]===true;
    for(const [key,fallback] of Object.entries(signalValues))$('notifications-'+key).value=String(data[key]??fallback);
    $('notification-delivery').textContent=data.lastError?'Delivery failed: '+data.lastError+'. Automatic alerts retry with backoff. Check ntfy access and the runtime token.':data.lastSuccessAt?'Last accepted by ntfy: '+new Date(data.lastSuccessAt).toLocaleString()+'.':'No notifications have been accepted yet.';
    $('notification-delivery').textContent+=' '+(data.lastSweepAt?'Last background check: '+new Date(data.lastSweepAt).toLocaleString()+'.':'No background check recorded. Configure a scheduled sweep for stale-host alerts.');
  }catch(error){notificationConfigured=false;setSubscription(null);$('notification-destination').textContent='Notification settings unavailable.';$('notification-message').textContent=error.message;}
  finally{notificationBusy=false;notificationControls();restoreFocus(focused);}
}
$('notification-form').onsubmit=async event=>{
  event.preventDefault();const focused=document.activeElement;
  notificationBusy=true;notificationControls();$('notification-message').textContent='Saving…';
  try{await mutate('/api/notifications','PATCH',{enabled:$('notifications-enabled').checked,recoveries:$('notifications-recoveries').checked,...Object.fromEntries(['hostReports','unhealthy','restarting','dead',...signalCheckboxes].map(key=>[key,$('notifications-'+key).checked])),...Object.fromEntries(Object.keys(signalValues).map(key=>[key,Number($('notifications-'+key).value)])),staleMinutes:Number($('notifications-delay').value),priority:Number($('notifications-priority').value)});$('notification-message').textContent='Settings saved. Changes apply to the whole fleet.';}
  catch(error){$('notification-message').textContent=error.message;}
  finally{notificationBusy=false;notificationControls();restoreFocus(focused);}
};
$('notifications-test').onclick=async()=>{
  const focused=document.activeElement;
  notificationBusy=true;notificationControls();$('notification-message').textContent='Sending test…';
  try{await mutate('/api/notifications/test','POST',{});$('notification-message').textContent='Test accepted by ntfy. Check your subscribed devices.';}
  catch(error){$('notification-message').textContent=error.message;}
  finally{notificationBusy=false;notificationControls();await loadNotifications();restoreFocus(focused);}
};
refresh();
setInterval(() => {if (!document.hidden) refresh();}, 15000);
