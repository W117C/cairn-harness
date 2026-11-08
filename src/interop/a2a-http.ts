/** A2A HTTP 传输：JSON-RPC over HTTP + well-known agent card。
 *
 *  默认只绑 loopback，不做 TLS；这不是“对外服务”，而是把 A2A handler 接到真实 HTTP 客户端
 *  的传输层。请求体有上限，content-type 必须声明 JSON；其余路径/方法显式 404/405。
 *  可选 `authToken`：设置后所有请求（含 agent card）都必须带 `Authorization: Bearer <token>`，
 *  缺失或不匹配一律 401 fail-closed；比较用常量时间。`message/stream`（需 `Accept: text/event-stream`）
 *  走 SSE：每个事件是一行 `data: {jsonrpc response}`，final 为真后关流；handler 未实现流式时显式 501。 */

import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  A2A_PROTOCOL_VERSION,
  A2AError,
  dispatchA2ARequest,
  type A2AHandler,
  type A2AJsonRpcRequest,
} from "./a2a";
import { isRecord } from "../is-record";

export const A2A_MAX_BODY_BYTES = 1 << 20;

export interface A2AHttpOptions {
  /** JSON-RPC POST 路径，缺省 `/`。 */
  path?: string;
  /** agent card GET 路径，缺省 `/.well-known/agent-card.json`。 */
  agentCardPath?: string;
  maxBodyBytes?: number;
  /** 设置后所有请求必须携带 `Authorization: Bearer <token>`，否则 401。 */
  authToken?: string;
}

/** 常量时间比较两个 token 字符串；长度不同直接 false（不泄露长度信息到响应时序）。 */
export function bearerTokensMatch(expected: string, presented: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(presented, "utf8");
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

function extractBearer(req: IncomingMessage): string | null {
  const header = req.headers["authorization"];
  if (typeof header !== "string") return null;
  const match = /^Bearer\s+(.+)$/.exec(header.trim());
  return match === null ? null : match[1]!.trim();
}

interface HttpError {
  status: number;
  code: number;
  message: string;
}

async function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  const declared = Number(req.headers["content-length"] ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw { status: 413, code: -32600, message: "request body exceeds " + String(maxBytes) + " bytes" } satisfies HttpError;
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    total += buf.length;
    if (total > maxBytes) {
      throw { status: 413, code: -32600, message: "request body exceeds " + String(maxBytes) + " bytes" } satisfies HttpError;
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.setHeader("content-length", Buffer.byteLength(payload, "utf8"));
  res.end(payload);
}

function jsonRpcError(id: string | number | null, code: number, message: string): Record<string, unknown> {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

/** message/stream 的 SSE 落地：Accept 协商、handler 无流式显式 501、事件逐条写、终态/断连关流。 */
async function serveStream(
  handler: A2AHandler,
  request: A2AJsonRpcRequest,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const rpcId = typeof request.id === "string" || typeof request.id === "number" ? request.id : null;
  if (typeof handler.messageStream !== "function") {
    sendJson(res, 501, jsonRpcError(rpcId, -32601, "streaming is not supported by this handler"));
    return;
  }
  const accept = String(req.headers["accept"] ?? "");
  if (!accept.includes("text/event-stream")) {
    sendJson(res, 415, jsonRpcError(rpcId, -32600, "message/stream requires Accept: text/event-stream"));
    return;
  }
  res.statusCode = 200;
  res.setHeader("content-type", "text/event-stream; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  let closed = false;
  req.on("close", () => { closed = true; });
  const writeEvent = (payload: unknown): boolean => !closed && res.write("data: " + JSON.stringify(payload) + "\n\n");
  try {
    for await (const event of handler.messageStream(request.params)) {
      if (!writeEvent({ jsonrpc: "2.0", id: rpcId, result: event })) return;
      if (event.final) break;
    }
  } catch (error) {
    const code = error instanceof A2AError ? error.code : -32603;
    writeEvent({ jsonrpc: "2.0", id: rpcId, error: { code, message: error instanceof Error ? error.message : String(error) } });
  } finally {
    res.end();
  }
}

/** 返回 Node request listener；`handler` 由调用方装配（本地 AgentRuntime 或测试替身）。 */
export function createA2AHttpHandler(
  handler: A2AHandler,
  opts: A2AHttpOptions = {},
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const rpcPath = opts.path ?? "/";
  const cardPath = opts.agentCardPath ?? "/.well-known/agent-card.json";
  const maxBytes = Math.max(1024, opts.maxBodyBytes ?? A2A_MAX_BODY_BYTES);
  const authToken = opts.authToken ?? null;
  const unauthorized = (res: ServerResponse): void => {
    res.setHeader("www-authenticate", 'Bearer realm="a2a"');
    sendJson(res, 401, jsonRpcError(null, -32000, "missing or invalid bearer token"));
  };
  return async (req, res) => {
    if (authToken !== null && !bearerTokensMatch(authToken, extractBearer(req) ?? "")) {
      unauthorized(res);
      return;
    }
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === cardPath) {
      if (req.method !== "GET") {
        res.setHeader("allow", "GET");
        sendJson(res, 405, jsonRpcError(null, -32600, "method not allowed; use GET for the agent card"));
        return;
      }
      sendJson(res, 200, { ...handler.agentCard(), protocolVersion: A2A_PROTOCOL_VERSION });
      return;
    }
    if (url.pathname !== rpcPath) {
      sendJson(res, 404, jsonRpcError(null, -32601, "not found"));
      return;
    }
    if (req.method !== "POST") {
      res.setHeader("allow", "POST");
      sendJson(res, 405, jsonRpcError(null, -32600, "method not allowed; use POST for JSON-RPC"));
      return;
    }
    const contentType = String(req.headers["content-type"] ?? "").toLowerCase();
    if (!contentType.startsWith("application/json")) {
      sendJson(res, 415, jsonRpcError(null, -32600, "content-type must be application/json"));
      return;
    }
    let body: string;
    try {
      body = await readBody(req, maxBytes);
    } catch (error) {
      const httpError = error as HttpError;
      if (typeof httpError?.status === "number") {
        sendJson(res, httpError.status, jsonRpcError(null, httpError.code, httpError.message));
        return;
      }
      sendJson(res, 400, jsonRpcError(null, -32700, error instanceof Error ? error.message : String(error)));
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch (error) {
      sendJson(res, 400, jsonRpcError(null, -32700, "parse error: " + (error instanceof Error ? error.message : String(error))));
      return;
    }
    if (!isRecord(parsed) || typeof parsed.method !== "string") {
      const id = isRecord(parsed) && (typeof parsed.id === "string" || typeof parsed.id === "number") ? parsed.id : null;
      sendJson(res, 400, jsonRpcError(id, -32600, "invalid JSON-RPC request"));
      return;
    }
    const request: A2AJsonRpcRequest = {
      ...(typeof parsed.id === "string" || typeof parsed.id === "number" ? { id: parsed.id } : {}),
      method: parsed.method,
      params: parsed.params,
    };
    if (request.method === "message/stream") {
      await serveStream(handler, request, req, res);
      return;
    }
    const response = await dispatchA2ARequest(handler, request);
    if (response === null) {
      // JSON-RPC 通知没有响应体；HTTP 仍需要一个已完成的 204。
      res.statusCode = 204;
      res.setHeader("cache-control", "no-store");
      res.end();
      return;
    }
    sendJson(res, 200, response);
  };
}

export interface A2AHttpServer {
  url: string;
  close(): Promise<void>;
}

export interface ServeA2AOptions extends A2AHttpOptions {
  handler: A2AHandler;
  port?: number;
  host?: string;
}

/** 启动 loopback HTTP 服务；端口 0 = 随机端口。 */
export function serveA2AHttp(opts: ServeA2AOptions): Promise<A2AHttpServer> {
  const listener = createA2AHttpHandler(opts.handler, opts);
  const host = opts.host ?? "127.0.0.1";
  const server = createServer((req, res) => {
    void listener(req, res).catch((error: unknown) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      sendJson(res, 500, jsonRpcError(null, -32603, error instanceof Error ? error.message : String(error)));
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, host, () => {
      server.off("error", reject);
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : opts.port ?? 0;
      resolve({
        url: "http://" + host + ":" + String(port),
        close: () => new Promise<void>((done, fail) => {
          server.close((error) => { if (error) fail(error); else done(); });
          server.closeAllConnections();
        }),
      });
    });
  });
}
