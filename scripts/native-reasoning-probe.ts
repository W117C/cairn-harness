// Bounded, read-only native protocol probe. Never persists prompt traces or credentials.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { streamOpenAI, chatCompletionsEndpoint } from '../src/providers/openai';
import { projectContext } from '../src/agent/context';
import type { AgentEvent } from '../src/events';
import type { ProviderMessage } from '../src/providers';

const output = resolve(process.argv[2] ?? 'outputs/native-reasoning-probe');
const model = process.env.CAIRN_MODEL;
const baseURL = process.env.CAIRN_ENDPOINT;
const apiKey = process.env.CAIRN_API_KEY;
if (!model || !baseURL || !apiKey) throw new Error('CAIRN_MODEL / CAIRN_ENDPOINT / CAIRN_API_KEY are required');
const tools = [{ name: 'read_probe', description: 'Return the external probe value.', parameters: { type: 'object', properties: {}, additionalProperties: false } }];
let requestCount = 0;
const requests: { requestedModel: string; effort: unknown; thinking: unknown; assistantStates: number; toolMessages: number }[] = [];
const fetchImpl: typeof fetch = async (url, init) => {
  requestCount++;
  const body = JSON.parse(String(init?.body));
  requests.push({ requestedModel: body.model, effort: body.reasoning_effort ?? null, thinking: body.thinking ?? null,
    assistantStates: body.messages.filter((m: any) => typeof m.reasoning_content === 'string' && m.reasoning_content.length > 0).length,
    toolMessages: body.messages.filter((m: any) => m.role === 'tool').length });
  return fetch(url, init);
};
const rows: Record<string, unknown>[] = [];
async function run(label: string, messages: ProviderMessage[], effort?: string, withTools = false, explicitSwitch = false): Promise<AgentEvent[]> {
  const started = Date.now(); const events: AgentEvent[] = [];
  const extraBody: Record<string, unknown> = { max_tokens: 1024 };
  if (explicitSwitch) extraBody.thinking = { type: effort === 'off' ? 'disabled' : 'enabled' };
  let error: string | null = null;
  try {
    for await (const event of streamOpenAI(messages, { model, baseURL, apiKey, fetchImpl, extraBody,
      ...(effort !== undefined ? { reasoningEffort: effort } : {}) }, withTools ? tools : undefined,
      { signal: AbortSignal.timeout(60_000) })) events.push(event);
  } catch (failure) { error = String(failure).split(apiKey!).join('[redacted]').slice(0, 300); }
  const row = { label, seconds: (Date.now() - started) / 1000, error,
    reasoningChars: events.filter(e => e.type === 'thinking_delta').reduce((n,e) => n + e.text.length, 0),
    answer: events.filter(e => e.type === 'assistant_delta').map(e => e.text).join(''),
    toolCalls: events.filter(e => e.type === 'tool_call').map(e => ({ name: e.name })),
    usage: events.filter(e => e.type === 'usage'),
    truncated: events.some(e => e.type === 'turn_truncated') };
  rows.push(row); console.log(JSON.stringify(row));
  await save(); return events;
}
async function save(): Promise<void> {
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output,'probe.json'),JSON.stringify({ date: new Date().toISOString(), endpoint: chatCompletionsEndpoint(baseURL!), model,
    requestCount, requests, rows, effortEnforcement: 'unverified: successful parameter acceptance and one prompt are not causal budget evidence',
    scope: 'read-only bounded protocol requests, no production configuration changes' },null,2)+'\n');
}
for (const effort of [undefined,'low','high','off']) await run(effort ?? 'upstream-default',[{ role:'user',content:'只输出数字 7，不要解释。' }],effort,false,effort!==undefined);
const user = { type:'user_message' as const,content:'先调用 read_probe 工具获取数值，再只输出工具返回的数值。不得猜测数值。' };
const first = await run('tool-first',[{role:'user',content:user.content}],'low',true,true);
const calls = first.filter(e => e.type === 'tool_call');
if (calls.length > 0) {
  const history: AgentEvent[] = [user,...first,...calls.map(call => ({type:'tool_result' as const,callId:call.id,ok:true,output:'7'}))];
  const messages = projectContext(history);
  await run('tool-continuation-preserved',messages,'low',true,true);
  await run('tool-continuation-without-native-state',messages.map(({reasoning,...message})=>message),'low',true,true);
}
await save();
if (rows.some(row => row.error !== null || row.truncated === true)) process.exitCode = 1;
