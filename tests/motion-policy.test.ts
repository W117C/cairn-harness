/**
 * 动效面纪律判卷（`scripts/motion-policy-check.ts`）的判卷（2026-10-22 · 设计面 Phase 4）。
 *
 *  为什么值得单独立一份判卷：这道尺的**全部价值**在「它真的会红」。一条只会通过的
 *  检查等于没有检查——所以每一格都做成**造坏标本 → 那条规则必须红 → 红在哪个断言
 * 哪个行** 的形状，而不是「跑一遍脚本看退出码是不是 0」。
 *
 *  三条纪律：
 *   ① **好标本仍绿**——本仓现读的 styles.css / tokens.css / useStickyScroll.ts 必须
 *      七条全过（否则这把尺在把正确产物判红）。
 *   ② **每条规则各造一个坏标本**——M1…M7 逐条钉（少一格就等于那条规则是装饰）。
 *   ③ **豁免必须窄**——`visibility 0s` 该过、`visibility 200ms` 该拒；被桌面判卷钉住的
 *      breathe 家族该过、换个时长就该拒。豁免一旦变成「一整类放过」，M2 就废了。
 *
 *  判卷数据落在 `.tmp/<uuid>` 下（跑完删）：坏标本是**拼出来的**，绝不改真文件。
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkMotionPolicy, type CheckOutcome, type RuleResult } from "../scripts/motion-policy-check";

const ROOT = resolve(import.meta.dirname, "..");
const SCRIPT = join(ROOT, "scripts", "motion-policy-check.ts");

/** 真读面（相对仓库根）——判卷读的就是这几份。 */
const STYLES = join(ROOT, "apps/desktop/src/renderer/styles.css");
const TOKENS = join(ROOT, "apps/desktop/src/renderer/tokens.css");
const STICKY = join(ROOT, "apps/desktop/src/renderer/useStickyScroll.ts");
const RENDERER = join(ROOT, "apps/desktop/src/renderer");

const stylesText = readFileSync(STYLES, "utf8");
const tokensText = readFileSync(TOKENS, "utf8");
const stickyText = readFileSync(STICKY, "utf8");

let tmpRoot = "";

beforeAll(() => {
  tmpRoot = join(ROOT, ".tmp", "motion-policy-" + randomUUID());
  mkdirSync(tmpRoot, { recursive: true });
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function ruleOf(outcome: CheckOutcome, id: string): RuleResult {
  const r = outcome.results.find((x) => x.rule === id);
  if (r === undefined) throw new Error("判卷里没有 " + id + " 这一条");
  return r;
}

/** 造一份坏标本：真读面照抄，只把指定的那几样换掉。 */
interface Specimen {
  styles?: string;
  tokens?: string;
  sticky?: string;
  rendererFiles?: Record<string, string>;
}

function specimen(s: Specimen): ReturnType<typeof checkMotionPolicy> {
  const dir = join(tmpRoot, randomUUID());
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "styles.css"), s.styles ?? stylesText, "utf8");
  writeFileSync(join(dir, "tokens.css"), s.tokens ?? tokensText, "utf8");
  writeFileSync(join(dir, "useStickyScroll.ts"), s.sticky ?? stickyText, "utf8");
  const rendererDir = join(dir, "renderer");
  mkdirSync(rendererDir, { recursive: true });
  for (const [name, text] of Object.entries(s.rendererFiles ?? {})) {
    writeFileSync(join(rendererDir, name), text, "utf8");
  }
  return checkMotionPolicy({
    styles: join(dir, "styles.css"),
    tokens: join(dir, "tokens.css"),
    sticky: join(dir, "useStickyScroll.ts"),
    renderer: rendererDir,
  });
}

/** 在样式表末尾追加一条坏规则（行号可算：追加前的行数 + 1）。 */
function withExtraRule(css: string, rule: string): { css: string; line: number } {
  const line = css.split("\n").length + 1;
  return { css: `${css}\n${rule}\n`, line };
}

/**
 * 把样式表里**那一个** reduced-motion 块换成别的内容。
 * 为什么必须替换而不是追加：判卷只看**首个** reduced-motion 块——追加第二块
 * 不会让第一块变坏（那样造出来的标本是假标本：尺没被逼到红）。
 */
function replaceReducedMotionBlock(css: string, replacement: string): string {
  const at = css.indexOf("@media (prefers-reduced-motion: reduce)");
  if (at === -1) throw new Error("本仓样式表里找不到 reduced-motion 块");
  const open = css.indexOf("{", at);
  let depth = 0;
  let close = -1;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close === -1) throw new Error("reduced-motion 块没有闭合");
  return css.slice(0, at) + replacement + css.slice(close + 1);
}

describe("好标本仍绿（本仓现读面）", () => {
  const outcome = checkMotionPolicy({
    styles: STYLES,
    tokens: TOKENS,
    sticky: STICKY,
    renderer: RENDERER,
  });

  it("七条规则全过", () => {
    const bad = outcome.results.filter((r) => r.findings.length > 0);
    expect(
      bad.map((r) => `${r.rule}: ${r.findings.map((f) => `${f.file}:${String(f.line)} ${f.message}`).join(" | ")}`),
      "本仓现读面被判红",
    ).toEqual([]);
    expect(outcome.results.map((r) => r.rule)).toEqual(["M1", "M2", "M3", "M4", "M5", "M6", "M7"]);
  });

  it("豁免是**显式登记**的，而且条数与登记一致（不是悄悄放过）", () => {
    const m2 = ruleOf(outcome, "M2");
    const ids = (r: RuleResult): string[] => r.exempted.map((e) => e.id);
    // visibility 0s 四处（含两处「0s + --t-fast 延迟」形态）
    expect(ids(m2).filter((i) => i === "E1")).toHaveLength(4);
    // breathe 家族：4 处 1.6s ＋ 1 处 1.2s（被桌面判卷逐字钉住 ⇒ 豁免）
    expect(ids(m2).filter((i) => i === "E2")).toHaveLength(4);
    expect(ids(m2).filter((i) => i === "E3")).toHaveLength(1);
    // 降级块内按位置豁免的两条时长声明
    expect(ids(m2).filter((i) => i === "E0")).toHaveLength(2);
    const m7 = ruleOf(outcome, "M7");
    expect(ids(m7).filter((i) => i === "E4")).toHaveLength(1);
    expect(ids(m7).filter((i) => i === "E5")).toHaveLength(1);
    // 每条豁免都必须带理由（空理由＝无声放行）
    for (const r of outcome.results) {
      for (const e of r.exempted) expect(e.why.trim(), `${r.rule}/${e.id} 缺理由`).not.toBe("");
    }
  });

  it("降级块是实的：* / *::before / *::after + 两条归零 + scroll-behavior:auto", () => {
    const m5 = ruleOf(outcome, "M5");
    expect(m5.findings).toEqual([]);
    const texts = m5.exempted.map((e) => e.text);
    expect(texts.some((t) => t.startsWith("transition-duration:"))).toBe(true);
    expect(texts.some((t) => t.startsWith("animation-duration:"))).toBe(true);
    expect(texts.some((t) => t === "scroll-behavior: auto")).toBe(true);
  });
});

describe("M1 — 一揽子过渡要红", () => {
  it("transition: all 200ms 被 M1 咬住", () => {
    const { css, line } = withExtraRule(stylesText, ".bad { transition: all 200ms; }");
    const m1 = ruleOf(specimen({ styles: css }), "M1");
    expect(m1.findings).toHaveLength(1);
    expect(m1.findings[0].line).toBe(line);
    expect(m1.findings[0].file.endsWith("styles.css")).toBe(true);
    expect(m1.findings[0].message).toContain("一揽子过渡");
  });

  it("animation: all 也被咬住", () => {
    const { css, line } = withExtraRule(stylesText, ".bad { animation: all; }");
    const m1 = ruleOf(specimen({ styles: css }), "M1");
    expect(m1.findings).toHaveLength(1);
    expect(m1.findings[0].line).toBe(line);
    expect(m1.findings[0].message).toContain("一揽子动画");
  });

  it("逐项列出的过渡不红（好标本别被误伤）", () => {
    const { css } = withExtraRule(stylesText, ".ok { transition: opacity var(--t-fast), transform var(--t-fast); }");
    expect(ruleOf(specimen({ styles: css }), "M1").findings).toEqual([]);
  });
});

describe("M2 — 时长必须是令牌（豁免要窄）", () => {
  it("裸时长 200ms 被咬住", () => {
    const { css, line } = withExtraRule(stylesText, ".bad { transition: opacity 200ms; }");
    const m2 = ruleOf(specimen({ styles: css }), "M2");
    expect(m2.findings).toHaveLength(1);
    expect(m2.findings[0].line).toBe(line);
    expect(m2.findings[0].message).toContain("裸时长 200ms");
  });

  it("裸时长在 animation 简写里同样被咬住", () => {
    const { css, line } = withExtraRule(stylesText, ".bad { animation: blink 900ms ease-out; }");
    const m2 = ruleOf(specimen({ styles: css }), "M2");
    expect(m2.findings).toHaveLength(1);
    expect(m2.findings[0].line).toBe(line);
  });

  it("该过的过：visibility 的 0s 被放过（豁免 E1）", () => {
    const { css } = withExtraRule(stylesText, ".ok { transition: width var(--t-fast), visibility 0s; }");
    const m2 = ruleOf(specimen({ styles: css }), "M2");
    expect(m2.findings).toEqual([]);
    expect(m2.exempted.some((e) => e.id === "E1")).toBe(true);
  });

  it("该拒的拒：visibility 给了 200ms 就红（E1 只放行 0s，不是整个 visibility）", () => {
    const { css, line } = withExtraRule(stylesText, ".bad { transition: width var(--t-fast), visibility 200ms; }");
    const m2 = ruleOf(specimen({ styles: css }), "M2");
    expect(m2.findings).toHaveLength(1);
    expect(m2.findings[0].line).toBe(line);
    expect(m2.findings[0].message).toContain("裸时长 200ms");
  });

  it("该过的过：被桌面判卷钉住的 breathe 家族被放过（E2/E3）", () => {
    const { css } = withExtraRule(stylesText, ".ok { animation: breathe 1.6s ease-in-out infinite; }");
    const m2 = ruleOf(specimen({ styles: css }), "M2");
    expect(m2.findings).toEqual([]);
    expect(m2.exempted.some((e) => e.id === "E2")).toBe(true);
  });

  it("该拒的拒：breathe 换个时长就红（E2 是精确值匹配，不是家族通配）", () => {
    const { css, line } = withExtraRule(stylesText, ".bad { animation: breathe 3s ease-in-out infinite; }");
    const m2 = ruleOf(specimen({ styles: css }), "M2");
    expect(m2.findings).toHaveLength(1);
    expect(m2.findings[0].line).toBe(line);
    expect(m2.findings[0].message).toContain("裸时长 3s");
  });

  it("悬空令牌也被咬住（var(--t-nope) 没定义 ⇒ 整条声明失效）", () => {
    const { css, line } = withExtraRule(stylesText, ".bad { transition: opacity var(--t-nope); }");
    const m2 = ruleOf(specimen({ styles: css }), "M2");
    expect(m2.findings).toHaveLength(1);
    expect(m2.findings[0].line).toBe(line);
    expect(m2.findings[0].message).toContain("悬空令牌");
  });

  it("animation-delay 也要走令牌", () => {
    const { css, line } = withExtraRule(stylesText, ".bad { animation-delay: 0.3s; }");
    const m2 = ruleOf(specimen({ styles: css }), "M2");
    expect(m2.findings).toHaveLength(1);
    expect(m2.findings[0].line).toBe(line);
  });
});

describe("M3 — 缓动必须是令牌", () => {
  it("裸 cubic-bezier 被咬住", () => {
    const { css, line } = withExtraRule(stylesText, ".bad { transition: opacity cubic-bezier(.2, .7, .2, 1); }");
    const m3 = ruleOf(specimen({ styles: css }), "M3");
    expect(m3.findings).toHaveLength(1);
    expect(m3.findings[0].line).toBe(line);
    expect(m3.findings[0].message).toContain("裸缓动");
  });

  it("裸 linear 关键字被咬住", () => {
    const { css, line } = withExtraRule(stylesText, ".bad { animation: spin 1s linear infinite; }");
    const m3 = ruleOf(specimen({ styles: css }), "M3");
    expect(m3.findings).toHaveLength(1);
    expect(m3.findings[0].line).toBe(line);
  });

  it("裸 ease-out 关键字被咬住", () => {
    const { css, line } = withExtraRule(stylesText, ".bad { transition: opacity ease-out; }");
    const m3 = ruleOf(specimen({ styles: css }), "M3");
    expect(m3.findings).toHaveLength(1);
    expect(m3.findings[0].line).toBe(line);
  });

  it("走令牌的不红（--t-* 自带缓动，正确写法是 transition: opacity var(--t-fast)）", () => {
    const { css } = withExtraRule(stylesText, ".ok { transition: opacity var(--t-fast); }");
    expect(ruleOf(specimen({ styles: css }), "M3").findings).toEqual([]);
  });
});

describe("M4 — 颜色必须是令牌", () => {
  it("裸 hsl() 被咬住", () => {
    const { css, line } = withExtraRule(stylesText, ".bad { background: hsl(0 0% 100%); }");
    const m4 = ruleOf(specimen({ styles: css }), "M4");
    expect(m4.findings).toHaveLength(1);
    expect(m4.findings[0].line).toBe(line);
    expect(m4.findings[0].message).toContain("字面色函数");
  });

  it("裸 hex 被咬住", () => {
    const { css, line } = withExtraRule(stylesText, ".bad { color: #ff8800; }");
    const m4 = ruleOf(specimen({ styles: css }), "M4");
    expect(m4.findings).toHaveLength(1);
    expect(m4.findings[0].line).toBe(line);
    expect(m4.findings[0].message).toContain("字面色值");
  });

  it("相对色语法（hsl(from …)）与 hsl(var(--x)) 不算字面色", () => {
    const { css } = withExtraRule(
      stylesText,
      ".ok { background: hsl(from hsl(var(--text-000)) h s l / var(--alpha-hover)); color: hsl(var(--text-400) / 45%); }",
    );
    expect(ruleOf(specimen({ styles: css }), "M4").findings).toEqual([]);
  });
});

describe("M5 — reduced-motion 块必须是实的", () => {
  it("只有注释的块要红（注释不算声明）", () => {
    const css = replaceReducedMotionBlock(
      stylesText,
      "@media (prefers-reduced-motion: reduce) {\n  /* 这里本来应该把动效归零 */\n}",
    );
    const m5 = ruleOf(specimen({ styles: css }), "M5");
    expect(m5.findings.length).toBeGreaterThan(0);
    expect(m5.findings.map((f) => f.message).join(" | ")).toContain("没有**真实声明**");
  });

  it("少了 scroll-behavior: auto 要红", () => {
    const css = replaceReducedMotionBlock(
      stylesText,
      "@media (prefers-reduced-motion: reduce) {\n  *, *::before, *::after {\n    animation-duration: 0.01ms !important;\n    transition-duration: 0.01ms !important;\n  }\n}",
    );
    const m5 = ruleOf(specimen({ styles: css }), "M5");
    expect(m5.findings.map((f) => f.message).join(" | ")).toContain("scroll-behavior: auto");
  });

  it("作用域没覆盖伪元素要红（*::after 缺席）", () => {
    const css = replaceReducedMotionBlock(
      stylesText,
      "@media (prefers-reduced-motion: reduce) {\n  * {\n    animation-duration: 0.01ms !important;\n    transition-duration: 0.01ms !important;\n    scroll-behavior: auto !important;\n  }\n}",
    );
    const m5 = ruleOf(specimen({ styles: css }), "M5");
    expect(m5.findings.map((f) => f.message).join(" | ")).toContain("*::after");
  });

  it("时长没归零要红（0.01ms 之外的值不行）", () => {
    const css = replaceReducedMotionBlock(
      stylesText,
      "@media (prefers-reduced-motion: reduce) {\n  *, *::before, *::after {\n    animation-duration: 300ms !important;\n    transition-duration: 300ms !important;\n    scroll-behavior: auto !important;\n  }\n}",
    );
    const m5 = ruleOf(specimen({ styles: css }), "M5");
    expect(m5.findings.map((f) => f.message).join(" | ")).toContain("近零");
  });

  it("整个块被删掉要红", () => {
    const stripped = stylesText.replace(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}\n/, "");
    expect(stripped.length).toBeLessThan(stylesText.length);
    const m5 = ruleOf(specimen({ styles: stripped }), "M5");
    expect(m5.findings.map((f) => f.message).join(" | ")).toContain("没有 @media");
  });
});

describe("M6 — JS 侧平滑滚动必须降级", () => {
  it("useStickyScroll 少了 prefers-reduced-motion 守卫要红", () => {
    const broken = stickyText.replace(/matchMedia\([^)]*\)/, '"anything"');
    const m6 = ruleOf(specimen({ sticky: broken }), "M6");
    expect(m6.findings.length).toBeGreaterThan(0);
    expect(m6.findings[0].message).toContain("prefers-reduced-motion");
  });

  it("renderer 里出现裸 behavior: \"smooth\" 要红", () => {
    const m6 = ruleOf(
      specimen({
        rendererFiles: { "Bad.ts": 'export const go = (el: HTMLElement): void => { el.scrollTo({ top: 0, behavior: "smooth" }); };\n' },
      }),
      "M6",
    );
    expect(m6.findings).toHaveLength(1);
    expect(m6.findings[0].message).toContain('裸 behavior: "smooth"');
    expect(m6.findings[0].file.endsWith("Bad.ts")).toBe(true);
  });

  it("走了 scrollBehavior() 守卫的不红", () => {
    const m6 = ruleOf(
      specimen({
        rendererFiles: {
          "Good.ts":
            'import { scrollBehavior } from "./useStickyScroll";\nexport const go = (el: HTMLElement): void => { el.scrollTo({ top: 0, behavior: scrollBehavior("smooth") }); };\n',
        },
      }),
      "M6",
    );
    expect(m6.findings).toEqual([]);
  });
});

describe("M7 — 降级块之外不许 !important", () => {
  it("块外的 !important 要红", () => {
    const { css, line } = withExtraRule(stylesText, ".bad { color: red !important; }");
    const m7 = ruleOf(specimen({ styles: css }), "M7");
    expect(m7.findings).toHaveLength(1);
    expect(m7.findings[0].line).toBe(line);
    expect(m7.findings[0].message).toContain("!important");
  });

  it("降级块里的 !important 不红（那正是它该待的地方）", () => {
    const m7 = ruleOf(specimen({}), "M7");
    expect(m7.findings).toEqual([]);
    expect(m7.exempted.some((e) => e.id === "E0")).toBe(true);
  });
});

describe("门面（子进程）：退出码与输出形状", () => {
  type Run = { code: number; out: string };
  const run = (args: string[]): Run => {
    try {
      const out = execFileSync("node", ["--import", "tsx", SCRIPT, ...args], {
        cwd: ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { code: 0, out };
    } catch (err) {
      const e = err as { status?: number; stdout?: string; stderr?: string };
      return { code: typeof e.status === "number" ? e.status : 1, out: (e.stdout ?? "") + (e.stderr ?? "") };
    }
  };

  it("本仓现读面：退出码 0，七条全 ✅", () => {
    const r = run([]);
    expect(r.code).toBe(0);
    for (const id of ["M1", "M2", "M3", "M4", "M5", "M6", "M7"]) {
      expect(r.out, `${id} 没打勾`).toContain(`✅ ${id} `);
    }
    expect(r.out).toContain("豁免清单（显式登记");
  });

  it("坏标本：退出码非 0，且红的那条点名 文件:行 + 规则", () => {
    const dir = join(tmpRoot, "cli-red");
    mkdirSync(dir, { recursive: true });
    const bad = `${stylesText}\n.bad { transition: opacity 200ms; }\n`;
    writeFileSync(join(dir, "styles.css"), bad, "utf8");
    writeFileSync(join(dir, "tokens.css"), tokensText, "utf8");
    writeFileSync(join(dir, "useStickyScroll.ts"), stickyText, "utf8");
    const rendererDir = join(dir, "renderer");
    mkdirSync(rendererDir, { recursive: true });
    const r = run([
      "--styles",
      join(dir, "styles.css"),
      "--tokens",
      join(dir, "tokens.css"),
      "--sticky",
      join(dir, "useStickyScroll.ts"),
      "--renderer",
      rendererDir,
    ]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("❌ M2");
    expect(r.out).toMatch(/styles\.css:\d+/);
    expect(r.out).toContain("裸时长 200ms");
  });
});
