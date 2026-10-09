import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source='我是新人小满。我想复活继续表演。愿意的话帮我上点复活票。';
const lesson={mode:'guidance',focus_key:'user_reason',keep:'保留新人介绍和自愿的上票动作。',original:'我想复活继续表演。',
 action:'说明复活后具体做什么，并交代观众能怎样参与。',example:'',related_edits:[],why:'现在只说了你想复活，观众还不知道这次参与能看到什么。'};
const makeReport=(focused=false,verdict='almost')=>({review_mode:focused?'focused':'full',report_id:crypto.randomUUID(),verdict,
 verdict_reason:verdict==='passed'?'参与内容和当下动作已说清楚。':'还需要把复活后的内容说具体。',card_type:verdict==='passed'?'none':'logic',
 card_why:'观众还不知道复活后具体能看到什么。',redline_note:'',ai_flavor:'',one_thing:'先说内容，再邀请参与。',
 structure_checks:(focused?['user_reason','vote_instruction']:['self_intro','gratitude','target_user','user_reason','vote_instruction']).map(key=>({key,status:verdict!=='passed'&&key==='user_reason'?'partial':'met',evidence:key==='user_reason'?'我想复活继续表演。':'愿意的话帮我上点复活票。'})),
 coaching:verdict==='passed'?null:structuredClone(lesson),line_reviews:[],round_dynamics:null,
 interaction_review:{judgment:'matched',reading:'按新人没有固定支持者、复活差距较大的情况判断。',why:'只依据这版真实表达。',next_check:'开口后看观众是否接话。'},
 direction:{summary:lesson.action,examples:[]}});

function session(storage=new Map()) {
 const elements=new Map(),views=[],submits=[],restores=[];
 function node(tag){
  const el={tag,children:[],events:{},attributes:{},dataset:{},style:{},value:'',hidden:false,disabled:false,selectionStart:0,selectionEnd:0,
   appendChild(child){this.children.push(child);child.parentNode=this;return child;},
   insertBefore(child,before){const at=this.children.indexOf(before);assert.notEqual(at,-1);this.children.splice(at,0,child);child.parentNode=this;},
   removeChild(child){this.children.splice(this.children.indexOf(child),1);},
   setAttribute(k,v){this.attributes[k]=String(v);},addEventListener(k,fn){this.events[k]=fn;},
   focus(){},setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;},click(){if(!this.disabled)this.events.click?.();},
   querySelector(selector){return all(this).find(child=>child.tag===selector)||null;},
  };
  let content='';Object.defineProperty(el,'textContent',{get(){return content+this.children.map(child=>child.textContent).join('');},set(v){content=String(v);this.children=[];}});
  Object.defineProperty(el,'firstChild',{get(){return this.children[0]||null;}});
  Object.defineProperty(el,'innerHTML',{set(){throw Error('model text must remain inert');}});
  Object.defineProperty(el,'id',{get(){return this._id;},set(v){this._id=v;elements.set(v,this);}});
  return el;
 }
 const all=el=>[el,...el.children.flatMap(all)];
 const get=id=>{if(!elements.has(id)){const el=node('div');el.id=id;}return elements.get(id);};
 const goal=node('div');goal.appendChild(node('span'));goal.appendChild(node('h1'));
 const context=vm.createContext({console,crypto,LIMITS:{scriptMin:1,scriptMax:500},clearInterval,clearTimeout,setTimeout,
  localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
  document:{getElementById:get,createElement:node,createTextNode:text=>{const el=node('#text');el.textContent=text;return el;},querySelector:selector=>selector==='.training-goal--passed'?goal:null},
  App:{state:{lastRequest:{mode:'free',voteGap:'far',script:source,scenario:{id:'novice-revival-far-v1'}},lastReport:null},showView:v=>views.push(v),toast(){},unlockStage(){},lockStage(){}},
  Form:{submitRevision:value=>submits.push(value),restore:request=>restores.push(request),_scenarioKey:value=>JSON.stringify(value)},
 });context.window=context;vm.runInContext(readFileSync(new URL('../site/js/report.js',import.meta.url),'utf8'),context);
 const R=context.Report;
 function render(report){context.App.state.lastReport=report;if(report.verdict==='passed')R.showPassed(report);else R.showContent(report);return report.verdict==='passed'?get('passed-learn'):get('report-content');}
 const byClass=(root,name)=>all(root).find(el=>(el.className||'').split(' ').includes(name));
 return {R,context,render,get,all,byClass,storage,views,submits,restores};
}

// Valid guidance keeps the specific diagnosis and explanation, without an empty example or destructive adoption.
{
 const s=session(),report=makeReport(),root=s.render(report);
 assert.equal(s.R._coachingFor(report,{key:'user_reason'}).mode,'guidance');
 const longer=structuredClone(report);longer.coaching.why='依据'.repeat(90);assert.equal(s.R._coachingFor(longer,{key:'user_reason'}).why.length,180,'guidance preserves the full verified explanation');
 for(const text of [lesson.keep,lesson.original,lesson.action,lesson.why])assert.ok(root.textContent.includes(text));
 assert.doesNotMatch(root.textContent,/可以这样说|原来这样说|这次这样改|整稿预览|采用到改稿框|系统故障|降级/);
 assert.equal(s.byClass(root,'revision-preview'),undefined);
 assert.equal(s.get('revision-script').value,source);
 assert.equal(s.R._coachingPreview(source,lesson),null,'empty guidance is not a deletion');
 assert.equal(s.R._coachingPreview(source,{...lesson,example:'不应采用的内容'}),null,'guidance mode cannot adopt even malformed examples');
 const paper=s.byClass(root,'focus-paper');
 assert.deepEqual(s.all(paper).filter(el=>el.tag==='p').map(el=>el.textContent),[lesson.original,report.card_why,lesson.action,lesson.why]);
 const help=s.R._helpPanel(report,{key:'user_reason'},{focusAttempts:2});
 assert.ok(help.textContent.includes(lesson.action));assert.doesNotMatch(help.textContent,/把这两句|这次这样改|原来这样说/);
 const input=s.get('revision-script'),edited=source.replace(lesson.original,'复活后我把舞蹈里的一个动作拆成两种节奏，请你们选一种。');
 input.value=edited;input.events.input();assert.equal(s.byClass(root,'revision-submit').disabled,false);
 s.byClass(root,'revision-submit').click();assert.deepEqual(s.submits,[edited]);
 assert.equal(JSON.parse(s.storage.get(s.R._workspaceKey)).revision,edited,'manual revision remains saved');
 const fresh=session(s.storage);fresh.R._restoreWorkspace();
 assert.equal(fresh.get('revision-script').value,edited,'guidance draft survives a fresh page');
 assert.equal(fresh.views.at(-1),'report');
}

// Focused outcomes expose only actually reviewed core requirements, with all usual editing and passing flows intact.
for(const verdict of ['off','almost','passed']){
 const s=session(),report=makeReport(true,verdict),root=s.render(report),checks=s.R._checks(report);
 assert.deepEqual(Array.from(checks,check=>check.key),['user_reason','vote_instruction']);
 assert.equal(s.context.App.state.coaching.lastProgress.applicableCount,2);
 const map=verdict==='passed'?s.get('passed-structure-track'):s.byClass(root,'challenge-map');
 assert.match(map.textContent,verdict==='passed'?/2\/2 核心要求已做到/:/1\/2 核心要求已做到/);
 assert.doesNotMatch(map.textContent,/认识我|接住参与|点到人|五项/);
 assert.ok(s.all(map).every(el=>!Object.values(el.attributes).some(value=>/五项/.test(value))));
 assert.doesNotMatch(root.textContent,/逐句看|完整复盘|可以这样说/);
 if(verdict==='passed'){
  assert.equal(s.views.at(-1),'passed');assert.equal(s.get('passed-script').textContent,source);
  assert.equal(s.get('passed-round-dynamics').hidden,false,'real interaction reading stays visible when no round breakdown is provided');
  assert.ok(s.get('passed-round-dynamics').textContent.includes(report.interaction_review.reading));
 }else{
  assert.equal(s.views.at(-1),'report');assert.ok(root.textContent.includes(lesson.action));assert.equal(s.get('revision-script').value,source);
 }
}

// A passed summary never fabricates an omitted core check or synthetic line review.
{
 const s=session(),report=makeReport(true,'passed');report.structure_checks=report.structure_checks.slice(0,1);
 assert.deepEqual(Array.from(s.R._checks(report),check=>check.key),['user_reason']);
 report.structure_checks=[];assert.equal(s.R._checks(report).length,0);
 report.line_reviews=[{original:source,mark:'good',comment:'不应展示的逐句评论'}];
 assert.doesNotMatch(s.R._fullReview(report,[],null).textContent,/不应展示|逐句看/);
 const noReading=makeReport(true,'passed');noReading.interaction_review=null;s.render(noReading);
 assert.equal(s.get('passed-round-dynamics').hidden,true);
}

// A recovery comparison marked unverified does not count as another same-focus failure.
{
 const s=session();s.render(makeReport(true));s.render(makeReport(true));
 assert.equal(s.context.App.state.coaching.lastProgress.focusAttempts,2);
 const report=makeReport(true);report.revision_check={focus_key:'user_reason',status:'unverified'};s.render(report);
 assert.equal(s.context.App.state.coaching.lastProgress.focusAttempts,1);
 assert.equal(s.context.App.state.coaching.lastProgress.totalAttempts,3);
}

// Neither guidance nor focused results introduce HTML interpretation.
{
 const s=session(),report=makeReport(true);report.coaching.action='<img src=x onerror=bad()>把内容说具体。';
 const root=s.render(report);assert.ok(root.textContent.includes('<img src=x onerror=bad()>'));
 assert.equal(s.all(root).filter(el=>el.tag==='img').length,0);
}
console.log('PASS recovery UI: specific guidance, no empty examples or adoption, real core counts, passed/edit flows, saved drafts, unverified progress and inert text');
