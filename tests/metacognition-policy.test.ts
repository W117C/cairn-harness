import { describe, expect, it } from 'vitest';
import { createInterventionPolicy } from '../src/agent/eval/metacognition';
import type { AgentEvent } from '../src/events';
const start: AgentEvent[] = [{type:'user_message',content:'Fix the application.'}];
const failure: AgentEvent[] = [...start,{type:'tool_call',id:'v1',name:'verify',args:{}},{type:'verify_result',callId:'v1',ok:false,attempt:1,maxAttempts:3,results:[{command:'test',ok:false,output:'AssertionError: expected saved state',cause:'code'}],cause:'code'}];

describe('bounded experimental interventions', () => {
  it('leaves the baseline entirely unchanged', () => {
    const policy=createInterventionPolicy({strategy:'baseline',seed:7,maxInterventions:2});
    expect(policy.next(failure)).toBeUndefined(); expect(policy.decisions).toEqual([]);
  });
  it('does not interrupt healthy execution', () => {
    const policy=createInterventionPolicy({strategy:'triggered',seed:7,maxInterventions:2});
    expect(policy.next(start)).toBeUndefined();
    expect(policy.next([...start,{type:'tool_result',callId:'read1',ok:true,output:'source code'}])).toBeUndefined();
  });
  it('uses the failed validation as evidence and does not repeat the same intervention', () => {
    const policy=createInterventionPolicy({strategy:'triggered',seed:7,maxInterventions:2});
    expect(policy.next(failure)).toContain('验证');
    expect(policy.decisions[0]).toMatchObject({reason:'validation-failed',evidenceEvent:3});
    expect(policy.next(failure)).toBeUndefined();
  });
  it('does not turn a toolchain failure into code replanning', () => {
    const policy=createInterventionPolicy({strategy:'triggered',seed:7,maxInterventions:2});
    const environment=failure.map(e=>e.type==='verify_result'?{...e,cause:'toolchain-missing' as const}:e);
    expect(policy.next(environment)).toBeUndefined();
  });
  it('honors the intervention limit even when failures differ', () => {
    const policy=createInterventionPolicy({strategy:'triggered',seed:7,maxInterventions:1});
    expect(policy.next(failure)).toBeDefined();
    expect(policy.next([...failure,{type:'tool_result',callId:'other',ok:false,output:'another error'}])).toBeUndefined();
    expect(policy.decisions).toHaveLength(1);
  });
  it('does not spend a code replanning intervention on a missing shell toolchain', () => {
    const policy=createInterventionPolicy({strategy:'triggered',seed:7,maxInterventions:2});
    expect(policy.next([...start,{type:'tool_call',id:'s',name:'run_shell',args:{command:'missing'}},
      {type:'tool_result',callId:'s',ok:false,output:'not found',exitCode:127,timedOut:false}])).toBeUndefined();
  });
  it('allows fresh evidence after user steering without resetting the total budget', () => {
    const policy=createInterventionPolicy({strategy:'triggered',seed:7,maxInterventions:2});
    policy.next(failure);
    const steered:AgentEvent[]=[...failure,{type:'user_message',content:'The API contract changed.'},...failure.slice(1)];
    expect(policy.next(steered)).toBeDefined(); expect(policy.decisions).toHaveLength(2);
  });
  it('periodic control uses the same bounded instruction rather than pretending failure', () => {
    const policy=createInterventionPolicy({strategy:'periodic',seed:7,maxInterventions:2,period:2});
    expect(policy.next(start)).toBeUndefined();
    expect(policy.next(start)).toContain('假设'); expect(policy.decisions[0]?.reason).toBe('periodic');
  });
  it('random control is reproducible and cannot exceed its budget', () => {
    const one=createInterventionPolicy({strategy:'random',seed:7,maxInterventions:2,probability:0.5});
    const two=createInterventionPolicy({strategy:'random',seed:7,maxInterventions:2,probability:0.5});
    const first=Array.from({length:20},()=>one.next(start));
    const second=Array.from({length:20},()=>two.next(start));
    expect(first).toEqual(second); expect(first.filter(Boolean).length).toBeLessThanOrEqual(2);
    expect(first.filter(Boolean).length).toBeGreaterThan(0);
  });
  it('rejects invalid strategies and budgets rather than silently running another arm', () => {
    expect(()=>createInterventionPolicy({strategy:'unknown' as never,seed:1,maxInterventions:2})).toThrow();
    expect(()=>createInterventionPolicy({strategy:'triggered',seed:1,maxInterventions:-1})).toThrow();
  });
});
