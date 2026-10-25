// motion-policy-check —— 桌面端「动效面」的纪律判卷（2026-10-22 · 设计面 Phase 4）。
//
//  为什么要有这一格：桌面端的动效面此前只有**散文纪律**——设计规范 §4.10 写着
//  「时长走令牌」「prefers-reduced-motion 归零」，代码里也确实大体照做，但**没有任何
//  一道机器尺**盯着它：样式表里写回 `transition: opacity 200ms`、或者把
//  `prefers-reduced-motion` 那一段改成只剩一行注释，都不会让任何一道门变红。
//  散文纪律的寿命＝写它那次的耐心。⇒ 这一格把「动效面纪律」变成**可判红**的七条：
//
//    M1 不许一揽子过渡（transition: all / animation: all）
//    M2 时长必须是 --t-* 令牌（transition/animation 简写 + duration/delay 声明）
//    M3 缓动必须是 --ease-* 令牌
//    M4 颜色必须是令牌（零 hex、零 hsl()/rgb() 字面量）
//    M5 prefers-reduced-motion 块是**实的**（不是一行注释）
//    M6 JS 侧平滑滚动已降级（useStickyScroll 守卫 + renderer 内无裸 "smooth"）
//    M7 降级块之外无 !important
//
//  它**判什么、不判什么**（不许越界冒充）：
//   · 判的是**纪律**（字面量 vs 令牌、降级面在不在、!important 的位置），
//     **不判好不好看**——审美归业主真机目验，判卷不许替业主的眼下结论。
//   · 豁免是**显式登记**的（每条带理由与位置，见 EXEMPTIONS），不是悄悄放过。
//   · 判卷读**剥掉注释后**的样式表：注释里写「140ms」不是违规，声明里写才是。
//   · 真机观感**不由这一格负责**（本机跑不起 Electron），这一格只保证「写法没漂」。
//
//  用法：node --import tsx scripts/motion-policy-check.ts
//        可选：--styles/--tokens/--sticky/--renderer <路径>（判卷自己造坏标本时用）。
//  退出码：0 = 全过；1 = 有发现（每条带 文件:行 + 规则号）。
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** 默认读面（相对仓库根）。判卷造坏标本时用命令行覆盖。 */
export const DEFAULT_TARGETS = {
  styles: "apps/desktop/src/renderer/styles.css",
  tokens: "apps/desktop/src/renderer/tokens.css",
  sticky: "apps/desktop/src/renderer/useStickyScroll.ts",
  renderer: "apps/desktop/src/renderer",
} as const;

export interface Finding {
  rule: string;
  file: string;
  line: number;
  message: string;
}

export interface ExemptionHit {
  id: string;
  file: string;
  line: number;
  text: string;
  why: string;
}

export interface RuleResult {
  rule: string;
  title: string;
  findings: Finding[];
  exempted: ExemptionHit[];
}

export interface CheckOutcome {
  results: RuleResult[];
  failures: number;
  findingCount: number;
}

export interface Target {
  styles: string;
  tokens: string;
  sticky: string;
  renderer: string;
}

// ── 豁免表（显式登记 · 每条带理由；命中是**精确值**匹配，不是前缀/家族通配）────────
export interface ExemptionDef {
  id: string;
  /** 豁免什么（人话，写进输出） */
  what: string;
  /** 命中的**声明值**（精确匹配，不做前缀/家族通配） */
  match: string;
  /** 为什么豁免（写进输出；不是「懒得改」的同义反复） */
  why: string;
}

/** M2/M3 共享：被桌面端判卷**逐字钉住**的动画声明（整条精确匹配）。 */
export const ANIMATION_EXEMPTIONS: readonly ExemptionDef[] = [
  {
    id: "E2",
    what: "animation: breathe 1.6s ease-in-out infinite",
    match: "breathe 1.6s ease-in-out infinite",
    why:
      "被两份桌面端判卷逐字钉住：apps/desktop/tests/interaction-deadends.test.ts:119 " +
      "（toContain 整串）与 apps/desktop/tests/skeleton-shimmer.test.ts:12（正则锚 breathe 1.6s）。" +
      "本批无权编辑 apps/desktop/tests/** ⇒ 保留字面量。改法：把那份判卷改成令牌形态后撤掉本条。",
  },
  {
    id: "E3",
    what: "animation: breathe 1.2s ease-in-out infinite",
    match: "breathe 1.2s ease-in-out infinite",
    why: "与 E2 同族（breathe 动画不写两种拼法：同一动画名在库里要么全令牌、要么全字面量）。",
  },
];

/** M2：visibility 的 0s（规范指定的唯一时长豁免）。 */
export const VISIBILITY_EXEMPTION: ExemptionDef = {
  id: "E1",
  what: "transition 的 visibility 0s（仅限 0s）",
  match: "visibility 0s",
  why:
    "visibility 必须**瞬时**翻转：给它 60ms 延迟会让「收起/展开」的隐藏晚半拍出现，" +
    "与 width/opacity 的动画不同步。规范 §4.10 的降级条款也只管归零，不管这一条。",
};

/** M7：降级块之外的 !important（每条带理由，命中按 选择器+属性 精确匹配）。 */
export const IMPORTANT_EXEMPTIONS: readonly {
  id: string;
  selector: string;
  prop: string;
  value: string;
  why: string;
}[] = [
  {
    id: "E4",
    selector: '.app[data-sidebar="collapsed"] .side-wrap',
    prop: "width",
    value: "0",
    why:
      "侧栏收起态必须压过 App 在拖拽时写在**行内样式**上的 width（行内样式权重高于类规则）；" +
      "没有 !important 时收起态压不住行内宽度 ⇒ 侧栏收不起来。",
  },
  {
    id: "E5",
    selector: ".pane-grid[data-focused]",
    prop: "display",
    value: "block",
    why:
      "聚焦态要把窗格区从 grid 布局换成单块绝对定位（同一棵内容树不重挂载）；" +
      "没有 !important 时压不住 .pane-grid 的 grid 布局 ⇒ 聚焦后仍并排两格。",
  },
];

/** 降级块（prefers-reduced-motion）里的 0.01ms：**按位置**豁免，不按值。 */
export const REDUCED_MOTION_NOTE =
  "@media (prefers-reduced-motion: reduce) 块内的 0.01ms 是规范 §4.10 亲自规定的降级值（按**位置**豁免，不按值豁免）。";

// ── 小工具：注释剥离（保行号：注释内容换成空格，换行保留）───────────────────────
/** CSS 注释 → 等长空格（换行保留 ⇒ 行号不变）。字符串里的 /* 不算注释。 */
export function stripCssComments(src: string): string {
  let out = "";
  let segStart = 0;
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"' || ch === "'") {
      // 字符串：原样保留（内部 /* 不算注释）；处理反斜杠转义。
      let j = i + 1;
      while (j < src.length && src[j] !== ch) {
        if (src[j] === "\\") j++;
        j++;
      }
      const stop = Math.min(j + 1, src.length);
      out += src.slice(segStart, stop);
      i = stop;
      segStart = stop;
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? src.length : end + 2;
      out += src.slice(segStart, i);
      out += src.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
      segStart = stop;
      continue;
    }
    i++;
  }
  return out + src.slice(segStart);
}

/** JS/TS 注释 → 等长空格（保行号）。字符串与模板串里的 // 不算注释。 */
export function stripJsComments(src: string): string {
  let out = "";
  let segStart = 0;
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < src.length && src[j] !== ch) {
        if (src[j] === "\\") j++;
        j++;
      }
      const stop = Math.min(j + 1, src.length);
      out += src.slice(segStart, stop);
      i = stop;
      segStart = stop;
      continue;
    }
    if (ch === "/" && src[i + 1] === "/") {
      let j = i;
      while (j < src.length && src[j] !== "\n") j++;
      out += src.slice(segStart, j);
      out += src.slice(i, j).replace(/[^\n]/g, " ");
      i = j;
      segStart = j;
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? src.length : end + 2;
      out += src.slice(segStart, i);
      out += src.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
      segStart = stop;
      continue;
    }
    i++;
  }
  return out + src.slice(segStart);
}

/** 行号索引（一次建表，多次二分查）——判卷里同一个文件会被反复问行号。 */
export function makeLineIndex(src: string): (index: number) => number {
  const starts: number[] = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === "\n") starts.push(i + 1);
  return (index: number): number => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= index) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

function countLines(src: string, index: number): number {
  let n = 1;
  for (let i = 0; i < index && i < src.length; i++) if (src[i] === "\n") n++;
  return n;
}

/** var(--x) → 等长空格（保留位置，便于把命中点映射回原文）。 */
function maskVarRefs(s: string): string {
  return s.replace(/var\(--[^)]*\)/g, (m) => " ".repeat(m.length));
}

function normalize(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

/** 顶层逗号切分（括号里的逗号不算：cubic-bezier(0.165, 0.84, 0.44, 1) 是一个整体）。 */
function splitTop(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = "";
  for (const ch of value) {
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      out.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  out.push(buf);
  return out;
}

function firstWord(s: string): string {
  const t = s.trim();
  const sp = t.search(/\s/);
  return sp === -1 ? t : t.slice(0, sp);
}

// ── 迷你 CSS 解析：把样式表拆成「声明 + 所属规则 + 所属 at 规则」────────────────
export interface Decl {
  prop: string;
  value: string;
  line: number;
  selector: string;
  atRules: string[];
}

export function scanDeclarations(src: string): Decl[] {
  const out: Decl[] = [];
  const stack: { prelude: string; isAt: boolean }[] = [];
  const lineOf = makeLineIndex(src);
  let segStart = 0;
  let i = 0;
  const flush = (end: number): void => {
    const raw = src.slice(segStart, end);
    const trimmed = raw.trim();
    if (trimmed !== "") {
      const colon = trimmed.indexOf(":");
      if (colon > 0) {
        const prop = trimmed.slice(0, colon).trim();
        if (/^-{0,2}[A-Za-z][A-Za-z0-9-]*$/.test(prop)) {
          const offset = segStart + raw.indexOf(trimmed);
          const rule = stack.slice().reverse().find((f) => !f.isAt);
          out.push({
            prop,
            value: trimmed.slice(colon + 1).trim(),
            line: lineOf(offset),
            selector: rule === undefined ? "" : rule.prelude,
            atRules: stack.filter((f) => f.isAt).map((f) => f.prelude),
          });
        }
      }
    }
    segStart = end + 1;
  };
  while (i < src.length) {
    const ch = src[i];
    if (ch === "{") {
      const prelude = src.slice(segStart, i).trim();
      stack.push({ prelude, isAt: prelude.startsWith("@") });
      segStart = i + 1;
      i++;
      continue;
    }
    if (ch === "}") {
      flush(i);
      stack.pop();
      i++;
      continue;
    }
    if (ch === ";") {
      flush(i);
      i++;
      continue;
    }
    i++;
  }
  return out;
}

const REDUCED_MOTION_QUERY = /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/i;

function inReducedMotion(d: Decl): boolean {
  return d.atRules.some((a) => REDUCED_MOTION_QUERY.test(a));
}

const DURATION_PROPS = new Set([
  "transition",
  "animation",
  "transition-duration",
  "animation-duration",
  "transition-delay",
  "animation-delay",
]);

const RAW_TIME = /(?<![\w.-])(\d*\.?\d+)(ms|s)\b/g;
const RAW_EASING_KEYWORD = /\b(?:ease-in-out|ease-in|ease-out|ease|linear)\b/i;
const RAW_EASING_FN = /\bcubic-bezier\s*\(/i;
const HEX_COLOR = /#[0-9a-fA-F]{3,8}\b/g;
const RAW_COLOR_FN = /\b(?:hsl|rgb|hwb|lab|lch|oklab|oklch)\(\s*[-0-9][^)]*\)/gi;

/** 令牌族 → 该族令牌必须在 tokens.css 里有定义（悬空 var ⇒ 整条声明静默失效）。 */
const CHECKED_TOKEN_PREFIXES = ["--t-", "--ease-", "--swatch-"];

function definedTokens(tokensCss: string): Set<string> {
  const out = new Set<string>();
  for (const m of tokensCss.matchAll(/(--[A-Za-z0-9_-]+)\s*:/g)) out.add(m[1]);
  return out;
}

function animationExemptionId(value: string): string | null {
  const key = normalize(value);
  for (const ex of ANIMATION_EXEMPTIONS) if (normalize(ex.match) === key) return ex.id;
  return null;
}

/** 去掉 !important / 其它优先级标记（判定「这个值是什么」时不该把它算进去）。 */
function stripImportant(value: string): string {
  return value.replace(/!\s*important/gi, "").trim();
}

// ── 七条规则 ────────────────────────────────────────────────────────────────
function ruleM1(decls: Decl[], file: string): RuleResult {
  const findings: Finding[] = [];
  for (const d of decls) {
    if (d.prop === "transition" || d.prop === "transition-property") {
      for (const item of splitTop(d.value)) {
        if (firstWord(item) === "all") {
          findings.push({
            rule: "M1",
            file,
            line: d.line,
            message:
              `一揽子过渡（${d.prop}: ${normalize(d.value)}）——它把没打算动的属性也带上，` +
              "每次属性变化都要重算；逐项列出要过渡的属性。",
          });
        }
      }
      continue;
    }
    if (d.prop === "animation" || d.prop === "animation-name") {
      if (firstWord(d.value) === "all") {
        findings.push({
          rule: "M1",
          file,
          line: d.line,
          message: `一揽子动画（${d.prop}: ${normalize(d.value)}）——动画属性必须逐个写。`,
        });
      }
    }
  }
  return { rule: "M1", title: "不许一揽子过渡（transition: all / animation: all）", findings, exempted: [] };
}

function ruleM2(
  decls: Decl[],
  file: string,
  defined: Set<string>,
): RuleResult {
  const findings: Finding[] = [];
  const exempted: ExemptionHit[] = [];
  for (const d of decls) {
    if (!DURATION_PROPS.has(d.prop)) continue;
    if (inReducedMotion(d)) {
      // 按**位置**豁免（不按值）：块内的 0.01ms 是规范 §4.10 亲自规定的降级值。
      // 只有真的带时长的声明才登记（animation: none 之类不占豁免名额）。
      if (maskVarRefs(d.value).match(RAW_TIME) !== null) {
        exempted.push({
          id: "E0",
          file,
          line: d.line,
          text: `${d.prop}: ${normalize(d.value)}`,
          why: REDUCED_MOTION_NOTE,
        });
      }
      continue;
    }
    for (const item of splitTop(d.value)) {
      const masked = maskVarRefs(item);
      for (const t of masked.matchAll(RAW_TIME)) {
        const raw = t[1] + t[2];
        // E1：visibility 的 0s（只有 0s 放行；visibility 200ms 仍然红）。
        if (d.prop.startsWith("transition") && firstWord(item) === "visibility" && raw === "0s") {
          exempted.push({
            id: VISIBILITY_EXEMPTION.id,
            file,
            line: d.line,
            text: `${d.prop}: ${normalize(d.value)}`,
            why: VISIBILITY_EXEMPTION.why,
          });
          continue;
        }
        // E2/E3：被桌面端判卷逐字钉住的动画声明（精确值匹配）。
        const animEx = d.prop === "animation" ? animationExemptionId(d.value) : null;
        if (animEx !== null) {
          const def = ANIMATION_EXEMPTIONS.find((e) => e.id === animEx);
          exempted.push({
            id: animEx,
            file,
            line: d.line,
            text: `${d.prop}: ${normalize(d.value)}`,
            why: def === undefined ? "" : def.why,
          });
          continue;
        }
        findings.push({
          rule: "M2",
          file,
          line: d.line,
          message:
            `裸时长 ${raw}（${d.prop}: ${normalize(d.value)}）——时长必须是 var(--t-*) 令牌；` +
            `唯一豁免是 visibility 的 0s（E1）与被桌面判卷钉住的 breathe 家族（E2/E3）。`,
        });
      }
    }
  }
  // 附带子判据：时长/缓动令牌必须真的存在（悬空 var ⇒ 整条声明静默失效）。
  for (const d of decls) {
    if (!DURATION_PROPS.has(d.prop)) continue;
    for (const m of d.value.matchAll(/var\((--[A-Za-z0-9_-]+)/g)) {
      const name = m[1];
      if (!CHECKED_TOKEN_PREFIXES.some((p) => name.startsWith(p))) continue;
      if (defined.has(name)) continue;
      findings.push({
        rule: "M2",
        file,
        line: d.line,
        message: `悬空令牌 var(${name})——tokens.css 里没有它 ⇒ 这条声明整条失效。`,
      });
    }
  }
  return {
    rule: "M2",
    title: "时长必须是 --t-* 令牌（transition/animation 简写 + duration/delay 声明）",
    findings,
    exempted,
  };
}

function ruleM3(decls: Decl[], file: string, defined: Set<string>): RuleResult {
  const findings: Finding[] = [];
  const exempted: ExemptionHit[] = [];
  for (const d of decls) {
    if (d.prop !== "transition" && d.prop !== "animation") continue;
    if (inReducedMotion(d)) continue;
    const masked = maskVarRefs(d.value);
    if (!RAW_EASING_KEYWORD.test(masked) && !RAW_EASING_FN.test(masked)) continue;
    const animEx = d.prop === "animation" ? animationExemptionId(d.value) : null;
    if (animEx !== null) {
      const def = ANIMATION_EXEMPTIONS.find((e) => e.id === animEx);
      exempted.push({
        id: animEx,
        file,
        line: d.line,
        text: `${d.prop}: ${normalize(d.value)}`,
        why: def === undefined ? "" : def.why,
      });
      continue;
    }
    findings.push({
      rule: "M3",
      file,
      line: d.line,
      message:
        `裸缓动（${d.prop}: ${normalize(d.value)}）——缓动必须来自 --ease-* 令牌；` +
        "（--t-* 令牌本身已带缓动，正确写法是 transition: opacity var(--t-fast)）",
    });
  }
  for (const d of decls) {
    if (d.prop !== "transition" && d.prop !== "animation") continue;
    for (const m of d.value.matchAll(/var\((--[A-Za-z0-9_-]+)/g)) {
      const name = m[1];
      if (!name.startsWith("--ease-")) continue;
      if (defined.has(name)) continue;
      findings.push({
        rule: "M3",
        file,
        line: d.line,
        message: `悬空缓动令牌 var(${name})——tokens.css 里没有它 ⇒ 这条声明整条失效。`,
      });
    }
  }
  return { rule: "M3", title: "缓动必须是 --ease-* 令牌", findings, exempted };
}

function ruleM4(decls: Decl[], file: string, stylesSrc: string, defined: Set<string>): RuleResult {
  const findings: Finding[] = [];
  for (const m of stylesSrc.matchAll(HEX_COLOR)) {
    findings.push({
      rule: "M4",
      file,
      line: countLines(stylesSrc, m.index),
      message: `字面色值 ${m[0]}——色值只许进 tokens.css（组件样式层重抄一份色＝漂移源）。`,
    });
  }
  for (const m of stylesSrc.matchAll(RAW_COLOR_FN)) {
    findings.push({
      rule: "M4",
      file,
      line: countLines(stylesSrc, m.index),
      message: `字面色函数 ${m[0]}——色值只许进 tokens.css（组件样式层重抄一份色＝漂移源）。`,
    });
  }
  for (const d of decls) {
    for (const m of d.value.matchAll(/var\((--swatch-[A-Za-z0-9_-]+)/g)) {
      if (defined.has(m[1])) continue;
      findings.push({
        rule: "M4",
        file,
        line: d.line,
        message: `悬空色令牌 var(${m[1]})——tokens.css 里没有它 ⇒ 这条声明整条失效。`,
      });
    }
  }
  return { rule: "M4", title: "颜色必须是令牌（零 hex、零 hsl()/rgb() 字面量）", findings, exempted: [] };
}

function ruleM5(decls: Decl[], file: string, stylesSrc: string): RuleResult {
  const findings: Finding[] = [];
  const exempted: ExemptionHit[] = [];
  const m = REDUCED_MOTION_QUERY.exec(stylesSrc);
  if (m === null) {
    findings.push({
      rule: "M5",
      file,
      line: 1,
      message: "没有 @media (prefers-reduced-motion: reduce) 块——降级面缺席。",
    });
    return { rule: "M5", title: "prefers-reduced-motion 块是实的（不是一行注释）", findings, exempted };
  }
  // 块体：注释已剥 ⇒ 只写注释的块在这里是空的（M5(iv) 天然判红）。
  const open = stylesSrc.indexOf("{", m.index);
  let depth = 0;
  let close = -1;
  for (let i = open; i < stylesSrc.length; i++) {
    if (stylesSrc[i] === "{") depth++;
    else if (stylesSrc[i] === "}") {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  const body = stylesSrc.slice(open + 1, close === -1 ? stylesSrc.length : close);
  const inner = decls.filter((d) => d.atRules.some((a) => REDUCED_MOTION_QUERY.test(a)));
  if (inner.length === 0) {
    findings.push({
      rule: "M5",
      file,
      line: countLines(stylesSrc, m.index),
      message: "reduced-motion 块里没有**真实声明**（注释不算）——这一块现在是装饰。",
    });
  }
  // (i) 作用域：* / *::before / *::after
  const scope = inner.find((d) => {
    const parts = splitTop(d.selector).map((s) => normalize(s));
    return parts.includes("*") && parts.includes("*::before") && parts.includes("*::after");
  });
  if (scope === undefined) {
    findings.push({
      rule: "M5",
      file,
      line: countLines(stylesSrc, m.index),
      message: "reduced-motion 块没有同时作用到 * / *::before / *::after（伪元素上的动效会逃出去）。",
    });
  }
  // (ii) transition-duration / animation-duration 归零
  const nearZero = (v: string): boolean => {
    const t = /^(\d*\.?\d+)(ms|s)$/.exec(normalize(stripImportant(v)));
    if (t === null) return false;
    const n = Number(t[1]);
    return t[2] === "s" ? n * 1000 <= 1 : n <= 1;
  };
  for (const prop of ["transition-duration", "animation-duration"]) {
    const hit = inner.find((d) => d.prop === prop && nearZero(d.value));
    if (hit === undefined) {
      findings.push({
        rule: "M5",
        file,
        line: countLines(stylesSrc, m.index),
        message: `reduced-motion 块里没有把 ${prop} 压到近零（规范 §4.10 写的是 0.01ms）。`,
      });
      continue;
    }
    exempted.push({
      id: "E0",
      file,
      line: hit.line,
      text: `${prop}: ${normalize(hit.value)}`,
      why: REDUCED_MOTION_NOTE,
    });
  }
  // (iii) scroll-behavior: auto
  const scroll = inner.find(
    (d) => d.prop === "scroll-behavior" && normalize(stripImportant(d.value)) === "auto",
  );
  if (scroll === undefined) {
    findings.push({
      rule: "M5",
      file,
      line: countLines(stylesSrc, m.index),
      message: "reduced-motion 块里没有 scroll-behavior: auto（平滑滚动会让路，滚动本身也得让）。",
    });
  } else {
    exempted.push({
      id: "E0",
      file,
      line: scroll.line,
      text: "scroll-behavior: auto",
      why: REDUCED_MOTION_NOTE,
    });
  }
  return { rule: "M5", title: "prefers-reduced-motion 块是实的（不是一行注释）", findings, exempted };
}

interface RendererFile {
  file: string;
  text: string;
}

function listRendererFiles(dir: string): RendererFile[] {
  const out: RendererFile[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      if (name === "node_modules" || name === "dist" || name === "dist-electron") continue;
      const p = join(d, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(name)) {
        out.push({ file: p, text: stripJsComments(readFileSync(p, "utf8")) });
      }
    }
  };
  walk(dir);
  return out;
}

function ruleM6(stickyPath: string, stickySrc: string, rendererDir: string): RuleResult {
  const findings: Finding[] = [];
  const exempted: ExemptionHit[] = [];
  const hasGuard =
    /matchMedia\(\s*["'`]?\(?\s*prefers-reduced-motion\s*:\s*reduce/i.test(stickySrc) &&
    /["'`]auto["'`]/.test(stickySrc);
  if (!hasGuard) {
    findings.push({
      rule: "M6",
      file: stickyPath,
      line: 1,
      message:
        "useStickyScroll 没有把显式 smooth 降级为 auto（matchMedia(\"(prefers-reduced-motion: reduce)\") " +
        "那一格没了 ⇒ CSS 降级只关掉一半：动画让路了，滚动不让）。",
    });
  }
  // renderer 面：只扫**滚动调用**的实参（scrollTo / scrollIntoView / scrollBy）。
  // 为什么限定在这个面：TS 的参数标注（`behavior: ScrollBehavior = "instant"`）与
  // 对象字面量属性长得一模一样，全文扫 `behavior:` 会把函数签名也当成滚动请求。
  for (const rf of listRendererFiles(rendererDir)) {
    for (const call of rf.text.matchAll(/\b(?:scrollTo|scrollIntoView|scrollBy)\s*\(/g)) {
      const argStart = call.index + call[0].length;
      let depth = 1;
      let j = argStart;
      while (j < rf.text.length && depth > 0) {
        const c = rf.text[j];
        if (c === "(") depth++;
        else if (c === ")") depth--;
        j++;
      }
      const args = rf.text.slice(argStart, Math.max(argStart, j - 1));
      for (const m of args.matchAll(/\bbehavior\s*:\s*([^,;)\n}]+)/g)) {
        const expr = m[1].trim();
        const line = countLines(rf.text, argStart + m.index);
        if (expr.startsWith("scrollBehavior(")) continue; // 走了降级守卫
        if (/^["']/.test(expr)) {
          const literal = expr.replace(/^["']/, "").replace(/["'].*$/, "");
          if (literal === "smooth") {
            findings.push({
              rule: "M6",
              file: rf.file,
              line,
              message:
                `裸 behavior: "smooth"——没走 scrollBehavior() 守卫 ⇒ 减少动态的用户照样被平滑滚动带着走。`,
            });
          }
          continue;
        }
        findings.push({
          rule: "M6",
          file: rf.file,
          line,
          message: `behavior: ${expr}——无法证明它走了 prefers-reduced-motion 降级守卫。`,
        });
      }
    }
  }
  return {
    rule: "M6",
    title: "JS 侧平滑滚动已降级（useStickyScroll 守卫 + renderer 内无裸 \"smooth\"）",
    findings,
    exempted,
  };
}

function ruleM7(decls: Decl[], file: string): RuleResult {
  const findings: Finding[] = [];
  const exempted: ExemptionHit[] = [];
  for (const d of decls) {
    if (!d.value.includes("!important")) continue;
    if (inReducedMotion(d)) {
      exempted.push({
        id: "E0",
        file,
        line: d.line,
        text: `${d.prop}: ${normalize(d.value)}`,
        why: REDUCED_MOTION_NOTE,
      });
      continue;
    }
    const hit = IMPORTANT_EXEMPTIONS.find(
      (e) => normalize(e.selector) === normalize(d.selector) && e.prop === d.prop,
    );
    if (hit !== undefined) {
      exempted.push({
        id: hit.id,
        file,
        line: d.line,
        text: `${normalize(d.selector)} { ${d.prop}: ${normalize(d.value)} }`,
        why: hit.why,
      });
      continue;
    }
    findings.push({
      rule: "M7",
      file,
      line: d.line,
      message:
        `降级块之外的 !important（${normalize(d.selector)} { ${d.prop}: ${normalize(d.value)} }）——` +
        "!important 是最后手段；降级块之外用它＝用权重掩盖结构问题。",
    });
  }
  return { rule: "M7", title: "降级块之外无 !important", findings, exempted };
}

// ── 门面 ────────────────────────────────────────────────────────────────────
export function checkMotionPolicy(target: Target): CheckOutcome {
  const stylesPath = resolve(target.styles);
  const tokensPath = resolve(target.tokens);
  const stickyPath = resolve(target.sticky);
  const rendererDir = resolve(target.renderer);
  const stylesRaw = readFileSync(stylesPath, "utf8");
  const tokensRaw = readFileSync(tokensPath, "utf8");
  const stickyRaw = readFileSync(stickyPath, "utf8");
  const stylesSrc = stripCssComments(stylesRaw);
  const decls = scanDeclarations(stylesSrc);
  const defined = definedTokens(tokensRaw);
  const relStyles = relative(ROOT, stylesPath);
  const relSticky = relative(ROOT, stickyPath);
  const relRenderer = relative(ROOT, rendererDir);

  const results: RuleResult[] = [
    ruleM1(decls, relStyles),
    ruleM2(decls, relStyles, defined),
    ruleM3(decls, relStyles, defined),
    ruleM4(decls, relStyles, stylesSrc, defined),
    ruleM5(decls, relStyles, stylesSrc),
    ruleM6(relSticky, stickyRaw, rendererDir),
    ruleM7(decls, relStyles),
  ];
  const failures = results.filter((r) => r.findings.length > 0).length;
  const findingCount = results.reduce((n, r) => n + r.findings.length, 0);
  return { results, failures, findingCount };
}

function parseArgs(argv: string[]): Target {
  const target: Target = { ...DEFAULT_TARGETS };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = (): string => {
      const v = argv[i + 1];
      if (v === undefined) throw new Error("参数缺值：" + a);
      i++;
      return v;
    };
    if (a === "--styles") target.styles = next();
    else if (a === "--tokens") target.tokens = next();
    else if (a === "--sticky") target.sticky = next();
    else if (a === "--renderer") target.renderer = next();
    else if (a === "--help" || a === "-h") {
      console.log(
        "用法：node --import tsx scripts/motion-policy-check.ts [--styles <f>] [--tokens <f>] [--sticky <f>] [--renderer <dir>]",
      );
      process.exit(0);
    } else throw new Error("未知参数：" + a);
  }
  return target;
}

export function formatOutcome(outcome: CheckOutcome): string {
  const lines: string[] = [];
  lines.push("[motion-policy-check] 桌面端动效面 · 纪律判卷（设计面 Phase 4）");
  lines.push("  读面：apps/desktop/src/renderer/styles.css · tokens.css · useStickyScroll.ts · renderer 目录");
  lines.push("");
  for (const r of outcome.results) {
    const ok = r.findings.length === 0;
    lines.push(`  ${ok ? "✅" : "❌"} ${r.rule} ${r.title}`);
    for (const f of r.findings) {
      lines.push(`       ↳ ${f.file}:${String(f.line)} · ${f.message}`);
    }
    const byId = new Map<string, number>();
    for (const e of r.exempted) byId.set(e.id, (byId.get(e.id) ?? 0) + 1);
    if (byId.size > 0) {
      const parts = [...byId.entries()].map(([id, n]) => `${id} ×${String(n)}`);
      lines.push(`       豁免命中 ${parts.join(" · ")}（登记在下面那张表里，不是放过）`);
    }
  }
  lines.push("");
  lines.push("  豁免清单（显式登记 · 每条带理由）：");
  lines.push(
    `   E1 ${VISIBILITY_EXEMPTION.what} — ${VISIBILITY_EXEMPTION.why}`,
  );
  for (const ex of ANIMATION_EXEMPTIONS) lines.push(`   ${ex.id} ${ex.what} — ${ex.why}`);
  for (const ex of IMPORTANT_EXEMPTIONS) {
    lines.push(`   ${ex.id} ${ex.selector} { ${ex.prop}: ${ex.value} } — ${ex.why}`);
  }
  lines.push(`   E0 ${REDUCED_MOTION_NOTE}`);
  lines.push("");
  if (outcome.failures > 0) {
    lines.push(
      `[motion-policy-check] 红：${String(outcome.failures)} 条规则判红，共 ${String(outcome.findingCount)} 处发现`,
    );
  } else {
    lines.push(
      `[motion-policy-check] 绿：${String(outcome.results.length)} 条规则全过，0 处发现` +
        "（纪律绿 ≠ 真机好看：观感归业主目验）",
    );
  }
  return lines.join("\n");
}

export function main(argv: string[]): number {
  let target: Target;
  try {
    target = parseArgs(argv);
  } catch (err) {
    console.error("[motion-policy-check] 用法错：" + (err as Error).message);
    return 2;
  }
  const outcome = checkMotionPolicy(target);
  const text = formatOutcome(outcome);
  if (outcome.failures > 0) console.error(text);
  else console.log(text);
  return outcome.failures > 0 ? 1 : 0;
}

function isDirectRun(): boolean {
  const arg = process.argv[1];
  if (arg === undefined) return false;
  try {
    return resolve(arg) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isDirectRun()) process.exitCode = main(process.argv.slice(2));
