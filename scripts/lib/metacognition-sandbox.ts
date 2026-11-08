// Experiment-only boundary; reuse the existing Seatbelt runner without changing production policy.
import { mkdir, readdir, readFile, readlink, realpath, symlink, writeFile, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { dirname, join, relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { buildSandboxProfile, checkSandbox } from '../../src/main/sandbox';
import { killGroup, sanitizedEnv, spawnTracked } from '../../src/tools/process';
import { createOutputRing } from '../../src/tools/output-ring';
import { annotateExecCause, classifyVerifyFailure, withVerifyCauseNote, type ExecFn } from '../../src/agent/verify';
import { snapshotShellRedirects, shellRedirectReceipt } from '../../src/tools/snapshot';
import type { Tool, ToolResult } from '../../src/tools/base';
async function dependencyEntry(entry:Dirent,path:string):Promise<string>{
 if(entry.isSymbolicLink())return 'link:'+await readlink(path);
 if(entry.isDirectory())return 'directory';
 if(entry.isFile())return 'file:'+createHash('sha256').update(await readFile(path)).digest('hex');
 return 'special';
}
export async function snapshotStudyDependencies(workspace:string):Promise<string>{
 try{
  const rows:string[]=[],modules=join(workspace,'node_modules');
  rows.push('root:'+String((await lstat(modules)).isDirectory()));
  for(const entry of (await readdir(modules,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
   const path=join(modules,entry.name);
   if(['.vite','.vite-temp','.cache'].includes(entry.name)&&entry.isDirectory())continue;
   rows.push(entry.name+':'+await dependencyEntry(entry,path));
  }
  async function walk(dir:string,inModules=false):Promise<void>{
   for(const entry of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
    if(['.tmp','.git','.agent'].includes(entry.name)||(dir===workspace&&entry.name==='node_modules'))continue;
    const path=join(dir,entry.name),inside=inModules||entry.name==='node_modules';
    if(inside)rows.push(relative(workspace,path)+':'+await dependencyEntry(entry,path));
    if(entry.isDirectory())await walk(path,inside);
   }
  }
  await walk(workspace);return createHash('sha256').update(rows.join('\n')).digest('hex');
 }catch(error){return 'unreadable:'+(error as NodeJS.ErrnoException).code;}
}
export async function prepareStudyModules(workspace:string,source:string):Promise<string>{
 const modules=await realpath(source),local=join(workspace,'node_modules');await mkdir(local);
 // Vite writes configuration bundles/cache under node_modules; give each trial its own cache directories.
 for(const entry of await readdir(modules))if(!['.vite','.vite-temp','.cache'].includes(entry))await symlink(join(modules,entry),join(local,entry));
 return modules;
}
export async function createStudySandbox(workspace:string,denyRead:readonly string[],dependencyRoot?:string){
 const status=await checkSandbox();if(!status.available)throw new Error('Study requires the existing Seatbelt sandbox: '+status.reason);
 const roots=new Set(await Promise.all(denyRead.map(path=>realpath(path))));
 const active=await realpath(workspace),temp=await realpath(tmpdir());
 // Prior kept trial workspaces can contain solved source. Exclude sibling temporary directories too.
 for(const entry of await readdir(temp)){
  if(!entry.startsWith('loop-eval-')&&!entry.startsWith('study-reference-'))continue;
  const path=join(temp,entry),rel=relative(path,active);
  if(rel.startsWith('..')||isAbsolute(rel))roots.add(path);
 }
 // Dependencies may be shared by symlink; deny reads of the host checkout except its dependency directory.
 const modules=dependencyRoot??await realpath(join(workspace,'node_modules')),host=dirname(modules);
 roots.delete(host); // When run from the dependency host itself, replace the parent denial with child denials.
 for(const entry of await readdir(host))if(entry!=='node_modules')roots.add(join(host,entry));
 // Existing provider lifecycle judges use an in-process loopback HTTP fixture. Internet access remains denied.
 const loopback='\n(allow network-bind (local ip "localhost:*"))\n(allow network-inbound (local ip "localhost:*"))\n(allow network-outbound (remote ip "localhost:*"))';
 const localModules=join(active,'node_modules');
 const immutable='\n(deny file-write* (require-all (subpath '+JSON.stringify(localModules)+') '+['.vite','.vite-temp','.cache'].map(name=>'(require-not (subpath '+JSON.stringify(join(localModules,name))+'))').join(' ')+'))';
 const profile=buildSandboxProfile(workspace)+loopback+immutable+'\n'+[...roots].map(path=>'(deny file-read* (subpath '+JSON.stringify(path)+'))').join('\n');
 const tmp=join(workspace,'.tmp');await mkdir(tmp,{recursive:true});
 // The model cannot write the trial's parent. Keep the profile outside its writable workspace.
 const profilePath=join(dirname(workspace),'study-sandbox.sb');await writeFile(profilePath,profile,{flag:'wx'});
 // Seatbelt cannot be nested. Reuse the same profile, process lifecycle and bounded output primitives.
 const run=(command:string,timeoutMs=60_000,signal?:AbortSignal):Promise<ToolResult>=>new Promise(resolve=>{
  const ring=createOutputRing(32*1024);let settled=false,timedOut=false,cancelled=false;
  const finish=(code:number|null)=>{
   if(settled)return;settled=true;handle.dispose();signal?.removeEventListener('abort',abort);
   resolve({ok:code===0&&!timedOut&&!cancelled,output:ring.read()+(timedOut?'\n[study shell timeout]':cancelled?'\n[study shell cancelled]':''),exitCode:code,timedOut});
  };
  const handle=spawnTracked('sandbox-exec',['-f',profilePath,'/bin/bash','-c',command],{cwd:workspace,env:sanitizedEnv(tmp),timeoutMs,onTimeout:()=>{timedOut=true;finish(null);}});
  const abort=()=>{cancelled=true;killGroup(handle.child);finish(null);};
  handle.child.stdout?.on('data',(chunk:Buffer)=>ring.push(chunk));handle.child.stderr?.on('data',(chunk:Buffer)=>ring.push(chunk));
  handle.child.once('error',error=>{ring.push(Buffer.from(error.message));finish(null);});handle.child.once('close',finish);
  if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
 });
 const exec:ExecFn=async(command,_cwd,timeoutMs,signal)=>{
  const result=await run(command,timeoutMs,signal),cause=classifyVerifyFailure({timedOut:result.timedOut===true,exitCode:result.exitCode??null,output:result.output});
  return {command,ok:result.ok,output:result.ok?result.output:withVerifyCauseNote(result.output,cause),exitCode:result.exitCode??null,...(!result.ok?{cause}:{})};
 };
 const shell:Tool={name:'run_shell',async run(args,ctx){
  if(typeof args.command!=='string'||!args.command.trim())throw new Error('run_shell requires a command');
  const snapshot=await snapshotShellRedirects(workspace,args.command,{callId:ctx.callId,enabled:ctx.snapshot!==false});
  const result=await run(args.command,60_000,ctx.signal);
  return annotateExecCause({...result,output:result.output+shellRedirectReceipt(snapshot)},{timedOut:result.timedOut===true,exitCode:result.exitCode??null});
 }};
 return {exec,shell};
}
