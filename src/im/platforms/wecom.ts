// 企业微信智能机器人适配器（2026-11-18 · 通道线 v80 追加）。
//
// 一条长连 WebSocket 到官方智能机器人网关（wss://openws.work.weixin.qq.com），
// JSON 包络 { cmd, headers: { req_id }, body }：aibot_subscribe 鉴权、ping 心跳、
// aibot_msg_callback 携带入站消息（私聊 chattype=single；群聊 mention_robot 才算 @），
// 回复用回调帧的 req_id 走 aibot_respond_msg，主动发送走 aibot_send_msg（userid/chatid）。
//
// 协议参考官方 @wecom/aibot-node-sdk（MIT）与本地参照仓（Apache-2.0），本文件是按协议
// 行为写的 TypeScript 独立实现；WebSocket 构造器注入（桌面装配用 `ws` 包：网关对
// Upgrade 头的 Connection/Upgrade 大小写敏感，Node 内建 WebSocket 发小写会被 403）。
import type { ImAdapterHandle, ImConnectHandlers, ImEnv, ImPlatformAdapter, ImChat } from "../types";
import { chunkText } from "../format";

export const WECOM_TEXT_LIMIT = 4000;

/** 官方网关（固定端点；不接受 fields 覆盖 ⇒ 无用户可控 URL，SSRF 面为零）。 */
const WECOM_WSS = "wss://openws.work.weixin.qq.com";

/** 出站 URL 校验：仅 wss/https 官方域名，拒绝一切 localhost/回环/私有/保留地址。 */
function assertOfficialEndpoint(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw Object.assign(new Error("网关地址不是合法 URL"), { permanent: true });
  }
  const scheme = parsed.protocol.replace(":", "");
  if (scheme !== "wss" && scheme !== "https") {
    throw Object.assign(new Error(`网关协议只许 wss/https，收到 ${scheme}`), { permanent: true });
  }
  const host = parsed.hostname.toLowerCase().endsWith(".") ? parsed.hostname.toLowerCase().slice(0, -1) : parsed.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw Object.assign(new Error(`网关主机不可信：${host}`), { permanent: true });
  }
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
    throw Object.assign(new Error(`网关主机不可信：${host}`), { permanent: true });
  }
  if (host !== "openws.work.weixin.qq.com" && !host.endsWith(".work.weixin.qq.com")) {
    throw Object.assign(new Error(`网关主机不是官方端点：${host}`), { permanent: true });
  }
}

// ── 包络与套接字（JSON 文本帧）───────────────────────────────────────────────

interface WecomPacket {
  cmd?: string;
  headers?: { req_id?: string };
  body?: Record<string, unknown>;
  errcode?: number;
  errmsg?: string;
}

/** 校验凭据：订阅成功即凭据有效（错误 bot_id/secret 在 subscribe 应答上报错）。 */
export async function checkWecom(
  fields: Record<string, string>,
  env: ImEnv,
): Promise<{ account: { id: string; name: string } }> {
  assertOfficialEndpoint(WECOM_WSS);
  if (env.WebSocket === undefined) throw Object.assign(new Error("这个运行环境没有 WebSocket"), { permanent: true });
  const botId = String(fields.botId ?? "").trim();
  const secret = String(fields.secret ?? "").trim();
  return await new Promise((resolve, reject) => {
    let settled = false;
    let socket: WebSocket | null = null;
    const finish = (error?: Error, via?: WebSocket | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { via?.close(1000, "check"); } catch { /* not open */ }
      if (error === undefined) resolve({ account: { id: botId, name: botId } });
      else reject(error);
    };
    const timer = setTimeout(() => finish(new Error("企业微信没有应答订阅请求"), socket), 10_000);
    try {
      const WS = env.WebSocket as typeof WebSocket;
      socket = new WS(WECOM_WSS);
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)), undefined);
      return;
    }
    const ws = socket;
    ws.binaryType = "arraybuffer";
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({
        cmd: "aibot_subscribe",
        headers: { req_id: "check-1" },
        body: { secret, bot_id: botId },
      }));
    });
    ws.addEventListener("message", (event) => {
      let packet: WecomPacket;
      try {
        packet = JSON.parse(Buffer.from(event.data as ArrayBuffer).toString("utf8")) as WecomPacket;
      } catch {
        return;
      }
      if (packet.errcode === undefined) return;
      if (packet.errcode === 0) finish(undefined, ws);
      else finish(new Error(String(packet.errmsg ?? `企业微信应答 ${String(packet.errcode)}`)), ws);
    });
    ws.addEventListener("error", () => {
      finish(new Error("企业微信网关连接失败"), ws);
    });
  });
}

/** 企业微信适配器：connect 运行句柄。 */
export function connectWecom(
  fields: Record<string, string>,
  env: ImEnv,
  handlers: ImConnectHandlers,
): ImAdapterHandle {
  assertOfficialEndpoint(WECOM_WSS);
  if (env.WebSocket === undefined) {
    handlers.onStatus({ state: "error", error: "这个运行环境没有 WebSocket" });
    return { send: async () => ({}), stop: () => undefined };
  }
  const botId = String(fields.botId ?? "").trim();
  const secret = String(fields.secret ?? "").trim();
  let stopped = false;
  let socket: WebSocket | null = null;
  let generation = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let reqCounter = 0;
  // 拒绝态留在状态上，直到下一次订阅成功（参照仓同式）。
  let lastError: string | undefined;
  // 被动回复按聊天记最后一条回调 req_id；主动发送等待应答（15s 超时）。
  const lastReqId = new Map<string, string>();
  const pending = new Map<string, { resolve: (body: Record<string, unknown>) => void; reject: (e: Error) => void }>();

  const nextReqId = (): string => {
    reqCounter += 1;
    return `r${String(reqCounter)}`;
  };
  const sendFrame = (packet: WecomPacket): void => {
    if (socket !== null && socket.readyState === 1) socket.send(JSON.stringify(packet));
  };
  const request = (cmd: string, body: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const req_id = nextReqId();
    sendFrame({ cmd, headers: { req_id }, body });
    return new Promise((resolve, reject) => {
      pending.set(req_id, { resolve, reject });
      setTimeout(() => {
        if (pending.delete(req_id)) reject(Object.assign(new Error("企业微信没有应答发送"), { permanent: false }));
      }, 15_000);
    });
  };

  const onCallback = async (headers: { req_id?: string }, body: Record<string, unknown>): Promise<void> => {
    const direct = body.chattype === "single";
    const key = String(direct ? (body.from as Record<string, unknown> | undefined)?.userid ?? "" : body.chatid ?? "");
    if (key === "") return;
    lastReqId.set(key, String(headers?.req_id ?? ""));
    const text = String((body.text as Record<string, unknown> | undefined)?.content ?? "").trim();
    await handlers.onMessage({
      chat: { key, kind: direct ? "direct" : "group", title: "" },
      sender: {
        id: String((body.from as Record<string, unknown> | undefined)?.userid ?? ""),
        name: String((body.from as Record<string, unknown> | undefined)?.name ?? (body.from as Record<string, unknown> | undefined)?.userid ?? ""),
      },
      text,
      mentioned: direct === true || body.mention_robot === true,
      messageId: String(body.msgid ?? ""),
    });
  };

  const open = (): void => {
    const gen = generation;
    try {
      socket = new (env.WebSocket as typeof WebSocket)(WECOM_WSS);
      socket.binaryType = "arraybuffer";
    } catch (error) {
      handlers.onStatus({ state: "error", error: error instanceof Error ? error.message : String(error) });
      return;
    }
    const ws = socket;
    ws.addEventListener("open", () => {
      sendFrame({ cmd: "aibot_subscribe", headers: { req_id: nextReqId() }, body: { secret, bot_id: botId } });
    });
    ws.addEventListener("message", (event) => {
      if (stopped || generation !== gen) return;
      let packet: WecomPacket;
      try {
        packet = JSON.parse(Buffer.from(event.data as ArrayBuffer).toString("utf8")) as WecomPacket;
      } catch {
        return;
      }
      if (packet.errcode !== undefined) {
        if (packet.errcode !== 0) {
          lastError = String(packet.errmsg ?? `企业微信应答 ${String(packet.errcode)}`);
          handlers.onStatus({ state: "error", error: lastError });
          const held = pending.get(String(packet.headers?.req_id ?? ""));
          if (held !== undefined) {
            pending.delete(String(packet.headers?.req_id ?? ""));
            held.reject(Object.assign(new Error(lastError), { permanent: true }));
          }
          return;
        }
        const reqKey = String(packet.headers?.req_id ?? "");
        const held = pending.get(reqKey);
        if (held !== undefined) {
          pending.delete(reqKey);
          held.resolve(packet.body ?? {});
        }
        lastError = undefined;
        handlers.onStatus({ state: "ready" });
        return;
      }
      if (packet.cmd === "aibot_msg_callback") {
        void onCallback(packet.headers ?? {}, packet.body ?? {})
          .catch((error) => env.log?.warn?.("wecom message failed: %s", error instanceof Error ? error.message : String(error)));
      }
    });
    ws.addEventListener("close", () => {
      if (pingTimer !== null) clearInterval(pingTimer);
      pingTimer = null;
      if (stopped || generation !== gen) return;
      if (lastError === undefined) handlers.onStatus({ state: "connecting" });
      reconnectTimer = setTimeout(() => { if (!stopped && generation === gen) open(); }, 2000);
      reconnectTimer.unref?.();
    });
    ws.addEventListener("error", () => {
      if (stopped || generation !== gen) return;
      handlers.onStatus({ state: "retrying", error: "企业微信网关连接失败" });
    });
    // 心跳：30s 一发 ping（网关闲置断连）。
    pingTimer = setInterval(() => {
      if (!stopped && socket !== null && socket.readyState === 1) {
        sendFrame({ cmd: "ping", headers: { req_id: nextReqId() } });
      }
    }, 30_000);
    pingTimer.unref?.();
  };
  open();

  return {
    send: async (chat: ImChat, text: string): Promise<{ messageId?: string }> => {
      let last: string | undefined;
      for (const chunk of chunkText(text, WECOM_TEXT_LIMIT)) {
        const body: Record<string, unknown> = { msgtype: "markdown", markdown: { content: chunk } };
        const reqId = lastReqId.get(chat.key);
        if (reqId !== undefined && reqId !== "") {
          // 被动回复：复用回调帧的 req_id（网关按它路由回这条聊天）。
          sendFrame({ cmd: "aibot_respond_msg", headers: { req_id: reqId }, body });
        } else {
          const result = await request("aibot_send_msg", {
            ...body,
            ...(chat.kind === "group" ? { chatid: chat.key } : { userid: chat.key }),
          });
          last = String(result.msgid ?? last ?? "");
        }
      }
      return last === undefined ? {} : { messageId: last };
    },
    stop: () => {
      stopped = true;
      generation += 1;
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      if (pingTimer !== null) clearInterval(pingTimer);
      for (const held of pending.values()) held.reject(new Error("stopped"));
      pending.clear();
      try { socket?.close(1000, "stop"); } catch { /* not open */ }
    },
  };
}

/** 平台注册条目（platforms.ts 汇总）。 */
export const wecomAdapter: ImPlatformAdapter = {
  connect: connectWecom,
  check: checkWecom,
};
