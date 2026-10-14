// M5 效果面采样器的观察着（规则 80：producer 与 consumer 是两格，只写脚本＝没人观测）。
//
// 这条面钉的不是「两个采样器算得对」（那在 `tests/acceptance-sampler.test.ts`），
// 而是**它印出来的数能不能被信**：自检必须能抓住坏尺、三态不许把不可测折成 0%、
// 池化口径必须是池化而不是按文件取均值、以及「路由没上场」与「漏记」必须长成两个样子。
// 最后一条是这一族最贵的一次教训：`routing_decision` 曾是 spawn 事件上的一个**字段**，
// 而生产侧它是**独立事件**（按 `agent_id` 一对一）——那把尺在真实语料上恒读 0，
// 读出来的是形状错，不是「路由没上场」。
import { describe, expect, it } from "vitest";
import {
  HEAL_TARGET_PCT,
  coverLine,
  healLine,
  samplerVerdict,
  scanSamplerFace,
  selfCheck,
  type FaceTotals,
} from "../scripts/replay/effect-sampler";
import { REPLAY_READINGS } from "../scripts/replay-readings";

const pool = (hits: number, total: number) => ({ hits, total, unmeasurable: total === 0 });

const base = (over: Partial<FaceTotals> = {}): FaceTotals => ({
  files: 3, heal: pool(0, 0), cover: pool(0, 0), decisions: 0, spawns: 0, ...over,
});

describe("replay:effect-sampler 的判据", () => {
  it("每次跑都注入的合成对照必须全过（「读数 0%」也兼容「尺是瞎的」，这条就是拦那个）", () => {
    expect(selfCheck(), "自检问题清单必须为空，否则读数不作数").toEqual([]);
  });

  it("自检有牙：把 join 键换回「spawn 上的字段」，它必须自己喊红而不是接着印数", () => {
    // 反向验证走的是已登记的另一半（acceptance-sampler 的用例）；这里只钉「自检非恒空」：
    // 拿一份喂进去必然违反 ③ 的输入形状，看它点名。
    const bad = scanSamplerFace([
      [{ type: "agent_spawned", agent_id: "w1", mode: "read", task: "t" }],
    ]);
    expect(bad.cover.total).toBe(1);
    expect(bad.cover.hits, "没有 decision 事件的 spawn ⇒ 分子 0（分母仍要在，这是可测的 0%）").toBe(0);
    expect(bad.cover.unmeasurable).toBe(false);
  });

  it("三态：没有语料 ⇒ 不可测，且不许读成「两格都是 0%」", () => {
    const v = samplerVerdict(base(), false);
    expect(v).toContain("不可测");
    expect(v).toContain("没有尺");
    expect(v).not.toContain("0%");
  });

  it("三态：两格都没分母 ⇒ 不可测（反转条件写进理由里）", () => {
    const v = samplerVerdict(base({ files: 3 }), true);
    expect(v).toContain("不可测");
    expect(v).toContain("反转条件");
    expect(v).not.toContain("0%");
  });

  it("一格有分母就整体该量（另一格不可测不许把整体拖成不可测）", () => {
    const v = samplerVerdict(base({ heal: pool(5, 17) }), true);
    expect(v).toContain("该量");
    expect(v).toContain("自愈率 29%");
    expect(v).toContain("覆盖率不可测");
  });

  it("池化不取均值：两个文件的读数按 hit/total 合并，不是两个百分比求平均", () => {
    // 文件一：一轮里红后转绿 ⇒ 1/1。文件二：同一轮里连红三次（没有后续绿灯）⇒ 仍是 0/1 一个分母。
    // 分母按「出过红灯的轮」计，不按红拍数计：连红三次只说明这一轮修得慢，不是三个独立的失败轮。
    const f1 = [
      { type: "user_message", content: "a" },
      { type: "verify_result", ok: false, attempt: 1, maxAttempts: 3, results: [] },
      { type: "verify_result", ok: true, attempt: 1, maxAttempts: 3, results: [] },
    ];
    const f2 = [
      { type: "user_message", content: "b" },
      { type: "verify_result", ok: false, attempt: 1, maxAttempts: 3, results: [] },
      { type: "verify_result", ok: false, attempt: 2, maxAttempts: 3, results: [] },
      { type: "verify_result", ok: false, attempt: 3, maxAttempts: 3, results: [] },
    ];
    const one = scanSamplerFace([f1]);
    expect(one.heal).toEqual(pool(1, 1));
    const both = scanSamplerFace([f1, f2]);
    // 池化 = 1/2 = 50%；按文件取均值 = (100% + 0%)/2 = 50% —— 恰好一样，所以再补一个 2 轮的文件把它们分开。
    const twoRound = [
      { type: "user_message", content: "c" },
      { type: "verify_result", ok: false, attempt: 1, maxAttempts: 3, results: [] },
      { type: "verify_result", ok: true, attempt: 1, maxAttempts: 3, results: [] },
      { type: "user_message", content: "c2" },
      { type: "verify_result", ok: false, attempt: 1, maxAttempts: 3, results: [] },
    ];
    // 第三个文件是两轮：一轮红后绿（自愈）、一轮红到底 ⇒ 1/2。
    // 池化 = (1+0+1)/(1+1+2) = 2/4 = 50%，而文件级均值 = (100% + 0% + 50%)/3 = 50% —— 又撞上了。
    // 所以真正把它们分开的是**第四个**文件（三轮：只自愈了一轮 ⇒ 1/3）：
    const manyRound = [
      { type: "user_message", content: "d" },
      { type: "verify_result", ok: false, attempt: 1, maxAttempts: 3, results: [] },
      { type: "verify_result", ok: true, attempt: 1, maxAttempts: 3, results: [] },
      { type: "user_message", content: "d2" },
      { type: "verify_result", ok: false, attempt: 1, maxAttempts: 3, results: [] },
      { type: "user_message", content: "d3" },
      { type: "verify_result", ok: false, attempt: 1, maxAttempts: 3, results: [] },
    ];
    const four = scanSamplerFace([f1, f2, twoRound, manyRound]);
    // 池化 = (1+0+1+1)/(1+1+2+3) = 3/7 = 43%；文件级均值 = (100 + 0 + 50 + 33)/4 = 46% ⇒ 分得开。
    expect(four.heal, "池化按 hit/total 合并，不是四个文件百分比求平均").toEqual(pool(3, 7));
    expect(healLine(four)).toBe("review-fail 自愈率：3/7 = 43%（M5 目标 ≥50% ⇒ 未达成）");
  });

  it("覆盖率 0% 必须说清是「路由没上场」还是「漏记」（两种成因的修法相反）", () => {
    const off = base({ cover: pool(0, 4), decisions: 0, spawns: 4 });
    expect(coverLine(off)).toContain("路由没上场");
    expect(coverLine(off)).toContain("不是「上场了却漏记」");
    const on = base({ cover: pool(0, 4), decisions: 6, spawns: 4 });
    expect(coverLine(on), "有决策事件却仍读 0 ⇒ 这是漏记，警告句必须消失").not.toContain("路由没上场");
  });

  it("M5 目标对照随读数翻转（50% 是分界，不是一句注释）", () => {
    // 分界 inclusive：恰好 50% 算达成（≥）。
    expect(healLine(base({ heal: pool(1, 2) }))).toContain("50%");
    expect(healLine(base({ heal: pool(1, 2) }))).toContain("达成");
    expect(healLine(base({ heal: pool(8, 17) })), "47% 差 3 个百分点 ⇒ 未达成").toContain("未达成");
    expect(healLine(base({ heal: pool(8, 17) }))).toContain("47%");
    expect(HEAL_TARGET_PCT).toBe(50);
  });

  it("不可测那两行不印百分比（门与台账共用一个写法）", () => {
    const t = base();
    expect(healLine(t)).toContain("不可测");
    expect(healLine(t)).not.toContain("0%");
    expect(coverLine(t)).toContain("不可测");
    expect(coverLine(t)).not.toContain("0%");
  });

  it("登记面：`replay:effect-sampler` 在登记表里且脚本真的在盘上", () => {
    const r = REPLAY_READINGS.find((x) => x.id === "effect-sampler");
    expect(r, "未登记的复跑面 = 没人吃它（规则 80）").toBeDefined();
    expect(r?.script).toBe("scripts/replay/effect-sampler.ts");
  });
});
