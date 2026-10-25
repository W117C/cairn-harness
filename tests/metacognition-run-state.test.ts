import { it, expect } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readStudyJson, startStudyTrial, studyOutcome, hashHeldOutFiles, meteredStudyTokens } from '../scripts/lib/metacognition-run-state';
import { RequestMeter } from '../src/agent/metering';
const trial={taskId:'C1',strategy:'baseline',rep:1,seed:2};
it('fails closed on corrupt or unreadable accounting and only accepts missing files as missing',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'study-state-'));
 try {
  expect(await readStudyJson(join(dir,'absent'))).toBeUndefined();
  await writeFile(join(dir,'null.json'),'null');
  await expect(readStudyJson(join(dir,'null.json'))).rejects.toThrow();
  await writeFile(join(dir,'trials.json'),'[{');
  await expect(readStudyJson(join(dir,'trials.json'))).rejects.toThrow();
  await expect(readStudyJson(dir)).rejects.toThrow();
  expect(await readFile(join(dir,'trials.json'),'utf8')).toBe('[{');
 }finally{await rm(dir,{recursive:true,force:true});}
});
it('never restarts or accepts readings from an interrupted attempt',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'study-attempt-')),path=join(dir,'trial');
 try {
  expect(await startStudyTrial(path,trial)).toBe(true);
  await writeFile(join(path,'readings.json'),JSON.stringify([{g:{ok:true}}]));
  expect(await startStudyTrial(path,trial)).toBe(false);
  await expect(startStudyTrial(path,{...trial,seed:3})).rejects.toThrow();
 }finally{await rm(dir,{recursive:true,force:true});}
});
it('keeps determined model failures in the denominator even without a readable named judge',()=>{
 const named={state:'unreadable' as const,reasons:['no test output'],unmatched:[]};
 const r={requests:1,namedSets:named,providerFace:'真会话' as const};
 expect(studyOutcome({r,g:{ok:false,fails:['改了判卷面','verify 未通过/未跑']}})).toBe('fail');
 expect(studyOutcome({r:{...r,touchedJudge:true},g:{ok:false,fails:['改了判卷面','runLoop 抛错:HTTP 429']}})).toBe('fail');
 expect(studyOutcome({r,g:{ok:true,fails:[]}})).toBe('unmeasurable');
 expect(studyOutcome({r:{...r,namedSets:{state:'pass'}},g:{ok:true,fails:[]}})).toBe('pass');
});
it('freezes held-out bytes as well as their paths',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'study-oracle-'));
 try {
  const path=join(dir,'hidden.test.ts');await writeFile(path,'first');
  const task={id:'C1',heldOut:{files:[{src:path,dest:'tests/hidden.test.ts'}]}};
  const one=await hashHeldOutFiles(dir,[task]);await writeFile(path,'second');
  expect(await hashHeldOutFiles(dir,[task])).not.toEqual(one);
 }finally{await rm(dir,{recursive:true,force:true});}
});
it('uses complete transport receipts and preserves unknown requests without assuming free retries',()=>{
 const meter=new RequestMeter(),id=meter.beginRequest('main','{}');
 meter.finishRequest(id,'ok',{inputTokens:10,outputTokens:5,cacheReadInputTokens:3});
 expect(meteredStudyTokens(meter.snapshot(),1)).toBe(18);
 expect(meteredStudyTokens(meter.snapshot(),2)).toBeNull();
 const retry=meter.beginRequest('main','{}');meter.finishRequest(retry,'failed');
 expect(meteredStudyTokens(meter.snapshot(),2)).toBeNull();
});
it('recognizes a real one-request success even if final verification closes the usage event stream',()=>{
 const meter=new RequestMeter(),id=meter.beginRequest('main','{}');
 meter.finishRequest(id,'ok',{inputTokens:10,outputTokens:5});
 expect(studyOutcome({r:{requests:0,providerFace:'真会话',study:{meter:meter.snapshot()}},g:{ok:true,fails:[]}})).toBe('pass');
 const failed=new RequestMeter(),retry=failed.beginRequest('main','{}');failed.finishRequest(retry,'failed');
 expect(studyOutcome({r:{requests:0,providerFace:'真会话',study:{meter:failed.snapshot()}},g:{ok:false,fails:['authentication failure']}})).toBe('unmeasurable');
});
