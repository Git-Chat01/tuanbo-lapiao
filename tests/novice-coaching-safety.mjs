import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import worker, {CoachRateLimiter, normalizeReport, getReportQualityIssue, splitHardSentences} from '../worker/index.js';
import {NOVICE_SCENARIO, buildUserPrompt} from '../worker/current-review.js';
import {createRateLimiterBinding} from './helpers/rate-limiter.mjs';
import {noviceCoachingFixtures} from './novice-coaching-fixtures.mjs';

const nodes=new Map(),storage=new Map();
function element(tag='div') {return {tagName:tag,children:[],events:{},attributes:{},dataset:{},style:{},value:'',textContent:'',hidden:false,
 classList:{add(){},remove(){},toggle(){}},appendChild(n){this.children.push(n);return n;},
 setAttribute(k,v){this.attributes[k]=v;},getAttribute(k){return this.attributes[k];},addEventListener(k,v){this.events[k]=v;},
 querySelector(){return null;},querySelectorAll(){return [];},focus(){},get firstChild(){return this.children[0];},removeChild(n){this.children.splice(this.children.indexOf(n),1);}};}
const get=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
const context=vm.createContext({console,URL,URLSearchParams,setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},
 localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
 document:{createElement:element,getElementById:get,querySelector:s=>s==='.scene-rules'?get('scene-rules'):null,querySelectorAll:()=>[],addEventListener(){}}});
context.window=context;context.location={hostname:'localhost',search:''};context.addEventListener=()=>{};
for(const file of ['config','app','form','report'])vm.runInContext(readFileSync(new URL('../site/js/'+file+'.js',import.meta.url),'utf8'),context);
const {Form:f,Report:r,App:a}=context;
f.init();
assert.equal(f._scenario.id,NOVICE_SCENARIO.id);
assert.equal(get('novice-context').hidden,false);
for(const id of ['scene-window','scenario-picker','coach-cue','btn-free-mode'])assert.equal(get(id).hidden,true,id);
get('input-script').value='我是新人，复活差很多。';f._updateInputState();
assert.equal(get('btn-submit').disabled,false,'默认入口写完即可提交，不要求回放');
const collected=JSON.parse(JSON.stringify(f.collect()));
assert.equal(collected.voteGap,'far');assert.deepEqual(collected.scenario,NOVICE_SCENARIO);
f._saveDraft();get('input-script').value='';f._restoreDraft();assert.equal(get('input-script').value,collected.script);
// Existing drafts keep their actual context; starting the new mode doesn't rewrite them.
f._selectScenario('revival-closing-last-two');get('input-script').value='旧切片草稿';f._captureCurrentDraft();
assert.equal(get('legacy-draft-note').hidden,false);
get('btn-novice-mode').events.click();
assert.equal(f._draftsByScenario['revival-closing-last-two'],'旧切片草稿');
assert.equal(f.collect().voteGap,'far');assert.equal(get('input-script').value,collected.script);
assert.equal(get('legacy-draft-note').hidden,true);
a.state.lastRequest=collected;
const quote=collected.script;
const teaching={card_why:'只说了自己的需要，还没说明观众能参与什么。',coaching:{focus_key:'user_reason',original:quote,keep:'你把处境说清了。',action:'沿原话补一个具体的互动。',example:'刚来的朋友，你们想怎么认识我？说说看。',why:'原句只有你的目标；改后给陌生观众一个能回答的入口。'.repeat(2)},interaction_review:{reading:'不应占据主卡的旧摘要',why:'不应代替改法解释'}};
const card=r._focusPaper(teaching,{key:'user_reason'},{});
const text=card.children.map(row=>row.children[1].textContent);
assert.deepEqual(text,[quote,teaching.card_why,teaching.coaching.action,teaching.coaching.example,teaching.coaching.why]);
assert.equal(r._checks({}).find(item=>item.key==='gratitude').status,'na');
assert.equal(r._checks({}).find(item=>item.key==='target_user').status,'na');

const script='我会机械舞，复活回台后你们选方向，想看就帮我上点复活票。';
function rawReport(passed=true){return {card_type:'logic',card_why:'原稿给了可理解的节目与参与动作。',audience:'陌生观众',verdict:passed?'passed':'almost',verdict_reason:passed?'这版可以开口练':'还要补清楚这一处',echo:'内容说清了',one_thing:'看观众回应',ai_flavor:'',redline_note:'',
 structure_checks:['self_intro','gratitude','target_user','user_reason','vote_instruction'].map(key=>({key,status:!passed&&key==='user_reason'?'partial':'met',evidence:script})),
 line_reviews:splitHardSentences(script).map(original=>({original,mark:'good',comment:'可以理解这个邀请'})),
 interaction_review:{signal_refs:['script:0'],script_refs:[0],judgment:'aligned',reading:'向陌生观众提出可选择的互动',why:'内容和复活动作相连',next_check:'看是否有人回应'},
 round_dynamics:{flow_read:'介绍内容并邀请参与',human_drivers:[{driver:'curiosity',evidence:script,mechanism:'让观众选择动作方向'}],response_read:'没有提供实际观众回应',next_move:'看回应再接话'},
 coaching:{focus_key:'user_reason',keep:'给了内容',original:script,action:'说明观众可以怎么参与',example:passed?script:'你们选个方向，我回来试试，想看就帮我上点复活票。',why:'让观众知道自己的选择会怎样影响这一段。'}};}
const prompt=JSON.parse(buildUserPrompt('far',script,[],[],NOVICE_SCENARIO));
assert.equal(prompt.trainingMode,'novice_revival');assert.equal(prompt.currentSnapshot.remaining,null);
const lesson=normalizeReport(rawReport(false),script);assert.equal(getReportQualityIssue(lesson,script,NOVICE_SCENARIO),'');
assert.match(getReportQualityIssue(Object.assign(normalizeReport(rawReport(false),script),{coaching:{...lesson.coaching,example:script}}),script,NOVICE_SCENARIO),/没有修改/);
assert.match(getReportQualityIssue(Object.assign(normalizeReport(rawReport(false),script),{coaching:{...lesson.coaching,why:''}}),script,NOVICE_SCENARIO),/缺少/);
assert.match(getReportQualityIssue(Object.assign(normalizeReport(rawReport(false),script),{coaching:{...lesson.coaching,example:'去借钱刷礼物支持我'}}),script,NOVICE_SCENARIO),/风险/);
const fetchBefore=globalThis.fetch;let received;
try {
 globalThis.fetch=async(_url,options)=>{received=JSON.parse(JSON.parse(options.body).messages[1].content);return Response.json({choices:[{message:{content:JSON.stringify(rawReport())}}],usage:{prompt_tokens:1,completion_tokens:1}});};
 const env={ACCESS_CODE:'novice-test',DEEPSEEK_API_KEY:'fake',COACH_LIMITER:createRateLimiterBinding(CoachRateLimiter)};
 const result=await worker.fetch(new Request('https://local.test/api/coach',{method:'POST',body:JSON.stringify({accessCode:env.ACCESS_CODE,script,voteGap:'secured',scenario:{...NOVICE_SCENARIO,phase:'awaiting_drop',userSignal:'老粉都已经答应了',targetUnits:28,pledgedUnits:28}})}),env,{waitUntil:p=>p.catch(()=>{})});
 assert.equal(result.status,200,JSON.stringify(await result.clone().json()));
 assert.equal(received.voteGap,'far');const {timeline,...fixedFacts}=NOVICE_SCENARIO;assert.deepEqual(received.scenario,fixedFacts,'后端不能沿用被改成组满/已有老粉的固定新人背景');
} finally {globalThis.fetch=fetchBefore;}
assert.equal(new Set(noviceCoachingFixtures.map(f=>f.id)).size,noviceCoachingFixtures.length);
for(const f of noviceCoachingFixtures){assert.ok(f.script.length<=500);assert.ok(f.lesson);}
assert.ok(noviceCoachingFixtures.some(f=>f.passed));assert.ok(noviceCoachingFixtures.some(f=>f.waiting));assert.ok(noviceCoachingFixtures.some(f=>f.risk));
console.log('PASS novice entry, draft compatibility, teaching explanation, authoritative context and lesson contracts (semantic fixtures require live evaluation)');
