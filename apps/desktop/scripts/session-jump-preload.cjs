// 「新建会话首发跳回旧会话」复现专用假 AgentApi（只服务排查，不进产品链路）。
// 与 ui-gallery-preload.cjs 的分工：这里刻意把「会话清单刷新」做成可控延迟，
// 并把渲染层真调过的每个通道记进账本，供 smoke 从 DOM 侧读回。
const { contextBridge } = require("electron");

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

/** 真清单（renderer 侧只看得到）——复用 ui-gallery 那句注释的教训：
 *  只给 {id} 会让「首页直接发」拿到 undefined 工作区。 */
let sessions = [
  { id: "old-a", title: "上一个对话 A", workspace: "/tmp/demo-ws", mtimeMs: Date.now() - 600000, lines: 42 },
  { id: "old-b", title: "更早的对话 B", workspace: "/tmp/demo-ws", mtimeMs: Date.now() - 900000, lines: 12 },
];
const created = [];
const runs = [];
const scheme = { listDelayMs: 30, createDelayMs: 30, runDelayMs: 30, createId: "new-1" };

const stub = {
  protocolVersion: () => Promise.resolve(Number(argOf("--cairn-protocol-version=", "1"))),
  listSessions: async () => {
    await delay(scheme.listDelayMs);
    return sessions.map((s) => ({ ...s }));
  },
  createSession: async (workspace) => {
    await delay(scheme.createDelayMs);
    const id = scheme.createId;
    if (!created.some((c) => c.id === id)) {
      created.push({ id, workspace: workspace || "/tmp/demo-ws" });
      sessions = [
        { id, title: "新任务", workspace: "/tmp/demo-ws", mtimeMs: Date.now(), lines: 0 },
        ...sessions,
      ];
    }
    return { id, workspace: "/tmp/demo-ws" };
  },
  openSession: async (id) => { await delay(20); return { events: [], running: false }; },
  queueGet: async () => ({ items: [] }),
  queueSet: async () => ({ ok: true }),
  run: async (req) => {
    runs.push({ sessionId: req && req.sessionId, message: req && req.message, at: Date.now() });
    await delay(scheme.runDelayMs);
    return { ok: true };
  },
  runSteer: async () => ({ ok: true }),
  runCancel: async () => ({ ok: true }),
  setGoal: async () => ({ ok: true }),
  sessionPrefsSet: async () => ({ ok: true }),
  reportViewing: async () => ({ ok: true }),
  setWorkspaceContext: async () => ({ ok: true }),
  onEvent: () => () => undefined,
  onAsk: () => () => undefined,
  onAskDone: () => () => undefined,
  onNotificationOpen: () => () => undefined,
  onMenu: () => () => undefined,
  onTerminalData: () => () => undefined,
  onTerminalExit: () => () => undefined,
  onBrowserState: () => () => undefined,
  onPreviewState: () => () => undefined,
};

const schemeRef = {
  set: (patch) => { Object.assign(scheme, patch); },
  get: () => ({ ...scheme, sessions: sessions.map((s) => ({ ...s })) }),
  runs: () => runs.map((r) => ({ ...r })),
  created: () => created.map((c) => ({ ...c })),
};

// 兜底：协议里出现的其它成员一律给一个「同形回包」，避免首屏因为缺桩整块不挂。
// （与 gallery 的兜底同策略：返回 {} 已多次把渲染层读属性炸掉，所以按名字给形状。）
const reply = (value) => () => Promise.resolve(typeof value === "function" ? value() : value);
const fallback = {
  getState: reply({ plugins: { trusted: [], declined: [] }, about: { version: "0.0.0-fixture" } }),
  getSettings: reply({ mode: "guided", theme: "system", provider: "deepseek", model: "deepseek-chat", textSize: "md", uiSize: "2", ctrlTabCycle: true, notifyOnComplete: false, autoMemory: false, planRequiredByDefault: false }),
  setSettings: reply({ ok: true }),
  getProviderInfo: reply({ kind: "openai", provider: "Fixture", model: "fixture-model", modelId: "fixture-model", models: [], keyConfigured: true, providers: [] }),
  providerKeyStatus: reply({ available: true, stored: [], envActive: false, envProviders: [] }),
  listProjects: reply([{ id: "p1", path: "/tmp/demo-ws", name: "demo-ws" }]),
  listSkills: reply({ skills: [], commands: [] }),
  listFeedback: reply([]),
  listSchedule: reply({ tasks: [] }),
  getOnboarding: reply([]),
  scheduleSnapshot: reply({ tasks: [] }),
  usageLedger: reply({ rows: [], totals: { usd: 0 } }),
  capabilities: reply({ search: { kind: "unset" }, vision: { state: "undeclared", modelId: null, declaredModalities: [] }, workspace: "/tmp/demo-ws" }),
  searchSettingsGet: reply({}),
  evolveReport: reply({ frozen: false, candidates: [], activationCandidates: [] }),
  lspStatus: reply({ enabled: false, trust: "trusted", configError: "", servers: [] }),
  checkUpdate: reply({ configured: false }),
};

// contextBridge 不能传 Proxy（「An object could not be cloned」）——只能给一个**素对象**。
// 成员表由主进程经 additionalArguments 递进来（preload 跑在沙箱里，require("node:fs") 不可用），
// 缺桩的一律给 {ok:true} 同形回包，避免首屏读属性时炸。
const argOf = (prefix, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit === undefined ? fallback : hit.slice(prefix.length);
};
const members = JSON.parse(argOf("--cairn-sj-members=", "[]"));

const api = {};
for (const { name } of members) {
  if (name in stub) { api[name] = stub[name]; continue; }
  if (name in fallback) { api[name] = fallback[name]; continue; }
  api[name] = () => Promise.resolve({ ok: true });
}
// 推送型订阅（不走 Promise 形状）
for (const name of ["onEvent", "onAsk", "onAskDone", "onNotificationOpen", "onMenu", "onTerminalData", "onTerminalExit", "onBrowserState", "onPreviewState"]) {
  if (!(name in api)) api[name] = () => () => undefined;
}
if (!("protocolVersion" in api)) api.protocolVersion = () => Promise.resolve(Number(argOf("--cairn-protocol-version=", "1")));

contextBridge.exposeInMainWorld("agent", api);
contextBridge.exposeInMainWorld("__cairnScheme", {
  set: (patch) => schemeRef.set(patch),
  get: () => schemeRef.get(),
  runs: () => schemeRef.runs(),
  created: () => schemeRef.created(),
});
