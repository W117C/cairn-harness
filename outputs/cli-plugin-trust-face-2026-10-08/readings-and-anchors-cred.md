
## 2026-10-08 · 第 439 页：头顶的尺涨到 11（顶包帽 10），归因是前人的 7→11；本笔贡献为 0｜证书读数 2 红／4966 绿（本次认证不挡，证面照实写）

### 1. 缺口现读（clean-tree，证明我的笔没碰它）

```sh
node --import tsx scripts/prose-needle-scan.ts
顶包候选（收料那段在 ≥2 处字面量里 ⇒ 改一处不会响）：11 条（已提交态 11 ＋ 在飞 0）｜同一句抄 ≥2 处（改代码）5 条｜只是共享一个词（改针脚）6 条｜裸名字（改成派生断言，红）2 条
帽子：顶包候选 10、裸名字 2
现读 → 顶包 cap 超出 1（11 > 10），裸名字贴线（2 == 2）
```

分母来源：`tests/**/*.ts`（全仓判卷正文）。取料面干净（HEAD 面无未跟踪文件）。

### 2. 归因（逐条点名，排除我）

11 条的判卷文件分布（按出现次数排序）：

- `tests/docs-check.test.ts`：40 处 × 1、3 处 × 3 （共 49 次引用，占多数）
- `tests/plan-required.test.ts`：5 处 × 2
- `tests/prompt-cost.test.ts`、`tests/plugins-mcp.test.ts`、`tests/mutate-anchor-titles.test.ts` 等各 1–8 处。

**零命中本笔文件 `tests/plugin-cli-face.test.ts`**。再核对函数级重复串：本笔引入的新文案有 `trustCountsText`、`pluginFaceText`、`pluginDecideText`、`"批准与拒绝是相反的决议"`、`"插件那三条旗标不跑任务"`，它们在判卷文中的出现次数均为 1 或 0（无 ≥2 处字面量重合），不构成任何一条顶包候选。⇒ **本笔对 11 条的贡献为 0**。

帽涨原因：前一簇提交 `76a74a0c`（第 437 页）在 `tests/docs-check.test.ts` 中增加了若干断言，使得这些断言里的中文片段在判卷文中重复数从原来的 7 上升到 11。这一涨是历史累积所致，与本次笔无关。

### 3. 认证读数（certified HEAD，第 5691a5c）

| 维度 | 读数 | 备注 |
| --- | --- | --- |
| gate 全部 | 23/23 pass | repo-hygiene-check 351ms / sandbox 82s(超预算但只出声) |
| import 面悬空 | 0 | typecheck 0 |
| Test Files | 2 failed | 4966 passed (4968 total) |
| 红的是哪两条 | 1) `prose-needle-scan.test.ts`：“真仓读数必须在帽内” 因 11 > 10 而 fail<br>2) `scratch-tree-naming.test.ts`：“三类不一致都必须为 0”因注册表差异 fail | prose 红 = 本次笔外的前人债；scratch = #4 登记过的常驻红 |
| 墙钟 | 319.49s | 不含提前退出的趟 |
| 门禁退出码 | 1 | 红的维＝判卷 exit=1（门自己的码） |

红线说明：`prose-needle-scan` 那条红由 cap 超限导致，非本笔引入；`scratch-tree-naming` 是注册表中已登记的常驻红（规则 411），不在本次笔的范围。

### 4. 修法归属（谁造成，谁修）

降低 cap 的唯一合法路径：**把断言改成派生断言（共用生产原文）**，而非抬帽。这需要在 `tests/docs-check.test.ts` 中删掉那些仅“抄原句”但未走派生的断言条目。由于它们位于他人提交的代码，**修法权在原作者**；我只负责在凭证里写出“是谁推上去的这条解释”，并记录在台账。

帽降之后，cap 会从 10 降到某个值（例：降至当前实际命中数 10）；届时红线消失。

### 5. 刻意未做（不替人改）

不给 cap 涨价（违反“帽只准调低”）；不改他人的断言（越权修改别人的判卷文件）；不加新的豁免项（需要完整的反例证人与论证链）。

### 6. 领书与清场

认证树 `.worktrees/head-cert-5691a5c` 已回收；常驻残留 `.worktrees/gate-mutate-verify@46cde6b`／`.worktrees/verify-5691a5c@5691a5c` 保留于他人在飞笔；`outputs/head-cert-5691a5c-2026-10-08-1520/provenance.md` 已落盘。
