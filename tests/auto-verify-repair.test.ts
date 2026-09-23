// 收束闸拍红之后的那一次返修（能力 5 的最后一环，此前在代码里根本不存在）。
//
// 现场（本轮读到，两条都是实跑而不是推测）：
// ① `BLOCKED.md` 裁决 1 写的是「自动拍目前是证据 only——红字上时间线，但**模型看不到**」，
//    并列出三条候选注入通道。那条前提已经过期：`src/agent/context.ts` 在 `verify_result` 分支里
//    就把最后一条**自动且红**的拍投成 `{role:"user", content: autoVerifyNote(...)}`
//    ——正是裁决里第三种「把失败作为显式 harness 轮」的形状，且 `tests/context-auto-verify-note.test.ts`
//    八条在守。**通道早就有了。**
// ② 缺的只是"再要一轮模型"：`src/agent/loop.ts` 收束闸跑完直接 `return`，
//    `tests/loop.test.ts` 里那句断言把这件事写得很明白——`expect(requests).toHaveLength(2)`，
//    注释「证据拍不偷要一轮模型」。所以今天的闭环是 执行→验证(红)→**停**，
//    与 `replay:run-scorecard` 的读数完全对上：全语料 `green-after-rework = 0`，
//    两条红终局之后都没有再改动。返修分支此前不是没测到，是**不存在**。
//
// 这一拍要花真钱（多一次模型请求），所以缺省关（用户裁决 3：花真钱的默认关 + 同批给实测读数），
// 故本文件两侧都钉：开 ⇒ 恰好多一轮且红字真到了模型眼前；关 ⇒ 与今日逐字同形。
// 另两格是防跑飞的闸：**环境红不驱动返修**（装不上工具链的机器上重跑一遍还是 127，
// 那是把 P1-3 归因白做），绿拍不返修。
import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLoop } from "../src/agent/loop";
import type { VerifyHook } from "../src/agent/verify";
import type { AgentEvent, VerifyCause } from "../src/events";
import type { ModelOutput, ProviderMessage } from "../src/providers";
import { scoreStream } from "../scripts/replay/run-scorecard";

const dirs: string[] = [];

/** 按调用次序出拍的钩子（越界重复最后一份）。 */
function sequenceHook(seq: { ok: boolean; cause?: VerifyCause }[]): { hook: VerifyHook; calls: () => number } {
  let i = 0;
  const hook: VerifyHook = {
    async run() {
      const r = seq[Math.min(i, seq.length - 1)]!;
      i++;
      return {
        ok: r.ok,
        results: [{ command: "pnpm test", ok: r.ok, output: r.ok ? "all green" : "FAIL: 1 failed", ...(r.cause ? { cause: r.cause } : {}) }],
      };
    },
  };
  return { hook, calls: () => i };
}

/** 剧本（轮次是死的，便于读）：
 *  1=改盘 → 2=纯文本收工 ⇒ 收束闸拍 → 3=**只在开了返修时才存在**（看到红字后再改一次盘）
 *  → 4=纯文本收工 ⇒ 第二拍重验。
 *  关键：第二拍必须真跑。只让模型"改了就宣布好了"等于用一个新的假绿换掉一个旧的假绿。 */
async function runRepairScript(opts: { autoVerifyRepair?: boolean; afterRed: "writes" | "stops"; seq: { ok: boolean; cause?: VerifyCause }[] }) {
  const home = await mkdtemp(join(tmpdir(), "av-repair-"));
  dirs.push(home);
  const log: AgentEvent[] = [];
  const requests: ProviderMessage[][] = [];
  const { hook, calls } = sequenceHook(opts.seq);
  try {
    await runLoop({
      workspace: home,
      userMessage: "修那个失败的测试",
      mode: "auto",
      interactive: true,
      events: { async append(e) { log.push(e); } },
      tools: {
        write_file: { name: "write_file", async run() { return { ok: true, output: "written" }; } },
      } as never,
      verify: hook,
      autoVerify: true,
      ...(opts.autoVerifyRepair === undefined ? {} : { autoVerifyRepair: opts.autoVerifyRepair }),
      provider: {
        async *stream(messages: ProviderMessage[]) {
          requests.push(messages);
          const n = requests.length;
          let out: ModelOutput;
          if (n === 1) out = { type: "tool_call", id: "w1", name: "write_file", args: { path: "src/a.ts" } };
          else if (n === 3 && opts.afterRed === "writes") out = { type: "tool_call", id: "w2", name: "write_file", args: { path: "src/a.ts" } };
          else out = { type: "assistant_message", content: "改完了。" };
          yield out;
        },
      } as never,
    });
  } finally {
    await rm(home, { recursive: true, force: true }).catch(() => {});
  }
  return { log, requests, beats: () => calls() };
}

describe("收束闸拍红 → 一次有界返修（缺省关）", () => {
  it(
    "开：红拍之后恰好多要一轮模型，且那一轮的上下文里真有那条红字（返修不是靠提示词自觉）",
    { timeout: 120_000 },
    async () => {
      const { log, requests } = await runRepairScript({
        autoVerifyRepair: true,
        afterRed: "writes",
        seq: [{ ok: false, cause: "code" }, { ok: true }],
      });
      // 1=写、2=收工(拍1红)、3=再写、4=收工(拍2绿)
      expect(requests.length, "没多要一轮 ⇒ 返修分支还是不存在").toBe(4);
      const carried = JSON.stringify(requests[2] ?? []);
      expect(carried, "红字没进下一轮上下文 ⇒ 模型看不到失败，返修就是瞎改").toContain("FAIL: 1 failed");
      const beats = log.filter((e) => e.type === "verify_result");
      expect(beats.length, "改完必须重验，只多要一轮不重验就是换个法子造假绿").toBe(2);
      expect(beats[1]?.ok, "第二拍应是绿的").toBe(true);
    },
  );

  it(
    "开：这条轨迹在 y 轴上第一次落进 green-after-rework（此前全语料该档恒 0）",
    { timeout: 120_000 },
    async () => {
      const { log } = await runRepairScript({
        autoVerifyRepair: true,
        afterRed: "writes",
        seq: [{ ok: false, cause: "code" }, { ok: true }],
      });
      const s = scoreStream(log);
      expect(s.outcome).toBe("green-after-rework");
      expect(s.reworkRounds, "一次被后续改动回应的红拍 = 返工 1").toBe(1);
      expect(s.writes).toBe(2);
    },
  );

  it(
    "开的上界：红→改→又红，也只返修一次（第二拍仍红就收束，不许把返修开成循环）",
    { timeout: 120_000 },
    async () => {
      const { requests, beats, log } = await runRepairScript({
        autoVerifyRepair: true,
        afterRed: "writes",
        seq: [{ ok: false, cause: "code" }, { ok: false, cause: "code" }],
      });
      expect(requests).toHaveLength(4);
      expect(beats(), "钩子至多两拍：第二拍红就收束").toBe(2);
      expect(scoreStream(log).outcome).toBe("ended-red");
    },
  );

  it(
    "关（缺省）：与今日逐字同形——只两请求、只一拍、红之后没有任何再改动",
    { timeout: 120_000 },
    async () => {
      const { log, requests, beats } = await runRepairScript({ afterRed: "writes", seq: [{ ok: false, cause: "code" }] });
      expect(requests).toHaveLength(2);
      expect(beats()).toBe(1);
      expect(scoreStream(log).outcome).toBe("ended-red");
    },
  );

  it(
    "环境红不驱动返修：装不上工具链的机器上重跑一遍还是 127，那等于把 P1-3 的归因白做",
    { timeout: 120_000 },
    async () => {
      const { requests, beats } = await runRepairScript({
        autoVerifyRepair: true,
        afterRed: "writes",
        seq: [{ ok: false, cause: "toolchain-missing" }],
      });
      expect(requests).toHaveLength(2);
      expect(beats(), "钩子只该被调一次").toBe(1);
    },
  );

  it(
    "绿拍不返修：验过了还多要一轮就是白付钱",
    { timeout: 120_000 },
    async () => {
      const { requests } = await runRepairScript({ autoVerifyRepair: true, afterRed: "writes", seq: [{ ok: true }] });
      expect(requests).toHaveLength(2);
    },
  );

  it(
    "开了返修但模型第二轮不再改（只回一句「知道了」）⇒ 不再补第三拍，请求数停在 3",
    { timeout: 120_000 },
    async () => {
      const { requests, beats } = await runRepairScript({
        autoVerifyRepair: true,
        afterRed: "stops",
        seq: [{ ok: false, cause: "code" }, { ok: true }],
      });
      expect(requests).toHaveLength(3);
      expect(beats(), "没再改盘就不该重验（重验一遍没动过的代码是纯烧钱）").toBe(1);
    },
  );
});
