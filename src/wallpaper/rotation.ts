import { isDaylight } from "./solar";

// 定时/昼夜轮换的**决定**部分（纯函数）：到点了没？下一个是谁？现在是白天还是夜里？
//
// 口径：
//  ① 轮换只在 enabled 且候选 ≥2 时才有意义（1 张「轮换」是自欺）；
//  ② 到点 = `now - lastAt >= everyMinutes * 60_000`；`lastAt = 0`（从未轮换）算「已到点」；
//  ③ 下一个 = 当前路径在候选里的下一位（绕回）；当前不在候选里 ⇒ 取第一条（并说明原因）；
//  ④ 读不出来的候选（不存在）**跳过**，并在 missing 里点名——不静默。
export interface RotationDecision {
  rotate: boolean;
  path: string | null;
  reason: string;
  missing: string[];
}

export function rotationDue(input: { lastAt: number; now: number; everyMinutes: number }): boolean {
  if (input.lastAt <= 0) return true;
  const every = Math.max(1, input.everyMinutes) * 60_000;
  return input.now - input.lastAt >= every;
}

export function decideRotation(input: {
  enabled: boolean;
  everyMinutes: number;
  paths: readonly string[];
  current: string | null;
  lastAt: number;
  now: number;
  exists?: (path: string) => boolean;
}): RotationDecision {
  const missing = input.exists === undefined ? [] : input.paths.filter((p) => !input.exists!(p));
  const usable = input.exists === undefined ? [...input.paths] : input.paths.filter((p) => input.exists!(p));
  if (!input.enabled) return { rotate: false, path: null, reason: "轮换没开", missing };
  if (usable.length < 2) return { rotate: false, path: null, reason: "候选少于两张，轮换没有意义", missing };
  if (!rotationDue({ lastAt: input.lastAt, now: input.now, everyMinutes: input.everyMinutes })) {
    return { rotate: false, path: null, reason: "还没到点", missing };
  }
  const index = input.current === null ? -1 : usable.indexOf(input.current);
  const next = usable[(index + 1) % usable.length]!;
  return {
    rotate: true, path: next, missing,
    reason: index === -1 ? "当前壁纸不在候选里，取第一条" : "到点换下一张",
  };
}

/** 日出日落模式：白天/夜里各一张，按当前时刻选。 */
export function decideDayNight(input: {
  dayPath: string | null;
  nightPath: string | null;
  now: Date;
  latitude: number;
  longitude: number;
  exists?: (path: string) => boolean;
}): { path: string | null; reason: string; phase: "day" | "night" } {
  const daylight = isDaylight(input.now, input.latitude, input.longitude);
  const phase: "day" | "night" = daylight ? "day" : "night";
  const candidate = daylight ? input.dayPath : input.nightPath;
  if (candidate === null) return { path: null, reason: daylight ? "没配白天那张" : "没配夜里那张", phase };
  if (input.exists !== undefined && !input.exists(candidate)) {
    return { path: null, reason: "选中的那张读不出来", phase };
  }
  return { path: candidate, reason: daylight ? "现在是白天" : "现在是夜里", phase };
}
