// 设置页正文四段（批 6 · 总纲阶段 3-1/3-2 + 细则 §六）——SettingsPanel 只做壳，正文全在这里：
//   GeneralSection      外观（主题 3 选项卡带小预览图）/ 语言 / 快捷键（Ctrl+Tab）
//   ProviderSection     当前通道与密钥 / 联网搜索（状态点 + 一句话 + 去配置 + 查看详情折叠）/
//                       自定义接口 / 识图能力（2026-10-16 v12 导入诊断批补的第四卡）
//   PermissionsSection  五档 OptionCard（auto / full-access = danger + 警示行）/ 方案门 / 网络只读行
//   AboutSection        版本 / 更新 / 诊断信息折叠区（术语收容所）
// 纯函数资产（panelPatch / providerStatusLabel(由 providerStatusParts 拼回) / searchCapabilityLabel /
// SEARCH_CONFIG_HINT / defaultKeyProvider / PANEL_PROVIDER_KINDS / providerNeedsKey）随迁至本文件——
// SettingsPanel 重导出保旧 import 面（settings-panel.test 判卷锚不动）。
// 2026-10-16（模型/通道页重做）：控件走 settings-ui 的 Field（36px/8px/四态）、徽章走 Badge、
// 状态走 StatusDot；旧 sp-key-row / sp-key-chip 一族随重做下架（判卷钉已同步改名点名）。
import { useEffect, useState } from "react";
import type { MutableRefObject, ReactNode } from "react";
import { ChevronRight, Plus, TriangleAlert } from "lucide-react";
import type { LicenseState } from "../../../../../src/main/license";
import type { BuildInfo } from "../../../../../src/main/build-info";
import type { DoctorReport } from "../../../../../src/main/doctor";
import type { AppSettings, PermissionMode } from "../../../../../src/main/ipc-protocol";
import type { TextSizeSetting, UiSizeSetting } from "../../../../../src/main/settings";
import { Badge, Banner, Field, OptionCard, SettingsSection, SettingsRow, StatusDot } from "./settings-ui";
import { Switch } from "./Switch";
import { ConfirmDialog } from "./ConfirmDialog";
import { permissionConfirmCopy } from "./PermissionMenu";
import { CustomProviderForm } from "./CustomProviderForm";
import { SHORTCUTS } from "../shortcuts";
import { doctorReportText, doctorRows, doctorTarget, doctorVerdictText, type DoctorKeyStatus, type DoctorRow } from "./settings/doctor-view";
import { STR } from "../strings";
import type { SectionId } from "../app-controls";
import { isCompositionEnter } from "../ime";

/** patch 白名单：UI 只放行这六键，不透传任意 patch。
 *  locale 进白名单修的是实测缺陷：下拉框选了 English、后端也白名单放行，但 panelPatch 把它丢了
 *  ⇒ 显示"已保存"而选项没落库（同族形态：视图说成功、事实没发生）。 */
export const PANEL_PATCH_KEYS = ["provider", "model", "mode", "theme", "planRequiredByDefault", "locale"] as const;

export function panelPatch(patch: Record<string, unknown>): Partial<AppSettings> {
  const out: Partial<AppSettings> = {};
  for (const key of PANEL_PATCH_KEYS) {
    const value = patch[key];
    if (value !== undefined) (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

/** provider 选项集（同形再推导：settings.ts 拖 node:fs，不能进 renderer bundle；
 *  与 settings.PROVIDER_KINDS 的逐位等值由 settings-panel.test 对账钉死）。 */
export const PANEL_PROVIDER_KINDS: readonly string[] = ["demo", "glm", "openai", "anthropic", "gemini", "deepseek"];

/** 该 provider 是否需要 key（demo 免；未知一律按要 key 判——fail-visible 而不是当 demo 放行）。 */
export function providerNeedsKey(kind: string): boolean {
  return kind !== "demo";
}

/** key 表单的缺省 provider：选项集里第一个需要 key 的。
 *  修复实测缺陷：初值曾写死 "deepseek"，而选项集里根本没有它（干净注册表下后端白名单直接拒收）
 *  ——用户不主动重选就第一次保存必失败。缺省值必须从同一张选项集里推导。 */
export function defaultKeyProvider(kinds: readonly string[] = PANEL_PROVIDER_KINDS): string {
  return kinds.find((k) => providerNeedsKey(k)) ?? kinds[0] ?? "";
}

/** 凭据段状态三件（2026-10-16 模型/通道页重做）：已存 key 由徽章承担（line 不重复摆字）、
 *  env 提示走提示色小字位；safeStorage 不可用 = warn（danger 色），拒存口径照旧不虚报。 */
export interface ProviderStatusParts {
  /** 状态行（已存 key 时为空串——徽章已表达）。 */
  line: string;
  /** 已存 key 清单（徽章数据源）；安全存储不可用时为空。 */
  stored: string[];
  /** 「检测到环境变量，将优先使用」；无则 null。 */
  envHint: string | null;
  tone: "ok" | "warn";
}

export function providerStatusParts(status: { available: boolean; stored: string[]; envActive: boolean }): ProviderStatusParts {
  if (!status.available) {
    return { line: "安全存储不可用：key 无法保存（fail-closed，不落明文）", stored: [], envHint: null, tone: "warn" };
  }
  const envHint = status.envActive ? "检测到环境变量，将优先使用" : null;
  if (status.stored.length === 0) return { line: "尚未存储任何 key", stored: [], envHint, tone: "ok" };
  return { line: "", stored: [...status.stored], envHint, tone: "ok" };
}

/** 凭据段状态行（三态文案唯一出口；由 providerStatusParts 拼回——对外字符串逐字不变）。
 *  批 6（细则 §六）：env 优先规则改一行通俗说明「检测到环境变量，将优先使用」。 */
export function providerStatusLabel(status: { available: boolean; stored: string[]; envActive: boolean }): string {
  const parts = providerStatusParts(status);
  if (!status.available) return parts.line;
  const base = parts.stored.length === 0 ? parts.line : `已存 key：${parts.stored.join("、")}`;
  return parts.envHint !== null ? `${base}；${parts.envHint}` : base;
}

/** 搜索能力状态行（三态文案唯一出口；口径同 CLI --doctor 的 search 那一格）。
 *
 *  为什么值得在设置页占一行：`web_search` 没配端点时**整族不注入**（规格面与执行面同时摘），
 *  模型于是会说「我没有检索能力」。这句话对，但用户此前无从知道原因——doctor 只有 CLI 输出，
 *  桌面端没有那个面。结果是一个**配置缺口被体验成模型缺陷**。
 *  这一行把「没配」说成一句可执行的话，而不是让用户猜。 */
export function searchCapabilityLabel(cap: {
  search: { kind: "unset" } | { kind: "ok" } | { kind: "broken"; message: string };
  searchEndpoint?: string;
}): string {
  if (cap.search.kind === "ok") {
    return cap.searchEndpoint !== undefined ? `联网搜索已配（${cap.searchEndpoint}）` : "联网搜索已配";
  }
  if (cap.search.kind === "unset") {
    return "联网搜索未配：web_search 工具不会出现，模型只能说「我没有检索能力」";
  }
  return `.agent/config.json 解析失败：${cap.search.message}（web_search 同样不注入）`;
}

/** 未配搜索端点时的那句配法。单独一行常量而不是 JSX 里拼 JSON：
 *  JSX 转义出来的引号形状没人读得懂，而这句话是要用户照抄的。 */
export const SEARCH_CONFIG_HINT =
  "工作区 .agent/config.json 里加 \"search\": { \"endpoint\": \"https://searx.example/search?q={query}&format=json\" }（endpoint 必须含 {query} 占位符）";

/** 识图能力状态行（三态，与 `searchCapabilityLabel` 同一形状的理由）。
 *
 *  2026-10-16 读数：`cn:hy3` 没声明 image 模态，而 render_image 渲出来的图照样进请求体。
 *  于是「工具调用成功」被读成「模型看得懂这张图」——两件事必须分开摆。
 *  三态：declared（配置里声明了 image 模态，仍是配置侧事实，不是上游实测）/
 *  undeclared（没声明 ⇒ 按不支持处理）/ unverified（连选中模型都取不到，不猜）。 */
export function visionCapabilityLabel(cap: {
  vision: { state: "declared" | "undeclared" | "unverified"; modelId: string | null; declaredModalities: readonly string[] };
}): string {
  const v = cap.vision;
  if (v.state === "declared") {
    return `${v.modelId ?? "当前模型"} 已声明支持图片输入；尚未验证实际效果。`;
  }
  if (v.state === "undeclared") {
    return `${v.modelId ?? "当前模型"} 未声明支持图片输入，图片理解能力尚未确认。`;
  }
  return "识图能力未验证：无法读取当前模型，暂时无法确认是否支持图片输入。";
}

/** 「关于与更新」诊断信息折叠区文案（术语收容所）：工程词集中在这里供对照，
 *  正文一律说人话（总纲阶段 3-3「去掉界面中所有内部术语」的收容侧）。 */
export const DIAGNOSTICS_TEXT =
  "调度器：serveScheduler 常驻；运行历史 = journal 投影；技能正文由 expandSkillInvocation 展开。" +
  "主进程日志写在应用数据目录的 logs/main.log（超过 2 MiB 轮转为 main.1.log），" +
  "可从菜单栏「帮助 → 打开日志文件夹」打开。以上为工程术语，供排查时对照日志使用。";

// ── 通用段（外观 / 语言 / 快捷键）────────────────────────────────────────

const THEME_OPTIONS: readonly { id: AppSettings["theme"]; label: string }[] = [
  { id: "system", label: "跟随系统" },
  { id: "light", label: "亮" },
  { id: "dark", label: "暗" },
];

/** 字号三档（2026-10-18）。id 与 tokens.css 的 `html[data-text-size=…]` 逐字对应；
 *  预览字「A」的字号随档变化，让用户在点下去之前就看见差别（不靠猜）。 */
const TEXT_SIZE_OPTIONS: readonly { id: TextSizeSetting; label: string }[] = [
  { id: "sm", label: "小" },
  { id: "md", label: "标准" },
  { id: "lg", label: "大" },
];

/** 组件尺寸五档（2026-10-20 · 双轴变体的尺寸轴，销 G2）。
 *  依据 Claude 实测 data-step="1…5"（step2 = 缺省 = --size-scale 1，step4 = comfortable 密度）。
 *  id 与 tokens.css 的 `html[data-ui-size="…"]` 逐字对应。 */
const UI_SIZE_OPTIONS: readonly { id: UiSizeSetting; label: string }[] = [
  { id: "1", label: "紧凑" },
  { id: "2", label: "标准" },
  { id: "3", label: "宽松" },
  { id: "4", label: "舒适" },
  { id: "5", label: "超大" },
];

export function GeneralSection(props: {
  settings: AppSettings;
  /** 当前字号档（App 的 live state——与 settings.textSize 同源，但保存后立刻回灌）。 */
  textSize: TextSizeSetting;
  onSave: (patch: Record<string, unknown>) => void;
  /** Ctrl+Tab 走单键直调通道（不入 panelPatch 白名单）。 */
  onCtrlTab: (next: boolean) => void;
  /** 字号档同样走单键直调（不入 panelPatch 白名单；理由同 onCtrlTab）。 */
  onTextSize: (next: TextSizeSetting) => void;
  /** 2026-10-20：组件尺寸档（尺寸轴）；同样走单键直调，理由同上。 */
  uiSize: UiSizeSetting;
  onUiSize: (next: UiSizeSetting) => void;
  onWindowVibrancy: (next: boolean) => void;
  /** 完成通知开关（同样走单键直调：panelPatch 白名单不动）。 */
  onNotify: (next: boolean) => void;
  /** 重新显示首启检查（缺省 = 不摆入口）。 */
  onShowOnboarding?: () => void;
}): React.JSX.Element {
  return (
    <>
      <SettingsSection title="外观">
        <SettingsRow label="主题">
          <div className="theme-opts" role="radiogroup" aria-label="主题">
            {THEME_OPTIONS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={props.settings.theme === t.id}
                className={"theme-opt" + (props.settings.theme === t.id ? " on" : "")}
                onClick={() => props.onSave({ theme: t.id })}
              >
                {/* 2026-10-24 业主：不要色块小预览——主题选择就是三个词，文字直给。 */}
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        </SettingsRow>
        <SettingsRow label="文字大小">
          <div className="theme-opts" role="radiogroup" aria-label="文字大小">
            {TEXT_SIZE_OPTIONS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={props.textSize === t.id}
                className={"theme-opt" + (props.textSize === t.id ? " on" : "")}
                onClick={() => props.onTextSize(t.id)}
              >
                <span className="ts-thumb" data-ts={t.id} aria-hidden="true">A</span>
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        </SettingsRow>
        <SettingsRow label="界面密度">
          <div className="theme-opts" role="radiogroup" aria-label="界面密度">
            {UI_SIZE_OPTIONS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={props.uiSize === t.id}
                className={"theme-opt" + (props.uiSize === t.id ? " on" : "")}
                onClick={() => props.onUiSize(t.id)}
              >
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        </SettingsRow>
        <SettingsRow label="窗口材质" desc="改动需重启窗口。">
          <Switch
            label="窗口材质"
            checked={props.settings.windowVibrancy === true}
            onChange={props.onWindowVibrancy}
            onText="开"
            offText="关"
          />
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title="使用习惯">
        {/* 次级说明不再复述控件已经说的话：语言值就摆在右侧（只有一项），
            快捷键表里另有「⌘⇧] / ⌘⇧[」一行，这里再写一遍是同一屏的第二处。 */}
        <SettingsRow label="界面语言">
          <span className="ss-static">中文（简体）</span>
        </SettingsRow>
        {props.onShowOnboarding !== undefined && (
          <SettingsRow label="首启检查" desc="不会重置任何其它设置。">
            <button type="button" className="mini-btn" onClick={props.onShowOnboarding}>重新显示</button>
          </SettingsRow>
        )}
        <SettingsRow label="任务完成时通知" desc="点击通知回到该会话。">
          <Switch
            label="任务完成时通知"
            checked={props.settings.notifyOnComplete !== false}
            onChange={props.onNotify}
            onText="开"
            offText="关"
          />
        </SettingsRow>
        <SettingsRow label="Ctrl+Tab 切会话">
          <Switch
            label="Ctrl+Tab 切会话"
            checked={props.settings.ctrlTabCycle}
            onChange={props.onCtrlTab}
            onText="开"
            offText="关"
          />
        </SettingsRow>
      </SettingsSection>
    </>
  );
}

// ── 模型与 Provider 三段（当前通道与密钥 / 联网搜索 / 自定义接口）──────────

/** 供应商显示名（2026-10-24 参照 Codex 供应商页的左列表）：kind id 是机器名，界面上给人话。 */
const PROVIDER_LABELS: Record<string, string> = {
  demo: "Demo",
  glm: "智谱 GLM",
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Gemini",
  deepseek: "DeepSeek",
};

export function ProviderSection(props: {
  settings: AppSettings | null;
  status: { available: boolean; stored: string[]; envActive: boolean };
  /** 已知供应商清单（内置 + 已装自定义）——来自 getProviderInfo，不再写死四个。 */
  providers: readonly { id: string; label: string; custom: boolean }[];
  /** 全量真模型（按 provider 归数给自定义供应商的详情用）。 */
  models: readonly { id: string; provider: string }[];
  /** 能力读数只消费 search/searchEndpoint/vision 三格（结构子集，同 searchCapabilityLabel 的口径）。
   *  vision 是 2026-10-16 加的：把「模型声明了图片输入」与「上游真的看得懂」分开——
     *  前者是配置事实，后者要带凭据实测，而后者今天一次都没有做过。 */
  cap: { search: { kind: "unset" } | { kind: "ok" } | { kind: "broken"; message: string }; searchEndpoint?: string;
    vision: { state: "declared" | "undeclared" | "unverified"; modelId: string | null; declaredModalities: readonly string[] } } | null;
  keyProvider: string;
  onKeyProviderChange: (p: string) => void;
  keyInputRef: MutableRefObject<HTMLInputElement | null>;
  busy: boolean;
  onSaveKey: () => void;
  onDeleteKey: (p: string) => void;
  checkMsg: { tone: "wait" | "ok" | "err"; text: string; hint?: string } | null;
  onCheck: () => void;
  onCustomSaved: () => void;
  /** 直接进入可填写和测试的联网设置。 */
  onOpenSearch: () => void;
}): React.JSX.Element {
  const provider = props.settings?.provider ?? "—";
  const statusParts = providerStatusParts(props.status);
  // 换选中的供应商即清空 key 输入框：输入框里残留的是**上一个通道**的半截输入，留着必出错。
  useEffect(() => {
    if (props.keyInputRef.current !== null) props.keyInputRef.current.value = "";
  }, [props.keyProvider, props.keyInputRef]);
  // 自定义供应商的选中态：点列表里的自定义行 = 在右详情**就地编辑**（表单预填，同名覆盖）。
  const [customSelId, setCustomSelId] = useState<string | null>(null);
  const customs = props.providers.filter((p) => p.custom);
  const activeCustom = customSelId !== null && customs.some((p) => p.id === customSelId) ? customSelId : null;
  // 新增模式：点「添加供应商」= 详情里出一张空白自定义表单（原独立卡合并进详情，2026-10-24 业主）。
  const [addMode, setAddMode] = useState(false);
  // 已装自定义供应商的预填数据（编辑表单的回填源；不含 key 明文）。
  const [customEntries, setCustomEntries] = useState<readonly { id: string; label: string; protocol: string; baseURL: string; apiKeyEnv: string; modelIds: readonly string[] }[]>([]);
  useEffect(() => {
    if (activeCustom === null && !addMode) return;
    void window.agent.providerCustomList().then((r) => { if (r.ok) setCustomEntries(r.entries); }).catch(() => undefined);
  }, [activeCustom, addMode, props.onCustomSaved]);
  const editingEntry = activeCustom !== null ? customEntries.find((e) => e.id === activeCustom) ?? null : null;
  return (
    <>
      {/* 摘要进分区头（第 892 页）：分区名已经写着「当前通道与密钥」，下面第一行又贴一次
          「当前通道」⇒ 同一屏两处同词，而那一行的全部内容就是一枚值 + 六个字。
          现在值与生效时机挂在分区标题右侧，读到的顺序不变（先结论、再列表/表单）。 */}
      <SettingsSection title="当前通道与密钥" hint={<><span className="sp-tag">{provider}</span>下次发送生效</>}>
        {/* 供应商管理（2026-10-24 参照 Codex 供应商页）：左列表（状态点=已存 key）选通道，
            右侧详情 = 该通道的密钥表单（标签在上、字段整行）。换选中即清空 key 输入框。 */}
        <div className="pv-split">
          <div className="pv-list" role="tablist" aria-label="供应商">
            {(props.providers.filter((p) => !p.custom && providerNeedsKey(p.id))).map((p) => (
              <button
                key={p.id}
                className={"pv-item" + (activeCustom === null && props.keyProvider === p.id ? " on" : "")}
                role="tab"
                aria-selected={activeCustom === null && props.keyProvider === p.id}
                onClick={() => { setCustomSelId(null); setAddMode(false); props.onKeyProviderChange(p.id); }}
              >
                <StatusDot tone={props.status.stored.includes(p.id) ? "ok" : "off"} />
                <span className="pv-item-name">{PROVIDER_LABELS[p.id] ?? p.label}</span>
                {props.settings?.provider === p.id && <span className="sp-tag">当前</span>}
              </button>
            ))}
            {customs.length > 0 && <div className="pv-list-label">自定义</div>}
            {customs.map((p) => (
              <button
                key={p.id}
                className={"pv-item" + (activeCustom === p.id ? " on" : "")}
                role="tab"
                aria-selected={activeCustom === p.id}
                onClick={() => { setAddMode(false); setCustomSelId(p.id); }}
              >
                <StatusDot tone={props.status.stored.includes(p.id) ? "ok" : "off"} />
                <span className="pv-item-name">{p.label}</span>
                {props.settings?.provider === p.id && <span className="sp-tag">当前</span>}
              </button>
            ))}
            <button
              className={"pv-add" + (addMode ? " on" : "")}
              aria-pressed={addMode}
              onClick={() => { setCustomSelId(null); setAddMode(true); }}
            >
              <Plus size={12} aria-hidden="true" />
              <span>添加供应商</span>
            </button>
          </div>
          <div className="pv-detail">
            {activeCustom !== null ? (
              <>
                <div className="pv-detail-head">
                  <span className="pv-detail-name">{customs.find((p) => p.id === activeCustom)?.label ?? activeCustom}</span>
                </div>
                {/* 就地编辑：表单预填已存配置，保存按同名覆盖（2026-10-24 业主：两块合并）。
                    key = 编辑/新增分支各持独立实例——条件链同位复用会把上一家的预填带进新增表单。 */}
                {editingEntry === null ? (
                  <div className="ap-empty">正在读取配置…</div>
                ) : (
                  <CustomProviderForm key={`edit-${activeCustom}`} editing={editingEntry} onSaved={() => { props.onCustomSaved(); }} />
                )}
              </>
            ) : addMode ? (
              <>
                <div className="pv-detail-head">
                  <span className="pv-detail-name">添加供应商</span>
                </div>
                <CustomProviderForm key="add" onSaved={() => { setAddMode(false); props.onCustomSaved(); }} />
              </>
            ) : (
              <>
                <div className="pv-detail-head">
                  <span className="pv-detail-name">{PROVIDER_LABELS[props.keyProvider] ?? props.keyProvider}</span>
                  <button
                    type="button"
                    className="mini-btn"
                    disabled={props.checkMsg?.tone === "wait"}
                    title={`向 ${props.keyProvider} 拉一次模型清单（不消耗模型额度）`}
                    onClick={props.onCheck}
                  >
                    检查连接
                  </button>
                </div>
                {/* key 只进系统钥匙串，不落明文文件。 */}
                <div className="ss-field-block">
                  <label className="ss-flabel" htmlFor="provider-api-key">API Key</label>
                  <div className="ss-frow">
                    <Field width="full">
                      <input id="provider-api-key" ref={props.keyInputRef} type="password" aria-label="API key" placeholder="粘贴 API Key" />
                    </Field>
                    <button className="mini-btn primary" disabled={props.busy} onClick={props.onSaveKey}>
                      {props.busy ? "保存中…" : "保存到钥匙串"}
                    </button>
                  </div>
                </div>
                <div className="ss-key-status">
                  {statusParts.stored.filter((p) => p === props.keyProvider).map((p) => (
                    <Badge key={p} onRemove={() => props.onDeleteKey(p)} removeLabel={`删除 ${p} 的 key`}>{p}</Badge>
                  ))}
                  {statusParts.line !== "" && (
                    <span className={"ss-hint" + (statusParts.tone === "warn" ? " err" : "")}>{props.status.available ? statusParts.line : "安全存储不可用，无法保存密钥。密钥不会写入明文文件。"}</span>
                  )}
                  {statusParts.envHint !== null && <span className="ss-hint tip">{statusParts.envHint}</span>}
                </div>
                {props.checkMsg !== null && (
                  <div className={`sp-note ${props.checkMsg.tone === "ok" ? "ok" : props.checkMsg.tone === "err" ? "err" : ""}`} role="status">
                    {props.checkMsg.text}
                    {props.checkMsg.hint !== undefined && <div className="sp-dim">{props.checkMsg.hint}</div>}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="能力">
        <SettingsRow label="联网搜索">
          <div className="ss-search">
            <StatusDot tone={props.cap?.search.kind === "ok" ? "ok" : "off"} />
            <span className="ss-search-line">{props.cap === null ? "正在读取配置…" : props.cap.search.kind === "ok" ? "已配置联网搜索" : "尚未配置可用的搜索服务"}</span>
            <button type="button" className="mini-btn" onClick={props.onOpenSearch}>配置联网搜索</button>
          </div>
        </SettingsRow>
        {/* 识图能力（第 886 页改语法，不改口径）：三态原先是三种右列——一个「—」、
            一整条页面级 Banner、一句 desc 加一枚把句首词重复一遍的「已声明/未验证」药丸
            ⇒ 同一个「能力」分区里两行各说各的话。现在与上一行同一语法：
            状态点 + 状态句；未声明/未验证仍**可扫读**（琥珀点 + 风险墨），
            那句「调用成功 ≠ 看得懂」的原文一字未动。 */}
        <SettingsRow label="识图能力">
          <div className="ss-search">
            <StatusDot tone={props.cap === null ? "off" : props.cap.vision.state === "declared" ? "ok" : props.cap.vision.state === "undeclared" ? "warn" : "off"} />
            <span className="ss-search-line" data-warn={props.cap !== null && props.cap.vision.state !== "declared" ? "true" : undefined}>
              {props.cap === null ? "正在读取模型能力…" : visionCapabilityLabel(props.cap)}
            </span>
          </div>
        </SettingsRow>
      </SettingsSection>
    </>
  );
}

// ── 权限与安全段 ─────────────────────────────────────────────────────────

export const MODE_OPTIONS: readonly { id: PermissionMode; label: string; desc: string; warn?: string }[] = [
  { id: "read-only", label: "只读", desc: "写工具一律拒" },
  { id: "default", label: "默认 · 逐次审批", desc: "每次写 / 跑都出卡" },
  { id: "guided", label: "引导 · 按风险放行", desc: "低风险自动、高风险出卡" },
  // 与 PermissionMenu 的 MODE_LABEL 同一口径：auto 免的是"逐笔问写"，不是"什么都不问"
  // （riskAskAt 仍是 high）。旧文案「全部放行」让用户以为切了就万事大吉，
  // 而沙箱降级时写向仍会出卡 ⇒ 实测读成"切换没用"。
  { id: "auto", label: "自动 · 低风险免批", desc: "高风险动作仍会出卡", warn: "不设逐笔防线——确认后果再开。" },
  // 第五档（2026-10-24 业主）：最松档。设置页此前只列四档 ⇒ 用芯片切到 full-access 后，
  // 这里四个单选项全不选中，且用户从设置页永远选不到它（2026-10-30 实测）。
  { id: "full-access", label: "完全允许 · 不再出卡", desc: "出网仍一次性批准；方案门与禁止规则仍生效", warn: "最松档——风险线与 critical 也不再询问。确认你在受信任的仓库里。" },
];

export function PermissionsSection(props: {
  settings: AppSettings;
  onSave: (patch: Record<string, unknown>) => void;
}): React.JSX.Element {
  const [confirmMode, setConfirmMode] = useState<PermissionMode | null>(null);
  const requestMode = (id: PermissionMode): void => {
    if ((id === "auto" || id === "full-access") && props.settings.mode !== id) {
      setConfirmMode(id);
      return;
    }
    props.onSave({ mode: id });
  };
  const confirmCopy = confirmMode === null ? null : permissionConfirmCopy(confirmMode);
  return (
    <>
      <SettingsSection title="权限档" hint="下一轮派活生效">
        <div className="ss-opt-list" role="radiogroup" aria-label="权限档">
          {MODE_OPTIONS.map((m) => (
            <OptionCard
              key={m.id}
              checked={props.settings.mode === m.id}
              title={m.label}
              desc={m.desc}
              {...(m.warn !== undefined ? { danger: true, warn: m.warn } : {})}
              onSelect={() => { requestMode(m.id); }}
            />
          ))}
        </div>
      </SettingsSection>
      {confirmMode !== null && confirmCopy !== null && (
        <ConfirmDialog
          title={confirmCopy.title}
          note={confirmCopy.desc}
          confirmLabel="确认切换"
          danger
          onClose={() => { setConfirmMode(null); }}
          onConfirm={() => { const m = confirmMode; setConfirmMode(null); props.onSave({ mode: m }); }}
        />
      )}

      <SettingsSection title="安全">
        <SettingsRow label="写文件前先提交方案，等我批准" desc="输入框旁的「方案」开关可按轮覆盖。">
          <Switch
            label="写文件前先提交方案，等我批准"
            checked={props.settings.planRequiredByDefault}
            onChange={(next) => props.onSave({ planRequiredByDefault: next })}
            onText="开"
            offText="关"
          />
        </SettingsRow>
        <SettingsRow label="网络" desc="出网需要逐次审批（一次性，不记忆）；沙箱在 macOS 走 Seatbelt。">
          <span className="sp-tag">默认断网</span>
        </SettingsRow>
      </SettingsSection>
    </>
  );
}

// ── 高级段（2026-10-18：把一直在生效、却没有开关的字段摆出来）──────────────

/** 花费闸的两个数字字段：0 = 关（与 settings.ts 的缺省口径逐字一致）。
 *  校验放在这里而不是只靠后端：后端对非法值静默回退默认，界面必须先拦住并说清，
 *  否则用户输入 1e9 看到「已保存」实际存的是 0——「视图说成功、事实没发生」。 */
export function parseBudgetField(raw: string, max: number): { ok: true; value: number } | { ok: false; error: string } {
  const t = raw.trim();
  if (t === "") return { ok: true, value: 0 }; // 空 = 0 = 关（与缺省同义）
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return { ok: false, error: "要填一个不小于 0 的数字" };
  if (n > max) return { ok: false, error: `上限是 ${String(max)}` };
  return { ok: true, value: n };
}

/** 定时并发上限（1-8 的整数）：后端对非法值静默回退 2，界面必须先拦——否则用户改 0/12
 *  看到「已保存」，实际跑的是 2。与花费闸同一个理由：视图不许说成功而事实没发生。 */
export function parseCapField(raw: string): { ok: true; value: number } | { ok: false; error: string } {
  const t = raw.trim();
  const n = Number(t);
  if (t === "" || !Number.isInteger(n) || n < 1 || n > 8) return { ok: false, error: "要填 1-8 的整数" };
  return { ok: true, value: n };
}

export function AdvancedSection(props: {
  settings: AppSettings;
  /** 单键直写（不走 panelPatch 白名单——那份白名单与其判卷口径保持原样；
   *  与 saveCtrlTab 同一条路：window.agent.setSettings({ [key]: value })）。 */
  onSaveKey: (key: string, value: boolean | number) => void;
}): React.JSX.Element {
  const [budgetErr, setBudgetErr] = useState<string | null>(null);
  const [priceErr, setPriceErr] = useState<string | null>(null);
  const [capErr, setCapErr] = useState<string | null>(null);
  const s = props.settings;
  return (
    <>
      <SettingsSection title={STR.advanced.memoryTitle}>
        <SettingsRow label={STR.advanced.autoMemory} desc={STR.advanced.autoMemoryDesc}>
          <Switch
            label={STR.advanced.autoMemory}
            checked={s.autoMemory}
            onChange={(next) => props.onSaveKey("autoMemory", next)}
            onText="开"
            offText="关"
          />
        </SettingsRow>
        <SettingsRow label={STR.advanced.impactAnalysis} desc={STR.advanced.impactAnalysisDesc}>
          <Switch
            label={STR.advanced.impactAnalysis}
            checked={s.impactAnalysis}
            onChange={(next) => props.onSaveKey("impactAnalysis", next)}
            onText="开"
            offText="关"
          />
        </SettingsRow>
        <SettingsRow label={STR.advanced.promptCache} desc={STR.advanced.promptCacheDesc}>
          <Switch
            label={STR.advanced.promptCache}
            checked={s.promptCache}
            onChange={(next) => props.onSaveKey("promptCache", next)}
            onText="开"
            offText="关"
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={STR.advanced.budgetTitle}>
        <SettingsRow label={STR.advanced.maxBudgetUsd} desc={STR.advanced.maxBudgetUsdDesc}>
          <div className="ss-inline">
            <Field width="sm">
              <input
                aria-label={STR.advanced.maxBudgetUsd}
                defaultValue={String(s.maxBudgetUsd)}
                inputMode="decimal"
                onKeyDown={(e) => { if (e.key === "Enter" && !isCompositionEnter(e, null)) { e.preventDefault(); e.currentTarget.blur(); } }}
                onBlur={(e) => {
                  const r = parseBudgetField(e.target.value, 10000);
                  if (!r.ok) { setBudgetErr(r.error); return; }
                  setBudgetErr(null);
                  if (r.value !== s.maxBudgetUsd) props.onSaveKey("maxBudgetUsd", r.value);
                }}
              />
            </Field>
            {budgetErr !== null && <span className="ss-err">{budgetErr}</span>}
          </div>
        </SettingsRow>
        <SettingsRow label={STR.advanced.budgetPrice} desc={STR.advanced.budgetPriceDesc}>
          <div className="ss-inline">
            <Field width="sm">
              <input
                aria-label={STR.advanced.budgetPrice}
                defaultValue={String(s.budgetPricePerMTok)}
                inputMode="decimal"
                onKeyDown={(e) => { if (e.key === "Enter" && !isCompositionEnter(e, null)) { e.preventDefault(); e.currentTarget.blur(); } }}
                onBlur={(e) => {
                  const r = parseBudgetField(e.target.value, 10000);
                  if (!r.ok) { setPriceErr(r.error); return; }
                  setPriceErr(null);
                  if (r.value !== s.budgetPricePerMTok) props.onSaveKey("budgetPricePerMTok", r.value);
                }}
              />
            </Field>
            {priceErr !== null && <span className="ss-err">{priceErr}</span>}
          </div>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={STR.advanced.privacyTitle}>
        <SettingsRow label={STR.advanced.telemetry} desc={STR.advanced.telemetryDesc}>
          <Switch
            label={STR.advanced.telemetry}
            checked={s.telemetry}
            onChange={(next) => props.onSaveKey("telemetry", next)}
            onText="开"
            offText="关"
          />
        </SettingsRow>
      </SettingsSection>

      {/* 2026-10-30 补账：这三个开关一直在生效却没有入口——子代理工具决定模型看不看得见三把工具，
          收束闸/返修直接改花钱与交付质量。默认值与 settings.ts 同源（不另抄）。 */}
      <SettingsSection title={STR.advanced.verifyTitle}>
        <SettingsRow label={STR.advanced.subagentTools} desc={STR.advanced.subagentToolsDesc}>
          <Switch
            label={STR.advanced.subagentTools}
            checked={s.subagentTools}
            onChange={(next) => props.onSaveKey("subagentTools", next)}
            onText="开"
            offText="关"
          />
        </SettingsRow>
        <SettingsRow label={STR.advanced.autoVerify} desc={STR.advanced.autoVerifyDesc}>
          <Switch
            label={STR.advanced.autoVerify}
            checked={s.autoVerify}
            onChange={(next) => props.onSaveKey("autoVerify", next)}
            onText="开"
            offText="关"
          />
        </SettingsRow>
        <SettingsRow label={STR.advanced.autoVerifyRepair} desc={STR.advanced.autoVerifyRepairDesc}>
          <Switch
            label={STR.advanced.autoVerifyRepair}
            checked={s.autoVerifyRepair}
            onChange={(next) => props.onSaveKey("autoVerifyRepair", next)}
            onText="开"
            offText="关"
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={STR.advanced.scheduleTitle}>
        <SettingsRow label={STR.advanced.scheduleCap} desc={STR.advanced.scheduleCapDesc}>
          <div className="ss-inline">
            <Field width="sm">
              <input
                aria-label={STR.advanced.scheduleCap}
                defaultValue={String(s.scheduleConcurrencyCap)}
                inputMode="numeric"
                onKeyDown={(e) => { if (e.key === "Enter" && !isCompositionEnter(e, null)) { e.preventDefault(); e.currentTarget.blur(); } }}
                onBlur={(e) => {
                  const r = parseCapField(e.target.value);
                  if (!r.ok) { setCapErr(r.error); return; }
                  setCapErr(null);
                  if (r.value !== s.scheduleConcurrencyCap) props.onSaveKey("scheduleConcurrencyCap", r.value);
                }}
              />
            </Field>
            {capErr !== null && <span className="ss-err">{capErr}</span>}
          </div>
        </SettingsRow>
      </SettingsSection>
    </>
  );
}

// ── 设置文件首读失败横幅（v26）─────────────────────────────────────────

/** 文件坏了不许静默用缺省：说清哪份文件、什么原因、怎么修。
 *  缺省（undefined / null）= 没有文件或读得动，不摆横幅（缺席 ≠ 失败）。
 *  不给「重新检查」按钮：主进程的设置缓存与首读结论都驻留在进程里，改盘后要重启才生效——
 *  摆一个点了没反应的按钮，比不摆更坏。 */
export function SettingsIssueBanner(props: {
  issue: { kind: string; message: string; path: string } | null | undefined;
  /** 真重读盘（设置页传 `window.agent.reloadSettings`）；缺省不摆按钮（SSR / 旧调用面零行为）。 */
  onReload?: () => void;
  reloading?: boolean;
}): React.JSX.Element | null {
  if (props.issue === null || props.issue === undefined) return null;
  return (
    <Banner
      tone="warn"
      icon={<TriangleAlert size={13} />}
      details={
        <>
          <p>{props.issue.path}</p>
          <p>{props.issue.message}</p>
        </>
      }
    >
      {props.onReload === undefined
        ? "设置文件未生效：当前按缺省设置运行。修好或删除它，再重新打开 Cairn。"
        : "设置文件未生效：当前按缺省设置运行。修好或删除它，然后点「重新读取」。"}
      {props.onReload !== undefined && (
        <button
          type="button"
          className="mini-btn ss-banner-action"
          disabled={props.reloading === true}
          onClick={props.onReload}
        >
          {props.reloading === true ? "正在读取…" : "重新读取"}
        </button>
      )}
    </Banner>
  );
}

// ── 关于与更新段 ─────────────────────────────────────────────────────────

/** 许可证状态 → 一行给人看的话（四态全显式；不把「没校验」说成「有效」）。 */
/** 只把 ISO 日期截到日：签发的 expires_at 常带 T00:00:00Z，原样显示又长又像调试串。 */
function licenseDate(iso: string): string {
  const m = /^\d{4}-\d{2}-\d{2}/.exec(iso);
  return m === null ? iso : m[0];
}

export function licenseLabel(state: LicenseState | null | undefined): string {
  if (state === null || state === undefined) return "未读取";
  switch (state.state) {
    case "valid": return state.expiresAt === null ? "有效 · " + state.licensee : "有效 · " + state.licensee + " · 至 " + licenseDate(state.expiresAt);
    case "expired": return "已过期 · " + state.licensee;
    case "invalid": return "无效 · " + state.reason;
    case "inactive": return "未激活";
  }
}

/** 到期摘要：30 天内才提醒；过期/当天/未来 N 天各一句。`now` 注入便于判卷不赌时钟。 */
export function licenseExpiryHint(state: LicenseState | null | undefined, now: number = Date.now()): string | null {
  if (state === null || state === undefined) return null;
  if (state.state === "expired") return `已于 ${licenseDate(state.expiresAt)} 过期`;
  if (state.state !== "valid" || state.expiresAt === null) return null;
  const at = Date.parse(state.expiresAt);
  if (Number.isNaN(at)) return null;
  const days = Math.ceil((at - now) / (24 * 60 * 60 * 1000));
  if (days < 0) return `已于 ${licenseDate(state.expiresAt)} 过期`;
  if (days === 0) return "今天到期";
  if (days <= 30) return `还有 ${String(days)} 天到期`;
  return null;
}

/** 诊断结果的行渲染：失败的、且应用里能改的项做成按钮，点了跳到对应设置分区；
 *  其余（Node / 工作区 / 设置文件 / 会话数据）保持只读行——不摆「点了没反应」的入口。 */
export function DoctorResultView(props: {
  rows: readonly DoctorRow[];
  onOpenSection?: (section: SectionId) => void;
}): React.JSX.Element {
  return (
    <>
      {props.rows.map((row) => {
        const target = row.ok ? undefined : doctorTarget(row.id);
        const body = (
          <>
            <span className="ss-doctor-mark" aria-hidden="true">{row.ok ? "✓" : "✗"}</span>
            <span className="ss-doctor-label">{row.label}</span>
            <span className="ss-doctor-detail">{row.detail}{row.hint !== undefined ? `（${row.hint}）` : ""}</span>
          </>
        );
        return target !== undefined && props.onOpenSection !== undefined ? (
          <button
            key={row.id}
            type="button"
            data-doctor-id={row.id}
            className={"ss-doctor-row ss-doctor-row-action " + (row.ok ? "ok" : "bad")}
            aria-label={`${row.label}：到设置里处理`}
            title="到设置里处理这一项"
            onClick={() => { props.onOpenSection?.(target); }}
          >
            {body}
            <ChevronRight size={13} className="ss-doctor-go" aria-hidden="true" />
          </button>
        ) : (
          <div key={row.id} data-doctor-id={row.id} className={"ss-doctor-row " + (row.ok ? "ok" : "bad")}>
            {body}
          </div>
        );
      })}
    </>
  );
}

type DoctorState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; report: DoctorReport; keys: DoctorKeyStatus | null };

export function AboutSection(props: {
  version: string | null;
  updateMsg: string | null;
  onCheckUpdate: () => void;
  /** 更新源地址（settings.updateManifestUrl）；空 = 未配置。 */
  updateManifestUrl?: string;
  /** 单键直写更新源（不走 panelPatch 白名单）。 */
  onSaveManifest?: (url: string) => void;
  /** 工程细节（术语收容所）；缺省用 DIAGNOSTICS_TEXT。 */
  diagnostics?: string;
  /** 许可证状态（getState().license；缺省 undefined 显示「未读取」而不是「未激活」）。 */
  license?: LicenseState | null;
  /** 诊断失败项的落点：切到对应设置分区（缺省 = 不给按钮，保持只读）。 */
  onOpenSection?: (section: SectionId) => void;
  /** 导入许可证成功后回灌状态（缺省 = 只显示本次导入结果，不更新上方标签）。 */
  onLicenseChanged?: (state: LicenseState) => void;
  /** 导入偏好成功后回灌整份设置（缺省 = 只显示回执，不刷新面板）。 */
  onPreferencesImported?: (settings: AppSettings) => void;
  /** 包内 build-info.json；开发态/旧包为 null（版本行只显示版本号）。 */
  build?: BuildInfo | null;
}): React.JSX.Element {
  // v34「运行诊断」：按钮点下去才跑（会做一次沙箱自检，不在面板打开时偷偷跑）。
  const [doctor, setDoctor] = useState<DoctorState>({ status: "idle" });
  /** 「复制报告」的回执：null = 还没点过/已重新诊断；成功与失败都给一句，不静默。 */
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  /** 许可证导入的三态：idle / importing / 一句话回执。 */
  const [licenseBusy, setLicenseBusy] = useState(false);
  const [licenseMsg, setLicenseMsg] = useState<string | null>(null);
  /** 「导出诊断包」的忙碌/回执：文件落盘成功要给路径，取消不报错。 */
  const [exportBusy, setExportBusy] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  /** 偏好备份的忙碌/回执：导入会覆盖当前偏好，成功/失败都要有回执。 */
  const [prefBusy, setPrefBusy] = useState(false);
  const [prefMsg, setPrefMsg] = useState<string | null>(null);
  const exportPreferences = async (): Promise<void> => {
    setPrefBusy(true);
    setPrefMsg(null);
    try {
      const r = await window.agent.exportPreferences();
      if (r.canceled === true) { setPrefMsg("已取消导出"); return; }
      if (r.ok && r.path !== undefined) { setPrefMsg(`已保存：${r.path}`); return; }
      setPrefMsg(`导出失败：${r.error ?? "未知原因"}`);
    } catch (err) {
      setPrefMsg(`导出失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPrefBusy(false);
    }
  };
  const [pendingImport, setPendingImport] = useState<{ patch: Record<string, unknown>; ignored: string[] } | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const importPreferences = async (): Promise<void> => {
    setPrefBusy(true);
    setPrefMsg(null);
    try {
      const r = await window.agent.importPreferences();
      if (r.canceled === true) { setPrefMsg("已取消导入"); return; }
      if (!r.ok || r.patch === undefined) { setPrefMsg(`导入失败：${r.error ?? "备份不合格"}`); return; }
      // 先预览、后应用：导入是覆盖写，不能让用户在没看见改了哪几项时就落盘。
      setPendingImport({ patch: r.patch as Record<string, unknown>, ignored: r.ignored ?? [] });
    } catch (err) {
      setPrefMsg(`导入失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPrefBusy(false);
    }
  };
  const applyPendingImport = async (): Promise<void> => {
    if (pendingImport === null) return;
    setPrefBusy(true);
    try {
      const next = await window.agent.setSettings(pendingImport.patch);
      props.onPreferencesImported?.(next);
      const count = Object.keys(pendingImport.patch).length;
      const ignored = pendingImport.ignored.length > 0 ? `；忽略 ${pendingImport.ignored.length} 项不认识的设置` : "";
      setPrefMsg(`已导入 ${count} 项偏好${ignored}`);
      setPendingImport(null);
    } catch (err) {
      setPrefMsg(`导入失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPrefBusy(false);
    }
  };
  const resetPreferences = async (): Promise<void> => {
    setPrefBusy(true);
    try {
      const next = await window.agent.resetPreferences();
      props.onPreferencesImported?.(next);
      setPrefMsg("已恢复默认偏好");
      setResetOpen(false);
    } catch (err) {
      setPrefMsg(`恢复失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPrefBusy(false);
    }
  };
  const exportDiagnostics = async (): Promise<void> => {
    if (doctor.status !== "ready") return;
    setExportBusy(true);
    setExportMsg(null);
    try {
      const text = doctorReportText({
        version: props.version,
        generatedAt: new Date().toISOString(),
        verdict: doctorVerdictText(doctor.report, doctorRowsView),
        rows: doctorRowsView,
      });
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
      const r = await window.agent.exportDiagnostics(text, `Cairn-diagnostics-${stamp}.md`);
      if (r.canceled === true) { setExportMsg("已取消导出"); return; }
      if (r.ok && r.path !== undefined) { setExportMsg(`已保存：${r.path}`); return; }
      setExportMsg(`导出失败：${r.error ?? "未知原因"}`);
    } catch (err) {
      setExportMsg(`导出失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExportBusy(false);
    }
  };
  const importLicense = async (): Promise<void> => {
    setLicenseBusy(true);
    setLicenseMsg(null);
    try {
      const r = await window.agent.importLicense();
      if ("canceled" in r && r.canceled === true) { setLicenseMsg("已取消导入"); return; }
      if (r.ok && r.state.state === "valid") {
        props.onLicenseChanged?.(r.state);
        setLicenseMsg(`许可证已导入：${r.state.licensee}`);
        return;
      }
      if (r.ok && r.state.state === "expired") {
        props.onLicenseChanged?.(r.state);
        setLicenseMsg(`许可证已导入，但已过期：${r.state.licensee}`);
        return;
      }
      setLicenseMsg(`导入失败：${r.error ?? "签名或文件不合格"}`);
    } catch (err) {
      setLicenseMsg(`导入失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLicenseBusy(false);
    }
  };
  const runDoctor = async () => {
    setCopyMsg(null);
    setDoctor({ status: "loading" });
    try {
      const [report, keys] = await Promise.all([
        window.agent.doctor(),
        window.agent.providerKeyStatus().catch(() => null),
      ]);
      if (!report.ok) { setDoctor({ status: "error", error: report.error }); return; }
      setDoctor({ status: "ready", report: report.report, keys });
    } catch (err) {
      setDoctor({ status: "error", error: err instanceof Error ? err.message : String(err) });
    }
  };
  const doctorRowsView = doctor.status === "ready" ? doctorRows(doctor.report, doctor.keys) : [];
  return (
    <SettingsSection title="版本与更新">
      <SettingsRow label="版本">
        <div className="ss-inline">
          <span className="sp-tag">{props.version ?? "—"}</span>
          {props.build !== undefined && props.build !== null && (
            <span className="sp-dim" role="status">
              构建于 {props.build.createdAt.slice(0, 10)} · {props.build.signature} · 冒烟 {props.build.packagedSmoke === "passed" ? "已过" : props.build.packagedSmoke}
              {props.build.sourceCommit !== undefined && <> · {props.build.sourceCommit.slice(0, 8)}{props.build.sourceDirty ? "（含未提交修改）" : ""}</>}
            </span>
          )}
        </div>
      </SettingsRow>
      <SettingsRow label="许可证" desc="导入发行方签发的 license.json；验签通过才会覆盖现有文件。">
        <div className="ss-inline">
          <span className="sp-tag">{licenseLabel(props.license)}</span>
          {licenseExpiryHint(props.license) !== null && <span className="sp-dim" role="status">{licenseExpiryHint(props.license)}</span>}
          <button type="button" className="mini-btn ghost" disabled={licenseBusy} onClick={() => { void importLicense(); }}>
            {licenseBusy ? "导入中…" : "导入许可证…"}
          </button>
          {licenseMsg !== null && <span className="sp-dim" role="status">{licenseMsg}</span>}
        </div>
      </SettingsRow>
      <SettingsRow label="更新">
        <button className="mini-btn ghost" onClick={props.onCheckUpdate}>检查更新</button>
        {props.updateMsg !== null && <span className="sp-dim">{props.updateMsg}</span>}
      </SettingsRow>
      {/* 更新源（2026-10-18 补）：此前这个字段只能改 settings.json，界面上是死胡同——
          「未配置更新源」永远消不掉，用户没有任何地方可以填。字段本身一直在 settings 里
          （settings.ts updateManifestUrl），缺的只是一个入口。 */}
      {props.onSaveManifest !== undefined && (
        <SettingsRow label={STR.update.manifestLabel} desc={STR.update.manifestDesc}>
          <div className="ss-inline">
            <Field width="full">
              <input
                aria-label={STR.update.manifestLabel}
                defaultValue={props.updateManifestUrl ?? ""}
                placeholder={STR.update.manifestPlaceholder}
                onKeyDown={(e) => { if (e.key === "Enter" && !isCompositionEnter(e, null)) { e.preventDefault(); e.currentTarget.blur(); } }}
                onBlur={(e) => {
                  const next = e.target.value.trim();
                  if (next !== (props.updateManifestUrl ?? "")) props.onSaveManifest?.(next);
                }}
              />
            </Field>
            {(props.updateManifestUrl ?? "") === "" && <span className="sp-dim">{STR.update.manifestEmpty}</span>}
          </div>
        </SettingsRow>
      )}
      <SettingsRow label="偏好备份" desc="只含主题、字号、权限档、预算与开关；模型、项目路径、会话不进备份。">
        <div className="ss-inline">
          <button type="button" className="mini-btn" disabled={prefBusy} onClick={() => { void exportPreferences(); }}>
            导出偏好…
          </button>
          <button type="button" className="mini-btn ghost" disabled={prefBusy} onClick={() => { void importPreferences(); }}>
            导入偏好…
          </button>
          <button type="button" className="mini-btn ghost" disabled={prefBusy} onClick={() => { setResetOpen(true); }}>
            恢复默认…
          </button>
          {prefMsg !== null && <span className="sp-dim" role="status">{prefMsg}</span>}
        </div>
      </SettingsRow>
      <SettingsRow label="运行诊断" desc="检查 Node / 凭据 / 档位 / 沙箱 / 工作区 / 设置与会话数据 / 联网搜索 / 插件信任面。只读；会做一次沙箱自检。">
        <div className="ss-inline">
          <button type="button" className="mini-btn" disabled={doctor.status === "loading"} onClick={() => { void runDoctor(); }}>
            {doctor.status === "loading" ? "诊断中…" : "运行诊断"}
          </button>
          <button
            type="button"
            className="mini-btn ghost"
            disabled={doctor.status !== "ready"}
            title="把这份诊断报告复制到剪贴板，便于贴进问题反馈"
            onClick={() => {
              if (doctor.status !== "ready") return;
              if (typeof navigator === "undefined" || navigator.clipboard === undefined) {
                setCopyMsg("复制失败：剪贴板不可用");
                return;
              }
              const text = doctorReportText({
                version: props.version,
                generatedAt: new Date().toISOString(),
                verdict: doctorVerdictText(doctor.report, doctorRowsView),
                rows: doctorRowsView,
              });
              void navigator.clipboard.writeText(text).then(
                () => { setCopyMsg("已复制诊断报告"); },
                (err: unknown) => { setCopyMsg(`复制失败：${err instanceof Error ? err.message : String(err)}`); },
              );
            }}
          >
            复制报告
          </button>
          <button
            type="button"
            className="mini-btn ghost"
            disabled={doctor.status !== "ready" || exportBusy}
            title="导出诊断报告 + 主进程日志尾部（Markdown），便于附到问题反馈"
            onClick={() => { void exportDiagnostics(); }}
          >
            {exportBusy ? "导出中…" : "导出诊断包…"}
          </button>
          {copyMsg !== null && <span className="sp-dim" role="status">{copyMsg}</span>}
          {exportMsg !== null && <span className="sp-dim" role="status">{exportMsg}</span>}
        </div>
      </SettingsRow>
      {doctor.status === "error" && (
        <div className="ss-note err" role="alert">诊断失败：{doctor.error}</div>
      )}
      {doctor.status === "ready" && (
        <div className="ss-doctor" role="status" aria-label="诊断结果">
          <div className="ss-doctor-verdict">{doctorVerdictText(doctor.report, doctorRowsView)}</div>
          <DoctorResultView rows={doctorRowsView} onOpenSection={props.onOpenSection} />
        </div>
      )}
      <SettingsRow label="工程细节">
        <details className="ss-diag">
          <summary>展开</summary>
          <div className="ss-diag-body">{props.diagnostics ?? DIAGNOSTICS_TEXT}</div>
        </details>
      </SettingsRow>
      {pendingImport !== null && (
        <ConfirmDialog
          title="导入偏好？"
          note={`将覆盖 ${Object.keys(pendingImport.patch).length} 项：${Object.keys(pendingImport.patch).slice(0, 8).join("、")}${Object.keys(pendingImport.patch).length > 8 ? " 等" : ""}。模型、项目路径、会话与首启标记不会改变。`}
          confirmLabel="应用"
          onConfirm={() => { void applyPendingImport(); }}
          onClose={() => { setPendingImport(null); }}
        />
      )}
      {resetOpen && (
        <ConfirmDialog
          title="恢复默认偏好？"
          note="会把主题、字号、权限档、预算与开关恢复为默认；模型、项目路径、会话与首启标记不会改变。"
          confirmLabel="恢复默认"
          onConfirm={() => { void resetPreferences(); }}
          onClose={() => { setResetOpen(false); }}
        />
      )}
    </SettingsSection>
  );
}

// 段图标 re-export（设置壳导航消费；放这里避免壳与段各持一份）。

/** 快捷键（P3-3 · brief 九节）：核心表渲染自 SHORTCUTS（单一事实源——Sidebar/命令面板 tooltip 同源）；
 *  完整速查（含窗格/视图键）按 ⌘/ 弹层。 */
export function ShortcutsSection(): React.JSX.Element {
  return (
    <SettingsSection title="按键一览" hint="完整速查表按 ⌘/ 随时调出">
      <div className="kx-list">
        {SHORTCUTS.map((s) => (
          <div className="kx-row" key={s.id}>
            <kbd className="kx-keys">{s.keys}</kbd>
            <span className="kx-what">{s.label}</span>
          </div>
        ))}
      </div>
    </SettingsSection>
  );
}
