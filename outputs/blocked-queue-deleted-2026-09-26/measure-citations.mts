// 读数：代码/文档里按编号引用 BLOCKED.md 的 Citation，在三个口径下各能不能查到——
// HEAD（1187 行的裁决台账）／工作树（在飞那版只剩 5 行英文 stub）／落库后（工作树版本进 HEAD）。
// 用法：node --import tsx "outputs/blocked-queue-deleted-2026-09-26/measure-citations.mts"
// 只算引用面，不改任何台账；判据是字符串包含，所以它同时是「引用会不会变死」的最小复跑面。
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["src", "scripts", "tests", "docs"];
const EXTS = [".ts", ".tsx", ".mjs", ".mts", ".md"];
// 「BLOCKED」之后 40 字内出现带编号的指向才算 citation：裁决 N / 裁决记录 §N / 待办 #N / #N / D-N / 备案 N
const CITE = /BLOCKED[^\n]{0,40}?(裁决记录\s*§?\s*\d+|裁决\s*\d+|待办\s*#\d+|#\d+|D-\d+|备案\s*[0-9①-⑨]+)/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (EXTS.some((e) => name.endsWith(e))) out.push(p);
  }
  return out;
}

const files = ROOTS.flatMap((r) => walk(r)).filter((f) => !f.endsWith("BLOCKED.md"));
const cites: { file: string; line: number; id: string }[] = [];
const dropped: { file: string; line: number; id: string; why: string }[] = [];
// 编号只取**捕获组**（`BLOCKED` 之后那段），不许把 `.md` 「能力 5 收束闸」这类前缀一起吃进来——
// 带前缀的 key 在台账里必然查不到，那是 join 键造出来的假「死引用」。
const normId = (raw: string) => raw.replace(/^待办\s+/, "").replace(/\s+/g, " ").trim();
for (const f of files) {
  const text = readFileSync(f, "utf8");
  text.split("\n").forEach((l, i) => {
    for (const m of l.matchAll(CITE)) {
      // 同一处命中里出现 `docs-check` ⇒ 那个 `D-N` 是文档预算规则名（D-1…D-8），不是台账编号。
      // 剔除要说得出口径，不许手删：下面把 dropped 一起印出来。
      if (/D-\d+/.test(m[0]) && /docs-check/.test(m[0])) dropped.push({ file: f, line: i + 1, id: m[1], why: "同行含 docs-check ⇒ D-N 是规则名" });
      else cites.push({ file: f, line: i + 1, id: normId(m[1]) });
    }
  });
}

const headText = execFileSync("git", ["show", "HEAD:BLOCKED.md"], { encoding: "utf8" });
const workText = readFileSync("BLOCKED.md", "utf8");

// 「裁决 3」这种带空格的写法，台账里可能写成「裁决 3」也可能「裁决3」——归一后再比，别把写法差当成查不到。
const norm = (s: string) => s.replace(/\s+/g, "");
const head = norm(headText);
const work = norm(workText);
const ids = [...new Set(cites.map((c) => c.id))].sort();
const resolvable = (t: string) => ids.filter((id) => t.includes(norm(id)));

const rows = ids.map((id) => ({
  id,
  uses: cites.filter((c) => c.id === id).length,
  head: head.includes(norm(id)) ? "查得到" : "查不到",
  work: work.includes(norm(id)) ? "查得到" : "查不到",
}));

console.log(`引用面：${ROOTS.join("/")} 里 ${files.length} 个文件，命中 ${cites.length} 处、${ids.length} 个不同编号（另有 ${dropped.length} 处按上面口径剔除）`);
// 字节与字符分开报：台账是中文，`text.length` 是 UTF-16 字数，不是字节数——两者差 1.8 倍。
console.log(`台账体量：HEAD ${Buffer.byteLength(headText)} B / ${headText.length} 字 / ${headText.split("\n").length} 行　｜　工作树 ${Buffer.byteLength(workText)} B / ${workText.length} 字 / ${workText.split("\n").length} 行`);
console.log(`可查性：HEAD 查得到 ${resolvable(head).length}/${ids.length}　｜　工作树查得到 ${resolvable(work).length}/${ids.length}`);
for (const r of rows) console.log(`  ${r.id}　用 ${r.uses} 次　HEAD:${r.head}　工作树:${r.work}`);
for (const d of dropped) console.log(`  剔除 ${d.file}:${d.line} ▸ ${d.why}`);
const files_with = new Set(cites.map((c) => c.file));
console.log(`落点文件 ${files_with.size} 个：${[...files_with].sort().join("、")}`);
