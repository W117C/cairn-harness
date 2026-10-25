/**
 * 引用对齐：把**旧 sha 前缀**换成**同一笔提交的新 sha 前缀**，并同步改名
 * 那些把提交地址写进目录名的取料目录。
 *
 * 背景与裁决见 `docs/adr/0007-object-store-accident-and-history-recovery.md`。
 * 本仓的台账是**逐页引用提交地址**的审计链，历史重建之后那些地址会失效；
 * 本工具只做**指针替换与同名改名**：
 *   · 页的正文、页号、顺序一个字都不动；
 *   · 每一处引用换完仍然指向**同一笔提交**（只是它的地址变了）；
 *   · 取料目录改的是**名字里的那一节**，目录里的工件一个字节都不动
 *     （只把工件正文里指向自己的那一处地址同步）。
 *
 * 用法：
 *   node scripts/recovery/align-references.mjs --map <sha-map.json> [--root <仓库根>] [--report]
 *
 *   --map    旧 sha → 新 sha 的映射文件（JSON：{ 旧完整sha: 新完整sha }）
 *   --root   仓库根（缺省＝本文件上溯两级的仓库根）
 *   --report 只报出仓里其它仍提到旧地址的文件，不改动
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, renameSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const REPORT_ONLY = argv.includes("--report");

const ROOT = resolve(arg("--root") ?? join(here, "..", ".."));
const MAP_FILE = arg("--map");
if (MAP_FILE === undefined) {
  console.error("用法：node scripts/recovery/align-references.mjs --map <sha-map.json> [--root <仓库根>] [--report]");
  process.exit(2);
}

const map = JSON.parse(readFileSync(MAP_FILE, "utf8"));

/** 旧 7 位前缀 → 新 7 位前缀。 */
const prefixMap = new Map();
for (const [oldSha, newSha] of Object.entries(map)) prefixMap.set(oldSha.slice(0, 7), newSha.slice(0, 7));

/** 把一段文本里的旧地址换成新地址（只动独立成词的 7 位十六进制）。 */
function swap(text) {
  let hits = 0;
  const out = text.replace(/(?<![0-9a-zA-Z])([0-9a-f]{7})(?![0-9a-zA-Z])/g, (m) => {
    const to = prefixMap.get(m);
    if (to === undefined || to === m) return m;
    hits++;
    return to;
  });
  return { out, hits };
}

function walkFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = dir + "/" + e.name;
    if (e.isDirectory()) out.push(...walkFiles(p));
    else out.push(p);
  }
  return out;
}

if (!REPORT_ONLY) {
  // ── ① 取料目录：名字里嵌着旧地址的，改名 + 同步工件正文 ──
  const outputsDir = join(ROOT, "outputs");
  let renamed = 0;
  for (const name of readdirSync(outputsDir)) {
    const m = /([0-9a-f]{7})/.exec(name);
    if (!m || !prefixMap.has(m[1])) continue;
    const oldSha = m[1];
    const newSha = prefixMap.get(oldSha);
    const oldPath = join(outputsDir, name);
    const newPath = join(outputsDir, name.replace(oldSha, newSha));
    if (existsSync(newPath)) continue;
    renameSync(oldPath, newPath);
    renamed++;
    for (const f of walkFiles(newPath)) {
      let text;
      try {
        text = readFileSync(f, "utf8");
      } catch {
        continue;
      }
      const { out, hits } = swap(text);
      if (hits > 0) writeFileSync(f, out, "utf8");
    }
  }
  console.log(`取料目录改名：${renamed} 支`);

  // ── ② 台账与现态页：指针替换 ──
  let total = 0;
  for (const rel of ["PROGRESS.md", "STATE.md"]) {
    const p = join(ROOT, rel);
    if (!existsSync(p)) continue;
    const before = readFileSync(p, "utf8");
    const { out, hits } = swap(before);
    if (hits > 0) {
      writeFileSync(p, out, "utf8");
      total += hits;
    }
    console.log(`${rel}：替换 ${hits} 处`);
  }
  console.log(`台账指针合计替换 ${total} 处`);
}

// ── ③ 报出仓里其它还提到旧地址的文件（人工看一眼，不自动改） ──
const rest = new Set();
for (const oldSha of prefixMap.keys()) {
  let out = "";
  try {
    out = execFileSync("git", ["grep", "-l", oldSha, "--", ":!outputs"], { cwd: ROOT, encoding: "utf8" });
  } catch {
    out = ""; // git grep 没有命中时退出码是 1——那正是「没有残留」的意思
  }
  for (const line of out.split("\n")) if (line) rest.add(line);
}
console.log(`其它仍提到旧地址的文件：${rest.size ? [...rest].join(", ") : "无"}`);
