// 技能轮的用户面原文（2026-10-18）：事件 content 是展开后的技能提示词（模型面，重放/续跑要用），
// 用户气泡/复制/重跑/回放/导出要显示用户自己敲的 `<invoke> <args>`——否则整份 SKILL.md 会被
// 当成用户说的话，重跑还会把展开后的正文再当一次原始输入发出去。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { userVisibleText } from "../src/renderer/projections";
import { transcriptMarkdown } from "../src/renderer/transcript";
import type { AgentEvent } from "../../../src/main/ipc-protocol";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const ev = (o: Record<string, unknown>): AgentEvent => o as unknown as AgentEvent;

describe("userVisibleText", () => {
  it("有 skill 元信息 ⇒ 还原调用名与参数；空参数只留调用名；普通消息原样", () => {
    expect(userVisibleText({ content: "整份技能正文…", skill: { invoke: "/demo", args: " 你好 " } })).toBe("/demo 你好");
    expect(userVisibleText({ content: "整份技能正文…", skill: { invoke: "/demo-plugin:greet", args: "" } })).toBe("/demo-plugin:greet");
    expect(userVisibleText({ content: "普通消息" })).toBe("普通消息");
  });

  it("投影行 / 重跑取值 / 导出都走用户面原文", () => {
    const src = read("../src/renderer/projections.ts");
    // 2026-10-18：user 行改为多行对象（新增可选 attachments），哨兵跟随形状但口径不变。
    expect(src).toContain('kind: "user", text: userVisibleText(e)');
    expect(src).toContain('if (rounds === round) return userVisibleText(e);');
    const md = transcriptMarkdown([
      ev({ type: "user_message", content: "整份技能正文…", skill: { invoke: "/demo", args: "你好" } }),
      ev({ type: "assistant_message", content: "收到" }),
    ], "会话");
    expect(md).toContain("## 你\n\n/demo 你好");
    expect(md).not.toContain("整份技能正文");
  });
});
