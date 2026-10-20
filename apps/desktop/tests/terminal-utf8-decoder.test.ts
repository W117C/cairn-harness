// 终端输出的 UTF-8 跨块解码（2026-10-19 独立评审追出的真缺陷）。
//
// 缺陷形状：PTY 输出按块到达，旧实现每块各自 `chunk.toString("utf8")` —— 那是一次性解码，
// **跨块边界的多字节字符会被拆坏**：一个汉字的三个字节分两次 pipe 读到达时，
// 第一块解成 U+FFFD、第二块剩下两个续字节也解成 U+FFFD ⇒ 中文与 emoji 在终端窗格里变乱码。
//
// 触发面很宽：中文文件名（`ls` 一个中文目录）、git 中文提交信息、代码里的中文注释——
// 只要那个字符恰好跨了一次读边界。ASCII 标记（既有判卷用的 `CAIRN-TERM-MARKER-42`）照旧完好，
// 所以既有判卷全绿也看不出来。
//
// 判据落在**解码器**上（Utf8ChunkDecoder）：本仓无 jsdom，交互逻辑走「纯函数 + 接线见证」两面。
// 解码器能真跑 ⇒ 这一条不是恒真的源码断言。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Utf8ChunkDecoder } from "../src/main/terminal-host";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

/** 把一段文本按**字节**宽度切块（**故意从字符中间切开**——这才是缺陷的触发条件）。
 *  宽度 1 = 每个字节一块：任何多字节字符都必被拆开。 */
function chop(text: string, width: number): Uint8Array[] {
  const bytes = Buffer.from(text, "utf8");
  const out: Uint8Array[] = [];
  const step = Math.max(1, width);
  for (let i = 0; i < bytes.length; i += step) out.push(bytes.subarray(i, Math.min(i + step, bytes.length)));
  return out;
}

describe("终端 UTF-8 跨块解码（Utf8ChunkDecoder）", () => {
  it("★汉字被切成两块 ⇒ 拼回完整的字（一次性 toString 会得到两个 U+FFFD）", () => {
    const d = new Utf8ChunkDecoder();
    const parts = chop("你好", 1); // 每字节一块：必从字符中间切开
    const out = parts.map((p) => d.write(p)).join("");
    expect(out).toBe("你好");
    expect(out).not.toContain("�"); // 没有替换字符
  });

  it("emoji（四字节，代理对）跨块 ⇒ 拼回完整 emoji", () => {
    const d = new Utf8ChunkDecoder();
    const out = chop("🌍", 1).map((p) => d.write(p)).join("");
    expect(out).toBe("🌍");
  });

  it("多块任意切法都还原同一串文本", () => {
    const text = "中文注释 mixed with ASCII ✅ 和 emoji 🌍";
    for (const width of [1, 2, 3, 5, 7, 11]) {
      const d = new Utf8ChunkDecoder();
      const out = chop(text, width).map((p) => d.write(p)).join("");
      expect(out, `每块 ${String(width)} 字节时还原错了`).toBe(text);
    }
  });

  it("反向对照：一次性 toString 在同一批切法下确实解坏（证明这条判据不是恒真）", () => {
    const parts = chop("你好", 1); // 每字节一块：必从字符中间切开
    const naive = parts.map((p) => Buffer.from(p).toString("utf8")).join("");
    expect(naive).not.toBe("你好");
    expect(naive).toContain("�");
  });

  it("流结束时的残字节不静默丢（截断的字符至少变成一个替换字符）", () => {
    const d = new Utf8ChunkDecoder();
    // "你" 的第一个字节（0xE4）单独喂进去：还没成形
    expect(d.write(Buffer.from([0xe4]))).toBe("");
    expect(d.end()).not.toBe(""); // 残字节被收尾，不是消失
  });

  it("纯 ASCII 路径逐字不变（既有判卷的老行为不许被改）", () => {
    const d = new Utf8ChunkDecoder();
    const out = chop("CAIRN-TERM-MARKER-42", 1).map((p) => d.write(p)).join("");
    expect(out).toBe("CAIRN-TERM-MARKER-42");
  });
});

describe("接线：终端宿主走这一份解码器", () => {
  const src = read("../src/main/terminal-host.ts");

  it("stdout/stderr 各自持一份解码器（两条独立字节流，共用会把两个半字拼成假字符）", () => {
    expect(src).toContain("const outDec = new Utf8ChunkDecoder();");
    expect(src).toContain("const errDec = new Utf8ChunkDecoder();");
    expect(src).toContain("data: outDec.write(chunk)");
    expect(src).toContain("data: errDec.write(chunk)");
  });

  it("旧的一次性 toString 不许回来", () => {
    expect(src).not.toContain('data: chunk.toString("utf8")');
  });
});
