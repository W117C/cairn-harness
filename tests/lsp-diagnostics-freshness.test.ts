import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Diagnostic, PublishDiagnosticsParams } from "vscode-languageserver-protocol/node";
import { LspClient, closeAllLspClients, collectDiagnostics, getLspClient, loadLspConfig, setLspTrustedRepos } from "../src/tools/lsp";

const target = "file:///fixture/a.ts";
const other = "file:///fixture/b.ts";
const error: Diagnostic = { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, severity: 1, message: "fresh target error" };
const dirs: string[] = [];
afterEach(async () => {
  await closeAllLspClients();
  setLspTrustedRepos([]);
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
function controlledClient() {
  let handler: ((params: PublishDiagnosticsParams) => void) | undefined;
  const connection = {
    onNotification(_type: unknown, callback: (params: PublishDiagnosticsParams) => void) { handler = callback; },
    async sendNotification() {},
  } as unknown as ConstructorParameters<typeof LspClient>[1];
  const client = new LspClient(new EventEmitter() as ChildProcess, connection, "/fixture", "diagnostic-fixture");
  const publish = (uri: string, diagnostics: Diagnostic[], version?: number) => {
    if (!handler) throw new Error("diagnostic notification handler missing");
    handler({ uri, diagnostics, ...(version !== undefined ? { version } : {}) });
  };
  return { client, publish };
}

describe("LSP 诊断新鲜度按文件与文档版本判定", () => {
  it("别的文件先更新，不能把目标文件旧的无错误结果当成本次结果", async () => {
    const { client, publish } = controlledClient();
    publish(target, []);
    const baseline = client.currentRev();
    publish(other, []);
    let settled = false;
    const pending = client.waitForDiagnostics(target, baseline, 100).then((value) => { settled = true; return value; });
    await Promise.resolve();
    expect(settled).toBe(false);
    publish(target, [error]);
    expect(await pending).toEqual([error]);
  });

  it("别的文件更新也不能让目标文件的旧错误覆盖本次已修好的结果", async () => {
    const { client, publish } = controlledClient();
    publish(target, [error]);
    const baseline = client.currentRev();
    publish(other, []);
    const pending = client.waitForDiagnostics(target, baseline, 100);
    publish(target, []);
    expect(await pending).toEqual([]);
  });

  it("已经开始等待时，无关文件通知不会唤醒目标文件等待者", async () => {
    const { client, publish } = controlledClient();
    let settled = false;
    const pending = client.waitForDiagnostics(target, client.currentRev(), 100).then((value) => { settled = true; return value; });
    publish(other, [error]);
    await Promise.resolve();
    expect(settled).toBe(false);
    publish(target, []);
    expect(await pending).toEqual([]);
  });

  it.each([1, 3])("当前文档为版本 2，不接受服务器标成版本 %s 的诊断", async (version) => {
    const { client, publish } = controlledClient();
    await client.openFile("/fixture/a.ts", "initial");
    publish(target, [], 1);
    const baseline = client.currentRev();
    await client.openFile("/fixture/a.ts", "updated");
    publish(target, [], version);
    await expect(client.waitForDiagnostics(target, baseline, 20)).rejects.toThrow("等待诊断超时");
  });

  it("兼容不发送可选 version 字段的服务器，当前文件的新空诊断仍可用", async () => {
    const { client, publish } = controlledClient();
    await client.openFile("/fixture/a.ts", "initial");
    publish(target, [error], 1);
    const baseline = client.currentRev();
    await client.openFile("/fixture/a.ts", "updated");
    publish(target, []);
    expect(await client.waitForDiagnostics(target, baseline, 100)).toEqual([]);
  });
});

async function diagnosticServer() {
  const dir = await mkdtemp(join(tmpdir(), "lsp-diagnostic-freshness-"));
  dirs.push(dir);
  const file = join(dir, "a.ts");
  const script = join(dir, "server.mjs");
  const protocol = pathToFileURL(createRequire(import.meta.url).resolve("vscode-languageserver-protocol/node")).href;
  await writeFile(script, `
import { createProtocolConnection, StreamMessageReader, StreamMessageWriter, InitializeRequest, DidOpenTextDocumentNotification, DidChangeTextDocumentNotification, PublishDiagnosticsNotification, ShutdownRequest, ExitNotification } from ${JSON.stringify(protocol)};
const conn = createProtocolConnection(new StreamMessageReader(process.stdin), new StreamMessageWriter(process.stdout));
let uri = "";
let version = 0;
conn.onRequest(InitializeRequest.type, () => ({ capabilities: { textDocumentSync: 1 } }));
conn.onNotification(DidOpenTextDocumentNotification.type, (params) => {
  uri = params.textDocument.uri; version = params.textDocument.version;
  return conn.sendNotification(PublishDiagnosticsNotification.type, { uri, version, diagnostics: [] });
});
conn.onNotification(DidChangeTextDocumentNotification.type, (params) => { uri = params.textDocument.uri; version = params.textDocument.version; });
conn.onRequest("fixture/barrier", () => null);
conn.onRequest("fixture/action", async (params) => {
  const target = params.mode === "unrelated" ? params.other : uri;
  await conn.sendNotification(PublishDiagnosticsNotification.type, {
    uri: target, version: params.mode === "stale" ? version - 1 : version,
    diagnostics: params.mode === "fresh" ? [${JSON.stringify(error)}] : [],
  });
  return null;
});
conn.onRequest(ShutdownRequest.type, () => null);
conn.onNotification(ExitNotification.type, () => process.exit(0));
conn.listen();
`);
  await mkdir(join(dir, ".agent"));
  await writeFile(join(dir, ".agent/lsp.json"), JSON.stringify({ lsp: { fixture: { command: process.execPath, args: [script], extensions: [".ts"] } } }));
  await writeFile(file, "initial");
  setLspTrustedRepos([dir]);
  const client = await getLspClient(dir, loadLspConfig(dir), "fixture");
  await client.openFile(file);
  await client.request("fixture/barrier", {});
  expect(client.currentRev()).toBe(1);
  await writeFile(file, "updated");
  const open = client.openFile.bind(client);
  const collect = async (mode: string) => {
    vi.spyOn(client, "openFile").mockImplementation(async (...args) => {
      await open(...args);
      // 故意在 openFile 返回前交付通知，复现真实竞态；诊断仍经过完整 JSON-RPC 链。
      await client.request("fixture/action", { mode, other: pathToFileURL(join(dir, "other.ts")).href });
    });
    return collectDiagnostics(dir, file, 30);
  };
  return { collect };
}

describe("真实 collectDiagnostics 不把旧诊断报成干净", () => {
  it.each(["unrelated", "stale"])("只有 %s 通知时如实报告本次诊断缺席", async (mode) => {
    const server = await diagnosticServer();
    const result = await server.collect(mode);
    expect(result).toContain("diagnostics-unavailable");
    expect(result).toContain("没有静态诊断证据");
  });

  it("当前文件、当前版本的新错误照常回流", async () => {
    const server = await diagnosticServer();
    const result = await server.collect("fresh");
    expect(result).toContain("fresh target error");
    expect(result).not.toContain("diagnostics-unavailable");
  });
});
