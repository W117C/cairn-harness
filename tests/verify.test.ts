// 验证门（任务 3）验收：
// ① 连续失败 3 次后停止且不再调用模型；② 第 2 次成功后立即停止；
// ③ 配置读 .agent/config.json 的 verify 字段；④ 缺省探测 package.json scripts；⑤ 无配置 fail-closed。
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runLoop } from "../src/agent/loop";
import {
  createVerifyHook,
  defaultExec,
  failureDigest,
  loadVerifyConfig,
  runVerifyOutcome,
  type VerifyOutcome,
} from "../src/agent/verify";
import { createEventLog, replay, type VerifyCommandResult } from "../src/events";
import type { ModelOutput } from "../src/providers";

function scriptedProvider(script: ModelOutput[]): {
  provider: { next(): Promise<ModelOutput | null> };
  calls: () => number;
} {
  let i = 0;
  let calls = 0;
  return {
    provider: {
      async next() {
        calls++;
        const v = script[i];
        i++;
        return v ?? null;
      },
    },
    calls: () => calls,
  };
}

function outcomes(...oks: boolean[]): { run(): Promise<VerifyOutcome>; attempts: number[] } {
  const attempts: number[] = [];
  return {
    attempts,
    run: async () => {
      attempts.push(attempts.length + 1);
      const n = attempts.length;
      const result: VerifyCommandResult = {
        command: "stub verify",
        ok: oks[Math.min(n, oks.length) - 1] ?? false,
        output: n <= oks.length && (oks[n - 1] ?? false) ? "3 passed" : "FAIL: 1 failed | 2 passed",
      };
      return { ok: result.ok, results: [result] };
    },
  };
}

async function run(script: ModelOutput[], hook: { run(): Promise<VerifyOutcome>; maxAttempts?: number } | undefined) {
  const logPath = join(tmpdir(), `m1b-verify-${String(Date.now())}-${String(Math.random()).slice(2, 8)}.jsonl`);
  const events = createEventLog(logPath);
  const { provider, calls } = scriptedProvider(script);
  await runLoop({ provider, events, workspace: "/tmp", mode: "auto", verify: hook });
  const log = await replay(logPath);
  return { log, calls: calls(), logPath };
}

function verifyResults(log: Awaited<ReturnType<typeof run>>["log"]): Array<{ ok: boolean; attempt: number; maxAttempts: number }> {
  return log
    .filter((e): e is Extract<typeof e, { type: "verify_result" }> => e.type === "verify_result")
    .map((e) => ({ ok: e.ok, attempt: e.attempt, maxAttempts: e.maxAttempts }));
}

describe("verify 反射循环（loop 级）", () => {
  it("①连续失败 3 次后停止且不再调用模型", async () => {
    const hook = { maxAttempts: 3, run: outcomes(false, false, false).run };
    const { log, calls } = await run(
      [
        { type: "tool_call", id: "v1", name: "verify", args: {} },
        { type: "tool_call", id: "v2", name: "verify", args: {} },
        { type: "tool_call", id: "v3", name: "verify", args: {} },
        { type: "assistant_message", content: "不应被消费" },
      ],
      hook,
    );
    const results = verifyResults(log);
    expect(results).toEqual([
      { ok: false, attempt: 1, maxAttempts: 3 },
      { ok: false, attempt: 2, maxAttempts: 3 },
      { ok: false, attempt: 3, maxAttempts: 3 },
    ]);
    // 第 4 条剧本（收尾消息）从未被消费：模型不再被调用
    expect(log.some((e) => e.type === "assistant_message")).toBe(false);
    expect(calls).toBe(3);
    // 末次失败带上限停止说明（tool_result 收口，tool_call 不悬空）
    const last = log[log.length - 1];
    expect(last?.type === "tool_result" && last.output).toContain("已达上限，停止");
  });

  it("②第 2 次成功后立即停止（不再调用模型）", async () => {
    const hook = { maxAttempts: 3, run: outcomes(false, true).run };
    const { log, calls } = await run(
      [
        { type: "tool_call", id: "v1", name: "verify", args: {} },
        { type: "tool_call", id: "v2", name: "verify", args: {} },
        { type: "assistant_message", content: "不应被消费" },
      ],
      hook,
    );
    const results = verifyResults(log);
    expect(results).toEqual([
      { ok: false, attempt: 1, maxAttempts: 3 },
      { ok: true, attempt: 2, maxAttempts: 3 },
    ]);
    expect(log.some((e) => e.type === "assistant_message")).toBe(false);
    expect(calls).toBe(2);
  });

  it("失败注入同轮：失败后 tool_result 携带错误输出供模型继续修", async () => {
    const hook = { maxAttempts: 3, run: outcomes(false, true).run };
    const { log } = await run(
      [
        { type: "tool_call", id: "v1", name: "verify", args: {} },
        { type: "tool_call", id: "v2", name: "verify", args: {} },
      ],
      hook,
    );
    const inject = log.find((e) => e.type === "tool_result");
    expect(inject?.type === "tool_result" && inject.ok).toBe(false);
    if (inject?.type === "tool_result") {
      expect(inject.output).toContain("[verify FAIL]");
      expect(inject.output).toContain("1 failed");
    }
  });

  it("verify 未接线 → fail-closed（不执行任何命令）", async () => {
    const { log, calls } = await run([{ type: "tool_call", id: "v1", name: "verify", args: {} }], undefined);
    const result = log.find((e) => e.type === "tool_result");
    expect(result?.type === "tool_result" && result.ok).toBe(false);
    if (result?.type === "tool_result") expect(result.output).toContain("fail-closed");
    expect(calls).toBe(2); // 第 2 次 next() 拿到 null（剧本耗尽）收束 loop，非模型续跑
  });
});

describe("verify 配置装载", () => {
  it("③ .agent/config.json 的 verify 字段优先", async () => {
    const dir = join(tmpdir(), `m1b-verify-cfg-${String(Date.now())}`);
    await mkdir(join(dir, ".agent"), { recursive: true });
    await writeFile(
      join(dir, ".agent", "config.json"),
      JSON.stringify({ verify: { lint: ["echo lint-ok"], test: ["echo test-ok"] } }),
      "utf8",
    );
    const { config, source } = await loadVerifyConfig(dir);
    expect(source).toBe("config");
    expect(config.lint).toEqual(["echo lint-ok"]);
    expect(config.test).toEqual(["echo test-ok"]);
    // 真执行（defaultExec）：全绿 → ok
    const outcome = await runVerifyOutcome(dir);
    expect(outcome.ok).toBe(true);
    expect(outcome.results.map((r) => r.command)).toEqual(["echo lint-ok", "echo test-ok"]);
    await rm(dir, { recursive: true, force: true });
  });

  it("④ 缺省探测 package.json scripts（lint/test 存在才收）", async () => {
    const dir = join(tmpdir(), `m1b-verify-probe-${String(Date.now())}`);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "t", scripts: { test: "vitest run", build: "tsc" } }),
      "utf8",
    );
    const { config, source } = await loadVerifyConfig(dir);
    expect(source).toBe("probed");
    expect(config.test).toEqual(["pnpm run test"]); // build 不是 verify 命令，不收
    expect(config.lint).toBeUndefined();
    await rm(dir, { recursive: true, force: true });
  });

  it("⑤ 无配置无 scripts → fail-closed（ok:false，不空转放行）", async () => {
    const dir = join(tmpdir(), `m1b-verify-none-${String(Date.now())}`);
    await mkdir(dir, { recursive: true });
    const outcome = await runVerifyOutcome(dir);
    expect(outcome.ok).toBe(false);
    expect(outcome.results[0]?.output).toContain("未找到 verify 配置");
    await rm(dir, { recursive: true, force: true });
  });

  it("失败命令 → ok:false；failureDigest 摘要含命令与输出", async () => {
    const dir = join(tmpdir(), `m1b-verify-fail-${String(Date.now())}`);
    await mkdir(join(dir, ".agent"), { recursive: true });
    await writeFile(
      join(dir, ".agent", "config.json"),
      JSON.stringify({ verify: { test: ["node -e \"process.exit(3)\""] } }),
      "utf8",
    );
    const outcome = await runVerifyOutcome(dir, defaultExec);
    expect(outcome.ok).toBe(false);
    const digest = failureDigest(outcome);
    expect(digest).toContain("[verify FAIL]");
    expect(digest).toContain("exit code: 3");
    await rm(dir, { recursive: true, force: true });
  });

  it("createVerifyHook：上限可配透传", async () => {
    const hook = createVerifyHook(tmpdir(), { maxAttempts: 5, exec: async (cmd) => ({ command: cmd, ok: true, output: "" }) });
    expect(hook.maxAttempts).toBe(5);
    const outcome = await hook.run();
    expect(outcome.ok).toBe(false); // tmpdir 无配置 → fail-closed，但 hook 本身可运行
  });
  it("verify 配置字段非数组 → fail loud（外部输入不静默放行）", async () => {
    const dir = join(tmpdir(), `m1b-verify-badarr-${String(Date.now())}`);
    await mkdir(join(dir, ".agent"), { recursive: true });
    await writeFile(join(dir, ".agent", "config.json"), JSON.stringify({ verify: { lint: "echo x" } }), "utf8");
    await expect(loadVerifyConfig(dir)).rejects.toThrow("必须是字符串数组");
    await rm(dir, { recursive: true, force: true });
  });

  it("config.json 坏 JSON → fail loud（ENOENT 才可降级到探测）", async () => {
    const dir = join(tmpdir(), `m1b-verify-badjson-${String(Date.now())}`);
    await mkdir(join(dir, ".agent"), { recursive: true });
    await writeFile(join(dir, ".agent", "config.json"), "{not json", "utf8");
    await expect(loadVerifyConfig(dir)).rejects.toThrow();
    await rm(dir, { recursive: true, force: true });
  });

  it("package.json 坏 JSON → fail loud（不许静默降级到语言探测，那是第二道独立闸）", async () => {
    const dir = join(tmpdir(), `m1b-verify-badpkg-${String(Date.now())}`);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "package.json"), "{not json", "utf8");
    await expect(loadVerifyConfig(dir)).rejects.toThrow();
    await rm(dir, { recursive: true, force: true });
  });

});

// 验证门的失败摘要就是模型的修-code 依据：旧执行器抄的是 run_shell 的**旧**截断（只留头部），
// 而 `N failed` / 失败用例名 / stack 末行全在尾部——模型拿到一串 ✓ 行，只能白烧完 3 次额度。
describe("defaultExec 超限截断（能力 5：结论在尾部，必须留住）", () => {
  it("超 32KB 的失败输出：头尾都在，尾部结论进了 failureDigest", async () => {
    const r = await defaultExec(
      "for i in $(seq 1 4000); do echo \"progress-$i\"; done; echo 'FAILED: 2 tests, expected 3 got 2'; exit 1",
      process.cwd(),
    );
    expect(r.ok).toBe(false);
    expect(r.output).toContain("省略中间");
    expect(r.output).toContain("progress-1");        // 头部留住
    expect(r.output).toContain("FAILED: 2 tests");    // 尾部结论也留住
    expect(r.output).toContain("[exit code: 1]");
    expect(r.output.length).toBeLessThanOrEqual(32 * 1024 + 64);
    expect(failureDigest({ ok: false, results: [r] })).toContain("FAILED: 2 tests");
  });

  it("未超限：输出逐字不变（既有 verify 判据零回归）", async () => {
    const r = await defaultExec("echo hi", process.cwd());
    expect(r.ok).toBe(true);
    expect(r.output).toBe("hi");
  });
});

// 连续两拍失败摘要逐字相同 = 这一拍没有带来任何新信息（上一拍的全文还在上下文里）。
// 旧行为是把同一坨日志第二次塞进 prompt：贵，且不给模型「你这次改动没生效」这个真正可执行的信号。
describe("verify 重复注入去重（能力 5 的修正拍不再白烧 token）", () => {
  /** 每拍产出一条可控文本的失败钩子（`outcomes()` 的失败文本恒同，喂不出「变了」这一支）。 */
  function failingHook(...failTexts: string[]): { run(): Promise<VerifyOutcome>; maxAttempts: number } {
    let n = 0;
    return {
      maxAttempts: failTexts.length + 2,
      run: async () => {
        const text = failTexts[Math.min(n, failTexts.length - 1)] ?? "";
        n++;
        return { ok: false, results: [{ command: "pnpm test", ok: false, output: text }] };
      },
    };
  }
  const script = (n: number): ModelOutput[] => [
    ...Array.from({ length: n }, (_, i) => ({ type: "tool_call", id: "v" + String(i), name: "verify", args: {} }) as ModelOutput),
    { type: "assistant_message", content: "收尾" },
  ];
  const injected = (log: Awaited<ReturnType<typeof run>>["log"]): string[] =>
    log.filter((e) => e.type === "tool_result").map((e) => (e as { output: string }).output);

  it("第 2 拍与第 1 拍逐字相同：改注一行提示，不重发失败正文", async () => {
    const { log } = await run(script(4), failingHook("FAIL: 2 tests, expected 3 got 2"));
    const outs = injected(log);
    expect(outs[0]).toContain("FAIL: 2 tests");              // 第 1 拍：全文
    expect(outs[1]).toContain("逐字相同");                    // 第 2 拍：重复信号
    expect(outs[1]).toContain("失败命令不变：pnpm test");      // 且指名是哪些命令没变
    expect(outs[1]).not.toContain("FAIL: 2 tests");           // 不再重发正文
    expect(outs[1].length).toBeLessThan(320);
  });

  it("第 3 拍输出变了 ⇒ 全文照常注入（去重不是「只注入一次」）", async () => {
    const { log } = await run(script(4), failingHook("FIRST-A", "FIRST-A", "SECOND-B"));
    const outs = injected(log);
    expect(outs[0]).toContain("FIRST-A");
    expect(outs[1]).toContain("逐字相同");
    expect(outs[2]).toContain("SECOND-B");
    expect(outs[2]).not.toContain("逐字相同");
  });

  it("省下的量可测：32KB 级的相同失败摘要，第二拍注入字节 < 第一拍的 1/10", async () => {
    const big = "x".repeat(30 * 1024) + "\nFAILED: 1 of 42 tests";
    const { log } = await run(script(4), failingHook(big, big));
    const outs = injected(log);
    expect(outs[0].length).toBeGreaterThan(30 * 1024);
    expect(outs[1].length * 10).toBeLessThan(outs[0].length);
  });

  it("单次失败不触发任何新文案（零回归：只有一拍时无从比较）", async () => {
    const { log } = await run(script(1), {
      maxAttempts: 3,
      run: outcomes(false).run,
    });
    const outs = injected(log);
    expect(outs[0]).toContain("FAIL: 1 failed | 2 passed");
    expect(outs.some((o) => o.includes("逐字相同"))).toBe(false);
  });
});
