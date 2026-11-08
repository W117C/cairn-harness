import { useRef } from "react";
import { AlertTriangle, Check, ShieldAlert, X } from "lucide-react";
import { ModalSurface } from "../ModalSurface";
import type { ScopedPluginReview } from "../../state/plugins-marketplace";
import { PluginCapabilities } from "./PluginCapabilities";
import { scopeLabelOf, sourceKindLabel } from "./labels";

export interface PluginReviewProps {
  readonly state: ScopedPluginReview;
  readonly busy?: boolean;
  readonly onCommit?: () => Promise<void> | void;
  readonly onClose?: () => Promise<void> | void;
  readonly onCancel?: () => Promise<void> | void;
}

export function PluginReview(props: PluginReviewProps): React.JSX.Element {
  const review = props.state.review;
  const closeRef = useRef<HTMLButtonElement>(null);
  const close = (): void => { void props.onClose?.(); };

  return (
    <ModalSurface
      className="plugin-review plugin-sheet"
      label={props.state.kind === "update" ? "插件更新审查" : "插件安装审查"}
      onClose={close}
      initialFocusRef={closeRef}
      data-plugin-state="review"
    >
      <header className="plugin-sheet-head">
        <div>
          <h2>{review.manifestName}</h2>
          <div className="plugin-review-state">{props.state.kind === "update" ? "更新审查" : "安装审查"}</div>
        </div>
        <button ref={closeRef} type="button" className="plugin-icon-btn" aria-label="关闭审查" title="关闭" onClick={close}>
          <X size={15} aria-hidden="true" />
        </button>
      </header>

      <div className="plugin-sheet-body">
        <section className="plugin-review-section">
          <h3>来源</h3>
          <dl className="plugin-facts">
            <dt>类型</dt><dd>{sourceKindLabel(review.source.kind)}</dd>
            <dt>作用域</dt><dd>{scopeLabelOf(review.scope)}</dd>
            {review.source.kind === "git" ? (
              <>
                <dt>仓库</dt><dd className="plugin-break">{review.source.repositoryUrl}</dd>
                <dt>Ref</dt><dd>{review.source.ref}</dd>
                <dt>Commit</dt><dd className="plugin-mono plugin-break">{review.source.commit}</dd>
              </>
            ) : review.source.kind === "local" ? (
              <><dt>目录</dt><dd className="plugin-break">{review.source.sourcePath}</dd></>
            ) : (
              <><dt>目录</dt><dd>{review.source.catalogId}</dd><dt>版本</dt><dd>{review.version ?? "未声明版本"}</dd></>
            )}
            <dt>SHA-256</dt><dd className="plugin-mono plugin-break">{review.packageSha256}</dd>
          </dl>
        </section>

        <section className="plugin-review-section">
          <h3>能力</h3>
          <PluginCapabilities capabilities={review.capabilities} />
        </section>

        <section className="plugin-review-section">
          <h3>权限</h3>
          {review.permissions === null ? (
            <div className="plugin-warning-line">
              <ShieldAlert size={15} aria-hidden="true" />
              <span>未提供签名权限清单</span>
            </div>
          ) : review.permissions.length === 0 ? (
            <div className="plugin-fact-line"><Check size={14} aria-hidden="true" /><span>未声明额外权限</span></div>
          ) : (
            <ul className="plugin-plain-list">
              {review.permissions.map((permission) => <li key={permission}>{permission}</li>)}
            </ul>
          )}
        </section>

        <section className="plugin-review-section">
          <h3>配置</h3>
          {review.userConfigFields.length === 0 ? (
            <div className="plugin-muted">无需配置</div>
          ) : (
            <ul className="plugin-plain-list">
              {review.userConfigFields.map((field) => (
                <li key={field.key}>
                  <span>{field.title ?? field.key}</span>
                  <span>{field.required ? "必填" : "可选"}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="plugin-review-section">
          <h3>风险</h3>
          {review.warnings.length === 0 ? (
            <div className="plugin-muted">未发现额外风险</div>
          ) : (
            <ul className="plugin-risk-list">
              {review.warnings.map((warning, index) => (
                <li key={`${warning}:${String(index)}`}>
                  <AlertTriangle size={14} aria-hidden="true" />
                  <span>{warning}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <footer className="plugin-sheet-footer">
        <span>确认后先停用，启用后才在下一轮生效</span>
        <div>
          <button type="button" className="plugin-secondary" onClick={() => { void props.onCancel?.(); }}>
            取消
          </button>
          <button type="button" className="plugin-primary" disabled={props.busy === true} onClick={() => { void props.onCommit?.(); }}>
            {props.state.kind === "update" ? "确认更新" : "确认安装"}
          </button>
        </div>
      </footer>
    </ModalSurface>
  );
}
