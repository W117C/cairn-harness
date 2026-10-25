// Bounded randomized pilot over the existing production-compatible loop evaluator.
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve, join, relative, isAbsolute, dirname } from 'node:path';
import { parseTaskSetJson } from '../src/agent/eval/task-set';
import { createStudySchedule, summarizeStudy, type StudyRecord } from '../src/agent/eval/study';
import { STUDY_STRATEGIES } from '../src/agent/eval/metacognition';
import { writeFileAtomic } from '../src/atomic-write';
import { killGroup } from '../src/tools/process';
import { readStudyJson, startStudyTrial, studyOutcome, hashHeldOutFiles, meteredStudyTokens } from './lib/metacognition-run-state';

const root=resolve(import.meta.dirname,'..'),args=process.argv.slice(2);
const pick=(name:string,fallback:string)=>{const at=args.indexOf(name);return at<0?fallback:args[at+1]??fallback;};
const tasksPath=resolve(pick('--tasks','')),outName=pick('--out','outputs/metacognition-pilot-2026-10-25');
if(!args.includes('--tasks')||isAbsolute(outName)||outName.split('/').includes('..'))throw new Error('Pass --tasks and a repository-relative --out');
const out=resolve(root,outName),reps=Number(pick('--reps','1')),seed=Number(pick('--seed','20261025'));
const strategies=pick('--strategies',STUDY_STRATEGIES.join(',')).split(',');
if(strategies.some(strategy=>!(STUDY_STRATEGIES as readonly string[]).includes(strategy)))throw new Error('Unknown study strategy');
const maxSteps=Number(pick('--max-steps','24')),timeoutMs=Number(pick('--timeout-ms','120000')),outputCap=Number(pick('--output-cap','4096'));
if([maxSteps,timeoutMs,outputCap].some(value=>!Number.isSafeInteger(value)||value<1))throw new Error('Invalid resource bound');
const text=await readFile(tasksPath,'utf8'),parsed=parseTaskSetJson(text);
if(parsed.errors.length)throw new Error(parsed.errors.join('\n'));
const only=pick('--only','').split(',').filter(Boolean),tasks=parsed.tasks.filter(task=>only.length===0||only.includes(task.id));
if(only.some(id=>!tasks.some(task=>task.id===id)))throw new Error('Unknown selected task');
const schedule=createStudySchedule({tasks:tasks.map(task=>task.id),strategies,reps,seed});
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
async function treeHash(path:string):Promise<string>{
 const entries:string[]=[];
 async function walk(dir:string){for(const entry of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
  if(['node_modules','.tmp','.git','.vitest'].includes(entry.name))continue;
  const full=join(dir,entry.name);if(entry.isDirectory())await walk(full);else if(entry.isFile())entries.push(relative(path,full)+'\0'+hash(await readFile(full)));
 }}await walk(path);return hash(entries.join('\n'));
}
const sourceFiles=['src/providers/openai.ts','src/agent/context.ts','src/agent/compaction.ts','src/agent/session-provider.ts','src/agent/eval/metacognition.ts','src/agent/eval/study.ts','scripts/loop-eval.ts','scripts/metacognition-study.ts','scripts/lib/metacognition-run-state.ts','scripts/lib/metacognition-sandbox.ts'];
const codeHashes=Object.fromEntries(await Promise.all(sourceFiles.map(async file=>[file,hash(await readFile(join(root,file)))])));
const taskHashes=Object.fromEntries(await Promise.all(tasks.map(async task=>[task.id,await treeHash(resolve(root,task.seed.path))])));
const heldOutHashes=await hashHeldOutFiles(root,tasks);
const deniedRoots=[dirname(tasksPath),...pick("--private-roots","").split(",").filter(Boolean).map(path=>resolve(path))];
const harnessHashes={src:await treeHash(join(root,'src')),scripts:await treeHash(join(root,'scripts')),
 package:hash(await readFile(join(root,'package.json'))),lockfile:hash(await readFile(join(root,'pnpm-lock.yaml')))};
const config={harnessHashes,deniedRoots,heldOutHashes,model:process.env.CAIRN_MODEL??null,endpoint:process.env.CAIRN_ENDPOINT??null,tasksDigest:hash(text),codeHashes,taskHashes,
 reps,seed,strategies,maxSteps,timeoutMs,outputCap,schedule,concurrency:1,memory:'empty and isolated per trial',
 contract:'Requested effort and explicit enabled thinking; exact effort enforcement is unverified. Tokens and reasoning details are provider-reported; monetary price is unknown.'};
if(!process.env.CAIRN_API_KEY||!process.env.CAIRN_ENDPOINT||!process.env.CAIRN_MODEL)throw new Error('Provide model credentials through environment; no model request sent');
await mkdir(out,{recursive:true});
const manifestPath=join(out,'manifest.json');
const previous=await readStudyJson(manifestPath);
if(previous!==undefined&&(!args.includes('--resume')||JSON.stringify(previous)!==JSON.stringify(config)))throw new Error('Existing study differs or --resume was not requested; preserve it and choose a new output');
await writeFileAtomic(manifestPath,JSON.stringify(config,null,2)+'\n');
let records:(StudyRecord&{detail:unknown})[]=[];
if(args.includes('--resume')){
 const saved=await readStudyJson(join(out,'trials.json'));
 if(saved!==undefined&&!Array.isArray(saved))throw new Error('Study ledger must be an array');
 records=(saved??[]) as typeof records;
}
summarizeStudy(schedule,records); // reject duplicate/foreign resume state before any request
const identity=(trial:{taskId:string;strategy:string;rep:number})=>JSON.stringify([trial.taskId,trial.strategy,trial.rep]);
async function save(){await writeFileAtomic(join(out,'trials.json'),JSON.stringify(records,null,2)+'\n');await writeFileAtomic(join(out,'summary.json'),JSON.stringify(summarizeStudy(schedule,records),null,2)+'\n');}
await save();
for(const [index,trial]of schedule.entries()){
 if(records.some(record=>identity(record)===identity(trial)))continue;
 const trialName=`trial-${String(index+1).padStart(3,'0')}`,trialOut=join(outName,trialName),directory=join(root,trialOut);
 if(!await startStudyTrial(directory,trial)){
  records.push({...trial,outcome:'unmeasurable',tokens:null,seconds:null,detail:{reason:'interrupted attempt; wall time and usage unknown; not restarted'}});
  await save();console.log(JSON.stringify({event:'trial-recovered-interrupted',...trial}));continue;
 }
 await mkdir(join(directory,'memory'),{recursive:true});
 console.log(JSON.stringify({event:'trial-start',trial:index+1,total:schedule.length,...trial}));
 const cli=['--import','tsx','scripts/loop-eval.ts','--tasks',tasksPath,'--only',trial.taskId,'--reps','1','--max-steps',String(maxSteps),'--thinking',trial.strategy==='high'?'high':'low',
 '--metacognition',trial.strategy,'--study-seed',String(trial.seed),'--study-max-output',String(outputCap),'--study-timeout-ms',String(timeoutMs),'--arm',trial.strategy,'--out',trialOut,'--keep'];
 const started=Date.now(),log=createWriteStream(join(directory,'process.log'),{flags:'a'});
 const code=await new Promise<number|null>((done,reject)=>{
  const child=spawn(process.execPath,cli,{cwd:root,env:{...process.env,M2D_MEMORY_HOME:join(directory,'memory'),CAIRN_STUDY_DENY_READ:JSON.stringify(deniedRoots),pnpm_config_verify_deps_before_run:'false'},detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
  child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
  const timer=setTimeout(()=>killGroup(child),timeoutMs+90_000);
  child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('close',exit=>{clearTimeout(timer);log.end();done(exit);});
 });
 let detail:any=null;try{const rows=JSON.parse(await readFile(join(directory,'readings.json'),'utf8'));if(rows.length===1)detail=rows[0];}catch{}
 let outcome:'pass'|'fail'|'unmeasurable'='unmeasurable';
 if(code===0&&detail?.r&&detail?.g&&detail.r.id===trial.taskId&&detail.r.study?.strategy===trial.strategy&&detail.r.study?.seed===trial.seed){
  outcome=studyOutcome(detail);
 }
 const tokens=meteredStudyTokens(detail?.r?.study?.meter,detail?.r?.study?.physicalRequests??0);
 const record={...trial,outcome,tokens,seconds:(Date.now()-started)/1000,detail:{exitCode:code,reading:detail}};
 records.push(record);await save();
 console.log(JSON.stringify({event:'trial-end',trial:index+1,...trial,outcome,tokens:record.tokens,seconds:record.seconds,interventions:detail?.r?.study?.interventions?.length??null,
  modelSeconds:detail?.r?.seconds??null,failures:detail?.g?.fails??null}));
}
console.log(JSON.stringify({event:'study-complete',out,summary:summarizeStudy(schedule,records)}));
