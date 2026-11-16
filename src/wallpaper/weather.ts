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

/**
 * 天气**外部源**的解析（离线优先）：外部写一个 JSON，我们读它。
 *
 * 支持两种形状，都是为了「让别人能喂数据」而不是逼我们联网：
 *   `{"kind": "rain"}`            —— 直接给四档之一
 *   `{"code": 500}` / `{"code": "500"}` —— OpenWeather 风格代码，走 `weatherFromCode`
 * 读不懂 ⇒ null（调用方保持手动档，不猜）。
 */
export function weatherFromJson(raw: unknown): WeatherKind | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as { kind?: unknown; code?: unknown };
  if (isWeatherKind(r.kind)) return r.kind;
  const code = typeof r.code === "number" ? r.code : typeof r.code === "string" ? Number(r.code) : NaN;
  if (!Number.isFinite(code)) return null;
  return weatherFromCode(code);
}

/**
 * 联网源的**载荷**解析（默认关，只有用户填了 URL 才会走到）：
 *   `{"weather":[{"id":500}]}` —— OpenWeather 形状
 *   `{"code":500}` / `{"kind":"rain"}` —— 我们自己约定的简化形状
 */
export function weatherFromPayload(raw: unknown): WeatherKind | null {
  const direct = weatherFromJson(raw);
  if (direct !== null) return direct;
  // Open-Meteo（无 key）：`{current_weather:{weathercode: 61}}`
  if (typeof raw === "object" && raw !== null) {
    const cur = (raw as { current_weather?: unknown }).current_weather;
    if (typeof cur === "object" && cur !== null) {
      const wc = (cur as { weathercode?: unknown }).weathercode;
      const code = typeof wc === "number" ? wc : typeof wc === "string" ? Number(wc) : NaN;
      if (Number.isFinite(code)) return weatherFromWmoCode(code);
    }
  }
  if (typeof raw === "object" && raw !== null) {
    const arr = (raw as { weather?: unknown }).weather;
    if (Array.isArray(arr)) {
      const first = arr[0] as { id?: unknown } | undefined;
      const id = typeof first?.id === "number" ? first.id : typeof first?.id === "string" ? Number(first.id) : NaN;
      if (Number.isFinite(id)) return weatherFromCode(id);
    }
  }
  return null;
}

/** WMO 天气代码（Open-Meteo 用）→ 我们的四档。 */
export function weatherFromWmoCode(code: number): WeatherKind {
  if (code === 0) return "clear";
  if (code <= 3 || code === 45 || code === 48) return "clouds";
  if (code >= 51 && code <= 67) return "rain";
  if (code >= 71 && code <= 77) return "snow";
  if (code >= 80 && code <= 82) return "rain";
  if (code === 85 || code === 86) return "snow";
  if (code >= 95) return "rain";
  return "clouds";
}

/** 从文本读（文件源用）：非 JSON 或读不懂 ⇒ null。 */
export function weatherFromText(text: string): WeatherKind | null {
  try {
    return weatherFromJson(JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}
