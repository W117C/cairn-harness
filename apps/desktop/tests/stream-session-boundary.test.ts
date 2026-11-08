// 切会话的行状态边界（2026-10-18 真机）：A 展开 read_file 后切 B，B 的第一条工具行也是展开的——
// 行内局部状态（工具展开/思考折叠/审批卡展开）被跨会话复用。修法不是给行 key 加会话前缀
// （实测会让 React 留下旧行：A 31 → 57 条工具行、26 个重复 event id），而是重挂 Stream 本体。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readAppSurface } from "./helpers/app-surface";

const app = readAppSurface();
const stream = readFileSync(fileURLToPath(new URL("../src/renderer/components/Stream.tsx", import.meta.url)), "utf8");

describe("Stream 的会话边界", () => {
  it("按 activeId 重挂（.stream 滚动容器不在 key 内）", () => {
    expect(app).toContain("key={activeId ?? \"home\"}");
    const at = app.indexOf("key={activeId ?? \"home\"}");
    expect(app.slice(Math.max(0, at - 400), at)).toContain("<Stream");
  });

  it("没有回退成“行 key 拼会话前缀”的方案（实测会留下旧行）", () => {
    expect(stream).not.toContain("sessionKey?: string");
    expect(stream).not.toContain("${props.sessionKey");
  });
});
