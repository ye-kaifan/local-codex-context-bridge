import { CATALOG,INSTRUCTIONS } from './catalog.mjs';
import { sanitizeForTransport } from '../dist/src/runtime.js';
export function serveStdio(hub,{input=process.stdin,output=process.stdout,catalog=CATALOG,instructions=INSTRUCTIONS}={}) {
  let initialized=false,closing=false;let writes=Promise.resolve();
  const active=new Set();
  function send(value){
    let body=JSON.stringify(value)+'\n';
    const limit=value.result?.structuredContent?.result?.mode==='history'?256*1024:1024*1024;
    if(Buffer.byteLength(body)>limit)body=JSON.stringify({jsonrpc:'2.0',id:value.id,result:{isError:true,content:[{type:'text',text:'Response byte budget exceeded; reduce the page size. No partial content was returned.'}]}})+'\n';
    writes=writes.then(()=>new Promise((resolve,reject)=>output.write(body,error=>error?reject(error):resolve())));return writes;
  }
  const error=(id,code,message)=>send({jsonrpc:'2.0',id,error:{code,message}});
  async function accept(line){
    let value;try{if(Buffer.byteLength(line)>65536)throw new Error();value=JSON.parse(line);}catch{return error(null,-32700,'Invalid or oversized JSON');}
    const {id,method,params={}}=value??{};
    if(value?.jsonrpc!=='2.0'||typeof method!=='string')return error(id??null,-32600,'Invalid Request');
    if(id===undefined)return; // Notifications do not return messages or start work.
    if(typeof id!=='string'&&!(typeof id==='number'&&Number.isSafeInteger(id)))return error(null,-32600,'Invalid ID');
    if(active.has(id)||active.size>=16)return error(id,-32000,'Duplicate request or busy');
    active.add(id);
    try{
      if(method==='initialize'){
        if(!params||typeof params.protocolVersion!=='string')return error(id,-32602,'protocolVersion required');
        initialized=true;return send({jsonrpc:'2.0',id,result:{protocolVersion:['2025-11-25','2025-06-18','2025-03-26','2024-11-05','2024-10-07'].includes(params.protocolVersion)?params.protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'local-codex-context',version:'1.0.0'},instructions}});
      }
      if(!initialized)return error(id,-32002,'Initialize first');
      if(method==='ping')return send({jsonrpc:'2.0',id,result:{}});
      if(method==='tools/list')return send({jsonrpc:'2.0',id,result:{tools:catalog}});
      if(method!=='tools/call')return error(id,-32601,'Method denied');
      const result=await hub.call(params.name,params.arguments??{});
      return send({jsonrpc:'2.0',id,result:{content:[{type:'text',text:'structured result'}],structuredContent:result}});
    }catch(e){return send({jsonrpc:'2.0',id,result:{isError:true,content:[{type:'text',text:JSON.stringify({error:sanitizeForTransport(String(e.message),{maxStringChars:700,totalCharBudget:700})})}]}});}
    finally{active.delete(id);}
  }
  // Incremental bounded framing rejects a giant line before retaining it in memory.
  let buffer=Buffer.alloc(0),discard=false;
  input.on('data',chunk=>{
    buffer=Buffer.concat([buffer,chunk]);let i;
    while((i=buffer.indexOf(10))!==-1){const line=buffer.subarray(0,i);buffer=buffer.subarray(i+1);if(discard){discard=false;continue;}void accept(line.toString('utf8'));}
    if(buffer.length>65536){buffer=Buffer.alloc(0);if(!discard)void error(null,-32700,'JSON line too large');discard=true;}
  });
  async function close(){if(closing)return;closing=true;input.pause();await hub.close();await writes;}
  input.once('end',()=>void close());input.once('error',()=>void close());return {close};
}
