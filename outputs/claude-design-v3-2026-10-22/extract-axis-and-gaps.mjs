#!/usr/bin/env node
// 本轮（2026-10-22）的新读数：**作用域敏感的**字重轴 + 我们没吸收的令牌族缺口表。
//
// 为什么不能直接用上一轮的 tokens-v3.json：那份是「同名取首次出现」的字面表，
// **不带作用域** ⇒ 暗色轴（`"wght" 360`）与亮色静态档（`400`）混在一起无法分辨。
// 本脚本按 CSS 规则逐条解析（选择器 + 声明），把作用域一起读出来。
//
// 只读：不执行 Claude 的任何代码。asar 头解析 + CSS 文本匹配。
//
// 用法：
//   node extract-axis-and-gaps.mjs [app.asar] [out.json]
// 缺省对象：/Applications/Claude.app/Contents/Resources/app.asar
// 缺省输出：axis-and-gaps.json（与本脚本同目录）
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const asar = process.argv[2] ?? "/Applications/Claude.app/Contents/Resources/app.asar";
const outPath = process.argv[3] ?? join(HERE, "axis-and-gaps.json");
const repoTokens = process.argv[4] ?? join(HERE, "..", "..", "apps", "desktop", "src", "renderer", "tokens.css");

function readAsarHeader(path) {
  const fd = readFileSync(path);
  if (fd.length < 16) throw new Error("不是 asar：文件过短");
  const headerSize = fd.readUInt32LE(12);
  if (headerSize <= 0 || headerSize > fd.length - 16) throw new Error("不是 asar：头部长度非法");
  const header = JSON.parse(fd.subarray(16, 16 + headerSize).toString("utf8"));
  return { buf: fd, base: 16 + headerSize, header };
}

function walk(node, prefix, out) {
  for (const [name, entry] of Object.entries(node.files ?? {})) {
    const p = prefix === "" ? name : `${prefix}/${name}`;
    if (entry.files !== undefined) walk(entry, p, out);
    else out.push({ path: p, size: entry.size, offset: Number(entry.offset), unpacked: entry.unpacked === true });
  }
}

const { buf, base, header } = readAsarHeader(asar);
const files = [];
walk(header, "", files);
const css = files
  .filter((f) => f.path.endsWith(".css") && !f.unpacked)
  .sort((a, b) => b.size - a.size)[0];
if (css === undefined) throw new Error("asar 里没有 CSS");
const text = buf.subarray(base + css.offset, base + css.offset + css.size).toString("utf8");

/** 某个声明所在规则的选择器（CSS 是压缩的一行串：回退到上一个 `}` 之后的那段）。 */
function selectorAt(index) {
  const open = text.lastIndexOf("{", index);
  const close = text.lastIndexOf("}", open);
  return text.slice(close + 1, open).replace(/\s+/g, " ").trim();
}

/** 逐条读某个令牌前缀的声明，带作用域。 */
function readFamily(prefix) {
  const out = [];
  const re = new RegExp(`(--cds-${prefix}[a-z0-9-]*)\\s*:\\s*([^;{}]+);`, "g");
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push({ token: m[1], value: m[2].trim(), scope: selectorAt(m.index) });
  }
  return out;
}

const weightAxis = readFamily("font-(?:weight|wght)-");
const leading = readFamily("leading-");
const gaps = readFamily("gap-");
const pads = readFamily("pad-");
const zScale = readFamily("z-");
const message = readFamily("message-(?:bubble|actions)-");
const assistant = readFamily("assistant-message-text-");
const scrollFade = readFamily("scroll-fade-");
const fontSize = readFamily("font-size-");

/** 本仓 tokens.css 已有的令牌名（用于缺口对照）。 */
const ourTokens = new Set(
  [...readFileSync(repoTokens, "utf8").matchAll(/--([a-z0-9-]+)\s*:/g)].map((m) => m[1]),
);

/** 把 Claude 的族名按「本仓是否有同义令牌」粗分：只按名字里是否有同前缀的词根。 */
const FAM = {
  leading: ["lh", "leading", "line-height"],
  gap: ["gap", "space", "s-"],
  pad: ["pad", "p-"],
  "z-": ["z", "zindex"],
  "message-bubble": ["radius-composer", "bubble"],
  "message-actions": ["action"],
  "font-size-": ["fs-"],
  "font-weight": ["fw-"],
  "font-wght": ["fw-"],
};

function absorbed(ourSet, family) {
  const keys = FAM[family] ?? [];
  return [...ourSet].some((n) => keys.some((k) => n.startsWith(k) || n.includes(k)));
}

const families = {
  leading,
  gap: gaps,
  pad: pads,
  "z-": zScale,
  "message-bubble": message.filter((r) => r.token.startsWith("--cds-message-bubble")),
  "message-actions": message.filter((r) => r.token.startsWith("--cds-message-actions")),
  "font-size-": fontSize,
};

const gapTable = Object.fromEntries(
  Object.entries(families).map(([fam, rows]) => [
    fam,
    {
      claudeTokenCount: rows.length,
      // 本仓是否有同义面（名字根匹配，**粗判**，不是等价证明）
      ourRepoHasCounterpart: absorbed(ourTokens, fam),
      samples: rows.slice(0, 4).map((r) => ({ token: r.token, value: r.value })),
    },
  ]),
);

const result = {
  source: asar,
  cssEntry: css.path,
  cssBytes: css.size,
  extractedAt: new Date().toISOString(),
  ourTokensFile: repoTokens,
  ourTokenCount: ourTokens.size,
  fontWeightAxis: weightAxis,
  assistantMessageText: assistant,
  scrollFadeSize: scrollFade.filter((r) => r.token === "--cds-scroll-fade-size"),
  gapTable,
};
writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n");
console.log(`[axis] CSS ${css.path} (${css.size} B)`);
console.log(`[axis] 字重/字重轴声明 ${weightAxis.length} 条、暗色轴实例：`);
for (const r of weightAxis) {
  if (/"wght"|\d/.test(r.value) && r.value !== "normal" && r.value !== "initial") {
    console.log(`   ${r.token}: ${r.value}   ← ${r.scope.slice(0, 110)}`);
  }
}
console.log(`[axis] 缺口表：`);
for (const [fam, v] of Object.entries(gapTable)) {
  console.log(`   ${fam.padEnd(16)} claude ${String(v.claudeTokenCount).padStart(3)} 条   本仓有同义面：${v.ourRepoHasCounterpart ? "有" : "无"}`);
}
console.log(`[axis] 写出：${outPath}`);
