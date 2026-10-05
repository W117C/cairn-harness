// #102：验证拍的「读数面」分档。
//
// 缺陷形状：`verify_result{ok:false}` 在事件流里有三种结局（代码红／被拒＝有面未授权／环境红），
// 而两处只数 `ok:false` 的计数器（`src/cli.ts` 的 tally、`src/agent/tool-choice.ts` 的
// `out.verifyFailures`）把它们全收进「红」这一格。今天全仓读过 cause 的消费者
// （`worker-report`／`loop`／`distill`／`lessons`／`compaction`／`gym`／两个 replay 面）都已经吃到
// `src/events` 里那一只 `isEnvVerifyCause`，漏的就是这两处——被拒那一拍在**读数面**上仍然长得像
// "你的代码跑红了"。
//
// 这组尺量四件事，每件都配反向：
//   ① 分档对不对（skipped ⇒ 被拒档，不进红档）；
//   ② 零回归证人（code 红与**未归因**的红照旧进红档——"不再一律计红"不等于"什么都不计"）；
//   ③ 环境红进环境档，不污染红档；
//   ④ **判据同源**：两个面对每一种 cause 的归档必须与 `isEnvVerifyCause` 那只谓词逐格一致，
//      并且两处都不再出现「`ok:false` 直接计红」的写法。
//      ⚠️ 第 ④ 条不能只做文本断言（本仓踩过：注释能把文本断言顶掉、切片被挪位置会悄悄变小）。
//      这里的文本断言先剥注释，且**行为面**同一轮把真事件喂进真函数——把 `!e.ok` 换回直接计红，
//      第 ①③ 条当场红；把谓词换成一张本地 cause 表，第 ④ 条的行为面对某一种 cause 当场红。
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatVerifyBeats, runFailed, tallyVerifyBeat, type VerifyBeatTally } from "../src/cli";
import { formatToolChoice, projectSession, projectToolChoice } from "../src/agent/tool-choice";
import { isEnvVerifyCause, type AgentEvent, type VerifyCause, type VerifyResultEvent } from "../src/events";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();

/** 一拍验证（真事件形状，不是手搭的半边结构：`results` 空正是被拒那一拍的产物形状）。 */
const beat = (opts: { ok: boolean; cause?: VerifyCause; auto?: boolean }): VerifyResultEvent => ({
  type: "verify_result",
  callId: "v1",
  ok: opts.ok,
  attempt: 1,
  maxAttempts: 3,
  results: [],
  ...(opts.cause === undefined ? {} : { cause: opts.cause }),
  ...(opts.auto === undefined ? {} : { auto: opts.auto }),
});

const freshTally = (): VerifyBeatTally => ({ codeBeats: 0, blockedBeats: 0, envBeats: 0 });

/** CLI 那一面的"红档"读数：`verifyRed` 是退出码槽，代码红拍数是印面槽。两者必须同源。 */
const cliBuckets = (cause: VerifyCause | undefined): VerifyBeatTally => {
  const t = freshTally();
  tallyVerifyBeat(t, cause);
  return t;
};

/** tool-choice 那一面的三档（从真事件流投影出来，不手搭计数）。 */
const choiceBuckets = (cause: VerifyCause | undefined): { failures: number; blocked: number; env: number } => {
  const c = projectSession([beat({ ok: false, cause })]);
  return { failures: c.verifyFailures, blocked: c.verifyBlocked, env: c.verifyEnv };
};

/** 全部归因 + 「未归因」（口径：`cause` 缺席 ⇒ 按 code 算）。 */
const ALL_CAUSES: readonly (VerifyCause | undefined)[] = [
  undefined, "code", "skipped", "toolchain-missing", "timeout", "no-surface", "hook-error", "pkg-manager", "not-run",
];

/** 剥掉注释再比文本（`tests/cli-surface.test.ts` 那次的教训：一句**警告注释**就能顶包文本断言）。
 *  字符串字面量也要一起跳过，否则 `("//")` 这类内容会把状态机带偏。 */
function stripComments(s: string): string {
  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i]!;
    const n = s[i + 1];
    if (quote !== null) {
      if (c === "\\") { out += c + (n ?? ""); i += 1; continue; }
      if (c === quote) quote = null;
      out += c;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; out += c; continue; }
    if (c === "/" && n === "/") { while (i < s.length && s[i] !== "\n") i += 1; out += "\n"; continue; }
    if (c === "/" && n === "*") { i += 2; while (i < s.length && !(s[i] === "*" && s[i + 1] === "/")) i += 1; i += 1; continue; }
    out += c;
  }
  return out;
}

const codeOf = (rel: string): string => stripComments(readFileSync(join(ROOT, rel), "utf8"));

describe("① 被拒那一拍（cause=skipped）：不进红档、进被拒档", () => {
  it("CLI：skipped 拍不置红，只加被拒档", () => {
    expect(cliBuckets("skipped")).toEqual({ codeBeats: 0, blockedBeats: 1, envBeats: 0 });
  });

  it("tool-choice：skipped 拍不进 verifyFailures，只加 verifyBlocked", () => {
    expect(choiceBuckets("skipped")).toEqual({ failures: 0, blocked: 1, env: 0 });
  });

  it("反向证人：同一种拍若被计进红档，本条就必须红（不是「什么都没数」的假绿）", () => {
    // 这条把"分档"与"整档不计"分开：被拒拍的**总数**必须还在（三档之和 = 1），
    // 否则摘掉计数也照样绿——那是把读数改成静默，不是改成准确。
    const t = cliBuckets("skipped");
    expect(t.codeBeats + t.blockedBeats + t.envBeats).toBe(1);
    const c = choiceBuckets("skipped");
    expect(c.failures + c.blocked + c.env).toBe(1);
  });
});

describe("② 零回归证人：代码红照旧进红档", () => {
  it("CLI：cause=code 的红仍进 codeBeats，被拒／环境两档为 0", () => {
    expect(cliBuckets("code")).toEqual({ codeBeats: 1, blockedBeats: 0, envBeats: 0 });
  });

  it("tool-choice：cause=code 的红仍进 verifyFailures", () => {
    expect(choiceBuckets("code")).toEqual({ failures: 1, blocked: 0, env: 0 });
  });

  it("未归因（cause 缺席）按 code 算——两处都不许把它当成环境拍", () => {
    // 口径来自 `isEnvVerifyCause` 的注释原文：缺席 = 未归因 = 按 code 算。
    // 分档若写成「cause 不在我的表里就算环境」，这条当场红（那一格正是抄表会漂的那一格）。
    expect(isEnvVerifyCause(undefined)).toBe(false);
    expect(cliBuckets(undefined)).toEqual({ codeBeats: 1, blockedBeats: 0, envBeats: 0 });
    expect(choiceBuckets(undefined)).toEqual({ failures: 1, blocked: 0, env: 0 });
  });

  it("绿拍哪一档都不进（否则分档会变成「每拍必得一个读数」）", () => {
    const c = projectSession([beat({ ok: true })]);
    expect([c.verifyFailures, c.verifyBlocked, c.verifyEnv]).toEqual([0, 0, 0]);
    expect(c.verifyPasses).toBe(1);
  });
});

describe("③ 环境红（toolchain-missing 那类）：进环境档，不污染红档", () => {
  it("CLI：toolchain-missing 只加 envBeats", () => {
    expect(cliBuckets("toolchain-missing")).toEqual({ codeBeats: 0, blockedBeats: 0, envBeats: 1 });
  });

  it("tool-choice：toolchain-missing 只加 verifyEnv", () => {
    expect(choiceBuckets("toolchain-missing")).toEqual({ failures: 0, blocked: 0, env: 1 });
  });

  it("其余五种环境 cause 一样不进红档（timeout／no-surface／hook-error／pkg-manager／not-run）", () => {
    for (const cause of ["timeout", "no-surface", "hook-error", "pkg-manager", "not-run"] as VerifyCause[]) {
      expect(cliBuckets(cause).codeBeats, `CLI 把 ${cause} 记成了代码红`).toBe(0);
      expect(cliBuckets(cause).envBeats, `${cause} 该在环境档`).toBe(1);
      expect(choiceBuckets(cause).failures, `tool-choice 把 ${cause} 记成了 verifyFailures`).toBe(0);
      expect(choiceBuckets(cause).env, `${cause} 该在环境档`).toBe(1);
    }
  });

  it("多拍混合：三档各自数自己的那几拍，互不串档", () => {
    const evs: AgentEvent[] = [
      beat({ ok: false, cause: "code" }), beat({ ok: false }), beat({ ok: false, cause: "skipped" }),
      beat({ ok: false, cause: "toolchain-missing" }), beat({ ok: false, cause: "timeout" }),
      beat({ ok: true }),
    ];
    const c = projectSession(evs);
    expect(c.verifyFailures).toBe(2);   // code + 未归因
    expect(c.verifyBlocked).toBe(1);
    expect(c.verifyEnv).toBe(2);
    expect(c.verifyPasses).toBe(1);
    expect(projectToolChoice([evs]).verification).toMatchObject({ failures: 2, blocked: 1, env: 2, passes: 1 });
  });
});

describe("④ 判据同源：两个面的归档必须由那一只谓词说了算", () => {
  it("逐种 cause：CLI 档 ≡ 谓词 ≡ tool-choice 档（抄第二份表的那一格会在这里红）", () => {
    for (const cause of ALL_CAUSES) {
      const env = isEnvVerifyCause(cause);
      const t = cliBuckets(cause);
      const c = choiceBuckets(cause);
      // 红档 ⇔ !env（两边同一判据，不看 cause 名字表）
      expect(t.codeBeats === 1, `CLI：cause=${String(cause)} 的红档归档与谓词不一致`).toBe(!env);
      expect(c.failures === 1, `tool-choice：cause=${String(cause)} 的红档归档与谓词不一致`).toBe(!env);
      // 非红的那拍必落且只落一档（三档互斥且穷尽 ⇒ 没有哪一拍会被数两遍或漏掉）
      const others = [t.blockedBeats, t.envBeats];
      expect(others.filter((n) => n > 0).length, "CLI：一拍落进了两档或没落档").toBe(env ? 1 : 0);
      const others2 = [c.blocked, c.env];
      expect(others2.filter((n) => n > 0).length, "tool-choice：一拍落进了两档或没落档").toBe(env ? 1 : 0);
    }
  });

  it("两处都不再出现「ok:false 直接计红」的写法（剥注释后的代码文本）", () => {
    const cli = codeOf("src/cli.ts");
    const choice = codeOf("src/agent/tool-choice.ts");
    // 旧形状①：事件位上把任何 ok:false 一律置红。
    expect(cli, "cli.ts 仍在把 ok:false 直接置红").not.toContain("tally.verifyRed = true");
    // 旧形状②：verify 分支里无条件 `else out.verifyFailures++`。
    expect(choice, "tool-choice.ts 仍在把 ok:false 直接计进 verifyFailures").not.toContain("} else out.verifyFailures++;");
    // 接线必须在：两处都调用那一只谓词（行为面已证其效，这里只钉"接线没被摘回去"）。
    expect(cli).toContain("isEnvVerifyCause");
    expect(choice).toContain("isEnvVerifyCause");
    expect(cli).toContain("tallyVerifyBeat(verifyBeats, e.cause)");
  });

  it("两处都不抄第二份环境 cause 表（环境档的界只能来自谓词）", () => {
    const cli = codeOf("src/cli.ts");
    const choice = codeOf("src/agent/tool-choice.ts");
    // 带引号的 cause 名字才是"表"；散文里提名字不算（所以上面先剥注释）。
    // 唯一允许的具名是 `skipped`，那是红档**之外**的贴标签，不参与红/不红的界。
    for (const rel of [["src/cli.ts", cli], ["src/agent/tool-choice.ts", choice]] as const) {
      for (const name of ["toolchain-missing", "no-surface", "pkg-manager", "hook-error", "not-run"]) {
        expect(rel[1], `${rel[0]} 里出现了 "${name}" 的字面量＝抄了第二份表`).not.toContain(`"${name}"`);
      }
    }
  });

  it("CLI 事件那一站的调用点把 cause **原样透传**（写死任何一枚都算接线断了）", () => {
    // 为什么这一格只能用剥注释后的代码文本：`tallyVerifyBeat` 那只纯函数在判卷里被直接喂 cause，
    // 而 CLI 的调用点住在交互事件泵里（`runCli` 内部），从判卷够不到——**行为侧够不到的格子要由接线证人守着**，
    // 不许假装它已被行为判卷覆盖（本仓的「第 4 形态」：用例存在≠那一支被喂到）。
    const src = codeOf("src/cli.ts");
    const calls = [...src.matchAll(/tallyVerifyBeat\(\s*verifyBeats\s*,\s*([^)]+?)\)/g)].map((m) => m[1]!.trim());
    expect(calls.length, "CLI 里没有 tallyVerifyBeat 的调用点了 ⇒ 分档根本没接进收尾账").toBeGreaterThan(0);
    for (const arg of calls) {
      expect(arg, "调用点把 cause 写死成字面量 ⇒ 归因又被抹平，环境／被拒拍重新长得像代码红").toBe("e.cause");
    }
  });

  it("喂 ok:false 的拍进事件面：被拒／环境必须**不**计数（行为侧的反向，不是只钉字符串）", () => {
    // 这条与上一条配对：上一条是"写法没了"，这一条是"没了之后确实不数"。
    // 把 `!isEnvVerifyCause(...)` 那半边摘掉（退回旧写法）⇒ 这里立刻红。
    const c = projectSession([beat({ ok: false, cause: "skipped" }), beat({ ok: false, cause: "timeout" })]);
    expect(c.verifyFailures, "被拒／环境拍又被数进红档").toBe(0);
    const t = freshTally();
    tallyVerifyBeat(t, "skipped");
    tallyVerifyBeat(t, "toolchain-missing");
    expect(t.codeBeats, "被拒／环境拍又被数进红档").toBe(0);
  });
});

describe("⑤ 印面：分档必须说得出「红 X／被拒 Y／环境 Z」", () => {
  it("CLI 收尾行把三档分开印出来（不是只活在内存里）", () => {
    const line = formatVerifyBeats({ codeBeats: 1, blockedBeats: 2, envBeats: 3 });
    expect(line).toContain("红 1");
    expect(line).toContain("被拒 2");
    expect(line).toContain("环境 3");
    expect(line).toContain("验证未通过 6 拍");
  });

  it("反向：一拍都没红 ⇒ 不印这一行（没跑过验证不该有一条关于红的读数）", () => {
    expect(formatVerifyBeats(freshTally())).toBeNull();
  });

  it("被拒那一拍印出来不是「红 1」：只印在被拒档", () => {
    const line = formatVerifyBeats(cliBuckets("skipped"));
    expect(line).toContain("红 0");
    expect(line).toContain("被拒 1");
  });

  it("tool-choice 打印面同样分三档（读这屏数的人不必再去猜红是怎么来的）", () => {
    const text = formatToolChoice(projectToolChoice([[beat({ ok: false, cause: "skipped" }), beat({ ok: false, cause: "toolchain-missing" }), beat({ ok: false, cause: "code" })]]));
    expect(text).toContain("失败 1（代码红）");
    expect(text).toContain("被拒 1");
    expect(text).toContain("环境 1");
  });
});

describe("⑥ 退出码契约没被这笔顶松（读数分档 ≠ 改 README 那句定义）", () => {
  const CLEAN = { errorEvents: 0, verifyRed: false, gateBlocks: 0, deniedPlans: 0, plainToolFailures: 0 };

  it("既有的五字段形状照旧放行（全零 ⇒ 不判红）", () => {
    expect(runFailed(CLEAN)).toBe(false);
  });

  it("被拒／环境拍仍让本轮 exit 1：分档只把「红在哪一格」说清楚，不把它改成 0", () => {
    expect(runFailed({ ...CLEAN, verifyBlockedBeats: 1 })).toBe(true);
    expect(runFailed({ ...CLEAN, verifyEnvBeats: 1 })).toBe(true);
    // 反向对照：两档都是 0 时这两条不成立（否则上面是恒真的「什么都判红」）。
    expect(runFailed({ ...CLEAN, verifyBlockedBeats: 0, verifyEnvBeats: 0 })).toBe(false);
  });
});
