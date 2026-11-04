// 过程带折叠（2026-11-02 业主截图）：一轮的最终答复落地后，**答复之前的一切**
// （思考记录 / 工具调用 / 过程旁白）收成一行；点开恢复原样。
//
// 缺陷本体（业主截图那一屏）：5 条「思考记录」+ 4 簇「工具调用」排在答复前面——
// 每一行各自是折着的，但**行数还在**：折了不等于少了，答复被埋在最后。
// ⇒ 折叠的单位是「一轮的过程带」，不是「一行」。
//
// 本文件钉四件事：收拢的判据（何时折）、收拢的边界（用户消息与最终答复不折进去）、
// 折起来不等于扔掉（里面那些行还在 DOM 里，展开即恢复）、以及不折的两种情形
// （还在跑 / thinking·verbose 档——那两档的用途就是把过程摊开看）。
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Stream } from "../src/renderer/components/Stream";
import { finalAnswerIndex, summarizeProcess } from "../src/renderer/derived/process-fold";
import { projectStream } from "../src/renderer/projections";
import { STR } from "../src/renderer/strings";
import type { AgentEvent } from "../../../src/main/ipc-protocol";

const ev = (e: unknown): AgentEvent => e as AgentEvent;

/** 一轮的真实形态（照业主截图那一屏排）：问 → 思考+旁白 → 查文件 → 思考+最终答复。 */
const ROUND = [
  { type: "user_message", content: "你现在是什么模式在运行", ts: 1 },
  { type: "thinking_delta", callId: "c1", text: "用户问模式，可能指权限档。", ts: 2 },
  { type: "assistant_delta", callId: "c1", text: "我先查一下配置记录，别凭猜。", ts: 3 },
  { type: "usage", inputTokens: 10, outputTokens: 5, ts: 4 },
  { type: "tool_call", id: "t1", name: "read_file", args: { path: "a.ts" }, ts: 5 },
  { type: "tool_result", callId: "t1", ok: true, ts: 6 },
  { type: "thinking_delta", callId: "c2", text: "这两个文件是 harness 配置。", ts: 7 },
  { type: "assistant_delta", callId: "c2", text: "「模式」在我没法自省，只能给你可核验的部分。", ts: 8 },
  { type: "usage", inputTokens: 20, outputTokens: 9, ts: 9 },
] as unknown as AgentEvent[];

const rows = projectStream(ROUND, false);
const html = (over: { view?: "normal" | "thinking" | "verbose"; streaming?: boolean } = {}): string =>
  renderToStaticMarkup(
    <Stream rows={rows} view={over.view ?? "normal"} streaming={over.streaming ?? false} />,
  );

describe("过程带折叠：最终答复落地 ⇒ 答复之前的一切收成一行", () => {
  it("收成一行，且默认是折着的（aria-expanded=false + body hidden）", () => {
    const out = html();
    expect(out).toContain('class="process-fold"');
    expect(out).toContain('class="process-fold-toggle"');
    expect(out).toContain('aria-expanded="false"');
    expect(out).toMatch(/class="process-fold-body" hidden=""/);
  });

  it("折起来不等于扔掉：思考行与工具簇还在 DOM 里（展开即恢复原样）", () => {
    const out = html();
    // 里面那些行的锚一个不少（判卷锚：think-body / toolcluster / 工具摘要）
    expect(out).toContain("think-body");
    expect(out).toContain('class="toolcluster"');
    expect(out).toContain("读取 a.ts");
    // 旁白（模型的过场话）也在里面
    expect(out).toContain("我先查一下配置记录，别凭猜。");
  });

  it("边界：用户消息与最终答复都在折叠体之外（折的是「问」与「答」之间那几行）", () => {
    const out = html();
    const foldAt = out.indexOf('class="process-fold"');
    const userAt = out.indexOf('class="row user"');
    const answerAt = out.indexOf("「模式」在我没法自省");
    expect(userAt).toBeGreaterThan(-1);
    expect(foldAt).toBeGreaterThan(userAt);   // 用户消息在折叠体之前
    expect(answerAt).toBeGreaterThan(foldAt); // 最终答复在折叠体之后
    // 答复不在折叠体里：折叠体在答复之前就闭合了
    const bodyEnd = out.indexOf('class="process-fold-body"');
    expect(bodyEnd).toBeLessThan(answerAt);
  });

  it("摘要给的是真数：工具次数 / 思考段数 / 失败次数", () => {
    const out = html();
    expect(out).toContain(STR.processFold.label);
    expect(out).toContain(STR.processFold.toolCount.replace("{n}", "1"));
    expect(out).toContain(STR.processFold.thinkCount.replace("{n}", "2"));
    expect(out).not.toContain(STR.processFold.failureCount);
  });

  it("还在跑的那一轮不折（过程正在发生，不该被藏）", () => {
    const out = html({ streaming: true });
    expect(out).not.toContain('class="process-fold"');
    expect(out).toContain('class="toolcluster"');
  });

  it("thinking / verbose 档不折（那两档的用途就是把过程摊开看）", () => {
    expect(html({ view: "thinking" })).not.toContain('class="process-fold"');
    expect(html({ view: "verbose" })).not.toContain('class="process-fold"');
  });

  it("用户自己说的话（轮中插话）与错误行不折进去——不许把用户的话藏进折叠体", () => {
    const withSteering = projectStream([
      { type: "user_message", content: "查一下", ts: 1 },
      { type: "thinking_delta", callId: "c1", text: "先查。", ts: 2 },
      { type: "tool_call", id: "t1", name: "read_file", args: { path: "a.ts" }, ts: 3 },
      { type: "tool_result", callId: "t1", ok: true, ts: 4 },
      { type: "user_message", content: "顺带看下配置", ts: 5, origin: { kind: "steering" } },
      { type: "assistant_delta", callId: "c2", text: "好。", ts: 6 },
      { type: "usage", inputTokens: 10, outputTokens: 4, ts: 7 },
    ] as unknown as AgentEvent[], false);
    const out = renderToStaticMarkup(<Stream rows={withSteering} view="normal" streaming={false} />);
    expect(out).not.toContain('class="process-fold"');
    expect(out).toContain("顺带看下配置");
  });
});

describe("判据（纯投影，可单测）", () => {
  it("最终答复 = 最后一条已落定且有正文的助手行；live 行不算", () => {
    expect(finalAnswerIndex([])).toBe(-1);
    expect(finalAnswerIndex([{ kind: "user", text: "问", seq: 0, round: 1 }])).toBe(-1);
    expect(finalAnswerIndex([{ kind: "assistant", text: "答", live: true, seq: 0, eventId: 1, round: 1 }])).toBe(-1);
    expect(finalAnswerIndex([{ kind: "assistant", text: "  ", seq: 0, eventId: 1, round: 1 }])).toBe(-1);
    expect(finalAnswerIndex([
      { kind: "assistant", text: "中间", seq: 0, eventId: 1, round: 1 },
      { kind: "assistant", text: "最终", seq: 1, eventId: 2, round: 1 },
    ])).toBe(1);
  });

  it("摘要只数行里有的东西（不编数）", () => {
    expect(summarizeProcess([])).toEqual({ tools: 0, failures: 0, thinks: 0 });
    const s = summarizeProcess([
      { kind: "tool", tool: "read_file", summary: "a.ts", seq: 0, ok: true },
      { kind: "tool", tool: "read_file", summary: "b.ts", seq: 1, ok: false },
      { kind: "assistant", text: "答", thinking: "想过", seq: 2, eventId: 3, round: 1 },
      { kind: "assistant", text: "答2", seq: 3, eventId: 4, round: 1 },
    ]);
    expect(s).toEqual({ tools: 2, failures: 1, thinks: 1 });
  });
});
