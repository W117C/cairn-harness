// 飞书适配器（2026-11-17 · 通道线）。
//
// 长连接走官方「事件订阅 · 使用长连接接收事件」通道：POST /callback/ws/endpoint 换
// wss URL，pbbp2 帧在 WebSocket 上飞；ping→pong、event/card 帧 ACK（参照协议行为）。
// 分片帧按 (sum, seq) 重组。私聊直收；群聊只在 @ 机器人时收。
// 发送走 OpenAPI（tenant_access_token），文本按平台上限分片。
//
// 协议实现参考了开源实现（@larksuiteoapi/node-sdk，MIT；本地参照仓 Apache-2.0），
// 本文件是按协议行为写的 TypeScript 独立实现，fetch/WebSocket 全部注入。
import type { ImAdapterHandle, ImConnectHandlers, ImEnv, ImPlatformAdapter, ImChat } from "../types";
import { chunkText } from "../format";

/** 平台文字上限（飞书文本消息 4000 字符）。 */
export const FEISHU_TEXT_LIMIT = 4000;

const apiBaseOf = (fields: Record<string, string>): string =>
  String(fields.domain === "lark" ? "https://open.larksuite.com" : "https://open.feishu.cn").replace(/\/+$/, "");

/** pbbp2 帧的 protobuf 线形（只覆盖本协议用到的形）。线型：0=varint，2=length-delimited。 */
interface Pbbp2Frame {
  SeqID?: number;
  LogID?: number;
  service?: number;
  method?: number;
  headers: { key: string; value: string }[];
  payloadEncoding?: string;
  payloadType?: string;
  payload?: Uint8Array;
  LogIDNew?: string;
}

/** 无符号 varint 编码（BigInt 位运算，防 >2^31 溢出）。 */
function uvarint(value: number): number[] {
  let v = BigInt(value);
  const bytes: number[] = [];
  while (v > 127n) {
    bytes.push(Number(v & 127n) | 128);
    v >>= 7n;
  }
  bytes.push(Number(v));
  return bytes;
}

/** 字段编码：number<<3|wire 打头；wire=0 跟 varint，wire=2 跟长度+字节。 */
function protoField(num: number, wire: number, body: number | number[] | string | Uint8Array): number[] {
  const tag = uvarint((num << 3) | wire);
  if (wire === 0) return [...tag, ...uvarint(Number(body))];
  const bytes = typeof body === "string" ? [...Buffer.from(body, "utf8")] : [...body as number[] | Uint8Array];
  return [...tag, ...uvarint(bytes.length), ...bytes];
}

function encodeHeader(h: { key: string; value: string }): number[] {
  return [...protoField(1, 2, h.key), ...protoField(2, 2, h.value)];
}

/** 编码一帧。 */
export function encodeFrame(frame: Pbbp2Frame): Buffer {
  const out: number[] = [];
  if (frame.SeqID !== undefined) out.push(...protoField(1, 0, frame.SeqID));
  if (frame.LogID !== undefined) out.push(...protoField(2, 0, frame.LogID));
  if (frame.service !== undefined) out.push(...protoField(3, 0, frame.service));
  if (frame.method !== undefined) out.push(...protoField(4, 0, frame.method));
  for (const h of frame.headers) out.push(...protoField(5, 2, encodeHeader(h)));
  if (frame.payloadEncoding !== undefined) out.push(...protoField(6, 2, frame.payloadEncoding));
  if (frame.payloadType !== undefined) out.push(...protoField(7, 2, frame.payloadType));
  if (frame.payload !== undefined) out.push(...protoField(8, 2, frame.payload));
  if (frame.LogIDNew !== undefined) out.push(...protoField(9, 2, frame.LogIDNew));
  return Buffer.from(out);
}

/** 解码一帧。坏帧如实返回 null（线上的脏字节不该崩宿主）。 */
export function decodeFrame(buffer: Buffer): Pbbp2Frame | null {
  const frame: Pbbp2Frame = { headers: [] };
  let at = 0;
  const varint = (): bigint | null => {
    let value = 0n;
    let shift = 0n;
    while (at < buffer.length) {
      const b = buffer[at];
      at += 1;
      value |= BigInt(b & 127) << shift;
      if ((b & 128) === 0) return value;
      shift += 7n;
    }
    return null;
  };
  const bytes = (): Uint8Array | null => {
    const len = varint();
    if (len === null) return null;
    const length = Number(len);
    const part = buffer.subarray(at, at + length);
    at += length;
    return part;
  };
  const header = (buf: Uint8Array): { key: string; value: string } | null => {
    let index = 0;
    const out: { key: string; value: string } = { key: "", value: "" };
    const v = (): bigint | null => {
      let value = 0n;
      let shift = 0n;
      while (index < buf.length) {
        const b = buf[index];
        index += 1;
        value |= BigInt(b & 127) << shift;
        if ((b & 128) === 0) return value;
        shift += 7n;
      }
      return null;
    };
    const b = (): Uint8Array | null => {
      const len = v();
      if (len === null) return null;
      const length = Number(len);
      const part = buf.subarray(index, index + length);
      index += length;
      return part;
    };
    while (index < buf.length) {
      const tag = v();
      if (tag === null) return null;
      const num = Number(tag >> 3n);
      const wire = Number(tag & 7n);
      if (num === 1 && wire === 2) {
        const x = b();
        if (x === null) return null;
        out.key = Buffer.from(x).toString("utf8");
      } else if (num === 2 && wire === 2) {
        const x = b();
        if (x === null) return null;
        out.value = Buffer.from(x).toString("utf8");
      } else if (wire === 2) {
        if (b() === null) return null;
      } else if (wire === 0) {
        if (v() === null) return null;
      } else return null;
    }
    return out;
  };
  while (at < buffer.length) {
    const tag = varint();
    if (tag === null) return null;
    const num = Number(tag >> 3n);
    const wire = Number(tag & 7n);
    if (wire === 0) {
      const value = varint();
      if (value === null) return null;
      if (num === 1) frame.SeqID = Number(value);
      else if (num === 2) frame.LogID = Number(value);
      else if (num === 3) frame.service = Number(value);
      else if (num === 4) frame.method = Number(value);
    } else if (wire === 2) {
      const value = bytes();
      if (value === null) return null;
      if (num === 5) {
        const h = header(value);
        if (h === null) return null;
        frame.headers.push(h);
      } else if (num === 6) frame.payloadEncoding = Buffer.from(value).toString("utf8");
      else if (num === 7) frame.payloadType = Buffer.from(value).toString("utf8");
      else if (num === 8) frame.payload = value;
      else if (num === 9) frame.LogIDNew = Buffer.from(value).toString("utf8");
    } else return null;
  }
  return frame;
}

// ── REST 助手 ────────────────────────────────────────────────────────────────

async function tenantToken(
  fields: Record<string, string>,
  env: ImEnv,
): Promise<{ token: string; expiresAt: number }> {
  const response = await env.fetch(`${apiBaseOf(fields)}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      app_id: String(fields.appId ?? "").trim(),
      app_secret: String(fields.appSecret ?? "").trim(),
    }),
  });
  const body = asRecord(await response.json().catch(() => ({})));
  if (typeof body.tenant_access_token !== "string") {
    const error = new Error(body.msg === undefined ? "飞书拒绝了这组凭据" : String(body.msg));
    // 5xx/429 重试；4xx 是凭据问题，permanent 档不自动重试。
    (error as Error & { permanent?: boolean }).permanent =
      !(response.status >= 500 || response.status === 429);
    throw error;
  }
  const ttl = Math.max(60, Number(body.expire ?? 7200) - 300);
  return { token: body.tenant_access_token, expiresAt: Date.now() + ttl * 1000 };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

async function api(
  env: ImEnv,
  base: string,
  token: string,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<Record<string, unknown>> {
  const response = await env.fetch(`${base}${path}`, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const json = asRecord(await response.json().catch(() => ({})));
  if (!response.ok || (json.code !== undefined && json.code !== 0)) {
    const error = new Error(String(json.msg ?? `飞书应答 ${String(response.status)}`));
    (error as Error & { permanent?: boolean }).permanent =
      response.status >= 400 && response.status < 500 && response.status !== 429;
    throw error;
  }
  return json;
}

/** 校验凭据并取机器人身份（im-add 的 check 调它；失败抛错=拒绝保存）。 */
export async function checkFeishu(
  body: Record<string, string>,
  env: ImEnv,
): Promise<{ account: { id: string; name: string } }> {
  const { token } = await tenantToken(body, env);
  const me = await api(env, apiBaseOf(body), token, "/open-apis/bot/v3/info", { method: "GET" });
  const bot = asRecord(me.bot ?? me);
  const id = String(bot.open_id ?? bot.app_id ?? body.appId ?? "feishu");
  const name = String(bot.app_name ?? body.appId ?? "飞书机器人");
  return { account: { id, name } };
}

/** 飞书适配器运行句柄。 */
export interface FeishuHandle extends ImAdapterHandle {}

export function connectFeishu(
  fields: Record<string, string>,
  env: ImEnv,
  handlers: ImConnectHandlers,
): FeishuHandle {
  const appId = String(fields.appId ?? "").trim();
  const appSecret = String(fields.appSecret ?? "").trim();
  if (env.WebSocket === undefined) {
    handlers.onStatus({ state: "error", error: "这个运行环境没有 WebSocket（Node <22 或壳未注入）" });
    return { send: async () => ({}), stop: () => undefined };
  }
  const WS = env.WebSocket;
  let stopped = false;
  let socket: WebSocket | null = null;
  let generation = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let token: string | null = null;
  let tokenExpiresAt = 0;
  let botOpenId = "";
  // 分片帧按 message_id 重组（sum=分片总数、seq=本片序号）。
  const parts = new Map<string, { received: Map<number, Uint8Array>; sum: number }>();
  let openFailures = 0;

  const rest = async (path: string, init: { method?: string; body?: unknown } = {}): Promise<Record<string, unknown>> => {
    if (token === null || Date.now() > tokenExpiresAt - 30_000) {
      const got = await tenantToken(fields, env);
      token = got.token;
      tokenExpiresAt = got.expiresAt;
    }
    return api(env, apiBaseOf(fields), token, path, init);
  };

  const sendFrame = (buffer: Buffer): void => {
    if (socket !== null && socket.readyState === 1) socket.send(buffer);
  };

  const pong = (frame: Pbbp2Frame): void => {
    sendFrame(encodeFrame({
      ...frame,
      headers: frame.headers.map((h) => (h.key === "type" ? { key: "type", value: "pong" } : h)),
      payload: Buffer.from("pong"),
    }));
  };

  const ack = (frame: Pbbp2Frame, ms: number): void => {
    sendFrame(encodeFrame({
      ...frame,
      headers: [...frame.headers.filter((h) => h.key !== "biz_rt"), { key: "biz_rt", value: String(ms) }],
      payload: Buffer.from(JSON.stringify({ code: 200, headers: {}, data: "" })),
      payloadType: "json",
    }));
  };

  const dispatch = async (type: string, body: Uint8Array): Promise<void> => {
    let payload: Record<string, unknown>;
    try {
      payload = asRecord(JSON.parse(Buffer.from(body).toString("utf8")));
    } catch {
      return;
    }
    if (type !== "event" || asRecord(payload.header).event_type !== "im.message.receive_v1") return;
    const event = asRecord(payload.event);
    const message = asRecord(event.message);
    const direct = message.chat_type === "p2p";
    const mentions = Array.isArray(message.mentions) ? message.mentions : [];
    const mentioned = direct || mentions.some((m) =>
      asRecord(asRecord(m).id).open_id === botOpenId || asRecord(m).key === "@_user_1");
    const content = asRecord(safeJson(String(message.content ?? "{}")));
    const text = String(content.text ?? "").replace(/@_user_\d+/g, "").trim();
    const sender = String(asRecord(asRecord(event.sender).sender_id).open_id ?? "");
    await handlers.onMessage({
      chat: { key: String(message.chat_id ?? ""), kind: direct ? "direct" : "group", title: String(message.chat_id ?? "") },
      sender: { id: sender, name: sender },
      text,
      mentioned,
      messageId: String(message.message_id ?? ""),
    });
  };

  const handshakeUrl = async (): Promise<string | null> => {
    try {
      if (token === null || Date.now() > tokenExpiresAt - 30_000) {
        const got = await tenantToken(fields, env);
        token = got.token;
        tokenExpiresAt = got.expiresAt;
      }
      const answer = await env.fetch(`${apiBaseOf(fields)}/callback/ws/endpoint`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ AppID: appId, AppSecret: appSecret }),
      });
      const body = asRecord(await answer.json().catch(() => ({})));
      const url = body.data === undefined ? undefined : asRecord(body.data).URL;
      if (typeof url !== "string" || url === "") {
        const reason = body.msg === undefined ? `飞书应答 ${String(answer.status)}` : String(body.msg);
        const error = new Error(reason);
        // 200 但没有 URL = 平台拒绝这个应用（凭据/权限问题）；4xx（非 429）同档。
        (error as Error & { permanent?: boolean }).permanent =
          answer.ok || (answer.status >= 400 && answer.status < 500 && answer.status !== 429);
        throw error;
      }
      return url;
    } catch (error) {
      if (stopped) return null;
      const permanent = (error as Error & { permanent?: boolean }).permanent === true;
      if (permanent) {
        handlers.onStatus({ state: "error", error: error instanceof Error ? error.message : String(error) });
        return null;
      }
      handlers.onStatus({ state: "retrying", error: error instanceof Error ? error.message : String(error) });
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => { if (!stopped) void open(); }, 2000 + Math.min(openFailures, 8) * 1000);
      openFailures += 1;
      return null;
    }
  };

  const open = async (): Promise<void> => {
    const gen = generation;
    const url = await handshakeUrl();
    if (url === null || stopped || generation !== gen) return;
    let ws: WebSocket;
    try {
      ws = new WS(url);
      ws.binaryType = "arraybuffer";
    } catch (error) {
      handlers.onStatus({ state: "retrying", error: error instanceof Error ? error.message : String(error) });
      reconnectTimer = setTimeout(() => { if (!stopped) void open(); }, 2000);
      return;
    }
    socket = ws;
    ws.addEventListener("message", (event) => {
      if (stopped || generation !== gen) return;
      let frame: ReturnType<typeof decodeFrame> = null;
      try {
        frame = decodeFrame(Buffer.from(event.data as ArrayBuffer));
      } catch {
        frame = null;
      }
      if (frame === null) return;
      const typeValue = frame.headers.find((h) => h.key === "type")?.value ?? "";
      if (frame.method === 0 && typeValue === "ping") { pong(frame); return; }
      if (frame.method === 1 && typeValue === "reconnect") {
        try { ws.close(4000, "reconnect"); } catch { /* not open */ }
        return;
      }
      if (frame.method !== 1 || (typeValue !== "event" && typeValue !== "card")) return;
      const messageId = frame.headers.find((h) => h.key === "message_id")?.value ?? "";
      const sum = Number(frame.headers.find((h) => h.key === "sum")?.value ?? 1);
      const seq = Number(frame.headers.find((h) => h.key === "seq")?.value ?? 1);
      ack(frame, 0);
      if (sum > 1) {
        const held = parts.get(messageId) ?? { received: new Map(), sum };
        held.received.set(seq, frame.payload ?? new Uint8Array());
        parts.set(messageId, held);
        if (held.received.size !== sum) return;
        frame.payload = Buffer.concat(
          [...held.received.keys()].sort((a, b) => a - b).map((s) => Buffer.from(held.received.get(s) ?? new Uint8Array())),
        );
        parts.delete(messageId);
      }
      void dispatch(typeValue, frame.payload ?? new Uint8Array())
        .catch((error) => env.log?.warn?.("feishu event failed: %s", error instanceof Error ? error.message : String(error)));
    });
    ws.addEventListener("open", () => {
      openFailures = 0;
      handlers.onStatus({ state: "ready" });
    });
    ws.addEventListener("close", () => {
      if (stopped || generation !== gen) return;
      socket = null;
      handlers.onStatus({ state: "connecting" });
      reconnectTimer = setTimeout(() => { if (!stopped) void open(); }, 2000);
    });
    ws.addEventListener("error", () => { /* close 会跟着来，由 close 统一重连 */ });
  };

  // 启动：先取 token 与机器人身份（供群聊 @ 判定），再开长连接。
  // 网络没就绪时一直重试（连接不该因为启动早了一步而死）。
  void (async () => {
    let attempt = 0;
    while (!stopped) {
      try {
        const got = await tenantToken(fields, env);
        token = got.token;
        tokenExpiresAt = got.expiresAt;
        const me = await api(env, apiBaseOf(fields), token, "/open-apis/bot/v3/info", { method: "GET" }).catch(() => ({}));
        botOpenId = String(asRecord(asRecord(me).bot).open_id ?? "");
        break;
      } catch (error) {
        if (stopped) return;
        if ((error as Error & { permanent?: boolean }).permanent === true) {
          handlers.onStatus({ state: "error", error: error instanceof Error ? error.message : String(error) });
          return;
        }
        handlers.onStatus({ state: "retrying", error: error instanceof Error ? error.message : String(error) });
        await new Promise((r) => setTimeout(r, 1000 + Math.min(attempt, 8) * 1000));
        attempt += 1;
      }
    }
    if (!stopped) await open();
  })();

  return {
    send: async (chat: ImChat, text: string): Promise<{ messageId?: string }> => {
      let last: string | undefined;
      for (const chunk of chunkText(text, FEISHU_TEXT_LIMIT)) {
        const sent = await rest("/open-apis/im/v1/messages?receive_id_type=chat_id", {
          body: {
            receive_id: chat.key,
            msg_type: "text",
            content: JSON.stringify({ text: chunk }),
          },
        });
        last = String(asRecord(sent.data).message_id ?? last ?? "");
      }
      return last === undefined ? {} : { messageId: last };
    },
    stop: () => {
      stopped = true;
      generation += 1;
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      try { socket?.close(1000, "stop"); } catch { /* not open */ }
    },
  };
}

function safeJson(text: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** 平台注册条目（platforms.ts 汇总）。 */
export const feishuAdapter: ImPlatformAdapter = {
  connect: connectFeishu,
  check: checkFeishu,
};
