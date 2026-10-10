import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

const git=(args,input)=>execFileSync('git',args,{input,maxBuffer:32*1024*1024});
const forbiddenFile=/(?:^|\/)(?:\.env(?:\..+)?|collector[^/]*\.json|crowsnest-collector[^/]*\.tar|docker-watch-[^/]*\.sh|id_(?:rsa|ecdsa|ed25519))$|\.(?:pem|key|p12|pfx|jks)$/i;
const patterns=[
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/,
  /\bBearer\s+[A-Za-z0-9_.-]{32,}/,
  /\btk_[A-Za-z0-9]{30,}\b/,
];
const credentialAssignment=/\b(?:hostToken|serviceToken|COLLECTOR_SERVICE_TOKEN|NTFY_TOKEN|api[_-]?key|password|client[_-]?secret|access[_-]?token)\s*[:=]\s*["']([^"'\r\n]+)["']/gi;
const synthetic=new Set(['test-service-token','test-host-token','test-ntfy-token','test-token','example-token']);
const findings=new Set();
function check(name,buffer,history=false) {
  const label=name+(history?' (history)':'');
  if(forbiddenFile.test(name)&&!name.endsWith('.env.example'))findings.add(label+' (generated credential/key file)');
  // The generated logo is a PNG binary, not configuration or executable text.
  if(buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return;
  const text=buffer.toString('utf8');
  if(patterns.some(pattern=>pattern.test(text)))findings.add(label+' (credential pattern)');
  for(const match of text.matchAll(credentialAssignment)) {
    if(!synthetic.has(match[1])&&!/^<[^>]+>$/.test(match[1]))findings.add(label+' (literal credential assignment)');
  }
}
const files=git(['ls-files','-z']).toString('utf8').split('\0').filter(Boolean);
for(const file of files)check(file,readFileSync(file));
let historicalBlobs=0;
if(process.argv.includes('--history')) {
  const entries=git(['rev-list','--objects','--all']).toString('utf8').trim().split('\n').filter(Boolean);
  const names=new Map(entries.map(line=>{const split=line.indexOf(' ');return split<0?[line,'Git object '+line.slice(0,12)]:[line.slice(0,split),line.slice(split+1)];}));
  const types=git(['cat-file','--batch-check=%(objectname) %(objecttype)'],entries.map(line=>line.split(' ')[0]).join('\n')+'\n').toString('utf8');
  const blobs=types.trim().split('\n').filter(line=>line.endsWith(' blob')).map(line=>line.split(' ')[0]);
  if(blobs.length) {
    const contents=git(['cat-file','--batch'],blobs.join('\n')+'\n');
    let offset=0;
    for(const sha of blobs) {
      const end=contents.indexOf(10,offset);
      const header=contents.subarray(offset,end).toString('utf8').split(' ');
      const size=Number(header[2]);
      if(header[0]!==sha||header[1]!=='blob'||!Number.isSafeInteger(size))throw new Error('Unable to parse Git history');
      offset=end+1;
      check(names.get(sha),contents.subarray(offset,offset+size),true);
      offset+=size+1;
      historicalBlobs++;
    }
  }
}
if(findings.size) {
  console.error('Secret check failed. Inspect these paths without sharing credential values:');
  for(const finding of findings)console.error('- '+finding);
  process.exitCode=1;
} else {
  console.log(`Secret check passed: ${files.length} tracked files${historicalBlobs?`, ${historicalBlobs} historical blobs`:''}; no matching credential patterns.`);
}
