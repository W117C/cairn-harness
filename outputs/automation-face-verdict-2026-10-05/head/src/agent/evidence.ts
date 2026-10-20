// ② VerifiableEvidence：可验证收据纪律（SoL-Pi evidence-preserving-reducer 的本地确定性移植）。
// 提案：docs/solpi-port-proposal.md §3.2。零 LLM、零网络（§1.4：不移植远程 reducer 外呼）；
// 每条引文必须逐字出现在归档原文里，否则整单作废（0 容忍），保留原文不替换。
// 事件侧无新类型：收据在 computePrune 之后由 SolpiRuntime 校验并投影，原始输出前缀不授予免剪权。

import { createHash } from "node:crypto";

/** 收据行的序列化前缀；仅用于识别，不代表内容已受信任或通过校验。 */
export const EVIDENCE_RECEIPT_PREFIX = "dsh_evidence_receipt_v1";

/** 照抄 SoL-Pi config.ts:12,14 真值。 */
export const MAX_EVIDENCE_ITEMS = 12;
export const MAX_QUOTE_CHARS = 600;

export type EvidenceKind = "fatal" | "failure" | "warning" | "target" | "summary";

export interface EvidenceItem {
  kind: EvidenceKind;
  /** 1-based 行号（构建时已知；解析外来收据时可能缺省）。 */
  line?: number;
  quote: string;
  quoteSha256: string;
}

export interface EvidenceReceipt {
  status: "success" | "failure";
  uncertain: boolean;
  sourceSha256: string;
  sourceBytes: number;
  sourceLines: number;
  evidence: EvidenceItem[];
}

export type ReceiptRejectReason =
  | "schema-mismatch"
  | "unverifiable-quote"
  | "missing-failure-evidence"
  | "non_positive_saving";

const sha256 = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");

// JS 侧正则，\b 为标准语义（AGENTS.md 判卷纪律：门禁判据一律写在 JS 侧）。
const FATAL_RE = /\bfatal\b|\bpanic\b|致命/i;
const FAIL_RE = /\berror\b|\bfailed\b|\bfail\b|\bfailure\b|失败|错误/i;
const WARN_RE = /\bwarn(?:ing)?\b|警告/i;

/** 失败信号：源里存在失败迹象（照 SoL-Pi FAILURE_SIGNAL 语义，中英并收）。 */
export function hasFailureSignal(source: string): boolean {
  return FAIL_RE.test(source) || FATAL_RE.test(source);
}

/** 单行分类：fatal > failure > warning；不命中为 null。 */
function classifyLine(line: string): EvidenceKind | null {
  if (FATAL_RE.test(line)) return "fatal";
  if (FAIL_RE.test(line)) return "failure";
  if (WARN_RE.test(line)) return "warning";
  return null;
}

/**
 * 从诊断原文构建确定性收据。同输入两次调用逐字节相同（无模型、无随机、无时钟）。
 * 无任何可提取条目时返回 null（无可压缩对象，调用方保留原文）。
 */
export function buildReceipt(
  text: string,
  opt: { maxItems?: number; maxQuoteChars?: number } = {},
): EvidenceReceipt | null {
  const maxItems = Math.max(1, Math.min(MAX_EVIDENCE_ITEMS, Math.floor(opt.maxItems ?? MAX_EVIDENCE_ITEMS)));
  const maxQuoteChars = Math.max(1, Math.min(MAX_QUOTE_CHARS, Math.floor(opt.maxQuoteChars ?? MAX_QUOTE_CHARS)));
  if (text.length === 0) return null;
  const lines = text.split("\n");
  const items: EvidenceItem[] = [];
  for (let i = 0; i < lines.length && items.length < maxItems; i++) {
    const kind = classifyLine(lines[i]);
    if (kind === null) continue;
    const quote = lines[i].length > maxQuoteChars ? lines[i].slice(0, maxQuoteChars) : lines[i];
    items.push({ kind, line: i + 1, quote, quoteSha256: sha256(quote) });
  }
  if (items.length === 0) {
    // 无失败/警告条目：仅保留一条 summary 锚（首非空行），保持收据可回溯。
    const first = lines.find((l) => l.trim().length > 0);
    if (first === undefined) return null;
    const quote = first.length > maxQuoteChars ? first.slice(0, maxQuoteChars) : first;
    items.push({ kind: "summary", line: lines.indexOf(first) + 1, quote, quoteSha256: sha256(quote) });
  }
  const failureSignal = hasFailureSignal(text);
  return {
    status: failureSignal ? "failure" : "success",
    uncertain: false,
    sourceSha256: sha256(text),
    sourceBytes: Buffer.byteLength(text, "utf8"),
    sourceLines: lines.length,
    evidence: items,
  };
}

/** 收据序列化：单行（引文取自行内，不含裸换行；JSON 转义兜底）。 */
export function serializeReceipt(r: EvidenceReceipt): string {
  return EVIDENCE_RECEIPT_PREFIX + " " + JSON.stringify(r);
}

/** 识别收据行（整行前缀匹配，非子串）。 */
export function isReceiptLine(line: string): boolean {
  return line.startsWith(EVIDENCE_RECEIPT_PREFIX + " ");
}

/** 解析收据行；非收据行/坏 JSON 返回 null（不猜）。 */
export function parseReceipt(line: string): EvidenceReceipt | null {
  if (!isReceiptLine(line)) return null;
  try {
    return JSON.parse(line.slice(EVIDENCE_RECEIPT_PREFIX.length + 1)) as EvidenceReceipt;
  } catch {
    return null;
  }
}

const KINDS: readonly EvidenceKind[] = ["fatal", "failure", "warning", "target", "summary"];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/**
 * 四态校验（0 容忍）：任一条 quote 不在原文逐字出现 → 整单作废。
 * 源里有失败信号而收据无任何 fatal/failure 条目 → missing-failure-evidence
 * （防「把真失败压成干净摘要」——本机制最有价值的一条纪律）。
 */
export function validateReceipt(r: unknown, source: string): { ok: true } | { ok: false; reason: ReceiptRejectReason } {
  if (!isRecord(r)) return { ok: false, reason: "schema-mismatch" };
  const status = r.status;
  if (status !== "success" && status !== "failure") return { ok: false, reason: "schema-mismatch" };
  if (typeof r.uncertain !== "boolean") return { ok: false, reason: "schema-mismatch" };
  if (typeof r.sourceSha256 !== "string" || typeof r.sourceBytes !== "number" || typeof r.sourceLines !== "number") {
    return { ok: false, reason: "schema-mismatch" };
  }
  if (!Array.isArray(r.evidence)) return { ok: false, reason: "schema-mismatch" };
  if (r.sourceSha256 !== sha256(source)) return { ok: false, reason: "schema-mismatch" };
  if (r.sourceBytes !== Buffer.byteLength(source, "utf8") || r.sourceLines !== source.split("\n").length) {
    return { ok: false, reason: "schema-mismatch" };
  }
  const items = r.evidence as unknown[];
  if (items.length === 0 || items.length > MAX_EVIDENCE_ITEMS) return { ok: false, reason: "schema-mismatch" };
  const lines = source.split("\n");
  let hasFailureItem = false;
  for (const it of items) {
    if (!isRecord(it)) return { ok: false, reason: "schema-mismatch" };
    const kind = it.kind;
    if (typeof kind !== "string" || !KINDS.includes(kind as EvidenceKind)) {
      return { ok: false, reason: "schema-mismatch" };
    }
    if (typeof it.quote !== "string" || it.quote.length === 0 || it.quote.length > MAX_QUOTE_CHARS) {
      return { ok: false, reason: "schema-mismatch" };
    }
    if (typeof it.quoteSha256 !== "string" || it.quoteSha256 !== sha256(it.quote)) {
      return { ok: false, reason: "schema-mismatch" };
    }
    // 逐字命中（0 容忍）：quote 必须是原文子串；给了行号则还须落在该行内。
    if (!source.includes(it.quote)) return { ok: false, reason: "unverifiable-quote" };
    if (it.line !== undefined && typeof it.line !== "number") return { ok: false, reason: "schema-mismatch" };
    if (typeof it.line === "number") {
      if (!Number.isInteger(it.line) || it.line < 1 || it.line > lines.length) {
        return { ok: false, reason: "unverifiable-quote" };
      }
      if (!lines[it.line - 1].includes(it.quote)) return { ok: false, reason: "unverifiable-quote" };
    }
    if ((kind === "fatal" || kind === "failure") && hasFailureSignal(it.quote)) hasFailureItem = true;
  }
  const failureSignal = hasFailureSignal(source);
  if (failureSignal && !hasFailureItem) return { ok: false, reason: "missing-failure-evidence" };
  if ((status === "failure") !== failureSignal) return { ok: false, reason: "missing-failure-evidence" };
  if (Buffer.byteLength(EVIDENCE_RECEIPT_PREFIX + " " + JSON.stringify(r), "utf8") >= Buffer.byteLength(source, "utf8")) {
    return { ok: false, reason: "non_positive_saving" };
  }
  return { ok: true };
}
