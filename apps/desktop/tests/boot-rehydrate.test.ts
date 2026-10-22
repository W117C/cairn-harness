// 启动回灌项目注册表是异步的（ProjectRegistry.load），而渲染层首屏立刻调 listSessions。
// 若首屏抢在回灌完成前到达，另一个项目的会话不在清单里 ⇒ 启动恢复把它判成「不存在」并永久清 key。
// 这是 Electron 装配根的时序，没有可注入的单测缝；用源码哨兵钉住「listSessions 先等回灌」。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const index = readFileSync(fileURLToPath(new URL("../src/main/index.ts", import.meta.url)), "utf8");

describe("启动项目回灌", () => {
  it("回灌是一个可等待的 Promise，不是裸 void IIFE", () => {
    expect(index).toContain("const projectRehydrate = (async () => {");
    expect(index).not.toContain("void (async () => {\n  try {\n    for (const p of await projectRegistry.list())");
  });

  it("listSessions 先 await 回灌，再扫描工作区（跨区恢复的 key 不会被误清）", () => {
    expect(index).toContain("listSessions: async () => {");
    expect(index).toContain("await projectRehydrate;");
    expect(index).toContain("return host.listSessions();");
  });
});
