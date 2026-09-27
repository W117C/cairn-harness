// verify 归因（P1-3 第一笔：schema + 生产者）的判卷面。
//
// 三件事各自要有用例，缺一件就是"字段落了盘但没人读/没人守"：
// ⑴ 每格 cause 挂在**哪个已有判定**上（超时布尔 / 退出码 127 / pnpm 自己那一行 / `(none)` 哨兵 / 钩子 catch）；
// ⑵ 反向一侧：同一串文字出现在**不是行首**的位置时不许判成环境红（§9.1 否掉文案匹配的理由还在）；
// ⑶ 事件穿流：loop 落进事件流的那条 verify_result 真带上了 cause（生产者上游必须有观测者）。
import { describe, expect, it } from "vitest";
import {
  classifyVerifyFailure,
  runVerifyOutcome,
  verifyOutcomeCause,
  withVerifyCauseNote,
  defaultExec,
  type VerifyOutcome,
} from "../src/agent/verify";
import { isEnvVerifyCause, type AgentEvent, type VerifyResultEvent } from "../src/events";
import { runLoop } from "../src/agent/loop";

describe("classifyVerifyFailure：每格挂在一个已有判定上", () => {
  it("超时布尔 ⇒ timeout，且它优先于其它格（超时那条路 exitCode 是 null）", () => {
    expect(classifyVerifyFailure({ timedOut: true, exitCode: null, output: "x" })).toBe("timeout");
  });

  it("退出码 127 ⇒ toolchain-missing（命令不存在，说明不了代码对错）", () => {
    expect(classifyVerifyFailure({ timedOut: false, exitCode: 127, output: "bash: cargo: command not found" })).toBe("toolchain-missing");
  });

  it("pnpm 自己那一行的命名空间错误码 ⇒ pkg-manager", () => {
    expect(classifyVerifyFailure({ timedOut: false, exitCode: 1, output: "[ERR_PNPM_UNSAFE_MODULES_DIR] Refusing to remove" })).toBe("pkg-manager");
    expect(classifyVerifyFailure({ timedOut: false, exitCode: 1, output: "开头一行别的\n[ERR_PNPM_OUTDATED_LOCKFILE] x" })).toBe("pkg-manager");
  });

  it("反向：同一串出现在行中间（被测脚本自己的断言文本）⇒ 仍算 code，不判环境红", () => {
    expect(classifyVerifyFailure({ timedOut: false, exitCode: 1, output: 'AssertionError: expected "[ERR_PNPM_UNSAFE_MODULES_DIR]" to be defined' })).toBe("code");
  });

  it("普通退出码 1 ⇒ code（缺省即零行为：不认识的都算模型的账）", () => {
    expect(classifyVerifyFailure({ timedOut: false, exitCode: 1, output: "2 failed" })).toBe("code");
  });
});

describe("isEnvVerifyCause：三处出口共用这一只谓词", () => {
  it("五类环境成因 ⇒ true；code 与字段缺席 ⇒ false（缺席 = 老会话流，按模型的账算）", () => {
    expect(isEnvVerifyCause("timeout")).toBe(true);
    expect(isEnvVerifyCause("toolchain-missing")).toBe(true);
    expect(isEnvVerifyCause("no-surface")).toBe(true);
    expect(isEnvVerifyCause("hook-error")).toBe(true);
    expect(isEnvVerifyCause("pkg-manager")).toBe(true);
    expect(isEnvVerifyCause("code")).toBe(false);
    expect(isEnvVerifyCause(undefined)).toBe(false);
  });
});

describe("defaultExec 真跑进程：cause/exitCode 得来自进程本身", () => {
  it("退出码 127 ⇒ cause=toolchain-missing、exitCode=127", async () => {
    const r = await defaultExec("exit 127", process.cwd());
    expect(r.ok).toBe(false);
    expect(r.cause).toBe("toolchain-missing");
    expect(r.exitCode).toBe(127);
  });

  it("pnpm 式错误码行 + 非 0 ⇒ cause=pkg-manager，且正文补那句「别照它改代码」", async () => {
    const r = await defaultExec(`printf '%s\\n' '[ERR_PNPM_UNSAFE_MODULES_DIR] Refusing to remove the modules directory'; exit 1`, process.cwd());
    expect(r.cause).toBe("pkg-manager");
    expect(r.exitCode).toBe(1);
    expect(r.output).toContain("这不是代码失败");
  });

  it("墙钟到点 ⇒ cause=timeout、exitCode=null（强杀没有退出码，不许伪造一个 0）", async () => {
    const r = await defaultExec("sleep 5", process.cwd(), 50);
    expect(r.ok).toBe(false);
    expect(r.cause).toBe("timeout");
    expect(r.exitCode).toBeNull();
  });

  it("绿 ⇒ 不带 cause 字段（它是「这次红算谁的」，不是结局字段）", async () => {
    const r = await defaultExec("echo ok", process.cwd());
    expect(r.ok).toBe(true);
    expect("cause" in r).toBe(false);
  });
});

describe("拍级归因与无面哨兵", () => {
  it("没有 verify 配置 ⇒ (none) 那条 cause=no-surface（今天只有这一类光靠形状就能判）", async () => {
    const dir = await mkTmpEmptyRepo();
    const out = await runVerifyOutcome(dir, async () => ({ command: "x", ok: true, output: "" }));
    expect(out.ok).toBe(false);
    expect(out.results[0]?.command).toBe("(none)");
    expect(out.results[0]?.cause).toBe("no-surface");
  });

  it("钩子抛错优先于 results（那条路 results 是空的）⇒ hook-error", () => {
    const outcome: VerifyOutcome = { ok: false, results: [] };
    expect(verifyOutcomeCause(outcome, "config broken")).toBe("hook-error");
  });

  it("取首个失败命令的 cause；绿拍 ⇒ undefined；老式 exec 不带 cause ⇒ undefined（零行为）", () => {
    const mixed: VerifyOutcome = {
      ok: false,
      results: [
        { command: "lint", ok: true, output: "" },
        { command: "test", ok: false, output: "boom", cause: "timeout", exitCode: null },
        { command: "test2", ok: false, output: "boom", cause: "code", exitCode: 1 },
      ],
    };
    expect(verifyOutcomeCause(mixed, null)).toBe("timeout");
    expect(verifyOutcomeCause({ ok: true, results: [] }, null)).toBeUndefined();
    expect(verifyOutcomeCause({ ok: false, results: [{ command: "t", ok: false, output: "old" }] }, null)).toBeUndefined();
  });

  it("注文案只补一次，且非 pkg-manager 一律原样返回（两条 exec 出口共用一只，别漂成两份文案）", () => {
    const once = withVerifyCauseNote("head", "pkg-manager");
    expect(once.match(/包管理器自身报错/g)).toHaveLength(1);
    expect(withVerifyCauseNote(once, "pkg-manager")).toBe(once);
    expect(withVerifyCauseNote("head", "code")).toBe("head");
  });
});

describe("事件穿流：loop 落的那条 verify_result 真带 cause", () => {
  it("模型自调 verify、钩子回一条 pkg-manager 红 ⇒ 事件带 cause，attempt 语义一字未动", async () => {
    const log: AgentEvent[] = [];
    await runLoop({
      workspace: "/tmp",
      events: { async append(event) { log.push(event); } },
      tools: {},
      provider: {
        async *stream() {
          yield { type: "tool_call", id: "c1", name: "verify", args: {} };
        },
      },
      verify: {
        async run(): Promise<VerifyOutcome> {
          return {
            ok: false,
            results: [{ command: "pnpm run test", ok: false, output: "[ERR_PNPM_UNSAFE_MODULES_DIR] nope", cause: "pkg-manager", exitCode: 1 }],
          };
        },
      },
    });
    const v = log.find((e): e is VerifyResultEvent => e.type === "verify_result");
    expect(v?.cause).toBe("pkg-manager");
    expect(v?.attempt).toBe(1);
    expect(v?.maxAttempts).toBe(3);
  });
});

/** 造一个"什么都没配"的空仓：runVerifyOutcome 该落到 (none) 哨兵。 */
async function mkTmpEmptyRepo(): Promise<string> {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  return fs.mkdtempSync(path.join(os.tmpdir(), "dsh-verify-empty-"));
}

describe("pipefail：管道里的失败不得被尾端吞掉（25 页施工回归）", () => {
  it("`false | tail -1` ⇒ ok:false、exitCode=1（施工前这里给的是 ok:true，判卷面据此报绿）", async () => {
    const r = await defaultExec("false | tail -1", process.cwd());
    expect(r.ok).toBe(false);
    expect(r.exitCode).toBe(1);
  });

  it("对照：整条管道真成功 ⇒ 仍然 ok:true（这条改的是吞码，不是把所有管道判红）", async () => {
    const r = await defaultExec("printf 'a\\nb\\n' | tail -1", process.cwd());
    expect(r.ok).toBe(true);
    expect(r.output.trim()).toBe("b");
  });
});
