import {readFile,writeFile,mkdir} from 'node:fs/promises';
let source=await readFile('worker/index.js','utf8');
const {version}=JSON.parse(await readFile('package.json','utf8'));
source=source.replaceAll('__APP_VERSION__',version);
const readNotifications=await readFile('worker/notifications.js','utf8');
source=source.replace('// __NOTIFICATIONS_SOURCE__',()=>readNotifications);
const lock=JSON.parse(await readFile('package-lock.json','utf8'));
if(lock.version!==version || lock.packages[''].version!==version)throw new Error('Package and lockfile versions must match');
for(const [placeholder,file] of [['__COLLECTOR_SOURCE__','worker/collector.py'],['__PROXY_SOURCE__','worker/proxy.cfg'],['__COMPOSE_SOURCE__','worker/compose.yaml'],['__SETUP_SOURCE__','worker/setup.sh'],['__BOARD_HTML__','worker/board.html'],['__BOARD_JS__','worker/board.js'],['__BOARD_CSS__','worker/board.css']]) {
  const content=(await readFile(file,'utf8')).replaceAll('__APP_VERSION__',version);
  source=source.replace("'"+placeholder+"'",()=>JSON.stringify(content));
}
source=source.replace("'__LOGO_BASE64__'",JSON.stringify((await readFile('worker/assets/crowsnest-mark.png')).toString('base64')));
await mkdir('dist/server',{recursive:true});
await mkdir('dist/.openai',{recursive:true});
await writeFile('dist/server/index.js',source);
await writeFile('dist/.openai/hosting.json',await readFile('.openai/hosting.json'));
