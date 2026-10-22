#!/usr/bin/env node
// 从 Claude Desktop 的 app.asar 里提取 `--cds-*` 设计令牌（只读，不执行应用代码）。
// 用法：
//   node extract-tokens.mjs [app.asar] [out.json]
// 缺省对象：/Applications/Claude.app/Contents/Resources/app.asar
// 缺省输出：tokens.json（与本脚本同目录）
//
// 为什么直接解析 asar：Claude 的入口 bundle 有 477 个 JS，REA 全量分析会超时；
// 而设计令牌全在编译后的 CSS 文本里，按 asar 头取文件即可，不需要执行或反混淆。
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const asar = process.argv[2] ?? "/Applications/Claude.app/Contents/Resources/app.asar";
const outPath = process.argv[3] ?? join(HERE, "tokens.json");

function readAsarHeader(path) {
  const fd = readFileSync(path); // 50 MB 级别，一次性读入；研究工具，不追求流式
  if (fd.length < 16) throw new Error("不是 asar：文件过短");
  const headerSize = fd.readUInt32LE(12);
  if (headerSize <= 0 || headerSize > fd.length - 16) throw new Error("不是 asar：头部长度非法");
  const header = JSON.parse(fd.subarray(16, 16 + headerSize).toString("utf8"));
  return { buf: fd, base: 16 + headerSize, header };
}

function walk(node, prefix, out) {
  for (const [name, entry] of Object.entries(node.files ?? {})) {
    const path = prefix === "" ? name : `${prefix}/${name}`;
    if (entry.files !== undefined) walk(entry, path, out);
    else out.push({ path, size: entry.size, offset: Number(entry.offset), unpacked: entry.unpacked === true });
  }
}

const { buf, base, header } = readAsarHeader(asar);
const files = [];
walk(header, "", files);
const cssFiles = files
  .filter((f) => f.path.endsWith(".css") && !f.unpacked)
  .sort((a, b) => b.size - a.size);
if (cssFiles.length === 0) throw new Error("asar 里没有 CSS");

const TOKEN_RE = /(--cds-[a-z0-9-]+)\s*:\s*([^;{}]+);/g;
const tokens = new Map();
let scannedBytes = 0;
let cssEntry = null;
for (const f of cssFiles) {
  const text = buf.subarray(base + f.offset, base + f.offset + f.size).toString("utf8");
  scannedBytes += f.size;
  let m;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    if (!tokens.has(m[1])) tokens.set(m[1], m[2].trim());
  }
  if (cssEntry === null && tokens.size > 0) cssEntry = f.path;
}

const result = {
  source: asar,
  cssEntry,
  cssFiles: cssFiles.length,
  scannedBytes,
  extractedAt: new Date().toISOString(),
  tokenCount: tokens.size,
  tokens: Object.fromEntries([...tokens].sort(([a], [b]) => a.localeCompare(b))),
};
writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n");
console.log(`[extract] ${cssFiles.length} 个 CSS / ${scannedBytes} B ⇒ ${tokens.size} 个 --cds-* 定义`);
console.log(`[extract] 入口：${cssEntry}`);
console.log(`[extract] 写出：${outPath}`);
