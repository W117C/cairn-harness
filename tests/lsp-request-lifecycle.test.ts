import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublishDiagnosticsParams } from "vscode-languageserver-protocol/node";
import { LspClient, closeAllLspClients, getLspClient, loadLspConfig, setLspTrustedRepos } from "../src/tools/lsp";

const dirs: string[] = [];
const children: EventEmitter[] = [];
afterEach(async () => {
  for (const child of children.splice(0)) child.emit("exit", 0);
  await closeAllLspClients();
  setLspTrustedRepos([]);
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<unknown>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function controlledClient() {
  const replies: ReturnType<typeof deferred>[] = [];
  const send = vi.fn((_method: string, _params: unknown): Promise<unknown> => {
    const reply = deferred();
    replies.push(reply);
    return reply.promise;
  });
  const dispose = vi.fn();
  const notify = vi.fn(async (_method: string, _params: unknown): Promise<void> => {});
  let onDiagnostics: ((params: PublishDiagnosticsParams) => void) | undefined;
  const child = new EventEmitter();
  children.push(child);
  const connection = {
    onNotification(_type: unknown, handler: (params: PublishDiagnosticsParams) => void) { onDiagnostics = handler; },
    sendRequest: send, sendNotification: notify, dispose,
  } as unknown as ConstructorParameters<typeof LspClient>[1];
  const client = new LspClient(child as ChildProcess, connection, "/fixture", "request-lifecycle");
  const publish = (params: PublishDiagnosticsParams) => {
    if (!onDiagnostics) throw new Error("diagnostic handler missing");
    onDiagnostics(params);
  };
  return { client, child, replies, send, dispose, notify, publish };
}

describe("LSP 请求只清理自己拥有的等待状态", () => {
  it("相同 method 和 params 的并发调用仍共享一次原生请求", async () => {
    const { client, send, replies } = controlledClient();
    const first = client.request("fixture/query", { query: "shared" });
    const second = client.request("fixture/query", { query: "shared" });
    replies[0].resolve("shared result");
    const values = await Promise.all([first, second]);
    expect(second).toBe(first);
    expect(send).toHaveBeenCalledTimes(1);
    expect(values).toEqual(["shared result", "shared result"]);
  });

  it.each(["success", "error"])("超时旧请求迟到的 %s 不能删除正在等待的重试", async (mode) => {
    vi.useFakeTimers();
    const { client, send, replies } = controlledClient();
    const expired = client.request("fixture/query", { query: "same" }, 20);
    const timeout = expect(expired).rejects.toThrow("超时（20ms）");
    await vi.advanceTimersByTimeAsync(20);
    await timeout;
    const retry = client.request("fixture/query", { query: "same" });
    if (mode === "success") replies[0].resolve("expired result");
    else replies[0].reject(new Error("expired error"));
    await vi.advanceTimersByTimeAsync(0);
    const shared = client.request("fixture/query", { query: "same" });
    // 先释放所有原生请求，让修复前的失败也不会遗留定时器或悬空 Promise。
    for (const reply of replies.slice(1)) reply.resolve("fresh result");
    const values = await Promise.all([retry, shared]);
    expect(shared).toBe(retry);
    expect(send).toHaveBeenCalledTimes(2);
    expect(values).toEqual(["fresh result", "fresh result"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("不同 method 或 params 各自发起请求", async () => {
    const { client, send, replies } = controlledClient();
    const requests = [
      client.request("fixture/query", { query: "one" }),
      client.request("fixture/query", { query: "two" }),
      client.request("fixture/other", { query: "one" }),
    ];
    replies.forEach((reply, index) => reply.resolve(index));
    expect(await Promise.all(requests)).toEqual([0, 1, 2]);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("SDK 同步抛错后立即释放缓存与定时器，下一次调用可以重试", async () => {
    vi.useFakeTimers();
    const { client, send } = controlledClient();
    send.mockImplementationOnce(() => { throw new Error("synchronous send failure"); });
    send.mockResolvedValueOnce("recovered");
    await expect(client.request("fixture/query", {})).rejects.toThrow("synchronous send failure");
    const timersAfterError = vi.getTimerCount();
    const retried = await client.request("fixture/query", {}).then(
      (value) => ({ value }),
      (error: Error) => ({ error: error.message }),
    );
    expect(retried).toEqual({ value: "recovered" });
    expect(send).toHaveBeenCalledTimes(2);
    expect(timersAfterError).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("服务进程退出时拒绝等待者并清除请求定时器", async () => {
    vi.useFakeTimers();
    const { client, child, dispose } = controlledClient();
    const result = expect(client.request("fixture/query", {})).rejects.toThrow("server 进程退出");
    expect(vi.getTimerCount()).toBe(1);
    child.emit("exit", 1);
    await result;
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

async function requestServerWorkspace(stderrOnInitialize = 0, failInitialize = false, gateInput = false) {
  const dir = await mkdtemp(join(tmpdir(), "lsp-request-lifecycle-"));
  dirs.push(dir);
  const script = join(dir, "server.mjs");
  const protocol = pathToFileURL(createRequire(import.meta.url).resolve("vscode-languageserver-protocol/node")).href;
  await writeFile(script, `
import { createProtocolConnection, StreamMessageReader, StreamMessageWriter, InitializeRequest, ShutdownRequest, ExitNotification } from ${JSON.stringify(protocol)};
// 控制公开 MessageReader 的交付时机，明确把 request/cancel 同步交给 SDK；不赌两个定时器的先后。
const source = new StreamMessageReader(process.stdin);
let held = false;
const messages = [];
const input = ${gateInput} ? {
  onError: source.onError, onClose: source.onClose, onPartialMessage: source.onPartialMessage,
  dispose: () => source.dispose(),
  listen: (callback) => source.listen((message) => {
    if (message.method === "fixture/release-input") {
      held = false;
      for (const pending of messages.splice(0)) callback(pending);
    } else if (held) messages.push(message);
    else callback(message);
  }),
} : source;
const conn = createProtocolConnection(input, new StreamMessageWriter(process.stdout));
let count = 0;
const pending = new Map();
const cancelled = [];
const cancelledAtEntry = [];
conn.onRequest("fixture/hold-input", () => { held = true; return null; });
const writeStderr = (bytes) => new Promise((resolve, reject) => {
  process.stderr.write(Buffer.alloc(bytes, 120), (error) => error ? reject(error) : resolve());
});
conn.onRequest(InitializeRequest.type, async () => {
  if (${failInitialize}) throw new Error("fixture initialization failed");
  await writeStderr(${stderrOnInitialize});
  return { capabilities: {} };
});
conn.onRequest("fixture/noisy", async (params) => {
  await writeStderr(params.bytes);
  return { bytes: params.bytes };
});
conn.onRequest("fixture/query", (params, token) => new Promise((resolve, reject) => {
  const index = ++count;
  pending.set(index, { resolve, reject });
  if (token.isCancellationRequested) cancelledAtEntry.push(index);
  const cancel = () => {
    cancelled.push(index);
    if (params.cancelOnToken) { pending.delete(index); resolve({ cancelled: true }); }
  };
  // 同批取消可先于 handler；先检查当前状态，再订阅后续事件。
  if (token.isCancellationRequested) cancel();
  else token.onCancellationRequested(cancel);
}));
conn.onRequest("fixture/count", () => count);
conn.onRequest("fixture/cancelledAtEntry", () => cancelledAtEntry);
conn.onRequest("fixture/state", () => ({ count, pending: [...pending.keys()], cancelled }));
conn.onRequest("fixture/release", (params) => {
  const request = pending.get(params.index);
  pending.delete(params.index);
  if (request) {
    if (params.error) request.reject(new Error("expired error"));
    else request.resolve({ request: params.index });
  }
  return null;
});
conn.onRequest(ShutdownRequest.type, () => null);
conn.onNotification(ExitNotification.type, () => process.exit(0));
conn.listen();
`);
  await mkdir(join(dir, ".agent"));
  await writeFile(join(dir, ".agent/lsp.json"), JSON.stringify({ lsp: { fixture: { command: process.execPath, args: [script], extensions: [".ts"] } } }));
  return dir;
}

async function requestServer(stderrOnInitialize = 0) {
  const dir = await requestServerWorkspace(stderrOnInitialize);
  setLspTrustedRepos([dir]);
  return getLspClient(dir, loadLspConfig(dir), "fixture");
}

describe("官方 JSON-RPC 链路的超时重试", () => {
  it("相同调用共享的请求超时时，仅通知服务端取消一次并释放远端任务", async () => {
    const client = await requestServer();
    const params = { query: "shared timeout", cancelOnToken: true };
    const first = client.request("fixture/query", params, 20);
    const shared = client.request("fixture/query", params);
    await expect(first).rejects.toThrow("超时（20ms）");
    expect(shared).toBe(first);
    expect(await client.request("fixture/state", {})).toEqual({ count: 1, pending: [], cancelled: [1] });
  });

  it("一个请求超时只取消自己，其他并发请求仍能正常完成", async () => {
    const client = await requestServer();
    const expired = expect(client.request("fixture/query", { query: "slow", cancelOnToken: true }, 20)).rejects.toThrow("超时（20ms）");
    const other = client.request("fixture/query", { query: "other" });
    await expired;
    const state = await client.request("fixture/state", {});
    await client.request("fixture/release", { index: 2 });
    expect(await other).toEqual({ request: 2 });
    expect(state).toEqual({ count: 2, pending: [2], cancelled: [1] });
  });

  it("请求与取消同批到达，handler 开始前已取消也只释放自己的任务", async () => {
    const dir = await requestServerWorkspace(0, false, true);
    setLspTrustedRepos([dir]);
    const client = await getLspClient(dir, loadLspConfig(dir), "fixture");
    await client.request("fixture/hold-input", {});
    const expired = expect(client.request("fixture/query", { query: "batched", cancelOnToken: true }, 20)).rejects.toThrow("超时（20ms）");
    const other = client.request("fixture/query", { query: "other" });
    await expired;
    const statePromise = client.request("fixture/state", {});
    await client.notify("fixture/release-input", {});
    const state = await statePromise;
    await client.request("fixture/release", { index: 2 });
    expect(await other).toEqual({ request: 2 });
    expect(await client.request("fixture/cancelledAtEntry", {})).toEqual([1]);
    expect(state).toEqual({ count: 2, pending: [2], cancelled: [1] });
  });

  it.each(["success", "error"])("已完成的 %s 不会被后续请求的超时误取消", async (mode) => {
    const client = await requestServer();
    const first = client.request("fixture/query", { query: "completed" });
    const result = first.then((value) => value, (error: Error) => error.message);
    await client.request("fixture/release", { index: 1, error: mode === "error" });
    expect(await result).toEqual(mode === "success" ? { request: 1 } : "Request fixture/query failed with message: expired error");
    await expect(client.request("fixture/query", { query: "slow", cancelOnToken: true }, 20)).rejects.toThrow("超时（20ms）");
    expect(await client.request("fixture/state", {})).toEqual({ count: 2, pending: [], cancelled: [2] });
  });

  it.each(["success", "error"])("真实服务的迟到 %s 不会引发第三次相同请求", async (mode) => {
    const client = await requestServer();
    await expect(client.request("fixture/query", { query: "same" }, 20)).rejects.toThrow("超时（20ms）");
    const retry = client.request("fixture/query", { query: "same" });
    const countBefore = await client.request<number>("fixture/count", {});
    await client.request("fixture/release", { index: 1, error: mode === "error" });
    await client.request("fixture/count", {});
    const shared = client.request("fixture/query", { query: "same" });
    const countAfter = await client.request<number>("fixture/count", {});
    for (let index = 2; index <= countAfter; index++) await client.request("fixture/release", { index });
    const values = await Promise.all([retry, shared]);
    expect(countBefore).toBe(2);
    expect(countAfter).toBe(2);
    expect(shared).toBe(retry);
    expect(values).toEqual([{ request: 2 }, { request: 2 }]);
  });
});

describe("语言服务器 stderr 持续排空", () => {
  const logBytes = 8 * 1024 * 1024;

  it("初始化阶段输出大量日志也能完成握手", async () => {
    const client = await requestServer(logBytes);
    expect(await client.request("fixture/count", {})).toBe(0);
  });

  it("查询阶段输出大量日志不堵住请求，stdout 仍返回完整协议结果", async () => {
    const client = await requestServer();
    expect(await client.request("fixture/noisy", { bytes: logBytes }, 1000)).toEqual({ bytes: logBytes });
  });
});

describe("语言服务退出立即结束等待", () => {
  const uri = "file:///fixture/a.ts";

  it.each(["exit", "error"])("进程 %s 时结束全部诊断等待并清除定时器", async (event) => {
    vi.useFakeTimers();
    const { client, child } = controlledClient();
    let settled = false;
    const waiting = Promise.allSettled([
      client.waitForDiagnostics(uri, 0, 5000),
      client.waitForDiagnostics("file:///fixture/b.ts", 0, 5000),
    ]).then((results) => { settled = true; return results; });
    if (event === "exit") child.emit("exit", 1);
    else child.emit("error", new Error("fixture broke"));
    await vi.advanceTimersByTimeAsync(0);
    const settledOnExit = settled;
    const timersOnExit = vi.getTimerCount();
    await vi.advanceTimersByTimeAsync(5000);
    const results = await waiting;
    expect(settledOnExit).toBe(true);
    expect(timersOnExit).toBe(0);
    const message = event === "exit" ? "lsp: server 进程退出（code=1）" : "lsp: server 进程错误: fixture broke";
    expect(results).toEqual([
      { status: "rejected", reason: expect.objectContaining({ message }) },
      { status: "rejected", reason: expect.objectContaining({ message }) },
    ]);
  });

  it.each([false, true])("退出后不再创建诊断等待，也不复用旧的干净结果（缓存=%s）", async (cached) => {
    vi.useFakeTimers();
    const { client, child, publish } = controlledClient();
    if (cached) publish({ uri, diagnostics: [] });
    child.emit("exit", 0);
    let outcome: unknown = "pending";
    const waiting = client.waitForDiagnostics(uri, 0, 5000).then(
      (value) => { outcome = value; },
      (error: Error) => { outcome = error.message; },
    );
    await vi.advanceTimersByTimeAsync(0);
    const immediate = outcome;
    const timers = vi.getTimerCount();
    await vi.advanceTimersByTimeAsync(5000);
    await waiting;
    expect(immediate).toBe("lsp: 客户端已关闭");
    expect(timers).toBe(0);
  });

  it("退出后拒绝查询，不再向已关闭连接发起 RPC", async () => {
    const { client, child, send } = controlledClient();
    send.mockResolvedValueOnce("should not run");
    child.emit("exit", 0);
    const result = await client.request("fixture/query", {}).then(
      (value) => ({ value }),
      (error: Error) => ({ error: error.message }),
    );
    expect(result).toEqual({ error: "lsp: 客户端已关闭" });
    expect(send).not.toHaveBeenCalled();
  });

  it("主动关闭立即拒绝在途查询和诊断，并清除关闭操作自己的计时器", async () => {
    vi.useFakeTimers();
    const { client, send, replies, notify } = controlledClient();
    let settled = false;
    const waiting = Promise.allSettled([
      client.request("fixture/query", {}),
      client.waitForDiagnostics(uri, 0, 5000),
    ]).then((results) => { settled = true; return results; });
    send.mockResolvedValueOnce(null);
    await client.shutdown();
    await vi.advanceTimersByTimeAsync(0);
    const settledOnShutdown = settled;
    const timers = vi.getTimerCount();
    await vi.advanceTimersByTimeAsync(8000);
    replies[0].resolve(null);
    const results = await waiting;
    expect(settledOnShutdown).toBe(true);
    expect(timers).toBe(0);
    expect(results).toEqual([
      { status: "rejected", reason: expect.objectContaining({ message: "lsp: 客户端已关闭" }) },
      { status: "rejected", reason: expect.objectContaining({ message: "lsp: 客户端已关闭" }) },
    ]);
    expect(send.mock.calls.map(([method]) => method)).toEqual(["fixture/query", "shutdown"]);
    expect(notify).toHaveBeenCalledWith("exit", null);
  });

  it("真实服务退出时报告退出原因，诊断等待不再拖到自身超时", async () => {
    const client = await requestServer();
    const waiting = expect(client.waitForDiagnostics(uri, 0, 1000)).rejects.toThrow("server 进程退出");
    await client.notify("exit", null);
    await waiting;
  });
});

describe("初始化截止计时器不延长宿主进程生命周期", () => {
  it.each([false, true])("握手结束并完成清理后进程能自然退出（初始化失败=%s）", async (failInitialize) => {
    const dir = await requestServerWorkspace(0, failInitialize);
    const require = createRequire(import.meta.url);
    const source = pathToFileURL(require.resolve("../src/tools/lsp.ts")).href;
    const marker = "lsp cleanup complete\n";
    const probe = spawn(process.execPath, ["--import", require.resolve("tsx"), "--input-type=module", "--eval", `
import { getLspClient, loadLspConfig, setLspTrustedRepos, closeAllLspClients, isLspBroken } from ${JSON.stringify(source)};
const dir = ${JSON.stringify(dir)};
setLspTrustedRepos([dir]);
let failure;
try { await getLspClient(dir, loadLspConfig(dir), "fixture"); } catch (error) { failure = error; }
if (${failInitialize}) {
  if (!failure?.message.includes("fixture initialization failed") || !isLspBroken(dir, "fixture")) throw new Error("expected initialization failure and broken state");
} else if (failure) { throw failure; }
await closeAllLspClients();
process.stdout.write(${JSON.stringify(marker)});
`], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let errors = "";
    const ready = new Promise<void>((resolveReady) => {
      probe.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString();
        if (output.includes(marker)) resolveReady();
      });
    });
    probe.stderr.on("data", (chunk: Buffer) => { errors += chunk.toString(); });
    const closed = once(probe, "close");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        ready,
        closed.then(() => { if (!output.includes(marker)) throw new Error("lifecycle probe failed: " + errors); }),
      ]);
      // 从真实清理完成的标记开始计时，排除 Node/TSX 启动耗时。
      const result = await Promise.race([
        closed,
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("LSP 已清理，宿主进程仍被残留计时器拖住")), 1000); }),
      ]);
      expect(result).toEqual([0, null]);
      expect(errors).toBe("");
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (probe.exitCode === null && probe.signalCode === null) probe.kill("SIGKILL");
      await closed.catch(() => {});
    }
  });
});
