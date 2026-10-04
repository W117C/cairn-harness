/* 三臂只换**分页切法**：D-9 的实现、取料 reader、豁免表、帽全部 import 尺自己那一套。
   A＝尺现读（任意 `^### ` 切页，h2 不算）
   C＝**只加一件事**：把 `^## …·第 N 页` 也当分页点（⇒ A/C 差值＝h2 缝这一格的真代价）
   B＝只按页标题切（撤掉页内 h3 小节缝）——它与 A 差**两件事**，只当第三个读数，不当代价。
   ⚠️ B/C 的 `key/numbers/dirs/shas` 由本探针自算：`CRED_NUMBER_RES`／`ledgerWitnessRefs` 直接 import 尺的同一份；
   `shas` 那条正则是从 `ledgerPages` 抄的字面量（尺没导出）——它只影响弱证那一格，不影响红数。 */
import { readFileSync } from "node:fs";
import {
  CREDENTIAL_HEAD,
  CRED_NUMBER_RES,
  CRED_UNNAMED_PAGE_CAP,
  CRED_WEAK_WITNESS_CAP,
  UNSOURCED_CRED_PAGES,
  UNSOURCED_READINGS,
  checkCredentialSources,
  credFaceFiles,
  credentialPages,
  ledgerWitnessRefs,
} from "../../scripts/docs-check";
import type { CredPage } from "../../scripts/docs-check";

const ROOT = process.cwd();
const text = readFileSync("PROGRESS.md", "utf8");
const readFace = (dir: string) => credFaceFiles(ROOT, dir);

const SHA_RE = /\b([0-9a-f]{7,40})\b/gu; // 抄自 scripts/docs-check.ts 的 ledgerPages
const PAGE_H3 = /^### 20\d\d-\d\d-\d\d · 第 \d+ 页/u;
const PAGE_H2 = /^## 20\d\d-\d\d-\d\d · 第 \d+ 页/u;

/** 切法参数化：`h2Seams`＝h2 页标题算不算缝；`looseH3`＝是否像尺那样把**任意** `^### ` 都当缝。 */
function splitPages(h2Seams: boolean, looseH3: boolean): CredPage[] {
  const lines = text.split("\n");
  const isHead = (l: string): boolean =>
    (looseH3 && /^### /u.test(l)) || PAGE_H3.test(l) || (h2Seams && PAGE_H2.test(l));
  const heads = lines.map((l, i) => [l, i] as const).filter(([l]) => isHead(l));
  const out: CredPage[] = [];
  heads.forEach(([head, start], n) => {
    if (!CREDENTIAL_HEAD(head)) return;
    const end = n + 1 < heads.length ? heads[n + 1]![1] : lines.length;
    const body = lines.slice(start, end).join("\n");
    const numbers = new Set<string>();
    for (const re of CRED_NUMBER_RES) {
      for (const m of body.matchAll(new RegExp(re.source, "gu"))) numbers.add(m[1]!);
    }
    const dirs = [...new Set(ledgerWitnessRefs(body).map((r) => r.replace(/^outputs\//u, "").replace(/\/$/u, "")))].sort(); // ← 第 351 页第 3 条那个缺陷的原样：只剥尾斜杠，没取首段
    out.push({
      key: /第 \d+ 页/u.exec(head)?.[0] ?? head.slice(0, 16),
      title: head.replace(/^#+ /u, ""),
      dirs,
      numbers: [...numbers].sort(),
      shas: [...new Set([...body.matchAll(SHA_RE)].map((m) => m[1]!.slice(0, 7)))].sort(),
      refs: ledgerWitnessRefs(body),
    });
  });
  return out;
}

const run = (label: string, pages: CredPage[]) => {
  const r = checkCredentialSources(
    pages,
    readFace,
    UNSOURCED_READINGS,
    CRED_UNNAMED_PAGE_CAP,
    CRED_WEAK_WITNESS_CAP,
    UNSOURCED_CRED_PAGES,
  );
  const nums = new Set<string>();
  for (const f of r.findings) {
    for (const m of f.detail.matchAll(/读数「(\d+)」/gu)) nums.add(m[1]!);
  }
  console.log(
    `${label}：凭证页 ${String(pages.length)} 段｜可比对读数 ${String(r.checked)}｜红 ${String(r.findings.length)}` +
      `｜未点名 ${String(r.unnamed)}｜弱证 ${String(r.weak.length)}｜红里的读数值 ${String(nums.size)} 个`,
  );
  return { r, nums };
};

/* 哨兵：A 臂**必须**逐字复现门自己印的那一行（现读 89 段｜可比对 488｜红 0）。
   复现不了就是本探针没和被度量方共用决策点，下面所有差值全部作废——先证 A，再读 C-A。 */
const a = run("A＝第一版：自建的 h3 臂（缺陷在这里）  ", splitPages(false, true));
const c = run("C＝只加 h2 缝（单变量）                    ", splitPages(true, true));
const b = run("B＝只按页标题切（两件事都改，仅第三读数）    ", splitPages(true, false));

for (const [lbl, x] of [["C-A", c], ["B-A", b]] as const) {
  const gained = [...x.nums].filter((n) => !a.nums.has(n));
  console.log(
    `\n${lbl}：新增红 ${String(x.r.findings.length - a.r.findings.length)} 条｜未点名 ${String(x.r.unnamed - a.r.unnamed)}` +
      `｜弱证 ${String(x.r.weak.length - a.r.weak.length)}｜分母 ${String(x.r.checked - a.r.checked)}` +
      `｜新失败的读数值 ${String(gained.length)} 个＝${gained.slice(0, 12).join("、")}`,
  );
}
const keys = new Set(c.r.findings.map((f) => /第 \d+ 页/u.exec(f.detail)?.[0] ?? "?"));
console.log(`C 的红落在 ${String(keys.size)} 个页 key：${[...keys].slice(0, 12).join("、")}`);
console.log("\nC 臂逐条红话术（原样，未改写）：");
for (const f of c.r.findings) console.log(`  [${f.rule}] ${f.file}｜${f.detail}`);
console.log(`C 臂未点名页 key：${c.r.unnamedPages.slice(0, 12).join("、")}`);
