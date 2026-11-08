import type { Dispatch,MutableRefObject,SetStateAction } from 'react';
// useEmptySurfaceEffects: extracted without changing event or callback behavior.
import { useEffect,useLayoutEffect } from "react";
import { buildQuickStarts,type QuickStartInput } from "../quick-starts";
import type { WorkspaceSession } from "../sessions-view";
interface EmptySurface {
  quickStarts: string[];
  branch: string | null;
}
const NULL_QUICK_INPUT: QuickStartInput = {
  git: null,
  hasPackageJson: false,
  scripts: [],
  readmeExists: false,
  lastSessionTitle: null,
};

interface EmptySurfaceEffectsDeps {
  showEmpty: boolean;
  activeWorkspace: string | null;
  setEmptyData: Dispatch<SetStateAction<EmptySurface | null>>;
  emptyCache: MutableRefObject<Map<string, EmptySurface>>;
  sessionsLoaded: boolean;
  sessionsRef: MutableRefObject<WorkspaceSession[]>;
  composerZoneRef: MutableRefObject<HTMLDivElement | null>;
  prevEmptyRect: MutableRefObject<DOMRect | null>;
}

export function useEmptySurfaceEffects(deps: EmptySurfaceEffectsDeps) {
  const { showEmpty, activeWorkspace, setEmptyData, emptyCache, sessionsLoaded, sessionsRef, composerZoneRef, prevEmptyRect } = deps;
  // P2-1/P2-5 空屏建议装配：进入空屏（挂载 / 切项目 / ⌘N）时并发三查——
  // gitStatus（分支 + 未提交计数）/ 根目录清单（README 在场）/ package.json（test script）。
  // 失败项按 null 处理（纯函数回退自动补齐）；结果按项目路径缓存（同项目来回切不重打 IPC）。
  // 等会话清单读过一轮再装配：「继续上次」的原料是最近会话标题，抢跑会把它漏掉。
  useEffect(() => {
    if (!showEmpty) return;
    const ws = activeWorkspace;
    if (ws === null) {
      setEmptyData({ quickStarts: buildQuickStarts(NULL_QUICK_INPUT), branch: null });
      return;
    }
    const cached = emptyCache.current.get(ws);
    if (cached !== undefined) { setEmptyData(cached); return; }
    if (!sessionsLoaded) return;
    let alive = true;
    void (async () => {
      const [git, list, pkg] = await Promise.all([
        window.agent.gitStatus(ws).catch(() => null),
        window.agent.workspaceListDir("").catch(() => null),
        window.agent.workspaceReadText("package.json").catch(() => null),
      ]);
      if (!alive) return;
      const scripts = ((): readonly string[] => {
        if (pkg === null || !pkg.ok) return [];
        try {
          const parsed = JSON.parse(pkg.text) as { scripts?: Record<string, unknown> };
          return parsed.scripts !== null && typeof parsed.scripts === "object" ? Object.keys(parsed.scripts) : [];
        } catch {
          return []; // 解析失败 = 无 scripts（计划判据）
        }
      })();
      const readmeExists = list !== null && list.ok && list.entries.some((en) => /^readme(\.|$)/i.test(en.name));
      const last = sessionsRef.current.find((s) => s.workspace === ws && (s.title ?? "").trim() !== "");
      const surface: EmptySurface = {
        quickStarts: buildQuickStarts({
          git: git === null ? null : git.ok ? { ok: true, branch: git.branch, dirtyFiles: git.dirtyFiles } : { ok: false },
          hasPackageJson: pkg !== null && pkg.ok,
          scripts,
          readmeExists,
          lastSessionTitle: last?.title ?? null,
        }),
        branch: git !== null && git.ok ? git.branch : null,
      };
      emptyCache.current.set(ws, surface);
      setEmptyData(surface);
    })();
    return () => { alive = false; };
  }, [showEmpty, activeWorkspace, sessionsLoaded]);

  // 下沉动画（FLIP）：空屏期间持续记录输入区位置——这就是转场时的「前一帧」。
  useLayoutEffect(() => {
    if (!showEmpty) return;
    const el = composerZoneRef.current;
    if (el !== null) prevEmptyRect.current = el.getBoundingClientRect();
  });

  // 空屏 → 对话态：从旧位补 200ms 下沉（transform + opacity）；reduced-motion 直接落位。
  useLayoutEffect(() => {
    if (showEmpty) return;
    const el = composerZoneRef.current;
    const prev = prevEmptyRect.current;
    if (el === null || prev === null) return;
    prevEmptyRect.current = null; // 只在「空屏 → 对话」这一步动画一次
    const next = el.getBoundingClientRect();
    const dy = prev.top - next.top;
    if (Math.abs(dy) < 8) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    el.animate(
      [
        { transform: `translateY(${String(dy)}px)`, opacity: 0.6 },
        { transform: "translateY(0px)", opacity: 1 },
      ],
      { duration: 200, easing: "ease-out" },
    );
  }, [showEmpty]);


  return {  };
}
