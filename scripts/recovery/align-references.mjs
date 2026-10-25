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

/** 把一段文本里的旧地址换成新地址（只动独立成词的 7–40 位十六进制）。
 *
 *  ⚠️ 长度必须写成 {7,40} 而不是 {7}：写死 7 位时，**8 位以上的地址一个都匹配不到**
 *  （前 7 位后面还跟着十六进制字符 ⇒ 负向前瞻不成立）。现态页 `rev:` 里的地址就是 8 位，
 *  那种情况会静默漏掉——「看着没换、其实没换」。
 */
function swap(text) {
  let hits = 0;
  const out = text.replace(/(?<![0-9a-zA-Z])([0-9a-f]{7,40})(?![0-9a-zA-Z])/g, (m) => {
    const to = prefixMap.get(m.slice(0, 7));
    if (to === undefined || to === m) return m;
    hits++;
    return to;
  });
  return { out, hits };
}

/**
 * 把一个名字里的旧地址换成新地址。
 *
 * ⚠️ 必须用**同样的边界规则**：早先的写法按 7 位前缀硬替换，会在**8 位地址**
 * （`7eb53c9f9`）里只换掉前 7 位、把第 8 位留下 ⇒ 换出一个既不是旧地址也不是新地址的
 * 混合名（`7429acf9`）⇒ 台账里的路径指针与盘上的工件名对不上 ⇒ D-11 判红。
 * 边界规则（前后都不是字母数字）保证「整段地址」被整体换掉。
 */
function swapName(name) {
  return name.replace(/(?<![0-9a-zA-Z])([0-9a-f]{7,40})(?![0-9a-zA-Z])/g, (m) => {
    const to = prefixMap.get(m.slice(0, 7));
    return to === undefined ? m : to;
  });
}

/**
 * 取料面的改名：目录与**文件**都要看。
 * ⚠️ 只改目录是不够的：取料面里也有 `mutate-verify-<sha>.log` 这种**文件名**带地址的工件，
 * 而台账点名的是**完整路径**⇒ 只改目录名而漏掉文件，台账里的指针就会指向不存在的路径
 * （docs-check 的 D-11 判红）。目录改名后要**继续递归进去**处理里面的文件。
 */
function renameIn(dir) {
  let renamed = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = dir + "/" + e.name;
    const newName = swapName(e.name);
    if (newName !== e.name) {
      const np = dir + "/" + newName;
      if (!existsSync(np)) {
        renameSync(p, np);
        renamed++;
      }
      if (e.isDirectory()) renamed += renameIn(dir + "/" + newName);
      continue;
    }
    if (e.isDirectory()) renamed += renameIn(p);
  }
  return renamed;
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
  // ── ① 取料面：名字里嵌着旧地址的（目录与文件）改名 + 同步工件正文 ──
  const outputsDir = join(ROOT, "outputs");
  const renamed = renameIn(outputsDir);
  console.log(`取料面改名：${renamed} 支（目录与文件）`);
  // 工件正文里指向自己的那一处地址：同步换掉（工件内容本身不动）
  let bodyHits = 0;
  for (const f of walkFiles(outputsDir)) {
    let text;
    try {
      text = readFileSync(f, "utf8");
    } catch {
      continue;
    }
    const { out, hits } = swap(text);
    if (hits > 0) {
      writeFileSync(f, out, "utf8");
      bodyHits += hits;
    }
  }
  console.log(`取料工件正文里的地址同步替换 ${bodyHits} 处`);

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
