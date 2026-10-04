// 量 D-11/D-9 的**分页面**：台账的页切法认哪种标题，以及第 349 页落在尺眼里的哪一页。
// 只 import 纯函数（docs-check 有 main 闸，见其 1133 行），不起子进程、不写盘。
import { readFileSync } from "node:fs";
import { ANY_PAGE_HEAD, credentialPages, ledgerPages, ledgerWitnessRefs } from "../../scripts/docs-check";

const text = readFileSync("PROGRESS.md", "utf8");
const lines = text.split("\n");

const h3 = lines.filter((l) => /^### /u.test(l)).length;
const h2 = lines.filter((l) => /^## /u.test(l)).length;
const h2Page = lines.filter((l) => /^## 20\d\d-\d\d-\d\d · 第 \d+ 页/u.test(l)).length;
const h3Page = lines.filter((l) => /^### 20\d\d-\d\d-\d\d · 第 \d+ 页/u.test(l)).length;
const firstH2 = lines.findIndex((l) => /^## 20\d\d-\d\d-\d\d · 第 \d+ 页/u.test(l)) + 1;
const lastH3 = lines.reduce((acc, l, i) => (/^### /u.test(l) ? i + 1 : acc), 0);

const pages = ledgerPages(text, ANY_PAGE_HEAD);
const cred = credentialPages(text);
const owner = pages.filter((p) => p.refs.some((r) => r.includes("head-cert-55ce164-2026-10-04")));

const out = [
  `标题面：h3 ${String(h3)} 条｜h2 ${String(h2)} 条`,
  `页标题：h3 形 ${String(h3Page)} 条｜h2 形 ${String(h2Page)} 条（第一条 h2 页标题在 PROGRESS.md 第 ${String(firstH2)} 行）`,
  `尺的最后一道 h3 在第 ${String(lastH3)} 行；台账共 ${String(lines.length)} 行 ⇒ 其后 ${String(lines.length - lastH3)} 行**没有分页点**`,
  `ledgerPages(整本) 返回 ${String(pages.length)} 页；credentialPages 返回 ${String(cred.length)} 页`,
  `点名 head-cert 那族的页：${String(owner.length)} 页`,
  ...owner.map((p) => `  key=${p.key}｜refs=${String(p.refs.length)}｜numbers=${String(p.numbers.length)}｜shas=${String(p.shas.length)}`),
  "",
  "—— 引用形状逐个喂 ledgerWitnessRefs（看尺解析出什么 ref）——",
];

const cands = [
  "汇总落盘 `outputs/head-cert-55ce164-2026-10-04-0402/provenance.md`",
  "汇总落盘 `outputs/cert-window-2026-10-04/headcert4-summary.txt`",
  "上游产出目录名带 HHMM：`head-cert-55ce164-2026-10-04-0402/provenance.md`",
  "上游产出目录名带 HHMM：`…/head-cert-55ce164-2026-10-04-0402/provenance.md`",
  "上游产出 `head-cert-<rev7>-<YYYY-MM-DD>-<HHMM>/provenance.md`",
];
for (const c of cands) {
  out.push(`输入  ${c}`);
  out.push(`  → refs = ${JSON.stringify(ledgerWitnessRefs(c))}`);
}

console.log(out.join("\n"));
