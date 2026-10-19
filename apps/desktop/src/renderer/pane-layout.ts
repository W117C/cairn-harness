// 窗格行高记忆（批 98）：react-resizable-panels 的 Grid 布局以**轨道 id**为键。
// 行轨 id 取窗格 kind（不是行下标）——重排/关开后尺寸跟着窗格走，不会串到邻居；
// 关闭的窗格把尺寸留在存储里，重开即回原位（而不是回到均分）。
export const PANE_ROWS_KEY = "cairn.paneRows.v1";
/** 每格的保底高度（百分比）。Grid 的 minSize 同用这一枚，免得两处各写一个数。 */
export const MIN_PANE_PCT = 10;

export type PaneRowMap = Record<string, number>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 存储串 → 行高表；坏 JSON / 非数 / 非正 / 非有限一律丢（不编默认值）。 */
export function decodePaneRows(raw: string | null): PaneRowMap {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw ?? "null");
  } catch {
    return {};
  }
  if (!isRecord(parsed)) return {};
  const out: PaneRowMap = {};
  for (const [kind, value] of Object.entries(parsed)) {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) continue;
    out[kind] = Math.min(100, value);
  }
  return out;
}

/**
 * 当前窗格集 → 完整行高表（键 = kind，和 = 100）。
 * 规则：已知尺寸照旧；新窗格先按保底 10% 计，总和超出时从所有格「保底以上的部分」等比扣
 * （保存的比例不丢，新格恰好落在保底）；总和不足 100 时等比放大。返回表覆盖每个 present kind。
 */
export function paneRowLayout(tabs: readonly string[], saved: PaneRowMap, min = MIN_PANE_PCT): Record<string, number> {
  const present = [...new Set(tabs)];
  const n = present.length;
  if (n === 0) return {};
  const floor = Math.min(min, 100 / n);
  const base = present.map((kind) => Math.max(floor, saved[kind] ?? floor));
  const sum = base.reduce((acc, v) => acc + v, 0);
  let values = base;
  if (sum > 100) {
    const room = sum - n * floor;
    const excess = sum - 100;
    values = excess >= room
      ? present.map(() => 100 / n)
      : base.map((v) => floor + (v - floor) * ((room - excess) / room));
  } else if (sum < 100) {
    values = base.map((v) => (v * 100) / sum);
  }
  const out: Record<string, number> = {};
  present.forEach((kind, i) => { out[kind] = values[i] ?? 100 / n; });
  return out;
}

/** 用户拖动后落盘：当前窗格取新值，旧表里**没开着**的窗格原样留着（关了也记得）。 */
export function mergePaneRows(previous: PaneRowMap, rows: Record<string, number>, tabs: readonly string[]): PaneRowMap {
  const out: PaneRowMap = { ...previous };
  for (const kind of new Set(tabs)) {
    const value = rows[kind];
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) continue;
    out[kind] = value;
  }
  return out;
}

/** localStorage 读取（SSR 与存储异常都回空表；窗格布局不是致命状态，不弹错）。 */
export function loadPaneRows(): PaneRowMap {
  if (typeof window === "undefined") return {};
  try {
    return decodePaneRows(window.localStorage.getItem(PANE_ROWS_KEY));
  } catch {
    return {};
  }
}

export function savePaneRows(rows: PaneRowMap): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PANE_ROWS_KEY, JSON.stringify(rows));
  } catch {
    /* 存不下则本会话内生效（调用方已经拿到新布局） */
  }
}
