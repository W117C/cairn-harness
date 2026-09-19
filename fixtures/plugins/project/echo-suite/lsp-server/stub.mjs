// 插件自带的 LSP server（§9.8 判卷样本）：由 echo-suite/.lsp.json 的 ${PLUGIN_ROOT} 指过来。
// 只做一件事——把 initialize 收到的 initializationOptions 回显在 hover 里，
// 于是「插件声明的服务器真的被注册、被 spawn、配置真的传到 initialize」三件事一次验完。
// 用 plain node 跑（fixtures 不进 tsc），依赖仓库根的 vscode-languageserver-protocol。
import {
  createProtocolConnection, StreamMessageReader, StreamMessageWriter,
  InitializeRequest, InitializedNotification, HoverRequest, ShutdownRequest, ExitNotification,
  DidOpenTextDocumentNotification, DidChangeTextDocumentNotification, PublishDiagnosticsNotification,
} from "vscode-languageserver-protocol/node";

const conn = createProtocolConnection(new StreamMessageReader(process.stdin), new StreamMessageWriter(process.stdout));
let optsEcho = "none";

conn.onRequest(InitializeRequest.type, (p) => {
  const opts = p.initializationOptions;
  // 原样回显宿主传来的 initializationOptions（不是"收到某个键"，而是整包内容）
  if (opts && typeof opts === "object") optsEcho = JSON.stringify(opts);
  return { capabilities: { hoverProvider: true, textDocumentSync: 1 } };
});
conn.onNotification(InitializedNotification.type, () => {});
conn.onRequest(HoverRequest.type, () => ({ contents: { kind: "markdown", value: "plugin-opts " + optsEcho } }));
// 打开/改动即推一条 ERROR 诊断：判据据此分辨「diagnostics.enabled 兑现了」与「推了但被忽略」。
const publish = (uri) => conn.sendNotification(PublishDiagnosticsNotification.type, {
  uri,
  diagnostics: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, severity: 1, message: "plugin-stub-diag" }],
});
conn.onNotification(DidOpenTextDocumentNotification.type, (p) => publish(p.textDocument.uri));
conn.onNotification(DidChangeTextDocumentNotification.type, (p) => publish(p.textDocument.uri));
conn.onRequest(ShutdownRequest.type, () => null);
conn.onNotification(ExitNotification.type, () => process.exit(0));
conn.listen();
