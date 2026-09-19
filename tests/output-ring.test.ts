// 头尾环（run_shell 与 verify 共用）的分辨力验收：
// ① 未溢出零回归；② 溢出时头尾都在；③ 省略数不撒谎；④ 单块溢出也喂环；⑤ 总输出有界。
import { describe, expect, it } from "vitest";
import { createOutputRing } from "../src/tools/output-ring";

const LIMIT = 4096;
// 头 2112 + 尾 1728（(LIMIT - 256) × 0.55 取整）——两条锚点盯着这两个分配数与预留位。
const HEAD = 2112;
const TAIL = 1728;
/** 长度恰为 n 的块：两头都是 tag，中间填 '.'——断言「头部来自第一块、尾部来自最后一块」才不含糊。 */
const block = (n: number, tag: string): string => tag + ".".repeat(n - tag.length * 2) + tag;
const omittedOf = (text: string): number => {
  const m = /省略中间 (\d+) 字节/u.exec(text);
  return m === null ? -1 : Number(m[1]);
};

describe("createOutputRing（超限留头也留尾）", () => {
  it("未溢出：逐字全文，一行提示都不加（零回归面）", () => {
    const ring = createOutputRing(LIMIT);
    ring.push(block(1000, "aa"));
    ring.push(block(1000, "bb"));
    expect(ring.read()).toBe(block(1000, "aa") + block(1000, "bb"));
  });

  it("溢出：头部与结尾都在（模型不必再跑一次 tail 才看见结论）", () => {
    const ring = createOutputRing(LIMIT);
    for (let i = 0; i < 3; i++) ring.push(block(2000, "c" + String(i)));
    const out = ring.read();
    expect(out).toContain("省略中间");
    expect(out.slice(0, 20)).toBe(block(2000, "c0").slice(0, 20)); // 头部留住最前
    expect(out.endsWith("c2")).toBe(true);                          // 尾环收的是**最后**写入
  });

  it("省略数不撒谎：省略 + 头 + 尾 == 实际喂入总量，且随后续写入增长", () => {
    const ring = createOutputRing(LIMIT);
    for (let i = 0; i < 3; i++) ring.push(block(2000, "d" + String(i)));
    const omitted = omittedOf(ring.read());
    expect(omitted).toBe(6000 - HEAD - TAIL); // 正是要保留的段之外那一段，不多报也不少报
    ring.push(block(1000, "ee"));
    expect(omittedOf(ring.read())).toBe(omitted + 1000);
  });

  it("单次大块喂入也留住尾环（子进程一次吐完 60KB 是常态，旧实现把尾部整段丢在源头）", () => {
    const ring = createOutputRing(LIMIT);
    ring.push(block(6000, "ff"));
    const out = ring.read();
    expect(out).toContain("省略中间");
    expect(out.slice(0, 20)).toBe(block(6000, "ff").slice(0, 20));
    expect(out.endsWith("ff")).toBe(true);
  });

  it("总输出含提示行也不超上限（提示自己占位，否则「≤ 32KB」这句承诺被提示撑破）", () => {
    const ring = createOutputRing(LIMIT);
    for (let i = 0; i < 20; i++) ring.push(block(1000, "g" + String(i)));
    const out = ring.read();
    expect(out.length).toBeLessThanOrEqual(LIMIT);
    expect(Buffer.byteLength(out, "utf8")).toBeLessThanOrEqual(LIMIT);
  });
});
