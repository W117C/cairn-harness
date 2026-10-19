// 浏览器窗格开窗即聚焦地址栏（2026-10-18）：⌘⇧B 之后用户想直接敲 URL，不该再点一下输入框。
// 有初始 URL（项目预览自动导航）时不抢焦点。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = readFileSync(fileURLToPath(new URL("../src/renderer/components/PaneDock.tsx", import.meta.url)), "utf8");

describe("浏览器地址栏聚焦", () => {
  it("挂载时聚焦；initialUrl 非空则让位", () => {
    expect(src).toContain("if (props.initialUrl === undefined || props.initialUrl === \"\") addrRef.current?.focus();");
    expect(src).toContain("// 只在挂载时做一次；后续 URL 变化不重新聚焦。");
  });
});
