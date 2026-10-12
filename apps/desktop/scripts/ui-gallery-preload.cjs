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

contextBridge.exposeInMainWorld("agent", {
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
  onEvent: () => () => undefined,
  onAsk: () => () => undefined,
  onAskDone: () => () => undefined,
});
