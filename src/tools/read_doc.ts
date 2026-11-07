// 文档读取（2026-11-06 业主「完善工具层」第二批）：pdf / docx / xlsx → 纯文本。
// **零新增依赖**：zip 容器（docx/xlsx）自写 central-directory 解析（stored + deflate 两法），
// deflate 走 node:zlib 内建；pdf 只做 best-effort 文本层提取（FlateDecode/裸内容流的
// Tj/TJ 操作符），扫描件/加密件失败时明说，不硬造。只读、不出网、路径闸与 read_file 同一口
// （resolveReadTarget：workspace 相对 + 本轮已批准的项目外附件 grant）。
// 诚实边界：复杂 pdf（CJK 编码子表、连字、多栏）提取不保证完整——输出带来源说明，
// 模型要保真时该知道去核对原文。
import { readFile } from "node:fs/promises";
import { inflateRawSync, inflateSync } from "node:zlib";
import { resolveReadTarget, ToolError, type Tool, type ToolResult } from "./base.js";

const DOC_MAX_FILE_BYTES = 20 * 1024 * 1024; // 20MB：文档读取不是挖矿
const DOC_MAX_CHARS = 20_000; // 输出帽（字符），超帽截断 + 出声
const XLSX_MAX_ROWS = 500;
const XLSX_MAX_CELL_CHARS = 300;

// ---- zip 容器解析（EOCD → central directory → local data）----
/** 解析 zip 的 central directory：name → 原始字节（stored 直取，deflate inflateRaw）。
 *  只支持单盘无 zip64 的常规档——办公文档都是这个形状；超界当场报错不硬猜。 */
function readZipEntries(buf: Buffer): Map<string, Buffer> {
  // EOCD 签名 0x06054b50：从尾部扫（注释最长 65535，扫最后 66KB 足够）。
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66 * 1024); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new ToolError("read_doc: zip 容器损坏（找不到 central directory 末端）");
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const entries = new Map<string, Buffer>();
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) {
      throw new ToolError("read_doc: zip 容器损坏（central directory 条目越界）");
    }
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString("utf8");
    p += 46 + nameLen + extraLen + commentLen;
    // local header：文件名/扩展段各自有一份长度，数据起点要用 local 那一份算。
    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== 0x04034b50) continue;
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const data = buf.slice(dataStart, dataStart + compressedSize);
    if (method === 0) entries.set(name, data);
    else if (method === 8) {
      try { entries.set(name, inflateRawSync(data)); }
      catch { /* 解压不了的成员跳过：缺它时由取用方报缺 */ }
    }
  }
  return entries;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/** XML 通用洗料：把结构标记换成换行/制表，其余标签剥掉，实体解码，压掉三连以上空行。 */
function xmlToText(xml: string, paragraphTags: boolean): string {
  let t = xml
    .replace(/<(w:tab|a:br)\b[^>]*\/>/g, "\t")
    .replace(/<w:br\b[^>]*\/>/g, "\n");
  if (paragraphTags) t = t.replace(/<\/w:p>/g, "\n").replace(/<w:p\b[^>]*\/>/g, "\n");
  t = t.replace(/<[^>]+>/g, "");
  t = decodeEntities(t).replace(/\n{3,}/g, "\n\n");
  return t.trim();
}

// ---- docx ----
function extractDocx(entries: Map<string, Buffer>): string {
  const doc = entries.get("word/document.xml");
  if (doc === undefined) throw new ToolError("read_doc: zip 容器里没有 word/document.xml——不是 docx");
  const text = xmlToText(doc.toString("utf8"), true);
  if (text === "") throw new ToolError("read_doc: docx 里没有可提取的正文（可能是空文档或纯图形）");
  return text;
}

// ---- xlsx ----
function extractXlsx(entries: Map<string, Buffer>): string {
  const sharedRaw = entries.get("xl/sharedStrings.xml");
  const shared: string[] = [];
  if (sharedRaw !== undefined) {
    const xml = sharedRaw.toString("utf8");
    for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      const parts: string[] = [];
      for (const t of m[1]!.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) parts.push(decodeEntities(t[1] ?? ""));
      shared.push(parts.join(""));
    }
  }
  // 第一张工作表：sheet1.xml 缺席时按 entries 里第一份 worksheets 成员兜底，不硬猜名字。
  let sheet = entries.get("xl/worksheets/sheet1.xml");
  if (sheet === undefined) {
    for (const [name, data] of entries) {
      if (name.startsWith("xl/worksheets/") && name.endsWith(".xml")) { sheet = data; break; }
    }
  }
  if (sheet === undefined) throw new ToolError("read_doc: xlsx 里没有工作表成员");
  const xml = sheet.toString("utf8");
  const totalRows = [...xml.matchAll(/<row[^>]*>/g)].length;
  const rows: string[] = [];
  for (const row of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    if (rows.length >= XLSX_MAX_ROWS) break;
    const cells: string[] = [];
    for (const cell of row[1]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      if (cells.length >= 50) break;
      const attrs = cell[1] ?? "";
      const body = cell[2] ?? "";
      const kind = attrs.match(/t="([^"]*)"/)?.[1] ?? "";
      let value = "";
      if (kind === "s") {
        const v = body.match(/<v[^>]*>([\s\S]*?)<\/v>/)?.[1];
        value = v !== undefined ? (shared[Number(v)] ?? "") : "";
      } else if (kind === "inlineStr") {
        value = decodeEntities(body.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] ?? "");
      } else {
        value = body.match(/<v[^>]*>([\s\S]*?)<\/v>/)?.[1] ?? "";
      }
      if (value.length > XLSX_MAX_CELL_CHARS) value = value.slice(0, XLSX_MAX_CELL_CHARS) + "…";
      cells.push(value.replace(/\t/g, " ").replace(/\n/g, " "));
    }
    rows.push(cells.join("\t"));
  }
  if (rows.length === 0) throw new ToolError("read_doc: xlsx 首表没有可提取的行（可能是空表）");
  return rows.join("\n") + (totalRows > XLSX_MAX_ROWS ? `\n[read_doc] 行数超 ${String(XLSX_MAX_ROWS)}，已截断` : "");
}

// ---- pdf（best-effort 文本层）----
/** PDF 字符串转义解法：\\ \( \) \n \r \t \b \f 与八进制 \ddd。 */
function pdfUnescape(raw: string): string {
  return raw.replace(/\\([nrtbf()\\]|\d{1,3})/g, (_m, esc: string) => {
    if (/^\d{1,3}$/.test(esc)) return String.fromCharCode(parseInt(esc, 8));
    const map: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" };
    return map[esc] ?? esc;
  });
}

/** 收集 pdf 内容流：FlateDecode 用 inflateSync，解不动的按裸流试——只收含文本操作符的流。 */
function collectPdfContentStreams(buf: Buffer): string[] {
  const latin = buf.toString("latin1");
  const segments: string[] = [];
  const STREAM_MARK = "stream";
  let searchFrom = 0;
  for (;;) {
    const sig = latin.indexOf(STREAM_MARK, searchFrom);
    if (sig < 0) break;
    let start = sig + STREAM_MARK.length;
    if (latin[start] === "\r") start += 1;
    if (latin[start] === "\n") start += 1;
    else { searchFrom = sig + STREAM_MARK.length; continue; } // 不是 stream 后紧跟换行：跳过这个词（"endstream" 尾部同串）
    const end = latin.indexOf("endstream", start);
    if (end < 0) break;
    const rawBytes = buf.slice(start, end);
    let content = "";
    try { content = inflateSync(rawBytes).toString("latin1"); }
    catch { content = rawBytes.toString("latin1"); }
    if (/\bT[jJ]\b/.test(content)) segments.push(content);
    searchFrom = end + "endstream".length;
  }
  return segments;
}

function extractPdfText(buf: Buffer): string {
  if (/\/Encrypt\b/.test(buf.toString("latin1"))) {
    throw new ToolError("read_doc: 加密 PDF 不支持（先解除加密再读）");
  }
  const segments = collectPdfContentStreams(buf);
  if (segments.length === 0) return "";
  // 每段：换行操作符（Td/TD/T*/ET）位置当行界，段内括号串当文本单元。
  const lines: string[] = [];
  for (const content of segments) {
    for (const seg of content.split(/\bT[dD]\b|\bT\*\b|\bET\b/)) {
      let line = "";
      for (const s of seg.matchAll(/\(((?:\\.|[^\\()])*)\)/g)) {
        line += pdfUnescape(s[1] ?? "");
      }
      if (line.trim() !== "") lines.push(line);
    }
  }
  return lines.join("\n").trim();
}

export const read_doc: Tool = {
  name: "read_doc",
  async run(args, ctx): Promise<ToolResult> {
    const rel = typeof args.path === "string" && args.path.trim() !== "" ? args.path : "";
    if (rel === "") throw new ToolError("read_doc: path 参数必须是非空字符串（pdf/docx/xlsx 文件）");
    const target = await resolveReadTarget(ctx.workspace, rel, "read_doc", ctx.externalReadGrants);
    const buf = await readFile(target.abs).catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") throw new ToolError(`read_doc: 文件不存在: ${rel}`);
      if (err.code === "EISDIR") throw new ToolError(`read_doc: ${rel} 是目录不是文件`);
      throw err;
    });
    if (buf.length > DOC_MAX_FILE_BYTES) {
      throw new ToolError(`read_doc: 文件超过 ${String(DOC_MAX_FILE_BYTES / (1024 * 1024))}MB 上限（${rel}）`);
    }
    const isZip = buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b;
    const isPdf = buf.length > 4 && buf.toString("latin1", 0, 5) === "%PDF-";
    let kind = "";
    let text = "";
    if (isZip) {
      const entries = readZipEntries(buf);
      if (entries.has("word/document.xml")) { kind = "docx"; text = extractDocx(entries); }
      else if (entries.has("xl/workbook.xml")) { kind = "xlsx"; text = extractXlsx(entries); }
      else {
        throw new ToolError("read_doc: 是 zip 容器但不是 docx/xlsx（本工具只读这两类 Office 文档与 pdf）");
      }
    } else if (isPdf) {
      kind = "pdf";
      text = extractPdfText(buf);
      if (text === "") {
        return { ok: false, output: `read_doc: pdf 没有可提取的文本层（可能是扫描件或纯图文档）：${rel}——要内容需要 OCR，超出本工具能力` };
      }
    } else {
      throw new ToolError("read_doc: 只支持 pdf / docx / xlsx（按文件内容判型，不是按扩展名）");
    }
    let out = `[read_doc] ${kind} · ${rel}（提取为纯文本；格式细节如表格线/图片不含）\n` + text;
    if (out.length > DOC_MAX_CHARS) {
      out = out.slice(0, DOC_MAX_CHARS) + `\n[read_doc] 输出已截断（>${String(DOC_MAX_CHARS)} 字符）——文档太长时按节拆源文件，或先转存为纯文本再用 read_file`;
    }
    return { ok: true, output: out };
  },
};
