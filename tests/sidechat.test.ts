// M2f 单测：注册表 +1（面板 sidechat / 卡片 promote）+ 未知类型兜底 + 只读白名单 +
// 主会话只读投影（20 轮窗口 / 摘要产物 / 截断）+ /promote（origin 四字段 + 输出扫描 + 反向投影）。
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FallbackPanel, KNOWN_PANEL_IDS, resolvePanel } from "../src/renderer/panels/registry";
import { FallbackCard, KNOWN_CARD_TYPES, resolveCard } from "../src/renderer/cards/registry";
import { projectPromoteBadges } from "../src/renderer/projections";
import {
  SIDECHAT_FORBIDDEN_TOOLS,
  SIDECHAT_PROJECTION_ROUNDS,
  buildMainProjection,
  derivePromotionContent,
  extractAtRefs,
  promoteToMain,
  readAtRef,
  sidechatToolSpecs,
} from "../src/agent/sidechat";
import { createEventLog, replay, type AgentEvent } from "../src/events";

const tmpDirs: string[] = [];
async function mkTmp(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "m2f-unit-"));
  tmpDirs.push(d);
  return d;
}
afterEach(async () => {
  for (const d of tmpDirs.splice(0)) await rm(d, { recursive: true, force: true });
});

describe("M2f 注册表（各 +1 类 + 未知兜底）", () => {
  it("面板注册表 +1：含 sidechat，且未知 panel_id 仍落兜底", () => {
    expect(KNOWN_PANEL_IDS).toContain("sidechat");
    expect(KNOWN_PANEL_IDS.length).toBe(6);
    expect(resolvePanel("sidechat")).not.toBe(FallbackPanel);
    expect(resolvePanel("bogus_m2f")).toBe(FallbackPanel);
    expect(() => resolvePanel("bogus_m2f")({ payload: {} })).not.toThrow();
  });

  it("卡片注册表 +1：含 promote，且未知 card_type 仍落兜底", () => {
    expect(KNOWN_CARD_TYPES).toContain("promote");
    expect(KNOWN_CARD_TYPES.length).toBe(9);
    expect(resolveCard("promote")).not.toBe(FallbackCard);
    expect(resolveCard("bogus_m2f_card")).toBe(FallbackCard);
  });

  it("promote 卡 SSR 冒烟：origin 四字段（session/源事件/note）可见，跳回源消息按钮在场", () => {
    const html = renderToStaticMarkup(
      createElement(resolveCard("promote"), {
        payload: {
          type: "promote",
          content: "结论：completedCount 需要过滤 done。",
          origin: { kind: "sidechat", session_id: "旁路调查", source_event_ids: [2, 4], note: "来自旁路" },
        },
      }),
    );
    expect(html).toContain("来自 sidechat");
    expect(html).toContain("旁路调查");
    expect(html).toContain("#2");
    expect(html).toContain("#4");
    expect(html).toContain("来自旁路");
    expect(html).toContain("跳回源消息");
  });
});

describe("M2f sidechat 只读白名单（工具表摘除）", () => {
  it("三个写向工具不在 sidechat 工具表里", () => {
    const names = sidechatToolSpecs().map((s) => s.function.name);
    for (const banned of SIDECHAT_FORBIDDEN_TOOLS) {
      expect(names).not.toContain(banned);
    }
    expect(names).toContain("read_file");
    expect(names).toContain("grep");
  });
});

describe("M2f 主会话只读投影", () => {
  const userMsg = (c: string): AgentEvent => ({ type: "user_message", content: c });
  const asstMsg = (c: string): AgentEvent => ({ type: "assistant_message", content: c });

  it("未压缩 → 最近 20 轮截断视图（更早的轮次不在投影里）", () => {
    const events: AgentEvent[] = [];
    for (let i = 1; i <= 30; i++) {
      events.push(userMsg("第 " + String(i) + " 轮"));
      events.push(asstMsg("回答 " + String(i)));
    }
    const p = buildMainProjection(events);
    expect(p.kind).toBe("truncated");
    expect(p.rounds).toBe(SIDECHAT_PROJECTION_ROUNDS);
    expect(p.text).not.toContain("第 1 轮"); // 超出窗口
    expect(p.text).toContain("第 30 轮");
    expect(p.text).toContain("第 11 轮"); // 窗口起点
  });

  it("已压缩 → 用摘要产物（summary 分支）", () => {
    const events: AgentEvent[] = [
      userMsg("旧任务"),
      {
        type: "compaction",
        trigger: "manual",
        reason: "user_request",
        compressed_event_ids: [1],
        summary: "## Objective\n- 摘要产物",
        summary_offset: 2,
        tokens_before: 100,
        tokens_after: 10,
      },
      userMsg("新任务"),
    ];
    const p = buildMainProjection(events);
    expect(p.kind).toBe("summary");
    expect(p.text).toContain("摘要产物");
  });

  it("截断视图逐条压缩：长工具结果不整段进投影", () => {
    const events: AgentEvent[] = [
      userMsg("读文件"),
      { type: "tool_call", id: "c1", name: "read_file", args: { path: "big.ts" } },
      { type: "tool_result", callId: "c1", ok: true, output: "X".repeat(5_000) },
    ];
    const p = buildMainProjection(events);
    expect(p.text.length).toBeLessThan(1_200);
    expect(p.text).toContain("截断");
  });
});

describe("M2f @ 引用", () => {
  it("提取 @path 并只读工作区内文件（工作区外 fail-closed）", async () => {
    const d = await mkTmp();
    await writeFile(join(d, "note.md"), "引用内容", "utf8");
    expect(extractAtRefs("看看 @note.md 和 @/etc/passwd")).toEqual(["note.md", "/etc/passwd"]);
    expect(readAtRef(d, "note.md")?.content).toContain("引用内容");
    expect(readAtRef(d, "/etc/passwd")).toBeNull(); // 工作区外拒读
  });
});

describe("M2f /promote", () => {
  it("渲染为主会话一条 user_message + origin 四字段齐全；输出扫描脱敏密钥", async () => {
    const d = await mkTmp();
    const sidechatLog = join(d, "side.jsonl");
    const mainLog = join(d, "main.jsonl");
    const side = createEventLog(sidechatLog);
    await side.append({ type: "user_message", content: "查一下" });
    await side.append({ type: "assistant_message", content: "结论：密钥是 sk-abcdefghijklmnopqrstuvwxyz012345 要换掉。" });
    await writeFile(mainLog, "", "utf8");

    const res = await promoteToMain({
      mainLogPath: mainLog,
      sidechatLogPath: sidechatLog,
      sidechatId: "旁路调查",
      sourceEventIds: [2],
      note: "旁路结论",
    });
    expect(res.ok).toBe(true);
    const main = await replay(mainLog);
    expect(main.length).toBe(1);
    const ev = main[0];
    expect(ev.type).toBe("user_message");
    if (ev.type !== "user_message" || !ev.origin) throw new Error("origin 缺失");
    expect(ev.origin.kind).toBe("sidechat");
    expect(ev.origin.session_id).toBe("旁路调查");
    expect(ev.origin.source_event_ids).toEqual([2]);
    expect(ev.origin.note).toBe("旁路结论");
    // 输出扫描：密钥被脱敏（完整串不进主转录）
    expect(ev.content).not.toContain("sk-abcdefghijklmnopqrstuvwxyz012345");
    expect(ev.content).toContain("****");
    // 反向投影：源消息徽标
    const badges = projectPromoteBadges(main);
    expect(badges.length).toBe(1);
    expect(badges[0]?.sessionId).toBe("旁路调查");
    expect(badges[0]?.sourceEventIds).toEqual([2]);
  });

  it("source_event_ids 为空 → 拒绝（结论须可追溯）", async () => {
    const d = await mkTmp();
    const mainLog = join(d, "main.jsonl");
    await writeFile(mainLog, "", "utf8");
    const res = await promoteToMain({ mainLogPath: mainLog, sidechatId: "s", sourceEventIds: [] });
    expect(res.ok).toBe(false);
    expect(await replay(mainLog)).toEqual([]);
  });

  it("derivePromotionContent：按源事件号取助手正文", () => {
    const events: AgentEvent[] = [
      { type: "user_message", content: "问" },
      { type: "assistant_message", content: "答一" },
      { type: "assistant_message", content: "答二" },
    ];
    expect(derivePromotionContent(events, [2, 3])).toBe("答一\n\n答二");
    expect(derivePromotionContent(events, [1])).toBeNull();
  });
});
