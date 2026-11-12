import { describe, it, expect } from 'vitest';
import { streamOpenAI } from '../src/providers/openai';
import { projectContext } from '../src/agent/context';
import { runLoop } from '../src/agent/loop';
import { RequestMeter } from '../src/agent/metering';
import type { AgentEvent } from '../src/events';

const nativeURL = 'https://api.deepseek.com/v1';
const tools = [{ name: 'read_probe', parameters: { type: 'object', properties: {} } }];
const thought = 'Check the external observation before deciding.';
function reply(stream: boolean, tool: boolean): Response {
  const message = tool
    ? { content: 'Checking.', reasoning_content: thought, tool_calls: [{ id: 'probe-1', index: 0, type: 'function', function: { name: 'read_probe', arguments: '{}' } }] }
    : { content: '7' };
  const usage = { prompt_tokens: 10, completion_tokens: 8, completion_tokens_details: { reasoning_tokens: 5 } };
  if (!stream) return Response.json({ id: 'reply-1', choices: [{ message, finish_reason: tool ? 'tool_calls' : 'stop' }], usage });
  const chunks = tool
    ? [{ id: 'reply-1', choices: [{ delta: { reasoning_content: thought.slice(0, 12) } }] },
      { id: 'reply-1', choices: [{ delta: { reasoning_content: thought.slice(12), content: message.content, tool_calls: message.tool_calls }, finish_reason: 'tool_calls' }], usage }]
    : [{ id: 'reply-2', choices: [{ delta: { content: '7' }, finish_reason: 'stop' }], usage }];
  return new Response(chunks.map(c => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
}
async function roundTrip(stream: boolean, second: { model?: string; baseURL?: string } = {}) {
  const requests: Record<string, any>[] = [];
  const fetchImpl = (async (_url, init) => {
    const body = JSON.parse(String(init?.body)); requests.push(body);
    return reply(body.stream !== false, requests.length === 1);
  }) as typeof fetch;
  const opts = { apiKey: 'fixture', model: 'deepseek-v4-flash', baseURL: nativeURL, reasoningEffort: 'high', stream, fetchImpl };
  const outputs: AgentEvent[] = [];
  for await (const event of streamOpenAI([{ role: 'user', content: 'Read the probe and answer.' }], opts, tools)) outputs.push(event);
  const history: AgentEvent[] = [{ type: 'user_message', content: 'Read the probe and answer.' }, ...outputs, { type: 'tool_result', callId: 'probe-1', ok: true, output: '7' }];
  const projected = projectContext(history);
  for await (const _ of streamOpenAI(projected, { ...opts, ...second }, tools)) { /* drain actual serializer */ }
  return { requests, outputs, projected, history, opts };
}

describe('provider-native reasoning survives real tool continuation', () => {
  for (const stream of [true, false]) it(`${stream ? 'stream' : 'non-stream'} preserves native reasoning through context and the next request`, async () => {
    const { requests, projected } = await roundTrip(stream);
    const assistants = requests[1]!.messages.filter((m: any) => m.role === 'assistant');
    expect(assistants.some((m: any) => m.reasoning_content === thought)).toBe(true);
    expect(projected.filter(m => m.role === 'assistant').map(m => m.content).join('')).not.toContain(thought);
    expect(requests[1]!.messages.find((m: any) => m.tool_calls)?.reasoning_content).toBe(thought);
  });
  it('does not send another model its native reasoning state', async () => {
    const { requests } = await roundTrip(true, { model: 'other-model' });
    expect(JSON.stringify(requests[1]!.messages)).not.toContain(thought);
  });
  it('does not send another endpoint its native reasoning state', async () => {
    const { requests } = await roundTrip(true, { baseURL: 'https://other.example/v1' });
    expect(JSON.stringify(requests[1]!.messages)).not.toContain(thought);
  });
  it('does not attach worker state to parent messages', async () => {
    const { history } = await roundTrip(true);
    const worker = history.map(e => e.type === 'user_message' ? e : { ...e, agent_id: 'worker-1' }) as AgentEvent[];
    expect(JSON.stringify(projectContext(worker))).not.toContain(thought);
  });
  it('keeps reported reasoning tokens separate from total output tokens', async () => {
    const { outputs } = await roundTrip(true);
    expect(outputs.find(e => e.type === 'usage')).toMatchObject({ outputTokens: 8, reasoningOutputTokens: 5 });
  });
  it('preserves reasoning for a completed assistant answer across a later user turn', async () => {
    const { outputs, opts } = await roundTrip(true);
    const native = outputs.filter(e => e.type === 'thinking_delta' || e.type === 'assistant_delta');
    const requests: any[] = [];
    const fetchImpl = (async (_url, init) => { requests.push(JSON.parse(String(init?.body))); return reply(false, false); }) as typeof fetch;
    const projected = projectContext([{ type: 'user_message', content: 'first' }, ...native, { type: 'user_message', content: 'next' }]);
    for await (const _ of streamOpenAI(projected, { ...opts, stream: false, fetchImpl }, tools)) { /* drain */ }
    expect(requests[0].messages.find((m: any) => m.role === 'assistant').reasoning_content).toBe(thought);
  });
});

describe('explicit native reasoning switch', () => {
  it('disables native DeepSeek thinking instead of merely omitting effort', async () => {
    let body: any;
    const fetchImpl = (async (_url, init) => { body = JSON.parse(String(init?.body)); return reply(false, false); }) as typeof fetch;
    for await (const _ of streamOpenAI([{ role: 'user', content: 'hi' }], { apiKey: 'fixture', model: 'deepseek-v4-flash', baseURL: nativeURL, reasoningEffort: 'off', stream: false, fetchImpl })) { /* drain */ }
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body).not.toHaveProperty('reasoning_effort');
  });
  it('preserves default request shape when no switch was requested', async () => {
    let body: any;
    const fetchImpl = (async (_url, init) => { body = JSON.parse(String(init?.body)); return reply(false, false); }) as typeof fetch;
    for await (const _ of streamOpenAI([{ role: 'user', content: 'hi' }], { apiKey: 'fixture', model: 'some-model', baseURL: 'https://example.com/v1', stream: false, fetchImpl })) { /* drain */ }
    expect(body).not.toHaveProperty('thinking'); expect(body).not.toHaveProperty('reasoning_effort');
  });
});

describe('native reasoning response boundaries', () => {
  it('keeps a multi-delta response together after a summary insertion', () => {
    const history: AgentEvent[] = [
      {type:'user_message',content:'task'},
      {type:'thinking_delta',callId:'a',text:thought,reasoning:{id:'r',source:'native'}},
      {type:'assistant_delta',callId:'a',text:'Part one. '},
      {type:'assistant_delta',callId:'a',text:'Part two.'},
      {type:'tool_call',id:'t',name:'read_probe',args:{},reasoningId:'r'},
      {type:'tool_result',callId:'t',ok:true,output:'7'},
      {type:'compaction',trigger:'manual',reason:'user_request',tokens_before:100,tokens_after:10,compressed_event_ids:[],summary_offset:2,summary:'earlier context'},
    ];
    const assistants=projectContext(history).filter(m=>m.role==='assistant');
    expect(assistants).toHaveLength(1);
    expect(assistants[0]).toMatchObject({content:'Part one. Part two.',reasoning:{content:thought},tool_calls:[{id:'t'}]});
  });
  it('does not attach a truncated reasoning-only response to a reused text call id', () => {
    const projected=projectContext([
      {type:'thinking_delta',callId:'a-0',text:thought,reasoning:{id:'old',source:'native'}},
      {type:'usage',inputTokens:1,outputTokens:1},
      {type:'turn_truncated',callId:'a-0',outcome:'output_budget',stop_reason:'length'},
      {type:'assistant_delta',callId:'a-0',text:'new plain answer'},
    ] as AgentEvent[]);
    expect(projected.at(-1)).not.toHaveProperty('reasoning');
  });
  it('uses the actual extraBody model as the reasoning provenance', async () => {
    const requests:any[]=[];
    const fetchImpl=(async (_url,init)=>{requests.push(JSON.parse(String(init?.body)));return reply(false,requests.length===1);}) as typeof fetch;
    const opts={apiKey:'fixture',model:'model-A',extraBody:{model:'model-B'},baseURL:nativeURL,reasoningEffort:'high',stream:false,fetchImpl};
    const events:AgentEvent[]=[];
    for await(const e of streamOpenAI([{role:'user',content:'task'}],opts,tools))events.push(e);
    for await(const _ of streamOpenAI(projectContext([...events,{type:'tool_result',callId:'probe-1',ok:true,output:'7'}]),{...opts,extraBody:{model:'model-A'}},tools)){}
    expect(JSON.stringify(requests[1].messages)).not.toContain(thought);
  });
  it('keeps a native response atomic with its tool calls during compaction', async () => {
    const { atomicUnits } = await import('../src/agent/compaction');
    const { history } = await roundTrip(true);
    const nativeStart = history.findIndex(e => e.type === 'thinking_delta') + 1;
    const callEnd = history.findIndex(e => e.type === 'tool_result') + 1;
    expect(atomicUnits(history).some(unit => unit.lo <= nativeStart && unit.hi >= callEnd)).toBe(true);
  });
  it('does not reuse a previous response state when an upstream reply id is reused', async () => {
    const { history } = await roundTrip(true);
    const projected = projectContext([...history, {type:'user_message',content:'another question'}, {type:'assistant_delta',callId:'reply-1',text:'plain answer'}]);
    expect(projected.at(-1)).not.toHaveProperty('reasoning');
  });
});

describe('final verify request accounting',()=>{
  for(const stream of [true,false])it(`retains the authoritative receipt when verification stops the ${stream?'stream':'non-stream'} loop before its usage event`,async()=>{
    const usage={prompt_tokens:10,completion_tokens:8};let fetches=0;
    const call={id:'final-verify',type:'function',function:{name:'verify',arguments:'{}'}};
    const fetchImpl=(async()=>{
      fetches++;
      const choice={...stream?{delta:{tool_calls:[{...call,index:0}]}}:{message:{tool_calls:[call]}},finish_reason:'tool_calls'};
      return stream?new Response(`data: ${JSON.stringify({id:'r',choices:[choice],usage})}\n\ndata: [DONE]\n\n`,{headers:{'Content-Type':'text/event-stream'}})
        :Response.json({id:'r',choices:[choice],usage});
    }) as typeof fetch;
    const events:AgentEvent[]=[],meter=new RequestMeter();
    await runLoop({workspace:'/tmp',mode:'auto',events:{async append(event){events.push(event);}},
      provider:{stream(messages){return streamOpenAI(messages,{apiKey:'fixture',model:'fixture',baseURL:nativeURL,stream,fetchImpl,metering:{meter,category:'main'}});}},
      verify:{async run(){return {ok:true,results:[{command:'fixture',ok:true,output:'passed',exitCode:0}]};}}});
    expect(fetches).toBe(1);
    expect(events.some(event=>event.type==='verify_result'&&event.ok)).toBe(true);
    expect(events.filter(event=>event.type==='usage')).toHaveLength(0);
    const report=meter.snapshot();
    expect(report.requests).toHaveLength(1);
    expect(report.requests[0]?.usage).toMatchObject({inputTokens:10,outputTokens:8});
  });
});
