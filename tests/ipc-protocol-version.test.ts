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

  it("bump 版本必须有意为之：现钉 1——改协议形状（AgentApi 增删/字段语义变）= bump 常量 + 同步本格，desktop-panel 提案走同一流水线", () => {
    expect(IPC_PROTOCOL_VERSION).toBe(1);
  });
});
