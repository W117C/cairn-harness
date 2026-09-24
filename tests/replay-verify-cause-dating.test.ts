// `replay:verify-cause-mix` 的「语料年龄」判据：那个「带 cause 的红命令 = 0」到底是什么意思。
//
// 为什么单独钉：这条读数过去只印一个 0，于是它同时兼容两种相反的结论——
// ① 语料比 `cause` 落盘（`9499a9f`，2026-09-23）还老 = 数据年龄；
// ② 归因路径根本没落地 = 缺陷。本仓栽过的那类「拿 0 当证据」（规则 104/119/141）就是没把这两态分开。
// 现在分开的是**函数**，四态各一格；两格「没尺」（无红样本 / 查不到提交）都**不许**读成通过。
import { describe, expect, it } from "vitest";
import { datingVerdict } from "../scripts/replay/verify-cause-mix";

const DAY = 86_400_000;
const SHIP = { sha: "9499a9f", ms: 1_700_000_000_000 };

describe("replay:verify-cause-mix 的语料年龄判据", () => {
  it("有带 cause 的红命令 ⇒ attributed，不再看时间（归因已被观测到）", () => {
    const d = datingVerdict(1, SHIP.ms + 10 * DAY, SHIP, 5);
    expect(d.state).toBe("attributed");
  });

  it("红样本为 0 ⇒ 不可测：既不报「环境红为 0」也不报「归因失效」", () => {
    const d = datingVerdict(0, SHIP.ms + 10 * DAY, SHIP, 0);
    expect(d.state).toBe("unmeasurable");
    expect(d.reason).toContain("没有红样本");
  });

  it("语料最新事件早于落盘提交 ⇒ 那个 0 是数据年龄（今日实跑即此格）", () => {
    const d = datingVerdict(0, SHIP.ms - DAY, SHIP, 3);
    expect(d.state).toBe("older-than-ship");
    expect(d.reason).toContain("数据年龄");
    expect(d.reason).toContain(SHIP.sha);
  });

  it("有比落盘更新的流却仍无 cause ⇒ 判「归因没落地」，这才是缺陷那一格", () => {
    const d = datingVerdict(0, SHIP.ms + DAY, SHIP, 3);
    expect(d.state).toBe("newer-but-unattributed");
    expect(d.reason).toContain("归因路径没落地");
  });

  it("查不到落盘提交（git 读失败）⇒ 不许拿「年龄」这个前提替 0 开脱，报不可测", () => {
    const d = datingVerdict(0, SHIP.ms - DAY, { sha: "", ms: 0 }, 3);
    expect(d.state).toBe("unmeasurable");
    expect(d.reason).toContain("没被量过");
  });

  it("边界：事件时间恰好等于提交时间 ⇒ 按「不早于」算（不靠严格小于放过去）", () => {
    expect(datingVerdict(0, SHIP.ms, SHIP, 3).state).toBe("newer-but-unattributed");
  });
});
