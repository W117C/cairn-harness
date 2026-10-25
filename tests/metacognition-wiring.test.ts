import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createEventLog, replay } from '../src/events';
import { createSessionProvider } from '../src/agent/session-provider';
import { createInterventionPolicy } from '../src/agent/eval/metacognition';
import { streamGlm } from '../src/providers/glm';
import { RequestMeter } from '../src/agent/metering';
import { createHash } from 'node:crypto';
vi.mock('../src/agent/memory/inject',async()=>(await import('./helpers/memory-inject-mock')).memoryInjectMock({project:null,global:null}));
const directories:string[]=[];
afterEach(async()=>{await Promise.all(directories.splice(0).map(path=>rm(path,{recursive:true,force:true})));});

describe('experimental intervention reaches the actual model request',()=>{
  it('adds a bounded transient instruction once without fabricating user history',async()=>{
    const workspace=await mkdtemp(join(tmpdir(),'meta-wiring-'));directories.push(workspace);
    const path=join(workspace,'events.jsonl'),log=createEventLog(path);
    await log.append({type:'user_message',content:'Fix the task.'});
    await log.append({type:'verify_result',callId:'check',ok:false,attempt:1,maxAttempts:3,results:[{command:'test',ok:false,output:'AssertionError',cause:'code'}],cause:'code'});
    await log.close?.();
    const policy=createInterventionPolicy({strategy:'triggered',seed:1,maxInterventions:2});
    const requests:{role:string;content:string|null}[][]=[];
    const provider=createSessionProvider(path,{workspace,map:false,requestIntervention:policy.next,
      transport:async function*(messages){requests.push(messages);yield {type:'assistant_message',content:'done'};}});
    for await(const _ of provider.stream([])){/* actual assembly */}
    for await(const _ of provider.stream([])){/* deduplicated */}
    expect(requests[0]?.some(message=>message.content?.includes('[实验策略提示]'))).toBe(true);
    expect(requests[1]?.some(message=>message.content?.includes('[实验策略提示]'))).toBe(false);
    expect((await replay(path)).some(event=>event.type==='user_message'&&event.content.includes('[实验策略提示]'))).toBe(false);
  });
});
it('meters the final capped study request body before the physical fetch',async()=>{
 const meter=new RequestMeter();let wire='';
 const fetchImpl=(async(_url,init)=>{
  wire=String(init?.body);
  return Response.json({choices:[{message:{content:'done'},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:1}});
 }) as typeof fetch;
 for await(const _ of streamGlm([{role:'user',content:'fixture'}],{apiKey:'fixture',model:'fixture',endpoint:'https://fixture.example/v1',stream:false,
  extraBody:{max_tokens:128,thinking:{type:'enabled'}},fetchImpl,metering:{meter,category:'main'}})){}
 expect(JSON.parse(wire)).toMatchObject({max_tokens:128,thinking:{type:'enabled'}});
 expect(meter.snapshot().requests[0]).toMatchObject({bodySha256:createHash('sha256').update(wire).digest('hex'),bytes:Buffer.byteLength(wire)});
});
