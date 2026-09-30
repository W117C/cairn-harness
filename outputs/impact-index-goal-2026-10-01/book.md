你是执行者，本文档是唯一任务来源；中途没人可问，拿不准的写进 BLOCKED.md（待裁决清单）跳过继续；断点续跑先读 PROGRESS.md 别重做。
这活为什么干：编排器的「改这行会影响谁」（影响面查询）每次进程启动都全仓重新 tree-sitter 解析，没有持久化索引、没有准确率基准。干完世界：影响面图落成带版本的索引文件（同提交秒级热载），一张冻结夹具上的精度/召回基准盯着它不许悄悄变差。
让步顺序：读数算得对 > 索引快 > 覆盖全。
死规矩：「只允许」改白名单路径，违反算失败；「建议」有更好的路就走、在 PROGRESS.md 记一句为什么。

## 我替领导拍的板
- 索引放哪 → 应用数据目录 `~/.m0-agent-loop/impact-index/<sha>.json`（猜的；与既有 impact-tags 缓存同区）。猜错代价：放仓库内会被 git status 噪声淹没。
- 精度阈值 → 夹具 precision=1.0、recall≥0.9（猜的；recall 松一档因 def/ref 抽取对动态调用天然盲）。猜错代价：太松基准失效。
- 真仓探针真值符号 → 沿用 outputs/impact-accuracy-2026-09-30/ 的既证 4 符号集合。
- 能力 10 真模型基准 → 无凭据不做，只做零依赖夹具基准。

## 界限
- 白名单：src/agent/impact/、src/agent/map/、src/tools/impact-query.ts、tests/impact-persistence.test.ts（新）、tests/impact-accuracy.test.ts（新）、fixtures/impact/accuracy-repo/（新）、outputs/impact-index-2026-10-01/、PROGRESS.md、BLOCKED.md；其余只读。
- 既有判卷文件（tests/ 下现存 256 个）一字不改；fixtures/impact/mini-repo 冻结不动。
- 顺手活禁区：不修 orchestrator/context 的已知问题、不新增依赖、不做 SWE-bench 下载（无凭据）——遇到写 BLOCKED.md。

## 现状（2026-10-01 实测）
- buildImpact 全仓：files=547 candidates=547 cap=5000 partial=false（probe.mts 当日现读）。
- 跨文件调用边 precision/recall 23/23（4 符号真值探针）；同文件边不入图是登记的设计边界。
- 索引无持久化：图每进程内存重建；唯一缓存是 ~/.m0-agent-loop/impact-tags 的 per-file tags（mtime+size 键）。
- 工具判卷：tests/impact-query.test.ts 51 条全绿。

任务 0：跑上面 probe.mts 核对 547/547/false；跑工具判卷须 51 全绿。对不上就停、证据写 BLOCKED.md 最上面，只做不受影响部分；核对后把「理解的目标/顺序/最大风险」≤10 行写进 PROGRESS.md 再动工。

任务 1：索引持久化＋增量。buildImpact 落盘：artifact 含 schemaVersion、commit sha（git rev-parse）、files、defs、refs、edges；同 sha＋全量文件 hash 命中 ⇒ 直接载入不重解析；任一文件变化 ⇒ 只重建变化文件、其余复用 tags 缓存。验收＝新建 tests/impact-persistence.test.ts：a) round-trip（build→存→载→upward 结果逐字一致）；b) 增量（改 1 文件后重建，未变文件的解析计数不变——用 tags 命中数或 parse 计数证）；c) 截断 JSON 损坏文件 ⇒ 自动重建且不抛。反向验证＝把载入路径暂时改成必抛，测试必须红，贴输出后还原贴全绿。

任务 2：准确率基准。新建 fixtures/impact/accuracy-repo/（8-12 个 ts/js 文件：导出/私有/同名/重导出四类形状）＋ ground-truth.json（人工核对的调用边真值，边数打印进断言消息防漏）；新建 tests/impact-accuracy.test.ts：对夹具全图跑预登记 upward/downward 查询集，断言 precision=1.0、recall≥0.9、零静默丢条（解析错误计入 errors 不吞）。

任务 3：真仓探针固化。把 outputs/impact-accuracy-2026-09-30/probe.mts 的 4 符号 grep 真值对比改写成可重复脚本，precision/recall 读数落 outputs/impact-index-2026-10-01/readings.md。

## 规矩
- 防作弊：不许 skip/todo、放宽断言、mock 被测的 buildImpact、删改既有判卷、`|| true`；测试总数 ≥ 基线 3357；`node --import tsx scripts/mutate-verify.mjs --check-needles` 阻断 0。
- 不新增依赖、不新增权限；必须的写 BLOCKED.md。
- 同一验收连败 3 次换下一项；结果比开工差就回滚如实报告——「没做成但说清了」合格，「做了但更糟」不合格。
- 提交走既有惯例：台账页（PROGRESS.md）＋证据目录，一轮一笔。

## 完成条件
- 硬指标①：`node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts tests/impact-persistence.test.ts tests/impact-accuracy.test.ts` 全绿且两文件新增合计 ≥8 条用例；probe 读数 precision=1.0、recall≥0.9 贴对话。
- 硬指标②：`git diff HEAD`（交付时对上一认证提交）只含白名单路径；既有判卷文件零改动。
- 每条都要在对话里贴实际命令输出（含反向验证的红→绿证据），只说做完了不算。BLOCKED.md 随交付提交，空也写「无」。
- 止损：或已跑满 12 轮——满轮即停，如实汇报卡在哪、还差什么。
