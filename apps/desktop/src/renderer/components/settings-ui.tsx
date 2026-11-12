// 设置页公共组件：页头、分组、标签/控件行，以及共享表单状态。
// 设置页的紧凑布局在 settings-refinement.css 中，并限定于 .sp-page。
import type { ReactNode } from "react";
import { STR } from "../strings";

export function SettingsPage(props: { title: string; desc?: string; children: ReactNode }): React.JSX.Element {
  return (
    <div className="ss-page">
      <header className="ss-head"><h1 className="ss-title">{props.title}</h1>
        {props.desc !== undefined && <p className="ss-desc">{props.desc}</p>}
      </header>
      <div className="ss-content">{props.children}</div>
    </div>
  );
}

export function SettingsSection(props: { title: string; hint?: ReactNode; children: ReactNode }): React.JSX.Element {
  return (
    <section className="ss-sec">
      <div className="ss-sec-head">
        <h2 className="ss-sec-title">{props.title}</h2>
        {props.hint !== undefined && <span className="ss-sec-hint">{props.hint}</span>}
      </div>
      <div className="ss-card">{props.children}</div>
    </section>
  );
}

export function SettingsRow(props: { label: ReactNode; desc?: string; children?: ReactNode }): React.JSX.Element {
  // 参照 ChatGPT 桌面端设置行（2026-10-24 业主）：标题 + 说明**同列上下排**（左列），
  // 控件靠右垂直居中。说明拿到整条左列宽度——2026-10-22「独占整行」要解的中文碎行
  // 问题由本布局一并解决，且观感与参考页一致。
  return (
    <div className="ss-row">
      <div className="ss-row-main">
        <span className="ss-row-label">{props.label}</span>
        {props.desc !== undefined && <span className="ss-row-desc">{props.desc}</span>}
      </div>
      {props.children !== undefined && <div className="ss-row-ctl">{props.children}</div>}
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
  /** 风险档位（2026-11-02）：normal / warn（黄）/ danger（红）。缺省沿用 danger 布尔。 */
  tone?: "normal" | "warn" | "danger";
  /** 危险档的额外警示行（显示在说明下方）。 */
  warn?: string;
  onSelect: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={props.checked}
      className={"ss-opt"
        + (props.checked ? " on" : "")
        + (props.danger === true ? " danger" : "")
        + (props.tone === undefined || props.tone === "normal" ? "" : ` tone-${props.tone}`)}
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
        <button className="x" aria-label={props.removeLabel ?? STR.common.remove} onClick={props.onRemove}>×</button>
      )}
    </span>
  );
}

/** 状态点（联网搜索等）：8px 圆点；ok=绿 / warn=橙 / off=灰。纯装饰（旁边有文字，读屏不看它）。 */
export function StatusDot(props: { tone: "ok" | "warn" | "off" }): React.JSX.Element {
  return <span className="ss-dot" data-tone={props.tone} aria-hidden="true" />;
}
