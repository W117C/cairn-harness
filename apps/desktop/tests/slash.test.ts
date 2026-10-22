// 斜杠菜单合成（2026-10-18 接通 §8 #14）：内置两条 + 工作区 loose skills。
// 去重、非 trusted 标「待批准」、空描述回落——菜单只摆真实可调用的条目。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { slashItems } from "../src/renderer/slash";
import { readAppSurface } from "./helpers/app-surface";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const base = [
  { invoke: "/compact", desc: "压缩上下文" },
  { invoke: "/goal", desc: "目标模式" },
];

describe("slashItems", () => {
  it("技能追加在内置之后，调用名补斜杠", () => {
    const out = slashItems(base, [{ invoke: "demo", description: "演示技能", trust: "trusted" }]);
    expect(out.map((x) => x.invoke)).toEqual(["/compact", "/goal", "/demo"]);
    expect(out[2]?.desc).toBe("演示技能");
  });

  it("与内置同名不双列；带斜杠的 invoke 也归一", () => {
    const out = slashItems(base, [
      { invoke: "compact", description: "重复", trust: "trusted" },
      { invoke: "/goal", description: "重复", trust: "trusted" },
      { invoke: "/demo", description: "演示", trust: "trusted" },
    ]);
    expect(out.map((x) => x.invoke)).toEqual(["/compact", "/goal", "/demo"]);
  });

  it("非 trusted 标「待批准」；空描述回落「技能」", () => {
    const out = slashItems(base, [
      { invoke: "pending", description: "尚未批准", trust: "pending" },
      { invoke: "silent", description: "  ", trust: "trusted" },
    ]);
    expect(out[2]?.desc).toBe("尚未批准（待批准）");
    expect(out[3]?.desc).toBe("技能");
  });

  it("接线：Composer 消费 slashItems；App 拉 listSkills", () => {
    expect(read("../src/renderer/components/Composer.tsx")).toContain("slashItems([");
    const app = readAppSurface();
    expect(app).toContain("window.agent.listSkills(activeWorkspace");
    // 打开会话时渲染层 activeWorkspace 跟着会话归属走（否则技能清单/预览/chip 读旧项目）
    expect(app).toContain("if (sessionWs !== null) setActiveWorkspace(sessionWs)");
    expect(read("../../../src/main/ipc-protocol.ts")).toContain("listSkills(workspace?: string)");
    expect(read("../src/main/channels.ts")).toContain('listSkills: "agent:list-skills"');
  });
});
