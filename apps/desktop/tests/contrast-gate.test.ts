// 对比度闸门（2026-11-01 第 878 页）：把「好不好看」里能算的那一半算出来。
//
// 缘起：品牌陶土橙的令牌注释写着「只用于品牌/主按钮」，但它被 27 处当成图标/状态文字色用。
// 真算（WCAG 2.1 相对亮度比）：#d97757 在本应用自己的亮色表面上
//   bg-100 2.96:1 ｜ bg-200 2.82:1 ｜ bg-300 2.68:1
// ⇒ 连非文本组件的 3:1 都不到，当文字更远离 4.5:1。暗色里同一枚橙是 5.87:1，本来就够。
// 于是新增前景档 --accent-brand-ink（同色相同饱和，L 59.6%→46%）：
//   bg-100 4.52:1 ｜ bg-200 4.30:1 ｜ bg-300 4.10:1
// 本判卷钉两件事：① 前景档必须真的过线（改令牌就红）；② 原橙当前景只许留在品牌/装饰标名单里。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const tokens = read("../src/renderer/tokens.css");

type Hsl = readonly [number, number, number];

/** 取一个主题块里的 `--x: h s l;` 三元组（跳过任何带 var() 的派生值）。 */
function themeMap(startSel: string, endSel: string): Record<string, Hsl> {
  const from = tokens.indexOf(startSel);
  const to = tokens.indexOf(endSel, from + startSel.length);
  const seg = tokens.slice(from, to < 0 ? tokens.length : to);
  const out: Record<string, Hsl> = {};
  for (const m of seg.matchAll(/--([\w-]+):\s*(-?[\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*;/g)) {
    out[m[1]] = [Number(m[2]), Number(m[3]), Number(m[4])];
  }
  return out;
}
const LIGHT = themeMap(":root {", '[data-theme="dark"] {');
const DARK = themeMap('[data-theme="dark"] {', "\n/* ═");

function lin(c: number): number {
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function channels(hsl: Hsl): readonly [number, number, number] {
  const [h, sRaw, lRaw] = hsl;
  const s = sRaw / 100;
  const l = lRaw / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r1, g1, b1] = (
    [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]] as const
  )[Math.floor(h / 60) % 6];
  return [lin(r1 + m), lin(g1 + m), lin(b1 + m)];
}
/** WCAG 2.1 对比度。 */
function ratio(a: Hsl, b: Hsl): number {
  const [ra, ga, ba] = channels(a);
  const [rb, gb, bb] = channels(b);
  const la = 0.2126 * ra + 0.7152 * ga + 0.0722 * ba;
  const lb = 0.2126 * rb + 0.7152 * gb + 0.0722 * bb;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

describe("品牌橙的前景档（--accent-brand-ink）", () => {
  const surfaces = ["bg-100", "bg-000", "bg-200", "bg-300"] as const;

  it("亮色：橙前景在四个表面上都过 AA 文本 4.5:1", () => {
    const ink = LIGHT["accent-brand-ink"];
    expect(ink, "亮色缺 --accent-brand-ink").toBeTruthy();
    for (const bg of surfaces) {
      const r = ratio(ink, LIGHT[bg]);
      expect(r, `accent-brand-ink on ${bg} = ${r.toFixed(2)}:1（需 ≥4.5）`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("暗色：橙前景在暗色表面上都过 4.5:1（原橙本来就够）", () => {
    const ink = DARK["accent-brand-ink"] ?? DARK["accent-brand"];
    for (const bg of surfaces) {
      const r = ratio(ink, DARK[bg]);
      expect(r, `暗色 accent-brand-ink on ${bg} = ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("反证：原橙当前景在亮色表面上确实不过线（本批改档的理由，不是恒真）", () => {
    for (const bg of surfaces) {
      expect(ratio(LIGHT["accent-brand"], LIGHT[bg]), `原橙 on ${bg}`).toBeLessThan(4.5);
    }
    // 非文本组件线（3:1）也差一点：说明这不是吹毛求疵。
    expect(ratio(LIGHT["accent-brand"], LIGHT["bg-300"])).toBeLessThan(3);
  });
});

describe("原橙只许留在品牌/装饰标上（令牌注释「只用于品牌/主按钮」）", () => {
  /** 允许仍以原橙作前景的**标记族**：品牌标本身 + 逐字入场动效 + 装饰字形。 */
  const ALLOW = [
    ".tb-brand .cairn-mark",
    ".row.assistant .spark",
    ".empty-mark",
    ".empty-greet-mark",
    ".mp-cube",
    ".ap-card-ico",
    ".plugin-mark",
    "@keyframes md-word-arrive",
  ];
  const CSS_FILES = ["../src/renderer/styles.css", "../src/renderer/components/stream-process.css",
    "../src/renderer/components/composer-plan.css", "../src/renderer/components/session-preview.css",
    "../src/renderer/components/sidebar-filter.css", "../src/renderer/components/plugins/plugins.css"];

  it("逐个点名：名单外的规则不许再用 hsl(var(--accent-brand)) 当 color", () => {
    const offenders: string[] = [];
    const keyframeHues: string[] = [];
    for (const rel of CSS_FILES) {
      const raw = read(rel).replace(/\/\*[\s\S]*?\*\//g, "");
      // @keyframes 的步进（`20% { … }`）不是状态色，单独走下面的名单核对；
      // 先整块摘掉，否则会把 `from/to/NN%` 当成选择器误判。
      for (const kf of raw.matchAll(/@keyframes\s+([\w-]+)\s*\{([\s\S]*?)\n\}/g)) {
        if (/color:\s*hsl\(var\(--accent-brand\)/.test(kf[2])) keyframeHues.push(kf[1]);
      }
      const src = raw.replace(/@keyframes\s+[\w-]+\s*\{[\s\S]*?\n\}/g, "");
      for (const m of src.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
        if (!/(^|[^-\w])color:\s*hsl\(var\(--accent-brand\)/.test(m[2])) continue;
        const sel = m[1].trim().replace(/\s+/g, " ");
        if (!ALLOW.some((a) => sel.startsWith(a))) offenders.push(`${rel} :: ${sel}`);
      }
    }
    expect(offenders, "以原橙作前景的非标记规则：\n" + offenders.join("\n")).toEqual([]);
    // 动效里用原橙的只许是逐字入场（装饰，不承载状态）
    expect(keyframeHues, "以原橙作前景的 @keyframes：" + keyframeHues.join(",")).toEqual(["md-word-arrive"]);
  });

  it("前景档被真实使用（不是加了个死令牌）", () => {
    const used = CSS_FILES.map((rel) => read(rel)).join("\n").match(/color:\s*hsl\(var\(--accent-brand-ink\)\)/g) ?? [];
    expect(used.length, `--accent-brand-ink 前景用法 ${used.length} 处`).toBeGreaterThanOrEqual(10);
  });
});

/** 具名墨色对（第 881 页）：每个墨色按它**真正落在的底色**量，不拿全部表面吓自己。 */
describe("具名墨色对（ink on its real background）", () => {
  const PAIRS = [
    ["color-diff-add-ink", "color-diff-add-bg", "增行文字落在淡绿码面上"],
    ["color-diff-del-ink", "color-diff-del-bg", "删行文字落在淡红码面上"],
    ["accent-control-text", "bg-000", "链接/对勾在卡面与弹层上"],
    ["accent-control-text", "bg-100", "同上，主区画布"],
    ["accent-control-text", "bg-200", "同上，侧栏面"],
    ["text-400", "bg-100", "次级说明文字"],
    ["text-400", "bg-300", "次级说明落在用户气泡/凹陷面"],
    ["accent-brand-ink", "bg-300", "品牌前景档最坏的一面"],
  ] as const;

  for (const theme of [["亮", LIGHT], ["暗", DARK]] as const) {
    it(`${theme[0]}色：${PAIRS.length} 对具名墨色全部 ≥4.5:1`, () => {
      const T = theme[1];
      const bad: string[] = [];
      for (const [fg, bg, why] of PAIRS) {
        if (!(fg in T) || !(bg in T)) continue;
        const r = ratio(T[fg], T[bg]);
        if (r < 4.5) bad.push(`${fg} on ${bg} = ${r.toFixed(2)}:1（${why}）`);
      }
      expect(bad, theme[0] + "色不过线的墨色对：\n" + bad.join("\n")).toEqual([]);
    });
  }

  it("反证：改动前的两个值确实不过线（本批不是凭空调深）", () => {
    // 暗色控件文字蓝原值 L=51.6%；亮色增行墨原值 L=29.2%
    expect(ratio([210, 70.9, 51.6], DARK["bg-000"])).toBeLessThan(4.5);
    expect(ratio([210, 70.9, 51.6], DARK["bg-200"])).toBeLessThan(4.5);
    expect(ratio([142.4, 71.8, 29.2], LIGHT["color-diff-add-bg"])).toBeLessThan(4.5);
  });

  it("状态点按非文本 3:1 判：运行黄只许待在它真实的卡面上", () => {
    // .wk-dot.running / 横幅图标都是**点/图标**（WCAG 1.4.11 非文本 3:1）。
    for (const bg of ["bg-000", "bg-100"] as const) {
      expect(ratio(LIGHT["color-run"], LIGHT[bg]), `运行黄 on ${bg}`).toBeGreaterThanOrEqual(3);
    }
  });
});

/** 运行黄同族（第 905 页，第 878 页登记的下一族）：文字/图标走前景档，圆点留原档。 */
describe("运行黄的前景档（--color-run-ink）", () => {
  const surfaces = ["bg-100", "bg-000", "bg-200", "bg-300"] as const;

  it("亮色：前景档在四个表面上都过 AA 文本 4.5:1", () => {
    const ink = LIGHT["color-run-ink"];
    expect(ink, "亮色缺 --color-run-ink").toBeTruthy();
    for (const bg of surfaces) {
      const r = ratio(ink, LIGHT[bg]);
      expect(r, `color-run-ink on ${bg} = ${r.toFixed(2)}:1（需 ≥4.5）`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("暗色：前景档必须**显式定义**（漏了就继承亮档深棕，深底上直接看不见）", () => {
    const ink = DARK["color-run-ink"];
    expect(ink, "暗色块没有 --color-run-ink ⇒ 会继承 :root 的深棕").toBeTruthy();
    for (const bg of surfaces) {
      const r = ratio(ink, DARK[bg]);
      expect(r, `暗色 color-run-ink on ${bg} = ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("反证：原档当前景在亮色四表面上不过线（改档的理由，不是恒真）", () => {
    for (const bg of surfaces) {
      expect(ratio(LIGHT["color-run"], LIGHT[bg]), `原档 on ${bg}`).toBeLessThan(4.5);
    }
    // 连非文本的 3:1 都在深一档表面上破——这就是第 878 页留下的那一族。
    expect(ratio(LIGHT["color-run"], LIGHT["bg-200"])).toBeLessThan(3);
    expect(ratio(LIGHT["color-run"], LIGHT["bg-300"])).toBeLessThan(3);
  });

  it("机械：CSS 里 `color:` 用运行黄的地方必须为 0（前景一律走 ink）", () => {
    const raw = read("../src/renderer/styles.css").replace(/\/\*[\s\S]*?\*\//g, "");
    const offenders = [...raw.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .filter((m) => /(^|[^-\w])color:\s*hsl\(var\(--color-run\)/.test(m[2]))
      .map((m) => m[1].trim().replace(/\s+/g, " "));
    expect(offenders, "仍以原档作前景的规则（该走 --color-run-ink）：\n" + offenders.join("\n")).toEqual([]);
    const used = raw.match(/color:\s*hsl\(var\(--color-run-ink\)\)/g) ?? [];
    // 2026-11-03 检查器统计页整页撤下（业主：右栏不装用量仪表）：前景档消费点从 2 降到 1（.wk-dot.running）。
    expect(used.length, `前景档实际用法 ${used.length} 处`).toBeGreaterThanOrEqual(1);
  });

  it("圆点族仍用原档（小色块要鲜度），且只许这几处", () => {
    const raw = read("../src/renderer/styles.css").replace(/\/\*[\s\S]*?\*\//g, "");
    const fills = [...raw.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .filter((m) => /background[^:]*:\s*hsl\(var\(--color-run\)/.test(m[2]))
      .map((m) => m[1].trim().replace(/\s+/g, " "));
    expect(fills.sort()).toEqual([
      ".dot.running",
    ].sort());
  });

  it("从未发出的类名不许留在样式里（.home-banner-demo 属横幅旧形制残留）", () => {
    const css = read("../src/renderer/styles.css");
    expect(css).not.toContain("home-banner-demo");
    // 反向：真在用的横幅类名还在（不是把整族误删）。
    expect(css).toContain(".home-banner ");
  });
});
