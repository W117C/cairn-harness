// SEMA Phase 3 判卷（docs/sema-proposal.md §12）：IPC 协议版本化。
// 本文件同时是 src/main/ipc-protocol.ts 运行时出口的**执行路径**（值边 import）——
// src-execution-path 棘轮随版本化撤掉它的纯类型面豁免，执行路径由这一格供给。
import { describe, expect, it } from "vitest";
import { IPC_PROTOCOL_VERSION } from "../src/main/ipc-protocol";

describe("IPC 协议版本（§3.5/§12）", () => {
  it("版本常量是 ≥1 的整数（兼容面事实源的形状契约）", () => {
    expect(Number.isInteger(IPC_PROTOCOL_VERSION)).toBe(true);
    expect(IPC_PROTOCOL_VERSION).toBeGreaterThanOrEqual(1);
  });

  it("bump 版本必须有意为之：现钉 13——改协议形状（AgentApi 增删/字段语义变）= bump 常量 + 同步本格，desktop-panel 提案走同一流水线", () => {
    // v8 → v9（2026-10-16 建议批）：＋suggestNext（「Tab 想下一条」按上下文单发模型调用）。
    // v9 → v10（2026-10-16 能力在场性批）：＋capabilities（搜索端点配没配——让「模型为什么少一把工具」上屏）。
    // v10 → v11（2026-10-16 主界面重做批）：＋gitStatus / gitClone / workspaceSearch / touchProject /
    //   saveTempFile / snapshotRestore / revealInFinder；listProjects 收 options（recentFirst/includeRemoved）。
    // v11 → v12（2026-10-16 导入诊断批）：＋projectDiagnose（导入已有文件夹先给三态诊断，ADR 0004 §4）。
    // v12 → v13（2026-10-16 记忆正文批）：MemoryTopicPayload 增 body（「主题正文」快照面接通，无新通道）。
    expect(IPC_PROTOCOL_VERSION).toBe(13);
  });
});
