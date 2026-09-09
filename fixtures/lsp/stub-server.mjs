// M2a 测试用最小 LSP stub server（stdio JSON-RPC，零外部依赖）。
// 约定（与 fixtures/lsp/sample.ts 对齐）：
//   DEF(<sym>) / REF(<sym>) / IMPL(<sym>) 行 = 定义 / 引用 / 实现 位置
//   SYM(<name>) 行 = 文档符号（documentSymbol / workspaceSymbol 数据源）
//   ERROR_HERE 行 = 发布一条 ERROR 诊断；WARN_HERE 行 = 发布一条 WARNING 诊断
// 诊断在 didOpen / didChange 时推送（先推诊断再应答请求，保证 collectDiagnostics 的等待确定性）。
import {
  createProtocolConnection,
  StreamMessageReader,
  StreamMessageWriter,
  InitializeRequest,
  InitializedNotification,
  DidOpenTextDocumentNotification,
  DidChangeTextDocumentNotification,
  DidCloseTextDocumentNotification,
  PublishDiagnosticsNotification,
  DefinitionRequest,
  ReferencesRequest,
  HoverRequest,
  DocumentSymbolRequest,
  WorkspaceSymbolRequest,
  ImplementationRequest,
  ShutdownRequest,
  ExitNotification,
} from "vscode-languageserver-protocol/node";

const docs = new Map();

const reader = new StreamMessageReader(process.stdin);
const writer = new StreamMessageWriter(process.stdout);
const conn = createProtocolConnection(reader, writer);

function lines(text) {
  return text.split("\n");
}

function findMarkers(text, marker) {
  const out = [];
  lines(text).forEach((l, i) => {
    const idx = l.indexOf(marker + "(");
    if (idx >= 0) {
      const close = l.indexOf(")", idx);
      if (close > idx) out.push({ line: i, character: idx, sym: l.slice(idx + marker.length + 1, close) });
    }
  });
  return out;
}

function publish(uri) {
  const text = docs.get(uri);
  if (text === undefined) return;
  const diagnostics = [];
  lines(text).forEach((l, i) => {
    const e = l.indexOf("ERROR_HERE");
    if (e >= 0) {
      diagnostics.push({
        range: { start: { line: i, character: e }, end: { line: i, character: e + 10 } },
        message: "stub: 该行标记了错误（第 " + String(i + 1) + " 行）",
        severity: 1,
      });
    }
    const w = l.indexOf("WARN_HERE");
    if (w >= 0) {
      diagnostics.push({
        range: { start: { line: i, character: w }, end: { line: i, character: w + 9 } },
        message: "stub: 该行标记了警告",
        severity: 2,
      });
    }
  });
  conn.sendNotification(PublishDiagnosticsNotification.type, { uri, diagnostics });
}

function docAt(p) {
  return docs.get(p.textDocument.uri);
}

function markerRange(uri, m) {
  return { uri, range: { start: { line: m.line, character: m.character }, end: { line: m.line, character: m.character + m.sym.length } } };
}

conn.onRequest(InitializeRequest.type, () => ({
  capabilities: {
    textDocumentSync: 1,
    definitionProvider: true,
    referencesProvider: true,
    hoverProvider: true,
    documentSymbolProvider: true,
    workspaceSymbolProvider: true,
    implementationProvider: true,
  },
}));
conn.onNotification(InitializedNotification.type, () => {});
conn.onNotification(DidOpenTextDocumentNotification.type, (p) => {
  docs.set(p.textDocument.uri, p.textDocument.text);
  publish(p.textDocument.uri);
});
conn.onNotification(DidChangeTextDocumentNotification.type, (p) => {
  const c = p.contentChanges[p.contentChanges.length - 1];
  docs.set(p.textDocument.uri, c.text);
  publish(p.textDocument.uri);
});
conn.onNotification(DidCloseTextDocumentNotification.type, (p) => {
  docs.delete(p.textDocument.uri);
  conn.sendNotification(PublishDiagnosticsNotification.type, { uri: p.textDocument.uri, diagnostics: [] });
});

function symAt(p) {
  const text = docAt(p);
  if (text === undefined) return "";
  const ls = lines(text);
  const l = ls[p.position.line] ?? "";
  let s = p.position.character;
  if (s > l.length) s = l.length;
  const isWord = (ch) => /[A-Za-z0-9_]/.test(ch);
  if (!isWord(l[s] ?? "")) s -= 1;
  let start = s;
  let end = s;
  while (start >= 0 && isWord(l[start])) start--;
  while (end < l.length && isWord(l[end])) end++;
  return l.slice(start + 1, end);
}

conn.onRequest(DefinitionRequest.type, (p) => {
  const sym = symAt(p);
  const m = findMarkers(docAt(p) ?? "", "DEF").find((x) => x.sym === sym);
  return m ? markerRange(p.textDocument.uri, m) : null;
});
conn.onRequest(ReferencesRequest.type, (p) => {
  const sym = symAt(p);
  const text = docAt(p) ?? "";
  const refs = findMarkers(text, "REF").filter((x) => x.sym === sym);
  const def = findMarkers(text, "DEF").find((x) => x.sym === sym);
  const all = def ? [def, ...refs] : refs;
  return all.map((m) => markerRange(p.textDocument.uri, m));
});
conn.onRequest(ImplementationRequest.type, (p) => {
  const sym = symAt(p);
  const text = docAt(p) ?? "";
  const impls = findMarkers(text, "IMPL").filter((x) => x.sym === sym);
  return impls.map((m) => markerRange(p.textDocument.uri, m));
});
conn.onRequest(HoverRequest.type, (p) => {
  const sym = symAt(p);
  if (!sym) return null;
  return { contents: { kind: "markdown", value: "hover: " + sym + "（stub）" } };
});
conn.onRequest(DocumentSymbolRequest.type, (p) => {
  const text = docAt(p) ?? "";
  return findMarkers(text, "SYM").map((m) => ({
    name: m.sym,
    kind: 12,
    range: { start: { line: m.line, character: m.character }, end: { line: m.line, character: m.character + m.sym.length } },
    selectionRange: { start: { line: m.line, character: m.character }, end: { line: m.line, character: m.character + m.sym.length } },
    children: [],
  }));
});
conn.onRequest(WorkspaceSymbolRequest.type, (p) => {
  const query = (p.query ?? "").toLowerCase();
  const out = [];
  for (const [uri, text] of docs) {
    for (const m of findMarkers(text, "SYM")) {
      if (m.sym.toLowerCase().includes(query)) {
        out.push({ name: m.sym, kind: 12, location: markerRange(uri, m) });
      }
    }
  }
  return out;
});
conn.onRequest(ShutdownRequest.type, () => null);
conn.onNotification(ExitNotification.type, () => {
  // 等 stdout 排干再退出：client 端正在读的帧不被截断，避免 write-after-destroy 竞态
  if (process.stdout.writableLength > 0) {
    process.stdout.once("drain", () => process.exit(0));
    setTimeout(() => process.exit(0), 200).unref();
  } else {
    process.exit(0);
  }
});

conn.listen();
