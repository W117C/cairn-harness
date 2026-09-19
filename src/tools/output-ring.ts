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
 *  既有 UTF-8 字节判据实测红过一次）。 */
const NOTICE_RESERVE_BYTES = 256;
/** 超限后的头尾分配：头部多留一点（进程刚起的报错、命令行回显在前段），总预算一字不加。 */
const HEAD_RATIO = 0.55;

export function createOutputRing(limitBytes: number): OutputRing {
  const keepBytes = limitBytes - NOTICE_RESERVE_BYTES;
  const headBytes = Math.floor(keepBytes * HEAD_RATIO);
  const tailBytes = keepBytes - headBytes;
  let out = "";
  let head = "";
  let tail = "";
  let overflowing = false;
  let seen = 0;
  const push = (chunk: Buffer | string): void => {
    const s = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    seen += s.length;
    if (!overflowing) {
      out += s;
      if (out.length > limitBytes) {
        overflowing = true;
        head = out.slice(0, headBytes);
        // 溢出发生在**当前这一次** push 内部时（子进程一次性吐完 60KB 很常见），超出头部的
        // remainder 必须进尾环——直接丢弃会让"保留了结尾"变成一句假话（实测：单次大块写入时尾部为空）。
        tail = out.slice(headBytes);
        if (tail.length > tailBytes) tail = tail.slice(tail.length - tailBytes);
        out = ""; // 中间段不留（内存帽与旧实现同级：≤上限 + 一个尾环）
      }
      return;
    }
    tail += s;
    if (tail.length > tailBytes) tail = tail.slice(tail.length - tailBytes);
  };
  const read = (): string => overflowing
    ? head + "\n" + middleTruncationNotice(seen - headBytes - tail.length) + "\n" + tail
    : out;
  return { push, read };
}
