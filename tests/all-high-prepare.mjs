// Isolated, ignored remote-preview configuration; never a production deployment.
import {mkdir,writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
const dir=new URL('tmp_results/all-high-fidelity/',import.meta.url);
await mkdir(dir,{recursive:true});
const config={name:'tuanbo-lapiao-coach',main:'../../helpers/all-high-preview.mjs',
  compatibility_date:'2026-08-16',compatibility_flags:['nodejs_compat'],
  vars:{EVALUATION_TOKEN:randomBytes(24).toString('hex')},observability:{enabled:false}};
try{
  // Do not rotate the test token while a regression may be running.
  await writeFile(new URL('wrangler.json',dir),JSON.stringify(config,null,2),{flag:'wx'});
  console.log('Synthetic all-high preview config created; use wrangler dev --remote, never deploy.');
}catch(error){
  if(error.code!=='EEXIST')throw error;
  console.log('Existing synthetic all-high preview config retained.');
}
