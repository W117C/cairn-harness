/** ACP stdio 传输：newline-delimited JSON-RPC over a pair of Node streams。
 *
 *  为什么请求必须**并发分派**：ACP 客户端在 `session/prompt` 等待模型时发 `session/cancel`；
 *  如果服务端按行 await 每个请求，取消通知会排在 prompt 后面永远读不到。
 *  写侧仍串行化，避免两条响应/通知的 JSON 行交错。
 *
 *  出站请求（agent → client，如 `session/request_permission`）：`attach` 在写链就绪后回调一次，
 *  给出带 id 关联的 `request()`；响应（有 id 无 method 的帧）按 id 配对，超时与输入 EOF 都按
 *  错误收束——权限桥的调用方把这两种都译成「拒绝」，不做静默降级。
 *
 *  帧有上限：超长行整行丢弃并回一条 JSON-RPC 错误；解析失败回 -32700。空行忽略。 */

import type { Readable, Writable } from "node:stream";
import { createAcpAdapter, dispatchAcpRequest, type AcpAdapter } from "./acp";
import type { AgentClientV1 } from "./sdk";
import { isRecord } from "../is-record";

export const ACP_MAX_LINE_BYTES = 1 << 20;
export const ACP_REQUEST_TIMEOUT_MS = 60_000;

/** 出站请求面：agent 侧向 client 发 JSON-RPC 请求并等它的响应。 */
export interface AcpOutboundTransport {
  request(method: string, params: unknown, opts?: { timeoutMs?: number }): Promise<unknown>;
}

export interface AcpStdioOptions {
  client: AgentClientV1;
  input: Readable | AsyncIterable<Uint8Array | string>;
  output: Writable;
  maxLineBytes?: number;
  /** 写链就绪后回调一次；用 `transport.request` 发出站请求。 */
  attach?: (transport: AcpOutboundTransport) => void;
}

interface Frame {
  line?: string;
  oversized?: boolean;
}

/** 有界行切分：超过上限的无换行段只报一次 oversized，随后丢弃到下一个换行。 */
async function* readFrames(input: AsyncIterable<Uint8Array | string>, maxBytes: number): AsyncIterable<Frame> {
  let buffer = "";
  let discarding = false;
  // 跨 chunk 保留解码状态：一个多字节 UTF-8 字符可能被 pipe/流切成两半，
  // 对每块单独 toString("utf8") 会各吐一个 U+FFFD，整帧 JSON 解析失败。
  const decoder = new TextDecoder("utf-8");
  for await (const chunk of input) {
    if (typeof chunk === "string") {
      buffer += decoder.decode(); // 先把待续字节收尾，再拼已解码字符串
      buffer += chunk;
    } else {
      buffer += decoder.decode(chunk, { stream: true });
    }
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) {
        if (!discarding && Buffer.byteLength(buffer, "utf8") > maxBytes) {
          discarding = true;
          buffer = "";
          yield { oversized: true };
        }
        break;
      }
      const raw = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (discarding) {
        discarding = false;
        continue;
      }
      const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
      if (Buffer.byteLength(line, "utf8") > maxBytes) {
        yield { oversized: true };
        continue;
      }
      yield { line };
    }
  }
  buffer += decoder.decode(); // 输入 EOF：吐出解码器里最后一个不完整字符（若有）
  if (!discarding && buffer.length > 0) {
    const line = buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer;
    if (Buffer.byteLength(line, "utf8") > maxBytes) yield { oversized: true };
    else yield { line };
  }
}

function writeAll(output: Writable, chunk: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (output.write(chunk)) {
      resolve();
      return;
    }
    const onDrain = (): void => { cleanup(); resolve(); };
    const onError = (error: Error): void => { cleanup(); reject(error); };
    const cleanup = (): void => {
      output.off("drain", onDrain);
      output.off("error", onError);
    };
    output.on("drain", onDrain);
    output.on("error", onError);
  });
}

function parseRequest(line: string): { ok: true; value: unknown } | { ok: false; message: string } {
  try {
    return { ok: true, value: JSON.parse(line) as unknown };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

/** 启动 stdio 服务；输入 EOF 后等待所有在途请求收束再返回。 */
export async function serveAcpStdio(opts: AcpStdioOptions): Promise<void> {
  const maxBytes = Math.max(64, opts.maxLineBytes ?? ACP_MAX_LINE_BYTES);
  let writeChain: Promise<void> = Promise.resolve();
  const send = (payload: unknown): Promise<void> => {
    const line = JSON.stringify(payload) + "\n";
    writeChain = writeChain.then(() => writeAll(opts.output, line)).catch((error: unknown) => {
      // 输出端已断时不再制造第二个错误面；调用方从 serve 的 rejection 知道写失败。
      throw error;
    });
    return writeChain;
  };

  // —— 出站请求：id 自增、按 id 配对响应；超时/EOF/写失败都按错误收束（fail-closed）。 ——
  const outboundPending = new Map<string | number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  let outboundSeq = 0;
  const failOutboundPending = (message: string): void => {
    for (const entry of outboundPending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error(message));
    }
    outboundPending.clear();
  };
  const transport: AcpOutboundTransport = {
    request(method, params, requestOpts) {
      const id = "out-" + String(++outboundSeq);
      const timeoutMs = Math.max(1, requestOpts?.timeoutMs ?? ACP_REQUEST_TIMEOUT_MS);
      return new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
          outboundPending.delete(id);
          reject(new Error("outbound request timed out: " + method));
        }, timeoutMs);
        outboundPending.set(id, { resolve, reject, timer });
        void send({ jsonrpc: "2.0", id, method, params }).catch((error: unknown) => {
          if (outboundPending.delete(id)) {
            clearTimeout(timer);
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        });
      });
    },
  };
  const settleOutbound = (frame: Record<string, unknown>): boolean => {
    const key = typeof frame.id === "string" || typeof frame.id === "number" ? frame.id : null;
    if (key === null) return false;
    const entry = outboundPending.get(key);
    if (!entry) return false;
    outboundPending.delete(key);
    clearTimeout(entry.timer);
    if (isRecord(frame.error)) entry.reject(new Error("outbound request rejected: " + String(frame.error.message ?? "unknown")));
    else entry.resolve(frame.result);
    return true;
  };
  opts.attach?.(transport);

  const adapter: AcpAdapter = createAcpAdapter({
    client: opts.client,
    emit: async (method, params) => { await send({ jsonrpc: "2.0", method, params }); },
  });

  const inFlight = new Set<Promise<void>>();
  const handle = async (frame: Frame): Promise<void> => {
    if (frame.oversized) {
      await send({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32600, message: "request line exceeds " + String(maxBytes) + " bytes" },
      });
      return;
    }
    const line = frame.line ?? "";
    if (line.trim() === "") return;
    const parsed = parseRequest(line);
    if (!parsed.ok) {
      await send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error: " + parsed.message } });
      return;
    }
    if (!isRecord(parsed.value) || typeof parsed.value.method !== "string") {
      // 有 id 无 method 的帧是出站请求的响应；能配对就收束，配不上才按坏请求报错。
      if (isRecord(parsed.value) && typeof parsed.value.id !== "undefined" && settleOutbound(parsed.value)) return;
      const id = isRecord(parsed.value) && (typeof parsed.value.id === "string" || typeof parsed.value.id === "number")
        ? parsed.value.id
        : null;
      await send({ jsonrpc: "2.0", id, error: { code: -32600, message: "invalid JSON-RPC request" } });
      return;
    }
    const response = await dispatchAcpRequest(adapter, {
      ...(typeof parsed.value.id === "string" || typeof parsed.value.id === "number" ? { id: parsed.value.id } : {}),
      method: parsed.value.method,
      params: parsed.value.params,
    });
    if (response !== null) await send(response);
  };

  for await (const frame of readFrames(opts.input, maxBytes)) {
    const task = handle(frame).catch(async (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      await send({ jsonrpc: "2.0", id: null, error: { code: -32603, message } }).catch(() => undefined);
    });
    inFlight.add(task);
    void task.finally(() => inFlight.delete(task));
  }
  failOutboundPending("transport input ended before the client responded");
  await Promise.all(inFlight);
  await writeChain;
}
