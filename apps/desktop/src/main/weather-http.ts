// 联网天气源（**默认关**）：只有用户在设置里填了 URL 才会被调用。
//
// 纪律：
//  · 超时 3 秒、只 GET、只读 JSON（不做重试风暴）；
//  · 任何失败（网络/状态码/载荷）都返回 `{kind: null, reason}`，**不抛**——
//    调用方按「回落手动档」处理，页面不会因为天气源挂了而崩；
//  · key 只放进请求头（`x-api-key`），不接受 URL 里带 key 的写法（会被日志/历史泄露）。
import { weatherFromPayload, type WeatherKind } from "../../../../src/wallpaper/weather";

export const WEATHER_HTTP_TIMEOUT_MS = 3000;

export interface FetchWeatherInput {
  url: string;
  apiKey?: string | null;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface FetchWeatherResult {
  kind: WeatherKind | null;
  reason: string;
  status?: number;
}

export async function fetchWeather(input: FetchWeatherInput): Promise<FetchWeatherResult> {
  const url = input.url.trim();
  if (!/^https?:\/\//i.test(url)) return { kind: null, reason: "URL 必须是 http(s)" };
  if (url.includes("?") && /[?&](key|appid|api_key)=/i.test(url)) {
    return { kind: null, reason: "别把 key 放 URL 里（放请求头）" };
  }
  const doFetch = input.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? WEATHER_HTTP_TIMEOUT_MS);
  try {
    const res = await doFetch(url, {
      method: "GET",
      headers: input.apiKey === undefined || input.apiKey === null || input.apiKey === ""
        ? {} : { "x-api-key": input.apiKey },
      signal: controller.signal,
    });
    if (!res.ok) return { kind: null, reason: `天气源返回 ${String(res.status)}`, status: res.status };
    const json = (await res.json()) as unknown;
    const kind = weatherFromPayload(json);
    return kind === null
      ? { kind: null, reason: "载荷读不懂", status: res.status }
      : { kind, reason: "ok", status: res.status };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return { kind: null, reason: aborted ? "超时" : (error instanceof Error ? error.message : String(error)) };
  } finally {
    clearTimeout(timer);
  }
}
