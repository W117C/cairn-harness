// 主进程 settings 存储（§10.7 layout.get|set + §13 设置页）：JSON 文件，原子写，加载时逐字段校验，
// 非法值回退默认（验收：写入后重新加载得到相同布局 / 非法布局值回退默认）。electron-free，可 headless 单测。
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

// M2d：第四面板 memory（两层记忆快照 + 会话内 remember 审计投影）；M2e：第五面板 plugins（插件容器）；
// M2f：第六面板 sidechat（辅助对话：只读旁路会话 + 提升记录投影）；
// M3a：第七面板 agents（多 agent 状态：每 worker 一列，§10.2）；
// M4a：第八面板 schedule（定时任务：列表/表单/历史六态，§12.2.6）。
export const PANEL_IDS = ["approvals", "token", "git", "memory", "plugins", "sidechat", "agents", "schedule"] as const;
export type PanelId = (typeof PANEL_IDS)[number];

export interface LayoutState {
  /** 每面板开/关（缺省 false；Partial 因 panels-check 冻结字面量只写三类键，M2d 增至四类）。 */
  open: Partial<Record<PanelId, boolean>>;
  /** 当前打开的面板（单面板制 §10.1；null = 右栏收起）。 */
  activePanel: PanelId | null;
  /** 右栏宽度（react-resizable-panels 百分比 10–70）。 */
  width: number;
}

export type PermissionMode = "read-only" | "default" | "auto";
export type SafeMode = "off" | "report" | "gate";
export type ThemeSetting = "system" | "light" | "dark";

export interface AppSettings {
  layout: LayoutState;
  mode: PermissionMode;
  safeMode: SafeMode;
  theme: ThemeSetting;
  /** 当前会话（JSONL 即会话；重启还原用）。 */
  currentSession: string | null;
  /** M2d：会话结束自动沉淀开关（记忆面板/设置页可关，默认开，§8.1.4 双轨）。 */
  autoMemory: boolean;
  /** M3c §4.4.8：会话级成本闸上限（USD）；0 = off（缺省零行为，不破坏既有门）。 */
  maxBudgetUsd: number;
  /** M3c：每百万 token 单价（USD）；0 = 闸无效化（缺省零行为）。 */
  budgetPricePerMTok: number;
  /** M4a §12.2.3：同时运行的定时会话上限（1-8；缺省 2）。与 worker 并发上限 4 独立计数。 */
  scheduleConcurrencyCap: number;
  /** M4b §2.4：新手引导完成标记（缺省 false = 首启弹向导；完成后不再弹，设置页可重跑）。 */
  onboarded: boolean;
  /** M4b §2.3：更新 manifest URL（缺省空 = 「未配置更新源」显式态；V1 轻量检查不做自动下载）。 */
  updateManifestUrl: string;
  /** M4b §2.6：遥测开关（§13 默认关；V1 无上报实现 = 最强「零数据出门」保证，关于页注明）。 */
  telemetry: boolean;
  /** M5b §m5-proposal 步骤 9：bandit 在线学习开关（缺省 false = 零行为，不写 routing-bandit.json）。 */
  routingBandit: boolean;
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
  currentSession: null,
  autoMemory: true,
  maxBudgetUsd: 0,
  budgetPricePerMTok: 0,
  scheduleConcurrencyCap: 2,
  onboarded: false,
  updateManifestUrl: "",
  telemetry: false,
  routingBandit: false,
};

const PERMISSION_MODES = ["read-only", "default", "auto"] as const;
const SAFE_MODES = ["off", "report", "gate"] as const;
const THEMES = ["system", "light", "dark"] as const;

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
  return {
    layout: { open, activePanel, width },
    mode: PERMISSION_MODES.includes(r.mode as PermissionMode) ? (r.mode as PermissionMode) : d.mode,
    safeMode: SAFE_MODES.includes(r.safeMode as SafeMode) ? (r.safeMode as SafeMode) : d.safeMode,
    theme: THEMES.includes(r.theme as ThemeSetting) ? (r.theme as ThemeSetting) : d.theme,
    currentSession: typeof r.currentSession === "string" && r.currentSession.length > 0 ? r.currentSession : null,
    autoMemory: typeof r.autoMemory === "boolean" ? r.autoMemory : d.autoMemory,
    maxBudgetUsd: nonNegNumber(r.maxBudgetUsd) ?? d.maxBudgetUsd,
    budgetPricePerMTok: nonNegNumber(r.budgetPricePerMTok) ?? d.budgetPricePerMTok,
    scheduleConcurrencyCap: capRaw !== null && capRaw >= 1 && capRaw <= 8 ? capRaw : d.scheduleConcurrencyCap,
    // M4b：onboarded / telemetry 非布尔回退默认；updateManifestUrl 非字符串回退空（未配置显式态）
    onboarded: typeof r.onboarded === "boolean" ? r.onboarded : d.onboarded,
    updateManifestUrl: typeof r.updateManifestUrl === "string" ? r.updateManifestUrl : d.updateManifestUrl,
    telemetry: typeof r.telemetry === "boolean" ? r.telemetry : d.telemetry,
    routingBandit: typeof r.routingBandit === "boolean" ? r.routingBandit : d.routingBandit,
  };
}

/** settings 存储：内存缓存 + 每次写盘（原子写），多实例（重新加载 = 新实例）读到磁盘真相。 */
export class SettingsStore {
  private cache: AppSettings | null = null;

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
    this.cache = validateSettings(raw);
    return this.cache;
  }

  /** 部分更新：深合并 layout，其余浅合并；原子写盘后返回新值。 */
  async set(patch: Partial<Omit<AppSettings, "layout">> & { layout?: Partial<LayoutState> }): Promise<AppSettings> {
    const cur = await this.get();
    const next: AppSettings = {
      ...cur,
      ...("mode" in patch || "safeMode" in patch || "theme" in patch || "currentSession" in patch ||
        "autoMemory" in patch || "maxBudgetUsd" in patch || "budgetPricePerMTok" in patch ||
        "scheduleConcurrencyCap" in patch || "onboarded" in patch || "updateManifestUrl" in patch ||
        "telemetry" in patch || "routingBandit" in patch
        ? patch
        : {}),
      layout: patch.layout
        ? {
            open: patch.layout.open ? { ...cur.layout.open, ...patch.layout.open } : cur.layout.open,
            activePanel: patch.layout.activePanel !== undefined ? patch.layout.activePanel : cur.layout.activePanel,
            width: patch.layout.width !== undefined ? patch.layout.width : cur.layout.width,
          }
        : cur.layout,
    };
    const validated = validateSettings(next);
    await this.persist(validated);
    this.cache = validated;
    return validated;
  }

  /** 原子写（临时文件 + rename，中断自愈）。 */
  private async persist(s: AppSettings): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmp = this.filePath + ".tmp";
    try {
      await writeFile(tmp, JSON.stringify(s, null, 2), "utf8");
      await rename(tmp, this.filePath);
    } catch (err) {
      await unlink(tmp).catch(() => {});
      throw err;
    }
  }
}
