// 文档读取（2026-11-06 业主「完善工具层」第二批）：pdf / docx / xlsx → 纯文本。
// **零新增依赖**：zip 容器（docx/xlsx）自写 central-directory 解析（stored + deflate 两法），
// deflate 走 node:zlib 内建；pdf 只做 best-effort 文本层提取（FlateDecode/裸内容流的
// Tj/TJ 操作符），扫描件/加密件失败时明说，不硬造。只读、不出网、路径闸与 read_file 同一口
// （resolveReadTarget：workspace 相对 + 本轮已批准的项目外附件 grant）。
// 诚实边界：复杂 pdf（CJK 编码子表、连字、多栏）提取不保证完整——输出带来源说明，
// 模型要保真时该知道去核对原文。
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { posix } from "node:path";
import { inflateRawSync, inflateSync } from "node:zlib";
import { resolveReadTarget, ToolError, type Tool, type ToolResult } from "./base.js";

/** 文件读帽。**导出**：web_doc 的响应体帽取同一数值——「文档该有多大」的口径两把工具必须同源，
 *  门里另抄一份数字就会在帽改了的那一刻与代码分家。 */
export const DOC_MAX_FILE_BYTES = 20 * 1024 * 1024; // 20MB：文档读取不是挖矿
const DOC_MAX_MEMBER_BYTES = 8 * 1024 * 1024;
const DOC_MAX_EXPANDED_BYTES = 16 * 1024 * 1024;
const DOC_MAX_CHARS = 20_000; // 输出帽（字符），超帽截断 + 出声
const XLSX_MAX_ROWS = 500;
const XLSX_MAX_CELL_CHARS = 300;

function expansionError(): ToolError {
  return new ToolError("read_doc: 解压内容超过上限（单个成员 8 MiB，累计 16 MiB）");
}

function memberLimit(expanded: number): number {
  return Math.min(DOC_MAX_MEMBER_BYTES, DOC_MAX_EXPANDED_BYTES - expanded);
}

function exceedsInflateLimit(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE";
}

async function readDocumentFile(path: string, display: string): Promise<Buffer> {
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") throw new ToolError(`read_doc: 文件不存在: ${display}`);
    if (err.code === "EISDIR") throw new ToolError(`read_doc: ${display} 是目录不是文件`);
    throw err;
  });
  try {
    const stat = await file.stat();
    if (stat.isDirectory()) throw new ToolError(`read_doc: ${display} 是目录不是文件`);
    if (!stat.isFile()) throw new ToolError(`read_doc: 只支持普通文件（${display}）`);
    const tooLarge = () => new ToolError(`read_doc: 文件超过 ${String(DOC_MAX_FILE_BYTES / (1024 * 1024))}MB 上限（${display}）`);
    if (stat.size > DOC_MAX_FILE_BYTES) throw tooLarge();
    // 额外读一个字节检测文件增长，读到的总量仍有硬上限。
    const buf = Buffer.allocUnsafe(stat.size + 1);
    let offset = 0;
    while (offset < buf.length) {
      const { bytesRead } = await file.read(buf, offset, buf.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > DOC_MAX_FILE_BYTES) throw tooLarge();
    if (offset !== stat.size) throw new ToolError(`read_doc: 文件大小在读取期间变化（${display}），请重试`);
    return buf.subarray(0, offset);
  } finally {
    await file.close();
  }
}

// ---- zip 容器解析（EOCD → central directory → local data）----
/** 只索引 central directory，正文需要的成员才读出（stored 直取，deflate inflateRaw）。
 *  只支持单盘无 zip64 的常规档——办公文档都是这个形状；超界当场报错不硬猜。 */
function readZipEntries(buf: Buffer) {
  // EOCD 签名 0x06054b50：从尾部扫（注释最长 65535，扫最后 66KB 足够）。
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66 * 1024); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50 && i + 22 + buf.readUInt16LE(i + 20) === buf.length) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ToolError("read_doc: zip 容器损坏（找不到 central directory 末端）");
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const cdEnd = cdOffset + buf.readUInt32LE(eocd + 12);
  if (cdEnd > eocd) throw new ToolError("read_doc: zip 容器损坏（central directory 越界）");
  const entries = new Map<string, { method: number; compressedSize: number; expandedSize: number; localOffset: number }>();
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > cdEnd || buf.readUInt32LE(p) !== 0x02014b50) {
      throw new ToolError("read_doc: zip 容器损坏（central directory 条目越界）");
    }
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const expandedSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const next = p + 46 + nameLen + extraLen + commentLen;
    if (next > cdEnd) throw new ToolError("read_doc: zip 容器损坏（central directory 条目越界）");
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    entries.set(name, { method, compressedSize, expandedSize, localOffset });
    p = next;
  }

  let expanded = 0;
  function read(name: string): Buffer | undefined {
    const entry = entries.get(name);
    if (entry === undefined) return undefined;
    const { method, compressedSize, expandedSize, localOffset } = entry;
    if (localOffset + 30 > cdOffset || buf.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new ToolError(`read_doc: zip 成员头损坏（${name}）`);
    }
    const dataStart = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    if (dataStart + compressedSize > cdOffset) throw new ToolError(`read_doc: zip 成员越界（${name}）`);
    const limit = memberLimit(expanded);
    if (expandedSize > limit || (method === 0 && compressedSize > limit)) throw expansionError();
    const raw = buf.subarray(dataStart, dataStart + compressedSize);
    let data: Buffer;
    if (method === 0) data = raw;
    else if (method === 8) {
      try {
        data = inflateRawSync(raw, { maxOutputLength: Math.max(1, limit) });
      } catch (error) {
        if (exceedsInflateLimit(error)) throw expansionError();
        throw new ToolError(`read_doc: zip 成员解压失败（${name}）`);
      }
    } else throw new ToolError(`read_doc: zip 成员使用了不支持的压缩方式（${name}）`);
    if (data.length > limit) throw expansionError();
    expanded += data.length;
    return data;
  }
  return { entries, read };
}

type ZipDocument = ReturnType<typeof readZipEntries>;

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
function extractDocx(archive: ZipDocument): string {
  const doc = archive.read("word/document.xml");
  if (doc === undefined) throw new ToolError("read_doc: zip 容器里没有 word/document.xml——不是 docx");
  const text = xmlToText(doc.toString("utf8"), true);
  if (text === "") throw new ToolError("read_doc: docx 里没有可提取的正文（可能是空文档或纯图形）");
  return text;
}

// ---- xlsx ----
function attributesOf(tag: string): Map<string, string> {
  return new Map(Array.from(tag.matchAll(/([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g), (m) =>
    [m[1]!, decodeEntities(m[2] ?? m[3] ?? "")]));
}

function firstSheetPath(archive: ZipDocument, workbook: string): string | undefined {
  const relationships = archive.read("xl/_rels/workbook.xml.rels")?.toString("utf8");
  const sheet = workbook.replace(/<!--[\s\S]*?-->/g, "").match(/<(?:[\w.-]+:)?sheet\b(?=[\s/>])(?:[^"'<>]|"[^"]*"|'[^']*')*>/);
  const attributes = attributesOf(sheet?.[0] ?? "");
  const relationshipId = attributes.get("r:id") ?? [...attributes].find(([name]) => name.endsWith(":id"))?.[1];
  // 旧简化档缺席关系元数据时仍能读取。声明了关系的文件必须兑现，不按文件编号猜表。
  if (relationshipId === undefined && relationships === undefined) {
    const conventional = "xl/worksheets/sheet1.xml";
    return archive.entries.has(conventional) ? conventional
      : [...archive.entries.keys()].find((name) => name.startsWith("xl/worksheets/") && name.endsWith(".xml"));
  }
  if (relationshipId === undefined || relationships === undefined) throw new ToolError("read_doc: xlsx 首表关系缺失");
  for (const match of relationships.replace(/<!--[\s\S]*?-->/g, "").matchAll(/<(?:[\w.-]+:)?Relationship\b(?=[\s/>])(?:[^"'<>]|"[^"]*"|'[^']*')*>/g)) {
    const relation = attributesOf(match[0]);
    if (relation.get("Id") !== relationshipId) continue;
    const target = relation.get("Target");
    const type = relation.get("Type");
    if (!target || relation.get("TargetMode") === "External"
      || (type !== undefined && !type.endsWith("/worksheet")) || /^[\w+.-]+:|^\/\/|[\\?#]/.test(target)) {
      throw new ToolError("read_doc: xlsx 首个标签未指向内部工作表");
    }
    return posix.resolve("/xl", target).slice(1);
  }
  throw new ToolError("read_doc: xlsx 首表关系缺失");
}

function extractXlsx(archive: ZipDocument): string {
  const workbook = archive.read("xl/workbook.xml")!.toString("utf8");
  const sheetPath = firstSheetPath(archive, workbook);
  const sheet = sheetPath === undefined ? undefined : archive.read(sheetPath);
  if (sheet === undefined) throw new ToolError("read_doc: xlsx 里没有首表对应的工作表成员");
  const sharedRaw = archive.read("xl/sharedStrings.xml");
  const shared: string[] = [];
  if (sharedRaw !== undefined) {
    const xml = sharedRaw.toString("utf8");
    for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      const parts: string[] = [];
      for (const t of m[1]!.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) parts.push(decodeEntities(t[1] ?? ""));
      shared.push(parts.join(""));
    }
  }
  const xml = sheet.toString("utf8");
  const rows: string[] = [];
  let truncated = false;
  for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    if (rows.length >= XLSX_MAX_ROWS) { truncated = true; break; }
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
  return rows.join("\n") + (truncated ? `\n[read_doc] 行数超 ${String(XLSX_MAX_ROWS)}，已截断` : "");
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
  let expanded = 0;
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
    const limit = memberLimit(expanded);
    let data: Buffer;
    try {
      data = inflateSync(rawBytes, { maxOutputLength: Math.max(1, limit) });
    } catch (error) {
      if (exceedsInflateLimit(error)) throw expansionError();
      data = rawBytes;
    }
    if (data.length > limit) throw expansionError();
    expanded += data.length;
    const content = data.toString("latin1");
    if (/\bT[jJ]\b/.test(content)) segments.push(content);
    searchFrom = end + "endstream".length;
  }
  return segments;
}

/** pdf → 文本层。加密件在入口就点名拒绝（「先解除加密再读」的可行动出口）。
 *  导出只为判卷（承诺面证人直接钉函数本体；同 planDecisionFor 先例）。 */
export function extractPdfText(buf: Buffer): string {
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

/** 按 Buffer 判型并抽取正文（读侧唯一入口）：read_doc 与 web_doc 共用这一份（规则 205，
 *  两处各写一份判型迟早漂）。kind 按文件内容判，不看扩展名。pdf 文本层为空时**不在此抛**——
 *  「扫描件」的措辞带各自的来源语境（本地路径 / 网络 URL），由调用方自己出声。 */
export function parseDocumentBuffer(buf: Buffer, label = "read_doc"): { kind: "pdf" | "docx" | "xlsx"; text: string } {
  const isZip = buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b;
  const isPdf = buf.length > 4 && buf.toString("latin1", 0, 5) === "%PDF-";
  if (isZip) {
    const archive = readZipEntries(buf);
    if (archive.entries.has("word/document.xml")) return { kind: "docx", text: extractDocx(archive) };
    if (archive.entries.has("xl/workbook.xml")) return { kind: "xlsx", text: extractXlsx(archive) };
    throw new ToolError(`${label}: 是 zip 容器但不是 docx/xlsx（本解析器只读这两类 Office 文档与 pdf）`);
  }
  if (isPdf) return { kind: "pdf", text: extractPdfText(buf) };
  throw new ToolError(`${label}: 只支持 pdf / docx / xlsx（按文件内容判型，不是按扩展名）`);
}

export const read_doc: Tool = {
  name: "read_doc",
  async run(args, ctx): Promise<ToolResult> {
    const rel = typeof args.path === "string" && args.path.trim() !== "" ? args.path : "";
    if (rel === "") throw new ToolError("read_doc: path 参数必须是非空字符串（pdf/docx/xlsx 文件）");
    const target = await resolveReadTarget(ctx.workspace, rel, "read_doc", ctx.externalReadGrants);
    const buf = await readDocumentFile(target.abs, rel);
    const { kind, text } = parseDocumentBuffer(buf);
    if (kind === "pdf" && text === "") {
      return { ok: false, output: `read_doc: pdf 没有可提取的文本层（可能是扫描件或纯图文档）：${rel}——要内容需要 OCR，超出本工具能力` };
    }
    let out = `[read_doc] ${kind} · ${rel}（提取为纯文本；格式细节如表格线/图片不含）\n` + text;
    if (out.length > DOC_MAX_CHARS) {
      out = out.slice(0, DOC_MAX_CHARS) + `\n[read_doc] 输出已截断（>${String(DOC_MAX_CHARS)} 字符）——文档太长时按节拆源文件，或先转存为纯文本再用 read_file`;
    }
    return { ok: true, output: out };
  },
};
