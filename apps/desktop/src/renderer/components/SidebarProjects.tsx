// 侧栏的项目面（第 1100 页从 Sidebar.tsx 拆出：Sidebar 已 1074 行，项目右键菜单与项目设置
// Dialog 是两块自洽 UI，和会话行/分组无关）。Sidebar 重导出 ProjectSettingsDialog 保旧 import 面。
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { ProjectRecord } from "../../../../../src/main/ipc-protocol";
import { STR } from "../strings";
import { isCompositionEnter } from "../ime";
import { ModalSurface } from "./ModalSurface";
import { menuNavIndex } from "./popover-keys";

/** 项目行菜单（右键或 hover ⋯ 打开）：自绘 fixed 定位菜单——Radix DropdownMenu 的 Trigger 点击语义
 *  与「整行点击=折叠」冲突，这里要的是纯右键面；自绘同时保住键盘/焦点语义（Esc 关、外点关）。 */
export function ProjectContextMenu(props: {
  at: { x: number; y: number };
  onClose: () => void;
  onReveal: () => void;
  onRename: () => void;
  onSettings: () => void;
  onRelocate: () => void;
  onRemove: () => void;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef(props.onClose);
  closeRef.current = props.onClose;
  const [position, setPosition] = useState(props.at);
  useLayoutEffect(() => {
    const surface = ref.current;
    if (surface === null) return;
    // 原生顶层避免通知卡盖住操作；开关状态仍由当前组件管理。
    surface.setAttribute("popover", "manual");
    surface.showPopover();
    const place = (): void => {
      const menu = ref.current;
      if (menu === null) return;
      setPosition({
        x: Math.max(8, Math.min(props.at.x, window.innerWidth - menu.offsetWidth - 8)),
        y: Math.max(8, Math.min(props.at.y, window.innerHeight - menu.offsetHeight - 8)),
      });
    };
    place();
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("resize", place);
      if (surface.isConnected && surface.matches(":popover-open")) surface.hidePopover();
    };
  }, [props.at.x, props.at.y]);
  useEffect(() => {
    const menu = ref.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    menu?.querySelector<HTMLButtonElement>("button")?.focus();
    const onDown = (e: MouseEvent): void => {
      if (menu !== null && !menu.contains(e.target as Node)) closeRef.current();
    };
    const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") closeRef.current(); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      if (previous?.isConnected && (document.activeElement === document.body || menu?.contains(document.activeElement))) previous.focus();
    };
  }, []);
  const item = (label: string, tip: string, run: () => void, danger = false): React.JSX.Element => (
    <button
      className={"menu-item" + (danger ? " danger-text" : "")}
      role="menuitem"
      tabIndex={-1}
      title={tip}
      onClick={() => { props.onClose(); run(); }}
    >
      {label}
    </button>
  );
  return (
    <div
      ref={ref}
      className="pop show ctx-menu"
      role="menu"
      style={{ left: position.x, top: position.y }}
      onKeyDown={(e) => {
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); props.onClose(); return; }
        if (e.key === "Tab") { props.onClose(); return; }
        const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]')];
        const next = menuNavIndex(e.key, items.indexOf(document.activeElement as HTMLButtonElement), items.length);
        if (next === null) return;
        e.preventDefault();
        e.stopPropagation();
        items[next]?.focus();
      }}
    >
      {item(STR.projectMenu.reveal, STR.projectMenu.revealTip, props.onReveal)}
      {item(STR.projectMenu.rename, STR.projectMenu.renameTip, props.onRename)}
      {item(STR.projectMenu.settings, STR.projectMenu.settingsTip, props.onSettings)}
      {item(STR.projectMenu.relocate, STR.projectMenu.relocateTip, props.onRelocate)}
      <div className="menu-sep" role="separator" />
      {item(STR.projectMenu.remove, STR.projectMenu.removeTip, props.onRemove, true)}
    </div>
  );
}

/** 项目设置 Dialog（brief 第二节「项目设置…」）：显示名 + 默认运行位置（系统选择器）。
 *  保存 = addProject 同路径 upsert（零新通道）；位置只展示不可手输（原则 1：用户不碰绝对路径）。 */
export function ProjectSettingsDialog(props: {
  project: ProjectRecord;
  onClose: () => void;
  onSave: (patch: { name: string; defaultLocation: string }) => Promise<void>;
  onPickDirectory: () => Promise<string | null>;
}): React.JSX.Element {
  const [name, setName] = useState(props.project.name);
  const [location, setLocation] = useState(props.project.defaultLocation);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameInput = useRef<HTMLInputElement | null>(null);
  const close = () => { if (!busy) props.onClose(); };
  /** 回车 = 保存（按钮同一条路）；空名给错误、不关面板。 */
  const submit = () => {
    if (busy) return;
    const trimmed = name.trim();
    if (trimmed === "") { setError(STR.projectRename.empty); return; }
    setBusy(true);
    setError(null);
    void props.onSave({ name: trimmed, defaultLocation: location }).then(
      () => { props.onClose(); },
      (err: unknown) => { setError(STR.projectSettings.failed.replace("{reason}", err instanceof Error ? err.message : String(err))); setBusy(false); },
    );
  };
  return (
    <div className="modal-backdrop" role="presentation" onClick={close}>
      <ModalSurface
        className="modal-card"
        label={STR.projectSettings.title}
        onClose={close}
        aria-busy={busy}
        initialFocusRef={nameInput}
        onClick={(e) => { e.stopPropagation(); }}
      >
        <div className="modal-head">
          <span>{STR.projectSettings.title}</span>
          <button className="iconbtn sm" aria-label={STR.projectSettings.close} title={STR.projectSettings.close} disabled={busy} onClick={close}>
            <X size={13} />
          </button>
        </div>
        <label className="modal-field">
          <span>{STR.projectSettings.nameLabel}</span>
          <input
            ref={nameInput}
            value={name}
            disabled={busy}
            onChange={(e) => { setName(e.target.value); }}
            aria-label={STR.projectSettings.nameLabel}
            onKeyDown={(e) => { if (e.key === "Enter" && !isCompositionEnter(e, null)) { e.preventDefault(); submit(); } }}
          />
        </label>
        <div className="modal-field">
          <span>{STR.projectSettings.locationLabel}</span>
          <div className="modal-row">
            <code className="modal-path" title={location}>{location}</code>
            <button
              className="mini-btn"
              title={STR.projectSettings.locationHint}
              disabled={busy}
              onClick={() => {
                setError(null);
                void props.onPickDirectory().then((picked) => { if (picked !== null) setLocation(picked); }).catch((err: unknown) => {
                  setError(STR.newProject.locationFailed.replace("{reason}", err instanceof Error ? err.message : String(err)));
                });
              }}
            >
              {STR.projectSettings.change}
            </button>
          </div>
          <span className="sp-dim">{STR.projectSettings.locationHint}</span>
        </div>
        {error !== null && <div className="form-error" role="alert">{error}</div>}
        <div className="modal-foot">
          <button className="mini-btn" title={STR.common.cancel} disabled={busy} onClick={close}>{STR.common.cancel}</button>
          <button
            className="mini-btn primary"
            title={STR.projectRename.save}
            disabled={busy}
            onClick={submit}
          >
            {busy ? STR.projectSettings.saving : STR.projectRename.save}
          </button>
        </div>
      </ModalSurface>
    </div>
  );
}
