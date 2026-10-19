// tokens 重钉判卷（业主《全局 UI 视觉重构》brief §一，2026-10-16「按清单开做」批 · 阶段 1）：
// brief 原文定值（hex）⇒ tokens.css 以 HSL 三元组直落 + hex 注释保可追溯；亮色给同构一套。
// 纪律：组件零字面色值——styles.css 文面禁 hex/rgb 字面量（色值只许进 tokens.css）。
// 钉的是**定值**（不是结构）：改任何一枚都得先改这里是共识。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const tokens = readFileSync(fileURLToPath(new URL("../src/renderer/tokens.css", import.meta.url)), "utf8");
const styles = readFileSync(fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url)), "utf8");

type Rgb = readonly [number, number, number];

function themeBlock(name: "light" | "dark"): string {
  const darkAt = tokens.search(/\[data-theme="dark"\]\s*\{/);
  return name === "light" ? tokens.slice(0, darkAt) : tokens.slice(darkAt);
}

function tokenRgb(block: string, name: string): Rgb {
  const match = block.match(new RegExp(`--${name}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%;`));
  if (match === null) throw new Error(`缺少 HSL token: ${name}`);
  const h = Number(match[1]) / 360;
  const s = Number(match[2]) / 100;
  const l = Number(match[3]) / 100;
  const hue = (p: number, q: number, t: number): number => {
    let v = t;
    if (v < 0) v += 1;
    if (v > 1) v -= 1;
    if (v < 1 / 6) return p + (q - p) * 6 * v;
    if (v < 1 / 2) return q;
    if (v < 2 / 3) return p + (q - p) * (2 / 3 - v) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return s === 0
    ? [l * 255, l * 255, l * 255]
    : [hue(p, q, h + 1 / 3) * 255, hue(p, q, h) * 255, hue(p, q, h - 1 / 3) * 255];
}

function contrast(a: Rgb, b: Rgb): number {
  const luminance = (rgb: Rgb): number => {
    const [r, g, blue] = rgb.map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * blue;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe("暗色分层与文字（2026-10-17 Claude 暖暗盘 · 规范 §4.1 定值）", () => {
  it("四件套：base / sidebar / surface / elevated", () => {
    expect(tokens).toMatch(/--bg-100:\s*60 2\.7% 14\.5%;/);      // base #262624
    expect(tokens).toMatch(/--bg-200:\s*60 3\.3% 11\.8%;/);       // sidebar #1F1E1D
    expect(tokens).toMatch(/--bg-000:\s*60 2\.1% 18\.4%;/);       // surface #30302E
    expect(tokens).toMatch(/--bg-elevated:\s*60 2\.8% 21\.4%;/);  // elevated #383835
    for (const hex of ["#262624", "#1F1E1D", "#30302E", "#383835"]) expect(tokens).toContain(hex);
  });

  it("文字三档 + 描边两档（描边跟文字主色走，暖白 8% / 13%）", () => {
    expect(tokens).toMatch(/--text-000:\s*48 33\.3% 97\.1%;/);   // #FAF9F5
    expect(tokens).toMatch(/--text-200:\s*50 9% 73\.7%;/);       // #C2C0B6
    expect(tokens).toMatch(/--text-400:\s*48 5\.4% 63\.9%;/);    // #A8A69E
    expect(tokens).toMatch(/--hairline:\s*hsl\(var\(--text-000\) \/ 8%\);/);
    expect(tokens).toMatch(/--hairline-strong:\s*hsl\(var\(--text-000\) \/ 13%\);/);
  });

  it("用户气泡底按主题取方向（亮 = bg-300 深一档 / 暗 = bg-000 亮一档）", () => {
    const dark = tokens.slice(tokens.search(/\[data-theme="dark"\]\s*\{/));
    const light = tokens.slice(0, tokens.search(/\[data-theme="dark"\]\s*\{/));
    expect(light).toMatch(/--user-bubble-bg:\s*hsl\(var\(--bg-300\)\);/);
    expect(dark).toMatch(/--user-bubble-bg:\s*hsl\(var\(--bg-000\)\);/);
  });

  it("主按钮语义：暗色 = 抬升暖面 + 亮字（不是「text-000 当底」翻成白底黑字）", () => {
    const dark = tokens.slice(tokens.search(/\[data-theme="dark"\]\s*\{/));
    expect(dark).toMatch(/--btn-primary-bg:\s*hsl\(var\(--bg-elevated\)\);/);
    expect(dark).toMatch(/--btn-primary-fg:\s*hsl\(var\(--text-000\)\);/);
    expect(dark).not.toMatch(/--btn-primary-bg:\s*hsl\(var\(--text-000\)\);/);
  });

  it("语义三色：success / warning(risk) / danger", () => {
    expect(tokens).toMatch(/--success:\s*142 69\.2% 58%;/);        // #4ADE80
    expect(tokens).toMatch(/--color-risk:\s*38\.3 89\.9% 61\.4%;/); // #F5B544
    expect(tokens).toMatch(/--color-danger:\s*0 90\.6% 70\.8%;/);   // #F87171
    for (const hex of ["#4ADE80", "#F5B544", "#F87171"]) expect(tokens).toContain(hex);
  });
});

describe("亮色同构一套（Claude 暖米白画布）", () => {
  it("分层 / 文字 / 描边成对出现", () => {
    expect(tokens).toMatch(/--bg-100:\s*48 33\.3% 97\.1%;/);   // base #FAF9F5
    expect(tokens).toMatch(/--bg-200:\s*52\.5 28\.6% 94\.5%;/); // sidebar #F5F4ED
    expect(tokens).toMatch(/--bg-000:\s*0 0% 100%;/);        // surface #FFFFFF
    expect(tokens).toMatch(/--bg-elevated:\s*0 0% 100%;/);
    expect(tokens).toMatch(/--text-000:\s*60 2\.6% 7\.6%;/); // #141413
    expect(tokens).toMatch(/--text-200:\s*60 2\.5% 23\.3%;/); // #3D3D3A
    expect(tokens).toMatch(/--text-400:\s*48 5\.2% 37\.8%;/); // #66655C（正常字号 ≥4.5:1）
    expect(tokens).toMatch(/--hairline:\s*hsl\(var\(--text-000\) \/ 8%\);/);
  });

  it("暖色盘同族：中性色相落在暖侧（40–70°），不回落冷灰蓝（200–250°）", () => {
    const light = tokens.slice(0, tokens.search(/\[data-theme="dark"\]\s*\{/));
    for (const token of ["--bg-100", "--bg-200", "--bg-300", "--text-000", "--text-200", "--text-400"]) {
      const m = light.match(new RegExp(`${token}:\\s*([\\d.]+)\\s`));
      expect(m, token).not.toBeNull();
      const h = Number(m![1]);
      expect(h >= 40 && h <= 70, `${token} 色相 ${String(h)} 应在暖侧`).toBe(true);
    }
  });
});

describe("刻度重钉：4px 栅格 / 圆角三档 / 正文字号 / 阅读列 / 过渡区间", () => {
  it("圆角收敛 6 / 10 / 14", () => {
    expect(tokens).toMatch(/--radius-sm:\s*calc\(0\.375rem \* var\(--rem-scale\)\);/);     // 6
    expect(tokens).toMatch(/--radius-md:\s*calc\(0\.625rem \* var\(--rem-scale\)\);/);     // 10
    expect(tokens).toMatch(/--radius-composer:\s*calc\(0\.875rem \* var\(--rem-scale\)\);/); // 14
  });

  it("正文 14.5 / 辅助 12.5 / 间距下探到 4 档", () => {
    expect(tokens).toMatch(/--fs-body-md:\s*calc\(0\.90625rem \* var\(--rem-scale\)\);/); // 14.5
    expect(tokens).toMatch(/--fs-caption-md:\s*calc\(0\.78125rem \* var\(--rem-scale\)\);/); // 12.5
    expect(tokens).toMatch(/--space-xs:\s*calc\(0\.25rem \* var\(--rem-scale\)\);/); // 4
  });

  it("阅读列 760px（P3-1 收口：brief 六 · 内容列限宽 760）；过渡 140ms ease-out（120–160ms 区间内）", () => {
    expect(tokens).toMatch(/--reading:\s*47\.5rem;/);
    expect(tokens).toMatch(/--t-fast:\s*140ms ease-out;/);
  });
});

describe("样式层纪律与四态", () => {
  it("正常字号辅助文字在双主题全部基底上达到 WCAG AA 4.5:1", () => {
    const backgrounds = ["bg-000", "bg-100", "bg-200", "bg-300", "bg-elevated"];
    for (const theme of ["light", "dark"] as const) {
      const block = themeBlock(theme);
      for (const text of ["text-200", "text-400", "text-500"]) {
        for (const background of backgrounds) {
          const ratio = contrast(tokenRgb(block, text), tokenRgb(block, background));
          expect(ratio, `${theme} ${text} on ${background}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it("输入占位符与选中模板说明使用可读语义色，不落回浏览器 UA 灰", () => {
    expect(styles).toMatch(
      /input::placeholder,\s*textarea::placeholder\s*\{[^}]*color:\s*hsl\(var\(--text-400\)\);[^}]*opacity:\s*1;/s,
    );
    expect(styles).toMatch(/\.tpl-desc\s*\{[^}]*color:\s*hsl\(var\(--text-200\)\);/s);
  });

  it("sonner 提示两主题都吃语义色（暗色不再弹白卡）", () => {
    const block = styles.slice(styles.indexOf('[data-sonner-toaster][data-sonner-theme="light"]'));
    expect(block).toContain('data-sonner-theme="dark"');
    expect(block).toMatch(/--normal-bg:\s*hsl\(var\(--bg-elevated\)\)/);
    expect(block).toMatch(/--normal-text:\s*hsl\(var\(--text-000\)\)/);
  });

  it("styles.css 零字面色值（hex / rgb 字面量全清）", () => {
    expect(styles).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(styles).not.toMatch(/\brgb[ (a]?/);
  });

  it("正文行高 1.7（body 基线）", () => {
    expect(styles).toMatch(/font:\s*var\(--fs-md\)\s*\/\s*1\.7/);
  });

  it("权限档色点四枚（P2-2 · 双主题各给值 + 语义别名消费面）", () => {
    // 亮色（:root 段）：灰绿 / 蓝灰 / 黄 / 红
    expect(tokens).toMatch(/--color-mode-readonly:\s*145 14\.4% 49%;/);
    expect(tokens).toMatch(/--color-mode-default:\s*218 19% 44%;/);
    expect(tokens).toMatch(/--color-mode-guided:\s*32\.1 94\.6% 43\.7%;/);
    expect(tokens).toMatch(/--color-mode-auto:\s*0 72\.2% 50\.6%;/);
    // 暗色提亮同构一套
    expect(tokens).toMatch(/--color-mode-readonly:\s*145 18% 62%;/);
    expect(tokens).toMatch(/--color-mode-auto:\s*0 90\.6% 70\.8%;/);
    // 语义别名经 hsl(var()) 消费（裸三元组直用判卷记忆坑：别名层不许复制色值）
    expect(tokens).toMatch(/--mode-readonly:\s*hsl\(var\(--color-mode-readonly\)\);/);
    expect(tokens).toMatch(/--mode-auto:\s*hsl\(var\(--color-mode-auto\)\);/);
  });

  it("紧凑控件族有按下态（:active）", () => {
    for (const sel of [".iconbtn:active", ".mini-btn:active", ".ctl:active", ".menu-item:active", ".session:active"]) {
      expect(styles).toContain(sel);
    }
  });
});
