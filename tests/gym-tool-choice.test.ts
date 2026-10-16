// P0-c：工具选对率 / 漏拦率靶场读数的判据（离线，纯函数，不联网）。
//
// 这组判据要挡住的是**把代理量当准确率读**——`tool-choice.ts` 开头把那条列为边界①，
// 而它在设计上就很容易被违反：只要让「没声明 expectTools」悄悄按全对算，选对率就永远漂亮。
// 所以「没声明 ⇒ null」必须是被钉住的行为，而不是实现里的巧合。
//
// 也钉住 A/B 的可归因性：case 集不对齐时**不许**出差值。
//
// ⚠️ 这组判据曾经**全是纯函数测试，一条都不跑 CLI** —— 于是 `gym-tool-choice.ts` 的
// flag 白名单漏了 `"ab"`（`--ab` 恒 exit 2、整条 A/B 路从未跑通）这件事，
// 在纯函数层**天然不可见**：那些函数照样全绿。2026-10-04 补了末尾那三条 CLI 契约判据。
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../src/events";
import {
  caseToolChoice, mergeToolChoice, toolChoiceAblation, toolsCalledIn, type CaseToolChoice,
} from "../src/agent/gym/tool-choice";
import { validateExpect } from "../src/agent/gym/case";

const call = (name: string): AgentEvent => ({ type: "tool_call", id: "t" + name, name, args: {} });
const userMsg: AgentEvent = { type: "user_message", content: "T" };
const assistant: AgentEvent = { type: "assistant_message", content: "ok" };

describe("工具选择靶场读数", () => {
  it("抽的是本仓词表 tool_call（不是官方 App 的 tool/call）", () => {
    const { names, count } = toolsCalledIn([userMsg, call("read_file"), assistant, call("edit_file"), call("read_file")]);
    expect(names).toEqual(["edit_file", "read_file"]);   // 去重 + 字典序
    expect(count).toBe(3);                                // 频次不丢
  });

  it("命中/未命中：声明了才判", () => {
    const evts = [userMsg, call("read_file"), call("edit_file")];
    const hit = caseToolChoice("c1", evts, { mustPassVerify: true, mustChangeFiles: [], mustNotChangeFiles: [], expectTools: ["edit_file", "grep"] });
    expect(hit.expectDeclared).toBe(true);
    expect(hit.hits).toEqual(["edit_file"]);
    const miss = caseToolChoice("c1", evts, { mustPassVerify: true, mustChangeFiles: [], mustNotChangeFiles: [], expectTools: ["grep"] });
    expect(miss.hits).toEqual([]);
  });

  it("① 没声明 ⇒ 不进分母，且比率是 null 不是 0 也不是 1", () => {
    const row = caseToolChoice("c1", [userMsg, call("read_file")], {
      mustPassVerify: true, mustChangeFiles: [], mustNotChangeFiles: [],
    });
    expect(row.expectDeclared).toBe(false);
    expect(row.hits).toEqual([]);
    const m = mergeToolChoice([row]);
    expect(m.nDeclared).toBe(0);
    // 这是整组判据的核心：分母 0 时不许给「100% 通过」也不许给「0% 失败」。
    expect(m.hitRate).toBeNull();
  });

  it("①b 全没声明时，合并结果两个比率都是 null", () => {
    const rows = [1, 2, 3].map((i) => caseToolChoice("c" + String(i), [userMsg, call("read_file")], {
      mustPassVerify: true, mustChangeFiles: [], mustNotChangeFiles: [],
    }));
    const m = mergeToolChoice(rows);
    expect(m.nDeclared).toBe(0);
    expect(m.hitRate).toBeNull();
    expect(m.violationRate).toBeNull();
  });

  it("② 比率在合并后才算（分母只数声明过的 case）", () => {
    const rows: CaseToolChoice[] = [
      caseToolChoice("a", [call("edit_file")], { mustPassVerify: true, mustChangeFiles: [], mustNotChangeFiles: [], expectTools: ["edit_file"] }),
      caseToolChoice("b", [call("read_file")], { mustPassVerify: true, mustChangeFiles: [], mustNotChangeFiles: [], expectTools: ["edit_file"] }),
      // 这条没声明，不许混进分母把比率稀释。
      caseToolChoice("c", [call("read_file")], { mustPassVerify: true, mustChangeFiles: [], mustNotChangeFiles: [] }),
    ];
    const m = mergeToolChoice(rows);
    expect(m.nDeclared).toBe(2);
    expect(m.nHit).toBe(1);
    expect(m.hitRate).toBe(0.5);
  });

  it("漏拦率按调用次数算，分母是「声明了禁令的 case 的总调用次数」", () => {
    const rows: CaseToolChoice[] = [
      caseToolChoice("a", [call("run_shell"), call("run_shell"), call("edit_file")], {
        mustPassVerify: true, mustChangeFiles: [], mustNotChangeFiles: [], forbidTools: ["run_shell"],
      }),
      caseToolChoice("b", [call("edit_file")], {
        mustPassVerify: true, mustChangeFiles: [], mustNotChangeFiles: [], forbidTools: ["run_shell"],
      }),
    ];
    const m = mergeToolChoice(rows);
    expect(m.nForbidDeclared).toBe(2);
    expect(m.forbiddenCalls).toBe(1);          // 去重后 run_shell 算 1 件，不是 2 次
    expect(m.totalCalls).toBe(4);
    expect(m.nViolating).toBe(1);
    // 2026-10-04 口径修正：主读数是 **case 级**（1/2 = 0.5），调用级另留一格（1/4 = 0.25）。
    // 旧口径把 0.25 当主读数，实测证明它把「分母在变」读成了「信号在变」。
    expect(m.violationRate).toBe(0.5);
    expect(m.callLevelViolationRate).toBe(0.25);
  });

  it("③ 口径修正的判据：每次都违规时，case 级恒为 1，调用级只反映分母", () => {
    // 这正是实测里踩到的形状：只禁一件工具、每轮必调 ⇒ 调用级比值 = 1/总调用数，
    // 在 6 轮与 12 轮之间会读成「违规率 0.167 vs 0.083」，而真相是**两次都违规**。
    const mk = (id: string, extraCalls: number): CaseToolChoice => caseToolChoice(id,
      [call("edit_file"), call("run_shell"), ...Array.from({ length: extraCalls }, () => call("read_file"))],
      { mustPassVerify: true, mustChangeFiles: [], mustNotChangeFiles: [], forbidTools: ["run_shell"] });
    const short = mergeToolChoice([mk("a", 4)]);    // 6 次调用
    const long = mergeToolChoice([mk("a", 10)]);    // 12 次调用
    expect(short.callLevelViolationRate).toBeCloseTo(1 / 6, 6);
    expect(long.callLevelViolationRate).toBeCloseTo(1 / 12, 6);
    expect(short.callLevelViolationRate).not.toBe(long.callLevelViolationRate);
    // **两个都必须读作「违规了」** —— 这才是主读数要传达的那件事。
    expect(short.violationRate).toBe(1);
    expect(long.violationRate).toBe(1);
  });

  it("③ case 集不对齐时 A/B 不出差值，并说清谁多谁少", () => {
    const mk = (id: string): CaseToolChoice => caseToolChoice(id, [call("edit_file")], {
      mustPassVerify: true, mustChangeFiles: [], mustNotChangeFiles: [], expectTools: ["edit_file"],
    });
    const r = toolChoiceAblation([mk("a"), mk("b")], [mk("a"), mk("z")]);
    expect(r.ok).toBe(false);
    expect(r.why).toContain("b");
    expect(r.why).toContain("z");
    expect(r.hitRateDelta).toBeUndefined();
  });

  it("③b 对齐时可出差值；任一分母为 0 时差值是 null", () => {
    const hit = (id: string, tools: string[]): CaseToolChoice =>
      caseToolChoice(id, tools.map(call), { mustPassVerify: true, mustChangeFiles: [], mustNotChangeFiles: [], expectTools: ["edit_file"] });
    const ok = toolChoiceAblation([hit("a", ["edit_file"]), hit("b", ["read_file"])], [hit("a", ["edit_file"]), hit("b", ["edit_file"])]);
    expect(ok.ok).toBe(true);
    expect(ok.baseline!.hitRate).toBe(0.5);
    expect(ok.ablated!.hitRate).toBe(1);
    expect(ok.hitRateDelta).toBe(0.5);

    const noDecl = (id: string): CaseToolChoice =>
      caseToolChoice(id, [call("edit_file")], { mustPassVerify: true, mustChangeFiles: [], mustNotChangeFiles: [] });
    const nullish = toolChoiceAblation([noDecl("a")], [noDecl("a")]);
    expect(nullish.ok).toBe(true);
    expect(nullish.hitRateDelta).toBeNull();
  });

  it("gym runner 的 omitTools：不传时逐字不变（零回归支）", async () => {
    // P1-b 的 A/B 靠这个参数换面。加参数时最容易犯的错是「不传也走新分支」——
    // 那会让**所有**既有靶场跑的都不再是原来的面，而它们全绿、看不出任何变化。
    const { sessionToolSpecs } = await import("../src/agent/session-provider");
    const base = sessionToolSpecs({ mode: "auto" }).specs;
    // 三种「没给」都要与原面逐字相同：不给 / 给空数组 / 给 undefined。
    // （上一版这里写了 `undefined !== undefined && …` —— 恒假的死代码，
    //   它让第三条断言看着在测什么、实际只测了第一遍。这里改成真的把 undefined 传进去。）
    const withEmpty = sessionToolSpecs({ mode: "auto", omitTools: [] }).specs;
    const withUndefined = sessionToolSpecs({ mode: "auto", omitTools: undefined }).specs;
    expect(JSON.stringify(withEmpty)).toBe(JSON.stringify(base));
    expect(JSON.stringify(withUndefined)).toBe(JSON.stringify(base));
    // 真摘时确实变短（否则上面两条等于什么都没验）
    const pruned = sessionToolSpecs({ mode: "auto", omitTools: ["spawn_agent", "lsp"] }).specs;
    expect(pruned.length).toBeLessThan(base.length);
  });

  it("冻结 case 的 expect.json 仍然通过校验（新增字段是可选的）", () => {
    // 既有四条 case 的 expect.json 全在 frozen-sha256.json 里，**一个字都不能改**。
    // 所以新字段必须可选：这里用一条只有旧字段的形状过一遍 validateExpect。
    expect(() => validateExpect({
      mustPassVerify: true, mustChangeFiles: ["src/math.js"], mustNotChangeFiles: [], maxTurns: 8,
    })).not.toThrow();
    expect(() => validateExpect({
      mustPassVerify: true, mustChangeFiles: ["src/math.js"], mustNotChangeFiles: [], maxTurns: 8,
      expectTools: ["edit_file"], forbidTools: ["run_shell"],
    })).not.toThrow();
  });

  // ── CLI 契约（2026-10-04 新增）────────────────────────────────────────────
  // 加这一组是因为踩到过一次真实事故：`scripts/gym-tool-choice.ts` 第 50 行的
  // 未知参数白名单漏了 `"ab"`，而第 64 行用 `has("--ab")` 读它 ⇒ `--ab` 一律 exit 2。
  // **A/B 那条路从写下来起就没被自己的 CLI 跑通过一次**，却因为拼错 flag 有报错、
  // 没人把「A/B 报未知参数」和「我手上有一批两臂读数」对上，一直没被发现。
  //
  // 上面十条全是纯函数测试，**一条都不跑 CLI** ⇒ 白名单漏项天然逃逸。这就是它能活的原因，
  // 所以这里必须补的是「真的起一次进程」，而不是再断言一个数组。
  //
  // **离线且不花钱**：脚本在 flag 校验之后才查 key，无 key 时打印「暗卷缺席」并 **exit 0**。
  // 所以子进程里**显式删掉** CAIRN_API_KEY —— 一是保证判定与凭据无关，
  // 二是万一哪天校验顺序变了，这条判据不会偷偷变成一次真模型调用（那会让单测既慢又花钱）。
  const spawnCli = (args: string[]) => {
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.CAIRN_API_KEY;
    const r = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/gym-tool-choice.ts", ...args],
      { cwd: resolve(import.meta.dirname, ".."), encoding: "utf8", env },
    );
    return { code: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
  };

  it("④ 头部注释里文档化的每个 flag 都能被 CLI 认（不许出现「未知参数」）", () => {
    // `--ab` 是这条判据的正主：它曾经因漏进白名单而让整条 A/B 路静默失效。
    const ab = spawnCli(["--case", "grep-target", "--ab"]);
    expect(ab.out).not.toContain("未知参数");
    // 无 key ⇒ 显式缺席、exit 0（未证 ≠ 通过，但**不该**是 exit 2）
    expect(ab.code).toBe(0);
    expect(ab.out).toContain("暗卷缺席");

    // 文档化用法里的其余 flag 同样逐个过一遍。
    for (const args of [
      ["--case", "grep-target", "--arm", "full"],
      ["--case", "grep-target", "--arm", "pruned"],
      ["--case", "grep-target", "--arm", "full", "--events", "/tmp"],
    ]) {
      const r = spawnCli(args);
      expect(r.out, `flag 组合 ${args.join(" ")} 被当成未知参数`).not.toContain("未知参数");
    }
  });

  it("④b 边界反验：真的拼错的 flag 仍必须被拒（不许把检查删了换绿）", () => {
    // 只加白名单、不留检查，等于把「不把拼错的 flag 静默当成缺省」这条纪律删了。
    const r = spawnCli(["--case", "grep-target", "--arb"]);
    expect(r.out).toContain("未知参数");
    expect(r.code).toBe(2);
  });

  it("④c 缺 --case 仍报用法（flag 校验没被放宽到什么都不问）", () => {
    const r = spawnCli(["--arm", "full"]);
    expect(r.code).toBe(2);
    expect(r.out).toContain("用法");
  });
});