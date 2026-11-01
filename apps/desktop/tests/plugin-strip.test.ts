// 插件命令按需发现（2026-10-27）：插件不应在每次输入时占一条常驻命令带。
// `/` 补全和 ⌘K 已覆盖发现与填入，composer 上方保持安静。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const composer = readFileSync(join(__dirname, "..", "src", "renderer", "components", "Composer.tsx"), "utf8");
const strings = readFileSync(join(__dirname, "..", "src", "renderer", "strings.ts"), "utf8");
const css = readFileSync(join(__dirname, "..", "src", "renderer", "styles.css"), "utf8");

describe("插件命令按需发现", () => {
  it("不再在 composer 上方常驻插件命令带", () => {
    expect(composer).not.toContain('className="plugin-strip"');
    expect(composer).not.toContain('className="plugin-chip"');
    expect(composer).not.toContain("STR.composer.pluginStripAria");
    expect(strings).not.toContain("pluginStripAria:");
    expect(strings).not.toContain("pluginStripLabel:");
    expect(css).not.toContain(".plugin-strip");
    expect(css).not.toContain(".plugin-chip");
  });

  it("斜杠补全仍承接插件命令的发现与填入", () => {
    expect(composer).toContain("slashItems([");
    expect(composer).toContain("slashMatches(s.invoke, slashQuery)");
    expect(composer).toContain("chooseSlash(");
  });
});
