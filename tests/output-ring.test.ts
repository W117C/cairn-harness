// 头尾环（run_shell 与 verify 共用）的分辨力验收：
// ① 未溢出零回归；② 溢出时头尾都在；③ 省略数不撒谎；④ 单块溢出也喂环；⑤ 总输出有界；
// ⑥ 上面五条全用 ASCII 写 ⇒ 一条都量不出「叫 BYTES 的帽按 UTF-16 字符数执行」——
//    ⑥ 就是那一条：中文 3 字节/字、emoji 4 字节/码位，帽与省略数都必须按**字节**成立，
//    且按字节切的两处缝合不许把多字节字符切成半个（U+FFFD）。
import { describe, expect, it } from "vitest";
import { createOutputRing, MIDDLE_TRUNCATION_HINT } from "../src/tools/output-ring";

const LIMIT = 4096;
// 预留位 512：溢出时交出去的是**两行**提示（省略量 144B + 下一步 278B + 三个换行 = 425B）。
// 头 1971 + 尾 1613（(LIMIT - 512) × 0.55 取整）——两条锚点盯着这两个分配数与预留位。
const HEAD = 1971;
const TAIL = 1613;
/** 长度恰为 n 的块：两头都是 tag，中间填 '.'——断言「头部来自第一块、尾部来自最后一块」才不含糊。 */
const block = (n: number, tag: string): string => tag + ".".repeat(n - tag.length * 2) + tag;
const omittedOf = (text: string): number => {
  const m = /省略中间 (\d+) 字节/u.exec(text);
  return m === null ? -1 : Number(m[1]);
};
/** 从渲染结果里把提示行剥出来，好算「真正留下的字节数」。载荷里没有换行，所以按行认是可靠的。 */
const noticeOf = (text: string): string => /\[truncated:[^\n]*\]/u.exec(text)?.[0] ?? "";
/** 溢出时交付的两行提示整体（省略量 + 下一步）：所有「剥掉提示再算载荷」的断言都走这一支，别各写一份。 */
const noticeBlock = (text: string): string => "\n" + noticeOf(text) + "\n" + MIDDLE_TRUNCATION_HINT + "\n";

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

  // ---- ⑥：帽与省略数按**字节**成立（上面五条全 ASCII ⇒ 对单位混用一条都无分辨力） ----

  /** n 个 CJK 汉字 = 3n 字节；两端各放一个 ASCII tag 好认头尾。 */
  const cjk = (n: number, tag: string): string => tag + "字".repeat(n - tag.length * 2) + tag;

  it("中文输出守字节帽：UTF-16 字符数当字节数用时，同一参数实测撑破 2.9×", () => {
    const ring = createOutputRing(LIMIT);
    for (let i = 0; i < 3; i++) ring.push(cjk(2000, "h" + String(i)));
    const out = ring.read();
    expect(out).toContain("省略中间");
    expect(Buffer.byteLength(out, "utf8"), `实测 ${String(Buffer.byteLength(out, "utf8"))}B > ${String(LIMIT)}B`).toBeLessThanOrEqual(LIMIT);
    expect(out.slice(0, 8)).toBe(cjk(2000, "h0").slice(0, 8)); // 头部仍是第一块开头
    expect(out.endsWith("h2")).toBe(true);                     // 尾部仍是最后一块结尾
  });

  it("省略数报的是真实省略字节，不是字符数（中文下两者差 3 倍）", () => {
    const ring = createOutputRing(LIMIT);
    const fed = ["i0", "i1", "i2"].map((t) => cjk(2000, t));
    for (const f of fed) ring.push(f);
    const out = ring.read();
    const notice = noticeOf(out);
    expect(notice).not.toBe("");
    const keptBytes = Buffer.byteLength(out, "utf8") - Buffer.byteLength(noticeBlock(out), "utf8");
    const fedBytes = fed.reduce((a, s) => a + Buffer.byteLength(s, "utf8"), 0);
    expect(omittedOf(out)).toBe(fedBytes - keptBytes);
  });

  it("按字节切的缝合不切断多字节字符（头尾两端都不许出现 U+FFFD）", () => {
    const ring = createOutputRing(LIMIT);
    for (let i = 0; i < 4; i++) ring.push(cjk(1500, "j" + String(i)));
    const out = ring.read();
    expect(out).not.toContain("\uFFFD");
    // 剥掉提示行后，剩下的必须全是喂进去的那些字符——出现别的字符就是切坏了一个码位
    expect(out.replace(noticeBlock(out), "")).toMatch(/^[字hij0-9.]*$/u);
  });

  it("emoji（代理对，4 字节/码位）同样守帽、同样不切半", () => {
    const ring = createOutputRing(LIMIT);
    const chunk = "🚀".repeat(1500); // 6000 字节 / 3000 个 UTF-16 单元
    for (let i = 0; i < 3; i++) ring.push(chunk);
    const out = ring.read();
    expect(Buffer.byteLength(out, "utf8")).toBeLessThanOrEqual(LIMIT);
    expect(out).not.toContain("\uFFFD");
    // 剥掉提示行后只剩整枚 emoji：半个代理对都会让这条正则不匹配
    expect(out.replace(noticeBlock(out), "")).toMatch(/^(?:\u{1F680})*$/u);
  });

  it("ASCII 路径逐字不变（这次修的单位不许动既有消费者的字节）", () => {
    const ring = createOutputRing(LIMIT);
    for (let i = 0; i < 3; i++) ring.push(block(2000, "k" + String(i)));
    const out = ring.read();
    // 头部必须逐字等于喂入序列的前 HEAD 字节（旧写法按「跨到第二块」拼期望，那只是当时
    // 预留位 256 让 HEAD=2112 > 2000 的巧合；预留位升到 512 后 HEAD 落回第一块内，
    // 断言改成与块边界无关的同一件事：前 HEAD 字节逐字不变）。
    const fed = [0, 1, 2].map((i) => block(2000, "k" + String(i)));
    expect(out.slice(0, HEAD)).toBe(fed.join("").slice(0, HEAD));
    expect(omittedOf(out)).toBe(6000 - HEAD - TAIL);
    expect(out.length).toBeLessThanOrEqual(LIMIT);
  });
});
