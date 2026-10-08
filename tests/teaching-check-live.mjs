import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {callTeachingCheck,exampleCheckPassed} from '../worker/teaching-check.js';
if(!process.argv.includes('--live'))throw Error('Use --live: only synthetic teaching checks, no production learner records or cases.');
const vars=await readFile(new URL('../.dev.vars',import.meta.url),'utf8');
const key=vars.split(/\r?\n/u).find(line=>line.startsWith('DEEPSEEK_API_KEY='))?.slice(17).trim().replace(/^['"]|['"]$/gu,'');
if(!key)throw Error('Configured model key missing');
const config={url:'https://api.deepseek.com/chat/completions',model:'deepseek-flash'};
const previousScript='我是新人小禾，大家帮我上票复活吧。';
const lesson={focus_key:'user_reason',original:'大家帮我上票复活吧。',example:'你们出个普通词，我用它接一句问候；想听我怎么接的，可以帮我上点复活票。',action:'补一个具体的互动过程',why:'让观众知道给什么、主播接什么。'};
const fixtures=[
 {id:'paraphrase',mode:'revision',expected:'resolved',input:{previousScript,previousLesson:lesson,revisedScript:'我是新人小禾。评论区给个词吧，我把它接成一句招呼，想继续听的可以帮我上复活票。',currentIssue:{focus_key:'user_reason',diagnosis:'仍然只有主播的愿望，没有观众参与内容。',original:'评论区给个词吧，我把它接成一句招呼，想继续听的可以帮我上复活票。'}}},
 {id:'polite-only-still-open',mode:'revision',expected:'still_open',input:{previousScript,previousLesson:lesson,revisedScript:'我是新人小禾，愿意的朋友帮我上复活票，不方便也没关系。',currentIssue:{focus_key:'user_reason',diagnosis:'只有礼貌求助，尚未给出具体互动过程。',original:'愿意的朋友帮我上复活票，不方便也没关系。'}}},
 {id:'partial-related-edits',mode:'revision',expected:'still_open',input:{previousScript:'借点钱给我上票吧。不帮我你就不是真朋友。',previousLesson:{focus_key:'redline',original:'借点钱给我上票吧。',example:'按自己的预算决定，方便的朋友可以帮我上复活票。',related_edits:[{original:'不帮我你就不是真朋友。',example:''}],action:'不让观众借钱，也不拿关系施压。'},revisedScript:'按自己的预算决定，方便的朋友可以帮我上复活票。不帮我你就不是真朋友。',currentIssue:{focus_key:'redline',diagnosis:'第二句仍拿关系施压。',original:'不帮我你就不是真朋友。'}}},
 {id:'empty-roll-call-example',mode:'example',expected:'still_open',input:{previousScript:'我是小禾。大家帮我上票。',revisedScript:'我是小禾。你们扣个禾，我念到一个记一个，想让我留下陪聊的帮我上票。',focus_key:'user_reason',diagnosis:'只有主播想留下，缺少具体参与内容。'}},
];
const results=[];
for(const fixture of fixtures){const start=Date.now();try{const result=await callTeachingCheck({DEEPSEEK_API_KEY:key},config,fixture.mode,fixture.input,Date.now()+15000);assert.equal(result.check.target_status,fixture.expected);if(fixture.mode==='example')assert.equal(exampleCheckPassed(result.check),false);if(fixture.id==='paraphrase')assert.ok(['same_edits','none'].includes(result.check.issue_scope));results.push({id:fixture.id,ok:true,ms:Date.now()-start,...result});}catch(error){results.push({id:fixture.id,ok:false,ms:Date.now()-start,error:error.message});}}
await mkdir(new URL('tmp_results/',import.meta.url),{recursive:true});
await writeFile(new URL('tmp_results/teaching-check-live.json',import.meta.url),JSON.stringify({at:new Date().toISOString(),results},null,2));
for(const result of results)console.log(JSON.stringify({id:result.id,ok:result.ok,ms:result.ms,error:result.error}));
if(results.some(item=>!item.ok))process.exitCode=1;
