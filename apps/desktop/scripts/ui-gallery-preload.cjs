// UI 画廊的假 AgentApi（contextBridge 注入；形状与 src/main/ipc-protocol.ts 的 AgentApi 对齐）。
// 只为离屏截图服务——真桥在 src/preload/index.ts，别把这文件接进产品链路。
const { contextBridge } = require("electron");

const reply = (v) => () => new Promise((res) => setTimeout(() => res(typeof v === "function" ? v() : v), 30));
// 第 9 点冒烟的断言面：渲染层调过 runSteer 的**原始参数**。走 contextBridge 暴露
// （preload 与 renderer 不共享 globalThis，直接挂 globalThis 在 renderer 侧读不到——第一版就错在这里）。
const cairnSteers = [];
/** 预览输入冒烟：记录 runCancel 的原始会话（判断停止钮真的打到了目标会话）。 */
const cairnCancels = [];
/** 删除运行中会话冒烟：deleteSession 尝试记录（busy = 模拟核心运行锁尚未释放）。 */
const cairnDeletes = [];
let deleteBusyUntil = 0;
/** 队列编辑冒烟：queueSet 落盘载荷记录（判「改过的正文真的写回队列 sidecar」）。 */
const cairnQueueSets = [];
/** 进化冻结冒烟：冻结开关调用记录 / 当前冻结态（evolveReport 回读要看到同一状态）。 */
const cairnEvolveFreezes = [];
let cairnEvolveFrozen = false;
/** 全局经验冻结（v48）：与 workspace STOP 分开的第二把锁。 */
let cairnGlobalFrozen = false;
/** 第 9 点冒烟：真 run 的调用记录（判「空闲回车起了一轮 / 运行中回车没起新一轮」）。 */
const cairnRuns = [];
/** 可见会话上报（v33）：完成通知判据的输入记录（smoke 断言「窗口在看谁」确实报对了）。 */
const cairnViewingCalls = [];
/** 对话框回车提交冒烟（v34 批）：项目新建/更新调用的原始入参。 */
const cairnProjectCalls = [];
let relocatedProject = null;
/** 会话级偏好冒烟（v35）：sessionPrefsSet 的原始参数。 */
const cairnSessionPrefsCalls = [];
/** 权限档循环冒烟（2026-10-30）：setSettings 的补丁记录——「哪条入口改了哪一档」只能从应答侧看。 */
const cairnSettingsCalls = [];
const cairnDecisions = [];
let cairnHoldRun = null;
let cairnSteerReject = false;
const holdFixture = process.argv.includes("--cairn-steer-fixture") || process.argv.includes("--cairn-cancel-fixture");

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
  // 一条**失败**的工具调用：失败正文那格要有东西可看（错误正文降到正文色、失败标记仍危险色）。
  // 文案是四行散文——那一格原先整段用危险色，在阅读面里喊。
  { type: "tool_call", id: "t3", name: "run_shell", args: { command: "pnpm test" }, ts: now - 82_000 },
  { type: "tool_result", callId: "t3", ok: false, output: "Permission denied: 写操作被拒\n被拒的动作：pnpm test（写 .git 之外的路径）\n这一档权限不许写工作区\n要继续请换只读命令，或调高权限档位", ts: now - 81_000 },
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
  telemetry: false, notifyOnComplete: true, planRequiredByDefault: false, autoMemory: true, subagentTools: true,
  impactAnalysis: false, autoVerify: true, actionFusion: true, promptCache: true,
  requestMetering: true, observationPack: true, evidenceReceipts: false, economicCompaction: true,
  routingBandit: false, routingCascade: false, maxBudgetUsd: 0, scheduleConcurrencyCap: 4,
  // 与真 DEFAULT_SETTINGS 对齐（缺了会让画廊把「缺省开」的开关画成关——证人陈旧）。
  ctrlTabCycle: true, autoVerify: true, autoVerifyRepair: false, planRequiredByDefault: false,
  // 字号档 / 尺寸档同理缺不得：真主进程装载时会把非法值兜回 md/2（settings.ts:282·284），
  // 夹具缺这两个键会让设置·通用页的两排分段控件**一档都不亮**（分段控件自查当场红）。
  textSize: "md", uiSize: "2",
};

/** 设置读写的活体状态（2026-10-30）：真主进程 setSettings 回**合并后**的设置。
 *  夹具此前回了静态种子 ⇒ 设置页保存后 `setS(next)` 把刚点中的档位弹回旧值
 *  （证人陈旧，不是产品回归）。读也走它，写入才看得见。 */
const settingsState = { ...SETTINGS };

/** 调度快照空态 / 坏档（2026-10-30）：坏档时真主进程会把装载警告带进快照，
 *  桌面页据此出横幅。`--cairn-schedule-corrupt-fixture` 用来复现那一屏。 */
const SCHEDULE_SNAPSHOT_EMPTY = { tasks: [], history: [], running: 0, queued: 0, cap: 4, startupDone: true, tzNotes: {}, warnings: [], definitionsCorrupt: false };
const SCHEDULE_SNAPSHOT_CORRUPT = {
  ...SCHEDULE_SNAPSHOT_EMPTY,
  warnings: ["调度任务文件损坏：/tmp/cairn-profile/automations.json（JSON 解析失败）——修好或删除该文件后重试，本次不覆盖"],
  definitionsCorrupt: true,
};
const scheduleSnapshotFixture = process.argv.includes("--cairn-schedule-corrupt-fixture")
  ? SCHEDULE_SNAPSHOT_CORRUPT
  : SCHEDULE_SNAPSHOT_EMPTY;

/** 进化分区夹具（2026-10-30）：此前缺 evolveReport 桩，画廊点「进化」会拿到兜底 {}，
 *  在渲染期炸成「这一块加载失败」——视觉自查永远看不到这一页。形状与 EvolveReport 对齐。 */
const EVOLVE_REPORT = {
  v: 1, ts: now, workspace: "/tmp/demo-ws", frozen: false,
  budget: {
    budget: { maxPlaybookEntries: 200, maxInjectedEntries: 6, maxInjectedChars: 2000, maxExperiments: 20, maxCandidates: 200 },
    source: "default", detail: null,
  },
  episodes: {
    v: 1, total: 12, duplicates: 0, badLines: 0,
    byOutcome: { success: 8, failure: 1, unknown: 3 },
    byClass: { fix: 7, feature: 5 },
    byVerify: { green: 6, red: 2, none: 4 },
    unknownReasons: { judge: 3, verify: 4, user: 9 },
    cost: { mainTokens: 12400, workerTokens: 2200, requests: 9, pricedRuns: 6, unpricedRuns: 3 },
    lastTs: now - 3_600_000,
  },
  playbook: {
    total: 5, byStatus: { active: 3, candidate: 2 }, byKind: { lesson: 4, pitfall: 1 },
    conflicts: 0, expired: 0, negative: 1, activatable: ["exp-a"], badLines: 0, refusals: 0,
  },
  experiments: [{ id: "exp-1", status: "passed", candidateRef: "cand-7", analysisStatus: "passed", decision: "promote", nControl: 3, nTreatment: 3 }],
  candidates: { total: 2, byStatus: { candidate: 1, promoted: 1 } },
  nudges: { episodes: 3, ids: 2, byId: { "exp-a": 2, "exp-b": 1 } },
  activationCandidates: [{
    id: "exp-a", kind: "lesson", body: "先复现再改：失败用例是最短证据链。",
    riskDiff: 0.35, trials: 12, evidence: 6,
  }],
  negativeCandidates: [{
    id: "exp-b", kind: "pitfall", body: "无证据跳步改动：回归修不完。",
    trials: 5, successes: 1,
  }],
  global: {
    frozen: false, total: 2, byStatus: { active: 1, dormant: 1 }, badLines: 0, refusals: 0,
    findings: [{ id: "exp-g1", reason: "negative", detail: "观测 0/5（成功率 0% ≤ 20%）——建议 dormant" }],
    entries: [
      {
        id: "exp-g1", status: "active", kind: "lesson",
        body: "跨项目通用：先读测试再改实现。", evidence: 4, workspaces: 3, trials: 5, successes: 0,
        evidenceTrials: 0, evidenceSuccesses: 0,
      },
      {
        id: "exp-g2", status: "dormant", kind: "pitfall",
        body: "全局休眠：失败样本先归档。", evidence: 3, workspaces: 2, trials: 1, successes: 0,
        evidenceTrials: 0, evidenceSuccesses: 0,
      },
    ],
  },
};

// 文件窗格夹具（2026-10-21）：只给离屏画廊用，让树的键盘/重试/预览有真实行可走。
const FAKE_TREE = {
  "": [{ name: "src", kind: "dir", size: null }, { name: "README.md", kind: "file", size: 2140 }, { name: "package.json", kind: "file", size: 880 }],
  src: [{ name: "main.ts", kind: "file", size: 5120 }, { name: "renderer", kind: "dir", size: null }],
  "src/renderer": [{ name: "App.tsx", kind: "file", size: 8800 }],
};
const FAKE_TEXT = {
  "README.md": "# Demo workspace\n\n用于文件窗格的键盘与预览验收。\n",
  "package.json": '{"name":"demo","private":true}\n',
  "src/main.ts": "export const desktop = true;\n",
  "src/renderer/App.tsx": "export function App() { return null; }\n",
};
// 插件窗格夹具（2026-10-21）：让右列插件页在画廊里也有真实列表/技能/命令可看。
const PLUGIN_SNAPSHOT = {
  plugins: [{
    name: "demo-plugin", scope: "workspace", trust: "trusted", root: "/tmp/demo-ws/.agent/plugins/demo-plugin",
    counts: { skills: 1, commands: 1, agents: 0, hooks: 0, mcp: 1, lsp: 0, lspActive: 0 },
    skills: [{ name: "审查改动", invoke: "demo-plugin:review", description: "按仓库规矩审一遍改动" }],
    commands: [{ name: "跑测试", invoke: "demo-plugin:test", description: "跑相关判卷并汇总失败" }],
    userConfig: [],
    errors: [], warnings: [],
  }],
  looseSkills: [],
  mcpServers: [{ plugin: "demo-plugin", server: "demo-mcp", state: "connected", tools: ["search"] }],
  toolScopes: [],
  errors: [], warnings: [],
};
const MEMORY_SNAPSHOT = {
  project: {
    path: "/tmp/demo-ws/.agent/memory",
    index: "- desktop-shell: Agent OS rail and destination pages",
    topics: [{
      topic: "desktop-shell",
      type: "project",
      modified: new Date(now - 3_600_000).toISOString(),
      bytes: 184,
      body: "插件、记忆与自动化是稳定目的地，不再藏在设置里。\n切换目的地时对话保持挂载。",
    }],
    pendingExternalRefs: [],
  },
  global: {
    path: "/tmp/cairn-memory",
    index: null,
    topics: [],
    pendingExternalRefs: [],
  },
};
const EMPTY_MEMORY_SNAPSHOT = {
  project: { path: "/tmp/demo-ws/.agent/memory", index: null, topics: [], pendingExternalRefs: [] },
  global: { path: "/tmp/cairn-memory", index: null, topics: [], pendingExternalRefs: [] },
};
const MANY_MEMORY_SNAPSHOT = {
  project: {
    ...MEMORY_SNAPSHOT.project,
    topics: Array.from({ length: 24 }, (_, index) => ({
      topic: `memory-${String(index + 1).padStart(2, "0")}`,
      type: "project",
      modified: new Date(now - (index + 1) * 3_600_000).toISOString(),
      bytes: 184 + index,
      body: `长期记忆条目 ${String(index + 1)}：保留目的地状态与页面级错误反馈。`,
    })),
  },
  global: MEMORY_SNAPSHOT.global,
};
const AGENT_OS_AUTOMATION_SNAPSHOT = {
  tasks: [{
    id: "task-fixture-1",
    name: "夜间巡检",
    prompt: "检查工作区状态并汇总风险。",
    schedule: { kind: "daily", time: "09:00" },
    timeZone: "Asia/Shanghai",
    permissionTier: "read-only",
    catchUp: "skip",
    enabled: true,
    createdAt: new Date(now - 86_400_000).toISOString(),
    updatedAt: new Date(now - 3_600_000).toISOString(),
    nextRunAt: new Date(now + 3_600_000).toISOString(),
  }],
  history: [],
  running: 0,
  queued: 0,
  cap: 4,
  startupDone: true,
  tzNotes: {},
  warnings: [],
  definitionsCorrupt: false,
};
// 联网搜索 / 用量页的合法桩（2026-10-25）：新设置分区一旦读到畸形形状就会在渲染期抛错，
// 画廊的兜底 `{}` 会让整页白成启动占位。这里给足字段让视觉自查能看到真页面；
// 要验错误边界时显式传 --cairn-crash-network-fixture（见下方覆盖）。
const SEARCH_SETTINGS = {
  workspace: "/tmp/demo-ws",
  enabled: true,
  provider: "tavily",
  endpoint: "https://api.tavily.com/search",
  allowLocalEndpoint: false,
  hasKey: true,
  keySource: "stored",
  secureStorageAvailable: true,
};
const USAGE_DAY = new Date(now).toISOString().slice(0, 10);
const USAGE_LEDGER = {
  ok: true,
  totals: { inputTokens: 12400, outputTokens: 1830, cacheReadTokens: 0, usageCount: 1, toolSteps: 3, rounds: 1 },
  sessions: 1,
  workspaces: 1,
  skipped: 0,
  badLines: 0,
  analytics: {
    buckets: [{
      day: USAGE_DAY, model: "deepseek-chat",
      inputTokens: 12400, outputTokens: 1830, cacheReadTokens: 0, usageCount: 1, workerUsageCount: 0,
      inputMeasured: 1, outputMeasured: 1, cacheReadMeasured: 0,
    }],
    activity: [{ day: USAGE_DAY, sessions: 1, rounds: 1, toolSteps: 3 }],
    sessionsWithUsage: 1,
    sessionsWithoutUsage: 0,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    generatedAt: now,
  },
};

/** 桌面「运行诊断」夹具（v34）：九项检查 + 一项失败（联网搜索未配），用来验结果上屏。 */
const DOCTOR_REPORT = {
  checks: [
    { id: "node", ok: true, fatal: true, detail: "Node v24.19.0（engines >=20.11.0 <25）" },
    { id: "keys", ok: false, fatal: false, detail: "四个 provider key 全部未设", hint: "export OPENAI_API_KEY=<key>；或 --provider demo 零凭据看流程" },
    { id: "tiers", ok: true, fatal: false, detail: "模型档位表 12 条（cheap 4 / standard 5 / strong 3）" },
    { id: "sandbox", ok: true, fatal: false, detail: "沙箱可用" },
    { id: "workspace", ok: true, fatal: false, detail: "工作区可写" },
    { id: "settings", ok: true, fatal: false, detail: "设置文件可读" },
    { id: "sessions", ok: true, fatal: false, detail: "会话元数据可读" },
    { id: "search", ok: false, fatal: false, detail: "search.endpoint 未配（web_search 不可用；这是可选项）" },
    { id: "trust", ok: true, fatal: false, detail: "插件信任面 2 条决议（trusted 2 / declined 0）" },
  ],
  verdict: "部分就绪",
  exitCode: 0,
};

// 画廊会话桩：createSession 后 listSessions 要能看见新会话（真接口返回 workspace；
// 只给 {id} 会让「首页直接发」的渲染路径拿到 undefined，根边界看起来像产品崩了）。
const DEMO_SESSION = { id: "s1", title: "接 routing 开关并跑全量验证", mtimeMs: now - 60000, lines: 12, workspace: "/tmp/demo-ws" };
const DEMO_SESSION_2 = { id: "s2", title: "整理竞品对照册", mtimeMs: now - 120000, lines: 8, workspace: "/tmp/demo-ws" };
let createdSession = null;

const stub = {
  protocolVersion: reply(1),
  searchSettingsGet: reply(process.argv.includes("--cairn-crash-network-fixture") ? {} : SEARCH_SETTINGS),
  searchSettingsSave: reply({ ok: true, settings: SEARCH_SETTINGS }),
  searchSettingsTest: reply({ ok: true, elapsedMs: 42, resultCount: 3 }),
  usageLedger: reply(USAGE_LEDGER),
  evolveReport: reply(() => ({
    ...EVOLVE_REPORT,
    frozen: cairnEvolveFrozen,
    global: { ...EVOLVE_REPORT.global, frozen: cairnGlobalFrozen },
  })),
  evolveSetFrozen: (frozen) => new Promise((res) => setTimeout(() => {
    cairnEvolveFrozen = frozen === true;
    cairnEvolveFreezes.push(cairnEvolveFrozen);
    res({ ...EVOLVE_REPORT, frozen: cairnEvolveFrozen });
  }, 30)),
  evolveActivate: (id) => Promise.resolve({ ok: true, report: { ...EVOLVE_REPORT, frozen: cairnEvolveFrozen } }),
  evolveDormant: (id) => Promise.resolve({ ok: true, report: { ...EVOLVE_REPORT, frozen: cairnEvolveFrozen } }),
  evolveGlobalRevoke: (id) => Promise.resolve({ ok: true, report: { ...EVOLVE_REPORT, frozen: cairnEvolveFrozen } }),
  evolveGlobalActivate: (id) => Promise.resolve({ ok: true, report: { ...EVOLVE_REPORT, frozen: cairnEvolveFrozen } }),
  evolveGlobalSetFrozen: (frozen) => {
    cairnGlobalFrozen = frozen === true;
    return Promise.resolve({
      ...EVOLVE_REPORT,
      frozen: cairnEvolveFrozen,
      global: { ...EVOLVE_REPORT.global, frozen: cairnGlobalFrozen },
    });
  },
  doctor: reply({ ok: true, report: DOCTOR_REPORT }),
  getSettings: reply(() => ({ ...settingsState })),
  setSettings: (patch) => {
    cairnSettingsCalls.push(patch);
    Object.assign(settingsState, patch);
    return new Promise((res) => setTimeout(() => res({ ...settingsState }), 30));
  },
  reloadSettings: reply({ ok: true }),
  reportViewing: (sessionId, workspace) => {
    cairnViewingCalls.push({ sessionId, workspace });
    return new Promise((res) => setTimeout(() => res({ ok: true }), 10));
  },
  getProviderInfo: reply(PROVIDER_INFO),
  providerKeyStatus: reply({ available: true, stored: ["deepseek", "glm"], envActive: true, envProviders: ["glm"] }),
  // 许可证导入夹具：验签在 core 判，画廊只验「导入后标签与回执即时更新」这条渲染路径。
  importLicense: reply({ ok: true, state: { state: "valid", licensee: "测试客户", expiresAt: null } }),
  // 诊断包导出夹具：真实写盘在 core 判，画廊只验「点击 → 回执带路径」。
  exportDiagnostics: reply({ ok: true, path: "/tmp/cairn-diagnostics.md" }),
  // 偏好备份夹具：导出回路径，导入回一项可验证的 patch（textSize=lg）。
  exportPreferences: reply({ ok: true, path: "/tmp/cairn-preferences.json" }),
  importPreferences: reply({ ok: true, patch: { textSize: "lg" }, ignored: [] }),
  // 恢复默认夹具：把 textSize 拨回默认 md（真实默认表在 core 判）。
  resetPreferences: () => new Promise((res) => setTimeout(() => { settingsState.textSize = "md"; res({ ...settingsState }); }, 30)),
  providerKeySet: reply({ ok: true }),
  providerKeyDelete: reply({ ok: true }),
  listSessions: reply(() => {
    const base = process.argv.includes("--cairn-session-preview-fixture") ? [DEMO_SESSION, DEMO_SESSION_2] : [DEMO_SESSION];
    if (process.argv.includes("--cairn-session-prefs-fixture")) {
      return base.map((s) => (s.id === "s1" ? { ...s, model: "deepseek-chat", thinking: "high" } : s));
    }
    return createdSession === null ? base : [...base, createdSession];
  }),
  listProjects: reply(() => {
    if (relocatedProject !== null) return [relocatedProject];
    if (process.argv.includes("--cairn-relocate-fixture")) {
      return [{ id: "p1", name: "demo-ws", path: "/tmp/demo-ws", defaultLocation: "/tmp/demo-ws", createdAt: now, updatedAt: now, missing: true }];
    }
    return [{ path: "/tmp/demo-ws" }];
  }),
  // 工作区上下文上报：真接口回 {ok}；缺桩时兜底 {} 会让 renderer 读 r.ok === false
  // 而弹「工作区不可用，已清空窗口上下文」——画廊每张开机都带一条假错误（2026-10-25 修）。
  setWorkspaceContext: reply({ ok: true }),
  addProject: (input) => { cairnProjectCalls.push({ kind: "addProject", input }); return Promise.resolve({ path: "/tmp/demo-ws", name: input?.name ?? "demo-ws" }); },
  relocateProject: (id, path) => {
    cairnProjectCalls.push({ kind: "relocateProject", id, path });
    relocatedProject = { id: id ?? "p1", name: "demo-ws", path, defaultLocation: path, createdAt: now, updatedAt: now, missing: false };
    return Promise.resolve(relocatedProject);
  },
  sessionPrefsSet: (sessionId, prefs) => {
    cairnSessionPrefsCalls.push({ sessionId, prefs });
    return Promise.resolve({ ok: true });
  },
  createProject: (input) => { cairnProjectCalls.push({ kind: "createProject", input }); return Promise.resolve({ ok: true, path: "/tmp/demo-ws/new" }); },
  projectTemplates: reply([
    { id: "blank", name: "空白项目", description: "只要一个 README 与 .agent 配置", runKind: "static" },
    { id: "node", name: "Node 命令行", description: "带入口脚本与测试脚手架", runKind: "node" },
  ]),
  workspaceListDir: (rel) => new Promise((res) => setTimeout(() => {
    const entries = FAKE_TREE[rel];
    res(entries === undefined
      ? { ok: false, error: `目录不存在：${rel}` }
      : { ok: true, path: rel, entries, truncated: rel === "src" });
  }, 30)),
  workspaceReadText: (rel) => new Promise((res) => setTimeout(() => {
    const text = FAKE_TEXT[rel];
    res(text === undefined
      ? { ok: false, error: `文件不存在：${rel}` }
      : { ok: true, path: rel, text, truncated: false, size: Buffer.byteLength(text) });
  }, 30)),
  // 命令面板正文搜索（v18）三态之一的最小合法桩：不搜真会话，但形状必须完整；
  // 空对象兜底会让 SessionSearchResults 在 .map 上抛错（真机冒烟抓到的）。
  sessionSearch: reply({ kind: "ok", matches: [], scannedSessions: 0, scannedBytes: 0, totalSessions: 1 }),
  // 命令面板文件快速打开（2026-10-25）：真实 workspaceSearch 通道的最小桩。
  workspaceSearch: (_workspace, query) => new Promise((res) => setTimeout(() => {
    const q = String(query).toLowerCase();
    const hits = q.includes("main")
      ? [{ path: "src/main.ts", kind: "file" }, { path: "src", kind: "directory" }]
      : q.includes("readme")
        ? [{ path: "README.md", kind: "file" }]
        : [];
    res({ ok: true, hits, truncated: false });
  }, 30)),
  pickDirectory: reply(process.argv.includes("--cairn-relocate-fixture") ? "/tmp/demo-ws-moved" : null),
  openSession: reply({ events: EVENTS }),
  createSession: reply({ id: "s2" }),
  // 第 9 点冒烟：`run` **可以挂住不返回**（`--cairn-steer-fixture` 时）。
  // 为什么必须挂住：活动会话的 running 置位只在 `send()` 那条路里、run 返回后立刻摘掉
  // （session-subscription.ts 的注释：「运行集口径」）。桩若 30ms 就返回，运行态根本立不住，
  // 于是"运行中按回车"永远测不到——第一版冒烟就死在这里，而它看起来像产品缺陷。
  run: (req) => new Promise((res) => {
    // 记录每次真 run（插话冒烟判「这一拍到底有没有起新一轮」；Plan 冒烟读 planRequired）。
    cairnRuns.push({ message: req && req.message, sessionId: req && req.sessionId, planRequired: req && req.planRequired });
    if (holdFixture) {
      cairnHoldRun = res; // 冒烟可手动放行
      return;
    }
    setTimeout(() => res({ ok: true }), 30);
  }),
  // 取消必须让挂住的 run promise 真正收束；否则 gallery 里的队列永远等不到下一轮。
  runCancel: (sessionId) => new Promise((res) => setTimeout(() => {
    cairnCancels.push({ sessionId });
    // 真实核心「取消到锁释放」是异步的：让紧随其后的首次 deleteSession 撞一次运行锁。
    if (process.argv.includes("--cairn-delete-running-fixture")) deleteBusyUntil = Date.now() + 300;
    const held = cairnHoldRun;
    cairnHoldRun = null;
    if (held !== null) held({ ok: true, aborted: true });
    res({ ok: true });
  }, 30)),
  // 真核心对在跑会话有硬闸（sessions.ts「会话正在运行，先停止再删除」）；这里按同一句报错，
  // 让冒烟能验渲染层的「先停再删」重试真的越过锁，而不是把一次锁错误报成删除失败。
  deleteSession: (id) => new Promise((res, rej) => setTimeout(() => {
    const busy = Date.now() < deleteBusyUntil;
    cairnDeletes.push({ id: String(id), busy });
    if (busy) { rej(new Error("会话正在运行，先停止再删除: " + id)); return; }
    if (createdSession !== null && createdSession.id === id) createdSession = null;
    res({ currentSession: null });
  }, 30)),
  decide: (askId, approved, scope) => new Promise((res) => setTimeout(() => {
    cairnDecisions.push({ askId, approved, scope });
    res(true);
  }, 30)),
  decidePlan: reply(true),
  submitClarify: reply(true),
  listFeedback: reply([]),
  submitFeedback: reply({ ok: true }),
  revertTurn: reply({ ok: true, restored: [], deleted: [], manual: [], failed: [] }),
  compact: reply({ ok: true }),
  checkUpdate: reply({ configured: false }),
  exportMemory: reply({ ok: true, path: "/tmp/cairn-memory.md" }),
  getState: reply({ plugins: PLUGIN_SNAPSHOT, about: { version: "0.2.0", build: { version: "0.2.0", platform: "darwin", arch: "arm64", sourceLockSha256: "fixture", packagedSmoke: "passed", signature: "ad-hoc", createdAt: "2026-10-30T07:47:07.229Z" } } }),
  listSkills: reply({
    skills: [{ invoke: "demo-plugin:review", description: "按仓库规矩审一遍改动", trust: "trusted" }],
    commands: [{ invoke: "demo-plugin:test", description: "跑相关判卷并汇总失败", trust: "trusted" }],
  }),
  getOnboarding: reply([]),
  setGoal: reply({ ok: true }),
  pluginDecide: reply({ ok: true }),
  scheduleUpsert: reply({ ok: true }),
  scheduleRunNow: reply({ ok: true }),
  scheduleSnapshot: reply(scheduleSnapshotFixture),
  deleteMemory: reply({ ok: true }),
  // 发送队列 sidecar：返回数组字段，否则渲染层 .map 会炸（此前落在兜底 {} ⇒ 首屏挂错误条）。
  queueGet: reply({ items: [] }),
  queueSet: (sessionId, entries, workspace) => new Promise((res) => setTimeout(() => {
    cairnQueueSets.push({ sessionId, entries: entries.map((e) => ({ ...e })), workspace });
    res({ ok: true });
  }, 30)),
  // 第 9 点·轮中插话：**必须有真实现**，否则落到下方兜底 `reply({})` ⇒ 渲染层读
  // `steered.ok === true` 得 undefined ⇒ 运行中回车永远走「入队」，插话那条路在离屏界面里
  // 一次都走不到（实测形态：gallery 里按回车只会看到队列条，看不到「已插话到本轮」）。
  // 这里把每次调用记进 window.__cairnSteers，供 smoke 断言"渲染层真的调了它、且带了什么话"。
  runSteer: (sessionId, text) => new Promise((res) => setTimeout(() => {
    // 记录写在 **contextBridge 暴露的那个**对象上：preload 与 renderer 是两个上下文，
    // `globalThis` 不共享（第一版就写错在这里：调用成功而 __cairnSteers 恒 null）。
    cairnSteers.push({ sessionId, text });
    if (cairnSteerReject) {
      res({ ok: false, error: "会话不在运行（插话无人接收）" });
      return;
    }
    res({ ok: true, queued: 1 });
  }, 30)),
  // 能力读数（设置页「模型与 Provider」分区读它）：search/vision 是必填字段，
  // 兜底的 {} 会让渲染层读 cap.search.kind 时抛 "reading 'kind'"。
  capabilities: reply({
    search: { kind: "unset" },
    searchEndpoint: undefined,
    vision: { state: "undeclared", modelId: null, declaredModalities: [] },
    workspace: "/tmp/demo-ws",
  }),
};
// 新建会话桩：真接口回 {id, workspace}，且随后的 listSessions 能看到它。
stub.createSession = (workspace) => {
  const ws = typeof workspace === "string" && workspace !== "" ? workspace : "/tmp/demo-ws";
  createdSession = { id: "s2", title: "新任务", mtimeMs: Date.now(), lines: 0, workspace: ws };
  const session = { id: "s2", workspace: ws };
  return process.argv.includes("--cairn-motion-fixture") ? new Promise((done) => setTimeout(() => done(session), 500)) : Promise.resolve(session);
};

// 事件订阅**真收集**：概览里的数字刚变过会闪一下（那是「刚刚变」的提示），
// 要目验那格就得**能推事件进去**。主进程经 executeJavaScript 调 __cairnPushEvent。
const eventListeners = new Set();
stub.onEvent = (fn) => { eventListeners.add(fn); return () => eventListeners.delete(fn); };
const askListeners = new Set();
const askDoneListeners = new Set();
stub.onAsk = (fn) => { askListeners.add(fn); return () => askListeners.delete(fn); };
stub.onAskDone = (fn) => { askDoneListeners.add(fn); return () => askDoneListeners.delete(fn); };
contextBridge.exposeInMainWorld("__cairnPushAsk", (payload) => {
  for (const fn of askListeners) { try { fn(payload); } catch { /* 一个订阅者抛了不该挡住别人 */ } }
});
contextBridge.exposeInMainWorld("__cairnPushAskDone", (payload) => {
  for (const fn of askDoneListeners) { try { fn(payload); } catch { /* 一个订阅者抛了不该挡住别人 */ } }
});
contextBridge.exposeInMainWorld("__cairnDecisions", () => cairnDecisions.map((d) => ({ ...d })));
// v21 完成通知点击：桩只做事件收集；真实 main 的 Notification click 在离屏环境不可造。
const notificationListeners = new Set();
stub.onNotificationOpen = (fn) => { notificationListeners.add(fn); return () => notificationListeners.delete(fn); };
contextBridge.exposeInMainWorld("__cairnPushNotification", (payload) => {
  for (const fn of notificationListeners) { try { fn(payload); } catch { /* 一个订阅者抛了不该挡住别人 */ } }
});
contextBridge.exposeInMainWorld("__cairnSteers", () => cairnSteers.slice());
contextBridge.exposeInMainWorld("__cairnCancels", () => cairnCancels.slice());
contextBridge.exposeInMainWorld("__cairnDeletes", () => cairnDeletes.map((d) => ({ ...d })));
contextBridge.exposeInMainWorld("__cairnQueueSets", () => cairnQueueSets.map((c) => ({ sessionId: c.sessionId, entries: c.entries.map((e) => ({ ...e })), workspace: c.workspace })));
contextBridge.exposeInMainWorld("__cairnEvolveFreezes", () => cairnEvolveFreezes.slice());
contextBridge.exposeInMainWorld("__cairnRuns", () => cairnRuns.slice());
contextBridge.exposeInMainWorld("__cairnSettingsCalls", () => cairnSettingsCalls.map((patch) => ({ ...patch })));
contextBridge.exposeInMainWorld("__cairnViewing", () => cairnViewingCalls.map((call) => ({ ...call })));
contextBridge.exposeInMainWorld("__cairnProjectCalls", () => cairnProjectCalls.map((call) => ({ ...call })));
contextBridge.exposeInMainWorld("__cairnSessionPrefs", () => cairnSessionPrefsCalls.map((call) => ({ ...call })));
contextBridge.exposeInMainWorld("__cairnReleaseRun", (v) => { if (cairnHoldRun) { const r = cairnHoldRun; cairnHoldRun = null; r(v ?? { ok: true }); } });
// 镜像场景需要主进程答「这一轮刚好收束」；contextBridge 暴露的对象是冻结的，
// 在 renderer 里直接改 window.agent.runSteer 不会生效（第一版冒烟就卡在这里）。
contextBridge.exposeInMainWorld("__cairnSetSteerReject", (v) => { cairnSteerReject = v === true; });
contextBridge.exposeInMainWorld("__cairnPushEvent", (event) => {
  for (const fn of eventListeners) { try { fn(event); } catch { /* 一个订阅者抛了不该挡住别人 */ } }
});

// 插件市场冒烟：只在显式参数下覆盖 IPC 返回值。渲染层仍通过真实 window.agent 方法名走完
// live/cache/corrupt、三来源、审查、更新与操作路径；这里替代的是本地 Electron 主进程后端，
// 真实签名、Git 网络与安装事务由 core/desktop 测试分别覆盖。
if (process.argv.includes("--cairn-plugin-marketplace-fixture")) {
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const fixtureReply = (value) => new Promise((resolveValue) => {
    setTimeout(() => resolveValue(clone(value)), 24);
  });
  const capabilities = (overrides = {}) => ({
    skills: 1, commands: 0, agents: 0, hooks: 0, mcp: 0, lsp: 0, ...overrides,
  });
  const runtimeCounts = (overrides = {}) => ({
    skills: 1, commands: 0, agents: 0, hooks: 0, mcp: 0, lsp: 0, lspActive: 0, ...overrides,
  });
  const runtimePlugin = (name, counts, warnings = []) => ({
    name,
    scope: "project",
    trust: "trusted",
    root: `/tmp/cairn-plugin-fixtures/${name}`,
    counts: runtimeCounts(counts),
    skills: [],
    commands: [],
    userConfig: [],
    errors: [],
    warnings,
  });
  const catalogEntry = (id, version, overrides = {}) => ({
    id,
    name: id === "featured-plugin" ? "Featured Plugin" : id,
    summary: id === "featured-plugin"
      ? "把项目工具接入模型上下文"
      : id === "catalog-installed"
        ? "团队目录中已安装的插件"
        : "可复用的项目能力",
    author: "Cairn fixtures",
    sourceUrl: `https://plugins.example.com/${id}`,
    license: "MIT",
    version,
    publishedAt: "2026-10-29T00:00:00.000Z",
    packageUrl: `https://plugins.example.com/${id}-${version}.tgz`,
    sha256: "a".repeat(64),
    sizeBytes: 4096,
    capabilities: capabilities({ mcp: id === "featured-plugin" ? 2 : 0 }),
    permissions: ["filesystem:read"],
    minAppVersion: "0.1.0",
    ...overrides,
  });
  const catalogEntries = [
    catalogEntry("featured-plugin", "1.0.0"),
    catalogEntry("catalog-installed", "1.1.0"),
  ];
  const liveCatalog = () => ({
    status: "ready",
    origin: "live",
    catalog: {
      schemaVersion: 1,
      revision: "2026-10-29.1",
      generatedAt: "2026-10-29T00:00:00.000Z",
      expiresAt: "2026-11-05T00:00:00.000Z",
      packageHosts: ["plugins.example.com"],
      entries: clone(catalogEntries),
      shelves: [
        { id: "featured", title: "精选", entryIds: ["featured-plugin"] },
        { id: "recent", title: "最近上架", entryIds: ["catalog-installed"] },
      ],
    },
    fetchedAt: "2026-10-29T00:00:00.000Z",
    expiresAt: "2026-11-05T00:00:00.000Z",
    stale: false,
  });
  let catalogMode = "live";
  let jobSequence = 0;
  let currentJob = null;
  const calls = [];
  const installed = [
    {
      entryId: "catalog-installed",
      manifestName: "catalog-installed",
      version: "1.0.0",
      sha256: "1".repeat(64),
      fingerprint: "1".repeat(32),
      source: {
        kind: "catalog",
        catalogId: "cairn",
        entryId: "catalog-installed",
        sourceUrl: "https://plugins.example.com/catalog-installed",
        revision: "2026-10-29.1",
      },
      scope: "user",
      workspace: null,
      enabled: true,
      installedAt: "2026-10-28T00:00:00.000Z",
      updatedAt: "2026-10-29T00:00:00.000Z",
    },
    {
      entryId: "git-installed",
      manifestName: "git-installed",
      version: null,
      sha256: "2".repeat(64),
      fingerprint: "2".repeat(32),
      source: {
        kind: "git",
        repositoryUrl: "https://github.com/example/git-installed",
        ref: "main",
        commit: "2".repeat(40),
      },
      scope: "project",
      workspace: "/tmp/demo-ws",
      enabled: true,
      installedAt: "2026-10-28T01:00:00.000Z",
      updatedAt: "2026-10-29T01:00:00.000Z",
    },
    {
      entryId: "local-installed",
      manifestName: "local-installed",
      version: null,
      sha256: "3".repeat(64),
      fingerprint: "3".repeat(32),
      source: { kind: "local", sourcePath: "/tmp/cairn-plugin-fixtures/local-installed" },
      scope: "project",
      workspace: "/tmp/demo-ws",
      enabled: false,
      installedAt: "2026-10-28T02:00:00.000Z",
      updatedAt: "2026-10-29T02:00:00.000Z",
    },
  ];
  const runtimeSnapshot = () => ({
    plugins: [
      runtimePlugin("catalog-installed", { skills: 2, mcp: 1 }),
      runtimePlugin("git-installed", { agents: 1, hooks: 2 }, ["hooks 会在下一轮运行"]),
      runtimePlugin("local-installed", { commands: 1 }),
    ],
    looseSkills: [],
    mcpServers: [{
      plugin: "catalog-installed",
      server: "fixture",
      state: "connected",
      tools: ["mcp__plugin_catalog-installed_fixture__search"],
    }],
    activeMcpServers: ["catalog-installed/fixture"],
    activeMcpTools: [],
    mcpServerSummaries: [{
      key: "catalog-installed/fixture",
      plugin: "catalog-installed",
      server: "fixture",
      toolCount: 1,
      active: true,
      activeMode: "server",
      activeToolCount: 1,
    }],
    toolScopes: [],
    errors: [],
    warnings: [],
  });
  const reviewFor = (kind, manifestName = "git-import") => {
    jobSequence += 1;
    const isGit = kind === "git";
    const isLocal = kind === "local";
    const source = isGit
      ? {
          kind: "git",
          repositoryUrl: "https://github.com/example/git-import",
          ref: "main",
          commit: "4".repeat(40),
        }
      : isLocal
        ? { kind: "local", sourcePath: "/tmp/cairn-plugin-fixtures/local-import" }
        : {
            kind: "catalog",
            catalogId: "cairn",
            entryId: manifestName,
            sourceUrl: `https://plugins.example.com/${manifestName}`,
            revision: "2026-10-29.1",
          };
    return {
      id: `fixture-job-${jobSequence}`,
      state: "review",
      entryId: manifestName,
      sourceKind: kind,
      scope: "project",
      workspace: "/tmp/demo-ws",
      review: {
        jobId: `fixture-job-${jobSequence}`,
        entryId: manifestName,
        manifestName,
        version: isGit || isLocal ? null : "1.0.0",
        source,
        scope: "project",
        workspace: "/tmp/demo-ws",
        targetRoot: `/tmp/demo-ws/.agent/plugins/${manifestName}`,
        fingerprint: "5".repeat(32),
        packageSha256: "6".repeat(64),
        capabilities: capabilities({ hooks: 2, mcp: 1 }),
        permissions: isGit || isLocal ? null : ["filesystem:read"],
        userConfigFields: [{
          key: "workspaceToken",
          type: "string",
          title: "Workspace token",
          required: false,
          sensitive: true,
          hasValue: false,
          missing: false,
        }],
        warnings: ["hooks 会在下一轮运行"],
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  };
  const catalogReadout = () => {
    if (catalogMode === "cache") {
      const value = liveCatalog();
      return { ...value, origin: "cache", stale: true, fetchedAt: "2026-10-27T00:00:00.000Z" };
    }
    if (catalogMode === "corrupt") {
      return {
        status: "unavailable",
        origin: "none",
        catalog: null,
        fetchedAt: null,
        expiresAt: null,
        stale: false,
        note: "缓存损坏：签名校验失败",
      };
    }
    if (catalogMode === "empty") {
      const value = liveCatalog();
      return { ...value, catalog: { ...value.catalog, entries: [], shelves: [] } };
    }
    return liveCatalog();
  };
  const findInstalled = (entryId, scope, workspace) => installed.find((item) => (
    item.entryId === entryId
    && item.scope === scope
    && (scope === "user" || item.workspace === workspace)
  ));

  stub.marketplaceCatalog = () => fixtureReply(catalogReadout());
  stub.pluginsInstalled = () => fixtureReply(installed);
  stub.getState = () => fixtureReply({ plugins: runtimeSnapshot() });
  stub.marketplacePluginInstall = (entryId, scope, workspace) => {
    calls.push({ method: "marketplacePluginInstall", entryId, scope, workspace });
    currentJob = reviewFor("catalog", entryId);
    currentJob.scope = scope;
    currentJob.workspace = scope === "user" ? null : workspace;
    currentJob.review.scope = scope;
    currentJob.review.workspace = scope === "user" ? null : workspace;
    return fixtureReply(currentJob);
  };
  stub.marketplacePluginImport = (request, scope, workspace) => {
    calls.push({ method: "marketplacePluginImport", request, scope, workspace });
    const kind = request.kind === "catalog" ? "catalog" : request.kind;
    currentJob = reviewFor(kind, kind === "git" ? "git-import" : "local-import");
    currentJob.scope = scope;
    currentJob.workspace = scope === "user" ? null : workspace;
    currentJob.review.scope = scope;
    currentJob.review.workspace = scope === "user" ? null : workspace;
    return fixtureReply(currentJob);
  };
  stub.marketplacePluginUpdate = (entryId, scope, workspace) => {
    calls.push({ method: "marketplacePluginUpdate", entryId, scope, workspace });
    const record = findInstalled(entryId, scope, workspace);
    currentJob = reviewFor(record?.source.kind ?? "git", record?.manifestName ?? entryId);
    currentJob.scope = scope;
    currentJob.workspace = scope === "user" ? null : workspace;
    return fixtureReply(currentJob);
  };
  stub.marketplacePluginInstallStatus = (jobId) => {
    calls.push({ method: "marketplacePluginInstallStatus", jobId });
    return fixtureReply(currentJob !== null && currentJob.id === jobId ? currentJob : null);
  };
  stub.marketplacePluginInstallCommit = (jobId) => {
    calls.push({ method: "marketplacePluginInstallCommit", jobId });
    if (currentJob !== null && currentJob.id === jobId) {
      currentJob = { ...currentJob, state: "succeeded", updatedAt: new Date().toISOString() };
    }
    return fixtureReply({ ok: true });
  };
  stub.marketplacePluginInstallCancel = (jobId) => {
    calls.push({ method: "marketplacePluginInstallCancel", jobId });
    if (currentJob !== null && currentJob.id === jobId) {
      currentJob = { ...currentJob, state: "cancelled", updatedAt: new Date().toISOString() };
    }
    return fixtureReply({ ok: true });
  };
  stub.marketplacePluginCheckUpdate = (entryId, scope, workspace) => {
    calls.push({ method: "marketplacePluginCheckUpdate", entryId, scope, workspace });
    const record = findInstalled(entryId, scope, workspace);
    if (record === undefined) {
      return fixtureReply({
        status: "unavailable", currentVersion: null, nextVersion: null, sourceKind: "catalog",
      });
    }
    if (record.source.kind === "catalog") {
      return fixtureReply({
        status: "available",
        currentVersion: record.version,
        nextVersion: "1.1.0",
        sourceKind: "catalog",
      });
    }
    if (record.source.kind === "git") {
      return fixtureReply({
        status: "available", currentVersion: null, nextVersion: null, sourceKind: "git",
      });
    }
    return fixtureReply({
      status: "current", currentVersion: null, nextVersion: null, sourceKind: "local",
    });
  };
  stub.pluginSetEnabled = (entryId, scope, enabled, workspace) => {
    calls.push({ method: "pluginSetEnabled", entryId, scope, enabled, workspace });
    const record = findInstalled(entryId, scope, workspace);
    if (record !== undefined) {
      record.enabled = enabled === true;
      record.updatedAt = new Date().toISOString();
    }
    return fixtureReply({ ok: record !== undefined, ...(record === undefined ? { error: "missing plugin" } : {}) });
  };
  stub.pluginUninstall = (entryId, scope, workspace) => {
    calls.push({ method: "pluginUninstall", entryId, scope, workspace });
    const index = installed.findIndex((item) => (
      item.entryId === entryId
      && item.scope === scope
      && (scope === "user" || item.workspace === workspace)
    ));
    if (index >= 0) installed.splice(index, 1);
    return fixtureReply({ ok: index >= 0, ...(index < 0 ? { error: "missing plugin" } : {}) });
  };
  stub.pluginConfigureInstalled = (request) => {
    calls.push({ method: "pluginConfigureInstalled", request });
    return fixtureReply({ ok: true });
  };
  stub.pluginPickLocalSource = () => fixtureReply("/tmp/cairn-plugin-fixtures/local-import");
  contextBridge.exposeInMainWorld("__cairnPluginMarketplaceFixture", {
    setCatalogMode: (mode) => { catalogMode = String(mode); },
    getCatalogMode: () => catalogMode,
    getCalls: () => clone(calls),
    installedCount: () => installed.length,
  });
}

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
// 主题：新窗口（弹窗）按 settings.theme 上主题，不吃主窗口的 DOM 注入 ⇒ 桩里也得是同一档。
const galleryTheme = argOf("--cairn-theme=", "");
if (galleryTheme === "light" || galleryTheme === "dark") settingsState.theme = galleryTheme;

// 旧首启配置夹具：onboarded=false 也应直接进入工作界面，不再显示设置清单。
// 七组覆盖面由主进程从**真源**推导后交接（这里不复刻那份清单——手抄会随它漂）。
// 更新提醒夹具：配好更新源 + 一个「有可用版本」的 checkUpdate 回包。
if (process.argv.includes("--cairn-update-fixture")) {
  settingsState.updateManifestUrl = "https://example.com/cairn-updates.json";
  stub.checkUpdate = reply({ state: "available", currentVersion: "0.1.0", version: "0.2.0", url: "https://example.com/download", notes: "test" });
}

if (process.argv.includes("--cairn-first-run-fixture")) {
  stub.getOnboarding = reply(JSON.parse(argOf("--cairn-onboarding-groups=", "[]")));
  stub.getSettings = reply({ ...settingsState, onboarded: false });
}

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
  // v19（指针分叉）：协议形状已从 `number[]` 收成 `{eventId, eventRef?}[]`。夹具晚改一步，
  // state-smoke 会在「置顶按钮的 aria-label」那一格静默读到 false——不是产品回归，是证人陈旧。
  stub.listMessagePins = async (sid) => [...(pins.get(sid) ?? new Set())].map((eventId) => ({ eventId }));
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
  let liveText = "";
  const calls = { runs: [], forks: [] };
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
  stub.forkSession = (sessionId, round, keepWorkspace) => {
    calls.forks.push({ sessionId, round, keepWorkspace });
    return Promise.resolve({ ok: false, error: "夹具已记录回放请求" });
  };
  stub.run = (request) => new Promise((resolve) => {
    calls.runs.push(request);
    liveText = "PERF-LIVE-0";
    finishRun = resolve;
    emit({ type: "user_message", content: "逐帧流式性能检查" });
    emit({ type: "assistant_delta", callId: "perf-live", text: "PERF-LIVE-0" });
  });
  contextBridge.exposeInMainWorld("__cairnPerf", {
    calls: () => calls,
    step: (index) => {
      const text = ` PERF-LIVE-${index}`;
      liveText += text;
      emit({ type: "assistant_delta", callId: "perf-live", text });
    },
    complete: () => emit({ type: "assistant_message", callId: "perf-live", content: liveText }),
    finish: () => { emit({ type: "agent_status", status: "done" }); finishRun?.({ ok: true }); },
  });
}

// 大 diff 渲染夹具：主进程面已经产出 20 个 hunk / 4000 行，renderer 只负责真实挂 DOM。
// 这不是伪造复杂度——4000 行正是 core 侧 MAX_PATCH_LINES 的帽，用来量"帽内最坏形状"。
if (process.argv.includes("--cairn-large-diff-fixture")) {
  const hunks = [];
  for (let h = 0; h < 20; h++) {
    const lines = [];
    for (let j = 0; j < 200; j++) {
      const no = h * 200 + j + 1;
      lines.push({
        kind: j % 4 === 0 ? "add" : j % 7 === 0 ? "del" : "ctx",
        text: `fixture line ${String(no).padStart(5, "0")} · 检查大差异渲染的稳定行宽`,
        oldNo: j % 4 === 0 ? null : no,
        newNo: j % 7 === 0 ? null : no,
      });
    }
    hunks.push({ header: `@@ -${String(h * 200 + 1)},200 +${String(h * 200 + 1)},200 @@`, lines });
  }
  stub.changeDiff = reply({
    ok: true,
    path: "src/agent/agent-runner.ts",
    created: false,
    hunks,
    truncated: true,
    bytes: { before: 524288, after: 524288 },
  });
}

// 终端尺寸夹具（terminal-resize-smoke.cjs 专用；不进产品链路）：
// 记录渲染层发给主进程的 terminalResize 行列，用来证明「面板尺寸变化 ⇒ 行列跟着变」这条
// 渲染段链路真的在跑（主进程→PTY 那一段由 tests/terminal-size.test.ts 用 stty 量）。
if (process.argv.includes("--cairn-terminal-fixture")) {
  const calls = { resize: [], start: 0, write: [] };
  stub.terminalStart = reply(() => { calls.start += 1; return { ok: true, id: "term-fixture-1" }; });
  stub.terminalWrite = (id, data) => { calls.write.push({ id, data }); return Promise.resolve(true); };
  stub.terminalKill = reply(true);
  stub.terminalResize = (id, cols, rows) => { calls.resize.push({ id, cols, rows }); return Promise.resolve(true); };
  stub.onTerminalData = () => () => undefined;
  stub.onTerminalExit = () => () => undefined;
  contextBridge.exposeInMainWorld("__cairnTerminal", { calls: () => ({ ...calls, resize: [...calls.resize] }) });
}

// 跨工作区恢复夹具（cross-workspace-restore.cjs 专用；不进产品链路）：
// 侧栏清单含另一项目的会话，openSession/setWorkspaceContext 记录调用，证明启动恢复走的是它。
if (process.argv.includes("--cairn-cross-workspace-fixture")) {
  const calls = { open: [], workspace: [] };
  stub.listSessions = reply([
    { id: "s-current", title: "当前项目会话", mtimeMs: now - 60_000, lines: 2, workspace: "/tmp/demo-ws" },
    { id: "s-other", title: "跨工作区 · 另一项目", mtimeMs: now, lines: 2, workspace: "/tmp/demo-ws-other" },
  ]);
  stub.listProjects = reply([{ path: "/tmp/demo-ws" }, { path: "/tmp/demo-ws-other" }]);
  stub.openSession = async (id, workspace) => {
    calls.open.push({ id, workspace });
    return {
      events: id === "s-other"
        ? [
            { type: "user_message", content: "看看另一个项目", ts: now - 2000 },
            { type: "assistant_message", content: "跨工作区会话内容已恢复", ts: now - 1000 },
          ]
        : [{ type: "assistant_message", content: "当前项目内容", ts: now - 1000 }],
    };
  };
  stub.setWorkspaceContext = async (workspace) => { calls.workspace.push(workspace); return {}; };
  contextBridge.exposeInMainWorld("__cairnCrossWorkspace", { calls: () => ({ ...calls }) });
}

// 同名会话 × 两工作区夹具（same-id-two-workspace.cjs 专用；不进产品链路）：
// **两个工作区里各有一个 id 完全相同的会话**（`dup`）——这正是限定键
// （`runKey(workspace, sid)` = JSON 元组）存在的全部理由：会话 id 是分钟级时间戳，
// 跨项目可撞名；只用裸 id 做键 ⇒ A 项目的队列/运行态会写进 B 项目。
// 夹具还给两侧各排一条**不同**的队列消息，用 queueGet/queueSet 按 workspace 区分。
if (process.argv.includes("--cairn-same-id-workspace-fixture")) {
  const WS_A = "/tmp/demo-ws";
  const WS_B = "/tmp/demo-ws-other";
  const calls = { queueSet: [], open: [] };
  stub.listProjects = reply([{ path: WS_A }, { path: WS_B }]);
  stub.listSessions = reply([
    { id: "dup", title: "同名会话 · 项目甲", mtimeMs: now, lines: 2, workspace: WS_A },
    { id: "dup", title: "同名会话 · 项目乙", mtimeMs: now - 1000, lines: 2, workspace: WS_B },
  ]);
  stub.openSession = async (id, workspace) => {
    calls.open.push({ id, workspace });
    return {
      events: [
        { type: "user_message", content: workspace === WS_B ? "乙项目的消息" : "甲项目的消息", ts: now - 2000 },
        { type: "assistant_message", content: workspace === WS_B ? "乙项目转录" : "甲项目转录", ts: now - 1000 },
      ],
    };
  };
  // 队列按 (workspace, sid) 分别存放：两侧同名会话各有各的一条排队消息。
  const queues = new Map([
    [`${WS_A}|dup`, [{ text: "甲项目排队的那条", attachments: [] }]],
    [`${WS_B}|dup`, [{ text: "乙项目排队的那条", attachments: [] }]],
  ]);
  stub.queueGet = async (sessionId, workspace) => ({
    items: queues.get(`${workspace ?? ""}|${sessionId}`) ?? [],
  });
  stub.queueSet = async (sessionId, items, workspace) => {
    calls.queueSet.push({ sessionId, workspace, items });
    queues.set(`${workspace ?? ""}|${sessionId}`, items);
    return { ok: true };
  };
  if (process.argv.includes("--cairn-steer-switch-fixture")) {
    const originalOpen = stub.openSession;
    stub.openSession = async (id, workspace) => ({ ...(await originalOpen(id, workspace)), running: workspace === WS_A });
    const steers = [];
    const cancels = [];
    stub.runSteer = (id, text, workspace) => new Promise((resolve) => { steers.push({ id, text, workspace, resolve }); });
    if (process.argv.includes("--cairn-control-rejection-fixture")) {
      stub.runCancel = async (id, workspace) => {
        cancels.push({ id, workspace });
        return { ok: false, code: "workspace_mismatch", error: "目标工作区不匹配，请重新打开会话" };
      };
    }
    contextBridge.exposeInMainWorld("__cairnSteerSwitch", {
      count: () => steers.length,
      finish: (index) => steers[index].resolve({ ok: false, error: "本轮已收束" }),
      queues: () => Object.fromEntries(queues),
      runs: () => cairnRuns.length,
      calls: () => ({ steers: steers.map(({ id, text, workspace }) => ({ id, text, workspace })), cancels }),
    });
  }
  contextBridge.exposeInMainWorld("__cairnSameId", { calls: () => ({ ...calls }) });
  if (process.argv.includes("--cairn-queue-persistence-fixture")) {
    const writes = [], runs = [], reads = [];
    let holdReads = false;
    const originalGet = stub.queueGet, originalOpen = stub.openSession;
    stub.queueGet = (sessionId, workspace) => {
      if (!holdReads) return originalGet(sessionId, workspace);
      const items = queues.get(`${workspace ?? ""}|${sessionId}`) ?? [];
      return new Promise((resolve) => { reads.push({ items, resolve }); });
    };
    stub.openSession = async (id, workspace) => ({ ...(await originalOpen(id, workspace)), running: runs.some((r) => r.request.sessionId === id && r.request.workspace === workspace && !r.finished) });
    stub.queueSet = (sessionId, items, workspace) => new Promise((resolve) => {
      writes.push({ sessionId, items, workspace, resolve });
    });
    stub.run = (request) => new Promise((resolve) => { runs.push({ request, resolve, finished: false }); });
    stub.runSteer = async () => ({ ok: false, error: "本轮不接收插话" });
    contextBridge.exposeInMainWorld("__cairnQueuePersistence", {
      calls: () => ({ writes: writes.map(({ sessionId, items, workspace }) => ({ sessionId, items, workspace })), runs: runs.map(({ request }) => request), reads: reads.length }),
      write: (index, ok) => {
        const pending = writes[index];
        if (ok) queues.set(`${pending.workspace ?? ""}|${pending.sessionId}`, pending.items);
        pending.resolve(ok ? { ok: true } : { ok: false, error: "磁盘暂时不可写" });
      },
      run: (index, result) => { runs[index].finished = true; runs[index].resolve(result); },
      holdReads: (value) => { holdReads = value; },
      read: (index) => reads[index].resolve({ items: reads[index].items }),
    });
  }
}

// 工作台工具验收专用：让超长标题走正常 rename 回程，不用缺省 {} 冒充合法结果。
if (process.argv.includes("--cairn-workbench-fixture")) {
  stub.renameSession = async (id, title) => {
    if (id !== DEMO_SESSION.id) throw new Error("未知夹具会话");
    DEMO_SESSION.title = title;
    return { id };
  };
}

// Agent OS shell smoke: synthetic populated/empty/read-error snapshots remain isolated to this window.
if (process.argv.includes("--cairn-agent-os-fixture")) {
  let mode = "data";
  stub.getState = () => new Promise((resolveState, rejectState) => {
    setTimeout(() => {
      if (mode === "error") {
        rejectState(new Error("夹具：快照读取失败"));
        return;
      }
      resolveState({
        plugins: PLUGIN_SNAPSHOT,
        memory: mode === "empty" ? EMPTY_MEMORY_SNAPSHOT : MANY_MEMORY_SNAPSHOT,
        worktree: { workspace: "/tmp/demo-ws", orphans: [], details: [] },
      });
    }, 30);
  });
  stub.scheduleSnapshot = () => new Promise((resolveSnapshot) => {
    setTimeout(() => resolveSnapshot(mode === "operation-error"
      ? AGENT_OS_AUTOMATION_SNAPSHOT
      : (process.argv.includes("--cairn-schedule-corrupt-fixture") ? SCHEDULE_SNAPSHOT_CORRUPT : SCHEDULE_SNAPSHOT_EMPTY)), 30);
  });
  stub.scheduleRunNow = () => new Promise((_resolve, reject) => {
    setTimeout(() => reject(new Error("夹具：触发失败")), 30);
  });
  contextBridge.exposeInMainWorld("__cairnAgentOs", {
    setMode: (next) => {
      if (next !== "data" && next !== "empty" && next !== "error" && next !== "operation-error") {
        throw new Error(`未知快照模式：${next}`);
      }
      mode = next;
    },
    mode: () => mode,
  });
}

// 编排控制面夹具（orchestration-controls-smoke.cjs 专用；不进产品链路）：
// 阶段转移照着 engine.control() 的守卫走；每条 control 原样落到 JSONL，
// 让冒烟能判「第一次点只摆确认、第二次才真发命令」（渲染层自证不了这件事）。
if (process.argv.includes("--cairn-orchestration-fixture")) {
  const commands = [];
  const WORKSPACE = "/tmp/demo-ws";
  const capabilities = { tools: ["read_file"], fs_read: ["."], fs_write: [], network: [], shell: "none", git: "none", external_effects: "none" };
  const plan = {
    plan_id: "plan-fixture", version: 1, goal: "核对编排控制面", non_goals: [], domain: "generic", created_by: "user",
    policy_ref: "desktop-read-only-v1", budget: { usd: 1 }, max_concurrency: 1,
    agents: [{ agent_spec_id: "reader", role: "只读分析", max_turns: 8, capability: capabilities }],
    tasks: ["核对接口", "核对证据", "核对交付", "核对回滚"].map((goal, i) => ({
      task_id: `t${i}`, goal, non_goals: [], agent_spec: "reader", lane: "read", depends_on: [], write_scopes: [], inputs: [],
      contract: { effect: "none", acceptance: [{ kind: "evidence", id: "answer", fields: ["answer"] }] },
      budget: { usd: 0.33 }, max_attempts: 2, priority: 0,
    })),
  };
  const tasks = {
    t0: { task: plan.tasks[0], phase: "running", run_id: "run-0", attempt: 1, evidence: "absent", spent_usd: 0.1, reserved_usd: 0.2 },
    t1: { task: plan.tasks[1], phase: "failed", attempt: 1, evidence: "failed", verdict: "fail", spent_usd: 0.1, reserved_usd: 0 },
    t2: { task: plan.tasks[2], phase: "done", run_id: "run-2", attempt: 1, evidence: "verified", verdict: "pass", revision: "rev-2", spent_usd: 0.1, reserved_usd: 0 },
    t3: { task: plan.tasks[3], phase: "needs_you", attempt: 0, evidence: "absent", reason: "taken over by user", spent_usd: 0, reserved_usd: 0 },
  };
  const state = { phase: "proposed" };
  const snapshot = () => ({
    address: { workspace: WORKSPACE, sessionId: DEMO_SESSION.id }, mode: "shadow", backend: "fixture-local",
    backend_capabilities: { rollback: true },
    next_actions: [
      { kind: "dispatch", plan_id: plan.plan_id, version: 1, task_id: "t0", reason: "dependency failed, was cancelled or requires user action" },
      { kind: "escalate", plan_id: plan.plan_id, version: 1, task_id: "t1", reason: "upstream provider returned 529" },
    ],
    view: { last_event_id: 1, now: Date.now(), anomalies: [], plans: {
      [plan.plan_id]: { plan, phase: state.phase, tasks, spent_usd: 0.3, reserved_usd: 0.2, source_event_id: 1 },
    } },
  });
  stub.orchestrationView = async () => ({ ok: true, snapshot: snapshot() });
  stub.orchestrationSubmit = async () => ({ ok: true, snapshot: snapshot() });
  stub.orchestrationControl = async (request) => {
    commands.push(JSON.parse(JSON.stringify(request)));
    const { action, task_id: taskId } = request.command;
    const task = taskId === undefined ? undefined : tasks[taskId];
    if (action === "approve_plan") state.phase = "approved";
    else if (action === "reject_plan") state.phase = "rejected";
    else if (action === "pause_plan") state.phase = "paused";
    else if (action === "resume_plan") state.phase = "approved";
    else if (action === "cancel_plan") state.phase = "cancelled";
    else if (task !== undefined) {
      if (action === "pause_task") { task.phase = "paused"; task.reason = "paused by user"; delete task.run_id; }
      else if (action === "resume_task") { task.phase = "queued"; delete task.reason; }
      else if (action === "cancel_task") task.phase = "cancelled";
      else if (action === "takeover_task") { task.phase = "needs_you"; task.reason = "taken over by user"; delete task.run_id; }
      else if (action === "retry_task") { task.phase = "queued"; task.attempt += 1; }
      else if (action === "rollback_task") task.reason = "rolled back by user";
    }
    return { ok: true, snapshot: snapshot() };
  };
  // 沙箱 preload 不能 require node:fs；命令账本走 contextBridge 交给冒烟读。
  contextBridge.exposeInMainWorld("__cairnOrchestration", { commands: () => commands });
}
// 会话清单读取失败夹具（sidebar-load-error-smoke.cjs 专用）：用真实的损坏元数据原句，
// 证侧栏把「盘上哪个文件坏了、下一步做什么」原样上屏，而不是只有一句「没有加载成功」。
if (process.argv.includes("--cairn-list-error-fixture")) {
  const message = "会话元数据损坏，已拒绝覆盖: /tmp/demo-ws/.agent/sessions/session-metadata.json (JSON.parse 失败)——修好或删除该文件后重试";
  stub.listSessions = () => Promise.reject(new Error(message));
  contextBridge.exposeInMainWorld("__cairnListError", { message });
}

// 项目注册表读取失败夹具（sidebar-load-error-smoke.cjs 的 --with-project-error 臂）：
// 与生产同形的一句（损坏路径 + 出路），证侧栏 notice 原样上屏。
if (process.argv.includes("--cairn-project-error-fixture")) {
  stub.listProjects = () => Promise.reject(new Error("项目注册表损坏，已拒绝覆盖: /tmp/demo-ws/.agent/sessions/projects.json (JSON.parse 失败)——修好或删除该文件后重试"));
}

// 「修好后重试」夹具（projects-notice-retry-smoke.cjs）：坏档一直失败，直到探针把文件「修好」
// （翻 healthy 旗），用来验 notice 的「重试」真的重读、并在成功后清掉提示。
if (process.argv.includes("--cairn-project-error-repairable")) {
  let projectsHealthy = false;
  stub.listProjects = () => projectsHealthy
    ? reply([{ path: "/tmp/demo-ws" }])()
    : Promise.reject(new Error("项目注册表损坏，已拒绝覆盖: /tmp/demo-ws/.agent/sessions/projects.json (JSON.parse 失败)——修好或删除该文件后重试"));
  contextBridge.exposeInMainWorld("__cairnRepairProjects", () => { projectsHealthy = true; });
}

// 可控回包顺序：会话读取/重试冒烟专用，不连接真实存储或 Provider。
if (process.argv.includes("--cairn-list-recovery-fixture")) {
  const requests = [];
  stub.listSessions = () => new Promise((resolve, reject) => requests.push({ resolve, reject }));
  contextBridge.exposeInMainWorld("__cairnSessionList", {
    count: () => requests.length,
    refresh: () => { for (const listener of eventListeners) listener({ type: "session_titled" }); },
    succeed: (index, id) => requests[index].resolve(id === null ? [] : [{
      id, title: id, workspace: "/tmp/demo-ws", mtimeMs: Date.now(), lines: 1,
    }]),
    fail: (index) => requests[index].reject(new Error("EACCES: permission denied, scandir '/tmp/" + "很长的项目路径/".repeat(18) + "sessions'")),
  });
}

if (process.argv.includes("--cairn-open-recovery-fixture")) {
  const opens = [], queues = [], writes = [];
  const sessions = ["s1", "s2"].map((id) => ({ id, title: id, workspace: "/tmp/demo-ws", mtimeMs: Date.now(), lines: 1 }));
  stub.listSessions = reply(sessions);
  stub.openSession = (id, workspace) => new Promise((resolve, reject) => opens.push({ id, workspace, resolve, reject }));
  stub.queueGet = (id, workspace) => new Promise((resolve, reject) => queues.push({ id, workspace, resolve, reject }));
  stub.queueSet = async (id, items, workspace) => { writes.push({ id, items, workspace }); return { ok: true }; };
  contextBridge.exposeInMainWorld("__cairnOpenRecovery", {
    counts: () => ({ opens: opens.length, queues: queues.length, writes: writes.length, runs: cairnRuns.length }),
    resolveOpen: (index) => opens[index].resolve({ events: [{ type: "user_message", content: opens[index].id + " 正文", ts: Date.now() }], running: false }),
    resolveQueue: (index) => queues[index].resolve({ items: [{ text: queues[index].id + " 持久队列", attachments: [] }] }),
    rejectOpen: (index) => opens[index].reject(new Error("EIO: 无法读取会话正文 /tmp/demo-ws/.agent/sessions/" + opens[index].id + ".jsonl")),
    rejectQueue: (index) => queues[index].reject(new Error("发送队列损坏：/tmp/" + "很长的项目目录/".repeat(16) + "queue.json")),
  });
}

contextBridge.exposeInMainWorld("agent", stub);
