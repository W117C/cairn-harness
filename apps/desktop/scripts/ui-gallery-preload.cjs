// UI 画廊的假 AgentApi（contextBridge 注入；形状与 src/main/ipc-protocol.ts 的 AgentApi 对齐）。
// 只为离屏截图服务——真桥在 src/preload/index.ts，别把这文件接进产品链路。
const { contextBridge } = require("electron");

const reply = (v) => () => new Promise((res) => setTimeout(() => res(typeof v === "function" ? v() : v), 30));

const now = Date.now();
const mkMarkdown = [
  "## 改动说明",
  "",
  "把 `runOverrides` 的两个开关接进了运行面，结论：",
  "",
  "- **routingBandit** 按收益自动选档，缺省关",
  "- **routingCascade** 档位降级重试，缺省关",
  "- 运行面用 `??` 取值，不写 settings 存储",
  "",
  "```ts",
  "export function resolveFlag(overrides, key) {",
  "  return overrides[key] ?? DEFAULT_FLAGS[key];",
  "}",
  "```",
  "",
  "| 开关 | 缺省 | 说明 |",
  "| --- | --- | --- |",
  "| routingBandit | off | 按收益选档 |",
  "| routingCascade | off | 降级重试 |",
  "",
  "详见 [设计文档](https://example.com/design)。",
].join("\n");

const EVENTS = [
  { type: "user_message", content: "理一下 routingBandit / routingCascade 的接线方式，直接改代码", ts: now - 90_000 },
  { type: "thinking_delta", callId: "c1", text: "先查 RunOverrides 现有形态，再决定是落盘还是运行面取值……", ts: now - 88_000 },
  { type: "tool_call", id: "t1", name: "read_file", args: { path: "src/main/settings.ts" }, ts: now - 87_000 },
  { type: "tool_result", callId: "t1", ok: true, ts: now - 86_500 },
  { type: "tool_call", id: "t2", name: "edit_file", args: { path: "src/agent/agent-runner.ts" }, ts: now - 86_000 },
  { type: "tool_result", callId: "t2", ok: true, change: "modified", snapshotId: "snap-4081", ts: now - 85_000 },
  { type: "usage", inputTokens: 12400, outputTokens: 1830, ts: now - 84_000 },
  { type: "assistant_message", content: mkMarkdown, ts: now - 83_000 },
];

const MODEL = (id, provider, name, tier, ctx, image, thinking) => ({
  id, provider, model: name, tier, ctxWindow: ctx,
  capability: {
    modelId: id, provider, availability: "available",
    thinking: { supported: thinking, values: thinking ? ["off", "low", "medium", "high"] : ["off"], default: "off" },
    attachments: { text: true, image },
  },
});

const PROVIDER_INFO = {
  kind: "openai",
  provider: "DeepSeek",
  model: "deepseek-chat",
  modelId: "deepseek-chat",
  models: [
    MODEL("deepseek-chat", "deepseek", "deepseek-chat", "standard", 128000, false, true),
    MODEL("deepseek-reasoner", "deepseek", "deepseek-reasoner", "strong", 128000, false, true),
    MODEL("glm-5.3-flash", "glm", "glm-5.3-flash", "cheap", 1000000, true, false),
  ],
  keyConfigured: true,
  providers: [
    { id: "deepseek", label: "DeepSeek", custom: false },
    { id: "glm", label: "GLM（OpenAI 兼容）", custom: false },
  ],
};

const SETTINGS = {
  mode: "guided", theme: "system", provider: "deepseek", model: "deepseek-chat",
  telemetry: false, planRequiredByDefault: false, autoMemory: true, subagentTools: true,
  impactAnalysis: false, autoVerify: true, actionFusion: true, promptCache: true,
  requestMetering: true, observationPack: true, evidenceReceipts: false, economicCompaction: true,
  routingBandit: false, routingCascade: false, maxBudgetUsd: 0, scheduleConcurrencyCap: 4,
};

const stub = {
  protocolVersion: reply(1),
  getSettings: reply(SETTINGS),
  setSettings: reply(SETTINGS),
  getProviderInfo: reply(PROVIDER_INFO),
  providerKeyStatus: reply({ available: true, stored: ["deepseek", "glm"], envActive: true, envProviders: ["glm"] }),
  providerKeySet: reply({ ok: true }),
  providerKeyDelete: reply({ ok: true }),
  listSessions: reply([{ id: "s1", title: "接 routing 开关并跑全量验证", mtimeMs: now - 60000, lines: 12, workspace: "/tmp/demo-ws" }]),
  listProjects: reply([{ path: "/tmp/demo-ws" }]),
  addProject: reply({ path: "/tmp/demo-ws" }),
  createProject: reply({ ok: true, path: "/tmp/demo-ws/new" }),
  pickDirectory: reply(null),
  openSession: reply({ events: EVENTS }),
  createSession: reply({ id: "s2" }),
  run: reply({ ok: true }),
  runCancel: reply({ ok: true }),
  decide: reply(true),
  decidePlan: reply(true),
  submitClarify: reply(true),
  listFeedback: reply([]),
  submitFeedback: reply({ ok: true }),
  revertTurn: reply({ ok: true, restored: [], deleted: [], manual: [], failed: [] }),
  compact: reply({ ok: true }),
  checkUpdate: reply({ configured: false }),
  getState: reply({}),
  getOnboarding: reply([]),
  setGoal: reply({ ok: true }),
  pluginDecide: reply({ ok: true }),
  scheduleUpsert: reply({ ok: true }),
  scheduleRunNow: reply({ ok: true }),
  scheduleSnapshot: reply({ tasks: [], running: 0, queued: 0, cap: 4, history: [], startupDone: true }),
  deleteMemory: reply({ ok: true }),
  // 发送队列 sidecar：返回数组字段，否则渲染层 .map 会炸（此前落在兜底 {} ⇒ 首屏挂错误条）。
  queueGet: reply({ items: [] }),
  queueSet: reply({ ok: true }),
  // 能力读数（设置页「模型与 Provider」分区读它）：search/vision 是必填字段，
  // 兜底的 {} 会让渲染层读 cap.search.kind 时抛 "reading 'kind'"。
  capabilities: reply({
    search: { kind: "unset" },
    searchEndpoint: undefined,
    vision: { state: "undeclared", modelId: null, declaredModalities: [] },
    workspace: "/tmp/demo-ws",
  }),
  onEvent: () => () => undefined,
  onAsk: () => () => undefined,
  onAskDone: () => () => undefined,
};

// 桩的兜底名单由主进程从**真接口**（src/main/ipc-protocol.ts 的 AgentApi）推导后经
// additionalArguments 交接（preload 是 sandboxed 独立进程：拿不到主进程对象，也 require
// 不到 node:fs）。名单覆盖 ⇒ 渲染层不会因为「某个方法没桩」在 mount 时抛 TypeError ⇒
// react 根节点空 ⇒ 截图全白。
// 手抄名单会随接口演进而漏，所以这里不复刻名单，只消费真接口推导出来的名单。
const argOf = (prefix, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
};
const members = JSON.parse(argOf("--cairn-api-members=", "[]"));
for (const { name, isArray } of members) {
  if (name in stub) continue;
  // 推送订阅（on*）返回退订函数；其余按真接口的返回类型给兜底值：
  // 数组型给 []（渲染层会 .map 它，给 {} 会抛 "v.map is not a function"），其余给 {}。
  stub[name] = name.startsWith("on") ? () => () => undefined : reply(isArray ? [] : {});
}
// 协议版本必须与渲染层期望一致，否则渲染层亮「协议版本失配」fatal 面——画廊要的是产品面。
stub.protocolVersion = reply(Number(argOf("--cairn-protocol-version=", "0")));

// 可选交互夹具：只在独立 smoke 窗口显式传参时启用，不进入产品桥。
if (process.argv.includes("--cairn-interaction-fixture")) {
  const listeners = new Set();
  const history = [
    { type: "user_message", content: "检查桌面交互，保留完整工具记录", ts: now - 5000 },
    { type: "tool_call", id: "read", name: "read_file", args: { path: "src/main/settings.ts" }, ts: now - 4000 },
    { type: "tool_result", callId: "read", ok: true, output: "export const desktop = true;", ts: now - 3500 },
    { type: "tool_call", id: "test", name: "run_shell", args: { command: "pnpm test" }, ts: now - 3000 },
    { type: "tool_result", callId: "test", ok: false, output: "Assertion failed\nExpected 2, received 1", ts: now - 2500 },
    { type: "tool_call", id: "fetch", name: "web_fetch", args: { url: "https://example.com/docs" }, ts: now - 2000 },
  ];
  stub.openSession = reply(() => ({ events: history }));
  stub.onEvent = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
  stub.run = async () => {
    const events = [
      { type: "tool_result", callId: "fetch", ok: true, output: "Documentation loaded.", ts: Date.now() },
      { type: "tool_call", id: "next", name: "list_dir", args: { path: "apps/desktop" }, ts: Date.now() },
      { type: "tool_result", callId: "next", ok: true, output: "src\ntests\nscripts", ts: Date.now() },
      { type: "assistant_message", content: "检查完成。工具记录可随时展开查看。", ts: Date.now() },
    ];
    for (const e of events) {
      history.push(e);
      for (const listener of listeners) listener({ ...e, session_id: "s1" });
    }
    return { ok: true };
  };
}

// 跨会话/异步失败夹具，供 state-smoke 显式开启；不进入产品 preload。
if (process.argv.includes("--cairn-hardening-fixture")) {
  const ratings = new Map([["s1", new Map([[2, "up"]])], ["s2", new Map([[2, "down"]])]]);
  const pins = new Map([["s1", new Set([2])], ["s2", new Set([3])]]);
  const requests = { feedback: [], pin: [] };
  stub.listSessions = reply([
    { id: "s1", title: "会话甲 · 异步交互", mtimeMs: now, lines: 4, workspace: "/tmp/demo-ws" },
    { id: "s2", title: "会话乙 · 保留独立标记", mtimeMs: now - 1000, lines: 4, workspace: "/tmp/demo-ws" },
  ]);
  stub.openSession = async (id) => ({ events: [
    { type: "user_message", content: id === "s1" ? "检查交互可靠性" : "另一条独立会话", ts: now - 5000 },
    { type: "assistant_message", content: "第一条回复：会话标记必须独立。", ts: now - 4000 },
    { type: "assistant_message", content: "第二条回复：失败只回滚当前条目。", ts: now - 3000 },
  ] });
  stub.listFeedback = async (sid) => [...(ratings.get(sid) ?? new Map())].map(([eventId, rating]) => ({ sessionId: sid, eventId, rating, at: new Date().toISOString() }));
  stub.listMessagePins = async (sid) => [...(pins.get(sid) ?? new Set())];
  stub.submitFeedback = (req) => new Promise((resolve) => { requests.feedback.push({ req, resolve }); });
  stub.setMessagePinned = (req) => new Promise((resolve) => { requests.pin.push({ req, resolve }); });
  contextBridge.exposeInMainWorld("__cairnFixture", {
    count: (kind) => requests[kind].length,
    settle: (kind, index, ok) => {
      const item = requests[kind][index];
      if (!item || item.settled) throw new Error("夹具请求不存在或已完成");
      item.settled = true;
      const { req } = item;
      if (ok && kind === "feedback") {
        const values = ratings.get(req.sessionId);
        if (req.rating === "none") values.delete(req.eventId); else values.set(req.eventId, req.rating);
      }
      if (ok && kind === "pin") {
        const values = pins.get(req.sessionId);
        if (req.pinned) values.add(req.eventId); else values.delete(req.eventId);
      }
      item.resolve(ok ? { ok: true } : { ok: false, error: "测试用延迟失败" });
    },
  });
}

// 性能夹具：真实 renderer 接收独立的逐帧增量，禁止一次性灌满后冒充流式性能。
if (process.argv.includes("--cairn-performance-fixture")) {
  const turns = Number(argOf("--cairn-performance-turns=", "400"));
  const listeners = new Set();
  let finishRun;
  const events = [];
  for (let i = 0; i < turns; i++) {
    events.push({ type: "user_message", content: `第 ${i+1} 轮：检查模块 ${i}`, ts: now - (turns-i)*60000 });
    events.push({ type: "tool_call", id: `history-${i}`, name: "read_file", args: { path: `src/module-${i}.ts` }, ts: now - (turns-i)*60000+100 });
    events.push({ type: "tool_result", callId: `history-${i}`, ok: true, output: "export const value = true;", ts: now - (turns-i)*60000+200 });
    events.push({ type: "assistant_message", content: `## 模块 ${i} 的检查结果\n\n已检查 **接口与状态**，返回内容按事件留存。\n\n- 输入校验完整\n- 保留原有行为\n- 验证失败可恢复\n\n\`\`\`ts\nexport const value = ${i};\n\`\`\``, ts: now - (turns-i)*60000+300 });
  }
  stub.listSessions = reply([{ id: "s1", title: `${turns} 轮长会话性能夹具`, mtimeMs: now, lines: events.length, workspace: "/tmp/demo-ws" }]);
  stub.openSession = reply({ events });
  stub.onEvent = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
  const emit = (e) => { for (const listener of listeners) listener({ ...e, session_id: "s1", ts: Date.now() }); };
  stub.run = () => new Promise((resolve) => {
    finishRun = resolve;
    emit({ type: "user_message", content: "逐帧流式性能检查" });
    emit({ type: "assistant_delta", callId: "perf-live", text: "PERF-LIVE-0" });
  });
  contextBridge.exposeInMainWorld("__cairnPerf", {
    step: (index) => emit({ type: "assistant_delta", callId: "perf-live", text: ` PERF-LIVE-${index}` }),
    finish: () => { emit({ type: "agent_status", status: "done" }); finishRun?.({ ok: true }); },
  });
}

contextBridge.exposeInMainWorld("agent", stub);
