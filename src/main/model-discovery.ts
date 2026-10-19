// 探测（discovery）的 IO 壳：`GET {baseURL}/models`，也就是三段式的**第一跳**。
//
// 三条与同行对齐的规矩（2026-10-06 调研：claude code 的 gateway model discovery 协议）：
//   · **默认关** —— 探测只在用户显式要求时才发生（本模块的每个调用点都在用户命令分支里）。
//     理由同 claude code：共享 key 的场景下，无脑探测会把钥匙能访问的所有模型摊到每个用户面前；
//     在我们这里是「不该在你只想知道有哪些模型时，先把你的钥匙发给一个地址」。
//   · **不跟随重定向** —— 数据源请求重定向会把请求（连 Authorization 头）带到别处，一律当失败。
//   · **短超时** —— 5 秒。探测拉不动不该拖住用户的任务；失败就退回「让用户手填」，不静默重试。
//
// 另加两条本仓自己的：
//   · key 只从**环境变量**读，命令行不接受 key 值（那会进 shell 历史与 ps）；缺 key 时明确报
//     「哪条命令配哪个变量」，而不是发一个没鉴权的请求让上游回 401 让人猜。
//   · 非 https 必须显式 `allowLocalEndpoint` 且主机要在回环/私网里（本地模型是合法场景，
//     但「默认允许把带钥匙的请求发向内网」不是）。
import { isLocalHostname } from "../providers/provider-config";
import { parseModelList, type DiscoveredModel, type DiscoveryProtocol } from "../providers/discovery";

/** 探测请求的超时（ms）。短：这是「顺手问一句」，不是任务本身。 */
export const DISCOVERY_TIMEOUT_MS = 5_000;
/** 响应体上限：上游换成 HTML 错误页时不该把内存吃光。 */
const MAX_BODY_BYTES = 8 * 1024 * 1024;

/** 各协议的模型清单端点。三支适配器各自的 URL 拼法在这里各写一遍是**故意的**：
 *  它们必须与适配器真拨的地址同源（openai `{base}/chat/completions`、anthropic `{base}/v1/messages`、
 *  gemini `{base}/v1beta/models/...`）——探测打到别的路径就等于问错了门。 */
export function modelsEndpointFor(protocol: DiscoveryProtocol, baseURL: string): string {
  const base = baseURL.replace(/\/+$/, "");
  switch (protocol) {
    case "openai":
      return `${base}/models`;
    case "anthropic":
      return `${base}/v1/models`;
    case "gemini":
      return `${base}/v1beta/models?pageSize=200`;
  }
}

/** 各协议的鉴权头（与三支适配器逐字一致；改这里必须同时改适配器，否则探测能过、真跑 401）。 */
export function authHeaderFor(protocol: DiscoveryProtocol, key: string): Record<string, string> {
  switch (protocol) {
    case "openai":
      return { Authorization: `Bearer ${key}` };
    case "anthropic":
      return { "x-api-key": key, "anthropic-version": "2023-06-01" };
    case "gemini":
      return { "x-goog-api-key": key };
  }
}

export interface DiscoverInput {
  baseURL: string;
  protocol: DiscoveryProtocol;
  /** key 的环境变量名；给了就从 env 里读值。**不接受直接给值**（那是调用方的事，这里只收名字）。 */
  keyEnv?: string;
  allowLocalEndpoint?: boolean;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export type DiscoverOutcome =
  | { ok: true; models: readonly DiscoveredModel[]; requestURL: string }
  | { ok: false; reason: DiscoverFailure; message: string; requestURL?: string; status?: number };

export type DiscoverFailure =
  | "bad-url"
  | "insecure-endpoint"
  | "no-key"
  | "redirect"
  | "http"
  | "timeout"
  | "network"
  | "shape";

/** 问一次「这家有哪些模型」。失败一律返回原因，**不抛**：探测失败是常态（自建网关没这个端点），
 *  调用方要能优雅地退回「手填」，而不是让整条命令崩掉。 */
export async function discoverModels(input: DiscoverInput): Promise<DiscoverOutcome> {
  let parsed: URL;
  try {
    parsed = new URL(input.baseURL);
  } catch {
    return { ok: false, reason: "bad-url", message: `baseURL 不是合法 URL：${input.baseURL}` };
  }
  const local = isLocalHostname(parsed.hostname);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && input.allowLocalEndpoint === true && local)) {
    return {
      ok: false,
      reason: "insecure-endpoint",
      message: `只允许 https（收到 ${parsed.protocol}//）；本地/内网端点要显式放行（providers.json 的 allowLocalEndpoint）`,
    };
  }

  const env = input.env ?? process.env;
  const keyEnv = input.keyEnv !== undefined && input.keyEnv.trim() !== "" ? input.keyEnv.trim() : undefined;
  const key = keyEnv === undefined ? undefined : (env[keyEnv] ?? "").trim();
  if (key === undefined || key === "") {
    return {
      ok: false,
      reason: "no-key",
      message:
        keyEnv === undefined
          ? "没有指定 key 的环境变量名（探测必须带鉴权：缺 key 时上游一律回 401，问了也白问）"
          : `环境变量 ${keyEnv} 没有值。先：export ${keyEnv}=<你的 key>（命令行不接受 key 值本身——会进 shell 历史）`,
    };
  }

  const requestURL = modelsEndpointFor(input.protocol, input.baseURL);
  const timeoutMs = input.timeoutMs ?? DISCOVERY_TIMEOUT_MS;
  const doFetch = input.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(requestURL, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: "application/json", ...authHeaderFor(input.protocol, key) },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const timedOut = /abort|timeout/i.test(message);
    return { ok: false, reason: timedOut ? "timeout" : "network", message: `${timedOut ? "超时" : "请求失败"}：${message}`, requestURL };
  }

  if (res.status >= 300 && res.status < 400) {
    return {
      ok: false,
      reason: "redirect",
      message: `上游返回重定向 ${res.status}（不跟随：会把带密钥的请求带到别处）。请把地址改成最终地址`,
      requestURL,
    };
  }
  if (!res.ok) {
    return { ok: false, reason: "http", message: `上游 HTTP ${res.status}`, requestURL, status: res.status };
  }

  let text: string;
  try {
    text = await res.text();
  } catch (err) {
    return { ok: false, reason: "network", message: `读响应失败：${err instanceof Error ? err.message : String(err)}`, requestURL };
  }
  if (text.length > MAX_BODY_BYTES) {
    return { ok: false, reason: "shape", message: `响应体 ${text.length} 字节，超过上限（是不是打到了网页而不是接口）`, requestURL };
  }
  try {
    const parsedBody: unknown = JSON.parse(text);
    const models = parseModelList(input.protocol, parsedBody);
    return { ok: true, models, requestURL };
  } catch (err) {
    return { ok: false, reason: "shape", message: err instanceof Error ? err.message : String(err), requestURL };
  }
}
