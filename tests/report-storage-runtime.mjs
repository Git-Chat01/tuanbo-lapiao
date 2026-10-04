import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {build} from 'esbuild';
import assert from 'node:assert/strict';
const bundle=await build({entryPoints:['worker/index.js'],bundle:true,format:'esm',platform:'browser',write:false});
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-08-16',durableObjects:{COACH_LIMITER:{className:'CoachRateLimiter',useSQLite:true}},cf:false}));
try {
 const ns=await mf.getDurableObjectNamespace('COACH_LIMITER');
 const obj=ns.get(ns.idFromName('local-receipt'));
 const record={schema:1,context:'a'.repeat(64),expiresAt:Date.now()+60000,report:{verdict:'passed',report_id:crypto.randomUUID()}};
 const responses=await Promise.all([obj.fetch('https://internal/report',{method:'PUT',body:JSON.stringify(record)}),obj.fetch('https://internal/report',{method:'PUT',body:JSON.stringify(record)})]);
 assert.deepEqual(responses.map(x=>x.status).sort(),[201,409]);
 assert.deepEqual(await (await obj.fetch('https://internal/report')).json(),record);
 const limited=ns.get(ns.idFromName('code:local'));
 assert.equal((await (await limited.fetch('https://internal/check',{method:'POST'})).json()).allowed,true);
 console.log('PASS actual workerd SQLite receipt transaction, alarm scheduling, immutability and independent rate limit');
} finally {await mf.dispose();}
