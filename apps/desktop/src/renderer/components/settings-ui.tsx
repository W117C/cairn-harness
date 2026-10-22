// 设置页公共组件（批 6 · 总纲阶段 2「公共组件先行」+ 细则 §六；
// 2026-10-16 模型/通道页重做：内容列 ≤960px + SettingsRow 定 220px 标题列 + Field/Badge/StatusDot 三件）：
//   SettingsPage    页面壳：20px 标题 + ≤960px 内容列（宽度与居中由 .sp-body > .ss-page 落）
//   SettingsSection 分组：12.5px tertiary 组标题在卡上方 + surface 卡（描边 + 14 圆角）
//   SettingsRow     行：220px 固定标题列（标题 + 灰色说明）/ 控件列弹性左对齐、行间 1px 分隔线
//   Field           控件外壳：36px 高 / 8px 圆角 / 焦点描边 / 禁用区分；select 走自绘箭头
//   Badge           小徽章：已存 key 等；带 × 删除
//   StatusDot       状态点：ok 绿 / warn 橙 / off 灰（联网搜索等状态行）
//   EmptyState      空态：图标 + 标题 + 说明 + 主按钮（可选）；垂直居中，不摆统计卡
//   OptionCard      单选卡：单选圆点 + 标题/说明上下排；选中 = 强调描边 + 淡底；危险档整体危险色
//   Banner          提示条：信息/警告 + 可折叠「查看详情」；ToneBannerIcon 由调用方给内容与图标
// 组标题字号口径：细则三处（设置页/模型页/权限页）一致「12.5px tertiary 卡上方小标签」，
// 页面标题承担 20px/600（总纲阶段 2 的「15px/600 分组标题」按对账口径并入细则版——克制小标签）。
import type { ReactNode } from "react";

export function SettingsPage(props: { title: string; desc?: string; children: ReactNode }): React.JSX.Element {
  return (
    <div className="ss-page">
      <h1 className="ss-title">{props.title}</h1>
      {props.desc !== undefined && <p className="ss-desc">{props.desc}</p>}
      <div className="ss-content">{props.children}</div>
    </div>
  );
}

export function SettingsSection(props: { title: string; hint?: string; children: ReactNode }): React.JSX.Element {
  return (
    <section className="ss-sec">
      <div className="ss-sec-head">
        <span className="ss-sec-title">{props.title}</span>
        {props.hint !== undefined && <span className="ss-sec-hint">{props.hint}</span>}
      </div>
      <div className="ss-card">{props.children}</div>
    </section>
  );
}

export function SettingsRow(props: { label: ReactNode; desc?: string; children: ReactNode }): React.JSX.Element {
  // 说明文字**独占整行**（2026-10-22 排版减法）：此前它被关在 220px 的标题列里，
  // 中文句子折成两行、末行只剩一个字（「…尚未接 / 入。」），而右边大片空着。
  // ⇒ 说明改为行内第二个 grid item，跨两列独占一行；标题与控件仍在第一行。
  return (
    <div className="ss-row">
      <div className="ss-row-main">
        <span className="ss-row-label">{props.label}</span>
      </div>
      <div className="ss-row-ctl">{props.children}</div>
      {props.desc !== undefined && <span className="ss-row-desc">{props.desc}</span>}
    </div>
  );
}

export function EmptyState(props: {
  icon?: ReactNode;
  title: string;
  desc?: string;
  action?: ReactNode;
}): React.JSX.Element {
  return (
    <div className="ss-empty">
      {props.icon !== undefined && <div className="ss-empty-ico" aria-hidden="true">{props.icon}</div>}
      <div className="ss-empty-title">{props.title}</div>
      {props.desc !== undefined && <div className="ss-empty-desc">{props.desc}</div>}
      {props.action !== undefined && <div className="ss-empty-action">{props.action}</div>}
    </div>
  );
}

export function OptionCard(props: {
  checked: boolean;
  title: string;
  desc?: string;
  /** 危险档（如「自动 · 免审批」）：整体危险色 + 警示行。 */
  danger?: boolean;
  /** 危险档的额外警示行（显示在说明下方）。 */
  warn?: string;
  onSelect: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={props.checked}
      className={"ss-opt" + (props.checked ? " on" : "") + (props.danger === true ? " danger" : "")}
      onClick={props.onSelect}
    >
      <span className="ss-opt-dot" aria-hidden="true" />
      <span className="ss-opt-text">
        <span className="ss-opt-title">{props.title}</span>
        {props.desc !== undefined && <span className="ss-opt-desc">{props.desc}</span>}
        {props.warn !== undefined && <span className="ss-opt-warn">{props.warn}</span>}
      </span>
    </button>
  );
}

export function Banner(props: {
  tone: "info" | "warn";
  icon?: ReactNode;
  children: ReactNode;
  /** 配法/示例等长内容：折叠进「查看详情」（原生 details，展开零 JS）。 */
  details?: ReactNode;
}): React.JSX.Element {
  return (
    <div className={`ss-banner ${props.tone}`}>
      <div className="ss-banner-row">
        {props.icon !== undefined && <span className="ss-banner-ico" aria-hidden="true">{props.icon}</span>}
        <span className="ss-banner-text">{props.children}</span>
      </div>
      {props.details !== undefined && (
        <details className="ss-banner-details">
          <summary>查看详情</summary>
          <div className="ss-banner-detail-body">{props.details}</div>
        </details>
      )}
    </div>
  );
}

// ── 2026-10-16 模型/通道页重做：控件契约三件（Field / Badge / StatusDot）────────
// 设计裁定（业主）：输入框/下拉框/按钮统一 36px 高、8px 圆角（--radius-field）、
// 焦点清晰描边、禁用态明显区分；原生 select 与按钮风格割裂 ⇒ appearance:none + CSS 自绘箭头。
// Field 只做「外壳 + 宽度档」，尺寸/四态全在 CSS（.ss-field）——组件层不写一个数。

/** 控件宽度档（设计裁定：表单控件统一宽度、最大 420px）。
 *  sm 160 / md 240 / lg 320 / full：flex 弹性、上限 420（只给 select/input 用宽度档）。 */
export type FieldWidth = "sm" | "md" | "lg" | "full";

/** 控件外壳：包住 input/select，统一 36px 高 / 8px 圆角 / 四态；select 传 select=true
 *  （CSS 自绘箭头，盖掉原生外观——「原生 select 与自定义按钮风格割裂」的修法）。 */
export function Field(props: { children: ReactNode; width?: FieldWidth; select?: boolean }): React.JSX.Element {
  return (
    <span className="ss-field" data-w={props.width ?? "md"} {...(props.select === true ? { "data-select": "true" } : {})}>
      {props.children}
    </span>
  );
}

/** 小徽章（已存 key 等）：中性胶囊；给 onRemove 时带「×」删除钮（aria-label 由调用方给全）。 */
export function Badge(props: {
  children: ReactNode;
  tone?: "neutral" | "ok";
  onRemove?: () => void;
  removeLabel?: string;
}): React.JSX.Element {
  return (
    <span className={"ss-badge " + (props.tone ?? "neutral")}>
      {props.children}
      {props.onRemove !== undefined && (
        <button className="x" aria-label={props.removeLabel ?? "移除"} onClick={props.onRemove}>×</button>
      )}
    </span>
  );
}

/** 状态点（联网搜索等）：8px 圆点；ok=绿 / warn=橙 / off=灰。纯装饰（旁边有文字，读屏不看它）。 */
export function StatusDot(props: { tone: "ok" | "warn" | "off" }): React.JSX.Element {
  return <span className="ss-dot" data-tone={props.tone} aria-hidden="true" />;
}
