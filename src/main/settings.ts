// 主进程 settings 存储（§10.7 layout.get|set + §13 设置页）：JSON 文件，原子写，加载时逐字段校验，
// 非法值回退默认（验收：写入后重新加载得到相同布局 / 非法布局值回退默认）。electron-free，可 headless 单测。
import { readFile } from "node:fs/promises";
import { writeFileAtomic } from "../atomic-write";
import { ENV_KEYED_PROVIDERS } from "../providers/env-keys";
import { effectiveModelTable, findSpecByNameOrId, isKnownProviderId } from "../providers/registry";

// M2d：第四面板 memory（两层记忆快照 + 会话内 remember 审计投影）；M2e：第五面板 plugins（插件容器）；
// M2f：第六面板 sidechat（辅助对话：只读旁路会话 + 提升记录投影）；
// M3a：第七面板 agents（多 agent 状态：每 worker 一列，§10.2）；
// M4a：第八面板 schedule（定时任务：列表/表单/历史六态，§12.2.6）。
export const PANEL_IDS = ["approvals", "token", "git", "memory", "plugins", "sidechat", "agents", "schedule"] as const;
export type PanelId = (typeof PANEL_IDS)[number];

export interface LayoutState {
  /** 每面板开/关（缺省 false；布局状态由应用服务持久化）。 */
  open: Partial<Record<PanelId, boolean>>;
  /** 当前打开的面板（单面板制 §10.1；null = 右栏收起）。 */
  activePanel: PanelId | null;
  /** 右栏宽度（react-resizable-panels 百分比 10–70）。 */
  width: number;
}

/** 档位集合与类型都在 `../permissions/modes`（唯一事实源）；这里只 re-export，不再抄一份字面量。 */
export { PERMISSION_MODES, type PermissionMode } from "../permissions/modes";
import { PERMISSION_MODES, type PermissionMode } from "../permissions/modes";
export type SafeMode = "off" | "report" | "gate";
export type ThemeSetting = "system" | "light" | "dark";
/** 2026-10-18：界面字号三档（tokens.css 的 `html[data-text-size=…]` 同名单）。
 *  md = 中间档 = --rem-scale 维持 1（缺省走这支，保证对既有用户零视觉变化）。 */
export type TextSizeSetting = "sm" | "md" | "lg";
/** v2.14：界面语言（i18n 偏好）——V1 只做持久化与校验（先让偏好可存可回读），渲染层文案翻译逐段接线。 */
export type LocaleSetting = "zh-CN" | "en-US";
/** 主对话模型通道：demo 是冻结剧本；内置四家与 worker registry / env-key 表同源；
 *  自定义 provider（`.agent/providers.json` 里声明的）是**运行时**才知道的 id —— 静态枚举不出来，
 *  所以用 `(string & {})` 保留内置字面量的编辑器提示、同时允许任意 id。
 *  代价是类型不再是封闭联合 ⇒ 判据必须落在运行时那一道：`validateSettings` 里问 `isKnownProviderId`。 */
export type ProviderKind = "demo" | (typeof ENV_KEYED_PROVIDERS)[number] | (string & {});

export interface AppSettings {
  layout: LayoutState;
  mode: PermissionMode;
  safeMode: SafeMode;
  theme: ThemeSetting;
  /** v2.14：界面语言（i18n 偏好）——V1 只做持久化与校验，文案翻译逐段接线。 */
  locale: LocaleSetting;
  /** 当前会话（JSONL 即会话；重启还原用）。 */
  currentSession: string | null;
  /** M2d：会话结束自动沉淀开关（记忆面板/设置页可关，默认开，§8.1.4 双轨）。 */
  autoMemory: boolean;
  /** 子代理三件套（spawn_agent / wait_for_agents / cancel_agents）挂不挂到模型面上。
   *  **缺省开**（能力 4「长程规划与任务分解」的正面）。关掉省 611 tok/轮——
   *  那是固定开销里最大的一块，且是**每一轮**都要重送的静态段。
   *  什么时候该关：这一轮根本不需要派 worker（单人小改动、只想省钱的短任务）。
   *  关掉之后模型连看都看不见这三把工具，也就不会去尝试派一个本来就派不出来的 worker。 */
  subagentTools: boolean;
  /** M3c §4.4.8：会话级成本闸上限（USD）；0 = off（缺省零行为，不破坏既有门）。 */
  maxBudgetUsd: number;
  /** M3c：每百万 token 单价（USD）；0 = 闸无效化（缺省零行为）。 */
  budgetPricePerMTok: number;
  /** M4a §12.2.3：同时运行的定时会话上限（1-8；缺省 2）。与 worker 并发上限 4 独立计数。 */
  scheduleConcurrencyCap: number;
  /** M4b §2.4：新手引导完成标记（缺省 false = 首启弹向导；完成后不再弹，设置页可重跑）。 */
  /** 首启引导是否已完成。**2026-10-06 起没有读者了**：用户要求删掉首启引导屏，
   *  引导门（App 的三态 takeover）随之移除。字段保留是为了不破坏既有 settings.json
   *  （删字段会让老档案被判成非法），但不要再拿它做任何门控。 */
  onboarded: boolean;
  /** M4b §2.3：更新 manifest URL（缺省空 = 「未配置更新源」显式态；V1 轻量检查不做自动下载）。 */
  updateManifestUrl: string;
  /** M4b §2.6：遥测开关（§13 默认关；V1 无上报实现 = 最强「零数据出门」保证，关于页注明）。 */
  telemetry: boolean;
  /** M5b §m5-proposal 步骤 9：bandit 在线学习开关（缺省 false = 零行为，不写 routing-bandit.json）。 */
  routingBandit: boolean;
  /** M5b 步骤 10 的产品侧接法（任务 #45）：pipeline 环跑完若**客观判据**（worker 事件流里的
   *  verify_result）判它没过，就升一档把同一环重跑（≤2 次）。缺省 false —— 一次升级 = 整份重跑，
   *  是真钱；且前提要有 routing（阶梯起点与升档都走路由）。worker 从没跑过 verify 时不升级（不猜）。 */
  routingCascade: boolean;
  /** SoL-Pi P-1 步骤 2：主对话 provider 档位（缺省 demo = 显式演示，不再是「未设 env 就静默 mock」）。 */
  provider: ProviderKind;
  /** 真实通道的模型名（缺省空 = 由 provider 层取缺省，如 glm-5.2）。 */
  model: string;
  /** SoL-Pi P-1 步骤 2：主对话工作区（缺省 null = 回落 M0B_WORKSPACE / 调用方 cwd）。 */
  workspace: string | null;
  /** SoL-Pi C1：写入后执行配置检查，显式开启，默认关闭。 */
  actionFusion: boolean;
  /** A1 写侧 prompt 缓存断点（Anthropic cache_control）。**缺省开**（用户裁决 2026-09-19）：
   *  GLM/OpenAI 是自动前缀缓存、Gemini 需另建 cachedContent 资源 ⇒ 目前只有 Anthropic 吃这个开关。
   *  生效前提是路由开启（routingBandit=true 才会合成真实 provider 档位）；路由关着时它是惰性配置，
   *  不打 warn（否则每次 run 都刷一条）。 */
  promptCache: boolean;
  requestMetering: boolean;
  observationPack: boolean;
  evidenceReceipts: boolean;
  economicCompaction: boolean;
  /** M7 影响面：write_file/edit_file 成功后回注跨文件波及（护栏，显式开启，默认关闭）。 */
  impactAnalysis: boolean;
  /** 能力 5 收束闸：写过盘但模型没自调 verify ⇒ 收束前 harness 补一拍验证（红字落事件流）。
   *  缺省关：一拍 = 真跑一遍 lint/test，成本与开闸判据见 BLOCKED「能力 5 收束闸」。 */
  autoVerify: boolean;
  /** 能力 5 的返修那一环：收束闸拍出**代码红**时再要一轮模型去修、修完重验一次（上限一次）。
   *  缺省关 = 与今日同形（红上时间线即收束）。开=每次红多付一轮模型请求 ⇒ 默认关，
   *  裁与不裁看 `replay:run-scorecard` 的返工读数与这一轮的实测价。 */
  autoVerifyRepair: boolean;
  /** plan 模式默认档：新对话是否默认武装「未批准方案即写禁」（composer 里的即时开关以此为初值）。
   *  缺省 false = 逐字同武装前（写禁只在模型自愿 propose_plan 后成立）。零 token 成本，只是谓词。 */
  planRequiredByDefault: boolean;
  /** 桌面蓝本 §3.6：Ctrl+Tab / Ctrl+Shift+Tab 循环会话开关。缺省**开**（文档把这对键列为主力）；
   *  §7.3.3 点名「别做成不可关闭」——误触用户可在此关掉，只留 ⌘⇧[ / ]。 */
  ctrlTabCycle: boolean;
  /** 2026-10-18：界面字号档（双轴变体的**文字轴**）。CSS 侧三档早已写好并在用——
   *  `html[data-text-size=sm|lg] { --rem-scale: .92|1.08 }`，而 --rem-scale 乘在 tokens.css 的
   *  每一个字号 calc 上 ⇒ 改这一个值，全界面文字一起缩放。此前缺的只是**一个字段 + 一处赋值**：
   *  没有字段 ⇒ App 无处存偏好；data-text-size 从来没被任何代码写过 ⇒ 三档是死代码。
   *  "md" = 不动 --rem-scale（维持 1），所以缺省值对既有用户是**逐像素零变化**。 */
  textSize: TextSizeSetting;
}

export const DEFAULT_SETTINGS: AppSettings = {
  layout: {
    open: { approvals: false, token: false, git: false, memory: false, plugins: false, sidechat: false, agents: false, schedule: false },
    activePanel: null,
    width: 32,
  },
  mode: "default",
  safeMode: "report",
  theme: "system",
  locale: "zh-CN",
  currentSession: null,
  autoMemory: true,
  subagentTools: true,
  maxBudgetUsd: 0,
  budgetPricePerMTok: 0,
  scheduleConcurrencyCap: 2,
  onboarded: false,
  updateManifestUrl: "",
  telemetry: false,
  routingBandit: false,
  routingCascade: false,
  provider: "demo",
  model: "",
  workspace: null,
  actionFusion: false,
  promptCache: true,
  requestMetering: false,
  observationPack: false,
  evidenceReceipts: false,
  economicCompaction: false,
  // 跨文件波及面：写完一个文件后告诉模型「谁调用了它」，让它在改第二处之前先看见第一处。
  // 用户裁决 2026-09-27 翻默认——三个「省钱 / 少返工」开关里只翻这一个：它不改花钱行为，
  // 而 `routingBandit`（每轮换模型）与 `maxBudgetUsd`（要一个具体数字）都改，且仓里还没有
  // 外部基准读数可依（要翻先得接基准）。代价是每次写后多一次跨文件调用点扫描。
  impactAnalysis: true,
  // 能力 5 的收束闸：核心产品要求 lint/test 两者默认开，而这里曾长期 false
  // （09-19 设计稿 D7 记的"燃料默认不在线"）。用户裁决 2026-09-23：**只翻这一项**，
  // `actionFusion` 仍留关，等准确率与 `$/成功任务` 的对照数出来再裁。
  // 硬上界（开闸时）：每 run 至多一拍、模型自调过 verify 即让位、仓库没有可验面则整段跳过。
  autoVerify: true,
  autoVerifyRepair: false,
  planRequiredByDefault: false,
  ctrlTabCycle: true,
  textSize: "md",
};

const SAFE_MODES = ["off", "report", "gate"] as const;
const THEMES = ["system", "light", "dark"] as const;
const LOCALES = ["zh-CN", "en-US"] as const;
/** 字号三档（与 tokens.css 的 html[data-text-size=…] 选择器逐字对应——改一处必须改另一处）。 */
const TEXT_SIZES = ["sm", "md", "lg"] as const;
/** 设置面可持久化的主会话 provider 的**内置**子集：demo + 四个真实 adapter。
 *  自定义 provider 不在这个字面量里（它们是运行时才知道的），由 `isPersistableProvider` 一并放行。 */
export const PROVIDER_KINDS = ["demo", ...ENV_KEYED_PROVIDERS] as const;

/** 这个 provider 值能不能落盘：内置清单，或**已装上**的自定义 provider。
 *  为什么不是「任意字符串」：写盘的值会在下次启动被回读并拿去拨号，收下一个永远不会生效的 id
 *  等于让用户以为切过去了（静默回落）。 */
export function isPersistableProvider(v: unknown): boolean {
  if (typeof v !== "string") return false;
  return (PROVIDER_KINDS as readonly string[]).includes(v) || isKnownProviderId(v);
}

function isPanelId(v: unknown): v is PanelId {
  return typeof v === "string" && (PANEL_IDS as readonly string[]).includes(v);
}

/** 逐字段校验：合法取原值，非法/缺失取默认（验收②：非法布局值回退默认）。 */
export function validateSettings(raw: unknown): AppSettings {
  const d = DEFAULT_SETTINGS;
  if (typeof raw !== "object" || raw === null) return structuredClone(d);
  const r = raw as Record<string, unknown>;
  const layoutRaw = (typeof r.layout === "object" && r.layout !== null ? r.layout : {}) as Record<string, unknown>;
  const open: Record<PanelId, boolean> = {
    approvals: d.layout.open.approvals === true,
    token: d.layout.open.token === true,
    git: d.layout.open.git === true,
    memory: d.layout.open.memory === true,
    plugins: d.layout.open.plugins === true,
    sidechat: d.layout.open.sidechat === true,
    agents: d.layout.open.agents === true,
    schedule: d.layout.open.schedule === true,
  };
  if (typeof layoutRaw.open === "object" && layoutRaw.open !== null) {
    for (const [k, v] of Object.entries(layoutRaw.open as Record<string, unknown>)) {
      if (isPanelId(k) && typeof v === "boolean") open[k] = v;
    }
  }
  const width =
    typeof layoutRaw.width === "number" && Number.isFinite(layoutRaw.width) && layoutRaw.width >= 10 && layoutRaw.width <= 70
      ? layoutRaw.width
      : d.layout.width;
  const activePanel = isPanelId(layoutRaw.activePanel) ? layoutRaw.activePanel : null;
  const nonNegNumber = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
  const capRaw = typeof r.scheduleConcurrencyCap === "number" && Number.isInteger(r.scheduleConcurrencyCap)
    ? r.scheduleConcurrencyCap
    : null;
  // Legacy settings may store either the stable registry id or the provider wire model name.
  // Unregistered strings are discarded here; RunRequest itself remains strict-id-only.
  const model = typeof r.model === "string" && findSpecByNameOrId(effectiveModelTable(), r.model)
    ? r.model.slice(0, 200)
    : d.model;
  return {
    layout: { open, activePanel, width },
    mode: PERMISSION_MODES.includes(r.mode as PermissionMode) ? (r.mode as PermissionMode) : d.mode,
    safeMode: SAFE_MODES.includes(r.safeMode as SafeMode) ? (r.safeMode as SafeMode) : d.safeMode,
    theme: THEMES.includes(r.theme as ThemeSetting) ? (r.theme as ThemeSetting) : d.theme,
    // v2.14：locale 白名单外回退默认（zh-CN）——与 theme 同式，非法值不落库
    locale: LOCALES.includes(r.locale as LocaleSetting) ? (r.locale as LocaleSetting) : d.locale,
    currentSession: typeof r.currentSession === "string" && r.currentSession.length > 0 ? r.currentSession : null,
    autoMemory: typeof r.autoMemory === "boolean" ? r.autoMemory : d.autoMemory,
    subagentTools: typeof r.subagentTools === "boolean" ? r.subagentTools : d.subagentTools,
    maxBudgetUsd: nonNegNumber(r.maxBudgetUsd) ?? d.maxBudgetUsd,
    budgetPricePerMTok: nonNegNumber(r.budgetPricePerMTok) ?? d.budgetPricePerMTok,
    scheduleConcurrencyCap: capRaw !== null && capRaw >= 1 && capRaw <= 8 ? capRaw : d.scheduleConcurrencyCap,
    // M4b：onboarded / telemetry 非布尔回退默认；updateManifestUrl 非字符串回退空（未配置显式态）
    onboarded: typeof r.onboarded === "boolean" ? r.onboarded : d.onboarded,
    updateManifestUrl: typeof r.updateManifestUrl === "string" ? r.updateManifestUrl : d.updateManifestUrl,
    telemetry: typeof r.telemetry === "boolean" ? r.telemetry : d.telemetry,
    routingBandit: typeof r.routingBandit === "boolean" ? r.routingBandit : d.routingBandit,
    routingCascade: typeof r.routingCascade === "boolean" ? r.routingCascade : d.routingCascade,
    actionFusion: r.actionFusion === true,
    // promptCache 缺省开 ⇒ 读法回退 `d.`（同 autoMemory/telemetry），不能用 `=== true`：
    // 旧 settings JSON 里没这个键时 `undefined === true` 会把"缺省开"变成对老用户仍然是关。
    promptCache: typeof r.promptCache === "boolean" ? r.promptCache : d.promptCache,
    requestMetering: r.requestMetering === true,
    observationPack: r.observationPack === true,
    evidenceReceipts: r.evidenceReceipts === true,
    economicCompaction: r.economicCompaction === true,
    // 缺省开的键一律走 `d.` 回退（`promptCache` / `autoVerify` 同族）：写成 `=== true` 会让
    // 「缺省开」对每一台已写过 settings 文件的机器静默变成「关」——2026-09-27 翻默认时踩过。
    impactAnalysis: typeof r.impactAnalysis === "boolean" ? r.impactAnalysis : d.impactAnalysis,
    // 缺省开的键一律走 `d.` 回退（上一条 `promptCache` 同族）：写成 `=== true` 会让「缺省开」
    // 对每一台已写过 settings 文件的机器静默变成「关」——而 §483 要的正是默认开。
    autoVerify: typeof r.autoVerify === "boolean" ? r.autoVerify : d.autoVerify,
    // 缺省关的键才用 `=== true`（上面那条规矩的反面：默认关时严格真值才不会把 false 读成缺省）
    autoVerifyRepair: r.autoVerifyRepair === true,
    planRequiredByDefault: r.planRequiredByDefault === true,
    // 缺省开的键走 `d.` 回退（promptCache 同族）：老 settings.json 无此键时保持「开」，不被静默关掉。
    ctrlTabCycle: typeof r.ctrlTabCycle === "boolean" ? r.ctrlTabCycle : d.ctrlTabCycle,
    // 2026-10-18 字号档：白名单外（含旧档案没这个键）回退 "md" = --rem-scale 1 = 与今天逐像素一致。
    textSize: TEXT_SIZES.includes(r.textSize as TextSizeSetting) ? (r.textSize as TextSizeSetting) : d.textSize,
    provider: isPersistableProvider(r.provider) ? (r.provider as ProviderKind) : d.provider,
    model,
    // 工作区：非空字符串取原值（越界长度回退默认，避免把畸形路径带进 run 装配）；其余回退 null
    workspace:
      typeof r.workspace === "string" && r.workspace.trim() !== "" && r.workspace.length <= 4096
        ? r.workspace
        : d.workspace,
  };
}

/** settings 存储：内存缓存 + 每次写盘（原子写），多实例（重新加载 = 新实例）读到磁盘真相。 */
export class SettingsStore {
  private cache: AppSettings | null = null;
  /* 写队列。此前「取合并基 → 写盘 → 更新缓存」三步之间没有串行化，同窗口两笔 set 会撞两台：
     ① 临时文件名只用 pid + 毫秒（那次硬化治的是**跨进程**固定名覆写，同进程同毫秒仍是同一个名）
       ⇒ 先 rename 的把文件搬走，后 rename 的直接抛 ENOENT，用户看到「保存设置失败」而屏幕已经改了；
     ② 就算错开毫秒，两笔都拿同一份**旧缓存**当合并基 ⇒ 后落地的那笔把对方刚写的字段原样盖回。
     燃料是现成的：layout 那一笔包在 renderSide 外层（每帧重绘一笔），设置页点一下又是一笔。 */
  private writes: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  /** 读取：首读落盘校验（坏文件回退默认），后续走缓存。 */
  async get(): Promise<AppSettings> {
    if (this.cache) return this.cache;
    let raw: unknown = null;
    try {
      raw = JSON.parse(await readFile(this.filePath, "utf8")) as unknown;
    } catch {
      raw = null; // 文件不存在 / JSON 损坏 → 默认（验收②）
    }
    // 首读可能晚于另一笔 get/set 完成，迟到的旧结果不能覆盖已更新的缓存。
    if (this.cache === null) this.cache = validateSettings(raw);
    return this.cache;
  }

  /** 部分更新：深合并 layout，其余浅合并；原子写盘后返回新值。写入按发起顺序串行。 */
  async set(patch: Partial<Omit<AppSettings, "layout">> & { layout?: Partial<LayoutState> }): Promise<AppSettings> {
    const next = this.writes.then(() => this.applyPatch(patch));
    // 一次写失败（磁盘满 / 权限）只回给当次调用者，不得把后面排队的写全卡死。
    this.writes = next.catch(() => undefined);
    return next;
  }

  private async applyPatch(patch: Partial<Omit<AppSettings, "layout">> & { layout?: Partial<LayoutState> }): Promise<AppSettings> {
    const cur = await this.get();
    /* 标量字段整体浅合并——旧写法把 26 个键名手抄成一条布尔表达式，只有列在里面的键才生效：
       往 AppSettings 加一个字段而忘了抄进名单，set() 会把它**连同整笔 patch** 静默丢成 {}
       （与 606fe7f 那两份名单同族）。名单由类型本身覆盖，没有可漂移的副本。 */
    const { layout: layoutPatch, ...scalars } = patch;
    const next: AppSettings = {
      ...cur,
      ...scalars,
      layout: layoutPatch
        ? {
            open: layoutPatch.open ? { ...cur.layout.open, ...layoutPatch.open } : cur.layout.open,
            activePanel: layoutPatch.activePanel !== undefined ? layoutPatch.activePanel : cur.layout.activePanel,
            width: layoutPatch.width !== undefined ? layoutPatch.width : cur.layout.width,
          }
        : cur.layout,
    };
    const validated = validateSettings(next);
    // 把「调用方这次没改、但校验器不认识」的 provider/model 原样写回磁盘：
    // 自定义 provider 在注册表未装载时会回退 demo，而随后任何一笔 layout 写都会把 demo
    // 持久化 ⇒ 配置修好后用户偏好也回不来（静默走 demo）。内存仍用校验后的值。
    const raw = await this.readRaw();
    const persisted: Record<string, unknown> = { ...(validated as unknown as Record<string, unknown>) };
    for (const key of ["provider", "model"] as const) {
      if ((scalars as Record<string, unknown>)[key] === undefined && typeof raw?.[key] === "string") {
        persisted[key] = raw[key];
      }
    }
    await this.persist(persisted);
    this.cache = validated;
    return validated;
  }

  /** 磁盘原文（合并基的「不认识但别丢」那一半）。坏文件 = null。 */
  private async readRaw(): Promise<Record<string, unknown> | null> {
    try {
      const raw = JSON.parse(await readFile(this.filePath, "utf8")) as unknown;
      return raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
    } catch {
      return null;
    }
  }

  /** 原子写（临时文件 + rename，中断自愈）。 */
  private async persist(s: Record<string, unknown>): Promise<void> {
    await writeFileAtomic(this.filePath, JSON.stringify(s, null, 2));
  }
}
