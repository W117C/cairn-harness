# 整表的 (src ⇄ test) 分组现读 — 2026-09-28


取料：在 `.worktrees/p170-tighten` @ `6172a62` 跑 `node --import tsx scripts/mutate-verify.mjs --list`（LIST_EXIT=0，949 行，字段顺序 id/src/desc/test/expectFail）。
取数：按 src⇄test 分组；可免的基线拍＝条数 − 组数。
- 条数 949；不同 (src⇄test) 组 292；**同组重复的基线拍 657**＝整表 3 拍共 2847 拍的 23.1%
- 取自本轮阅读的拍数形状：`成本分母：判卷 spawn 882 次／946 条（每条次数分布 0×652 3×294）` → 跑到的条一律付 3 拍，无早退。
- 最大几组：46 条│scripts/lib/mutate-gates.ts ⇄ tests/mutate-verify-gates.test.ts；24 条│scripts/lib/head-cert-deps.ts ⇄ tests/head-cert-deps.test.ts；23 条│scripts/mutate-verify.mjs ⇄ tests/mutate-verify-gates.test.ts；16 条│src/agent/prune.ts ⇄ tests/prune.test.ts；14 条│src/tools/impact-query.ts ⇄ tests/impact-query.test.ts
- 组大小分布：46条×1组 24条×1组 23条×1组 16条×1组 14条×3组 13条×1组
