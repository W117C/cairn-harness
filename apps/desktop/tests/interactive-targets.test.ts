// 交互靶面 / 响应式走查纪律（2026-11-08 第 1045 页 · Frontend Responsive Design Standards）
//
// 来源：新装的 `frontend-responsive-ui` 的 Touch target checklist（按钮 ≥44×44，桌面密集面
// 至少 24×24；icon button 用 padding 扩命中区）。用 `responsive-audit.cjs` 在 14 档视口 +
// 检查器打开态走查，只有 `.md-copy` 恒定 38×12 不达标 ⇒ 修它，并把「无小靶面」固化成硬判据。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url)), "utf8");
const audit = readFileSync(fileURLToPath(new URL("../scripts/responsive-audit.cjs", import.meta.url)), "utf8");

describe("代码块「复制代码」按钮的交互靶面", () => {
  it("min-height 24px + 横向 padding；字号 11px 不动（只扩命中区，不改视觉）", () => {
    const rule = css.match(/\.md-copy\s*\{[^}]*\}/)?.[0] ?? "";
    expect(rule).toContain("min-height: 24px");
    expect(rule).toContain("padding: 0 8px");
    expect(rule).toContain("font-size: 11px");
  });

  it("代码块头仍是 36px：扩命中区不许撑高头部", () => {
    const head = css.match(/\.md-code-head\s*\{[^}]*\}/)?.[0] ?? "";
    expect(head).toContain("height: 36px");
  });
});

// 第 1049 页：检查器异步空态的「打开窗格 / 关闭检查器」两枚图标钮原先 22×22，
// responsive-audit 在空态时序下偶发抓到 small=2。提到 24×24，视觉不变。
describe("检查器空态图标钮的交互靶面（第 1049 页）", () => {
  it("24×24 达到可见按钮下限；不再出现 22px", () => {
    const rule = css.match(/\.isp-add\s*\{[^}]*\}/)?.[0] ?? "";
    expect(rule).toContain("width: 24px");
    expect(rule).toContain("height: 24px");
    expect(rule).not.toContain("22px");
  });
});

describe("多视口走查工具把「无小靶面」固化成硬判据", () => {
  it("探针只量 button / 排除 inert / 不把行内 <a> 当按钮（避免假阳性）", () => {
    expect(audit).toContain("document.querySelectorAll('button,[role=\"button\"]')");
    expect(audit).toContain("!e.closest('[inert]')");
    expect(audit).not.toContain("button,[role=\"button\"],a");
  });

  it("硬判据含 smallCount > 0，且 24px 阈值写死；检查器打开态另跑一轮", () => {
    expect(audit).toContain("r.smallCount > 0");
    expect(audit).toContain("x.w < 24 || x.h < 24");
    expect(audit).toContain("inspectorOpen");
    expect(audit).toContain("app.exit(hardFailures.length > 0 || errors.length > 0 ? 1 : 0)");
  });

  it("覆盖本仓现役断点边界与标准建议档（1120/1119/1024/880/760/640…）", () => {
    for (const w of [1440, 1200, 1120, 1119, 1080, 1024, 960, 920, 880, 760, 720, 700, 640, 620]) {
      expect(audit).toContain(String(w));
    }
  });
});
