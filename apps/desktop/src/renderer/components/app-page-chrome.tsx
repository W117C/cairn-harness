// 应用页各面板共享的轻量壳件（卡片、详情抽屉、操作回执条）。
import { Check, CircleDashed } from "lucide-react";

/** 双列卡片网格（图标 + 名称 + 一句话描述 + 右侧动作）——Codex 自定义页的卡片形制。 */
export function PaneCard(props: {
  ico: string; name: string; sub: string; nameTitle?: string;
  trusted: boolean; trustTitle: string;
  selected?: boolean; onOpen: () => void;
}): React.JSX.Element {
  return (
    <button className={"ap-card" + (props.selected === true ? " on" : "")} onClick={props.onOpen}>
      <span className="ap-card-ico" aria-hidden="true">{props.ico}</span>
      <span className="ap-card-main">
        <span className="ap-card-nm" {...(props.nameTitle !== undefined ? { title: props.nameTitle } : {})}>{props.name}</span>
        <span className="ap-card-sub" title={props.sub}>{props.sub !== "" ? props.sub : "（无描述）"}</span>
      </span>
      <span className={"ap-card-act" + (props.trusted ? " ok" : "")} title={props.trustTitle} aria-hidden="true">
        {props.trusted ? <Check size={15} /> : <CircleDashed size={15} />}
      </span>
    </button>
  );
}

export function Drawer(props: { title: string; sub?: string; subTitle?: string; onClose: () => void; children: React.ReactNode }): React.JSX.Element {
  return (
    <aside className="ap-drawer" aria-label="详情">
      <div className="ap-drawer-head">
        <span className="nm">{props.title}</span>
        <button className="mini-btn" onClick={props.onClose}>关闭</button>
      </div>
      {props.sub !== undefined && <div className="ap-drawer-sub" title={props.subTitle}>{props.sub}</div>}
      <div className="ap-drawer-body">{props.children}</div>
    </aside>
  );
}

export function Notice(props: { text: string | null }): React.JSX.Element | null {
  if (props.text === null) return null;
  return <div className="ap-notice" role="status">{props.text}</div>;
}
