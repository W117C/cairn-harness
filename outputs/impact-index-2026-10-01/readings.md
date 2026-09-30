# 影响面持久化索引 · 读数（2026-10-01，第 259 页目标任务 1–3）

环境：主仓 HEAD `35a163e` 工作树，rg 1.18.0，node v22.23.2，vitest 5.0.0。
图现状：files=560 candidates=560 cap=5000 partial=false（含隔壁会话在飞未跟踪源码——探针口径只认主树文件，见下）。

## 一、任务 1 · 索引持久化（src/agent/impact/persist.ts + buildImpact 接线）

- artifact：`<indexDir>/<commitSha>-<sha256(wsAbs)前12>.json`，含 schemaVersion=1、commitSha、files、candidates、cap、fingerprints（mtime+size，与 tags 缓存同尺）、defs、refs、edges。
- 生产目录：`~/.m0-agent-loop/impact-index/`（由 cacheDir 兄弟目录派生，与拍板「同区」一致）；测试注入临时目录。
- 键里带 workspace hash 的原因：主仓、fixtures 夹具、tmp 测试仓可能共用同一 git sha，裸 `<sha>.json` 会互相覆写踢图。
- 非 git 仓 ⇒ sha=null ⇒ 索引整层不参与（没有稳定键不发明弱键）；persistIndex 缺省 false（既有判卷 ⑭ 钉死缺省＝tags 缓存增量语义），生产在 `impact_query` 三个建图出口显式开启。

判卷 `tests/impact-persistence.test.ts`：10 条全绿（round-trip／零解析热载／增量 tags 命中证／截断 JSON 自愈／版本失配重建／删文件不吃旧图／缺省不落盘／非 git 不参与／artifact 字段齐全／目录派生）。
反向验证：载入路径入口插必抛 ⇒ 7 failed／3 passed（过的 3 条=缺省关+非 git+纯函数，红面精确）；还原后 10/10 绿，残留 grep=0。

## 二、任务 2 · 准确率基准（fixtures/impact/accuracy-repo + tests/impact-accuracy.test.ts）

夹具 10 文件（导出/私有/同名/重导出四类形状），ground-truth.json 人工核对 **16 条**跨文件调用边。
判卷 6 条全绿，关键读数：

- precision = **1.000**、recall = **1.000**（tp=16 fp=0 fn=0，边集级）
- 解析零静默丢条：10/10 文件 tags 非空，errors=0
- 同名歧义按名字合同：add（math.ts+legacy-math.ts 双定义）的 3 个调用点各连 2 边，登记 ambiguous=true
- 登记的行为边界：同文件调用不入图（clamp/padLeft）；重导出 `export…from` 零 tag（index.ts 不是定义点）；函数体内局部绑定不当 def（report.ts alias 的 ref 有而 def 无 ⇒ 无边）

## 三、任务 3 · 真仓探针（accuracy-prod.mts，沿用 09-30 的 4 符号真值集合）

口径：grep `\b<sym>\(`（剔定义行/import 行）∩ 同文件调用剔除（图登记边界）∩ 噪声前缀同滤（`.claude/ .worktrees/ .tmp/ oh-src/`——隔壁会话树随其开关进出，不滤读数漂移）；豁免表 1 条：tests/head-cert-deps.test.ts:995 是 `toContain("staleScratchTrees(wtRows")` 字符串字面量内的形状断言，非调用。

| 符号 | 图站点 | 真值站点 | tp | fp | fn | precision | recall |
|---|---|---|---|---|---|---|---|
| insideScratchFace | 0 | 0 | 0 | 0 | 0 | n/a | n/a |
| staleScratchTrees | 13 | 13 | 13 | 0 | 0 | 1.000 | 1.000 |
| runInSandbox | 12 | 12 | 12 | 0 | 0 | 1.000 | 1.000 |
| appendRun | 1 | 1 | 1 | 0 | 0 | 1.000 | 1.000 |

**AGGREGATE precision=1.000 recall=1.000（tp=26 fp=0 fn=0）⇒ GATE 双过**（门：precision==1.0、recall≥0.9）。

## 四、同提交热载实测（buildImpact 内部计时，560 文件）

| 路径 | 3 次 buildMs | 中位 |
|---|---|---|
| 索引命中（parsed=0 fromTagsCache=0 fromIndex=true） | 90 / 71 / 73 | **73ms** |
| 无索引对照（tags 缓存全热，仍要重组 560 文件 Map＋edges 排序） | 201 / 143 / 152 | 152ms |
| 冷建（全仓 tree-sitter 全解析，09-30 独立进程实测） | — | ≈1200ms |

索引命中比 tags 全热再省约一半；比冷建省一个量级。取证：accuracy-prod.log（含 GATE 行与逐符号表）。

## 五、登记

- 探针与读数是**当次工作树快照**：索引指纹（mtime+size）保证同 sha 下内容变化不会吃旧图；隔壁会话在飞文件计入 candidates 但不影响判卷口径。
- 能力 10（真模型基准）无凭据，未做——沿用 258 页裁决④「不造假读数」。
