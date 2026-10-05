// 「执行-验证-修正」闭环缺的第三格：验证**被拒**（这一拍一条命令都没跑）不等于「跑了且红」。
//
// 现场（现读代码，不是推断）：
// · `src/agent/verify.ts` 的信任闸拒绝时，`createVerifyHook.run()` 返回 `{ok:false, results:[], skipped:reason}`；
//   而 `skipped` 这个字段**全仓零消费者**（现读：只有声明处 verify.ts:91 与生产处 :393 两处命中）。
// · 于是 `loop.ts` 的 `verifyBeat` 拿到一条 **cause 缺席**的红（`verifyOutcomeCause` 从空 results 里
//   取不到 cause），而 `isEnvVerifyCause(undefined) === false` ⇒ 这一拍被记成**代码红**，后果四件：
//     ⑴ `chargedAttempts +1` —— 白烧一次模型修复额度；
//     ⑵ 注入的是 `failureDigest` 在空 results 上那句「verify 失败（无详细输出）」——
//        一条**没有红字的红**，模型只会照着它去改本来正确的代码；
//     ⑶ 自动拍返回 "auto-red" ⇒ 驱动一次返修，多要一轮真钱；
//     ⑷ 事件面 `verify_result{ok:false, cause 缺席}` 被 `workerVerificationEvidence` 判成 `failed`
//        ⇒ goal 侧证据永远是 failed（`absent` 那一支能停，`failed` 只能 continue）。
//   这正是本仓点名的失败形状：**把「没跑」记成「跑过且失败」**——与第 221 页 #39 把 `not-run`
//   从缺省 `code` 里分出来那一格是同一族的孪生。
//
// 判据的形状（为什么尺长这样）：这条「没跑」的第三格必须**归因**，不是新增事件类型、也不是新增
// 事件字段——`VerifyResultEvent.cause` 就是为这件事准备的既有字段，`isEnvVerifyCause` 是四处出口
// 共用的唯一谓词。所以判卷只钉两处搬运（cause 归因、拒因原文回注）加它们的**可观测后果**，
// 判据本身住在 verify.ts 那两只映射里，一处一份。
import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLoop } from "../src/agent/loop";
import {
  createVerifyHook,
  failureDigest,
  verifyOutcomeCause,
  type ExecFn,
  type VerifyHook,
  type VerifyOutcome,
} from "../src/agent/verify";
import { isEnvVerifyCause, type AgentEvent, type ToolResultEvent, type VerifyCause, type VerifyResultEvent } from "../src/events";
import { workerVerificationEvidence } from "../src/agent/worker-report";
import { projectGoal } from "../src/agent/goal";
import { scoreStream } from "../scripts/replay/run-scorecard";

/** 判卷自造的拒因：与生产那句**零重叠**。断言钉的是「拒因有没有原样搬运」这件事，不是措辞——
 *  抄生产成品句会让文案与判卷一起改才响（规则 302），而这条第三格的事故恰恰是措辞之外的那格记账。 */
const FAKE_REFUSAL = "[witness-only] 这批命令没有授权，本拍一条都没有跑（判卷自造的假拒因）";

const skippedOutcome = (): VerifyOutcome => ({ ok: false, results: [], skipped: FAKE_REFUSAL });
const codeOutcome = (): VerifyOutcome => ({
  ok: false,
  results: [{ command: "pnpm run test", ok: false, output: "Test Files 1 failed", cause: "code", exitCode: 1 }],
});

const beatsOf = (log: AgentEvent[]): VerifyResultEvent[] =>
  log.filter((e): e is VerifyResultEvent => e.type === "verify_result");
/** 注入给模型的那几声（窄成 ToolResultEvent：联合上读 `.output` 编译不过，tsc 才抓得到）。 */
const injected = (log: AgentEvent[]): ToolResultEvent[] =>
  log.filter((e): e is ToolResultEvent => e.type === "tool_result" && e.ok === false);

/** 证据位的两只拍子：一拍绿的 + 一拍按指定 cause 红的（不占位那条要用它拼序列）。 */
const greenBeat: VerifyResultEvent = {
  type: "verify_result", callId: "a", ok: true, attempt: 1, maxAttempts: 3,
  results: [{ command: "t", ok: true, output: "ok" }],
};
const redBeat = (cause: VerifyCause): VerifyResultEvent => ({
  type: "verify_result", callId: "b", ok: false, attempt: 2, maxAttempts: 3, results: [], cause,
});

/** 模型每轮自调一次 verify（手动拍），跑出一条真实事件流而不是手搭 fixture。 */
async function runManual(hook: VerifyHook): Promise<AgentEvent[]> {
  const log: AgentEvent[] = [];
  let turn = 0;
  await runLoop({
    workspace: "/tmp",
    events: { async append(e) { log.push(e); } },
    tools: {},
    provider: {
      async *stream() {
        turn += 1;
        yield { type: "tool_call", id: "v" + String(turn), name: "verify", args: {} };
      },
    },
    verify: hook,
  });
  return log;
}

/** 收束闸剧本：1=写盘 → 2=纯文本收工（自动拍落在这里）→ 3=**只在开了返修且判成代码红时**才存在。 */
async function runAutoBeat(opts: { hook: VerifyHook; repair: boolean }): Promise<{
  log: AgentEvent[]; requests: number; hookCalls: number;
}> {
  const log: AgentEvent[] = [];
  const requests: unknown[][] = [];
  let hookCalls = 0;
  await runLoop({
    workspace: "/tmp",
    userMessage: "修那个失败的测试",
    mode: "auto",
    interactive: true,
    events: { async append(e) { log.push(e); } },
    tools: {
      write_file: { name: "write_file", async run() { return { ok: true, output: "written" }; } },
    } as never,
    verify: {
      surface: opts.hook.surface,
      async run(signal) { hookCalls += 1; return opts.hook.run(signal); },
    },
    autoVerify: true,
    ...(opts.repair ? { autoVerifyRepair: true } : {}),
    provider: {
      async *stream(messages) {
        requests.push(messages);
        const n = requests.length;
        yield n === 1
          ? { type: "tool_call", id: "w1", name: "write_file", args: { path: "src/a.ts" } }
          : { type: "assistant_message", content: "改完了。" };
      },
    } as never,
  });
  return { log, requests: requests.length, hookCalls };
}

/** 一支**克隆即携带**敌意 verify 配置的仓库（信任闸的真生产面，不是我手搭的 outcome）。 */
async function hostileRepo(): Promise<{ dir: string; hook: VerifyHook; execCalls: () => number }> {
  const dir = await mkdtemp(join(tmpdir(), "verify-skipped-"));
  await mkdir(join(dir, ".agent"), { recursive: true });
  await writeFile(
    join(dir, ".agent", "config.json"),
    JSON.stringify({ verify: { test: ["echo PWNED > /tmp/should-never-exist"] } }),
    "utf8",
  );
  let n = 0;
  const exec: ExecFn = async (command) => {
    n += 1;
    return { command, ok: true, output: "", exitCode: 0 };
  };
  // trustedRepo 缺省 false —— 这条就是攻击路径本身：未授权 ⇒ run() 给的是 skipped。
  return { dir, hook: createVerifyHook(dir, { exec }), execCalls: () => n };
}

describe("第三格的判据本身：两只映射各搬一件事，都不在 loop 里", () => {
  it(
    "skipped 非空 ⇒ 归因给的是「没跑成」那一格且它进环境类，而不是 cause 缺席（缺席＝下游一律按 code 记账）",
    () => {
      const cause = verifyOutcomeCause(skippedOutcome(), null);
      expect(cause).toBe("skipped");
      expect(isEnvVerifyCause(cause), "被拒那一拍不许记在模型账上").toBe(true);
    },
  );

  it(
    "skipped 非空 ⇒ 回注给模型的是那句拒因本身，不是「verify 失败（无详细输出）」那种没有红字的红",
    () => {
      expect(failureDigest(skippedOutcome())).toBe(FAKE_REFUSAL);
    },
  );

  it(
    "同形反证：results 为空但**没有** skipped（钩子抛错那条路）⇒ 两只映射一律不改（否则上面两条是恒真）",
    () => {
      expect(verifyOutcomeCause({ ok: false, results: [] }, "config broken")).toBe("hook-error");
      expect(failureDigest({ ok: false, results: [] })).toBe("verify 失败（无详细输出）");
      expect(failureDigest({ ok: false, results: [{ command: "t", ok: false, output: "2 failed" }] }))
        .toContain("2 failed");
    },
  );
});

describe("真仓面：未授权的克隆被模型自调 verify（信任闸的那一拍走 loop 的真实出口）", () => {
  it(
    "被拒那一拍不记 failed、不烧修复额度：执行器一次未叫、attempt 停在 1,1、goal 证据是 absent 不是 failed",
    async () => {
      const { dir, hook, execCalls } = await hostileRepo();
      try {
        const log = await runManual(hook);
        expect(execCalls(), "未授权时那条仓库命令被执行了 —— 信任闸没生效").toBe(0);
        const beats = beatsOf(log);
        expect(beats.length, "被拒那一拍走的是环境拍的 2 拍上限，不是模型的 3 次修复额度").toBe(2);
        expect(beats.map((e) => e.attempt), "连续两拍被拒 ⇒ attempt 序列必须 1,1（不是 1,2）").toEqual([1, 1]);
        expect(beats.every((e) => e.cause === "skipped")).toBe(true);
        // 证据面：goal 的续跑判据与 worker 的客观证据读的是同一只函数（goal.ts 直接调它）。
        expect(workerVerificationEvidence(log), "被拒那一拍不许把证据判成 failed").toBe("absent");
        const goal = projectGoal([
          { type: "goal_set", objective: "修那个失败的测试", max_turns: 3, max_usd: 0 },
          ...log,
        ]);
        expect(goal?.evidence, "证据 failed ⇒ goal 永远 continue；没跑成不许占这一格").toBe("absent");
        // y 轴：这一拍的代码红计数必须为 0（否则语料面把它记成「跑过且失败」）。
        const s = scoreStream(log);
        expect(s.codeRed, "被拒那一拍不许进代码红分母").toBe(0);
        expect(s.decisive).toBe("none");
        expect(injected(log).some((e) => e.output.includes("已达上限")), "不许出现「修复额度已达上限」那句").toBe(false);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );

  it(
    "拒因原样回注给模型：那声 tool_result 带的就是 run() 给的 skipped 原文，且没有「无详细输出」占位",
    async () => {
      const { dir, hook } = await hostileRepo();
      try {
        const reason = (await hook.run())?.skipped ?? "";
        expect(reason.length, "生产面没给出拒因，下面那条断言就是恒真").toBeGreaterThan(0);
        const log = await runManual(hook);
        const first = injected(log)[0];
        expect(first?.output, "拒因没有原样回注：模型拿不到「为什么没验」就会反复重试同一条路").toContain(reason);
        expect(first?.output).not.toContain("无详细输出");
        expect(first?.output).toContain("cause=skipped");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );
});

describe("自动拍的后果：被拒不驱动返修（返修 = 多要一轮真钱）", () => {
  it(
    "被拒那一拍不启动返修那一支：模型请求数停在 2、钩子只被叫一次、语料落 env-blocked",
    async () => {
      const hook: VerifyHook = {
        // surface 给 true：把「run() 自己拒了」那条路与 surface() 那条整段跳过的路分开钉住。
        surface: async () => true,
        run: async () => skippedOutcome(),
      };
      const { log, requests, hookCalls } = await runAutoBeat({ hook, repair: true });
      expect(requests, "被拒不是一拍代码红 ⇒ 不该多要一轮模型去改本来正确的代码").toBe(2);
      expect(hookCalls, "返修那一拍不许启动").toBe(1);
      const beat = beatsOf(log)[0];
      expect(beat?.auto).toBe(true);
      expect(beat?.cause).toBe("skipped");
      expect(scoreStream(log).outcome, "语料面这条是 env-blocked，不是 ended-red").toBe("env-blocked");
      expect(workerVerificationEvidence(log)).toBe("absent");
    },
  );

  it(
    "零回归证人：真跑了且红（cause=code）那一拍照旧驱动返修、照旧记代码红",
    async () => {
      const hook: VerifyHook = { surface: async () => true, run: async () => codeOutcome() };
      const { log, requests, hookCalls } = await runAutoBeat({ hook, repair: true });
      expect(requests, "代码红仍然要那一轮返修（这波改动不许把它关掉）").toBeGreaterThan(2);
      expect(hookCalls).toBe(1);
      const s = scoreStream(log);
      expect(s.codeRed).toBe(1);
      expect(s.decisive).toBe("code-red");
      expect(workerVerificationEvidence(log)).toBe("failed");
    },
  );
});

describe("既有环境红的语义一处都不许被这波改动弄丢（不记账 + 不占位）", () => {
  it(
    "环境红（toolchain-missing）：不推进 attempt，也不顶掉先前那拍绿证据的位置",
    async () => {
      const env: VerifyOutcome = {
        ok: false,
        results: [{ command: "cargo test", ok: false, output: "bash: cargo: command not found", cause: "toolchain-missing", exitCode: 127 }],
      };
      const log = await runManual({ run: async () => env });
      expect(beatsOf(log).map((e) => e.attempt)).toEqual([1, 1]);
      expect(workerVerificationEvidence(log)).toBe("absent");
      expect(scoreStream(log).codeRed).toBe(0);
      const afterGreen: AgentEvent[] = [
        greenBeat,
        { type: "verify_result", callId: "b", ok: false, attempt: 2, maxAttempts: 3, results: [], cause: "toolchain-missing" },
      ];
      expect(workerVerificationEvidence(afterGreen), "环境拍不许把 verified 顶成 stale/failed").toBe("verified");
      // 第三格同样不占位：一条被拒的拍子对代码的证明力是零。
      const afterGreenSkipped: AgentEvent[] = [greenBeat, redBeat("skipped")];
      expect(workerVerificationEvidence(afterGreenSkipped), "被拒那一拍同样不许占「最后验过什么」这一格").toBe("verified");
      // 反向：不许把环境豁免扩成「红一律不算」。
      const realRed: AgentEvent[] = [greenBeat, { ...redBeat("code"), results: [{ command: "t", ok: false, output: "boom", cause: "code" }] }];
      expect(workerVerificationEvidence(realRed)).toBe("failed");
    },
  );
});
