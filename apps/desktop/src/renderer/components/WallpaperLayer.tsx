// 壁纸层（2026-11-14 · 设计规格 §3.5）：画媒体层与 scrim。
//
// 层挂在 #root 内、position: fixed、z-index: -1 ⇒ 压在 html 画布之上、应用壳之下
// （vendored 主题注释写明的层级）。不吃交互（pointer-events: none）。
//
// 生命周期：失焦 / 不可见即暂停视频（省电）；系统休眠时机器本就不跑，不另设通道。
// 降级：媒体 404 / 解码失败 ⇒ 撤层（只撤媒体，玻璃面留着——没有壁纸时它们回落实体色）。
import { useEffect, useRef, useState } from "react";
import { dropWallpaper, shouldPauseMedia, type WallpaperView } from "../state/wallpaper";

export function WallpaperLayer(props: { view: WallpaperView }): React.JSX.Element | null {
  const { view } = props;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (view.kind !== "video") return;
    const sync = (): void => { setPaused(shouldPauseMedia(document.hasFocus(), !document.hidden)); };
    window.addEventListener("blur", sync);
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => {
      window.removeEventListener("blur", sync);
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [view.kind]);

  useEffect(() => {
    const el = videoRef.current;
    if (el === null) return;
    if (paused) el.pause();
    else void el.play().catch(() => undefined);
  }, [paused, view.url]);

  if (view.kind === "none" || view.url === null) return null;
  return (
    <div className="cw-layer" data-kind={view.kind} aria-hidden="true">
      {view.kind === "video"
        ? (
          <video
            ref={videoRef}
            className="cw-media"
            src={view.url}
            muted
            loop
            playsInline
            autoPlay
            onError={dropWallpaper}
          />
        )
        : <img className="cw-media" src={view.url} alt="" onError={dropWallpaper} />}
      <div className="cw-scrim" />
    </div>
  );
}
