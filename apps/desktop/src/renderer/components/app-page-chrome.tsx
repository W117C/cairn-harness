// 应用页各面板共享的轻量壳件（卡片、详情抽屉、操作回执条）。
import { Check, CircleDashed } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { isCompositionEnter } from "../ime";
import { STR } from "../strings";

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
  const drawerRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const drawer = drawerRef.current;
    const active = document.activeElement;
    if (drawer === null) return;
    if (active instanceof HTMLElement && !drawer.contains(active) && drawer.parentElement?.contains(active)) openerRef.current = active;
    drawer.scrollIntoView({ block: "nearest", inline: "nearest" });
    closeRef.current?.focus({ preventScroll: true });
  }, []);
  const close = () => {
    props.onClose();
    const opener = openerRef.current;
    if (opener?.isConnected && opener.closest("[inert]") === null) opener.focus();
  };
  return (
    <aside className="ap-drawer" ref={drawerRef} aria-label={`${props.title}详情`} onKeyDown={(event) => {
      if (event.key !== "Escape" || event.defaultPrevented || isCompositionEnter(event, null)) return;
      event.preventDefault();
      event.stopPropagation();
      close();
    }}>
      <div className="ap-drawer-head">
        <span className="nm" title={props.title}>{props.title}</span>
        <button ref={closeRef} className="mini-btn" aria-label={STR.design.drawerClose} onClick={close}>关闭</button>
      </div>
      <div className="ap-drawer-scroll" role="region" aria-label="详情内容" tabIndex={0}>
        {props.sub !== undefined && <div className="ap-drawer-sub" title={props.subTitle}>{props.sub}</div>}
        <div className="ap-drawer-body">{props.children}</div>
      </div>
    </aside>
  );
}

export function Notice(props: { text: string | null }): React.JSX.Element | null {
  if (props.text === null) return null;
  return <div className="ap-notice" role="status">{props.text}</div>;
}
