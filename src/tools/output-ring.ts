import { StringDecoder } from "node:string_decoder";
import { middleTruncationNotice } from "./base.js";

/** 子进程输出的「头 + 尾环」收集器。run_shell 与 verify 共用同一份，不是巧合而是同一条理由：
 *  「哪条测试失败 / npm error / stack 末行」这些结论都在**尾部**，只留头部等于把结论丢在源头，
 *  模型只能重跑一次 `... | tail -50` 才看得见（白花一轮）。两处各写一份时，修好一处另一处
 *  仍是旧的——verify 就是那条旧路径，验证门的失败摘要正是最需要尾部的地方。 */
export interface OutputRing {
  push(chunk: Buffer | string): void;
  /** 未溢出 ⇒ 逐字全文（既有输出字节不变）；溢出 ⇒ 头部 + 省略提示 + 尾部。 */
  read(): string;
}

/** 提示行自己也算输出：不给它留位就会把「输出 ≤ 上限」这句承诺撑破（中文提示一行就 ~150B，
 *  既有 UTF-8 字节判据实测红过一次）。溢出时交出去的是**两行**提示（省略量 + 下一步），
 *  所以留位按两行的和算——判据在 `tests/shell-tail.test.ts` 的预算那条。 */
const NOTICE_RESERVE_BYTES = 512;
/** 头尾环的分配：头部多留一点（进程刚起的报错、命令行回显在前段），总预算一字不加。 */
const HEAD_RATIO = 0.55;

/** 溢出提示的缺省值是 shell 那一句，因为它服务的是 shell 的三个消费者。
 *  **做成可注入**而不是让网页面自己抄一份环：`web_fetch` 交付的不是"一条 shell 命令的 stdout"，
 *  让它带 `grep -n`/`tail -n 50` 是对模型说胡话；而复制一份头尾环就是 output-ring.ts 头注释
 *  警告的那个形状（两处各写一份，修好一处另一处仍是旧的）。缺省值逐字不变 ⇒ 既有三面零回归。 */
export const WEB_CONTENT_TRUNCATION_HINT =
  "[下一步：这是页面正文，不是整站。要找特定段落就换一个更精确的 URL（锚点/目录页/API 文档页）；" +
  "本工具不会替你翻页，也没有站内搜索——查不到就换源。]";

/**
 * 溢出时必须跟着的那句下一步。住在环里而不是各面抄一份：三个消费者（`run_shell`、`verify`、
 * 沙箱那条出口）交付的是同一个形状——"一条 shell 命令的 stdout"，所以同一句下一步对三面都成立。
 * 判据不是措辞而是真做过一遍（`tests/shell-tail.test.ts`：按这句加筛重跑，中间那段进得来且不溢出）。
 * 里面不许出现工作区外的绝对路径——`read_file` 只收工作区相对路径（#33 同一族，反向哨兵同文件）。
 */
export const MIDDLE_TRUNCATION_HINT =
  "[下一步：原样重跑同一条命令只会再超一次。重跑时先筛小——管道接 `grep -n 关键词`、按行号取中段 `sed -n '200,400p'`、" +
  "或只看结论 `tail -n 50`；要留整段就 `> out.log 2>&1` 落进工作区，再用 grep 或 read_file 读 out.log]";

/** 一个码位占几个 UTF-8 字节（1/2/3/4）。 */
const utf8Bytes = (cp: number): number => (cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4);
const bytesOf = (s: string): number => Buffer.byteLength(s, "utf8");

/** 子进程输出的**逐块** UTF-8 累加器（不进环的面用它，如 `git` 包装、hook）。
 *  为什么不许 `out += d.toString("utf8")`：每个 chunk 独立解码 ⇒ 跨块的那个多字节字符两边各变成一个
 *  U+FFFD。实测：`worktreeDiff` 的一份 1.29MB 中文 git diff 有 32 处问号，同一条命令一次解码到底 0 处
 *  ——被改写的正是模型要读的补丁正文（`run_shell`/`verify` 走 `createOutputRing`，同一把解码器在它里面）。 */
export interface ChunkText {
  push(d: Buffer): void;
  text(): string;
}
export function createChunkText(): ChunkText {
  const dec = new StringDecoder("utf8");
  let out = "";
  return {
    push: (d: Buffer): void => { out += dec.write(d); },
    text: (): string => out,
  };
}

/** 不越过 max 字节的**最长前缀**；按码位走，所以缝合处永远是一个完整字符。
 *  导出的理由：这条规则不属于"头尾环"这一支——任何"按字节设帽"的面都要吃它，
 *  各写一份时就会有面把半个多字节字符交出去（`read_file` 的 50KB 帽实测留了一个 U+FFFD）。 */
export function headWithinBytes(s: string, max: number): string {
  let used = 0;
  let cut = 0;
  for (const ch of s) {
    const b = utf8Bytes(ch.codePointAt(0) ?? 0);
    if (used + b > max) break;
    used += b;
    cut += ch.length;
  }
  return s.slice(0, cut);
}

/** 给定一段**按字节切过**的 UTF-8，返回不越过码位边界的最长前缀长度（#56）。
 *  用途与 `headWithinBytes` 不同支：那一支切的是字符串，这一支的输入已经是字节缓冲——
 *  `read_file` 的 16MB 前缀、`ledger` 的预览帽都在这一支上。
 *  末尾那段延续字节属于**同一个**字符：整串凑得齐就全留，凑不齐就把那个字符整个退掉
 *  （不是退掉延续字节为止——那样会把完整字符也削掉一半长度）。 */
export function utf8PrefixEnd(buf: Buffer): number {
  let j = buf.length;
  while (j > 0 && (buf[j - 1]! & 0xc0) === 0x80) j--; // 回退过末尾这段延续字节
  if (j === 0) return 0; // 整段都是延续字节（畸形输入）⇒ 一个完整字符都交不出
  const lead = buf[j - 1]!;
  const need = (lead & 0xe0) === 0xc0 ? 2 : (lead & 0xf0) === 0xe0 ? 3 : (lead & 0xf8) === 0xf0 ? 4 : 1;
  return buf.length - (j - 1) >= need ? buf.length : j - 1;
}

/** 不越过 max 字节的**最长后缀**；同样按码位回退（代理对成对退，不许留半个）。 */
function tailWithin(s: string, max: number): string {
  const cps = Array.from(s);
  let used = 0;
  let k = cps.length;
  while (k > 0) {
    const b = utf8Bytes(cps[k - 1]?.codePointAt(0) ?? 0);
    if (used + b > max) break;
    used += b;
    k--;
  }
  return cps.slice(k).join("");
}

/** 头尾环的帽一律按 **UTF-8 字节** 计：参数名就叫 `limitBytes`，而实现曾按 UTF-16 字符数执行，
 *  于是同一参数下中文产出实测撑破 2.9×、提示里的省略量少报 3.0×（ASCII 路径两者同值，
 *  所以这条错在只喂英文的测试里恒绿——`tests/output-ring.test.ts` ⑥ 就是那把尺）。
 *  按字节切会带来新风险：缝合处可能把多字节字符切成半个 ⇒ `headWithinBytes`/`tailWithin` 按码位走。 */
export function createOutputRing(limitBytes: number, hint: string = MIDDLE_TRUNCATION_HINT): OutputRing {
  const keepBytes = limitBytes - NOTICE_RESERVE_BYTES;
  const headBudget = Math.floor(keepBytes * HEAD_RATIO);
  const tailBudget = keepBytes - headBudget;
  let out = "";
  let outBytes = 0;
  let head = "";
  let tail = "";
  let overflowing = false;
  let seen = 0;
  const dec = new StringDecoder("utf8"); // 逐块独立解码会把跨块的多字节字符变成 U+FFFD（同 `createChunkText` 的理由）
  const push = (chunk: Buffer | string): void => {
    const s = typeof chunk === "string" ? chunk : dec.write(chunk);
    const n = bytesOf(s);
    seen += n;
    if (!overflowing) {
      out += s;
      outBytes += n;
      if (outBytes > limitBytes) {
        overflowing = true;
        head = headWithinBytes(out, headBudget);
        // 溢出发生在**当前这一次** push 内部时（子进程一次性吐完 60KB 很常见），超出头部的
        // remainder 必须进尾环——直接丢弃会让"保留了结尾"变成一句假话（实测：单次大块写入时尾部为空）。
        tail = tailWithin(out.slice(head.length), tailBudget);
        out = ""; // 中间段不留（内存帽与旧实现同级：≤上限 + 一个尾环）
      }
      return;
    }
    tail = tailWithin(tail + s, tailBudget);
  };
  const read = (): string => overflowing
    ? head + "\n" + middleTruncationNotice(seen - bytesOf(head) - bytesOf(tail)) + "\n" + hint + "\n" + tail
    : out;
  return { push, read };
}
