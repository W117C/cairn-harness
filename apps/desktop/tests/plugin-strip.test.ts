// 插件命令带（G1 的按钮带半边，2026-10-21）：composer 上方只列已信任的命名空间命令，
// 点击填入 `/plugin:command ` 而不直接发送（C-24）。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const composer = readFileSync(join(__dirname, "..", "src", "renderer", "components", "Composer.tsx"), "utf8");
const strings = readFileSync(join(__dirname, "..", "src", "renderer", "strings.ts"), "utf8");
const css = readFileSync(join(__dirname, "..", "src", "renderer", "styles.css"), "utf8");

describe("插件命令带", () => {
  it("只取已信任、带命名空间的命令，最多四条", () => {
    expect(composer).toContain('s.trust === "trusted" && s.invoke.includes(":")');
    expect(composer).toContain(".slice(0, 4)");
  });

  it("点击走 chooseSlash 填入不发送，且带无障碍标签", () => {
    expect(composer).toContain('className="plugin-strip" aria-label={STR.composer.pluginStripAria}');
    expect(strings).toContain('pluginStripAria: "插件命令"');
    expect(strings).toContain('pluginStripLabel: "插件"');
    expect(composer).toContain("chooseSlash({ invoke: `/${invoke}`");
  });

  it("样式是低调的横向芯片带，不抢 composer", () => {
    expect(css).toContain(".plugin-strip");
    expect(css).toContain(".plugin-chip");
    expect(css).toContain("overflow-x: auto");
  });
});
