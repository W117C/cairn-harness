// run_shell 超限输出的「头 + 尾环」裁剪（能力 3/5：读日志要看得见结论）。
// 旧实现在攒满 32KB 后**于源头丢弃后续所有 chunk** ⇒ 测试汇总、npm error、stack 末行这些
// 恰好位于尾部的信息一条都进不了模型上下文，只能重跑一次 `... | tail -50`，白花一轮。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { run_shell } from "../src/tools/run_shell";
import { middleTruncationNotice } from "../src/tools/base";
import { MIDDLE_TRUNCATION_HINT } from "../src/tools/output-ring";
import type { ToolContext } from "../src/tools/base";

const LIMIT = 32 * 1024;
let dir: string;
const ctx = (): ToolContext => ({ workspace: dir, emit: async () => {} });
const runCmd = async (command: string) => run_shell.run({ command }, ctx());
// 用固定字节数的三段式输出：头部标记 + 中间填充 + 尾部标记（尾部是旧实现看不到的那一段）
const script = (head: string, middle: number, tail: string): string =>
  `node -e ${JSON.stringify(`process.stdout.write(${JSON.stringify(head)} + "M".repeat(${String(middle)}) + ${JSON.stringify(tail)})`)}`;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "shell-tail-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true }).catch(() => {});
});

describe("run_shell 超限输出保留尾部结论", () => {
  it("未超上限时输出逐字不变（不加任何截断标记）", async () => {
    const body = "x".repeat(5000);
    const r = await runCmd(`node -e ${JSON.stringify(`process.stdout.write("${body}")`)}`);
    expect(r.ok).toBe(true);
    expect(r.output).toBe(body);
    expect(r.output).not.toContain("[truncated");
  });

  it("超上限时头部与**结尾**都在（旧实现于源头丢掉了 32KB 之后的一切）", async () => {
    const r = await runCmd(script("HEADZ_", 60_000, "_TAILZ"));
    expect(r.output).toContain("HEADZ_");
    expect(r.output).toContain("_TAILZ");
    expect(r.output).toContain("省略中间");
    // 预算不膨胀：仍是 32KB 量级 + 一行提示
    expect(r.output.length).toBeLessThan(LIMIT + 200);
  });

  it("省略字节数如实报出：省略量 + 保留量 = 实际总输出", async () => {
    const total = 6 + 50_000 + 6;
    const r = await runCmd(script("HEADZ_", 50_000, "_TAILZ"));
    const m = r.output.match(/省略中间 (\d+) 字节/);
    expect(m, "提示里要有省略字节数：" + r.output.slice(0, 80)).not.toBeNull();
    const omitted = Number(m![1]);
    const notice = middleTruncationNotice(omitted);
    // 溢出时交出去的是两行提示（省略量 + 下一步）加三个换行分隔符——都算"提示自己占的位"。
    const kept = r.output.length - notice.length - MIDDLE_TRUNCATION_HINT.length - 3;
    expect(omitted).toBeGreaterThan(1000);
    expect(kept + omitted).toBe(total);
  });

  it("exit code 行不被裁剪挤掉（它在尾部之后，正是模型要看的第二眼信息）", async () => {
    const r = await runCmd(`node -e ${JSON.stringify('process.stdout.write("a".repeat(40000)); process.exit(3)')}`);
    expect(r.ok).toBe(false);
    expect(r.output.endsWith("[exit code: 3]")).toBe(true);
  });
});

// #56 的下游一格（第 74 页那条「半句话」判据的**消费者形状**）：超限提示说了"省略中间 N 字节"，
// 却没说下一步做什么——模型看到的是一句**半句话**，最常见的后果是原样重跑同一条命令（它还会超），
// 白花一轮 + 再交 32KB。⇒ 这一格钉："提示必须给一个在这条命令形状上真做得到的动作"，
// 并且那个动作要**当场验一次**（第 63–65 页的规矩：承诺＝做得到的动作，不是措辞）。
describe("超限提示带的下一步（shell 形状）", () => {
  const overflow = (): string => script("HEADZ_", 60_000, "_TAILZ");

  it("溢出时必须给出下一步，且不许把工作区外的绝对路径当出路", async () => {
    const r = await runCmd(overflow());
    expect(r.output).toContain("省略中间"); // 前提：真的溢出了
    expect(/下一步/u.test(r.output), "只说少了多少、不说怎么办＝半句话：" + r.output.slice(0, 120)).toBe(true);
    // 反向一侧：`read_file` 只收工作区相对路径 ⇒ 提示里出现 /tmp 这类区外绝对路径就是一句假承诺（#33 同一族）
    expect(/\/tmp|\/var\/folders/u.test(r.output), "提示递了模型用不了的区外路径").toBe(false);
  });

  it("给的下一步真做得到：同一条命令按提示加筛后，中间那段进得来且不溢出", async () => {
    // 提示教的是"重跑时先筛小"。这里用真实形状证一次：20000 行里只有第 12345 行是目标，
    // 全量吐 ⇒ 溢出；按提示加 `grep` 精确筛 ⇒ 不溢出且拿得到那一行。
    const many = `node -e ${JSON.stringify('for (let i = 1; i <= 20000; i++) console.log("line-" + String(i));')}`;
    const wide = await runCmd(many);
    expect(wide.output).toContain("省略中间");
    const narrowed = await runCmd(many + " | grep -n line-12345");
    expect(narrowed.ok).toBe(true);
    expect(narrowed.output).toContain("line-12345");
    expect(narrowed.output).not.toContain("省略中间"); // 这条路真的走得通，不是一句安慰
  });
});
