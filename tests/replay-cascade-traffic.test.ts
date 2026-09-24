// 新复跑面 `replay:cascade-traffic` 的观察着（规则 80：producer 与 consumer 是两格，只写脚本＝没人观测）。
//
// 为什么必须有这一格：这条读数的**产品含义是负向的**（"零流量 ⇒ 不改 orchestrator 的升档调用点"）。
// 负向结论最容易被一把瞎尺造出来——`routing_decision=0` 同时兼容
// 「这条路径没上场」「事件名换了」「脚本压根没跑」（本仓同一周内踩过第三、第四种，见规则 140/144）。
// 所以这里钉四件事：尺自己可信（自检全过）、零流量必须判"不可测"而不是"没花钱"、
// 有流量必须判"该量"并给出占比、结构栏必须吃**仓内唯一谓词**而不是本地抄一份集合。
import { describe, expect, it } from "vitest";
import { scanStreamTraffic, selfCheck, trafficVerdict, type StreamTraffic } from "../scripts/replay/cascade-traffic";

const ZERO: StreamTraffic = {
  decisions: 0, upgradeReasons: 0, cascadeBroadcasts: 0,
  redBeats: 0, envRedBeats: 0, causeFieldRedBeats: 0,
};

describe("replay:cascade-traffic 的判据", () => {
  it("每次跑都注入的合成对照必须全过（「0 条升档」也兼容「尺是瞎的」，这条就是拦那个）", () => {
    expect(selfCheck(), "自检问题清单必须为空，否则读数不作数").toEqual([]);
  });

  it("零流量判「不可测」——不许把它读成「环境红没白花钱」", () => {
    const v = trafficVerdict(ZERO, 20, true);
    expect(v).toContain("不可测");
    expect(v).toContain("反转条件");
    expect(v).not.toContain("该量");
  });

  it("有升档判「该量」，并把环境因占比按红拍算出来", () => {
    const t: StreamTraffic = { ...ZERO, decisions: 3, upgradeReasons: 2, cascadeBroadcasts: 2, redBeats: 4, envRedBeats: 1 };
    const v = trafficVerdict(t, 20, true);
    expect(v).toContain("该量");
    expect(v).toContain("0.25");
  });

  it("没有语料可读时同样判「不可测」，且理由句来自取料面而不是猜", () => {
    const v = trafficVerdict(ZERO, 0, false);
    expect(v).toContain("不可测");
    expect(v).toContain("没有任何语料可读");
  });

  it("结构栏吃 shipped 谓词：仓内环境因集合新增一项，本面立刻跟着算（不是本地那份表说了算）", () => {
    // `no-surface` 在 isEnvVerifyCause 的集合里；只认本地字符串表的话这一拍会被读成代码红。
    const beat = scanStreamTraffic([
      { type: "verify_result", ok: false, results: [{ command: "(none)", ok: false, output: "", cause: "no-surface" }] },
    ]);
    expect(beat.redBeats).toBe(1);
    expect(beat.envRedBeats, "cause 在 shipped 环境因集合里 ⇒ 必须算环境").toBe(1);
    // 反向格：cause 缺席 = 未归因，不许被算成环境（那会把"没尺"读成"环境红"）
    const unattr = scanStreamTraffic([
      { type: "verify_result", ok: false, results: [{ command: "pnpm test", ok: false, output: "FAIL: 1 failed" }] },
    ]);
    expect(unattr.redBeats).toBe(1);
    expect(unattr.envRedBeats, "未归因不得并进环境").toBe(0);
  });

  it("播报面单独成立：路由表没开时，[cascade] 那条 agent_message 仍是观察着", () => {
    const t = scanStreamTraffic([
      { type: "agent_message", kind: "progress", text: "[cascade] stage 2（implement，small 档）客观判据未绿 → 升档重跑：medium→large" },
    ]);
    expect(t.decisions, "routing 事件可以没有（路由表关着）").toBe(0);
    expect(t.cascadeBroadcasts, "但升档播报必须抓到，否则零流量会被误判成没上场").toBe(1);
    expect(trafficVerdict({ ...ZERO, cascadeBroadcasts: 1 }, 5, true)).toContain("该量");
  });
});
