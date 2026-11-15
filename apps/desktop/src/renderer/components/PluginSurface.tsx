// 插件快照的共用读取面（2026-10-21）：右列插件窗格与 mod 侧栏共用同一份
// getState().plugins 读取/错误/重试逻辑，避免两处各自实现后口径漂移。
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { PluginPanelSnapshot } from "../../../../../src/agent/plugins";
import { windowWorkspaceApplied } from "../state/window-workspace";
import { STR } from "../strings";

// 插件面板体（AppPage 的 PluginsPane）**按需加载**（2026-10-22 体积面）：
// AppPage 连同 radix-menu / floating-ui 一族约 130KB，只有真的打开插件面板才值得付。
// 此前它是**静态**依赖 ⇒ 弹出窗（只渲染一个窗格的小窗口）也把整页工作台拖进来，
// 路由 JS 顶破 bundle 闸门（popout 423,130B > 400,000B 帽）。
// 懒加载边界放在**本文件内部**（不是调用方）：窗格与 mod 侧栏的接线一行未改，
// 加载占位也只有插件面板那一格会亮，不牵连同屏其它窗格。
const PluginsPane = lazy(() => import("./AppPage").then((m) => ({ default: m.PluginsPane })));

export function PluginSurface(props: { className?: string; onInvoke?: (invoke: string) => void; workspace?: string | null }): React.JSX.Element {
  const [snap, setSnap] = useState<PluginPanelSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const load = (): void => {
    const id = ++seq.current;
    setError(null);
    // 快照按窗口工作区取：先等上报落定再读。切项目后的第一拍不等，拿到的是上一个项目的清单，
    // 而信任决策写进新项目；workspace 变化由下面的 effect 重取。
    void windowWorkspaceApplied().then(() => window.agent.getState()).then((s) => {
      if (id !== seq.current) return; // 重试/刷新期间旧响应不覆盖新结果
      if (s.plugins === undefined) setError(STR.pluginSurface.missing);
      else setSnap(s.plugins);
    }).catch((err: unknown) => {
      if (id !== seq.current) return;
      setError(err instanceof Error ? err.message : String(err));
    });
  };
  useEffect(() => {
    // 换项目：旧清单的行不能再可点（信任决议带的是快照那一行的项目）；加载期显示占位，
    // 不做「旧项目内容 + 新项目动作」的假刷新。
    setSnap(null);
    load();
  }, [props.workspace]);
  const cls = props.className === undefined ? "plugin-pane" : `plugin-pane ${props.className}`;
  if (error !== null) {
    return (
      <div className={cls}>
        <div className="fp-note err" role="alert">{error}</div>
        <button className="mini-btn" onClick={load}>{STR.pluginSurface.retry}</button>
      </div>
    );
  }
  if (snap === null) return <div className={cls}><div className="fp-note">{STR.pluginSurface.loading}</div></div>;
  return (
    <div className={cls}>
      <Suspense fallback={<div className="fp-note">{STR.pluginSurface.paneLoading}</div>}>
        <PluginsPane snap={snap} onError={setError} refresh={load} workspace={props.workspace ?? null} {...(props.onInvoke !== undefined ? { onInvoke: props.onInvoke } : {})} />
      </Suspense>
    </div>
  );
}
