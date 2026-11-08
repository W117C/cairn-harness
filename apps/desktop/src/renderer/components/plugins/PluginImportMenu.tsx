import { useState } from "react";
import { Download, FolderOpen, GitBranch, X } from "lucide-react";
import type { PluginImportRequest, PluginInstallScope } from "../../../../../../src/main/ipc-protocol";

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

export function PluginImportMenu(props: PluginImportMenuProps): React.JSX.Element {
  const [internalOpen, setInternalOpen] = useState(false);
  const [mode, setMode] = useState<ImportMode | null>(null);
  const [scope, setScope] = useState<PluginInstallScope>(props.workspaceAvailable === false ? "user" : "project");
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [ref, setRef] = useState("");
  const [localPath, setLocalPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = props.open ?? internalOpen;
  const disabled = props.disabled === true;

  const close = (): void => {
    if (props.open === undefined) setInternalOpen(false);
    setMode(null);
    setError(null);
    setLocalPath(null);
  };

  const pickLocal = async (): Promise<void> => {
    setError(null);
    setMode("local");
    try {
      const path = await (props.onPickLocalSource ?? (() => window.agent.pluginPickLocalSource()))();
      if (path === null) return;
      setLocalPath(path);
    } catch (err) {
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
    <div className="plugin-import-menu" data-open={open ? "true" : "false"}>
      <button
        type="button"
        className="plugin-command"
        aria-expanded={open}
        aria-haspopup="menu"
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
        <div className="plugin-import-popover" role="dialog" aria-label="导入插件">
          <div className="plugin-import-head">
            <span>导入插件</span>
            <button type="button" className="plugin-icon-btn" aria-label="关闭导入" title="关闭" onClick={close}>
              <X size={14} aria-hidden="true" />
            </button>
          </div>
          {mode === null ? (
            <div role="menu" className="plugin-import-choices">
              <button type="button" role="menuitem" onClick={() => { setError(null); setMode("git"); }}>
                <GitBranch size={15} aria-hidden="true" />
                <span>Git 仓库</span>
              </button>
              <button type="button" role="menuitem" onClick={() => { void pickLocal(); }}>
                <FolderOpen size={15} aria-hidden="true" />
                <span>本地目录</span>
              </button>
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
              {error !== null && <div className="plugin-form-error" role="alert">{error}</div>}
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
