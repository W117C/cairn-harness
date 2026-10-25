// 批 5（《全局 UI 视觉重构》细则 §五「弹层与菜单（统一组件）」）：
// ① 底座统一：所有 popover = v3 的 10 圆角（--radius-pop-v3）+ 8 内距（--space-sm）+ 条目 36px（--h-menu-item）；
// ② 选中态统一：右侧对勾 + 条目文字变 primary（.menu-item:has(.check)）；
// ③ 权限菜单：每项图标 + 两行（标题/副标题）、「自动」行 warning 图标 +「危险」小标签（不整行变色）、
//    选「自动」先二次确认（未确认不调 onModeChange）；
// ④ 模型弹层：思考分段选中 = elevated 背景 + primary 文字、未选 = secondary（不再用近隐灰）；
//    「未声明 reasoningEfforts」= 一行 caption 档 info 行（小图标 + 文案 + 「了解如何配置」折叠），
//    去掉大块棕底。
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { PermissionConfirm, PermissionMenu } from "../src/renderer/components/PermissionMenu";
import { ModelMenu } from "../src/renderer/components/ModelPicker";
import type { PermissionMode } from "../../../src/main/ipc-protocol";

const styles = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
const tokens = readFileSync(new URL("../src/renderer/tokens.css", import.meta.url), "utf8");
const permSrc = readFileSync(new URL("../src/renderer/components/PermissionMenu.tsx", import.meta.url), "utf8");

/** 提取行首选择器块（`\n.sel {` → 首个 `}`）。 */
function block(css: string, sel: string): string {
  const i = css.indexOf(`\n${sel} {`);
  if (i < 0) throw new Error(`CSS 块不存在：${sel}`);
  return css.slice(i, css.indexOf("}", i));
}

describe("批 5：弹层底座统一（10 圆角 / 8 内距 / 36 条目）", () => {
  it("tokens：--radius-pop-v3 = 10、--h-menu-item = 36（rem 缩放制）", () => {
    expect(tokens).toContain("--radius-pop-v3: calc(0.625rem * var(--size-scale))");
    expect(tokens).toContain("--h-menu-item: calc(2.25rem * var(--size-scale))");
  });

  it(".pop / .pop-rd / .path-menu 三个浮层底座同口径：var(--radius-pop-v3) + var(--space-sm) 内距", () => {
    for (const sel of [".pop", ".pop-rd", ".path-menu"]) {
      const b = block(styles, sel);
      expect(b, sel).toContain("border-radius: var(--radius-pop-v3)");
      expect(b, sel).toContain("padding: var(--space-sm)");
    }
  });

  it(".menu-item：最小高 36（--h-menu-item）+ 横向 8 内距；.pop-label 横向对齐条目文字", () => {
    const item = block(styles, ".menu-item");
    expect(item).toContain("min-height: var(--h-menu-item)");
    expect(item).toContain("padding: 4px var(--space-sm)");
    expect(block(styles, ".pop-label")).toContain("2px var(--space-sm) 5px");
  });

  it("选中态统一：带对勾的条目文字变 primary（:has(.check)，不再只有勾变色）", () => {
    const rule = block(styles, ".menu-item:has(.check)");
    expect(rule).toContain("color: hsl(var(--text-000))");
  });
});

describe("批 5：权限菜单（图标 + 两行 + 危险标签 + 自动二次确认）", () => {
  const html = (mode: PermissionMode = "default"): string =>
    renderToStaticMarkup(
      <PermissionMenu mode={mode} onModeChange={() => undefined} onClose={() => undefined} />,
    );

  it("五档每项：图标（perm-ico×5）+ 标题 + 副标题两行；无旧 risk-dot", () => {
    const h = html();
    for (const s of ["只读", "默认", "引导", "自动", "完全允许"]) expect(h).toContain(s);
    // auto 那行的副标题口径 2026-10-16 改过：旧文案「全部放行（出网仍审批）」是名不副实的
    // （MODE_POLICY 里 auto 是 writeAsk:false 而 riskAskAt:"high"，高风险动作照样送审），
    // 业主据此判「切换没用」。现在判的是"它真的做什么"。
    for (const d of ["写工具一律拒", "写/跑逐次审批出卡", "低风险自动、高风险出卡", "低风险免批；高风险仍出卡", "不再出任何审批卡"]) {
      expect(h).toContain(d);
    }
    // 反向钉：那句谎话不许回来
    expect(h).not.toContain("全部放行");
    expect((h.match(/class="perm-ico/g) ?? []).length).toBe(5);
    expect((h.match(/class="perm-text"/g) ?? []).length).toBe(5);
    for (const m of ["read-only", "default", "guided", "auto", "full-access"]) expect(h).toContain(`data-mode="${m}"`);
    expect(h).not.toContain("risk-dot");
  });

  it("危险档（自动/完全允许）= warning 图标 +「危险」小标签恰两枚，不整行变色", () => {
    const h = html();
    expect(h).toContain('class="perm-ico warn"');
    expect((h.match(/危险<\/span>/g) ?? []).length).toBe(2);
    expect(h).toContain('class="tag-warn"');
  });

  it("选中态 = 右侧对勾恰一枚（当前档所在行）", () => {
    expect((html("guided").match(/class="check"/g) ?? []).length).toBe(1);
    const h = html("guided");
    const guidedAt = h.indexOf('data-mode="guided"');
    const autoAt = h.indexOf('data-mode="auto"');
    expect(h.indexOf('class="check"')).toBeGreaterThan(guidedAt);
    expect(h.indexOf('class="check"')).toBeLessThan(autoAt);
  });

  it("二次确认：点危险档先置 confirming（未确认不动权限），确认后才调 onModeChange + 关菜单", () => {
    // 列表行分支：危险档（自动/完全允许）且非当前档 ⇒ 只开确认，绝不直调
    expect(permSrc).toContain('if ((m === "auto" || m === "full-access") && props.mode !== m)');
    expect(permSrc).toContain("setConfirming(m)");
    expect(permSrc).toContain("props.onModeChange(target)");
    // 确认按钮才带 onModeChange + onClose 串联
    expect(permSrc).toMatch(/onConfirm[\s\S]{0,160}props\.onModeChange\(target\)[\s\S]{0,60}props\.onClose\(\)/);
    // 完全允许档有自己的确认文案
    expect(permSrc).toContain('props.mode === "full-access"');
  });

  it("确认卡文案：标题 + 危险说明 +〔取消 / 确认切换（danger）〕", () => {
    const h = renderToStaticMarkup(<PermissionConfirm mode="auto" onCancel={() => undefined} onConfirm={() => undefined} />);
    expect(h).toContain("切到「自动」权限档？");
    expect(h).toContain("不再逐次出卡");
    expect(h).toContain("出网仍要审批");
    expect(h).toContain("取消");
    expect(h).toContain("确认切换");
    expect(h).toContain("mini-btn danger");
  });

  it("重开菜单不残留确认态（真机实证 bug）：Composer 关菜单即卸载 PermissionMenu；确认路径显式清 confirming", () => {
    // ① Composer 以条件渲染挂载（menu !== "perm" 即卸载，confirming 随卸载清零）
    const composerSrc = readFileSync(new URL("../src/renderer/components/Composer.tsx", import.meta.url), "utf8");
    expect(composerSrc).toContain('{menu === "perm" && (');
    expect(composerSrc).toContain("<PermissionMenu");
    // ② 确认路径也显式清（防御：将来若改回常驻挂载，state 也不残留）
    expect(permSrc).toMatch(/onConfirm=\{\(\) => \{[\s\S]{0,240}setConfirming\(null\);/);
  });
});

describe("批 5：模型弹层（分段 selected=elevated / 未声明收成 info 行）", () => {
  it("思考分段：选中 = elevated 背景 + primary；未选 = secondary（不再近隐灰）", () => {
    // token 是 HSL 三元组——必须 hsl() 包裹（裸用 var() 是无效值：真机曾读回透明背景，判卷哨兵补上精确形态）
    expect(block(styles, '.th-row button[aria-pressed="true"]')).toContain("background: hsl(var(--bg-elevated))");
    expect(block(styles, '.th-row button[aria-pressed="true"]')).toContain("color: hsl(var(--text-000))");
    expect(block(styles, ".th-row button")).toContain("color: hsl(var(--text-200))");
  });

  it("未声明 reasoningEfforts：一行 info（th-info + 小图标 + 「了解如何配置」折叠），配置句收进折叠内", () => {
    const h = renderToStaticMarkup(
      <ModelMenu options={[]} value={null} onPick={() => undefined} onThinkingChange={() => undefined} thinkingSupported={false} />,
    );
    expect(h).toContain("th-info");
    expect(h).toContain("th-info-ico");
    expect(h).toContain("了解如何配置");
    expect(h).toContain("这家没提供思考能力");
    expect(h).toContain("reasoningEfforts");
    expect(h).toContain(".agent/providers.json");
    // 折叠件是原生 details（SSR 也在 DOM；展开零 JS）
    expect(h).toContain("<details");
    expect(h).toContain("<summary");
  });

  it(".th-why 去棕底：CSS 不含 risk 色/背景（形态从告警块降为说明文）", () => {
    const w = block(styles, ".th-why");
    expect(w).not.toContain("color-risk");
    expect(w).not.toContain("background");
  });
});

// 2026-10-17 真机实证：附件菜单与权限菜单开着时 Esc / 点外面都关不掉（Composer 只 import 了
// Popover 基座、漏了 usePopoverDismiss；模型菜单有）。这条钉住两个菜单都接 dismiss 且权限菜单
// 与 chip 同容器（锚点从 composer 卡左缘回到 chip）。
describe("附件 / 权限菜单可关闭（外点 + Esc）", () => {
  const src = readFileSync(new URL("../src/renderer/components/Composer.tsx", import.meta.url), "utf8");
  it("两个菜单都接 usePopoverDismiss", () => {
    expect(src).toContain('usePopoverDismiss(menu === "attach", closeMenu, attachWrapRef)');
    expect(src).toContain('usePopoverDismiss(menu === "perm", closeMenu, permWrapRef)');
    expect(src).toContain("ref={attachWrapRef}");
  });
  it("权限 chip 与菜单同容器（ref 落点 + 锚定）", () => {
    expect(src).toContain("ref={permWrapRef}");
    expect(src).toContain('style={{ position: "relative", display: "inline-flex" }}');
  });
});
