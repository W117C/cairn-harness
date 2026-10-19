// 动效缺口判卷（2026-10-18 批）：把「同一应用里四种模态两种待遇」这类不一致钉住。
//
// 本批修的问题（全部真机可见）：
//   ① 发送钮两条 transition 声明，后一条把前一条整条覆盖 ⇒ opacity 被静默踢出名单，
//      而 :hover{opacity:.88} 仍指着它 ⇒ 悬停淡入实际是瞬变（想动的属性没进过渡名单）。
//   ② 模态族不一致：⌘/ 速查表、命令面板、确认卡都有 scrim-in + panel-in，
//      而新建项目/项目设置（modal-backdrop/modal-card）、自定义接口弹窗（cp-overlay/cp-modal）、
//      设置整页（sp-page）一条动画都没有 ⇒ 按 ⌘, 是硬切，像另一个产品。
//   ③ 右键菜单（ctx-menu）与 path-menu 三族浮层里唯独它没有进场动画。
//   ④ 用量环 stroke-dashoffset 无过渡 ⇒ 上下文百分比逐帧跳变（环的意义就在平滑扫过）。
//   ⑤ 拖侧栏宽度与「收起过渡」抢同一个 width 属性 ⇒ 把手肉眼可见落后于光标。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url)), "utf8");
const appSrc = readFileSync(fileURLToPath(new URL("../src/renderer/App.tsx", import.meta.url)), "utf8");

/** 取某个选择器规则体（{…}）。选择器不存在返回 ""。 */
function ruleOf(selector: string): string {
  const at = css.indexOf(selector);
  if (at === -1) return "";
  const open = css.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) return css.slice(open, i + 1);
    }
  }
  return "";
}

describe("动效批：过渡名单不许丢属性", () => {
  it("发送钮只有一条 transition，且 opacity 在名单里", () => {
    // 覆盖丢属性的判据：数 transition 声明条数（.send-btn 只许一条），
    // 且该条必须含 opacity——否则 :hover 的 opacity 淡入是死的。
    const sendRules = css.match(/\.send-btn\s*\{[^}]*\}/g) ?? [];
    const withTransition = sendRules.filter((r) => r.includes("transition:"));
    expect(withTransition).toHaveLength(1);
    expect(withTransition[0]).toContain("opacity var(--t-fast)");
    expect(withTransition[0]).toContain("transform var(--t-fast)");
    // 不再有第二条把它盖掉
    expect(withTransition[0]).not.toMatch(/transition:[^;]*background-color[^;]*;[^}]*transition:/s);
  });

  it("usage-ring 的弧线过渡 stroke-dashoffset", () => {
    expect(ruleOf(".usage-ring .ur-bar")).toContain("stroke-dashoffset var(--t-med)");
  });
});

describe("动效批：模态族一致（scrim + panel 成对出现）", () => {
  // 遮罩（半透明幕布）淡入；卡片上浮。sp-page 是整页覆盖（不是遮罩）⇒ 走 fade-in 即可。
  const scrims = [".modal-backdrop", ".cp-overlay"];
  const cards = [".modal-card", ".cp-modal"];

  it("遮罩都走 scrim-in（淡入，时长走 token）", () => {
    for (const s of scrims) {
      const r = ruleOf(s);
      expect(r, `${s} 缺少 scrim-in`).toContain("animation: scrim-in var(--t-med)");
    }
  });

  it("设置整页有进场（此前硬切）", () => {
    expect(ruleOf(".sp-page")).toContain("animation: fade-in var(--t-med)");
  });

  it("卡片都走 panel-in，且用 --t-slow（占地的位移要给足）", () => {
    for (const c of cards) {
      const r = ruleOf(c);
      expect(r, `${c} 缺少 panel-in`).toContain("animation: panel-in var(--t-slow)");
    }
  });

  it("既有三族模态没被改坏（速查表/命令面板/确认卡）", () => {
    expect(css).toContain(".sheet-scrim, .cp-scrim, .confirm-scrim { animation: scrim-in var(--t-fast); }");
    expect(css).toContain(".sheet, .confirm-card { animation: panel-in var(--t-med); }");
  });
});

describe("动效批：浮层族一致进场", () => {
  it("pop.show 走 pop-in；向上开的走 pop-in-up（方向感）", () => {
    expect(ruleOf(".pop.show")).toContain("animation: pop-in var(--t-fast)");
    expect(ruleOf(".pop.up.show")).toContain("animation-name: pop-in-up");
  });

  it("pop-rd / path-menu / ctx-menu 三族自绘浮层都有进场（ctx-menu 此前是硬闪）", () => {
    expect(ruleOf(".pop-rd")).toContain("animation: pop-in var(--t-fast)");
    expect(ruleOf(".path-menu")).toContain("animation: pop-in var(--t-fast)");
    expect(ruleOf(".ctx-menu")).toContain("animation: pop-in var(--t-fast)");
  });

  it("pop-in 系 keyframes 只动 transform/opacity（合成器属性，不触发重排）", () => {
    const popIn = css.slice(css.indexOf("@keyframes pop-in {"), css.indexOf("@keyframes pop-in-up {"));
    expect(popIn).toContain("opacity");
    expect(popIn).toContain("transform");
    expect(popIn).not.toMatch(/(width|height|margin|top|left|padding)\s*:/);
  });
});

describe("动效批：拖拽与过渡不抢同一个属性", () => {
  it("拖侧栏宽度期间关掉宽度过渡（否则把手落后于光标 140ms）", () => {
    expect(css).toContain('body[data-resizing="sidebar"] .side-wrap { transition: none; }');
    // 收起过渡本身必须还在（这条不能为了修拖拽被删掉）
    expect(ruleOf(".side-wrap")).toContain("transition: width var(--t-fast)");
  });

  it("App 在拖拽起止置/清 data-resizing", () => {
    expect(appSrc).toContain('document.body.dataset.resizing = "sidebar"');
    expect(appSrc).toContain("delete document.body.dataset.resizing");
  });
});

describe("动效刻度（token 纪律）", () => {
  it("时长三档 + 缓动两族都在 tokens.css 里，且被消费", () => {
    const tokens = readFileSync(fileURLToPath(new URL("../src/renderer/tokens.css", import.meta.url)), "utf8");
    for (const t of ["--t-instant:", "--t-fast:", "--t-med:", "--t-slow:", "--ease-out-quint:"]) {
      expect(tokens, `${t} 缺失`).toContain(t);
    }
    // 新档不能只是摆着：至少各有一个消费点
    expect(css).toContain("var(--t-slow)");
    expect(css).toContain("var(--t-med)");
  });

  it("prefers-reduced-motion 仍整域让路（新加的成分不逃出去）", () => {
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toMatch(/transition-duration:\s*0\.01ms !important/);
    expect(css).toMatch(/animation-duration:\s*0\.01ms !important/);
  });
});
