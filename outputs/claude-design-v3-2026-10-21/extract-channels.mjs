#!/usr/bin/env node
// 从 Claude Desktop app.asar 提取 `$eipc_message$` 通道名（只读静态分析，不执行应用代码）。
// 用法：node extract-channels.mjs [app.asar] [out.txt]
// 缺省对象：/Applications/Claude.app/Contents/Resources/app.asar
// 缺省输出：channels.txt（与本脚本同目录）
//
// 方法与上一轮 v2 报告一致：通道 = `$eipc_message$_<uuid>$_<namespace>$_<Controller>$_<method>`；
// preload 里前缀是常量（`f="$eipc_message$_<uuid>$_claude.settings_$_"`），调用点常写成
// `ipcRenderer.invoke(f+"AppConfig_$_getAppConfig")`。本脚本做常量折叠，并额外处理两种常见写法：
//   ① `r=f+"..."; ipcRenderer.on(r, fn)` —— 在调用点前 1200 字符内回溯 `r=prefix+"..."`；
//   ② `r="$eipc_message$..."; ipcRenderer.on(r, fn)` —— 回溯完整字面量赋值。
// 局限：这是启发式静态提取，不是 REA 的语义图；`setImplementation` 运行时拼装的通道、
// 模板字符串通道、以及超过回溯窗口的赋值都不保证覆盖。输出按字典序，逐行一个通道。
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const asar = process.argv[2] ?? "/Applications/Claude.app/Contents/Resources/app.asar";
const outPath = process.argv[3] ?? join(HERE, "channels.txt");

function readAsar(path) {
  const buf = readFileSync(path);
  const headerSize = buf.readUInt32LE(12);
  if (headerSize <= 0 || headerSize > buf.length - 16) throw new Error("不是 asar：头部长度非法");
  return { buf, base: 16 + headerSize, header: JSON.parse(buf.subarray(16, 16 + headerSize).toString("utf8")) };
}

function listFiles(node, prefix, out) {
  for (const [name, entry] of Object.entries(node.files ?? {})) {
    const path = prefix === "" ? name : `${prefix}/${name}`;
    if (entry.files !== undefined) listFiles(entry, path, out);
    else out.push({ path, size: entry.size, offset: Number(entry.offset), unpacked: entry.unpacked === true });
  }
}

const { buf, base, header } = readAsar(asar);
const files = [];
listFiles(header, "", files);
const texts = [];
const prefixes = new Map();
let jsFiles = 0;
let jsBytes = 0;
for (const f of files) {
  if (!/\.(js|mjs|cjs)$/.test(f.path) || f.unpacked) continue;
  const text = buf.subarray(base + f.offset, base + f.offset + f.size).toString("utf8");
  texts.push(text);
  jsFiles += 1;
  jsBytes += f.size;
  let m;
  const pre = /([A-Za-z_$][\w$]*)\s*=\s*"(\$eipc_message\$_[^"]+)"/g;
  while ((m = pre.exec(text)) !== null) prefixes.set(m[1], m[2]);
}

const channels = new Set();
for (const text of texts) {
  let m;
  const direct = /ipcRenderer\.(?:invoke|on|send)\(\s*([A-Za-z_$][\w$]*)\s*\+\s*"([^"]+)"/g;
  while ((m = direct.exec(text)) !== null) {
    const prefix = prefixes.get(m[1]);
    if (prefix !== undefined) channels.add(prefix + m[2]);
  }
  const literal = /ipcRenderer\.(?:invoke|on|send)\(\s*"(\$eipc_message\$_[^"]+)"/g;
  while ((m = literal.exec(text)) !== null) channels.add(m[1]);

  const local = /ipcRenderer\.(?:invoke|on|send)\(\s*([A-Za-z_$][\w$]*)\s*[,)]/g;
  while ((m = local.exec(text)) !== null) {
    const name = m[1];
    const back = text.slice(Math.max(0, m.index - 1200), m.index);
    const assign = new RegExp(`\\b${name.replace(/\$/g, "\\$")}\\s*=\\s*([A-Za-z_$][\\w$]*)\\s*\\+\\s*"([^"]+)"`, "g");
    let a;
    let last = null;
    while ((a = assign.exec(back)) !== null) last = a;
    if (last !== null) {
      const prefix = prefixes.get(last[1]);
      if (prefix !== undefined) channels.add(prefix + last[2]);
      continue;
    }
    const fullAssign = new RegExp(`\\b${name.replace(/\$/g, "\\$")}\\s*=\\s*"(\\$eipc_message\\$_[^"]+)"`, "g");
    let f;
    let lastFull = null;
    while ((f = fullAssign.exec(back)) !== null) lastFull = f;
    if (lastFull !== null) channels.add(lastFull[1]);
  }
}

const all = [...channels].sort();
writeFileSync(outPath, all.join("\n") + "\n");
const byNamespace = new Map();
for (const c of all) {
  const m = c.match(/^\$eipc_message\$_[^_]+_\$_(.+?)_\$_/);
  const ns = m === null ? "?" : m[1];
  byNamespace.set(ns, (byNamespace.get(ns) ?? 0) + 1);
}
console.log(`[channels] ${jsFiles} 个 JS / ${jsBytes} B ⇒ ${all.length} 条通道 / ${byNamespace.size} 个命名空间`);
for (const [ns, n] of [...byNamespace].sort((a, b) => b[1] - a[1])) console.log(`  ${ns}: ${n}`);
console.log(`[channels] 写出：${outPath}`);
