import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Download, FolderOpen, GitBranch, X } from "lucide-react";
import type { PluginImportRequest, PluginInstallScope } from "../../../../../../src/main/ipc-protocol";
import { menuNavIndex } from "../popover-keys";
import { usePopoverDismiss } from "../../usePopoverDismiss";

export interface PluginImportMenuProps {
  readonly open?: boolean;
  readonly workspaceAvailable?: boolean;
  readonly disabled?: boolean;
  readonly onImport?: (
    request: PluginImportRequest,
    scope: PluginInstallScope,
  ) => Promise<void> | void;
  readonly onPickLocalSource?: () => Promise<string | null>;
}

type ImportMode = "git" | "local";

const CHOICES = [
  { id: "git" as const, label: "Git 仓库", icon: <GitBranch size={15} aria-hidden="true" /> },
  { id: "local" as const, label: "本地目录", icon: <FolderOpen size={15} aria-hidden="true" /> },
];

export function PluginImportMenu(props: PluginImportMenuProps): React.JSX.Element {
  const [internalOpen, setInternalOpen] = useState(false);
  const [mode, setMode] = useState<ImportMode | null>(null);
  const [scope, setScope] = useState<PluginInstallScope>(props.workspaceAvailable === false ? "user" : "project");
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [ref, setRef] = useState("");
  const [localPath, setLocalPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 选项菜单的 roving tabindex：role=menu 里只有一项在 Tab 序上，方向键换焦点。
  const [choice, setChoice] = useState(0);
  const open = props.open ?? internalOpen;
  const disabled = props.disabled === true;
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback((): void => {
    if (props.open === undefined) setInternalOpen(false);
    setMode(null);
    setError(null);
    setLocalPath(null);
  }, [props.open]);

  // 外点 / Esc 关闭 + 关闭后把焦点还给触发按钮（与全应用弹层同一份实现）。
  // 焦点在弹层内时 Esc 归弹层：`data-esc-owns` 让全局捕获阶段让路，否则一次 Esc
  // 会先被插件侧栏/智慧停止吃掉，弹层反而关不掉。
  usePopoverDismiss(open, close, boxRef, triggerRef);

  // 打开后把焦点搬进弹层；选项 → 表单切换时落到第一个字段（被点的按钮已卸载，
  // 不搬焦点就会掉回 body）。本地目录选择完成后同样落到表单，取消则回到选项。
  useEffect(() => {
    if (!open) return;
    const panel = boxRef.current?.querySelector<HTMLElement>(".plugin-import-popover") ?? null;
    if (panel === null) return;
    const target = mode === null
      ? panel.querySelector<HTMLElement>('[role="menuitem"]')
      : panel.querySelector<HTMLElement>('input:not([disabled]), select:not([disabled]), textarea:not([disabled]), .plugin-import-actions button:not([disabled])');
    target?.focus();
  }, [open, mode, localPath]);

  const pickLocal = async (): Promise<void> => {
    setError(null);
    setMode("local");
    setLocalPath(null);
    try {
      const path = await (props.onPickLocalSource ?? (() => window.agent.pluginPickLocalSource()))();
      // 原生选择器被取消：退回选项，而不是永远停在「正在选择目录…」且导入钮不可用。
      if (path === null) { setMode(null); return; }
      setLocalPath(path);
    } catch (err) {
      setMode(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const request: PluginImportRequest = mode === "git"
        ? {
            kind: "git",
            repositoryUrl: repositoryUrl.trim(),
            ...(ref.trim() === "" ? {} : { ref: ref.trim() }),
          }
        : { kind: "local", sourcePath: localPath ?? "" };
      await props.onImport?.(request, scope);
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="plugin-import-menu"
      data-open={open ? "true" : "false"}
      ref={boxRef}
      {...(open ? { "data-esc-owns": "true" } : {})}
    >
      <button
        ref={triggerRef}
        type="button"
        className="plugin-command"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? panelId : undefined}
        disabled={disabled}
        onClick={() => {
          setError(null);
          setMode(null);
          if (props.open === undefined) setInternalOpen((value) => !value);
        }}
      >
        <Download size={15} aria-hidden="true" />
        <span>导入</span>
      </button>
      {open && (
        <div className="plugin-import-popover" id={panelId} role="dialog" aria-label="导入插件">
          <div className="plugin-import-head">
            <span>导入插件</span>
            <button type="button" className="plugin-icon-btn" aria-label="关闭导入" title="关闭" onClick={close}>
              <X size={14} aria-hidden="true" />
            </button>
          </div>
          {error !== null && <div className="plugin-form-error" role="alert">{error}</div>}
          {mode === null ? (
            <div
              role="menu"
              className="plugin-import-choices"
              onKeyDown={(event) => {
                const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'));
                const next = menuNavIndex(event.key, items.indexOf(document.activeElement as HTMLElement), items.length);
                if (next === null) return;
                event.preventDefault();
                setChoice(next);
                items[next]?.focus();
              }}
            >
              {CHOICES.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  tabIndex={index === choice ? 0 : -1}
                  onFocus={() => { setChoice(index); }}
                  onClick={() => {
                    setError(null);
                    if (item.id === "git") setMode("git");
                    else void pickLocal();
                  }}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          ) : (
            <form
              className="plugin-import-form"
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              {mode === "git" ? (
                <>
                  <label>
                    <span>仓库</span>
                    <input
                      type="url"
                      required
                      value={repositoryUrl}
                      placeholder="https://github.com/owner/plugin"
                      onChange={(event) => { setRepositoryUrl(event.target.value); }}
                    />
                  </label>
                  <label>
                    <span>分支或标签</span>
                    <input
                      value={ref}
                      placeholder="main"
                      onChange={(event) => { setRef(event.target.value); }}
                    />
                  </label>
                </>
              ) : (
                <div className="plugin-import-path" title={localPath ?? ""}>
                  {localPath === null ? "正在选择目录…" : localPath}
                </div>
              )}
              <label>
                <span>作用域</span>
                <select
                  value={scope}
                  onChange={(event) => { setScope(event.target.value as PluginInstallScope); }}
                >
                  <option value="user">全局</option>
                  <option value="project" disabled={props.workspaceAvailable === false}>当前项目</option>
                </select>
              </label>
              <div className="plugin-import-actions">
                <button type="button" className="plugin-secondary" onClick={() => { setMode(null); setError(null); }}>
                  返回
                </button>
                <button
                  type="submit"
                  className="plugin-primary"
                  disabled={busy || disabled || (mode === "local" && localPath === null)}
                >
                  {busy ? "导入中…" : "导入"}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
