// 诊断工件：真实官方 JSON-RPC 服务，初始化后暂时阻塞自己的事件循环，重现取消先于 handler 注册的时序。
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { closeAllLspClients, getLspClient, loadLspConfig, setLspTrustedRepos } from '../../src/tools/lsp';
const output=resolve(process.argv[2]);
const root=await mkdtemp(join(tmpdir(),'cairn-lsp-cancel-order-'));
const protocol=pathToFileURL(createRequire(import.meta.url).resolve('vscode-languageserver-protocol/node')).href;
const results:unknown[]=[];
try {
  for(let run=0;run<12;run++){
    const dir=join(root,String(run));await mkdir(join(dir,'.agent'),{recursive:true});
    const tracePath=join(dir,'trace.jsonl');
    const script=join(dir,'server.mjs');
    await writeFile(script,`
import {appendFileSync} from 'node:fs';
import {createProtocolConnection,StreamMessageReader,StreamMessageWriter} from ${JSON.stringify(protocol)};
const trace=(event,data={})=>appendFileSync(${JSON.stringify(tracePath)},JSON.stringify({event,...data})+'\\n');
const conn=createProtocolConnection(new StreamMessageReader(process.stdin),new StreamMessageWriter(process.stdout));
const pending=new Map();const cancelled=[];let count=0;
conn.onRequest('initialize',()=>({capabilities:{}}));
conn.onNotification('initialized',()=>{trace('block');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,150);trace('unblock');});
conn.onRequest('fixture/query',(params,token)=>new Promise(resolve=>{
 const id=++count;pending.set(id,resolve);trace('query',{id,alreadyCancelled:token.isCancellationRequested});
 token.onCancellationRequested(()=>{cancelled.push(id);trace('cancelCallback',{id});if(params.cancelOnToken){pending.delete(id);resolve({cancelled:true});}});
}));
conn.onRequest('fixture/state',()=>{const state={count,pending:[...pending.keys()],cancelled:[...cancelled]};trace('state',state);return state;});
conn.onRequest('fixture/release',({index})=>{const resolve=pending.get(index);pending.delete(index);resolve?.({request:index});return null;});
conn.onRequest('shutdown',()=>null);conn.onNotification('exit',()=>process.exit(0));conn.listen();
`);
    await writeFile(join(dir,'.agent','lsp.json'),JSON.stringify({lsp:{fixture:{command:process.execPath,args:[script],extensions:['.ts']}}}));
    setLspTrustedRepos([dir]);
    const client=await getLspClient(dir,loadLspConfig(dir),'fixture');
    const timedOut=client.request('fixture/query',{query:'slow',cancelOnToken:true},20).then(()=>false,()=>true);
    const other=client.request('fixture/query',{query:'other'});
    await timedOut;
    const firstState=await client.request('fixture/state',{});
    await client.request('fixture/release',{index:2});
    const otherResult=await other;
    // 只观察后续状态，不把它代替首次 state；保留两者之间的实际差异。
    await new Promise(r=>setTimeout(r,10));
    const laterState=await client.request('fixture/state',{});
    await closeAllLspClients();
    const trace=(await readFile(tracePath,'utf8')).trim().split('\n').map(s=>JSON.parse(s));
    results.push({run,firstState,laterState,otherResult,trace});
  }
  await writeFile(output,JSON.stringify(results,null,2));
  console.log(JSON.stringify({runs:results.length,output}));
} finally {await closeAllLspClients();setLspTrustedRepos([]);await rm(root,{recursive:true,force:true});}
