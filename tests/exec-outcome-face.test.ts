/* 跑进程类工具的结局要**结构地**活到事件流（#24 的现读修正：不是"新造第二份谓词"，是把已有的结构接上落盘面）。
   现读到的形状：`ToolResult` 早就带着 `exitCode`/`timedOut`（`src/tools/base.ts`，注释里还写着"结构化信号在 settle 时被丢掉"），
   但 `src/agent/loop.ts` 落 `tool_result` 时只抄 `ok`/`output`/`gate`/`auto`/`snapshotId`/`change` ⇒
   事件面上「工具链没装（127）」「被墙钟杀掉」「模型代码真错了」三件事**长得一模一样**，
   下游（verify 额度、按档升级、沉淀、失败轨迹评估）只能回去匹配 `[exit code: 127]` 那句文案——
   而文案面已被证明不可当判据（judgment-layer §9.1、规则 264）。
   判卷按「生产端／落盘端／缺席态」三格各钉一条，缺席态那条是负控：防这两格变成恒真。 */
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runLoop } from "../src/agent/loop";
import { annotateExecCause } from "../src/agent/verify";
import type { AgentEvent, ToolResultEvent } from "../src/events";
import type { ModelOutput } from "../src/providers";
import { read_file } from "../src/tools/read_file";
import { run_shell } from "../src/tools/run_shell";
import type { Tool, ToolResult } from "../src/tools/base";

const ctx = (workspace: string) => ({ workspace, callId: "c1" });

async function wsTmp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "exec-face-"));
  return await realpath(dir); // macOS 的 /tmp 实为 /private/tmp
}

/** 假 provider：先说一句、再发一次 tool_call，然后断流。 */
function shellProvider(args: Record<string, unknown>): { next: () => Promise<ModelOutput | null> } {
  const queue: ModelOutput[] = [
    { type: "assistant_message", content: "跑一下" },
    { type: "tool_call", id: "c1", name: "run_shell", args },
  ];
  return { async next() { return queue.shift() ?? null; } };
}

async function lastToolResult(name: string, tool: Tool, args: Record<string, unknown>): Promise<AgentEvent[]> {
  const log: AgentEvent[] = [];
  await runLoop({
    provider: shellProvider(args) as never,
    events: { async append(e: AgentEvent) { log.push(e); } } as never,
    workspace: await wsTmp(),
    userMessage: "跑一下",
    mode: "auto",
    maxSteps: 3,
    tools: { [name]: tool },
  });
  return log;
}

const resultOf = (log: AgentEvent[]): ToolResultEvent =>
  log.filter((e) => e.type === "tool_result").at(-1) as ToolResultEvent;

describe("exec 结局的结构面：exitCode / timedOut 要活到落盘面", () => {
  it("生产端·失败支：真 spawn `exit 3` ⇒ 结构里有 3，不只正文那句", async () => {
    const r = await run_shell.run({ command: "exit 3" }, ctx(await wsTmp()));
    expect(r.ok).toBe(false);
    expect(r.exitCode, "退出码必须结构地在（下游不该回去匹配文案）").toBe(3);
    expect(r.timedOut).toBe(false);
  });

  it("生产端·127 那类环境红：退出码是字段而不是句子", async () => {
    const r = await run_shell.run({ command: "dsh-no-such-binary-91348" }, ctx(await wsTmp()));
    expect(r.ok).toBe(false);
    expect(r.exitCode, "『命令不在 PATH 里』这一类必须能被结构识别").toBe(127);
    expect(r.output).toContain("[exit code: 127]"); // 正文那句照旧在（新字段是补的，不是换掉的）
  });

  it("生产端·成功支也带 0 ⇒ 「没有这一位」只剩「不是跑进程的工具」一种解释", async () => {
    const r = await run_shell.run({ command: "exit 0" }, ctx(await wsTmp()));
    expect(r.ok).toBe(true);
    expect(r.exitCode, "成功不等于缺席：0 要写出来，否则与「没跑进程」同形").toBe(0);
    expect(r.timedOut).toBe(false);
  });

  it("生产端·spawn 失败（命令根本没跑成）⇒ 结构面也在，不只剩一句文案", async () => {
    // cwd 不存在 ⇒ spawn 直接 ENOENT：没有进程、因此**没有退出码**（null，而不是 undefined）。
    // 这一条曾经是**唯一一条结构面缺席的失败支**：结果只有 `{ ok:false, output:"run_shell: …" }`，
    // 下游只能回去匹配那句文案——正是本仓判为不可当判据的形状。
    const r = await run_shell.run({ command: "echo hi" }, ctx("/nonexistent-dir-for-exec-face-91348"));
    expect(r.ok).toBe(false);
    expect(r.exitCode, "「没有跑成」与「没这一位」是两件事：前者是 null，后者是 undefined").toBeNull();
    expect(r.timedOut, "这一支不是超时").toBe(false);
    expect(r.output, "归因走同一条谓词（not-run），文案也在").toContain("[exec:");
  });

  it("共用出口 `annotateExecCause` 四条出口都盖：成功回执也带着这两个字段（幂等，不叠第二层）", () => {
    const ok = annotateExecCause({ ok: true, output: "done" }, { timedOut: false, exitCode: 0 });
    expect(ok.exitCode).toBe(0);
    expect(ok.timedOut).toBe(false);
    const twice = annotateExecCause(ok, { timedOut: false, exitCode: 0 });
    expect(twice).toEqual(ok); // 两层出口叠上去，结构面与正文都不许多出一份
  });

  it("落盘端：真穿过 loop 落进事件流；读文件那一类**不带**（负控防恒真）", async () => {
    const fail = resultOf(await lastToolResult("run_shell", run_shell, { command: "exit 7" }));
    expect(fail?.type, "工具执行过 ⇒ 必有 tool_result").toBe("tool_result");
    expect(fail.ok).toBe(false);
    expect(fail.exitCode, "loop 必须把结构面抄进事件，否则前面四条都只是内存里的字段").toBe(7);
    expect(fail.timedOut).toBe(false);

    const quiet = resultOf(await lastToolResult("read_file", read_file, { path: "missing-for-this-test.ts" }));
    expect(quiet?.type).toBe("tool_result");
    expect(quiet.exitCode, "不跑进程的工具没有退出码——这一位缺席是**有定义的**，不是 0").toBeUndefined();
    expect(quiet.timedOut).toBeUndefined();
  });
});

/** 类型占位：确保 `ToolResult` 上新增的两位在工具面可见（编译器负责，运行时无用）。 */
export type _ToolResultHasOutcome = Pick<Required<ToolResult>, "exitCode" | "timedOut">;
