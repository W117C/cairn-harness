import { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { parsePaneHash } from "./components/panes";
import { RenderErrorBoundary } from "./components/RenderErrorBoundary";
import { ToastHost } from "./components/ToastHost";
import "./tokens.css";
import "./styles.css";
import "./dsh-claude-style.css";

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
        <PopoutApp kind={popout.kind} sessionId={popout.sessionId} />
      ) : (
        <>
          <App />
          <ToastHost />
        </>
      )}
    </Suspense>
  </RenderErrorBoundary>,
);
