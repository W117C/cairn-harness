import { mkdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { writeFileAtomic } from '../../src/atomic-write';
import type { StudyTrial } from '../../src/agent/eval/study';
import { runValidity } from './eval-validity';
import { namedSetFailReason, type NamedSetReading } from './eval-named-sets';
import type { MeterReport } from '../../src/agent/metering';
export function meteredStudyTokens(report:MeterReport|undefined,fetchCalls:number):number|null{
 if(!report||fetchCalls<1||report.requests.length!==fetchCalls)return null;
 let total=0;
 for(const request of report.requests){
  const usage=request.usage;
  if(usage.inputTokens===null||usage.outputTokens===null)return null;
  // This study uses the OpenAI adapter: its meter subtracts only REPORTED cache buckets
  // from inclusive prompt_tokens. Adding those reported buckets reverses that conversion;
  // a missing cache bucket remains unknown, not a declaration of zero cache usage/cost.
  total+=usage.inputTokens+usage.outputTokens+(usage.cacheReadInputTokens??0)+(usage.cacheWriteInputTokens??0);
 }
 return total;
}

// Only absence is recoverable. Corrupt or inaccessible ledgers must survive for inspection.
export async function readStudyJson(path:string):Promise<unknown>{
 let text:string;try{text=await readFile(path,'utf8');}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error;}
 const value:unknown=JSON.parse(text);if(value===null)throw new Error('Study accounting cannot be null');return value;
}
// Exclusive directory is the attempt boundary. An interrupted paid attempt is never re-run or assigned an old receipt.
export async function startStudyTrial(path:string,trial:StudyTrial):Promise<boolean>{
 try{await mkdir(path);}catch(error){
  if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
  const start=await readStudyJson(join(path,'attempt-start.json')) as {trial?:StudyTrial}|null;
  if(JSON.stringify(start?.trial)!==JSON.stringify(trial))throw new Error('Existing attempt has no matching start receipt; preserve it for inspection');
  return false;
 }
 await writeFileAtomic(join(path,'attempt-start.json'),JSON.stringify({trial,startedAt:new Date().toISOString()})+'\n');
 return true;
}
export function studyOutcome(detail:{r:{requests:number;providerFace?:'真会话'|'剧本';namedSets?:unknown;touchedJudge?:boolean;study?:{meter?:MeterReport}};g:{ok:boolean;fails:string[]}}):'pass'|'fail'|'unmeasurable'{
 if(detail.r.touchedJudge)return 'fail'; // Determined, irreversible judge violation survives a later provider interruption.
 const observed=detail.r.study?.meter?.requests.filter(request=>request.outcome==='ok'||request.usage.outputTokens!==null).length??0;
 // Legacy requests counts usage EVENTS, not physical attempts. A completed transport receipt
 // proves the one-request model turn ran even if final verify closed before its usage event.
 if(!runValidity({...detail.r,requests:Math.max(detail.r.requests,observed)},detail.g.fails).valid)return 'unmeasurable';
 if((detail.r.namedSets as {state?:string}|undefined)?.state==='unreadable'){
  const unreadable=namedSetFailReason(detail.r.namedSets as NamedSetReading);
  // An unreadable report alone is unknown. Any other existing judge failure remains a failure.
  return detail.g.fails.some(failure=>failure!==unreadable)?'fail':'unmeasurable';
 }
 return detail.g.ok?'pass':'fail';
}
export async function hashHeldOutFiles(root:string,tasks:readonly {id:string;heldOut?:{files:readonly {src:string;dest:string}[]}}[]):Promise<Record<string,unknown>>{
 return Object.fromEntries(await Promise.all(tasks.map(async task=>[task.id,await Promise.all((task.heldOut?.files??[]).map(async file=>({
  ...file,sha256:createHash('sha256').update(await readFile(resolve(root,file.src))).digest('hex'),
 })))])));
}
