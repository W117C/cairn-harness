// observation-capture 单测：M7 观察账本簇里唯一无测试的模块。守的是安全不变量——
// 只捕获「已授权且已脱敏」的工具输出（EAUTH 防护）+ obs_recall 参数白名单与错误码消毒
// （防止错误信息注入）。用 fake ledger，不落盘、不依赖真实归档。
import { describe, expect, it } from "vitest";
import { captureObservation, createObservationRecallTool } from "../src/tools/observation-capture";
import type { AuthorizedRedactedText, ObservationLedger, Projection, RecallInput, RecallPage } from "../src/agent/ledger";
import type { ToolResult } from "../src/tools/base";

function fakeLedger(opts: { enabled: boolean; captureOut?: Projection; recallOut?: RecallPage; recallErr?: { code?: string } }): ObservationLedger {
  const calls: { capture: number; recall: number } = { capture: 0, recall: 0 };
  const ledger: ObservationLedger = {
    enabled: opts.enabled,
    async capture(input: { toolName: string; callId: string; source: AuthorizedRedactedText }) {
      calls.capture++;
      // 捕获侧必须收到与事件输出**逐字一致**的脱敏文本
      expect(input.source.kind).toBe("authorized-redacted-text");
      return opts.captureOut ?? { text: input.source.text, archived: true, id: "obs-1" };
    },
    async recall(input: RecallInput) {
      calls.recall++;
      expect(input.id).toBe("obs-1");
      if (opts.recallErr) throw opts.recallErr;
      return opts.recallOut ?? { text: "page", eof: true };
    },
  } as unknown as ObservationLedger;
  return ledger;
}

describe("captureObservation（脱敏捕获闸）", () => {
  it("账本未启用 → 原样返回结果、不产生 observation（零行为）", async () => {
    const r: ToolResult = { ok: true, output: "原始输出" };
    const out = await captureObservation(fakeLedger({ enabled: false }), {
      toolName: "run_shell", callId: "c1", result: r,
      source: { kind: "authorized-redacted-text", text: "原始输出" },
    });
    expect(out.result).toBe(r);
    expect(out.observation).toBeUndefined();
  });

  it("EAUTH 防护：source 与事件输出不一致 → 不捕获，observation 记明错误", async () => {
    const ledger = fakeLedger({ enabled: true });
    const r: ToolResult = { ok: true, output: "事件里的输出" };
    const out = await captureObservation(ledger, {
      toolName: "run_shell", callId: "c1", result: r,
      source: { kind: "authorized-redacted-text", text: "别处来的文本" },
    });
    expect(out.result).toBe(r); // 事件输出不被改写
    expect(out.observation?.archived).toBe(false);
    expect(out.observation?.error).toMatch(/EAUTH/);
  });

  it("一致时 → 交账本捕获，observation 带 id", async () => {
    const out = await captureObservation(fakeLedger({ enabled: true }), {
      toolName: "read_file", callId: "c2",
      result: { ok: true, output: "已脱敏" },
      source: { kind: "authorized-redacted-text", text: "已脱敏" },
    });
    expect(out.observation).toMatchObject({ text: "已脱敏", archived: true, id: "obs-1" });
  });
});

describe("createObservationRecallTool（obs_recall 注入工具）", () => {
  it("未启用 → 返回 undefined（不进工具表）", () => {
    expect(createObservationRecallTool(fakeLedger({ enabled: false }))).toBeUndefined();
  });

  it("启用 → 工具名为 obs_recall 且仅接受白名单分页参数", async () => {
    const tool = createObservationRecallTool(fakeLedger({ enabled: true }));
    expect(tool?.name).toBe("obs_recall");
    const bad = await tool!.run({ id: "obs-1", evil: "x" }, {} as never);
    expect(bad.ok).toBe(false);
    expect(bad.output).toMatch(/EINVAL/);
  });

  it("合法参数 → 返回 JSON 页", async () => {
    const tool = createObservationRecallTool(fakeLedger({ enabled: true, recallOut: { text: "一页", eof: true } }));
    const ok = await tool!.run({ id: "obs-1", by: "lines", offset: 0, max: 10 }, {} as never);
    expect(ok.ok).toBe(true);
    expect(JSON.parse(ok.output)).toMatchObject({ text: "一页", eof: true });
  });

  it("错误码消毒：非白名单 code 不回显，回落 EIO（防错误信息注入）", async () => {
    const tool = createObservationRecallTool(fakeLedger({ enabled: true, recallErr: { code: "'); DROP TABLE x;--" } }));
    const fail = await tool!.run({ id: "obs-1" }, {} as never);
    expect(fail.ok).toBe(false);
    expect(fail.output).toMatch(/EIO/);
    expect(fail.output).not.toContain("DROP TABLE");
  });

  it("白名单错误码原样透出（可诊断）", async () => {
    const tool = createObservationRecallTool(fakeLedger({ enabled: true, recallErr: { code: "EDELETED" } }));
    const fail = await tool!.run({ id: "obs-1" }, {} as never);
    expect(fail.output).toContain("EDELETED");
  });
});
