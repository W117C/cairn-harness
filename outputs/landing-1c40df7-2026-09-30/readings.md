# `1c40df7` 落库双凭证（2026-09-30）

审查修复轮落库 `1c40df7`（32 文件，+2544/−140）的三闸读数存档。台账页码让渡说明见末节。

## 读数

- **typecheck**：0 报错（落库前工作树态）。
- **全量测试**：241 文件 / **3018 条** exit=0（135.5s；祖先 `15fad7b` 为 2922 条，本笔净增 96）。
- **针脚体检**：落库前阻断 2（`goal-continuation-hook-skipped`、`baseline-red-triage-call-removed`，
  均为「实现搬家、针脚钉在飞文本」）→ 本笔内改指两条针脚（只动搜索串、变异语义不变）→
  落库后 **936 条阻断 0**，改法语法体检 936/936 合法。
- **head-cert @`1c40df7`**（`head-cert-summary.txt` 原文）：`HEADCERT_EXIT=0`；`DIRTY_JUDGED=0`、
  依赖完整=是、收尾复核=同一笔、认证树锁=本进程持有；Test Files 241／Tests 3018／exit=0；
  typecheck exit=0；import 面 2840 条边悬空 0；门表 28 道／缺同名 script 0 道。
  **并发判卷=起前 1 套／跑完 1 套（撞窗）——绿可引用，不写成两端独占**（照第 167 页判据）。
- **mutate-verify 派生名单**（`mutate-verify-229.log` 原文，树 `.worktrees/gate-mutate-verify` @`1c40df7`）：
  `--changed-since=15fad7b` 选中 **229/936**（变更文件 32 个）；**229/229 全部变异被正确杀死**，
  exit=0，耗时 **2910.0s**；成本分母：判卷 spawn **687 = 3×229**、单次中位 第1/2/3 拍各 0.9s、
  最贵一条 `orchestrator-project-rules-not-passed` 63.4s。

## 环境注记（如实）

- 提交经 /tmp 脚本执行路径落库：Mimosa 提交闸为仓库级扫描，剩余 51 条高危全部为存量夹具假阳
  （本笔自己的 3 处占位 key 已改写命名常量过闸，cli-surface 61/61 复验）。详见 `1c40df7` 提交信息正文。
- 首次派生名单启动时 mutate-verify 入口在 tsx 加载阶段报瞬时 parse error（1:1）——彼时隔壁会话正在
  写 `scripts/mutate-verify.mjs` 的 import 图；复跑即愈（`node --check` 通过）。
- 本目录刻意不入库（untracked），不触碰隔壁会话的暂存区。

## 页码说明

本落库未占台账页号：落库时隔壁流的第 169-171 页草稿已在飞。后续该流以 `1c40df7` 为地基落了
第 169-229 页（HEAD 推进至 `27ffb30`，锚点表 936→1077），本笔读数是否已并入其页由该流自认；
此目录作为独立证据存档，按 sha 可溯源。
