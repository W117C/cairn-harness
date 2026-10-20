// 桌面端这一批修法的**接线钉**（2026-10-20 独立评审的四条真缺陷）。
//
// 这一份是**源文本**对账（这些行为都在 React 组件里，逐条渲染整棵 App 不现实；
// 行为那一半各自另有判卷：命令门 = tests/command-gate.test.ts（纯函数，真跑）；
// 相位文案 = tests/phase-label.test.ts（纯函数，真跑）；草稿搬移 = 本文件末尾的纯函数用例）。
// 它钉的是**接线**：修法真的落在那条路上，而不是"某处有个一样的字符串"。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { moveDraftInBucket } from "../src/renderer/drafts";

const app = readFileSync(fileURLToPath(new URL("../src/renderer/App.tsx", import.meta.url)), "utf8");
const kernel = readFileSync(fileURLToPath(new URL("../src/main/kernel-host.ts", import.meta.url)), "utf8");

describe("改名绑定到发起时那条会话（切会话不能改错对象）", () => {
  it("改名状态带着 id；提交时用绑定的 id，不用 activeId", () => {
    expect(app).toContain("useState<{ id: string; text: string } | null>(null)");
    expect(app).toContain("void renameSessionById(barRenaming.id, v);");
    // 反向对照：提交时**不许**再用 activeId（那正是"把 B 改名成 A 的标题"那一步）
    expect(app).not.toContain("void renameSessionById(activeId, v);");
  });

  it("切会话 ⇒ 取消改名（输入框不跨会话活着）", () => {
    expect(app).toContain("setBarRenaming(null);\n  }, [activeId]);");
  });
});

describe("空分支删除前先搬走用户还没发出去的稿", () => {
  it("删除前搬草稿（纯函数：桶原文进、原文出）", () => {
    const raw = JSON.stringify({ fork: "我改过的第一轮", other: "别的会话的稿" });
    const moved = moveDraftInBucket(raw, "fork", "origin");
    expect(moved).not.toBeNull();
    const bucket = JSON.parse(moved as string) as Record<string, string>;
    expect(bucket["origin"]).toBe("我改过的第一轮");
    expect(bucket["fork"], "旧键必须清掉（否则成孤儿）").toBeUndefined();
    expect(bucket["other"], "别人的稿不许动").toBe("别的会话的稿");
    // 没有稿 / 坏数据 ⇒ 什么都不做（不许造数据）
    expect(moveDraftInBucket(JSON.stringify({ fork: "   " }), "fork", "origin")).toBeNull();
    expect(moveDraftInBucket("not json", "fork", "origin")).toBeNull();
    expect(moveDraftInBucket(null, "fork", "origin")).toBeNull();
  });

  it("接线：删空分支那条路上真的先搬了", () => {
    expect(app).toContain("moveDraftBetweenSessions(ctx.forkId, ctx.originId);");
  });
});

describe("换渲染层实例后接管在跑的会话：秒表接着真值算", () => {
  it("main 报这一轮的起点；渲染层拿它补上本机没有的起点", () => {
    expect(kernel).toContain("runStartedAt");
    expect(kernel).toContain("startedAt: runStartedAt.get(id)");
    expect(app).toContain("runStartBySession.current.set(id, r.startedAt ?? Date.now());");
  });
});
