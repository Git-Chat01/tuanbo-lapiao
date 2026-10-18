// Creates only an ignored preview config. Does not start a server or deploy anything.
import {mkdir,writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
const dir=new URL('tmp_results/reasoning-effort/',import.meta.url);
await mkdir(dir,{recursive:true});
const config={name:'tuanbo-lapiao-coach',main:'../../helpers/reasoning-effort-preview.mjs',
  compatibility_date:'2026-08-16',compatibility_flags:['nodejs_compat'],
  vars:{EVALUATION_TOKEN:randomBytes(24).toString('hex')},observability:{enabled:false}};
try{
  // Never rotate credentials underneath a running comparison.
  await writeFile(new URL('wrangler.json',dir),JSON.stringify(config,null,2),{flag:'wx'});
  console.log('Synthetic preview config created; start it with wrangler dev --remote, never deploy.');
}catch(error){if(error.code!=='EEXIST')throw error;console.log('Existing synthetic preview config retained.');}
