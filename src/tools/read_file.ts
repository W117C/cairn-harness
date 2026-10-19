import { open, readFile, readdir, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { assertRealContainment, resolveInWorkspace, ToolError, type Tool, type ToolContext, type ToolResult } from "./base.js";
import { byteCapNotice, clipLine } from "./cap-notice.js";
import { headWithinBytes, utf8PrefixEnd } from "./output-ring.js";
import { prefetchLsp } from "./lsp.js";

// 输出上限 50KB；行截断 2000 字符（帽与标记见 cap-notice.ts::clipLine）；默认最多 2000 行。
const READ_LIMIT_BYTES = 50 * 1024;
const DEFAULT_MAX_LINES = 2000;
/** 一次多份（`paths`）时的**总额**帽：与单份同一个数。
 *  为什么必须有（第 477 页）：没有它就等于把「N 份各自 50KB」直接倒进上下文——20 份小文件没事，
 *  20 份各 40KB 就是 800KB。账要可算：一次 `read_file` 交付多少有上限，与读几份无关。 */
const BATCH_LIMIT_BYTES = 50 * 1024;
// 整读上限：超过只读前缀。输出本身已限 50KB，但旧实现「先整文件读进内存再截断」，
// 一个 GB 级文件（日志/打包产物/数据库转储）会把 Electron 主进程读爆。
const LARGE_FILE_PREFIX_BYTES = 16 * 1024 * 1024;

/** 只读文件前 bytes 字节（大文件路径用；返回可能被截断的 Buffer）。 */
async function readPrefix(abs: string, bytes: number): Promise<Buffer> {
  const fh = await open(abs, "r");
  try {
    const buf = Buffer.allocUnsafe(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

// 二进制嗅探：出现 NUL 即拒读；不可打印字节（除少数常见空白）占比 >30% 也拒读。
function looksBinary(buf: Buffer): boolean {
  const sample = buf.subarray(0, 8192);
  let nonPrintable = 0;
  for (const b of sample) {
    if (b === 0) return true;
    if (b < 32 && b !== 9 && b !== 10 && b !== 13) nonPrintable++;
  }
  return sample.length > 0 && nonPrintable / sample.length > 0.3;
}

// 未命中时给最多 3 个近名建议：同目录前缀匹配优先，其次同扩展名。
async function nearNameSuggestions(workspace: string, rel: string): Promise<string[]> {
  const dir = dirname(join(workspace, rel));
  const base = basename(rel);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const lower = base.toLowerCase();
  const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".")) : "";
  const scored = entries
    .filter((e) => e !== base)
    .map((e) => {
      const el = e.toLowerCase();
      let score = 0;
      if (lower.length >= 3 && el.startsWith(lower.slice(0, 3))) score += 2;
      if (ext && el.endsWith(ext)) score += 1;
      return { e, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.e.localeCompare(b.e))
    .slice(0, 3)
    .map((x) => x.e);
  const dirRel = dir === workspace ? "" : dir.slice(workspace.length + 1) + "/";
  return scored.map((e) => dirRel + e);
}

/** 读**一份**：单份路径的全部现存语义（目录、二进制、大文件前缀、行/字节帽、offset/limit 提示）
 *  都住在这只函数里。「一次多份」复用它，而不是把同一套帽与提示抄第二遍（规则 122）。
 *  读不到/拒读一律 `ToolError` 抛出——批量那一侧负责决定「一份失败算不算整批失败」。 */
async function readOne(ctx: ToolContext, rel: string, offsetRaw: unknown, limitRaw: unknown): Promise<string> {
  const abs = resolveInWorkspace(ctx.workspace, rel, "read_file");
  await assertRealContainment(ctx.workspace, abs, "read_file");

  // 目录路径：列条目（目录读不了内容，但列条目是有用的输出）。
  const st = await stat(abs).catch(() => null);
  if (st?.isDirectory()) {
    const entries = await readdir(abs);
    const sorted = entries.sort().map((e) => e + "/");
    // 目录同样要受行/字节帽约束：旧实现把整目录条目 join 后直接返回，5 万项直接吃光上下文
    // 且不给 truncated 信号（批量读复用本函数时同样无帽）。
    const shown: string[] = [];
    let used = 0;
    for (const line of sorted) {
      if (shown.length >= DEFAULT_MAX_LINES || used + Buffer.byteLength(line, "utf8") + 1 > READ_LIMIT_BYTES) break;
      shown.push(line);
      used += Buffer.byteLength(line, "utf8") + 1;
    }
    const truncated = shown.length < sorted.length;
    return rel + "/（目录，" + entries.length + " 项）\n" + shown.join("\n")
      + (truncated ? "\n[truncated] 仅列前 " + String(shown.length) + " 项（共 " + String(entries.length) + " 项）" : "");
  }

  // 大文件只读前缀（stat 已在上面取过，零额外系统调用）。
  // 前缀边界可能切断一个多字节 UTF-8 序列，末尾会解码成替换字符——输出已显式声明截断，
  // 不影响语义；这里不做额外修补，避免误改文件本身合法的 U+FFFD。
  const oversized = (st?.size ?? 0) > LARGE_FILE_PREFIX_BYTES;
  let buf: Buffer;
  try {
    buf = oversized ? await readPrefix(abs, LARGE_FILE_PREFIX_BYTES) : await readFile(abs);
  } catch {
    const suggestions = await nearNameSuggestions(ctx.workspace, rel);
    const hint = suggestions.length ? "（近名建议: " + suggestions.join(", ") + "）" : "";
    throw new ToolError("read_file: 文件不存在或不可读: " + rel + hint);
  }
  if (looksBinary(buf)) {
    throw new ToolError("read_file: 疑似二进制文件，拒绝按文本读取: " + rel);
  }
  // #56：oversized 那一刀按**字节数**切，末尾正落在码位中间时 `toString("utf8")` 会解码出一个 U+FFFD，
  // 而这个字符会跟着 offset 一路交给模型（实测：读到前缀末尾那一行时含半个字符）。非 oversized 读到的是
  // 整份文件，边界由文件自己给，不用退。
  const content = oversized ? buf.subarray(0, utf8PrefixEnd(buf)).toString("utf8") : buf.toString("utf8");
  // M2a：read 命中源码 → 后台预热 LSP（尽力而为，零阻塞、零异常冒泡）
  prefetchLsp(ctx.workspace, abs);
  const allLines = content.split("\n");
  // 若因行尾换行 split 出的最后一个空串不算一行
  const hasTrailingNewline = allLines.length > 0 && allLines[allLines.length - 1] === "";
  const lines = hasTrailingNewline ? allLines.slice(0, -1) : allLines;

  const offset = typeof offsetRaw === "number" && Number.isInteger(offsetRaw) && offsetRaw >= 1 ? offsetRaw : 1;
  const maxLines = typeof limitRaw === "number" && Number.isInteger(limitRaw) && limitRaw >= 1 ? limitRaw : DEFAULT_MAX_LINES;
  const selected = lines.slice(offset - 1, offset - 1 + maxLines);
  const truncatedLines = offset - 1 + selected.length < lines.length;

  let out = selected.map((l) => clipLine(l)).join("\n");
  const byteLen = Buffer.byteLength(out, "utf8");
  let byteTruncated = false;
  // 帽之后真正交付了几行必须重算（#57）：旧写法照旧报 `selected.length`，实测 500 行文件按 limit=400 读时
  // 提示写「仅显示 400 行」而真交付只有 205 行 ⇒ 模型按 401 起写下一跳就静默跳过 195 行。
  let shownLines = selected.length;
  let halfLineRemains = false;
  if (byteLen > READ_LIMIT_BYTES) {
    // #54：原先按字节裸切（`Buffer...subarray(0, 50K).toString("utf8")`）会把跨界的汉字切成半个——
    // 实测 400 行纯中文文件：输出尾部留了一个 U+FFFD 进模型。改吃同一份按码位回退的原语。
    out = headWithinBytes(out, READ_LIMIT_BYTES);
    byteTruncated = true;
    const segs = out.split("\n");
    shownLines = segs.length - 1; // 完整交付的行数
    halfLineRemains = (segs[segs.length - 1] ?? "").length > 0; // 末尾是一段残行
  }
  const notices: string[] = [];
  if (oversized) {
    notices.push("[truncated: 文件超过 " + String(LARGE_FILE_PREFIX_BYTES / (1024 * 1024)) + " MB，仅读取前 " + String(LARGE_FILE_PREFIX_BYTES / (1024 * 1024)) + " MB 参与解析；建议用 grep 定位后再按 offset 读]");
  }
  // 字节帽生效时行数的口径要跟着改：说"仅显示 400 行"而真交付 205 行，等于教模型跳读漏内容（#57）。
  if (byteTruncated) {
    const omitted = byteLen - Buffer.byteLength(out, "utf8");
    notices.push(byteCapNotice(50, omitted, "接着读用 offset=" + String(offset + shownLines) + (halfLineRemains ? "（该行只读到一半，重读它才完整）" : "")));
    if (truncatedLines) {
      notices.push("[truncated: 从第 " + String(offset) + " 行起共 " + String(lines.length) + " 行，本次完整交付 " + String(shownLines) + " 行，剩下的既没显示也没丢在盘外——按上面的 offset 继续读]");
    }
  } else if (truncatedLines) {
    notices.push("[truncated: 从第 " + offset + " 行起共 " + lines.length + " 行，仅显示 " + selected.length + " 行；可用 offset/limit 继续读]");
  }
  if (offset > 1 && !truncatedLines && !byteTruncated) notices.push("[offset: 从第 " + offset + " 行起读，文件共 " + lines.length + " 行]");
  if (notices.length) out += "\n" + notices.join("\n");
  return out;
}

/** 「一次多份」（第 477 页）。动因是一条真读数：`B12-long-horizon` 那趟 40 步里 41 次单份 `read_file`，
 *  请求 3–32 全是"一轮一支"——模型**会**并行（同一轮里发过 10 支），缺的是"一次调用读多份"的原语，
 *  于是步数预算全花在读上（读文件 30 步、改文件只剩 7 步）。四条设计决定：
 *  ① **整份才交**：塞不下总额帽的那一份**整份不交**并在末尾点名——交半份会让人以为读全了；
 *     真要半份走单份那条路（它有 offset 与逐行提示）。
 *  ② 一份读不到**不拖红整批**：批里 20 份，第 7 份路径拼错不该让前 6 份进不了上下文；
 *     失败的在原地出声（`[读取失败] …`），全失败才算这次调用失败（工具失败面照旧真实）。
 *  ③ 总额帽与单份同一个数（50KB）：一次调用交付多少与读几份无关，账才可算。
 *  ④ 与单份**互斥**：`path` 与 `paths` 同时给就拒绝——两条路读出来的东西不一样，混成一份就分不出来源。 */
async function readBatch(ctx: ToolContext, paths: readonly string[], offsetRaw: unknown, limitRaw: unknown): Promise<ToolResult> {
  const blocks: string[] = [];
  const notShown: string[] = [];
  let delivered = 0;
  let used = 0;
  for (const rel of paths) {
    let text: string;
    let ok = true;
    try {
      text = await readOne(ctx, rel, offsetRaw, limitRaw);
    } catch (e) {
      text = "[读取失败] " + (e instanceof Error ? e.message : String(e));
      ok = false;
    }
    const block = "--- " + rel + " ---\n" + text;
    const bytes = Buffer.byteLength(block, "utf8") + (blocks.length > 0 ? 1 : 0);
    if (used + bytes > BATCH_LIMIT_BYTES) {
      notShown.push(rel);
      continue;
    }
    blocks.push(block);
    used += bytes;
    if (ok) delivered += 1;
  }
  let out = blocks.join("\n");
  if (notShown.length > 0) {
    out += (out === "" ? "" : "\n") + "[总额帽 " + String(BATCH_LIMIT_BYTES / 1024) + "KB 用尽：" +
      String(notShown.length) + " 份**本次没有交付**（不是「文件不存在」）——单独 read_file 它们，或先 grep 定位：" +
      notShown.join("、") + "]";
  }
  return { ok: delivered > 0, output: out };
}

export const read_file: Tool = {
  name: "read_file",
  async run(args, ctx): Promise<ToolResult> {
    const paths = Array.isArray(args.paths)
      ? args.paths.filter((p): p is string => typeof p === "string" && p.trim() !== "")
      : [];
    if (paths.length > 0) {
      if (typeof args.path === "string" && args.path.trim() !== "") {
        throw new ToolError("read_file: path 与 paths 只给一个（一次要读多份就给 paths 数组，别再给 path）");
      }
      return readBatch(ctx, paths, args.offset, args.limit);
    }
    const rel = typeof args.path === "string" ? args.path : "";
    return { ok: true, output: await readOne(ctx, rel, args.offset, args.limit) };
  },
};
