// 探针：候选句子喂 ledgerWitnessRefs／ABBREV_REF_RE，看落库后尺解析出什么。
import { ABBREV_REF_RE, ledgerWitnessRefs } from "../../scripts/docs-check";

const cands = [
  "原件在 `head-cert-55ce164-2026-10-04-0402/provenance.md`（`git ls-tree -r --name-only HEAD | grep head-cert-55ce164`）",
  "原件在 `outputs/head-cert-55ce164-2026-10-04-0402/provenance.md`",
  "原件见 `…/head-cert-55ce164-2026-10-04-0402/provenance.md`",
  "原件见 `.../head-cert-55ce164-2026-10-04-0402/provenance.md`",
];
for (const c of cands) {
  const abbrev = (c.match(new RegExp(ABBREV_REF_RE.source, "gmu")) ?? []).length;
  console.log(`句子 ${c}\n  D-11 refs = ${JSON.stringify(ledgerWitnessRefs(c))}\n  D-12 省略式命中 = ${String(abbrev)}\n`);
}
