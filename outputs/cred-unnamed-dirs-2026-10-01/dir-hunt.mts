/** 第 268 页的前置测量：未点名那 11 页，逐页问一句「你的工件其实还在盘上吗」。
 *  身份判据不用「同日目录凑」——要该目录里的文件**提到这一页认证的那个 sha**；
 *  回查判据不自己发明：调生产端的 `sourcedReadings`（剥色＋严格式），所以这里报「N/M 条能对上」与门上的口径同源。
 *  两种归宿因此分开：① 有候选目录 ⇒ 点名它（帽降一格）；② 没有 ⇒ 逐条登记不可回查（帽也降，但那要理由）。 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { credentialPages, sourcedReadings } from "../../scripts/docs-check.ts";

const ROOT = process.argv[2];
if (typeof ROOT !== "string" || ROOT === "") { console.error("用法：tsx dir-hunt.mts <仓根>"); process.exit(2); }

const ledgerText = readFileSync(join(ROOT, "PROGRESS.md"), "utf8");
const lines = ledgerText.split("\n");
const heads = lines.map((l, i) => [l, i] as const).filter(([l]) => /^### /u.test(l));
const bodies = new Map<string, string>();
heads.forEach(([head, start], n) => {
  if (!head.includes("凭证")) return;
  const end = n + 1 < heads.length ? heads[n + 1]![1] : lines.length;
  const key = /第 \d+ 页/u.exec(head)?.[0] ?? head.slice(0, 16);
  bodies.set(key, (bodies.get(key) ?? "") + "\n" + lines.slice(start, end).join("\n"));
});

/* 一次性把每个 dated 目录读进来（与门的 readFace 同形状：非递归、排除 .mjs），后面只做字符串比对。 */
const outRoot = join(ROOT, "outputs");
const faces = new Map<string, string>();
for (const d of readdirSync(outRoot)) {
  const abs = join(outRoot, d);
  if (!/-\d{4}-\d{2}-\d{2}$/u.test(d)) continue;
  if (!statSync(abs).isDirectory()) continue;
  try {
    faces.set(d, readdirSync(abs).filter((f) => !f.endsWith(".mjs") && existsSync(join(abs, f)) && statSync(join(abs, f)).isFile())
      .map((f) => { try { return readFileSync(join(abs, f), "utf8"); } catch { return ""; } }).join("\n"));
  } catch { /* 读不到的目录本轮不参与候选 */ }
}
console.log(`扫入 dated 目录=${String(faces.size)} 本`);

const pages = credentialPages(ledgerText).filter((p) => p.numbers.length > 0 && p.dirs.length === 0);
const byKey = new Map<string, typeof pages>();
for (const p of pages) byKey.set(p.key, [...(byKey.get(p.key) ?? []), p]);

let canName = 0, mustWaive = 0;
for (const [key, segs] of byKey) {
  const nums = [...new Set(segs.flatMap((p) => p.numbers))];
  const body = bodies.get(key) ?? "";
  const shas = [...new Set((body.match(/`[0-9a-f]{7,40}`/gu) ?? []).map((s) => s.slice(1, -1)))].filter((s) => /^[0-9a-f]{7,40}$/u.test(s));
  const hits: { dir: string, got: number, shaMentions: number }[] = [];
  for (const [dir, face] of faces) {
    const shaMentions = shas.reduce((a, s) => a + (face.includes(s) ? 1 : 0), 0);
    if (shaMentions === 0) continue;
    const found = sourcedReadings(face);   // 一支目录一次，别在 reduce 里重算
    hits.push({ dir, got: nums.reduce((a, n) => a + (found.has(n) ? 1 : 0), 0), shaMentions });
  }
  hits.sort((a, b) => b.got - a.got || b.shaMentions - a.shaMentions);
  const allCovered = hits.length > 0 && hits[0]!.got === nums.length;
  if (allCovered) canName++; else mustWaive++;
  console.log(`\n[${key}] 读数 ${String(nums.length)} 条=${nums.slice(0, 10).join(",")}${nums.length > 10 ? "…" : ""}｜段数=${String(segs.length)}｜sha 候选=${String(shas.length)} 个`);
  if (hits.length === 0) console.log(`   候选目录=0 ⇒ 只能走「登记不可回查」（工件当年没随页入库）`);
  for (const h of hits.slice(0, 3)) console.log(`   候选 ${h.dir}：sha 提及 ${String(h.shaMentions)} 处，读数对上 ${String(h.got)}/${String(nums.length)} 条${h.got === nums.length ? "  ← 全对得上，可点名" : ""}`);
}
console.log(`\n汇总：可点名=${String(canName)} 页｜只能登记不可回查=${String(mustWaive)} 页`);
