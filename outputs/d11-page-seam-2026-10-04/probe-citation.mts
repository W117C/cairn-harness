// 探针：候选句子喂 ledgerWitnessRefs，看落库后尺解析出什么。
// 这次跑的时候别再引 ABBREV_REF_RE：那个导出只在**在飞的工作树**里（`scripts/docs-check.ts`），
// HEAD 没有 ⇒ 引它这条探针就带一枚 TS2305 危险码，而证据面那把尺正是拦这个的（10-04 认证第一趟实测：
// 危险码 13 > 帽 12，涨的那一格就是这个文件）。省略式那一半的当时读数留在同目录 `probe-citation.txt`，
// 等那个导出进了 HEAD 再重跑（重跑时把两半都取回来）。
import { ledgerWitnessRefs } from "../../scripts/docs-check";

const cands = [
  "原件在 `head-cert-55ce164-2026-10-04-0402/provenance.md`（`git ls-tree -r --name-only HEAD | grep head-cert-55ce164`）",
  "原件在 `outputs/head-cert-55ce164-2026-10-04-0402/provenance.md`",
  "原件见 `…/head-cert-55ce164-2026-10-04-0402/provenance.md`",
  "原件见 `.../head-cert-55ce164-2026-10-04-0402/provenance.md`",
];
for (const c of cands) {
  console.log(`句子 ${c}\n  D-11 refs = ${JSON.stringify(ledgerWitnessRefs(c))}\n`);
}
