import {readFile,writeFile,mkdir} from 'node:fs/promises';
let source=await readFile('worker/index.js','utf8');
for(const [placeholder,file] of [['__COLLECTOR_SOURCE__','worker/collector.py'],['__PROXY_SOURCE__','worker/proxy.cfg'],['__COMPOSE_SOURCE__','worker/compose.yaml'],['__SETUP_SOURCE__','worker/setup.sh'],['__BOARD_HTML__','worker/board.html']]) {
  const content=await readFile(file,'utf8');
  source=source.replace("'"+placeholder+"'",()=>JSON.stringify(content));
}
source=source.replace("'__LOGO_BASE64__'",JSON.stringify((await readFile('worker/assets/crowsnest-mark.png')).toString('base64')));
await mkdir('dist/server',{recursive:true});
await mkdir('dist/.openai',{recursive:true});
await writeFile('dist/server/index.js',source);
await writeFile('dist/.openai/hosting.json',await readFile('.openai/hosting.json'));
