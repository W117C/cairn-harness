// IM 通道宿主 · 桌面装配（2026-11-17 · 通道线）。
//
// 核心宿主（src/im/host.ts）是 electron-free 的；本文件把它接上真东西：
//  · 存储：<userData>/im/connections.json（原子写、0600）
//  · 密钥：safeStorage 后端（键名 im:<connId>:<field>，值只在加密存储里）
//  · TLS 行套接字：node:tls（邮件适配器的 IMAP/SMTP 走它）
//  · 路由：消息 → 绑定会话（无绑定则新建+归属补丁）→ run 收束后取最后一条
//    assistant_message 作为回信
// 本文件不 import electron（目录纪律同 team-dispatch.ts：electron 只在 index.ts 落）。
import { connect as tlsConnectRaw, type TLSSocket } from "node:tls";
import { WebSocket as WsWebSocket } from "ws";
import { createImHost, type ImHost } from "../../../../src/im/host";
import { IM_PLATFORMS, IM_ADAPTERS } from "../../../../src/im/platforms";
import { createImStore } from "../../../../src/im/store";
import { createEventLog, type AgentEvent } from "../../../../src/events";
import { createSession, pathOf, readSessionEvents, sessionExists } from "../../../../src/main/sessions";
import type { ProviderKeyBackend } from "../../../../src/main/provider-keys";
import type { ImLineSocket, ImInboundMessage, ImConnection } from "../../../../src/im/types";

/** 会话归属补丁键（与 team-dispatch 的 member 同族：自由键通道，不新增事件种类）。 */
export const IM_SESSION_KEY = "im";

/** node:tls → 行式套接字适配。 */
export function tlsLineSocket(opts: { host: string; port: number }): Promise<ImLineSocket> {
  return new Promise((resolve, reject) => {
    const socket: TLSSocket = tlsConnectRaw({ host: opts.host, port: opts.port, servername: opts.host });
    let buffer = "";
    const pending: Array<(v: string | null) => void> = [];
    const deliver = (): void => {
      while (pending.length > 0) {
        const at = buffer.indexOf("\n");
        if (at === -1) return;
        const line = buffer.slice(0, at).replace(/\r$/, "");
        buffer = buffer.slice(at + 1);
        const pendingOne = pending.shift();
        if (pendingOne !== undefined) pendingOne(line);
      }
    };
    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      deliver();
    });
    socket.on("end", () => {
      // 关闭时把残余未完结的读取放行（null = 关闭）。
      for (const p of pending.splice(0)) p(null);
    });
    socket.on("error", (error: Error) => {
      for (const p of pending.splice(0)) p(null);
      reject(error);
    });
    socket.once("secureConnect", () => resolve({
      readLine: () => new Promise((res) => {
        const at = buffer.indexOf("\n");
        if (at !== -1) {
          const line = buffer.slice(0, at).replace(/\r$/, "");
          buffer = buffer.slice(at + 1);
          res(line);
        } else {
          pending.push(res);
        }
      }),
      write: (line) => new Promise((res, rej) => socket.write(line.endsWith("\n") ? line : line + "\n", (e) => (e === null ? res() : rej(e)))),
      writeRaw: (chunk) => new Promise((res, rej) => socket.write(chunk, (e) => (e === null ? res() : rej(e)))),
      end: () => new Promise((res) => socket.end(() => res())),
    }));
  });
}

/** 桌面装配输入：run/密钥后端/会话根由 index.ts 注入。 */
export interface DesktopImHostInput {
  dir: string;
  run: (req: { message: string; mode: string; sessionId: string; workspace?: string }) => Promise<{ ok?: boolean; error?: string }>;
  sessionsRoot: () => Promise<string | undefined>;
  mode: () => Promise<string>;
  backend: ProviderKeyBackend | null;
}

/** 会话日志里的最后一条 assistant 文本（回信正文）。 */
export async function lastAssistantText(root: string, sessionId: string): Promise<string | null> {
  const events = await readSessionEvents(root, sessionId).catch(() => [] as AgentEvent[]);
  let last: string | null = null;
  for (const event of events) {
    if (event.type === "assistant_message" && typeof event.content === "string" && event.content.trim() !== "") {
      last = event.content;
    }
 }
  return last;
}

/** 装配桌面 IM 宿主（index.ts 调一次；quit 时 stopAll）。 */
export function createDesktopImHost(input: DesktopImHostInput): ImHost {
  const host = createImHost({
    store: createImStore(input.dir), 
    platforms: Object.fromEntries(IM_PLATFORMS.map((p) => [p.id, p])),
    adapters: IM_ADAPTERS,
    env: {
      fetch: globalThis.fetch,
      // 企业微信智能机器人网关对 Upgrade 头的 Connection/Upgrade 大小写敏感——Node 内建
      // WebSocket（undici）发小写会被 403（参照仓与官方 SDK 为此都带 `ws`）。桌面装配统一
      // 注入 `ws` 构造器；缺失时回退内建（feishu 网关两者都收）。
      WebSocket: (WsWebSocket ?? globalThis.WebSocket) as unknown as typeof WebSocket | undefined,
      tlsConnect: tlsLineSocket,
    },
    secretValue: async (storeKey) => {
      const backend = input.backend;
      if (backend === null) return undefined;
      try {
        return (await backend.get(storeKey)) ?? undefined;
      } catch {
        return undefined;
      }
    },
    routeInbound: async (conn: ImConnection, msg: ImInboundMessage) => {
      const root = await input.sessionsRoot();
      if (root === undefined) return { ok: false, error: "没有可用的会话根" };
      let sessionId = conn.sessionId;
      if (sessionId === "" || !(await sessionExists(root, sessionId))) {
        sessionId = await createSession(root);
        const path = pathOf(root, sessionId);
        await createEventLog(path).append(
          { type: "session_meta_update", patch: { [IM_SESSION_KEY]: conn.id } } as AgentEvent,
        );
        conn.sessionId = sessionId;
        await host.save();
      }
      const mode = await input.mode();
      const started = await input.run({ message: msg.text, mode, sessionId, ...(conn.workspace === undefined ? {} : { workspace: conn.workspace }) });
      if (started.ok === false) return { ok: false, error: started.error ?? "开跑失败" };
      const reply = await lastAssistantText(root, sessionId);
      return { ok: true, reply: reply ?? "" };
    },
  });
  return host;
}
