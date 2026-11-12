# 历史证据迁移记录（2026-11-08）

## 结论

`outputs/` 的历史材料已完成**可恢复归档与逐文件盘点**；本轮**没有删除或移动任何源文件**。
删除/公开任何一条历史证据仍需业主按文件确认，原因见「边界」。

## 归档

- 最终归档目录：`/Users/ze/Downloads/Cairn-archives/2026-11-08-5d3de6b8-dmehpqut/`
- 源提交：`5d3de6b8f85aac72d0c9184e70b399c1de52ab48`（归档时的集成候选快照，含开发线全部 `outputs/`；之后的 docs/打包修复不改变该快照）
- 早期快照：`/Users/ze/Downloads/Cairn-archives/2026-11-08-8d798077-blqzz0c6/`
  记录公开候选合并前的 3186 个文件；最终归档覆盖集成后的 5593 个文件，二者不互相替代。
- 文件：
  - `evidence.tar.gz`：`outputs/` 全量 + `PROGRESS.md` + `scripts/docs-check.ts` +
    `scripts/replay/corpus.ts` + `tsconfig.evidence.json`
  - `inventory.jsonl`：逐文件路径、Git blob、大小、SHA-256、规则关联、迁移批次、消费者、隐私审阅状态
  - `summary.json`：归档摘要与分类计数
  - `SHA256SUMS`：归档与清单的校验值
- 核对方式：`tar -xzf evidence.tar.gz` 解包到独立临时目录，逐文件回读并与 Git blob / 源文件比对；
  `shasum -a 256 -c SHA256SUMS` 全 `OK`。全部 5593 个 `outputs/` 文件均通过。

## 分类

`inventory.jsonl` 的 `migration_batch` 分三批：

- `retain-dependent`：被台账 D-9/D-11、证据 TypeScript 编译面、replay 语料或源码/测试词法引用点名——
  **必须留仓**，迁移会打断现行门禁。
- `referenced`：被台账、文档或源码/测试以路径或目录 token 点名——保守留仓。
- `review-unreferenced`：未发现静态消费者（1892 条）——仍需隐私审阅与业主确认后才能迁出。

`blockers` 字段逐条记录命中原因；`privacy_review` 当前为 `not-performed`，`removal_authorized` 为 `false`。
对 1892 条 `review-unreferenced` 做过一次正则预扫（不代替人工审阅）：389 条含 `/Users/` 主目录路径，
6 条命中密钥形状；删除前必须逐条处理，不能把「未引用」当成「可公开」。

## 边界

- 本记录**不声称**清理能消除 Git 历史体积或历史泄漏；历史重写是独立决定。
- 词法扫描无法覆盖任意拼接的动态路径；`summary.json` 的 `dynamic_analysis` 已标注这一未检面。
- 归档在仓外，未进 Git；需要长期保存时应另做带索引的备份，不能把 CI artifacts 的保留期当永久归档。
- 需要迁出时：先按 `inventory.jsonl` 选定路径，逐条做隐私审阅与引用复查，提交明确路径的删除列表，
  再分批跑 `docs-check`、`evidence-typecheck-check` 与相关回放测试。
