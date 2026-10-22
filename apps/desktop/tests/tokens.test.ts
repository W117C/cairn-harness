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

describe("暗色分层与文字（2026-10-20 真机还原更正 · 原 2026-10-17 #262624 系作废）", () => {
  it("四件套：base / sidebar / surface / elevated（暗色越抬升越亮，与亮色同向）", () => {
    // 2026-10-20 更正：Claude 真机主区底实测 rgb(21,21,21)=#151515（gray-850），
    // 推翻原规范「越抬升越暗（#000→#262624→#30302E）」。方向改为与亮色一致。
    expect(tokens).toMatch(/--bg-100:\s*0 0% 8\.2%;/);          // base #151515 ← 真机实测
    expect(tokens).toMatch(/--bg-000:\s*60 3\.4% 11\.8%;/);     // 最底 #1F1E1D
    expect(tokens).toMatch(/--bg-200:\s*60 2\.4% 16\.5%;/);     // sidebar/卡片 #2A2A28
    expect(tokens).toMatch(/--bg-elevated:\s*60 2% 21\.6%;/);   // elevated #383836
    for (const hex of ["#151515", "#1F1E1D", "#2A2A28", "#383836"]) expect(tokens).toContain(hex);
    // 方向断言：越抬升越亮（base < 最底 < sidebar），取代原「越抬升越暗」的反向断言。
    // 取 HSL 三元组第三个分量（L%）——不能用"第一个 %"，那是饱和度 S。
    const lum = (hsl: string) => Number(/(\d+(?:\.\d+)?)%\s*$/.exec(hsl.trim())?.[1] ?? 0);
    expect(lum("0 0% 8.2%")).toBeLessThan(lum("60 3.4% 11.8%"));
    expect(lum("60 3.4% 11.8%")).toBeLessThan(lum("60 2.4% 16.5%"));
    expect(lum("60 2.4% 16.5%")).toBeLessThan(lum("60 2% 21.6%"));
  });

  it("文字三档 + 描边两档（描边跟文字主色走，暖白 8% / 13%）", () => {
    expect(tokens).toMatch(/--text-000:\s*48 33\.3% 97\.1%;/);   // #FAF9F5
    expect(tokens).toMatch(/--text-200:\s*50 9% 73\.7%;/);       // #C2C0B6
    expect(tokens).toMatch(/--text-400:\s*48 5\.4% 63\.9%;/);    // #A8A69E
    expect(tokens).toMatch(/--hairline:\s*hsl\(var\(--text-000\) \/ 8%\);/);
    expect(tokens).toMatch(/--hairline-strong:\s*hsl\(var\(--text-000\) \/ 13%\);/);
  });

  it("用户气泡底按主题取方向（两个主题都是「比画布亮/深一档」，同向）", () => {
    const dark = tokens.slice(tokens.search(/\[data-theme="dark"\]\s*\{/));
    const light = tokens.slice(0, tokens.search(/\[data-theme="dark"\]\s*\{/));
    expect(light).toMatch(/--user-bubble-bg:\s*hsl\(var\(--bg-300\)\);/);
    // 2026-10-20 更正：暗色与亮色同向——都取「比画布深/亮一档」的 bg-300，
    // 不再反向取 bg-000（原方向断言建立在「暗色越抬升越暗」这个已被推翻的前提上）。
    expect(dark).toMatch(/--user-bubble-bg:\s*hsl\(var\(--bg-300\)\);/);
  });

  it("主按钮语义：暗色 = 抬升暖面 + 亮字（不是「text-000 当底」翻成白底黑字）", () => {
    const dark = tokens.slice(tokens.search(/\[data-theme="dark"\]\s*\{/));
    expect(dark).toMatch(/--btn-primary-bg:\s*hsl\(var\(--bg-elevated\)\);/);
    expect(dark).toMatch(/--btn-primary-fg:\s*hsl\(var\(--text-000\)\);/);
    expect(dark).not.toMatch(/--btn-primary-bg:\s*hsl\(var\(--text-000\)\);/);
  });

  it("语义三色挂角色层（亮暗分档由角色承担，语义层只写引用）", () => {
    // 2026-10-20：success/risk/danger 改为引用 role-* 而非写死色值。
    // 这样暗色块只需重定义 role-*，语义名自动换档——组件始终只写一个名。
    expect(tokens).toMatch(/--success:\s*var\(--role-success-450\);/);
    expect(tokens).toMatch(/--color-risk:\s*var\(--role-warning-450\);/);
    expect(tokens).toMatch(/--color-danger:\s*var\(--role-danger-300\);/);
  });

  it("角色层四族齐全（accent / danger / success / warning），每族带 fill / fill-hover / on", () => {
    for (const role of ["accent", "danger", "success", "warning"]) {
      // 刻度族
      for (const step of ["50", "100", "250", "300", "400", "450", "600", "700", "800"]) {
        expect(tokens, `--role-${role}-${step}`).toMatch(new RegExp(`--role-${role}-${step}:\\s`));
      }
      // 派生位（Claude 实测接法：fill=450、fill-hover=400、on=前景色）
      expect(tokens, `--role-${role}-fill`).toMatch(new RegExp(`--role-${role}-fill:\\s*var\\(--role-${role}-450\\);`));
      expect(tokens, `--role-${role}-fill-hover`).toMatch(new RegExp(`--role-${role}-fill-hover:\\s*var\\(--role-${role}-400\\);`));
      expect(tokens, `--role-${role}-on`).toMatch(new RegExp(`--role-${role}-on:\\s`));
    }
  });

  it("暗色块只重定义角色层，不重复定义语义三色（分档单一事实源）", () => {
    const dark = tokens.slice(tokens.search(/\[data-theme="dark"\]\s*\{/));
    // 角色层在暗色块里有重定义
    expect(dark).toMatch(/--role-success-450:\s*97 75% 32\.9%;/);
    expect(dark).toMatch(/--role-danger-300:\s*0 90\.6% 70\.8%;/);
    expect(dark).toMatch(/--role-warning-450:\s*38\.3 89\.9% 61\.4%;/);
    // 语义三色在暗色块里**不**应再写死色值（否则角色层形同虚设）
    expect(dark).not.toMatch(/--success:\s*\d/);
    expect(dark).not.toMatch(/--color-danger:\s*\d/);
    expect(dark).not.toMatch(/--color-risk:\s*\d/);
  });

  it("语义三色解析：亮暗各自落在不同档（角色翻转生效）", () => {
    const light = tokens.slice(0, tokens.search(/\[data-theme="dark"\]\s*\{/));
    const dark = tokens.slice(tokens.search(/\[data-theme="dark"\]\s*\{/));
    const pick = (src: string, name: string) => new RegExp(`${name}:\\s*([^;]+);`).exec(src)?.[1]?.trim();
    // 亮色 success 取深侧（103°），暗色取提亮侧（97° 且 L 更高）
    expect(pick(light, "--role-success-450")).toMatch(/^103 72\.3% 26\.9%$/);
    expect(pick(dark, "--role-success-450")).toMatch(/^97 75% 32\.9%$/);
    // danger 亮色 50.6% vs 暗色 70.8% —— 暗色必须更亮
    expect(pick(light, "--role-danger-300")).toBe("0 72.2% 50.6%");
    expect(pick(dark, "--role-danger-300")).toBe("0 90.6% 70.8%");
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

describe("字重纪律（2026-10-20）", () => {
  it("组件样式层不许再写裸字重——统一走 --fw-* 令牌（暗色减重才生效）", () => {
    // 存量 61 处已全量迁移。留这条守卫：新写 `font-weight: 600` 会在暗色里偏重且无从统一调。
    const bare = [...styles.matchAll(/font-weight:\s*(400|500|550|600|700)\b/g)].map((m) => m[0]);
    expect(bare, `样式层仍有裸字重：${bare.join(", ")}`).toEqual([]);
  });

  it("字重令牌在双主题都有定义（漏一档 ⇒ 暗色 var 悬空、退回继承）", () => {
    const light = tokens.slice(0, tokens.search(/\[data-theme="dark"\]\s*\{/));
    const dark = tokens.slice(tokens.search(/\[data-theme="dark"\]\s*\{/));
    for (const n of ["--fw-regular", "--fw-medium", "--fw-semibold", "--fw-bold", "--fw-heavy"]) {
      expect(light, n).toMatch(new RegExp(`${n}:\\s*\\d+;`));
      expect(dark, n).toMatch(new RegExp(`${n}:\\s*\\d+;`));
    }
  });
});

describe("动效刻度（2026-10-20 · Claude 实测 5 档时长 × 4 缓动）", () => {
  it("五档时长齐备，且都在 Claude 实测值上", () => {
    for (const [name, val] of [
      ["--t-instant", "60ms"], ["--t-fast", "140ms"], ["--t-med", "200ms"],
      ["--t-slow", "300ms"], ["--t-slowest", "450ms"],
    ] as const) {
      expect(tokens, name).toMatch(new RegExp(`${name}:\\s*${val} `));
    }
  });

  it("四族缓动齐备，Claude 实测曲线逐位一致", () => {
    expect(tokens).toContain("--ease-out: cubic-bezier(0.165, 0.84, 0.44, 1)");
    expect(tokens).toContain("--ease-snap: cubic-bezier(0.32, 0.72, 0, 1)");
    expect(tokens).toContain("--ease-overshoot: cubic-bezier(0.34, 1.3, 0.64, 1)");
    expect(tokens).toContain("--ease-out-quint: cubic-bezier(0.22, 1, 0.36, 1)");
  });

  it("时长令牌不写裸缓动（缓动必须走 --ease-* 令牌，防同动作跨组件不一致）", () => {
    const ladders = [...tokens.matchAll(/--t-(?:instant|fast|med|slow|slowest):\s*([^;]+);/g)].map((m) => m[1]);
    expect(ladders.length).toBeGreaterThanOrEqual(5);
    for (const v of ladders) expect(v).toContain("var(--ease-");
  });
});

describe("字重刻度（2026-10-22 按 Claude v3 暗色轴实测更正 · 亮色 2026-10-20 建）", () => {
  it("五档语义字重齐备，semibold = 580（不是 600）", () => {
    expect(tokens).toMatch(/--fw-regular:\s*400;/);
    expect(tokens).toMatch(/--fw-medium:\s*500;/);
    expect(tokens).toMatch(/--fw-semibold:\s*580;/);
    expect(tokens).toMatch(/--fw-bold:\s*600;/);
    expect(tokens).toMatch(/--fw-heavy:\s*700;/);
  });

  it("暗色换的是**可变字体轴实例** 360/460/540/560（四档各减 40），不是逐档减 20", () => {
    // 实测源：/Applications/Claude.app v3.1623.0（app.asar sha 760e7cbb…）的
    // `.vite/renderer/main_window/assets/MainWindowPage-Bbug2Ph5.css`：
    //   亮色作用域 `--cds-font-weight-*` = 400 / 500 / 580 / 600；
    //   暗色作用域 `--cds-font-wght-*` = "wght" 360 / 460 / 540 / 560
    //   （三个暗色作用域一致：[data-mode=dark] .cds-root、prefers-color-scheme:dark + [data-mode=system]、
    //    .cds-dark-scope[data-mode=dark]）。
    // 本仓此前写成 360/480/560/580 —— medium 与 semibold 仍是按「逐档减 20」推的，与蓝本不符。
    const dark = tokens.slice(tokens.search(/\[data-theme="dark"\]\s*\{/));
    expect(dark).toMatch(/--fw-regular:\s*360;/);
    expect(dark).toMatch(/--fw-medium:\s*460;/);
    expect(dark).toMatch(/--fw-semibold:\s*540;/);
    expect(dark).toMatch(/--fw-bold:\s*560;/);
    // 暗色每一档都必须 ≤ 亮色同名档（减重，不是加重）
    const light = tokens.slice(0, tokens.search(/\[data-theme="dark"\]\s*\{/));
    const pick = (src: string, n: string) => Number(new RegExp(`${n}:\\s*(\\d+);`).exec(src)?.[1] ?? -1);
    for (const n of ["--fw-regular", "--fw-medium", "--fw-semibold", "--fw-bold", "--fw-heavy"]) {
      expect(pick(dark, n), n).toBeLessThanOrEqual(pick(light, n));
    }
    // 蓝本四档**各减 40**（heavy 是 Cairn 自有档，蓝本没有 ⇒ 不参与这条断言）。
    for (const n of ["--fw-regular", "--fw-medium", "--fw-semibold", "--fw-bold"]) {
      expect(pick(light, n) - pick(dark, n), n).toBe(40);
    }
  });
});

describe("刻度重钉：4px 栅格 / 圆角三档 / 正文字号 / 阅读列 / 过渡区间", () => {
  it("圆角收敛 6 / 10 / 14", () => {
    expect(tokens).toMatch(/--radius-sm:\s*calc\(0\.375rem \* var\(--size-scale\)\);/);     // 6
    expect(tokens).toMatch(/--radius-md:\s*calc\(0\.625rem \* var\(--size-scale\)\);/);     // 10
    expect(tokens).toMatch(/--radius-composer:\s*calc\(0\.875rem \* var\(--size-scale\)\);/); // 14
  });

  it("正文 14 / caption 四档 10·11·12·13 / 间距下探到 4 档（业主 §4.4 刻度，2026-10-21 更正）", () => {
    // 业主 §4.4：caption .625/.6875/.75/.8125（10/11/12/13）＋ body .75/.8125/.875/.9375（12/13/14/15）。
    // 此前实现把 caption 三档压平成 12.5、body-md 落 14.5（不在四档里）⇒ 按规格与 v3 实测改回。
    expect(tokens).toMatch(/--fs-body-md:\s*calc\(0\.875rem \* var\(--rem-scale\)\);/); // 14
    expect(tokens).toMatch(/--fs-body-sm:\s*calc\(0\.8125rem \* var\(--rem-scale\)\);/); // 13
    expect(tokens).toMatch(/--fs-caption-2xs:\s*calc\(0\.625rem \* var\(--rem-scale\)\);/); // 10
    expect(tokens).toMatch(/--fs-caption-xs:\s*calc\(0\.6875rem \* var\(--rem-scale\)\);/); // 11
    expect(tokens).toMatch(/--fs-caption-sm:\s*calc\(0\.75rem \* var\(--rem-scale\)\);/); // 12
    expect(tokens).toMatch(/--fs-caption-md:\s*calc\(0\.8125rem \* var\(--rem-scale\)\);/); // 13
    expect(tokens).toMatch(/--fs-footnote:\s*calc\(0\.75rem \* var\(--rem-scale\)\);/); // 12
    expect(tokens).toMatch(/--fs-code:\s*calc\(0\.8125rem \* var\(--rem-scale\)\);/); // 13
    expect(tokens).toMatch(/--space-xs:\s*calc\(0\.25rem \* var\(--size-scale\)\);/); // 4
  });

  it("尺寸轴落到外壳/按钮：固定行高也乘 --size-scale（不再只有 1 处菜单项吃令牌）", () => {
    for (const name of ["--h-row", "--h-btn", "--h-btn-sm", "--h-btn-lg", "--h-btn-xs", "--h-btn-2xs", "--w-row-action", "--h-row-action", "--w-switch", "--h-switch", "--d-switch-knob", "--sw-knob-inset", "--w-theme-thumb", "--h-theme-thumb", "--h-send"]) {
      expect(tokens).toMatch(new RegExp(`${name}:\\s*calc\\([^)]*\\* var\\(--size-scale\\)\\)`));
    }
    expect(styles).toContain("height: var(--h-row)");
    expect(styles).toContain("width: var(--h-send); height: var(--h-send)");
    expect(styles).toContain("width: var(--h-btn-lg); height: var(--h-btn-lg)");
    expect(styles).toContain("width: var(--h-btn-2xs); height: var(--h-btn-2xs)");
    expect(styles).toContain("width: var(--h-row-action); height: var(--h-row-action)");
    // 批 112：composer 的左「＋」、模型/权限芯片、上下文环也吃同一档
    expect(styles).toContain("width: var(--h-btn-lg); height: var(--h-btn-lg)");
    expect(styles).toContain("height: var(--h-btn-lg); padding: 0 var(--space-sm)");
    expect(styles).toContain("width: 100%; height: 100%; transform: rotate(-90deg)");
    expect(styles).toContain("width: var(--w-switch); height: var(--h-switch)");
    expect(styles).toContain("left: calc(100% - var(--d-switch-knob) - var(--sw-knob-inset))");
    expect(styles).toContain(".theme-thumb { width: var(--w-theme-thumb); height: var(--h-theme-thumb)");
  });

  it("阅读列 832px（2026-10-21 设计重做：1440 下 760 留白过大）；过渡 140ms ease-out（120–160ms 区间内）", () => {
    expect(tokens).toMatch(/--reading:\s*52rem;/);
    // 2026-10-20：缓动改走 --ease-out 令牌（Claude --cds-ease-out 实测值），
    // 断言「时长 140ms」这个真正的行为契约，不再钉 ease-out 的拼写。
    expect(tokens).toMatch(/--t-fast:\s*140ms var\(--ease-out\);/);
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
