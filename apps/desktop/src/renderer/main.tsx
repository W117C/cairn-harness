import { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { parsePaneHash } from "./components/panes";
import { RenderErrorBoundary } from "./components/RenderErrorBoundary";
import { ToastHost } from "./components/ToastHost";
import "./tokens.css";
import "./styles.css";
import "./dsh-claude-style.css";
// 对话轨道（第 754 页）：轴线与首行齐平。
// 位置在 CDS 适配层**之前**：`cds-parity` 钉住「adapter 之后只允许组件层」——
// 任何第三个样式 import 都算接线漂移。轨道只动自己的落位（.reading::before /
// .row.assistant 的两处），与官方变量无冲突，排在前面不影响它的优先级。
import "./components/conversation-rail.css";
// 减弱动效：启动时按偏好 + 系统事实落根属性（对标 Claude 的 data-reduce-motion 根属性）。
import { bootMotionPref } from "./state/motion-pref";
// CDS 适配层必须**最后**载入：它要把 Cairn 语义令牌和第三方皮肤的 --dsw-* 调色板
// 一起钉到官方 CDS 值上；只要它先载入，`dsh-claude-style.css` 的近似色就会盖住官方值
// （2026-10-28 实测：暗色整屏被覆盖成 #141413，而官方 surface-1 是 #151515）。
import "./cds-adapter.css";
// 组件层：官方 data-cds 规则 + Cairn 对契约变量的消费点（消息气泡/正文缩进/骨架/工具栏）。
import "./cds-components.css";

// 减弱动效落位（应用内开关 + 系统媒体查询两路事实 ⇒ 一个根属性）。
bootMotionPref();
document.body.setAttribute("data-dsh-claude-style", "");
document.body.setAttribute("data-dsh-claude-palette", "claude");
document.body.setAttribute("data-dsh-claude-brand", "claude");

const PopoutApp = lazy(() => import("./components/PopoutApp").then((m) => ({ default: m.PopoutApp })));
const App = lazy(() => import("./App").then((m) => ({ default: m.App })));

// 路由：`#pane=<kind>[&session=<id>]` = 独立窗格窗口（弹出）；其余 = 主窗口。
// 主窗口专属 ToastHost：首次成功/失败提示时才加载 sonner；弹窗窗格没有发 toast 的调用面。
const popout = parsePaneHash(window.location.hash);
createRoot(document.getElementById("root")!).render(
  <RenderErrorBoundary variant="page">
    <Suspense fallback={null}>
      {popout !== null ? (
        <PopoutApp kind={popout.kind} sessionId={popout.sessionId} workspace={popout.workspace} />
      ) : (
        <>
          <App />
          <ToastHost />
        </>
      )}
    </Suspense>
  </RenderErrorBoundary>,
);
