// 群轮次上下文判卷：带说话人、自己标（你）、预算截断、没历史不加壳。
import { describe, expect, it } from "vitest";
import { composeRoundTask } from "../src/agent/team/round-context";
import type { StreamItem } from "../src/agent/team/stream";

const it_ = (seq: number, kind: StreamItem["kind"], speaker: string, text: string): StreamItem =>
  ({ seq, kind, speaker, round: 1, text, at: null });

describe("群轮次上下文", () => {
  it("把最近几条编进任务书，带说话人、自己标（你）", () => {
    const out = composeRoundTask({
      task: "说说你的结论",
      speaker: "member:m1",
      items: [
        it_(1, "user", "user", "一起看下这个方案"),
        it_(2, "agent", "member:m2", "我觉得先做 A"),
      ],
    });
    expect(out).toContain("【群里最近说过】");
    expect(out).toContain("- user：一起看下这个方案");
    expect(out).toContain("- member:m2：我觉得先做 A");
    expect(out).toContain("【这一轮你要做的】\n说说你的结论");
  });

  it("自己说过的话标（你）", () => {
    const out = composeRoundTask({ task: "继续", speaker: "member:m1", items: [it_(1, "agent", "member:m1", "我先说两句")] });
    expect(out).toContain("- （你）：我先说两句");
  });

  it("没有历史 ⇒ 原样返回（不加壳）", () => {
    expect(composeRoundTask({ task: "干活", speaker: "member:m1", items: [] })).toBe("干活");
    expect(composeRoundTask({ task: "干活", speaker: "member:m1", items: [it_(1, "other", "main", "工具输出")] })).toBe("干活");
  });

  it("只取最近 limit 条；超预算时保留靠后的（最近的话优先）", () => {
    const many = Array.from({ length: 10 }, (_, i) => it_(i + 1, "agent", "member:m2", `第${i + 1}句`));
    const out = composeRoundTask({ task: "t", speaker: "member:m1", items: many, limit: 3 });
    expect(out).toContain("第8句");
    expect(out).toContain("第10句");
    expect(out).not.toContain("第7句");
    expect(out.length).toBeLessThan(2500);
  });
});
