// 输入框底分主题（2026-10-21 · Claude v3 暗色 scope 实测）。
//
// v3 `--cds-fill-field`：亮色 = `#ffffff80`（白半透），暗色 scope = `--cds-alpha-1`
// （5% 亮墨压在暗底上）。两主题的「半透墨色」方向相反——亮色是白墨，暗色也是白墨
// 但底更暗 ⇒ 观感上暗色字段比亮色字段更沉。
//
// 本仓新增 `--fill-field` 两态：亮色白半透、暗色 5% 亮墨；设置页输入框改吃它。
// 判据钉**两态值**与**接线**（输入框用字段底、不是实体 bg-000）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url)), "utf8");
const TOKENS = readFileSync(fileURLToPath(new URL("../src/renderer/tokens.css", import.meta.url)), "utf8");

describe("输入框底（v3 fill-field 两态）", () => {
  it("亮色白半透 50%，暗色 5% 亮墨", () => {
    expect(TOKENS).toContain("--fill-field: hsl(0 0% 100% / 50%);");
    const darkAt = TOKENS.indexOf('[data-theme="dark"] {');
    expect(TOKENS.slice(darkAt)).toContain("--fill-field: hsl(from hsl(var(--text-000)) h s l / 5%);");
  });

  it("设置页输入框用字段底（不再用实体 bg-000）", () => {
    const i = CSS.indexOf(".ss-field > input, .ss-field > select {");
    expect(i).toBeGreaterThan(-1);
    const rule = CSS.slice(i, CSS.indexOf("}", i));
    expect(rule).toContain("background: var(--fill-field)");
    expect(rule).not.toContain("background: hsl(var(--bg-000))");
  });
});
