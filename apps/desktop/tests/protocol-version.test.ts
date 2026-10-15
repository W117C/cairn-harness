// SEMA Phase 3 判卷（docs/sema-proposal.md §12）：协议版本握手的桌面接线。
// 形状裁决在类型侧（AgentApi.protocolVersion ↔ channels.ts 映射红线，channels.test 同款）；
// 这里钉的是四格**接线事实**：通道行、wired 行、vite define、renderer 闸——缺一格 = 版本化哑火。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { INVOKE_CHANNELS } from "../src/main/channels";
import { IPC_PROTOCOL_VERSION } from "../../../src/main/ipc-protocol";

function repo(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

describe("协议版本握手接线（§3.5/§12）", () => {
  it("通道行在：protocolVersion → agent:protocol-version", () => {
    expect(INVOKE_CHANNELS.protocolVersion).toBe("agent:protocol-version");
  });

  it("main 侧 wired 行在，且递的是协议面常量（不是就地另抄一份数字）", () => {
    const indexTs = repo("../src/main/index.ts");
    expect(indexTs).toMatch(/^\s*protocolVersion\s*:\s*\(\)\s*=>\s*IPC_PROTOCOL_VERSION,/m);
    expect(indexTs).toMatch(/import\s*\{[^}]*IPC_PROTOCOL_VERSION[^}]*\}\s*from\s*"[^"]*src\/main\/ipc-protocol"/);
  });

  it("vite define 在：__IPC_PROTOCOL_VERSION__ 构建期注入（renderer 产物零运行时 import src，类型红线不破）", () => {
    const viteCfg = repo("../vite.config.ts");
    expect(viteCfg).toMatch(/import\s*\{\s*IPC_PROTOCOL_VERSION\s*\}\s*from\s*"[^"]*src\/main\/ipc-protocol"/);
    expect(viteCfg).toMatch(/__IPC_PROTOCOL_VERSION__\s*:\s*JSON\.stringify\(IPC_PROTOCOL_VERSION\)/);
  });

  it("renderer 闸在：挂载比对实况版本，失配/查询失败 fail-closed 早退", () => {
    const appTsx = repo("../src/renderer/App.tsx");
    expect(appTsx).toMatch(/declare const __IPC_PROTOCOL_VERSION__: number/);
    expect(appTsx).toMatch(/window\.agent\.protocolVersion\(\)/);
    expect(appTsx).toMatch(/live !== __IPC_PROTOCOL_VERSION__/);
  });

  it("版本事实源单点：桌面侧不许另抄一份版本数字（期望值从协议面 import）", () => {
    // 升版即在此钉新号：v8 → v9（建议批：suggestNext「Tab 想下一条」单发模型调用）；
    // v9 → v10（能力在场性批：capabilities——搜索端点配没配，让「模型为什么少一把工具」上屏）。
    expect(IPC_PROTOCOL_VERSION).toBe(10);
  });
});
