import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {readCollectorMetadata,renderManager} from './collector-metadata.mjs';
let source=await readFile('worker/index.js','utf8');
const {version}=JSON.parse(await readFile('package.json','utf8'));
const collectorRelease=readCollectorMetadata();
const replaceVersions=content=>content.replaceAll('__APP_VERSION__',version).replaceAll('__COLLECTOR_VERSION__',collectorRelease.version).replaceAll('__COLLECTOR_PROTOCOL__',String(collectorRelease.protocol)).replaceAll('__MIN_COLLECTOR_PROTOCOL__',String(collectorRelease.minimumProtocol));
const versions=await readFile('worker/versions.js','utf8');
const collectorDirectory=await readFile('worker/collector-directory.js','utf8');
source=source.replace('// __COLLECTOR_DIRECTORY_SOURCE__',()=>collectorDirectory);
source=source.replace('// __VERSIONS_SOURCE__',()=>versions);
source=replaceVersions(source);
const readNotifications=await readFile('worker/notifications.js','utf8');
source=source.replace('// __NOTIFICATIONS_SOURCE__',()=>readNotifications);
const readResources=await readFile('worker/resources.js','utf8');
source=source.replace('// __RESOURCES_SOURCE__',()=>readResources);
const readSignals=await readFile('worker/signals.js','utf8');
source=source.replace('// __SIGNALS_SOURCE__',()=>readSignals);
const lock=JSON.parse(await readFile('package-lock.json','utf8'));
if(lock.version!==version || lock.packages[''].version!==version)throw new Error('Package and lockfile versions must match');
for(const [placeholder,file] of [['__UPDATE_MANAGER_SOURCE__','collector/crowsnest'],['__COLLECTOR_SOURCE__','worker/collector.py'],['__PROXY_SOURCE__','worker/proxy.cfg'],['__COMPOSE_SOURCE__','worker/compose.yaml'],['__SETUP_SOURCE__','worker/setup.sh'],['__BOARD_HTML__','worker/board.html'],['__BOARD_JS__','worker/board.js'],['__BOARD_CSS__','worker/board.css']]) {
  let content=replaceVersions(await readFile(file,'utf8'));
  if(file==='collector/crowsnest')content=renderManager(content,collectorRelease);
  if(file==='worker/board.js')content=versions+'\n'+collectorDirectory+'\n'+content;
  source=source.replace("'"+placeholder+"'",()=>JSON.stringify(content));
}
source=source.replace("'__LOGO_BASE64__'",JSON.stringify((await readFile('worker/assets/crowsnest-mark.png')).toString('base64')));
await mkdir('dist/server',{recursive:true});
await writeFile('dist/server/index.js',source);
if(!process.argv.includes('--standalone')){
  await mkdir('dist/.openai',{recursive:true});
  await writeFile('dist/.openai/hosting.json',await readFile('.openai/hosting.json'));
}
