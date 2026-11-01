#!/usr/bin/env node
// 从 Claude Desktop 的渲染层 CSS 里逐条抽出 45 个 `[data-cds=*]` 组件的规则。
//
// 为什么需要这一步：官方组件的**令牌契约**在 `tokens.vanilla.css`（见 extract-cds-tokens.py 的产物
// `src/renderer/vendor/cds-official/tokens.css`），但组件级的规则（消息气泡变量、卡片按压、
// 工具栏毛玻璃、骨架呼吸、附件尺寸…）只存在于 Tailwind 编译产物 `MainWindowPage-*.css` 里。
// 该产物 237 KB 且是压缩代码，不适合直接入库；这里只保留**选择器里带 data-cds 的规则**，
// 逐条照抄（不做语义改写），产出 `components.css` + `components.json` 供适配层消费与判卷。
//
// 用法：
//   node scripts/extract-cds-components.mjs <MainWindowPage-*.css> <out-dir>
//
// 两个变换（只有这两个，且都可逐条核对）：
//   1. `.cds-root` → `body[data-dsh-claude-style]`：Cairn 的皮肤根就是 body 上这个属性；
//   2. `var(--cds-x)` → `var(--x)`：仅当 x 在官方 vanilla 令牌薄里有同名定义（带 --cds- 前缀的
//      是 Tailwind 构建期的别名，vanilla 薄用的是不带前缀的公共名）。组件私有变量
//      （--cds-message-bubble-* / --cds-card-press-* / --cds-assistant-message-* …）没有同名公共名，
//      原样保留。
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const [, , srcArg, outArg] = process.argv;
if (!srcArg || !outArg) {
  console.error("usage: node scripts/extract-cds-components.mjs <MainWindowPage-*.css> <out-dir>");
  process.exit(2);
}
const srcPath = resolve(srcArg);
const outDir = resolve(outArg);
const tokensPath = resolve(dirname(new URL(import.meta.url).pathname), "../src/renderer/vendor/cds-official/tokens.css");
const css = readFileSync(srcPath, "utf8");
const tokensCss = readFileSync(tokensPath, "utf8");

/** 官方 vanilla 薄里的公共令牌名（不带 --cds- 前缀）。 */
const publicTokens = new Set([...tokensCss.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)].map((m) => m[1]));

/** 把 CSS 拆成 (条件栈, 选择器, 声明体) 序列；@media/@supports/@layer 作为条件栈保留。
 *
 * 注释先剥掉：压缩后的 CSS 里注释带撇号（don't / Claude's），带引号跟踪的扫描器会把
 * 后面的花括号一起吞进"字符串"（实测：1165 条规则只剩 139 条）。这里只数花括号。 */
function walk(text, conditions = [], out = []) {
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("{", i);
    if (open < 0) break;
    const prelude = text.slice(i, open).trim();
    let depth = 1;
    let close = open + 1;
    while (close < text.length && depth > 0) {
      if (text[close] === "{") depth += 1;
      else if (text[close] === "}") depth -= 1;
      close += 1;
    }
    const body = text.slice(open + 1, close - 1);
    if (prelude.startsWith("@")) {
      walk(body, [...conditions, prelude], out);
    } else if (prelude !== "") {
      out.push({ conditions, selector: prelude, body });
    }
    i = close;
  }
  return out;
}

const cleanCss = css.replace(/\/\*[\s\S]*?\*\//g, "");
const rules = walk(cleanCss).filter(
  // 只留组件契约：选择器必须点名 data-cds；排除 Tailwind 生成的可选链工具类
  // （`.has-\[…\]` 这类选择器是页面级一次性工具类，不是组件规则）。
  (rule) => rule.selector.includes("[data-cds=") && !rule.selector.includes("\\["),
);

/** 只替换「公共令牌」的引用，组件私有变量原样保留。 */
function bridgeTokens(text) {
  return text.replace(/var\((--cds-[a-z0-9-]+)/gi, (all, name) => {
    const publicName = name.replace(/^--cds-/, "--");
    return publicTokens.has(publicName) ? `var(${publicName}` : all;
  });
}

function transformSelector(selector) {
  return selector
    .replace(/\.cds-root/g, "body[data-dsh-claude-style]")
    // Tailwind 在类名里转义的冒号斜杠保持原样；这里只处理根作用域。
    .trim();
}

const components = new Map();
function noteComponent(name, rule) {
  const entry = components.get(name) ?? {
    name,
    rules: 0,
    declarations: 0,
    conditions: new Set(),
    sampleSelectors: [],
  };
  entry.rules += 1;
  // 只数真声明（属性: 值），不算嵌套块的花括号。
  entry.declarations += [...rule.body.matchAll(/(?:^|;)\s*-{0,2}[a-z][a-z0-9-]*\s*:/gi)].length;
  for (const condition of rule.conditions) entry.conditions.add(condition.replace(/\s+/g, " ").trim());
  if (entry.sampleSelectors.length < 3) entry.sampleSelectors.push(rule.selector.slice(0, 240));
  components.set(name, entry);
}

const chunks = [];
for (const rule of rules) {
  const names = [...new Set([...rule.selector.matchAll(/\[data-cds=([A-Za-z0-9_-]+)\]/g)].map((m) => m[1]))];
  for (const name of names) noteComponent(name, rule);
  const indent = "  ".repeat(rule.conditions.length);
  const lines = rule.conditions.map((condition, index) => `${"  ".repeat(index)}${condition}{`);
  lines.push(`${indent}${transformSelector(rule.selector)}{${bridgeTokens(rule.body)}}`);
  for (let index = rule.conditions.length - 1; index >= 0; index -= 1) lines.push(`${"  ".repeat(index)}}`);
  chunks.push(lines.join("\n"));
}

for (const name of new Set([...css.matchAll(/\[data-cds=([A-Za-z0-9_-]+)\]/g)].map((m) => m[1]))) {
  if (!components.has(name)) {
    components.set(name, {
      name,
      rules: 0,
      declarations: 0,
      conditions: new Set(["(only referenced by Tailwind utility selectors; no component rule emitted)"]),
      sampleSelectors: [],
    });
  }
}

const sorted = [...components.values()].sort((a, b) => b.rules - a.rules || a.name.localeCompare(b.name));
const manifest = {
  source: {
    file: basename(srcPath),
    sha256: createHash("sha256").update(css).digest("hex"),
    bytes: Buffer.byteLength(css),
  },
  transform: {
    root: ".cds-root -> body[data-dsh-claude-style]",
    tokens: "var(--cds-x) -> var(--x) only when --x exists in vendor/cds-official/tokens.css",
  },
  totals: {
    components: sorted.length,
    rules: rules.length,
    declarations: sorted.reduce((sum, entry) => sum + entry.declarations, 0),
  },
  components: sorted.map((entry) => ({
    name: entry.name,
    rules: entry.rules,
    declarations: entry.declarations,
    conditions: [...entry.conditions],
    sampleSelectors: entry.sampleSelectors,
  })),
};

const header = `/* Generated by apps/desktop/scripts/extract-cds-components.mjs — do not hand-edit.
 *
 * Source: ${basename(srcPath)} (${Buffer.byteLength(css)} B)
 * sha256: ${manifest.source.sha256}
 * Components: ${manifest.totals.components} · rules: ${manifest.totals.rules} · declarations: ${manifest.totals.declarations}
 *
 * 只含选择器点名 \`[data-cds=...]\` 的规则；两个变换见脚本头注释。
 * 这份文件是**官方组件契约层**：Cairn 在组件根上写同名 \`data-cds\` 标记即可命中；
 * 未标记的组件不会受影响（选择器不会误伤）。
 */
`;

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "components.css"), header + chunks.join("\n") + "\n");
writeFileSync(join(outDir, "components.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(
  JSON.stringify(
    {
      out: join(outDir, "components.css"),
      manifest: join(outDir, "components.json"),
      components: manifest.totals.components,
      rules: manifest.totals.rules,
      declarations: manifest.totals.declarations,
      bytes: Buffer.byteLength(header + chunks.join("\n") + "\n"),
    },
    null,
    2,
  ),
);
