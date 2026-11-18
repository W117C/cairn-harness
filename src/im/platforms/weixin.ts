// 微信 iLink 机器人适配器（2026-11-18 · 通道线 v81）。
//
// 官方机器人平台（ilinkai.weixin.qq.com）：扫码登录建连——get_bot_qrcode 出码、
// get_qrcode_status 长轮询到机主确认，回包带 bot_token / baseurl / ilink_bot_id /
// ilink_user_id；此后 msg/notifystart 开会话，getupdates 长轮询送消息（游标
// get_updates_buf 与每用户 context_token 存连接运行态，重启不重放）；发送走
// sendmessage 带该用户的 context_token，1800 字分片。
//
// 协议参考 dsh-im（MIT）与本地参照仓（Apache-2.0），本文件是按协议行为写的
// TypeScript 独立实现，fetch 全注入，零新依赖。
// 安全（Mimosa 约束）：iLink 服务端回的 baseurl 是**服务端可控 URL**——发 token 前
// assertIlinkEndpoint 钉死 https + *.weixin.qq.com，拒绝私有/保留地址。
// 类型边放最前：执行路径尺按「import 语句」切边，包导入在前会把下一条相对 import 的
// 语句头读成值边（第 80 页尺的已知切法），纯契约面就会被误判成可执行。
import type { ImAdapterHandle, ImConnectHandlers, ImEnv, ImPlatformAdapter, ImChat } from "../types";
import { randomBytes } from "node:crypto";
import { chunkText } from "../format";

export const WEIXIN_TEXT_LIMIT = 1800;
const QR_BASE = "https://ilinkai.weixin.qq.com/";
const POLL_TIMEOUT_MS = 35_000;
// iLink 客户端版本，0x00MMNNPP 打包：2.4.6 为协议参照客户端自报的版本。
const ILINK_CLIENT_VERSION = (2 << 16) | (4 << 8) | 6;
// 会话未开时 getupdates 的应答码：必须重新扫码。
const SESSION_EXPIRED = -14;
const START_RETRY_DELAYS_MS = [250, 1_000, 3_000];

/** 出站 URL 校验：仅 https + 微信官方域，拒绝 localhost/回环/私有/保留地址。 */
export function assertIlinkEndpoint(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw Object.assign(new Error("iLink 地址不是合法 URL"), { permanent: true });
  }
  if (parsed.protocol !== "https:") {
    throw Object.assign(new Error(`iLink 协议只许 https，收到 ${parsed.protocol.replace(":", "")}`), { permanent: true });
  }
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw Object.assign(new Error(`iLink 主机不可信：${host}`), { permanent: true });
  }
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
    throw Object.assign(new Error(`iLink 主机不可信：${host}`), { permanent: true });
  }
  if (host !== "ilinkai.weixin.qq.com" && !host.endsWith(".weixin.qq.com")) {
    throw Object.assign(new Error(`iLink 主机不是官方域：${host}`), { permanent: true });
  }
  return `${url.replace(/\/+$/, "")}/`;
}

// ── 请求助手 ─────────────────────────────────────────────────────────────────

const clientHeaders = (): Record<string, string> => ({
  "iLink-App-Id": "bot",
  "iLink-App-ClientVersion": String(ILINK_CLIENT_VERSION),
});

/** X-WECHAT-UIN：随机 uint32 的 base64（协议参照每次现铸，不持有）。 */
function randomUin(): string {
  return Buffer.from(String(randomBytes(4).readUInt32BE(0)), "utf8").toString("base64");
}

/** iLink 成功的 getupdates 应答不带 ret——应答自证形状（坏代理/旧端点不得算作空闲轮询）。 */
function isUpdatesAnswer(answer: Record<string, unknown>): boolean {
  return Array.isArray(answer.msgs) || typeof answer.get_updates_buf === "string" || typeof answer.sync_buf === "string";
}

async function request(
  env: ImEnv,
  baseUrl: string,
  token: string | undefined,
  endpoint: string,
  body: Record<string, unknown>,
  timeoutMs = POLL_TIMEOUT_MS,
  opts: { requireJson?: boolean } = {},
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  timer.unref?.();
  let response: Response;
  try {
    response = await env.fetch(`${baseUrl}ilink/bot/${endpoint}`, {
      method: "POST",
      headers: {
        ...clientHeaders(),
        "content-type": "application/json",
        "X-WECHAT-UIN": randomUin(),
        ...(token === undefined ? {} : { authorization: `Bearer ${token}`, AuthorizationType: "ilink_bot_token" }),
      },
      body: JSON.stringify({ ...body, base_info: { channel_version: "cairn" } }),
      signal: controller.signal,
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "AbortError" || /timeout|aborted/i.test(error.message));
    throw Object.assign(new Error(timedOut ? "timeout" : error instanceof Error ? error.message : String(error)), { timeout: timedOut });
  } finally {
    clearTimeout(timer);
  }
  const text = await response.text().catch(() => "");
  let parsed: unknown;
  try {
    parsed = text === "" ? {} : JSON.parse(text) as unknown;
  } catch {
    parsed = undefined;
  }
  const json = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : undefined;
  if (response.status === 429 || json?.ret === 429) {
    throw Object.assign(new Error("微信限流了请求"), { retryAfter: Number(response.headers.get("retry-after")) });
  }
  if (response.status === 401 || response.status === 403) {
    throw Object.assign(new Error("微信拒绝了令牌"), { permanent: true });
  }
  if (!response.ok) throw new Error(`微信应答 ${String(response.status)}`);
  if (json === undefined) {
    if (opts.requireJson === true) {
      throw Object.assign(new Error("微信应答读不出 JSON"), { status: response.status });
    }
    return {};
  }
  return json;
}

// ── 扫码登录（设置面的二维码流驱动）─────────────────────────────────────────

/** loginId → { qrcode, expiresAt }；适配器模块级持有（与参照仓同式）。 */
const logins = new Map<string, { qrcode: string; expiresAt: number }>();

export async function loginStartWeixin(env: ImEnv): Promise<{ loginId: string; qr: string; expiresAt: number }> {
  const base = assertIlinkEndpoint(QR_BASE);
  const response = await env.fetch(`${base}ilink/bot/get_bot_qrcode?bot_type=3`, {
    method: "POST",
    headers: { ...clientHeaders(), "content-type": "application/json" },
    body: JSON.stringify({ local_token_list: [] }),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof body.qrcode !== "string" || body.qrcode === "") {
    throw new Error(body.errmsg === undefined ? "微信没有返回二维码" : String(body.errmsg));
  }
  const loginId = `wx_${randomBytes(8).toString("hex")}`;
  const expiresAt = Date.now() + 5 * 60_000;
  logins.set(loginId, { qrcode: body.qrcode, expiresAt });
  for (const [id, held] of logins) if (held.expiresAt < Date.now()) logins.delete(id);
  const qr = typeof body.qrcode_img_content === "string" && body.qrcode_img_content !== "" ? body.qrcode_img_content : body.qrcode;
  return { loginId, qr, expiresAt };
}

export async function loginWaitWeixin(
  loginId: string,
  env: ImEnv,
): Promise<{
  status: "waiting" | "scanned" | "expired" | "done";
  connection?: { settings: Record<string, string>; secrets: Record<string, string>; account: { id: string; name: string } };
  owner?: { id: string; name: string };
}> {
  const held = logins.get(loginId);
  if (held === undefined || held.expiresAt < Date.now()) {
    logins.delete(loginId);
    return { status: "expired" };
  }
  const base = assertIlinkEndpoint(QR_BASE);
  const response = await env.fetch(`${base}ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(held.qrcode)}`, {
    headers: clientHeaders(),
    signal: AbortSignal.timeout?.(POLL_TIMEOUT_MS),
  }).catch(() => undefined);
  const body = (await response?.json().catch(() => ({})) ?? {}) as Record<string, unknown>;
  const status = String(body.status ?? "wait");
  if (status === "expired" || status === "invalid") {
    logins.delete(loginId);
    return { status: "expired" };
  }
  if (status === "scaned" || status === "scaned_but_redirect" || status === "binded_redirect") return { status: "scanned" };
  if (status !== "confirmed") return { status: "waiting" };
  logins.delete(loginId);
  const baseUrl = assertIlinkEndpoint(typeof body.baseurl === "string" && body.baseurl !== "" ? body.baseurl : QR_BASE);
  return {
    status: "done",
    connection: {
      settings: { baseUrl, ilinkBotId: String(body.ilink_bot_id ?? "") },
      secrets: { token: String(body.bot_token ?? "") },
      account: { id: String(body.ilink_bot_id ?? ""), name: "WeChat" },
    },
    owner: { id: String(body.ilink_user_id ?? ""), name: String(body.ilink_user_id ?? "") },
  };
}

// ── 会话与收发 ───────────────────────────────────────────────────────────────

/** check：用 token 打一次短 getupdates——ret 0 / 自证形状即有效令牌。 */
export async function checkWeixin(
  fields: Record<string, string>,
  env: ImEnv,
): Promise<{ account: { id: string; name: string } }> {
  const base = assertIlinkEndpoint(typeof fields.baseUrl === "string" && fields.baseUrl !== "" ? fields.baseUrl : QR_BASE);
  const answer = await request(env, base, fields.token, "getupdates", { get_updates_buf: "", timeout_ms: 0 }, 8_000, { requireJson: true });
  if (answer.ret !== undefined) {
    if (Number(answer.ret) !== 0) {
      throw Object.assign(new Error(`微信应答 ${String(answer.ret)}`), { permanent: true });
    }
  } else if (!isUpdatesAnswer(answer)) {
    throw Object.assign(new Error("微信应答读不出形状"), { permanent: true });
  }
  return { account: { id: String(fields.ilinkBotId ?? ""), name: "WeChat" } };
}

/** 开会话：getupdates 之前必须 msg/notifystart，否则服务端一直答 errcode -14。 */
async function notifyStart(env: ImEnv, baseUrl: string, token: string): Promise<void> {
  const answer = await request(env, baseUrl, token, "msg/notifystart", {}, 10_000);
  const code = answer.errcode ?? answer.ret;
  if (code === undefined || Number(code) === 0) return;
  const reason = Number(code) === SESSION_EXPIRED
    ? "微信会话已过期，请重新扫码"
    : `微信没有开会话（${String(code)}）`;
  throw Object.assign(new Error(reason), { permanent: true });
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 适配器外壳（connect 的运行句柄）。 */
export function connectWeixin(
  fields: Record<string, string>,
  env: ImEnv,
  handlers: ImConnectHandlers,
): ImAdapterHandle {
  let stopped = false;
  let generation = 0;
  const base = assertIlinkEndpoint(typeof fields.baseUrl === "string" && fields.baseUrl !== "" ? fields.baseUrl : QR_BASE);
  const token = String(fields.token ?? "");
  const runtime = (): Record<string, string> => env.runtime?.get() ?? {};
  const setRuntime = (patch: Record<string, string>): void => {
    env.runtime?.set(patch);
  };

  const deliver = async (msg: Record<string, unknown>): Promise<void> => {
    const userId = String(msg.from_user_id ?? "");
    if (userId === "") return;
    if (typeof msg.context_token === "string" && msg.context_token !== "") {
      let tokens: Record<string, string> = {};
      const rawTokens = runtime().contextTokensJson;
      if (typeof rawTokens === "string" && rawTokens !== "") {
        try { tokens = JSON.parse(rawTokens) as Record<string, string>; } catch { tokens = {}; }
      }
      tokens[userId] = String(msg.context_token);
      setRuntime({ contextTokensJson: JSON.stringify(tokens) });
    }
    const items = Array.isArray(msg.item_list) ? msg.item_list : [];
    const texts: string[] = [];
    for (const item of items) {
      const rec = (item ?? {}) as Record<string, unknown>;
      // type 1 = 文本；type 3 = 语音条（带转写文本）。图片/文件 V1 不收（如实范围）。
      if (rec.type === 1 || rec.type === 3) {
        const inner = (rec.text_item ?? rec.voice_item ?? {}) as Record<string, unknown>;
        if (typeof inner.text === "string") texts.push(inner.text);
      }
    }
    await handlers.onMessage({
      chat: { key: userId, kind: "direct", title: "" },
      sender: { id: userId, name: userId },
      text: texts.join("\n").trim(),
      mentioned: true,
      messageId: String(msg.client_id ?? msg.message_id ?? ""),
    });
  };

  const contextTokenOf = (userId: string): string | undefined => {
    const raw = runtime().contextTokensJson;
    if (typeof raw !== "string" || raw === "") return undefined;
    try {
      return (JSON.parse(raw) as Record<string, string>)[userId];
    } catch {
      return undefined;
    }
  };

  const poll = async (): Promise<void> => {
    const gen = generation;
    while (!stopped && generation === gen) {
      let answer: Record<string, unknown>;
      try {
        answer = await request(env, base, token, "getupdates", { get_updates_buf: runtime().cursor ?? "" }, POLL_TIMEOUT_MS + 15_000, { requireJson: true });
      } catch (error) {
        if (stopped || generation !== gen) return;
        const permanent = (error as { permanent?: boolean }).permanent === true;
        const timeout = (error as { timeout?: boolean }).timeout === true;
        if (timeout) continue;
        env.log?.warn?.("weixin poll failed: %s", error instanceof Error ? error.message : String(error));
        handlers.onStatus(permanent ? { state: "error", error: error instanceof Error ? error.message : String(error) } : { state: "connecting" });
        if (permanent) return;
        await sleepMs(3_000);
        continue;
      }
      const code = answer.ret ?? answer.errcode;
      if (code !== undefined && Number(code) === SESSION_EXPIRED) {
        handlers.onStatus({ state: "error", error: "微信会话已过期，请重新扫码" });
        return;
      }
      if (answer.ret !== undefined && Number(answer.ret) !== 0) {
        env.log?.warn?.("weixin getupdates answered %s", String(answer.ret));
        if (Number(answer.ret) === 401 || Number(answer.ret) === 403) {
          handlers.onStatus({ state: "error", error: `微信应答 ${String(answer.ret)}` });
          return;
        }
        await sleepMs(3_000);
        continue;
      }
      if (!isUpdatesAnswer(answer)) {
        handlers.onStatus({ state: "connecting" });
        await sleepMs(3_000);
        continue;
      }
      handlers.onStatus({ state: "ready" });
      if (typeof answer.get_updates_buf === "string" && answer.get_updates_buf !== runtime().cursor) {
        setRuntime({ cursor: answer.get_updates_buf });
      }
      for (const msg of Array.isArray(answer.msgs) ? answer.msgs as Record<string, unknown>[] : []) {
        await deliver(msg).catch((error) => env.log?.warn?.("weixin message failed: %s", error instanceof Error ? error.message : String(error)));
      }
    }
  };

  const startSession = async (): Promise<void> => {
    for (let attempt = 0; ; attempt += 1) {
      if (stopped) return;
      try {
        await notifyStart(env, base, token);
        break;
      } catch (error) {
        if (stopped) return;
        const permanent = (error as { permanent?: boolean }).permanent === true;
        if (permanent) {
          handlers.onStatus({ state: "error", error: error instanceof Error ? error.message : String(error) });
          return;
        }
        await sleepMs(START_RETRY_DELAYS_MS[Math.min(attempt, START_RETRY_DELAYS_MS.length - 1)]);
      }
    }
    if (!stopped) void poll();
  };
  handlers.onStatus({ state: "connecting" });
  void startSession();

  return {
    send: async (chat: ImChat, text: string, opts?: { idempotencyKey?: string }): Promise<{ messageId?: string }> => {
      let last: string | undefined;
      let part = 0;
      for (const chunk of chunkText(text, WEIXIN_TEXT_LIMIT)) {
        // 幂等键：宿主给了就**按分片派生**（同一条 job 重试 → 同一个键 ⇒ 平台去重）；
        // 没给才自己生成（单次调用语义，与旧行为一致）。
        const clientId = opts?.idempotencyKey === undefined
          ? `cairn-${randomBytes(8).toString("hex")}`
          : `${opts.idempotencyKey}-${String(part)}`;
        part += 1;
        const contextToken = contextTokenOf(chat.key);
        const answer = await request(env, base, token, "sendmessage", {
          msg: {
            from_user_id: "",
            to_user_id: chat.key,
            client_id: clientId,
            message_type: 2,
            message_state: 2,
            item_list: [{ type: 1, text_item: { text: chunk } }],
            ...(contextToken === undefined ? {} : { context_token: contextToken }),
          },
        });
        if (answer.ret !== undefined && Number(answer.ret) !== 0) {
          throw Object.assign(new Error(`微信拒收回信（${String(answer.errmsg ?? answer.ret)}）`), { permanent: true });
        }
        last = clientId;
      }
      return last === undefined ? {} : { messageId: last };
    },
    stop: () => {
      stopped = true;
      generation += 1;
    },
  };
}

/** 平台注册条目（platforms.ts 汇总）。 */
export const weixinAdapter: ImPlatformAdapter = {
  connect: connectWeixin,
  check: checkWeixin,
  loginStart: loginStartWeixin,
  loginWait: loginWaitWeixin,
};
