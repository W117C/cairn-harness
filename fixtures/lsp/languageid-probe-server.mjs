// LSP languageId 探针 server：把每个 didOpen 的 languageId 记下来，
// 并用一个自定义请求 `probe/languageIds` 原样交回。
//
// 为什么另起一个 server 而不改 stub-server.mjs：`fixtures/lsp/stub-server.mjs` 是
// M2a 六操作的既有靶子（`tests/lsp.test.ts` 一族靠它的行标记约定跑），
// 往它身上加一个自定义请求会让那一族多担一份面。这里只探一件事——
// **didOpen 送出去的 languageId 到底是什么**，这是本仓 2026-10-23 修的那个缺陷的观测点。
import {
  createProtocolConnection,
  StreamMessageReader,
  StreamMessageWriter,
  InitializeRequest,
  InitializedNotification,
  DidOpenTextDocumentNotification,
  DidChangeTextDocumentNotification,
  PublishDiagnosticsNotification,
  ShutdownRequest,
  ExitNotification,
} from "vscode-languageserver-protocol/node";

const reader = new StreamMessageReader(process.stdin);
const writer = new StreamMessageWriter(process.stdout);
const conn = createProtocolConnection(reader, writer);

/** uri → languageId（服务器侧唯一的事实源）。 */
const seen = new Map();

conn.onRequest(InitializeRequest.type, () => ({
  capabilities: {
    // 自定义请求：把观测到的 languageId 表原样交回（判卷用它，产品代码不依赖它）。
    executeCommandProvider: {},
    textDocumentSync: 1,
  },
  serverInfo: { name: "lsp-languageid-probe", version: "1.0.0" },
}));

conn.onNotification(InitializedNotification.type, () => {});

conn.onNotification(DidOpenTextDocumentNotification.type, (p) => {
  seen.set(p.textDocument.uri, p.textDocument.languageId);
});

conn.onNotification(DidChangeTextDocumentNotification.type, () => {});

// 自定义请求（vscode-languageserver-protocol 的 GenericRequestHandler 走字符串 method）
conn.onRequest("probe/languageIds", () => Object.fromEntries(seen));

conn.onRequest(ShutdownRequest.type, () => null);
conn.onNotification(ExitNotification.type, () => process.exit(0));

conn.listen();
