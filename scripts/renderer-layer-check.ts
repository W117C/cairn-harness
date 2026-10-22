// 渲染层分层纪律（Phase 2 · 批 2.5）：四条机械不变量的机器面。
//
// 规矩本体在 apps/desktop/src/renderer/LAYERING.md；这里只把它**变成能红的**：
// 纯检查 + main() 打印裁决 + 违规时非零退出码。风格同 scripts/desktop-boundary-check.ts。
//
// 四条：
//   I1  components/** 与 panes/** 不许 import App.tsx（防循环依赖回流）。
//   I2  state/** 不许 import components/**（状态层不许长出界面）。
//   I3  derived/** 必须是**纯**投影：无时钟、无随机、无 IO、无 await/async、无副作用模块、无模块级可变态。
//   I4  行数帽：渲染层每个 .ts/.tsx（vendor/ 除外）≤ RENDERER_FILE_LINE_CAP；
//       App.tsx 另有一条更紧的帽（APP_TSX_LINE_CAP）。
//
// 帽为什么是这个数（RENDERER_FILE_LINE_CAP = 1200）：它刚好高过今天的第二大渲染层模块
// （components/PaneDock.tsx = 1194 行）——即这把尺**逼 App.tsx 那个单体必须拆**，
// 又**不逼本轮顺带把别的模块也拆**。App.tsx 那条更紧的帽是 composition root 的目标值
// （见 APP_TSX_LINE_CAP 处的说明与阶梯）。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** 渲染层每个 .ts/.tsx 的行数上限（vendor/ 除外）。 */
export const RENDERER_FILE_LINE_CAP = 1200;

/**
 * App.tsx 的行数上限（比通用帽更紧：composition root 只该"接线"，不该装实现）。
 *
 * 阶梯：1200（通用帽）→ 本值 → 600。每一档是**后续批次**的账：只许收紧，不许放松。
 * 「不许高于该文件当前值」是硬规矩 ⇒ 拆到哪儿就钉到哪儿，不许先立一个够不到的数。
 */
export const APP_TSX_LINE_CAP = 900;

/** 派生层允许的**运行时**依赖（纯模块白名单；type-only 导入不进这张表）。 */
const DERIVED_RUNTIME_ALLOWLIST = new Set(["src/main/usage-ledger.ts"]);

const ROOT = fileURLToPath(new URL("..", import.meta.url));
/** 渲染层相对仓根的路径（判卷在临时目录里造样本时也用同一套相对路径）。 */
export const RENDERER_REL = "apps/desktop/src/renderer";
const RENDERER = join(ROOT, RENDERER_REL);

export interface Violation {
  rule: string;
  file: string;
  line: number;
  message: string;
}

function isSourceFile(name: string): boolean {
  return /\.tsx?$/.test(name);
}

/** 递归列出渲染层下的 .ts/.tsx（跳过 vendor/ 与构建产物）。 */
export function listRendererFiles(dir = RENDERER, out: string[] = []): string[] {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "vendor" || name === "node_modules" || name === "dist" || name === "dist-electron") continue;
      listRendererFiles(full, out);
      continue;
    }
    if (isSourceFile(name)) out.push(full);
  }
  return out;
}

/** 去掉注释与字符串字面量的内容（判据只看**代码**，注释里写个词不算犯规）。 */
export function stripCommentsAndStrings(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const two = src.slice(i, i + 2);
    if (two === "//") {
      while (i < n && src[i] !== "\n") i += 1;
      continue;
    }
    if (two === "/*") {
      i += 2;
      while (i < n && src.slice(i, i + 2) !== "*/") i += 1;
      i += 2;
      continue;
    }
    const ch = src[i]!;
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i += 1;
      while (i < n) {
        if (src[i] === "\\") { i += 2; continue; }
        if (src[i] === quote) { i += 1; break; }
        if (quote === "`" && src[i] === "$" && src[i + 1] === "{") {
          // 模板插值里的表达式是真代码 ⇒ 保留（只跳过引号部分）。
          let depth = 1;
          i += 2;
          let buf = "";
          while (i < n && depth > 0) {
            if (src[i] === "{") depth += 1;
            else if (src[i] === "}") depth -= 1;
            if (depth > 0) buf += src[i];
            i += 1;
          }
          out += buf;
          continue;
        }
        i += 1;
      }
      out += " ";
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

interface ImportRef {
  specifier: string;
  line: number;
  typeOnly: boolean;
}

/** 抽出文件里的 import 说明符（含 export ... from 与动态 import）。 */
export function extractImports(src: string): ImportRef[] {
  const out: ImportRef[] = [];
  const lines = src.split("\n");
  lines.forEach((text, idx) => {
    const re = /(?:^|[^\w$])(?:import|export)\s+(type\s+)?(?:[^'"()]*?\sfrom\s+)?["']([^"']+)["']/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      out.push({ specifier: m[2]!, line: idx + 1, typeOnly: m[1] !== undefined });
    }
    const dyn = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
    while ((m = dyn.exec(text)) !== null) {
      out.push({ specifier: m[1]!, line: idx + 1, typeOnly: false });
    }
  });
  return out;
}

/** 说明符 → 仓内相对路径（解析不到就 null）。 */
function resolveSpecifier(fromFile: string, spec: string, root: string = ROOT): string | null {
  if (!spec.startsWith(".")) return null;
  const base = resolve(dirname(fromFile), spec);
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    try {
      if (statSync(cand).isFile()) return relative(root, cand).split("\\").join("/");
    } catch { /* 不是文件就试下一个 */ }
  }
  return null;
}

function relOf(file: string, root: string = ROOT): string {
  return relative(root, file).split("\\").join("/");
}

/** I1：components/** 与 panes/** 不许 import App.tsx。 */
export function checkI1(files: string[], root: string = ROOT): Violation[] {
  const out: Violation[] = [];
  const appPath = "apps/desktop/src/renderer/App.tsx";
  for (const file of files) {
    const rel = relOf(file, root);
    if (!(rel.startsWith("apps/desktop/src/renderer/components/") || rel.startsWith("apps/desktop/src/renderer/panes/"))) continue;
    const src = readFileSync(file, "utf8");
    for (const imp of extractImports(src)) {
      if (resolveSpecifier(file, imp.specifier, root) === appPath) {
        out.push({ rule: "I1", file: rel, line: imp.line, message: "components/** 与 panes/** 不许 import App.tsx（防循环依赖回流）" });
      }
    }
  }
  return out;
}

/** I2：state/** 不许 import components/**。 */
export function checkI2(files: string[], root: string = ROOT): Violation[] {
  const out: Violation[] = [];
  for (const file of files) {
    const rel = relOf(file, root);
    if (!rel.startsWith("apps/desktop/src/renderer/state/")) continue;
    const src = readFileSync(file, "utf8");
    for (const imp of extractImports(src)) {
      const target = resolveSpecifier(file, imp.specifier, root);
      if (target !== null && target.startsWith("apps/desktop/src/renderer/components/")) {
        out.push({ rule: "I2", file: rel, line: imp.line, message: `state/** 不许 import components/**（不许 import ${target}）` });
      }
    }
  }
  return out;
}

/** I3：derived/** 必须是纯投影。 */
export function checkI3(files: string[], root: string = ROOT): Violation[] {
  const out: Violation[] = [];
  const banned: { re: RegExp; why: string }[] = [
    { re: /\bDate\s*\.\s*now\b/, why: "不读时钟（Date.now）" },
    { re: /\bnew\s+Date\b/, why: "不构造日期（new Date）" },
    { re: /\bMath\s*\.\s*random\b/, why: "不取随机（Math.random）" },
    { re: /\bperformance\s*\.\s*now\b/, why: "不读高精度时钟（performance.now）" },
    { re: /\bawait\b/, why: "不同步等待（await）" },
    { re: /\basync\b/, why: "不写异步函数（async）" },
  ];
  for (const file of files) {
    const rel = relOf(file, root);
    if (!rel.startsWith("apps/desktop/src/renderer/derived/")) continue;
    const raw = readFileSync(file, "utf8");
    const code = stripCommentsAndStrings(raw);
    const codeLines = code.split("\n");
    codeLines.forEach((line, idx) => {
      for (const { re, why } of banned) {
        if (re.test(line)) {
          out.push({ rule: "I3", file: rel, line: idx + 1, message: `派生层必须是纯投影：${why}` });
        }
      }
    });
    // 模块级可变态（顶格 let/var）。
    codeLines.forEach((line, idx) => {
      if (/^(let|var)\s/.test(line)) {
        out.push({ rule: "I3", file: rel, line: idx + 1, message: "派生层不留模块级可变状态（顶层 let/var）" });
      }
    });
    // 导入面：只许 type-only、派生层内部、以及白名单里的纯模块。
    for (const imp of extractImports(raw)) {
      if (imp.typeOnly) continue;
      if (/^(node:|electron$)/.test(imp.specifier)) {
        out.push({ rule: "I3", file: rel, line: imp.line, message: `派生层不许 import 运行时/宿主模块（${imp.specifier}）` });
        continue;
      }
      const target = resolveSpecifier(file, imp.specifier, root);
      if (target === null) continue;
      if (target.startsWith("apps/desktop/src/renderer/derived/")) continue;
      if (DERIVED_RUNTIME_ALLOWLIST.has(target)) continue;
      out.push({ rule: "I3", file: rel, line: imp.line, message: `派生层只许吃纯模块（未登记：${target}）` });
    }
  }
  return out;
}

/** I4：行数帽。 */
export function checkI4(files: string[], root: string = ROOT): Violation[] {
  const out: Violation[] = [];
  for (const file of files) {
    const rel = relOf(file, root);
    const lines = readFileSync(file, "utf8").split("\n").length;
    const cap = rel.endsWith("renderer/App.tsx") ? APP_TSX_LINE_CAP : RENDERER_FILE_LINE_CAP;
    if (lines > cap) {
      out.push({ rule: "I4", file: rel, line: 1, message: `行数 ${lines} 超过上限 ${cap}` });
    }
  }
  return out;
}

/** 跑齐四条。 */
export function checkAll(files: string[] = listRendererFiles(), root: string = ROOT): Violation[] {
  return [...checkI1(files, root), ...checkI2(files, root), ...checkI3(files, root), ...checkI4(files, root)];
}

function main(): void {
  const files = listRendererFiles();
  const violations = checkAll(files);
  if (violations.length > 0) {
    console.error("renderer-layer-check 红线：\n" + violations.map((v) => `  [${v.rule}] ${v.file}:${v.line} — ${v.message}`).join("\n"));
    process.exit(1);
  }
  console.log(
    `renderer-layer-check: 绿（${files.length} 个渲染层源文件；I1 组件层不回流 App / I2 状态层不 import 组件 / I3 派生层纯 / I4 行数帽 ${RENDERER_FILE_LINE_CAP}·App ${APP_TSX_LINE_CAP}）`,
  );
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}
