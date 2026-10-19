// 窗口位置/大小跨重启（2026-10-18）：桌面应用应回到上次的窗口，而不是每次都 1200×800 居中。
// 纯判据段（可单测）：解析/校验/夹到工作区；Electron 侧只做读写与事件接线。
import { readFileSync, writeFileSync } from "node:fs";

export type WindowState = {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized?: boolean;
};

/** 与 BrowserWindow 的 minWidth 对齐；高度给 600 下限（小于此的窗口对双栏布局没有意义）。 */
const MIN_WIDTH = 880;
const MIN_HEIGHT = 600;
const MAX_WIDTH = 8000;
const MAX_HEIGHT = 6000;

export function parseWindowState(raw: string): WindowState | null {
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== "object" || v === null) return null;
    const o = v as Record<string, unknown>;
    const nums = [o.x, o.y, o.width, o.height];
    if (!nums.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
    const x = Math.round(o.x as number);
    const y = Math.round(o.y as number);
    const width = Math.round(o.width as number);
    const height = Math.round(o.height as number);
    if (width < MIN_WIDTH || height < MIN_HEIGHT || width > MAX_WIDTH || height > MAX_HEIGHT) return null;
    return { x, y, width, height, ...(o.maximized === true ? { maximized: true } : {}) };
  } catch {
    return null;
  }
}

export function readWindowState(file: string): WindowState | null {
  try {
    return parseWindowState(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function writeWindowState(file: string, state: WindowState): void {
  try {
    writeFileSync(file, JSON.stringify(state));
  } catch {
    /* 落盘失败不阻退出/拖动 */
  }
}

/** 夹到显示器工作区：换过显示器/拔掉副屏后，窗口不能停在看不见的坐标。 */
export function clampToWorkArea(
  state: WindowState,
  area: { x: number; y: number; width: number; height: number },
): WindowState {
  const width = Math.min(state.width, area.width);
  const height = Math.min(state.height, area.height);
  const x = Math.min(Math.max(state.x, area.x), area.x + Math.max(0, area.width - width));
  const y = Math.min(Math.max(state.y, area.y), area.y + Math.max(0, area.height - height));
  return { ...state, x, y, width, height };
}
