// run_shell 超限输出的「头 + 尾环」裁剪（能力 3/5：读日志要看得见结论）。
// 旧实现在攒满 32KB 后**于源头丢弃后续所有 chunk** ⇒ 测试汇总、npm error、stack 末行这些
// 恰好位于尾部的信息一条都进不了模型上下文，只能重跑一次 `... | tail -50`，白花一轮。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { run_shell } from "../src/tools/run_shell";
import { middleTruncationNotice } from "../src/tools/base";
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
    const kept = r.output.length - notice.length - 2; // 两个换行分隔符
    expect(omitted).toBeGreaterThan(1000);
    expect(kept + omitted).toBe(total);
  });

  it("exit code 行不被裁剪挤掉（它在尾部之后，正是模型要看的第二眼信息）", async () => {
    const r = await runCmd(`node -e ${JSON.stringify('process.stdout.write("a".repeat(40000)); process.exit(3)')}`);
    expect(r.ok).toBe(false);
    expect(r.output.endsWith("[exit code: 3]")).toBe(true);
  });
});
