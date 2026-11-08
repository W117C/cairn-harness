/**
 * 全 DAG 重建：把本地线上**所有**提交（不只是第一父链）重写到远端 tip 之下。
 *
 * 背景见 docs/adr/0007-object-store-accident-and-history-recovery.md。
 *
 * 做法：
 *   · 收集从本地 tip 可达的**全部**提交（所有父边都跟）——只跟第一父链会漏掉
 *     合并的另一条侧线，而那些侧线上的提交同样被台账引用。
 *   · **子先于父**地重写每一笔：树、作者、提交者、提交时间、说明逐字保留，
 *     只把**父指针**换成重写后的新地址；已经在远端的父保持原样。
 *   · 树不可读的那几笔（随丢包一起没了）按**其后第一支可读提交的树**折叠成
 *     一笔（`rescue:` 提交，说明里列清被折叠的每一笔）。
 *
 * 用法：node scripts/recovery/rebuild-dag.mjs <本地库> <干净克隆>
 *
 * 顺序是这一版的关键：先算折叠提交（它携带折叠段幸存的那棵树），再自顶向下
 * 逐笔重写——父的新地址必须先于子算出来，否则子会指向一个不存在于远端的旧地址。
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const LOCAL = process.argv[2] ?? "/Users/ze/Downloads/Cairn/cairn";
const CLONE = process.argv[3] ?? "/Users/ze/Downloads/Cairn/cairn-harness-staging";
const TIP = "fe656b2a";
const REMOTE_BASE = "6af24734ba957838e5584e01228499e5e77b61e9";
const MISSING_COMMIT = "767126682007a2c37bde6012f082e878c9890ec7";

const L = (cwd, a) => {
  try {
    return execFileSync("git", a, { cwd, encoding: "utf8", maxBuffer: 1 << 28 });
  } catch {
    return null;
  }
};
const writeCommit = (content) =>
  execFileSync("git", ["hash-object", "-t", "commit", "-w", "--stdin"], { cwd: CLONE, input: content, encoding: "utf8" }).trim();

// ── 1. 全 DAG ──
const rawMap = new Map();
const stack = [TIP];
while (stack.length) {
  const s = stack.pop();
  if (rawMap.has(s)) continue;
  const raw = L(LOCAL, ["cat-file", "commit", s]);
  if (!raw) continue;
  const parents = [...raw.matchAll(/^parent ([0-9a-f]{40})/gm)].map((m) => m[1]);
  const tree = (/^tree ([0-9a-f]{40})/m.exec(raw) || [])[1];
  rawMap.set(s, { raw, parents, tree });
  for (const p of parents) if (p !== MISSING_COMMIT) stack.push(p);
}

// ── 2. 哪些已经在远端 ──
const remote = new Set();
const rstack = [REMOTE_BASE];
while (rstack.length) {
  const s = rstack.pop();
  if (remote.has(s)) continue;
  const raw = L(LOCAL, ["cat-file", "commit", s]);
  if (!raw) continue;
  remote.add(s);
  for (const m of raw.matchAll(/^parent ([0-9a-f]{40})/gm)) rstack.push(m[1]);
}
const localOnly = [...rawMap.keys()].filter((s) => !remote.has(s));
console.log(`全 DAG 可达提交 ${rawMap.size}｜远端已有 ${remote.size}｜需重写 ${localOnly.length}`);

// ── 3. 缺哪些对象 ──
let fsck = "";
try {
  fsck = execFileSync("git", ["fsck", "--no-progress", "--connectivity-only"], {
    cwd: LOCAL, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
  });
} catch (e) { fsck = e.stdout || ""; }
const missing = new Set([...fsck.matchAll(/^missing (?:blob|tree|commit) ([0-9a-f]{40})/gm)].map((m) => m[1]));

const treeBroken = (sha) => {
  const t = L(LOCAL, ["ls-tree", "-r", "-t", sha]);
  if (t === null) return true;
  for (const line of t.split("\n")) {
    const m = /^[0-9]+ (?:blob|tree) ([0-9a-f]{40})/.exec(line);
    if (m && missing.has(m[1])) return true;
  }
  return false;
};
const broken = new Set(localOnly.filter((s) => treeBroken(s)));
console.log(`树不可读、需折叠的提交 ${broken.size} 笔`);

// ── 4. 拓扑序：**祖先先于子孙**（写子时父的新地址必须已就绪）──
// 按提交时间升序即可：父的提交时间不会晚于子。若有并列，再按「父是否已就绪」补一轮。
const dateOf = (raw) => {
  const m = /^committer .*? (\d+) [+-]\d{4}$/m.exec(raw);
  return m ? Number(m[1]) : 0;
};
const order = localOnly.slice().sort((a, b) => dateOf(rawMap.get(a).raw) - dateOf(rawMap.get(b).raw));
console.log(`拓扑序：最老 ${order[0].slice(0, 8)} → 最新 ${order[order.length - 1].slice(0, 8)}`);

// ── 5. 折叠提交：树 = 折叠段之后第一支可读提交的树 ──
let boundary = null;
for (const s of order) {
  if (broken.has(s)) continue;
  if (rawMap.get(s).parents.some((p) => broken.has(p))) { boundary = s; break; }
}
if (!boundary) for (const s of order) if (!broken.has(s)) { boundary = s; break; }
const collapsed = order.filter((s) => broken.has(s));
const collapseTree = rawMap.get(boundary).tree;
const src = rawMap.get(boundary);
const collapseMsg =
  "rescue: 重建本地对象库事故后丢失的那一段历史\n\n" +
  "一个 pack 丢失 ⇒ 链底若干笔提交引用的 blob 不可恢复（本地与远端都没有）。\n" +
  "这一笔按**其后第一支可读提交的树**折叠，承载那一段唯一幸存的树；\n" +
  "其余每一笔的树、作者、提交者、提交时间与说明都逐字保留。\n\n" +
  "被折叠的提交：\n" +
  collapsed.map((s) => `  ${s.slice(0, 8)} ${(rawMap.get(s).raw.split("\n\n")[1] || "").split("\n")[0]}`).join("\n") + "\n";
const collapseSha = writeCommit(
  [
    `tree ${collapseTree}`,
    `parent ${REMOTE_BASE}`,
    `author ${(/^author (.*)$/m.exec(src.raw) || [])[1]}`,
    `committer ${(/^committer (.*)$/m.exec(src.raw) || [])[1]}`,
    "",
    collapseMsg,
  ].join("\n"),
);
console.log(`折叠提交 ${collapseSha.slice(0, 8)}（折叠 ${collapsed.length} 笔，树取自 ${boundary.slice(0, 8)}）`);

// ── 6. 逐笔重写（祖先先于子孙 ⇒ 父的新地址已就绪）──
const newSha = new Map();
const localOnlySet = new Set(localOnly);
const remapParents = (v) => {
  const out = [];
  for (const p of v.parents) {
    if (p === MISSING_COMMIT) { out.push(collapseSha); continue; }
    if (broken.has(p)) { out.push(collapseSha); continue; }
    if (localOnlySet.has(p)) {
      if (!newSha.has(p)) return null;      // 父还没重写 ⇒ 这一笔先放着
      out.push(newSha.get(p));
      continue;
    }
    out.push(p);                            // 远端的父原样保留
  }
  return [...new Set(out)];
};

const pending = order.filter((s) => !broken.has(s));
for (let round = 0; round < 12 && pending.length > 0; round++) {
  const still = [];
  for (const s of pending) {
    const v = rawMap.get(s);
    const parents = remapParents(v);
    if (parents === null) { still.push(s); continue; }
    const lines = v.raw.split("\n");
    const headerEnd = lines.findIndex((l) => l === "");
    const headerAll = lines.slice(0, headerEnd);
    // ⚠️ 头部的行序有讲究：git 的提交解析按 **tree → parent → author → committer** 读。
    //    parent 放到 committer 之后 ⇒ `cat-file -p` 还能看见那一行，但 git 内部的
    //    解析**不认**（表现为 `rev-list --parents` 查不到父、`git log %P` 为空）。
    //    这就是「看着有、其实没有」的假象——写的时候按 git 自己的次序摆。
    const treeLine = headerAll.find((l) => l.startsWith("tree "));
    const otherHeader = headerAll.filter((l) => !l.startsWith("tree ") && !/^parent [0-9a-f]{40}$/.test(l));
    const body = lines.slice(headerEnd).join("\n");
    newSha.set(s, writeCommit([treeLine, ...parents.map((p) => `parent ${p}`), ...otherHeader, body].join("\n")));
  }
  if (still.length === pending.length) {
    console.error(`❌ 第 ${round + 1} 轮没有进展：${still.length} 笔的父始终没就绪`);
    break;
  }
  pending.length = 0;
  pending.push(...still);
}
if (pending.length > 0) {
  console.error(`❌ 仍有 ${pending.length} 笔未能重写`);
  process.exit(1);
}

const newTip = newSha.get(TIP);
const map = {};
for (const [old, nw] of newSha) map[old] = nw;
// 折叠的那几笔：地址永久不可恢复 ⇒ 统一指向承载那一段幸存树的折叠提交
for (const s of collapsed) if (!map[s]) map[s] = collapseSha;
writeFileSync("/Users/ze/Downloads/Cairn/sha-map.json", JSON.stringify(map, null, 0));
writeFileSync("/Users/ze/Downloads/Cairn/final-tip.txt", newTip + "\n");
console.log(`重写提交 ${newSha.size} 笔｜新 tip = ${newTip}｜映射表 ${Object.keys(map).length} 条`);

// ── 7. 自检：新 tip 的祖先里必须含远端 tip，且笔数对得上 ──
const check = L(CLONE, ["rev-list", "--count", newTip]);
console.log(`新 tip 的祖先笔数 = ${check}（远端 tip 的祖先 ${L(LOCAL, ["rev-list", "--count", REMOTE_BASE])} + 重写 ${newSha.size} + 折叠 1）`);
const anc = L(CLONE, ["merge-base", "--is-ancestor", REMOTE_BASE, newTip]);
console.log(`远端 tip 在新历史里 = ${anc === null ? "否 ❌" : "是 ✅"}`);
