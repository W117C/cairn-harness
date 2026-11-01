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
import { existsSync, writeFileSync } from "node:fs";

const ARGS = process.argv.slice(2);
const SLOW_INIT = ARGS.includes("--slow-init");
const CRASH_UNTIL = ARGS.find((a) => a.startsWith("--crash-until="))?.slice("--crash-until=".length);
if (CRASH_UNTIL !== undefined && !existsSync(CRASH_UNTIL)) {
  writeFileSync(CRASH_UNTIL, "crashed");
  process.exit(1);
}
// 能力协商的三种"真实服务器会做的事"，判卷按模式演：
//   --caps-to=<file>   把**客户端**声明的 capabilities 落盘（不声明 = 服务器只会给降级形状，
//                      而"降级"是静默的：linkSupport 没要 ⇒ definition 回 Location 不是 LocationLink，
//                      hover 没要 markdown ⇒ 回 plaintext，hierarchical 没要 ⇒ 回平铺符号表）
//   --no-hover         不声明 hoverProvider，且**不应答** hover（真服务器常这样：没实现就不回）
//   --incremental      声明 change:2，且**只接受带 range 的 didChange**（缺 range 就整条忽略）
//   --sync-none        声明 change:0：不接受 didChange，内容只在 didOpen 时读盘
const CAPS_TO = ARGS.find((a) => a.startsWith("--caps-to="))?.slice("--caps-to=".length);
const NO_HOVER = ARGS.includes("--no-hover");
const INCREMENTAL = ARGS.includes("--incremental");
const SYNC_NONE = ARGS.includes("--sync-none");
// LSP 3.17 的 workspaceSymbol 条目**允许没有 location**（服务器只知道名字）。真服务器会这么回
// （未索引的依赖符号就是这样），客户端不能假设每条都带位置。
const SYMBOL_NO_LOCATION = ARGS.includes("--symbol-no-location");



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

conn.onRequest(InitializeRequest.type, async (params) => {
  if (CAPS_TO !== undefined) writeFileSync(CAPS_TO, JSON.stringify(params.capabilities ?? null), "utf8");
  if (SLOW_INIT) await new Promise((r) => setTimeout(r, 2000));
  const capabilities = {
    textDocumentSync: INCREMENTAL
      ? { openClose: true, change: 2 }
      : SYNC_NONE
        ? { openClose: true, change: 0 }
        : 1,
    definitionProvider: true,
    referencesProvider: true,
    documentSymbolProvider: true,
    workspaceSymbolProvider: true,
    implementationProvider: true,
  };
  if (!NO_HOVER) capabilities.hoverProvider = true;
  return { capabilities };
});
conn.onNotification(InitializedNotification.type, () => {});
conn.onNotification(DidOpenTextDocumentNotification.type, (p) => {
  docs.set(p.textDocument.uri, p.textDocument.text);
  publish(p.textDocument.uri);
});
conn.onNotification(DidChangeTextDocumentNotification.type, (p) => {
  const c = p.contentChanges[p.contentChanges.length - 1];
  if (SYNC_NONE) return; // 声明了 change:0 的服务器不该收到 didChange；收到了也不当它是更新
  const before = docs.get(p.textDocument.uri) ?? "";
  if (INCREMENTAL) {
    if (!c.range) return; // 只认带 range 的增量编辑：缺 range 的整篇替换在这里**不生效**（不是报错，是沉默）
    docs.set(p.textDocument.uri, applyRange(before, c.range, c.text));
  } else {
    docs.set(p.textDocument.uri, c.text);
  }
  publish(p.textDocument.uri);
});
conn.onNotification(DidCloseTextDocumentNotification.type, (p) => {
  docs.delete(p.textDocument.uri);
  conn.sendNotification(PublishDiagnosticsNotification.type, { uri: p.textDocument.uri, diagnostics: [] });
});

/** 按 LSP 的 0-based 行列做区间替换（utf-16 计数与 JS string 一致）。 */
function offsetAt(text, line, character) {
  let offset = 0;
  let currentLine = 0;
  while (currentLine < line) {
    const nl = text.indexOf("\n", offset);
    if (nl < 0) return text.length;
    offset = nl + 1;
    currentLine++;
  }
  return Math.min(offset + character, text.length);
}

function applyRange(text, range, insert) {
  const from = offsetAt(text, range.start.line, range.start.character);
  const to = offsetAt(text, range.end.line, range.end.character);
  return text.slice(0, from) + insert + text.slice(to);
}


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
if (!NO_HOVER) {
  conn.onRequest(HoverRequest.type, (p) => {
    const sym = symAt(p);
    if (!sym) return null;
    return { contents: { kind: "markdown", value: "hover: " + sym + "（stub）" } };
  });
}

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
        out.push(
          SYMBOL_NO_LOCATION
            ? { name: m.sym, kind: 12, containerName: "top" }
            : { name: m.sym, kind: 12, location: markerRange(uri, m) },
        );
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
