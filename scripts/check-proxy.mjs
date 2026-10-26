// Exercise the actual HAProxy rules against a synthetic Unix socket, never a Docker daemon.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,copyFile,rm,chmod} from 'node:fs/promises';
import {spawnSync,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
const directory=await mkdtemp(join(tmpdir(),'crowsnest-proxy-check-')),name='crowsnest-proxy-check-'+randomUUID();
const environment={...process.env};
for(const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete environment[key];
const docker=(args,allowFailure=false)=>{
  const result=spawnSync('docker',['--host=unix:///var/run/docker.sock',...args],{env:environment,encoding:'utf8',timeout:60000,maxBuffer:1024*1024});
  if(result.error && !allowFailure)throw result.error;
  if(!allowFailure)assert.equal(result.status,0,(result.stdout+'\n'+result.stderr).slice(-4000));
  return result;
};
// Resolve the deployment template so this test uses the shipped image and limits.
environment.COLLECTOR_UID='1000';environment.COLLECTOR_GID='1000';
const requests=[],server=createServer((request,response)=>{requests.push(request.method+' '+request.url);response.setHeader('Content-Type','application/json');response.end('{"fixture":true}');});
try {
  const proxy=JSON.parse(docker(['compose','--file','worker/compose.yaml','config','--format','json']).stdout).services['socket-proxy'];
  await copyFile('worker/proxy.cfg',join(directory,'proxy.cfg'));
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(join(directory,'docker.sock'),resolve);});
  // The fixture socket's UID can differ from container root; the containing host directory stays private.
  await chmod(join(directory,'docker.sock'),0o666);
  docker(['run','--detach','--name',name,'--user','0:0','--memory',String(proxy.mem_limit),'--cpus',String(proxy.cpus),'--pids-limit',String(proxy.pids_limit),'--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--publish','127.0.0.1::2375',
    '--mount','type=bind,source='+join(directory,'proxy.cfg')+',target=/usr/local/etc/haproxy/haproxy.cfg,readonly',
    '--mount','type=bind,source='+join(directory,'docker.sock')+',target=/var/run/docker.sock,readonly',proxy.image]);
  const inspection=JSON.parse(docker(['inspect',name]).stdout)[0],port=inspection.NetworkSettings.Ports['2375/tcp'][0].HostPort;
  const endpoint='http://127.0.0.1:'+port;
  let ready=false;
  for(let attempt=0;attempt<40;attempt++){try{if((await fetch(endpoint+'/version',{signal:AbortSignal.timeout(1000)})).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
  assert.ok(ready,'Restricted proxy starts with the shipped configuration: '+(!ready?docker(['logs','--tail','20',name],true).stdout:''));
  assert.equal(proxy.healthcheck.test[0],'CMD-SHELL');
  // Keep the fixture HTTP server responsive while the in-container probe runs.
  await promisify(execFile)('docker',['--host=unix:///var/run/docker.sock','exec',name,'sh','-c',proxy.healthcheck.test[1]],{env:environment,timeout:10000});
  requests.length=0;
  const id='a'.repeat(64);
  for(const path of ['/version','/v1.50/containers/json?all=1','/v1.50/containers/'+id+'/json','/v1.50/containers/'+id+'/stats?stream=false&one-shot=true']) {
    assert.equal((await fetch(endpoint+path,{signal:AbortSignal.timeout(2000)})).status,200,path);
  }
  const accepted=requests.length;
  for(const path of ['/info','/images/json','/v1.50/containers/'+id+'/logs','/v1.50/containers/'+id+'/stats','/v1.50/containers/'+id+'/stats?stream=true',
    '/v1.50/containers/'+id+'/stats?stream=false','/v1.50/containers/'+id+'/stats?stream=false&one-shot=true&extra=x','/v1.50/containers/short/stats?stream=false&one-shot=true']) {
    assert.equal((await fetch(endpoint+path,{signal:AbortSignal.timeout(2000)})).status,403,path);
  }
  for(const method of ['POST','DELETE','PUT','PATCH'])assert.equal((await fetch(endpoint+'/v1.50/containers/'+id+'/json',{method,signal:AbortSignal.timeout(2000)})).status,403,method);
  assert.equal(requests.length,accepted,'Forbidden requests never reach the synthetic Docker socket');
  console.log('Passed: shipped HAProxy image starts within Compose resource limits, its health probe succeeds, and only bounded status/stats reads reach the socket.');
} finally {
  docker(['rm','--force',name],true);
  await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});
}
