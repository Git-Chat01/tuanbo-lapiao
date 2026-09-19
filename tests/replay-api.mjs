// Local UI verification against an already-recorded real report; never calls a model.
// node tests/replay-api.mjs tests/tmp_results/<run>/draft-1-run-1.json
import http from "node:http";
import {readFile} from "node:fs/promises";
if(!process.argv[2])throw new Error("Provide the saved response file");
const saved=JSON.parse(await readFile(process.argv[2],"utf8"));
if(saved.status!==200||!saved.body?.report||!saved.script)throw new Error("Expected a successful recorded response");
http.createServer(async(req,res)=>{
  const headers={"Access-Control-Allow-Origin":"http://127.0.0.1:8080","Access-Control-Allow-Headers":"Content-Type, Accept","Content-Type":"application/json; charset=utf-8"};
  if(req.method==="OPTIONS"){res.writeHead(204,headers);return res.end();}
  if(req.method!=="POST"||req.url!=="/api/coach"){res.writeHead(404,headers);return res.end('{}');}
  let raw="";for await(const chunk of req){raw+=chunk;if(raw.length>12000){res.writeHead(413,headers);return res.end('{}');}}
  try{
    const body=JSON.parse(raw);
    if(body.accessCode!=="demo-access"){res.writeHead(401,headers);return res.end(JSON.stringify({error:true,message:"入口码不对"}));}
    if(body.script!==saved.script){res.writeHead(400,headers);return res.end(JSON.stringify({error:true,message:"本地回放只接受对应测试原稿"}));}
    res.writeHead(200,headers);res.end(JSON.stringify(saved.body));
  }catch{res.writeHead(400,headers);res.end('{}');}
}).listen(8787,"127.0.0.1",()=>console.log("Recorded-report replay API listening on 127.0.0.1:8787"));
