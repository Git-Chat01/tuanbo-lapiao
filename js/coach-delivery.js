// A best-effort receipt after the matching report has rendered in a visible
// view. It never blocks grading, stores no draft/code, and retries no model call.
var CoachDelivery = {
  key:"tuanbo-coach-delivery-v1", memory:[], busy:false, scheduled:false,
  requestMs:3000, retryMs:15000, retries:0, timer:null,
  validId:function (id) { return typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id); },
  read:function () {
    var rows=CoachDelivery.memory;
    try { var stored=localStorage.getItem(CoachDelivery.key); if(stored) rows=JSON.parse(stored); } catch(e) {}
    if(!Array.isArray(rows)) return [];
    return rows.filter(function (x) { return x && CoachDelivery.validId(x.id) && CoachDelivery.validId(x.reportId) &&
      typeof x.owner === "string" && /^[a-f0-9]{64}$/.test(x.owner) && Number.isFinite(x.startedAt) &&
      Number.isFinite(x.expiresAt) && x.expiresAt>Date.now(); }).slice(-50).map(function (x) {
      return {id:x.id,reportId:x.reportId,owner:x.owner,startedAt:x.startedAt,expiresAt:x.expiresAt,
        rendered:x.rendered===true,clientElapsedMs:Number.isFinite(x.clientElapsedMs)&&x.clientElapsedMs>=0&&x.clientElapsedMs<=86400000?x.clientElapsedMs:null};
    });
  },
  change:function (fn) {
    var rows=fn(CoachDelivery.read()).slice(-50);CoachDelivery.memory=rows;
    try { if(rows.length) localStorage.setItem(CoachDelivery.key,JSON.stringify(rows));else localStorage.removeItem(CoachDelivery.key); } catch(e) {}
  },
  observe:function (record) {
    try {
      CoachDelivery.change(function (rows) { if(!rows.some(function(x){return x.id===record.id;})) rows.push(record);return rows; });
      CoachDelivery.check();
    } catch(e) { /* Diagnostics must never turn a rendered report into an error. */ }
  },
  check:function () {
    if(CoachDelivery.scheduled) return;
    CoachDelivery.scheduled=true;
    var frame=(window.requestAnimationFrame && window.requestAnimationFrame.bind(window)) || function(fn){return setTimeout(fn,0);};
    frame(function(){frame(function(){
      CoachDelivery.scheduled=false;
      try {
        if(document.visibilityState!=="visible") return;
        var state=App.state,view=document.getElementById("view-"+state.currentView);
        if(["report","passed"].indexOf(state.currentView)<0 || !view || !view.getClientRects().length) return;
        var reportId=state.lastReport && state.lastReport.report_id;
        if(!window.Report || Report._visibleReportId!==reportId) return;
        CoachDelivery.change(function(rows){return rows.map(function(x){
          if(!x.rendered && x.reportId===reportId){var elapsed=Date.now()-x.startedAt;x.rendered=true;x.clientElapsedMs=elapsed>=0&&elapsed<=86400000?elapsed:null;}
          return x;
        });});
      } catch(e) {}
      CoachDelivery.flush();
    });});
  },
  remove:function(id){CoachDelivery.change(function(rows){return rows.filter(function(x){return x.id!==id;});});},
  send:async function(record,code){
    var controller=typeof window.AbortController==="function"?new window.AbortController():null,timer;
    try {
      return await Promise.race([(async function(){
        var response=await fetch(API_BASE+"/api/coach/jobs/"+record.id+"/displayed",{method:"POST",headers:{"Content-Type":"application/json"},keepalive:true,
          body:JSON.stringify({accessCode:code,reportId:record.reportId,clientElapsedMs:record.clientElapsedMs}),...(controller?{signal:controller.signal}:{})});
        if([400,404,409,410].indexOf(response.status)>=0)return true;
        if(!response.ok)return false;
        var data=await response.json();return data.ok===true && data.displayConfirmed===true;
      })(),new Promise(function(resolve){timer=setTimeout(function(){if(controller)controller.abort();resolve(false);},CoachDelivery.requestMs);})]);
    } catch(e){return false;} finally{clearTimeout(timer);}
  },
  flush:async function(){
    if(CoachDelivery.busy || !API_BASE || window.navigator.onLine===false || !window.CoachJobs)return;
    CoachDelivery.busy=true;var failed=false;
    try {
      var code=App.getAccessCode();if(!code)return;
      var owner=await CoachJobs.owner(code);
      var rows=CoachDelivery.read().filter(function(x){return x.rendered&&x.owner===owner;});
      for(var i=0;i<rows.length;i++){
        if(await CoachDelivery.send(rows[i],code))CoachDelivery.remove(rows[i].id);else {failed=true;break;}
      }
    } catch(e){failed=true;} finally {
      CoachDelivery.busy=false;
      if(failed&&CoachDelivery.retries++<3){clearTimeout(CoachDelivery.timer);CoachDelivery.timer=setTimeout(CoachDelivery.flush,CoachDelivery.retryMs);}
    }
  },
  resume:function(){CoachDelivery.retries=0;CoachDelivery.check();CoachDelivery.flush();},
};
document.addEventListener("DOMContentLoaded",CoachDelivery.resume);
document.addEventListener("visibilitychange",function(){if(document.visibilityState==="visible")CoachDelivery.resume();});
window.addEventListener("online",CoachDelivery.resume);
window.addEventListener("pageshow",CoachDelivery.resume);
