/** 无进展检测（能力 14）的单元面。
 *  与门的分工：门判「语料上该报的报了、不该报的一条都没报」，这里判「三只判据本身的边界与
 *  阶梯的分级」——尤其那两个**会把误伤读成前进/把前进读成停滞**的方向。 */
import { it, expect, describe } from "vitest";
import {
  detectAlternatingThrash,
  detectVerifyStagnation,
  judgeNoProgressEvents,
  noProgressLadder,
  normalizeFailureLine,
  verifyBeatsFromEvents,
  verifySignature,
  type VerifyBeat,
} from "../src/agent/no-progress";
import { NO_PROGRESS_RULES, corpusFreezeIntact, ladderRanksFollowMeasurement, normalizationDiscriminates, positivesFire, negativesStaySilent } from "../scripts/no-progress-check";
import { replay } from "../src/events";
import { join } from "node:path";

const beat = (i: number, signature: string, wrote: boolean, ok = false): VerifyBeat => ({
  index: i, attempt: i + 1, maxAttempts: 3, ok, signature, named: [signature], wroteSinceLast: wrote,
});

describe("归一化：同质的两次红要能认出来，异质的不能认错", () => {
  it("数字与长哈希抹平（同一失败换次数/换进程地址仍是同一件）", () => {
    const a = normalizeFailureLine("error: expected 12 to be 34 at 0x7ffd4a2b1c");
    const b = normalizeFailureLine("error:   expected 5 to be 99 at 0x00abc123ff");
    expect(a).toBe(b);
  });

  it("路径必须留着：换了文件的同款报错是**前进**，不是停滞", () => {
    expect(normalizeFailureLine("FAIL tests/a.test.ts")).not.toBe(normalizeFailureLine("FAIL tests/b.test.ts"));
  });

  it("signature 只收失败的那几条命令，且按序稳定（结果顺序抖动不许换签名）", () => {
    const one = verifySignature([{ command: "pnpm test", ok: false, output: "FAIL x\nerror: boom\n" }, { command: "pnpm lint", ok: false, output: "error: bad style\n" }]);
    const two = verifySignature([{ command: "pnpm lint", ok: false, output: "error: bad style\n" }, { command: "pnpm test", ok: false, output: "FAIL x\nerror: boom\n" }]);
    expect(one.signature).toBe(two.signature);
    expect(one.named).toHaveLength(2);
    const green = verifySignature([{ command: "pnpm test", ok: true, output: "1 passed" }]);
    expect(green.signature).toBe("");
  });
});

describe("R1 验证停滞：结论没变且中间没写", () => {
  it("两次同签名、中间无写 ⇒ 报，且证据指得出那件事", () => {
    const v = detectVerifyStagnation([beat(0, "pnpm test#err", false), beat(1, "pnpm test#err", false)]);
    expect(v.stagnant).toBe(true);
    if (v.stagnant) expect(v.evidence).toContain("中间没有任何写入");
  });

  it("中间有成功的写 ⇒ 不报（那是换路子再试，归既有 verify 上限管）", () => {
    expect(detectVerifyStagnation([beat(0, "pnpm test#err", false), beat(1, "pnpm test#err", true)]).stagnant).toBe(false);
  });

  it("绿一次再红 ⇒ 序列被截断（红-绿-红不是「同一条结论连红」）", () => {
    expect(detectVerifyStagnation([beat(0, "a", false), beat(1, "a", false, true), beat(2, "a", false)]).stagnant).toBe(false);
  });

  it("一次红不报（minRepeats=2）；签名空串不算停滞（空 results 是另一种事实）", () => {
    expect(detectVerifyStagnation([beat(0, "a", false)]).stagnant).toBe(false);
    expect(detectVerifyStagnation([beat(0, "", false), beat(1, "", false)]).stagnant).toBe(false);
  });

  it("门槛可配：minRepeats=3 时两次不报、三次报", () => {
    const two = [beat(0, "a", false), beat(1, "a", false)];
    expect(detectVerifyStagnation(two, 3).stagnant).toBe(false);
    expect(detectVerifyStagnation([...two, beat(2, "a", false)], 3).stagnant).toBe(true);
  });

  it("wroteSinceLast 只算写类工具的成功落盘：读文件与失败的写都不算前进", () => {
    const events = [
      { type: "tool_call", id: "c1", name: "read_file", args: {} },
      { type: "tool_result", callId: "c1", ok: true, output: "xx" },
      { type: "tool_call", id: "c2", name: "edit_file", args: {} },
      { type: "tool_result", callId: "c2", ok: false, output: "denied" },
      { type: "verify_result", callId: "v1", ok: false, attempt: 1, maxAttempts: 3, results: [{ command: "t", ok: false, output: "error: x" }] },
      { type: "verify_result", callId: "v2", ok: false, attempt: 2, maxAttempts: 3, results: [{ command: "t", ok: false, output: "error: x" }] },
    ] as unknown as Record<string, unknown>[];
    const beats = verifyBeatsFromEvents(events);
    expect(beats).toHaveLength(2);
    expect(beats[1]!.wroteSinceLast).toBe(false);
    expect(detectVerifyStagnation(beats).stagnant).toBe(true);
  });
});

describe("R3 往返抖动", () => {
  it("A B A B A B 且观察回到原值 ⇒ 报", () => {
    const v = detectAlternatingThrash([
      { action: "a", observation: "1" }, { action: "b", observation: "2" },
      { action: "a", observation: "1" }, { action: "b", observation: "2" },
      { action: "a", observation: "1" }, { action: "b", observation: "2" },
    ]);
    expect(v.thrashing).toBe(true);
    if (v.thrashing) expect(v.evidence).toContain("往返");
  });

  it("观察每次都在变 ⇒ 不报（那是每次结果都不同的真实试错，不是抖动）", () => {
    expect(detectAlternatingThrash([
      { action: "a", observation: "1" }, { action: "b", observation: "2" },
      { action: "a", observation: "3" }, { action: "b", observation: "4" },
      { action: "a", observation: "5" }, { action: "b", observation: "6" },
    ]).thrashing).toBe(false);
  });

  it("同一个动作连打不算往返（那是 stuck.ts 的地盘，不许两处各判一次）", () => {
    expect(detectAlternatingThrash(Array.from({ length: 6 }, () => ({ action: "a", observation: "1" }))).thrashing).toBe(false);
  });
});

describe("阶梯：分级是量出来的，不是感觉出来的", () => {
  const thrashHit = { thrashing: true as const, cycles: 3, evidence: "t" };
  const miss = { thrashing: false as const };

  it("停滞 ⇒ escalate；action-shaped ⇒ directive；只有往返 ⇒ note；全静 ⇒ silent", () => {
    expect(noProgressLadder({ stuck: { stuck: false }, stagnation: detectVerifyStagnation([beat(0, "a", false), beat(1, "a", false)]), thrash: miss }).action).toBe("escalate");
    expect(noProgressLadder({ stuck: { stuck: true, rule: "same_action_error_x3", repeats: 3 }, stagnation: { stagnant: false }, thrash: miss }).action).toBe("directive");
    expect(noProgressLadder({ stuck: { stuck: false }, stagnation: { stagnant: false }, thrash: thrashHit }).action).toBe("note");
    expect(noProgressLadder({ stuck: { stuck: false }, stagnation: { stagnant: false }, thrash: miss }).action).toBe("silent");
  });

  it("rules 里三条都在（合并而非互相覆盖），evidence 里各留了自己的名", () => {
    const v = noProgressLadder({
      stuck: { stuck: true, rule: "same_action_obs_x4", repeats: 4 },
      stagnation: detectVerifyStagnation([beat(0, "a", false), beat(1, "a", false)]),
      thrash: thrashHit,
    });
    expect(v.rules).toEqual(["stuck:same_action_obs_x4", "verify_stagnation", "alternating_thrash"]);
    expect(v.evidence).toContain("同一动作重复");
    expect(v.evidence).toContain("中间没有任何写入");
  });

  it("本模块绝不主动终止：action-shaped 再多次也只到 directive，最高的词只是 escalate", () => {
    // 终止权留在既有 verify 上限与 maxSteps 手上——检测器只出声，不掐。
    const ladderActions = new Set(["silent", "note", "directive", "escalate"]);
    for (const stuck of [{ stuck: false } as const, { stuck: true, rule: "same_action_obs_x4", repeats: 9 } as const]) {
      for (const stagnation of [{ stagnant: false } as const, detectVerifyStagnation([beat(0, "a", false), beat(1, "a", false)])]) {
        for (const thrash of [miss, thrashHit]) {
          const v = noProgressLadder({ stuck, stagnation, thrash });
          expect(ladderActions.has(v.action)).toBe(true);
        }
      }
    }
    // 单靠 action-shaped 永不 escalate（它没被真实语料证明零误报）
    expect(noProgressLadder({ stuck: { stuck: true, rule: "same_action_obs_x4", repeats: 9 }, stagnation: { stagnant: false }, thrash: miss }).action).toBe("directive");
  });
});

describe("真事件流上的整链判读（含误报面）", () => {
  it("真实红录制：报，且证据里点名了那条 pnpm 命令与错误码", async () => {
    const ev = (await replay(join("fixtures", "no-progress", "real-red-verify-stagnation.events.jsonl"))) as unknown as Record<string, unknown>[];
    const v = judgeNoProgressEvents(ev);
    expect(v.action).toBe("escalate");
    expect(v.rules).toContain("verify_stagnation");
    expect(v.evidence).toContain("pnpm run test");
    expect(v.evidence).toContain("ERR_PNPM_UNSAFE_MODULES_DIR");
  });

  it("三条真实成功录制：一条都不报（这就是外部没人公布的那个 precision 数）", async () => {
    for (const f of ["real-green-read-edit-verify", "real-green-long-explore", "real-green-short-run"]) {
      const ev = (await replay(join("fixtures", "no-progress", f + ".events.jsonl"))) as unknown as Record<string, unknown>[];
      const v = judgeNoProgressEvents(ev);
      expect(v.action, f + " 被误报了：" + v.rules.join("+")).toBe("silent");
    }
  });
});

describe("判据自身的分辨力（gate 与测例共用同一只）", () => {
  it("NP1：fire 样本没报 / 报了没指名 / 被别的规则碰巧报了，三种都红", () => {
    const okRow = { file: "x", fired: true, rules: ["verify_stagnation"], evidence: "同一条…", expectedRulePresent: true };
    expect(positivesFire([okRow]).ok).toBe(true);
    expect(positivesFire([{ ...okRow, fired: false }]).ok).toBe(false);
    expect(positivesFire([{ ...okRow, evidence: "  " }]).ok).toBe(false);
    expect(positivesFire([{ ...okRow, expectedRulePresent: false }]).ok).toBe(false);
  });

  it("NP2：误报一条即红；负样本不足 3 条也算红（不许拿「没有对照」当通过）", () => {
    const silent = (f: string) => ({ file: f, fired: false, rules: [], evidence: "", expectedRulePresent: true });
    expect(negativesStaySilent([silent("a"), silent("b"), silent("c")]).ok).toBe(true);
    expect(negativesStaySilent([silent("a"), { ...silent("b"), fired: true }, silent("c")]).ok).toBe(false);
    expect(negativesStaySilent([silent("a"), silent("b")]).ok).toBe(false);
  });

  it("NP3/NP4 的读数在真实现上必须绿（这两条红意味着检测器或分级被改坏）", () => {
    expect(normalizationDiscriminates({ sameFaultNoWrite: true, suppressedByWrite: false, nextFileSameText: false }).ok).toBe(true);
    expect(ladderRanksFollowMeasurement({ both: "escalate", onlyStuck: "directive", onlyThrash: "note", nothing: "silent" }).ok).toBe(true);
    expect(ladderRanksFollowMeasurement({ both: "escalate", onlyStuck: "directive", onlyThrash: "escalate", nothing: "silent" }).ok).toBe(false);
  });

  it("NP5：不在表上的语料文件必须红（翻标签的门路之一）", () => {
    const rels = ["fixtures/no-progress/real-green-short-run.events.jsonl"];
    expect(corpusFreezeIntact({ "other/file": "x" }, rels).ok).toBe(false);
    expect(corpusFreezeIntact({ [rels[0]!]: "abc" }, rels, { [rels[0]!]: "abc" }).ok).toBe(true);
    expect(corpusFreezeIntact({ [rels[0]!]: "abc" }, rels, { [rels[0]!]: "zzz" }).ok).toBe(false);
  });

  it("六条规则全绿（复用门里同一只判据，测例不另搭一套）", async () => {
    for (const rule of NO_PROGRESS_RULES) {
      const v = await rule.run();
      expect(v.ok, rule.id + " 红了：" + v.detail).toBe(true);
    }
  }, 300_000);
});
