// 按天气切换壁纸：**只做决定**，天气从哪来由调用方给（默认不联网）。
//
// 为什么不自己发网络请求：这个产品默认零外联（CSP 里 connect-src 只放本机与 http/https，
// 但没有天气源、也没有 key）。所以这里把「天气」设计成**输入**：
//   · 默认走手动档（设置里选：晴/云/雨/雪）——完全离线、可判；
//   · 将来接真源时，只把 `kind` 换掉，切换逻辑一行不改（`weatherFromCode` 给了映射表）。
//
// 口径：
//  ① 没配那种天气的壁纸 ⇒ 不换并说明（不猜、不回落到别的天气）；
//  ② 路径读不出来 ⇒ 不换并说明；
//  ③ 天气种类固定四个（clear/clouds/rain/snow），未知值一律按 `clear` 处理并在校验里被丢。
export const WEATHER_KINDS = ["clear", "clouds", "rain", "snow"] as const;
export type WeatherKind = (typeof WEATHER_KINDS)[number];

export function isWeatherKind(v: unknown): v is WeatherKind {
  return typeof v === "string" && (WEATHER_KINDS as readonly string[]).includes(v);
}

/** OpenWeather 风格的天气代码 → 我们的四档（将来接真源时用；现在只被判据用到）。 */
export function weatherFromCode(code: number): WeatherKind {
  if (code >= 200 && code < 600) return "rain";      // 雷暴/毛毛雨/雨
  if (code >= 600 && code < 700) return "snow";      // 雪
  if (code >= 700 && code < 800) return "clouds";    // 雾/霾等
  if (code === 800) return "clear";
  if (code > 800) return "clouds";
  return "clear";
}

export interface WeatherDecision {
  path: string | null;
  reason: string;
}

export function decideWeather(input: {
  kind: WeatherKind;
  paths: Partial<Record<WeatherKind, string>>;
  exists?: (path: string) => boolean;
}): WeatherDecision {
  const candidate = input.paths[input.kind] ?? null;
  if (candidate === null) return { path: null, reason: `没配「${input.kind}」那张` };
  if (input.exists !== undefined && !input.exists(candidate)) return { path: null, reason: "配的那张读不出来" };
  return { path: candidate, reason: `现在是 ${input.kind}` };
}
