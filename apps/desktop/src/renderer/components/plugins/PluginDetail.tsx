import { useEffect, useRef, useState } from "react";
import {
  ArrowUpCircle,
  Download,
  Power,
  PowerOff,
  ShieldAlert,
  Star,
  Trash2,
  X,
} from "lucide-react";
import type { PluginRowView } from "../../derived/plugins";
import { ConfirmDialog } from "../ConfirmDialog";

const CAPABILITY_LABEL = {
  skills: "技能",
  commands: "命令",
  agents: "智能体",
  hooks: "hooks",
  mcp: "MCP",
  lsp: "LSP",
} as const;

export interface PluginDetailProps {
  readonly row: PluginRowView;
  readonly mutationBlocked?: boolean;
  readonly onClose: () => void;
  readonly onFavorite: () => void;
  readonly onInstall: () => Promise<void> | void;
  readonly onUpdate: () => Promise<void> | void;
  readonly onEnabled: (enabled: boolean) => Promise<void> | void;
  readonly onUninstall: () => Promise<void> | void;
  readonly onConfigure: (values: Record<string, string>) => Promise<void> | void;
}

export function PluginDetail(props: PluginDetailProps): React.JSX.Element {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [confirmUninstall, setConfirmUninstall] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const closeHandler = useRef(props.onClose);
  closeHandler.current = props.onClose;
  const installed = props.row.installed;
  const configFields = props.row.runtime?.userConfig ?? [];
  const disabled = props.mutationBlocked === true || props.row.state === "name-conflict";

  useEffect(() => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeHandler.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      returnFocus.current?.focus({ preventScroll: true });
    };
  }, []);

  return (
    <>
      <aside className="plugin-detail plugin-sheet" role="dialog" aria-label={`${props.row.name} 详情`} data-plugin-state="detail">
        <header className="plugin-sheet-head">
          <div>
            <h2>{props.row.name}</h2>
            <div>{props.row.summary}</div>
          </div>
          <div className="plugin-head-actions">
            <button
              type="button"
              className="plugin-icon-btn"
              aria-label={props.row.favorite ? `取消收藏 ${props.row.name}` : `收藏 ${props.row.name}`}
              title={props.row.favorite ? "取消收藏" : "收藏"}
              aria-pressed={props.row.favorite}
              onClick={props.onFavorite}
            >
              <Star size={15} fill={props.row.favorite ? "currentColor" : "none"} aria-hidden="true" />
            </button>
            <button ref={closeRef} type="button" className="plugin-icon-btn" aria-label="关闭详情" title="关闭" onClick={props.onClose}>
              <X size={15} aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="plugin-sheet-body">
          {props.row.catalogEntry !== null && (
            <section className="plugin-review-section">
              <h3>概述</h3>
              <dl className="plugin-facts">
                <dt>作者</dt><dd>{props.row.catalogEntry.author}</dd>
                <dt>许可证</dt><dd>{props.row.catalogEntry.license}</dd>
                <dt>兼容性</dt><dd>Cairn {props.row.catalogEntry.minAppVersion}+</dd>
              </dl>
            </section>
          )}

          <section className="plugin-review-section">
            <h3>来源</h3>
            <dl className="plugin-facts">
              {installed?.source.kind === "git" ? (
                <>
                  <dt>类型</dt><dd>Git</dd>
                  <dt>仓库</dt><dd className="plugin-break">{installed.source.repositoryUrl}</dd>
                  <dt>Ref</dt><dd>{installed.source.ref}</dd>
                  <dt>Commit</dt><dd className="plugin-mono plugin-break">{installed.source.commit}</dd>
                </>
              ) : installed?.source.kind === "local" ? (
                <><dt>类型</dt><dd>本地</dd><dt>目录</dt><dd className="plugin-break">{installed.source.sourcePath}</dd></>
              ) : (
                <>
                  <dt>类型</dt><dd>{installed?.source.kind === "catalog" || props.row.catalogEntry !== null ? "官方目录" : "手动"}</dd>
                  <dt>版本</dt><dd>{props.row.version ?? "未声明版本"}</dd>
                  {props.row.catalogEntry !== null && <><dt>来源</dt><dd className="plugin-break">{props.row.catalogEntry.sourceUrl}</dd></>}
                </>
              )}
              {props.row.runtime !== null && <><dt>目录</dt><dd className="plugin-break">{props.row.runtime.root}</dd></>}
              {installed !== null && <><dt>作用域</dt><dd>{installed.scope === "user" ? "全局" : "当前项目"}</dd></>}
            </dl>
          </section>

          <section className="plugin-review-section">
            <h3>能力</h3>
            {props.row.capabilities === null ? (
              <div className="plugin-muted">未扫描</div>
            ) : (
              <div className="plugin-capability-grid">
                {Object.entries(props.row.capabilities).map(([kind, count]) => (
                  <div key={kind}><span>{CAPABILITY_LABEL[kind as keyof typeof CAPABILITY_LABEL]}</span><strong>{count}</strong></div>
                ))}
              </div>
            )}
          </section>

          <section className="plugin-review-section">
            <h3>权限</h3>
            {props.row.catalogEntry !== null ? (
              props.row.catalogEntry.permissions.length === 0
                ? <div className="plugin-muted">未声明额外权限</div>
                : <ul className="plugin-plain-list">{props.row.catalogEntry.permissions.map((permission) => <li key={permission}>{permission}</li>)}</ul>
            ) : (
              <div className="plugin-warning-line"><ShieldAlert size={15} aria-hidden="true" /><span>未提供签名权限清单</span></div>
            )}
          </section>

          <section className="plugin-review-section">
            <h3>配置</h3>
            {configFields.length === 0 ? (
              <div className="plugin-muted">未声明配置</div>
            ) : (
              <form
                className="plugin-config-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  const values = Object.fromEntries(Object.entries(draft).filter(([, value]) => value !== ""));
                  if (Object.keys(values).length === 0) return;
                  void props.onConfigure(values);
                  setDraft({});
                }}
              >
                {configFields.map((field) => (
                  <label key={field.key}>
                    <span>{field.title ?? field.key}{field.required ? " *" : ""}</span>
                    <input
                      type={field.sensitive ? "password" : "text"}
                      autoComplete="off"
                      value={draft[field.key] ?? ""}
                      placeholder={field.hasValue ? "已设置" : field.required ? "必填" : "未设置"}
                      onChange={(event) => { setDraft((current) => ({ ...current, [field.key]: event.target.value })); }}
                    />
                  </label>
                ))}
                <button type="submit" className="plugin-secondary" disabled={props.mutationBlocked === true}>保存配置</button>
              </form>
            )}
          </section>

          {(props.row.warnings.length > 0 || props.row.errors.length > 0) && (
            <section className="plugin-review-section">
              <h3>风险</h3>
              <ul className="plugin-risk-list">
                {props.row.errors.map((message, index) => <li key={`error:${String(index)}`}>{message}</li>)}
                {props.row.warnings.map((message, index) => <li key={`warning:${String(index)}`}>{message}</li>)}
              </ul>
            </section>
          )}
        </div>

        <footer className="plugin-sheet-footer plugin-detail-actions">
          {installed === null && props.row.catalogEntry !== null && (
            <button type="button" className="plugin-primary" disabled={disabled} onClick={() => { void props.onInstall(); }}>
              <Download size={15} aria-hidden="true" />
              安装
            </button>
          )}
          {installed !== null && (
            <>
              <button type="button" className="plugin-secondary" disabled={disabled} onClick={() => { void props.onUpdate(); }}>
                <ArrowUpCircle size={15} aria-hidden="true" />
                更新
              </button>
              <button type="button" className="plugin-secondary" disabled={disabled} onClick={() => { void props.onEnabled(!installed.enabled); }}>
                {installed.enabled ? <PowerOff size={15} aria-hidden="true" /> : <Power size={15} aria-hidden="true" />}
                {installed.enabled ? "停用" : "启用"}
              </button>
              <button type="button" className="plugin-danger-text" disabled={disabled} onClick={() => { setConfirmUninstall(true); }}>
                <Trash2 size={15} aria-hidden="true" />
                卸载
              </button>
            </>
          )}
        </footer>
      </aside>
      {confirmUninstall && (
        <ConfirmDialog
          title={`卸载「${props.row.name}」？`}
          note="将删除插件包、信任记录、配置和已保存的敏感值。"
          confirmLabel="卸载"
          danger
          onClose={() => { setConfirmUninstall(false); }}
          onConfirm={() => {
            setConfirmUninstall(false);
            void props.onUninstall();
          }}
        />
      )}
    </>
  );
}
