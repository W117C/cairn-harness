// UI 画廊（视觉自查专用，非产品组件）：离屏渲染 + capturePage 截六板块关键面。
// 为什么不用系统截屏：screencapture 走 TCC 录屏权限（会弹系统弹窗，不该由代理点）；
// Electron 自己的 capturePage 不需要任何权限。为什么造假 AgentApi：不跑真模型（不花钱、
// 不依赖 key），事件流用与判卷夹具同形的合成事件，专挑能看出版式的内容（markdown/代码/表格）。
// 用法：node scripts/ui-gallery.cjs  → 产物落 /tmp/cairn-gallery/*.png 后自退。
const { app, BrowserWindow } = require("electron");
const { mkdtempSync, mkdirSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const OUT = "/tmp/cairn-gallery";
mkdirSync(OUT, { recursive: true });

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
  "验证面如下：",
  "",
  "```ts",
  "export function resolveFlag(overrides: RunOverrides, key: FlagKey): boolean {",
  "  return overrides[key] ?? DEFAULT_FLAGS[key];",
  "}",
  "```",
  "",
  "| 开关 | 缺省 | 说明 |",
  "| --- | --- | --- |",
  "| routingBandit | off | 按收益选档 |",
  "| routingCascade | off | 降级重试 |",
  "",
  "详见 [设计文档](https://example.com/design)，其中 §3 讲了为什么 *不落盘*。",
].join("\n");

const EVENTS = [
  { type: "user_message", content: "理一下 routingBandit / routingCascade 的接线方式，直接改代码", ts: now - 90_000 },
  { type: "thinking_delta", callId: "c1", text: "先查 RunOverrides 现有形态，再决定是落盘还是运行面取值……", ts: now - 88_000 },
  { type: "tool_call", id: "t1", name: "read_file", args: { path: "src/main/settings.ts" }, ts: now - 87_000 },
  { type: "tool_result", callId: "t1", ok: true, ts: now - 86_500 },
  { type: "tool_call", id: "t2", name: "edit_file", args: { path: "src/agent/agent-runner.ts" }, ts: now - 86_000 },
  { type: "tool_result", callId: "t2", ok: true, change: "modified", snapshotId: "snap-4081", ts: now - 85_000 },
  { type: "usage", inputTokens: 12_400, outputTokens: 1_830, ts: now - 84_000 },
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
    MODEL("deepseek-chat", "deepseek", "deepseek-chat", "standard", 128_000, false, true),
    MODEL("deepseek-reasoner", "deepseek", "deepseek-reasoner", "strong", 128_000, false, true),
    MODEL("glm-5.3-flash", "glm", "glm-5.3-flash", "cheap", 1_000_000, true, false),
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

const reply = (v) => () => new Promise((res) => setTimeout(() => res(v), 30));
const agent = {
  protocolVersion: reply(1),
  getSettings: reply(SETTINGS),
  setSettings: reply(SETTINGS),
  getProviderInfo: reply(PROVIDER_INFO),
  providerKeyStatus: reply({ available: true, stored: ["deepseek", "glm"], envActive: true, envProviders: ["glm"] }),
  providerKeySet: reply({ ok: true }),
  providerKeyDelete: reply({ ok: true }),
  listSessions: reply([{ id: "s1", title: "接 routing 开关并跑全量验证", mtimeMs: now - 60_000, lines: 12, workspace: "/tmp/demo-ws" }]),
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
};

async function main() {
  await app.whenReady();
  const win = new BrowserWindow({
    width: 1440, height: 900, show: false,
    webPreferences: { preload: join(__dirname, "ui-gallery-preload.cjs") },
  });
  await win.loadFile(join(__dirname, "..", "dist", "index.html"));
  if (process.env.GALLERY_DARK === "1") {
    // 深色自查：真应用由 main 按 nativeTheme 落 data-theme；画廊里直接注入等价属性。
    await win.webContents.executeJavaScript(`document.documentElement.dataset.theme = "dark"`);
  }
  const shot = async (name, ms = 500) => {
    await new Promise((r) => setTimeout(r, ms));
    const img = await win.webContents.capturePage();
    require("node:fs").writeFileSync(join(OUT, name), img.toPNG());
    console.log("[gallery]", name);
  };
  const js = (code) => win.webContents.executeJavaScript(code);

  await shot("01-empty.png", 1200);

  // 模型菜单（搜索 + 分组 + 徽标 + 管理入口）
  await js(`document.querySelector(".mp-trigger")?.click()`);
  await shot("02-model-menu.png", 400);

  // 思考分段控件（deepseek-chat 声明支持 ⇒ 可点开）
  await js(`document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))`);
  await js(`[...document.querySelectorAll(".ctl")].find(b=>b.getAttribute("aria-label")==="思考档位")?.click()`);
  await shot("03-thinking.png", 400);

  // 空态 pill 填入 composer
  await js(`document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))`);
  await js(`document.querySelector(".pill")?.click()`);
  await shot("04-composer-draft.png", 300);

  // 打开演示会话 → markdown 流 + 变更卡
  await js(`document.querySelector(".session")?.click()`);
  await shot("05-stream.png", 900);

  // 设置页 provider 分区（卡片网格 + 详情）
  await js(`document.querySelector(".sidefooter .foot-btn")?.click()`);
  await new Promise((r) => setTimeout(r, 500));
  await js(`[...document.querySelectorAll(".sp-item")].find(b=>b.textContent.includes("模型与 Provider"))?.click()`);
  await shot("06-settings-provider.png", 500);

  console.log("[gallery] done");
  app.exit(0);
}

main().catch((err) => { console.error("[gallery] FAIL", err); app.exit(1); });
