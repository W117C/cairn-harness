# 收口（2026-10-01 晚）：两件悬项，按"最优解"裁定并执行

> 前情：qoder 的 M2/M3/M8/M9 四模块已交毕（`8d267bb`/`0b37ad2`/`ce3c0cf`/`9732acc`/`0e4ecd5`）。
> 业主 2026-10-01 指示「按照最优解来处理」——本目录记两件悬项的裁定与证据。

## ① L2 pre-commit：**裁定不做**（文档，见 `scripts/ci/README.md`）

三条理由（全文在 README）：共享工作树下钩子会被**别人的在飞脏文件**卡住提交（当日实测 typecheck
被 `docs-check.ts` 在飞状态红过数小时）⇒ 训练 `--no-verify`，比没有更坏；L1 + 房屋协议 + 合并档已有覆盖；
收益边际（5–8s × 所有会话每次提交换"早几分钟"）。**一键启用路径与反悔条件已写明**（裁决必须可翻）。

## ② 半写尾行：**修在 append 入口**（代码，`src/events/index.ts` 的 `repairPartialTail`）

- **缺陷**：进程被硬杀在单次 write 中途 ⇒ 文件尾留半条 JSON；读者侧一直按「尾部半写可丢」容错，
  但写入侧没人补——下一次 append 会把它与下一条事件拼成**一条**坏行，**新事件静默不可见**。
- **修法**：只在**新开句柄**时检查（跨进程续写的唯一入口，热路径零开销）：非换行收尾 ⇒ 有界回扫
  最后一个换行并 `truncate`（丢弃从未成行的字节，与读者契约对齐）+ **响亮告警**（报丢弃字节数与路径）；
  >1MB 无换行 ⇒ 不猜边界，补换行隔离让重放**大声抛**（可见胜于静默）。**只修尾部**：中间坏行不动。
- 顺带：句柄打开从 `"a"` 改 `"a+"`（修复需在同一句柄回读；追加语义逐字不变）。
- **判卷** `tests/events-tail-repair.test.ts`（4 条）：尾修好且响亮 / 正常文件零打扰且旧字节不动 /
  中间坏行**不许被这条修碰**（重放仍抛）/ 空文件无告警。
- **反向验证**：拆掉修复（首行 return）⇒ 恰好 1 红 exit=1（`reverse-verify-tail-flip.log`）；
  复原 sha256 `496ebe3…` 逐字节同 ⇒ 复绿（`reverse-verify-tail-restored.log` + 哈希前后件）。

## 证据

| 文件 | 内容 |
|---|---|
| `reverse-verify-tail-{hash-before,hash-after}.txt` | 复原逐字节对证（`496ebe3…`） |
| `reverse-verify-tail-flip.log` / `reverse-verify-tail-restored.log` | 拆掉 → 1 红；复原 → 绿 |
| `full-suite.log` | `Test Files 271 passed (271)｜Tests 3632 passed (3632)｜exit=0`（较收口前 3628 只增不减；+4＝半写尾行判卷） |
| `typecheck.log` | ✅ `tsc --noEmit 通过（0 条报错）` |
