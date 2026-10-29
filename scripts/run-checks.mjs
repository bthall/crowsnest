import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const directory=mkdtempSync(path.join(os.tmpdir(),'crowsnest-checks-'));
const env={...process.env,CROWSNEST_TEST_DIRECTORY:directory};
// Test ownership against the actual user running the tests.
delete env.SUDO_UID;
delete env.SUDO_GID;
let code=0;
try {
  for(const script of ['scripts/check-collector-release.mjs','scripts/check-update-status.mjs','scripts/check-updater.py']) {
    const result=spawnSync(script.endsWith('.py')?'python3':process.execPath,[script],{env:{...env,PYTHONDONTWRITEBYTECODE:'1'},stdio:'inherit'});
    if(result.error)throw result.error;
    if(result.status!==0){process.exitCode=result.status??1;throw new Error('Collector update checks failed: '+script);}
  }
  for(const script of ['scripts/check-secrets.mjs','scripts/check-secret-scanner.mjs','scripts/check-release.mjs','scripts/validate-artifact.mjs','scripts/check-board.mjs','scripts/check-enrollment.mjs','scripts/check-notifications.mjs','scripts/check-signals.mjs','scripts/check-maintenance.mjs','scripts/check-details.mjs','scripts/check-resources.mjs','scripts/check-resilience.mjs','scripts/check-collector.py','scripts/check-notifier.py','scripts/check-installer.mjs','scripts/check-focus.mjs','scripts/check-standalone.mjs','scripts/check-restore.mjs']) {
    const result=spawnSync(script.endsWith('.py')?'python3':process.execPath,[script],{env:{...env,PYTHONDONTWRITEBYTECODE:'1'},stdio:'inherit'});
    if(result.error)throw result.error;
    if(result.status!==0){code=result.status??1;break;}
  }
} finally {rmSync(directory,{recursive:true,force:true});}
process.exitCode=code;
