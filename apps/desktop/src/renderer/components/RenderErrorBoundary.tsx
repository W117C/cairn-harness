// 渲染错误边界：把「一块界面炸了」收在它自己的格子里，而不是让 React 根卸载成白屏/启动占位。
// 三个落点（2026-10-25）：
//   · 应用根（main.tsx）：兜底任何未预料的渲染错误，给重试 / 重新载入；
//   · 设置分区（SettingsPanel）：分区 key 变化即重置；一个分区炸了，左导航与其他分区照常；
//   · 窗格内容（PaneDock）：每个已开窗格各自一条边界；一个窗格炸了，标签条与其他窗格照常。
// 无错误时直接返回 children（不包 wrapper）：设置页的 `.sp-body > .ss-page`、
// 窗格的 `.pane-chunk-body` 都依赖直接子元素，包一层会把既有版式改掉。
// 只捕渲染期错误；异步 Promise 的错误仍由各组件自己的 catch / role=alert 面负责。
import { Component, Fragment, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { STR } from "../strings";
import "./render-error.css";

type Variant = "page" | "inline";

interface Props {
  children: ReactNode;
  variant?: Variant;
  title?: string;
  body?: string;
}

interface State {
  error: Error | null;
  componentStack: string;
  generation: number;
}

/** 可单测的兜底面：不依赖 class 的 state 迁移，SSR 也能出真 HTML。 */
export function RenderErrorFallback(props: {
  variant: Variant;
  title: string;
  body: string;
  error: Error;
  componentStack: string;
  onRetry: () => void;
  onReload: () => void;
}): ReactNode {
  const { variant, title, body, error, componentStack, onRetry, onReload } = props;
  return (
    <div className={`render-error ${variant}`} role="alert">
      <div className="re-icon" aria-hidden="true"><AlertTriangle size={variant === "page" ? 26 : 18} /></div>
      <div className="re-copy">
        <h2 className="re-title">{title}</h2>
        <p className="re-body">{body}</p>
        <div className="re-actions">
          <button type="button" className="mini-btn primary" onClick={onRetry}>
            <RefreshCw size={13} aria-hidden="true" />{STR.crash.retry}
          </button>
          {variant === "page" && (
            <button type="button" className="mini-btn" onClick={onReload}>{STR.crash.reload}</button>
          )}
        </div>
        <details className="re-details">
          <summary>{STR.crash.details}</summary>
          <pre className="re-pre">{error.message}{componentStack !== "" ? `\n${componentStack}` : ""}</pre>
        </details>
      </div>
    </div>
  );
}

export class RenderErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: "", generation: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 仅为诊断留痕：不吞错误、不发网络、不写用户数据。
    console.error("[render-boundary]", error, info.componentStack ?? "");
    this.setState({ componentStack: info.componentStack ?? "" });
  }

  private reset = (): void => {
    // generation 变更会重挂子树：组件内部半坏的状态也一起丢掉，避免「重试后仍坏」。
    this.setState((prev) => ({ error: null, componentStack: "", generation: prev.generation + 1 }));
  };

  private reload = (): void => {
    if (typeof window !== "undefined") window.location.reload();
  };

  render(): ReactNode {
    const { error, componentStack, generation } = this.state;
    if (error === null) {
      // Fragment 不产生 DOM 节点：直接子元素关系保持不变（不破坏 .sp-body > .ss-page 等选择器）。
      return <Fragment key={generation}>{this.props.children}</Fragment>;
    }
    const variant = this.props.variant ?? "inline";
    const title = this.props.title ?? (variant === "page" ? STR.crash.pageTitle : STR.crash.inlineTitle);
    const body = this.props.body ?? (variant === "page" ? STR.crash.pageBody : STR.crash.inlineBody);
    return (
      <RenderErrorFallback
        variant={variant}
        title={title}
        body={body}
        error={error}
        componentStack={componentStack}
        onRetry={this.reset}
        onReload={this.reload}
      />
    );
  }
}
