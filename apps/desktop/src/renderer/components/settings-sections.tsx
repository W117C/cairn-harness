// 设置页正文四段（批 6 · 总纲阶段 3-1/3-2 + 细则 §六）——SettingsPanel 只做壳，正文全在这里：
//   GeneralSection      外观（主题 3 选项卡带小预览图）/ 语言 / 快捷键（Ctrl+Tab）
//   ProviderSection     当前通道与密钥 / 联网搜索（状态点 + 一句话 + 去配置 + 查看详情折叠）/
//                       自定义接口 / 识图能力（2026-10-16 v12 导入诊断批补的第四卡）
//   PermissionsSection  四档 OptionCard（自动 = danger + 警示行）/ 方案门 / 网络只读行
//   AboutSection        版本 / 更新 / 诊断信息折叠区（术语收容所）
// 纯函数资产（panelPatch / providerStatusLabel(由 providerStatusParts 拼回) / searchCapabilityLabel /
// SEARCH_CONFIG_HINT / defaultKeyProvider / PANEL_PROVIDER_KINDS / providerNeedsKey）随迁至本文件——
// SettingsPanel 重导出保旧 import 面（settings-panel.test 判卷锚不动）。
// 2026-10-16（模型/通道页重做）：控件走 settings-ui 的 Field（36px/8px/四态）、徽章走 Badge、
// 状态走 StatusDot；旧 sp-key-row / sp-key-chip 一族随重做下架（判卷钉已同步改名点名）。
import { useRef, useState } from "react";
import type { MutableRefObject, ReactNode } from "react";
import { Copy, Image as ImageIcon } from "lucide-react";
import type { LicenseState } from "../../../../../src/main/license";
import type { AppSettings, PermissionMode } from "../../../../../src/main/ipc-protocol";
import type { TextSizeSetting, UiSizeSetting } from "../../../../../src/main/settings";
import { envKeyOf } from "../../../../../src/providers/env-keys";
import { Badge, Banner, Field, OptionCard, SettingsSection, SettingsRow, StatusDot } from "./settings-ui";
import { Switch } from "./Switch";
import { CustomProviderForm } from "./CustomProviderForm";
import { SHORTCUTS } from "../shortcuts";
import { STR } from "../strings";

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
export const PANEL_PROVIDER_KINDS: readonly string[] = ["demo", "glm", "openai", "anthropic", "gemini"];

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
    return `识图：${v.modelId ?? "当前模型"} 声明了图片输入模态（${v.declaredModalities.join("/")}）——这是配置声明，未经带凭据实测`;
  }
  if (v.state === "undeclared") {
    return `识图未声明：${v.modelId ?? "当前模型"} 没有图片输入模态声明——render_image 仍会把图发过去，但「调用成功」不等于上游看得懂`;
  }
  return "识图能力未验证：取不到当前选中的模型，不猜它支不支持图片输入";
}

/** 「关于与更新」诊断信息折叠区文案（术语收容所）：工程词集中在这里供对照，
 *  正文一律说人话（总纲阶段 3-3「去掉界面中所有内部术语」的收容侧）。 */
export const DIAGNOSTICS_TEXT =
  "调度器：serveScheduler 常驻；运行历史 = journal 投影；技能正文由 expandSkillInvocation 展开。" +
  "以上为工程术语，供排查时对照日志使用。";

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
}): React.JSX.Element {
  return (
    <>
      <SettingsSection title="外观" hint="主题偏好">
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
                <span className="theme-thumb" data-thumb={t.id} aria-hidden="true" />
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="窗口" hint="实验">
        <SettingsRow label="窗口材质" desc="macOS 侧栏半透明；默认关，改动需重启窗口。未做视觉验收前不建议开。">
          <Switch
            label="窗口材质"
            checked={props.settings.windowVibrancy === true}
            onChange={props.onWindowVibrancy}
            onText="开"
            offText="关"
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="语言">
        {/* 2026-10-17 真机发现：下拉能选 English、locale 也真的落库，但渲染层没有任何地方消费
            它——切了界面仍是中文，卡上「重启后全部生效」是假承诺。英文文案整包没接入之前，
            这里不摆可切换的空壳：静态写清「目前只有中文」。 */}
        <SettingsRow label="界面语言" desc="目前只有中文界面；英文界面尚未接入。">
          <span className="ss-static">中文（简体）</span>
        </SettingsRow>
      </SettingsSection>

      {/* 2026-10-18 字号档：tokens.css 的三档（html[data-text-size=sm|md|lg] → --rem-scale .92|1|1.08）
          与「每个字号 calc 都乘 --rem-scale」的写法**早就写好并在用**，缺的只是一个字段和一处赋值
          ——data-text-size 从来没被任何代码写过，三档是死代码，用户也无处调字号。
          现在接上：settings.textSize 单一持有，App 写 html 属性，CSS 消费。 */}
      <SettingsSection title="字号" hint="整界面文字一起缩放">
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
      </SettingsSection>

      {/* 2026-10-20 组件尺寸档（尺寸轴）：与上面的字号档正交——
          字号改文字、尺寸改控件高/圆角/间距。Claude 实测五档 data-step="1…5"。 */}
      <SettingsSection title="组件尺寸" hint="控件高 / 圆角 / 间距一起缩放，不影响文字大小">
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
                <span className="ts-thumb" data-ui={t.id} aria-hidden="true">▭</span>
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="快捷键">
        <SettingsRow label="Ctrl+Tab 切会话" desc="曾被误触？关掉它，只留 ⌘⇧[ / ⌘⇧] 循环会话。">
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

export function ProviderSection(props: {
  settings: AppSettings | null;
  status: { available: boolean; stored: string[]; envActive: boolean };
  /** 能力读数只消费 search/searchEndpoint 两格（结构子集，同 searchCapabilityLabel 的口径）。 */
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
  /** 复制配法（clipboard 访问留在壳层，本段纯展示）。 */
  onCopyHint: () => void;
}): React.JSX.Element {
  const provider = props.settings?.provider ?? "—";
  const statusParts = providerStatusParts(props.status);
  // 「去配置」= 展开详情折叠（含配法 + 复制片段）——原生 details 只被掰开，零新逻辑零新通道。
  const searchHelp = useRef<HTMLDetailsElement | null>(null);
  return (
    <>
      <SettingsSection title="当前通道与密钥">
        <SettingsRow label="当前通道" desc="模型与思考档位在输入框处切换（下一轮派活生效）。">
          <span className="sp-tag">{provider}</span>
        </SettingsRow>
        <SettingsRow label="当前通道密钥" desc="key 只进系统钥匙串，不落明文文件。">
          <div className="ss-ctl-row">
            <Field width="lg" select>
              <select
                aria-label="选择 provider"
                value={props.keyProvider}
                onChange={(e) => props.onKeyProviderChange(e.target.value)}
              >
                {PANEL_PROVIDER_KINDS.filter((k) => providerNeedsKey(k)).map((k) => (
                  <option key={k} value={k}>{k}{envKeyOf(k) !== null ? `（env：${envKeyOf(k) ?? ""}）` : ""}</option>
                ))}
              </select>
            </Field>
            {/* 第二行容器（ss-ctl-sub）：输入 + 按钮必须同行（总纲控件要求）；
                三者相加 685px > 控件列 634px，不加这条换行容器按钮会被挤到孤行。 */}
            <div className="ss-ctl-sub">
              <Field width="md">
                <input ref={props.keyInputRef} type="password" aria-label="API key" placeholder="粘贴 key（不落明文文件）" />
              </Field>
              <button className="mini-btn primary" disabled={props.busy} onClick={props.onSaveKey}>
                {props.busy ? "保存中…" : "保存到钥匙串"}
              </button>
            </div>
          </div>
          <div className="ss-key-status">
            {statusParts.stored.map((p) => (
              <Badge key={p} onRemove={() => props.onDeleteKey(p)} removeLabel={`删除 ${p} 的 key`}>{p}</Badge>
            ))}
            {statusParts.line !== "" && (
              <span className={"ss-hint" + (statusParts.tone === "warn" ? " err" : "")}>{statusParts.line}</span>
            )}
            {statusParts.envHint !== null && <span className="ss-hint tip">{statusParts.envHint}</span>}
          </div>
        </SettingsRow>
        {/* 检查连接放分组底部（总纲阶段 3-1「按钮放在分组底部，点击后行内显示成功/失败」）。 */}
        <SettingsRow label="连接检查">
          <button
            type="button"
            className="mini-btn"
            disabled={props.checkMsg?.tone === "wait"}
            title={`向 ${props.keyProvider} 拉一次模型清单（不消耗模型额度）`}
            onClick={props.onCheck}
          >
            检查连接
          </button>
          {props.checkMsg !== null && (
            <div className={`sp-note ${props.checkMsg.tone === "ok" ? "ok" : props.checkMsg.tone === "err" ? "err" : ""}`} role="status" style={{ width: "100%" }}>
              {props.checkMsg.text}
              {props.checkMsg.hint !== undefined && <div className="sp-dim">{props.checkMsg.hint}</div>}
            </div>
          )}
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="联网搜索">
        <SettingsRow label="状态">
          {props.cap === null ? (
            <div className="ss-search">
              <StatusDot tone="off" />
              <span className="ss-search-line">读不到能力读数（不当作「已配」）。</span>
            </div>
          ) : (
            <div className="ss-search">
              <StatusDot tone={props.cap.search.kind === "ok" ? "ok" : "warn"} />
              <span className="ss-search-line">{searchCapabilityLabel(props.cap)}</span>
              {props.cap.search.kind === "unset" && (
                <button
                  className="mini-btn primary"
                  onClick={() => { if (searchHelp.current !== null) searchHelp.current.open = true; }}
                >去配置</button>
              )}
              <details className="ss-help" ref={searchHelp}>
                <summary>查看详情</summary>
                <div className="ss-help-body">
                  <code>{SEARCH_CONFIG_HINT}</code>
                  <button type="button" className="mini-btn ghost" onClick={props.onCopyHint}><Copy size={11} />复制配置片段</button>
                </div>
              </details>
            </div>
          )}
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="自定义接口">
        <div className="cp-in-card">
          <CustomProviderForm onSaved={props.onCustomSaved} />
        </div>
      </SettingsSection>
      {/* 识图能力一行：把「图进了请求体」与「上游看得懂」分开。undeclared 时给 warn 条而不是
          弱化的一行——这一格实测被误读过（render_image 成功 ⇒ 认为模型看过并理解了）。 */}
      <SettingsSection title="识图能力">
        {props.cap === null ? (
          <SettingsRow label="状态" desc="读不到能力读数（不当作「已支持」）。">
            <span className="sp-dim">—</span>
          </SettingsRow>
        ) : props.cap.vision.state === "undeclared" ? (
          <SettingsRow label="状态">
            <Banner tone="warn" icon={<ImageIcon size={13} />}>
              {visionCapabilityLabel(props.cap)}
            </Banner>
          </SettingsRow>
        ) : (
          <SettingsRow label="状态" desc={visionCapabilityLabel(props.cap)}>
            <span className="sp-tag">{props.cap.vision.state === "declared" ? "已声明" : "未验证"}</span>
          </SettingsRow>
        )}
      </SettingsSection>
    </>
  );
}

// ── 权限与安全段 ─────────────────────────────────────────────────────────

const MODE_OPTIONS: readonly { id: PermissionMode; label: string; desc: string; warn?: string }[] = [
  { id: "read-only", label: "只读", desc: "写工具一律拒" },
  { id: "default", label: "默认 · 逐次审批", desc: "每次写 / 跑都出卡" },
  { id: "guided", label: "引导 · 按风险放行", desc: "低风险自动、高风险出卡" },
  // 与 PermissionMenu 的 MODE_LABEL 同一口径：auto 免的是"逐笔问写"，不是"什么都不问"
  // （riskAskAt 仍是 high）。旧文案「全部放行」让用户以为切了就万事大吉，
  // 而沙箱降级时写向仍会出卡 ⇒ 实测读成"切换没用"。
  { id: "auto", label: "自动 · 低风险免批", desc: "高风险动作仍会出卡", warn: "不设逐笔防线——确认后果再开。" },
];

export function PermissionsSection(props: {
  settings: AppSettings;
  onSave: (patch: Record<string, unknown>) => void;
}): React.JSX.Element {
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
              onSelect={() => props.onSave({ mode: m.id })}
            />
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title="安全">
        <SettingsRow label="写文件前先提交方案，等我批准">
          <Switch
            label="写文件前先提交方案，等我批准"
            checked={props.settings.planRequiredByDefault}
            onChange={(next) => props.onSave({ planRequiredByDefault: next })}
            onText="开"
            offText="关"
          />
        </SettingsRow>
        <SettingsRow label="网络">
          <span className="sp-dim">默认断网；出网 = 逐次审批（一次性，不记忆）。沙箱在 macOS 走 Seatbelt。</span>
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

export function AdvancedSection(props: {
  settings: AppSettings;
  /** 单键直写（不走 panelPatch 白名单——那份白名单与其判卷口径保持原样；
   *  与 saveCtrlTab 同一条路：window.agent.setSettings({ [key]: value })）。 */
  onSaveKey: (key: string, value: boolean | number) => void;
}): React.JSX.Element {
  const [budgetErr, setBudgetErr] = useState<string | null>(null);
  const [priceErr, setPriceErr] = useState<string | null>(null);
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
    </>
  );
}

// ── 关于与更新段 ─────────────────────────────────────────────────────────

/** 许可证状态 → 一行给人看的话（四态全显式；不把「没校验」说成「有效」）。 */
export function licenseLabel(state: LicenseState | null | undefined): string {
  if (state === null || state === undefined) return "未读取";
  switch (state.state) {
    case "valid": return state.expiresAt === null ? "有效 · " + state.licensee : "有效 · " + state.licensee + " · 至 " + state.expiresAt;
    case "expired": return "已过期 · " + state.licensee;
    case "invalid": return "无效 · " + state.reason;
    case "inactive": return "未激活";
  }
}

export function AboutSection(props: {
  version: string | null;
  updateMsg: string | null;
  onCheckUpdate: () => void;
  /** 更新源地址（settings.updateManifestUrl）；空 = 未配置。 */
  updateManifestUrl?: string;
  /** 单键直写更新源（不走 panelPatch 白名单）。 */
  onSaveManifest?: (url: string) => void;
  /** 诊断信息（术语收容所）；缺省用 DIAGNOSTICS_TEXT。 */
  diagnostics?: string;
  /** 许可证状态（getState().license；缺省 undefined 显示「未读取」而不是「未激活」）。 */
  license?: LicenseState | null;
}): React.JSX.Element {
  return (
    <SettingsSection title="关于与更新">
      <SettingsRow label="版本">
        <span className="sp-tag">{props.version ?? "—"}</span>
      </SettingsRow>
      <SettingsRow label="许可证">
        <span className="sp-tag">{licenseLabel(props.license)}</span>
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
      <SettingsRow label="诊断信息" desc="排查问题时对照日志使用的工程细节。">
        <details className="ss-diag">
          <summary>展开</summary>
          <div className="ss-diag-body">{props.diagnostics ?? DIAGNOSTICS_TEXT}</div>
        </details>
      </SettingsRow>
    </SettingsSection>
  );
}

// 段图标 re-export（设置壳导航消费；放这里避免壳与段各持一份）。

/** 快捷键（P3-3 · brief 九节）：核心表渲染自 SHORTCUTS（单一事实源——Sidebar/命令面板 tooltip 同源）；
 *  完整速查（含窗格/视图键）按 ⌘/ 弹层。 */
export function ShortcutsSection(): React.JSX.Element {
  return (
    <SettingsSection title="快捷键" hint="完整速查表按 ⌘/ 随时调出">
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
