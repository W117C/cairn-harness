// `replay:verify-cause-mix` 的 **exec 面**判卷：一次 shell 红拍到底能被机器说出多少。
//
// 为什么单独钉：#24 把 `exitCode`/`timedOut` 接进事件流之后，"这条红不是模型写错了代码"
// 第一次有了结构证人——但一把没有判卷的尺等于没有尺（规则 217：尺与针脚同笔）。这里钉四件事：
//  ⑴ **分母只数 shell 家族**，且家族名单挂产品的 `SHELL_FAMILY` 而不在此另抄（第十三族老形状）；
//  ⑵ **join 不上的不许当没有**（09-21 那片零假读数的入口就是这里丢的）；
//  ⑶ 结构七态各一格，其中 `no-exit-code` 是本尺**比产品谓词多**的一格——两半都钉住，
//     将来谓词若补上这一态，这条用例立刻红着提醒收敛成一处；
//  ⑷ 文案栏**只认行首**：被跑的命令自己说「[exit code: 127]」不算它发生过（规则 264）。
import { describe, expect, it } from "vitest";
import { classifyVerifyFailure } from "../src/agent/verify";
import { SHELL_FAMILY } from "../src/permissions/risk";
import {
  datingVerdict, execFieldShipDate, execMixOf, execStructKind, execTextKind,
  EXEC_ATTRIBUTABLE,
} from "../scripts/replay/verify-cause-mix";

const call = (id: string, name: string): unknown => ({ type: "tool_call", id, name, args: {} });
const result = (callId: string, extra: Record<string, unknown> = {}): unknown => ({
  type: "tool_result", callId, ok: false, output: "boom", ...extra,
});

describe("exec 面的分母：只数 shell 家族，join 不上不丢", () => {
  it("家族里每个成员的红拍都进分母（名单挂 SHELL_FAMILY，不在此另抄）", () => {
    const ids = [...SHELL_FAMILY];
    const raws = ids.flatMap((name, i) => [call(`c${String(i)}`, name), result(`c${String(i)}`)]);
    const t = execMixOf(raws);
    expect(t.shellBeats).toBe(ids.length);
    expect(t.shellRed).toBe(ids.length);
    expect([...t.byTool.keys()].sort()).toEqual([...ids].sort());
  });

  it("非 shell 的红拍（read_file／edit_file）绝不进分母，哪怕它带着 127", () => {
    const raws = [
      call("a", "read_file"), result("a", { exitCode: 127, timedOut: false }),
      call("b", "edit_file"), result("b", { exitCode: 127, timedOut: false }),
      call("c", "run_shell"), result("c", { exitCode: 127, timedOut: false }),
    ];
    const t = execMixOf(raws);
    expect(t.shellRed).toBe(1);
    expect(t.attributable).toBe(1);
    expect(t.struct.get("toolchain-missing")).toBe(1);
  });

  it("绿拍不进红拍分母；join 不上的单独计数，两边都不当没有", () => {
    const raws = [
      call("g", "run_shell"), { type: "tool_result", callId: "g", ok: true, output: "ok" },
      result("ghost"), // harness 注入拍（diff / worktree 清理 / worker 回传）真就是这个形状
    ];
    const t = execMixOf(raws);
    expect(t.shellRed).toBe(0);
    expect(t.shellBeats).toBe(1); // 只有那一条绿拍算 shell 拍
    expect(t.unmatched).toBe(1);
  });

  it("join 键只认 tool_call：同 id 的审批事件（也带 id）不许把工具名覆成空", () => {
    const raws = [
      call("c1", "run_shell"), result("c1", { exitCode: 1, timedOut: false }),
      { type: "approval_resolved", id: "c1", decision: "approved" }, // 真流里 id 是字符串，两族共用一张表
    ];
    const t = execMixOf(raws);
    expect(t.shellRed).toBe(1);
    expect(t.attributable).toBe(1);
  });
});

describe("exec 面的结构栏：读不到与没问题不许同形", () => {
  it.each([
    ["no-structure", { output: "x" }],
    ["half-structure", { exitCode: 1 }],
    ["half-structure", { timedOut: false }],
    ["timeout", { exitCode: null, timedOut: true }],
    ["toolchain-missing", { exitCode: 127, timedOut: false }],
    ["code", { exitCode: 1, timedOut: false }],
    ["not-run", { exitCode: null, timedOut: false }],
  ] as const)("%s ⇐ 字段 %j", (want, fields) => {
    expect(execStructKind({ output: "x", ...fields })).toBe(want);
  });

  it("pkg-manager 仍由产品那一只谓词说（同正则同枚举，不在读数里另写一份）", () => {
    expect(execStructKind({ exitCode: 1, timedOut: false, output: "nothing\n[ERR_PNPM_IGNORED_BUILDS] ignored" }))
      .toBe("pkg-manager");
  });

  it("第 217 页的双向钉兑现了：这一态两边同形（尺不再自己判）", () => {
    const f = { timedOut: false, exitCode: null as number | null, output: "x" };
    expect(classifyVerifyFailure(f)).toBe("not-run"); // 产品谓词（#39 补上的一态）
    expect(execStructKind(f)).toBe("not-run"); // 读数面跟着走，不再有"本尺多一格"
  });

  it("读不到的三类绝不在「可归因」名单里（否则「读不到」被读成「量到了」）", () => {
    expect(EXEC_ATTRIBUTABLE).not.toContain("no-structure");
    expect(EXEC_ATTRIBUTABLE).not.toContain("half-structure");
  });

  it("占比分子＝正证五类，且环境类是它的子集", () => {
    const raws = [
      call("a", "run_shell"), result("a", { exitCode: 1, timedOut: false }),
      call("b", "run_shell"), result("b", { exitCode: 127, timedOut: false }),
      call("c", "run_shell"), result("c", { exitCode: null, timedOut: true }),
      call("d", "run_shell"), result("d", {}), // 旧日志：读不到
      // #39 之后 `not-run` 也进分子：它是字段**明说**过的（exitCode:null + timedOut:false），
      // 不是「别都不是所以猜它是」。这一拍不进分母的话，「取消」就在占比里静默算模型的头。
      call("e", "run_shell"), result("e", { exitCode: null, timedOut: false }),
    ];
    const t = execMixOf(raws);
    expect(t.shellRed).toBe(5);
    expect(t.withStructure).toBe(4);
    expect(t.attributable).toBe(4);
    expect(t.environmental).toBe(3); // 127 ＋ 超时 ＋ not-run（三处出口都按「别照它改代码」记）
  });
});

describe("exec 面的文案栏：只认行首", () => {
  it.each([
    ["[permission denied] run_shell 在 auto 档被门拒绝", "denied-by-gate"],
    ["[read-only] 只读 bash 静态过滤拒绝：rm 不在只读白名单", "denied-by-readonly-filter"],
    ["out\n[error: run_shell 超时（60s），已强制终止]", "timeout"],
    ["out\n[error: run_shell 随会话取消终止]", "cancelled"],
    ["run_shell: spawn ENOENT", "spawn-error"],
    ["node is not recognized\n[exit code: 127]", "toolchain-missing"],
    ["killed\n[exit code: null]", "killed-no-exit-code"],
    ["[ERR_PNPM_BAD_PID] bad", "pkg-manager"],
  ] as const)("行首线索 %s ⇒ %s", (output, want) => {
    expect(execTextKind(output)).toBe(want);
  });

  it("同一段文字缩进／引用在正文中间 ⇒ 不许算线索（被度量者的正文是第二个注入面）", () => {
    expect(execTextKind("文档里写着：见 [exit code: 127] 一节")).toBe("code-or-unknown");
    expect(execTextKind("  示例：[permission denied] 是这么印的")).toBe("code-or-unknown");
  });
});

describe("两半共用一只年龄判据：exec 面换名词，verify 面逐字不变", () => {
  const SHIP = { sha: "9e2f15c", ms: 1_700_000_000_000 };

  it("默认名词 ⇒ 与显式传「cause」逐字同一（这里不抄句子：抄来的散文句子在本仓是「顶包候选」）", () => {
    const cases: readonly [number, number, { sha: string; ms: number }, number][] = [
      [0, SHIP.ms - 1, SHIP, 3], [1, SHIP.ms, SHIP, 3], [0, SHIP.ms, { sha: "", ms: 0 }, 3], [0, SHIP.ms + 1, SHIP, 3],
    ];
    for (const [withField, age, ship, red] of cases) {
      // 四态各比一次：默认值哪天被改掉，这一格红；而措辞由 `replay-verify-cause-dating` 那份钉（一处一份，不重复钉）
      expect(datingVerdict(withField, age, ship, red).reason)
        .toBe(datingVerdict(withField, age, ship, red, "cause").reason);
    }
    expect(datingVerdict(0, SHIP.ms - 1, SHIP, 3).reason).toContain("语料最新事件早于 cause 落盘");
  });

  it("显式名词 ⇒ 同一格说 exec 面的字段名，且状态不变", () => {
    const d = datingVerdict(0, SHIP.ms - 1, SHIP, 5, "exitCode/timedOut 结构字段");
    expect(d.state).toBe("older-than-ship");
    expect(d.reason).toContain("exitCode/timedOut 结构字段");
  });
});

describe("落盘日期读不到时必须报「没尺」", () => {
  it("cwd 不存在 ⇒ {sha:'',ms:0}，绝不静默当成「年龄解释成立」", () => {
    expect(execFieldShipDate("/nonexistent-dsh-repo-root")).toEqual({ sha: "", ms: 0 });
  });
});

/* ── 第 225 页（#40）：「根本没走到 exec」从此是一列。真料里那一列恒 0（语料 2026-09-20，早于该列上线），
      所以分辨力只能由合成输入钉——这与规则 307 同一课：改动在前置闸之后时，真料 A/B 必然零差。 ── */
describe("硬闸那一列的读数：两只分母各数各的", () => {
  it("被闸拦的红拍按 `blockedBy` 计数，非 shell 家族的那条只进全量口径", () => {
    const t = execMixOf([
      call("a", "run_shell"), result("a", { blockedBy: "permission" }),
      call("b", "run_shell"), result("b", { output: "boom" }),
      call("c", "write_file"), result("c", { blockedBy: "tool-table" }),
    ]);
    expect(t.blockedAll).toBe(2);
    expect(t.blockedShellNoStruct).toBe(1); // 只数 shell 家族且无结构字段的那条：⚠️ 那格的成因②
    expect([...t.blockedMix.entries()].sort()).toEqual([["permission", 1], ["tool-table", 1]]);
  });

  it("带着结构字段的那条不算「没走到 exec」——有退出码就是真跑过，哪怕它同时印了闸", () => {
    const t = execMixOf([call("a", "run_shell"), result("a", { blockedBy: "permission", exitCode: 1, timedOut: false })]);
    expect(t.blockedAll).toBe(1);
    expect(t.blockedShellNoStruct).toBe(0);
  });

  it("没有这一列的旧事件读成 0 而不是 undefined（缺席要能印出来，规则 261）", () => {
    const t = execMixOf([call("a", "run_shell"), result("a")]);
    expect(t.blockedAll).toBe(0);
    expect(t.blockedShellNoStruct).toBe(0);
    expect(t.blockedMix.size).toBe(0);
  });
});
