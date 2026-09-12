// H2（审查 F-2）：顶层错误边界——任何卡/投影/面板渲染期抛错只落到有界的兜底 UI，
// 不再整页白屏无出口。项目渲染面大量来自事件流投影（payload 经防御读取仍有强转路径），
// 损坏日志/旧版事件的运行时形状差异都可能抛 TypeError；错误边界是渲染层的最后防线。
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // 控制台留全栈（devtools 可查）；UI 只给可操作出口
    console.error("[renderer] 渲染期未捕获错误:", error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.error !== null) {
      return (
        <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
          <h2 style={{ fontSize: 16, marginBottom: 8 }}>界面渲染出错</h2>
          <p style={{ color: "#888", fontSize: 13, marginBottom: 16, wordBreak: "break-all" }}>
            {this.state.error.message}
          </p>
          <button
            type="button"
            style={{ marginRight: 8, padding: "6px 14px", cursor: "pointer" }}
            onClick={() => {
              this.setState({ error: null }); // 瞬态错误可直接重试渲染
            }}
          >
            重试渲染
          </button>
          <button type="button" style={{ padding: "6px 14px", cursor: "pointer" }} onClick={() => window.location.reload()}>
            重新加载界面
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
