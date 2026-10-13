import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
const root=mkdtempSync(join(tmpdir(),'crowsnest-secret-scanner-'));
const scanner=resolve('scripts/check-secrets.mjs');
const git=args=>execFileSync('git',args,{cwd:root,stdio:'pipe'});
const candidate=['synthetic','candidate'].join('-');
try {
  git(['init','--quiet']);
  const check=(name,content,rejected)=>{
    writeFileSync(join(root,name),content);
    git(['add','--',name]);
    const result=spawnSync(process.execPath,[scanner],{cwd:root,encoding:'utf8'});
    assert.equal(result.status,rejected?1:0,result.stderr);
    assert.ok(!result.stderr.includes(candidate),'Scanner must report paths without revealing values');
    git(['rm','--quiet','--force','--',name]);
  };
  check('settings.json',JSON.stringify({serviceToken:candidate}),true);
  check('settings.py',"config = {'hostToken': '"+candidate+"'}",true);
  check('settings.sh','COLLECTOR_SERVICE_TOKEN="'+candidate+'"',true);
  check('settings.js','const '+['pass','word'].join('')+' = '+JSON.stringify(candidate),true);
  check('settings.json',JSON.stringify({password:['fictional','owner','password','for','tests'].join('-')}),true);
  check('labels.js',"const title = recovery ? 'Reset your password' : 'Welcome back';",false);
  check('settings.json',JSON.stringify({serviceToken:'example-token'}),false);
  check('collector.json','{}',true);
  check('crowsnest-setup.sh','# generated installer',true);
  check('.env','DEMO=example',true);
  console.log('Passed: secret scanner rejects quoted JSON/Python credentials and generated files, permits declared examples, and redacts values.');
}finally{rmSync(root,{recursive:true,force:true});}
