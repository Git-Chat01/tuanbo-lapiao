import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL("../site/js/voice.js",import.meta.url),"utf8");
const flush=()=>new Promise(r=>setImmediate(r));
let elapsed=0,recorders=[],revoked=[],storageWrites=0,networkCalls=0;
function node(){return {textContent:"",hidden:false,disabled:false,style:{},attributes:{},setAttribute(k,v){this.attributes[k]=v;},removeAttribute(k){delete this.attributes[k];},getAttribute(k){return this.attributes[k];},pause(){},load(){},focus(){}};}
class Recorder {
  static isTypeSupported(){return true;}
  constructor(){this.events={};this.state="inactive";this.mimeType="audio/webm";recorders.push(this);}
  addEventListener(k,fn){this.events[k]=fn;}
  start(){this.state="recording";}
  stop(){this.state="inactive";}
  complete(){this.events.dataavailable({data:new Blob(["synthetic audio"],{type:this.mimeType})});this.events.stop();}
}
class AudioContext {
  close(){return Promise.resolve();}
  decodeAudioData(){return Promise.resolve({duration:4,length:400,sampleRate:100,numberOfChannels:1,getChannelData:()=>new Float32Array(400).fill(0.1)});}
}
const c=vm.createContext({console,Blob,Float32Array,Promise,MediaRecorder:Recorder,AudioContext,isSecureContext:true,
  navigator:{mediaDevices:{getUserMedia(){throw Error("test microphone must be explicit");}}},
  document:{hidden:false},performance:{now:()=>elapsed},setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},cancelAnimationFrame(){},
  URL:{createObjectURL:()=>"blob:local-test",revokeObjectURL:url=>revoked.push(url)},
  localStorage:{setItem(){storageWrites++;}},fetch(){networkCalls++;throw Error("audio must stay local");}});
c.window=c;
vm.runInContext(source.replace("window.VoiceCoach = {","window.__testVoice = {state,beginRecording};\nwindow.VoiceCoach = {"),c);
const state=c.__testVoice.state;c.document.getElementById=()=>state.root;state.initialized=true;state.root=node();state.els=new Proxy({}, {get:(o,k)=>o[k]||(o[k]=node())});
c.VoiceCoach.open({script:"第一版，按原意开口。",scriptLabel:"第一版"});
const track={stopped:false,stop(){this.stopped=true;},removeEventListener(){}};
state.stream={getAudioTracks:()=>[track],getTracks:()=>[track]};
c.__testVoice.beginRecording();elapsed=4000;const sessionId=state.sessionId;
c.VoiceCoach.suspend();assert.equal(track.stopped,true,"returning to text immediately releases microphone");assert.equal(state.phase,"stopping");
// A late recorder stop must still be able to save the old audio while the learner views a new draft.
c.VoiceCoach.open({script:"第二版，修改了说法。",scriptLabel:"第二版"});assert.equal(state.sessionId,sessionId);
recorders[0].complete();await flush();await flush();
assert.ok(state.blob);assert.equal(state.recordedScript,"第一版，按原意开口。");
assert.match(state.els.recordingVersion.textContent,/修改前/);assert.equal(state.els.recordingScriptText.textContent,"第一版，按原意开口。");
const blob=state.blob,url=state.blobUrl;
c.VoiceCoach.suspend();c.VoiceCoach.open({script:"第二版，修改了说法。"});
assert.equal(state.blob,blob);assert.equal(state.blobUrl,url);assert.equal(revoked.length,0,"navigation cannot revoke playable recording");
c.VoiceCoach.suspend();c.VoiceCoach.open({script:"第一版，按原意开口。"});
assert.match(state.els.recordingVersion.textContent,/当前稿/);assert.equal(state.els.recordingScriptDetails.hidden,true);
c.VoiceCoach.reset();assert.equal(state.blob,null);assert.ok(revoked.includes(url),"new practice/deletion releases old audio");
assert.equal(storageWrites,0);assert.equal(networkCalls,0);
console.log("PASS voice continuity: immediate microphone release, late stop survives navigation, exact script association, old audio retained locally, explicit reset clears recording");
