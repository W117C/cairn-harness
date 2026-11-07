// 控件强调色与品牌色分离（2026-10-21 · Claude v3 token 复核）。
//
// Claude v3 的三枚 token 各有明确职责，混用就会把「控件态」读成「品牌态」：
//   --cds-fill-accent  = role-accent-450 (blue-450) → 焦点环 / 实心填充
//   （2026-11-05 业主裁：选中边框/勾选框改走品牌陶土，控件蓝只留键盘焦点）
//   --cds-text-accent  = role-accent-600 (blue-600) → 强调**文字**（链接、选中项文字）
//   --cds-fill-brand   = clay-emphasized (#c6613f)  → 品牌填充（主按钮）
//
// 因此本仓拆成两枚：
//   --accent-control      = blue-450  → 环 / 填充 / 边框
//   --accent-control-text = blue-600  → 文字（450 当文字在亮底只有约 5.4:1，600 有 14:1+）
//   --accent-brand        = 陶土橙     → 品牌（发送键、品牌图标；2026-10-28 起不再用于侧栏选中条）
//
// 判据钉的是**分工**（哪一枚用在哪），不是"存在即绿"：把控件蓝换回品牌橙必须红。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url)), "utf8");
const TOKENS = readFileSync(fileURLToPath(new URL("../src/renderer/tokens.css", import.meta.url)), "utf8");

describe("权限菜单条目（2026-11-02 真机）", () => {
  it("档位色点进入菜单后仍有尺寸（此前只有 .ctl 里定义，菜单里 0×0 把图标挤错位）", () => {
    const dot = CSS.slice(
      CSS.indexOf(".perm-item .mode-dot"),
      CSS.indexOf("}", CSS.indexOf(".perm-item .mode-dot")),
    );
    expect(dot).toContain("width: 7px");
    expect(dot).toContain("height: 7px");
    expect(dot).toContain("flex: none");
  });
});

/** 取一条规则体（选择器 → 规则文本）。 */
const block = (selector: string): string => {
  const i = CSS.indexOf(selector);
  expect(i, `未找到规则：${selector}`).toBeGreaterThan(-1);
  return CSS.slice(i, CSS.indexOf("}", i));
};

describe("控件强调色与品牌色分工（Claude v3）", () => {
  it("两枚控件 token 各自钉住 v3 实值（blue-450 / blue-600）", () => {
    expect(TOKENS).toContain("--accent-control: 212.8 67.7% 50.2%;");
    expect(TOKENS).toContain("--accent-control-text: 213.6 72.3% 33.9%;");
    // 品牌陶土橙仍在（主按钮/品牌图标）
    expect(TOKENS).toContain("--accent-brand: 15 63.1% 59.6%;");
  });

  it("焦点环三层用控件蓝（v3 --cds-focus-shadow 用 --cds-fill-accent）", () => {
    const rule = block(":focus-visible {");
    // 真机亮色 ①② 两层满不透明；原实现误乘 60%（2026-10-30 更正）
    expect(rule).toContain("hsl(var(--accent-control))");
    expect(rule).toContain("hsl(var(--focus-ring-glow) / var(--focus-ring-glow-alpha))");
    expect(rule).not.toContain("accent-brand");
  });

  it("选中态分工：主题选项卡与权限档卡走品牌陶土（2026-11-05 业主裁决：点击后不要蓝框），chip 仍控件蓝", () => {
    // 2026-11-05 变更：权限档卡（.ss-opt.on）此前跟 chip 一起用控件蓝，点击后是一圈蓝框 +
    // 8% 蓝底，业主读成「焦点框残留在页面上」。选中态改走品牌陶土，与主题选项卡同取值；
    // 控件蓝只留给键盘 :focus-visible 环（见下一条）。chip 是轻量标签态，不在本次裁决面内。
    for (const sel of [".theme-opt.on {", ".ss-opt.on {"]) {
      const rule = block(sel);
      expect(rule, sel).toContain("accent-brand");
      expect(rule, sel).not.toContain("accent-control");
    }
    const chipRule = block(".chip.on {");
    expect(chipRule).toContain("accent-control");
    expect(chipRule).not.toContain("accent-brand");
  });

  it("原生勾选框不吃控件蓝（2026-11-05）：点选后是品牌色方块，不是浏览器默认蓝", () => {
    expect(CSS).toContain('input[type="checkbox"], input[type="radio"] { accent-color: hsl(var(--accent-brand)); }');
    const network = readFileSync(fileURLToPath(new URL("../src/renderer/components/settings/network-settings.css", import.meta.url)), "utf8");
    expect(network).toContain("accent-color: hsl(var(--accent-brand))");
    expect(network).not.toContain("accent-color: hsl(var(--accent-control))");
  });

  it("焦点环外发光分主题：亮 blue-100 不透明 / 暗 blue-600 60%（v3 --cds-focus-shadow 实测）", () => {
    // 真机亮色第③层 = #cde2fb 满不透明；暗色 = hsl(from #184f95 h s l / 60%)。
    // 暗色那层**不是** --bg-accent（blue-800 #032042）——按它推导会比蓝本暗一档。
    expect(TOKENS).toContain("--focus-ring-glow: 212.6 85.2% 89.4%;");
    expect(TOKENS).toContain("--focus-ring-glow-alpha: 100%;");
    const darkAt = TOKENS.indexOf('[data-theme="dark"] {');
    const darkBlock = TOKENS.slice(darkAt);
    expect(darkBlock).toContain("--focus-ring-glow: 213.6 72.3% 33.9%;");
    expect(darkBlock).toContain("--focus-ring-glow-alpha: 60%;");
  });

  it("强调文字分主题：亮色 blue-600、暗色 blue-300（v3 暗色 scope 用 role-accent-300）", () => {
    // v3 实测：亮色 `--cds-text-accent` = role-accent-600；暗色 scope 改成 role-accent-300。
    expect(TOKENS).toContain("--accent-control-text: 213.6 72.3% 33.9%;");
    const darkAt = TOKENS.indexOf('[data-theme="dark"] {');
    const darkBlock = TOKENS.slice(darkAt);
    // 判卷更正（第 881 页）：本条注释一直写着「暗色 blue-300」，字面却钉着 210 70.9% 51.6%
    // ——那是**亮档** role-accent-300 的值。官方 blue-300 = #6da7ec ≈ 210 65.5% 67.1%，
    // 也正是暗档 --role-accent-300 的值。原意不变（暗色用 blue-300），把字面修成它描述的档。
    expect(darkBlock).toContain("--accent-control-text: 210 65.5% 67.1%;");
    expect(darkBlock).toContain("--role-accent-300: 210 65.5% 67.1%;");
    // 反向自证：退回亮档值（51.6%）必须红
    expect(darkBlock).not.toContain("--accent-control-text: 210 70.9% 51.6%;");
  });

  it("强调文字（链接 / 选中项文字 / 菜单勾）用 blue-600 那一枚", () => {
    for (const sel of [".ap-index-line a {", ".ap-body-line a {", ".menu-item .check {"]) {
      const rule = block(sel);
      expect(rule, sel).toContain("accent-control-text");
      expect(rule, sel).not.toContain("accent-brand");
    }
  });

  it("起手行悬停不走色相（第 872 页）：整行已用中性对比表态，图标不再变珊瑚", () => {
    const rule = block(".start:hover .start-icon, .start:focus-visible .start-icon {");
    expect(rule).not.toBe("");
    expect(rule).toContain("hsl(var(--text-000))");
    expect(rule).not.toContain("accent-brand");
    // 反向自证：同一条若改回色相，本判卷必须红（不是恒真断言）。
    expect(rule.replace("hsl(var(--text-000))", "hsl(var(--accent-brand))")).toContain("accent-brand");
  });

  it("品牌橙仍留在品牌位（主按钮发送键、品牌图标）", () => {
    // 2026-10-28 第 735 页：当前会话的 2px 橙条已撤（暗色下像警示轨）；品牌橙不再用于侧栏选中态。
    expect(block(".send-btn {")).toContain("hsl(var(--accent-brand))");
    expect(block(".empty-greet-mark {")).toContain("hsl(var(--accent-brand))");
    expect(CSS).not.toMatch(/\.session\.active::before\s*\{/);
  });
});
