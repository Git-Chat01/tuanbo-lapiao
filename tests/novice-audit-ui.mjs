// Replay actual report.js rendering into a minimal DOM; text/flow verification, not visual browser QA.
import {readFile,writeFile} from "node:fs/promises";
import vm from "node:vm";
const root=new URL("../",import.meta.url),out=new URL("tests/tmp_results/novice-audit/",root);
const source=await readFile(new URL("site/js/report.js",root),"utf8");
function node(tag){return {tag,children:[],textContent:"",dataset:{},style:{},hidden:false,
  get firstChild(){return this.children[0];},appendChild(child){this.children.push(child);return child;},
  removeChild(child){this.children.splice(this.children.indexOf(child),1);},setAttribute(name,value){this[name]=value;},
  querySelector(selector){return this.children.find(child=>child.tag===selector)||null;}};}
function textTree(item,expanded=false){if(item.hidden)return [];if(item.tag==="details"&&!expanded)return item.children.filter(c=>c.tag==="summary").flatMap(c=>textTree(c));return [item.textContent,...item.children.flatMap(c=>textTree(c,expanded))].filter(Boolean);}
const results=[];
for(const filename of ["draft-1-run-1.json","draft-1-run-2.json","draft-2-run-1.json","draft-2-retry.json"]){
  const saved=JSON.parse(await readFile(new URL(filename,out),"utf8"));
  const original=saved.script||JSON.parse(await readFile(new URL("draft-2-run-1.json",out),"utf8")).script;
  const report=saved.body.report;
  if(!report||report.verdict!=="passed")continue;
  const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,node("div"));return nodes.get(id);};
  const goal=node("section");goal.appendChild(node("span"));goal.appendChild(node("h1"));
  const sandbox={console,setTimeout,clearTimeout,setInterval,clearInterval,
    App:{state:{lastRequest:{script:original,voteGap:"close",scenario:null}},showView(view){this.view=view;}},
    document:{getElementById:get,createElement:node,querySelector:selector=>selector===".training-goal--passed"?goal:null}};
  sandbox.window=sandbox;
  const context=vm.createContext(sandbox);vm.runInContext(source,context);
  context.Report.showPassed(report);
  const roots=[goal,...["passed-structure-track","passed-learn","passed-round-dynamics"].map(get)];
  results.push({filename,view:context.App.view,visible:roots.flatMap(n=>textTree(n)),expanded:roots.flatMap(n=>textTree(n,true))});
}
await writeFile(new URL("rendered-feedback.json",out),JSON.stringify(results,null,2));
console.log(JSON.stringify(results.map(r=>({filename:r.filename,view:r.view,visible:r.visible})),null,2));
