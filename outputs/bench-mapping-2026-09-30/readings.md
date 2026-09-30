# 基准映射与最小可测口径（能力 10 底账，2026-09-30 23:0x，主树 @`a7eb514`）

先说清现状再谈映射：**本仓的评测底座已存在且比"台账无证据"暗示的完整**——缺的不是底座，是外部数据集与一次真模型授权跑。

## 一、盘点：已经在的

| 件 | 位置 | 状态 |
| --- | --- | --- |
| TaskSpec 数据层（纯模块，不 IO 不 spawn） | `src/agent/eval/task-set.ts`（244 行） | 在；判卷 21 条（`tests/eval-task-set.test.ts`） |
| SWE-bench JSONL 适配器 | `fromSweBenchJsonl`（task-set.ts） | 在且有专测（`describe("fromSweBenchJsonl…")`） |
| 可行性三分类 | `feasibility`／`EnvProbe`／`aggregateFeasibility` | 在：缺快照/缺凭据＝「没有尺」，与「跑出来红」分开记 |
| 静默丢条防线 | task-set 解析规矩 | 在：要么进 tasks 要么进 errors 并点名行号/字段，无第三出口 |
| 生产装配闭环跑器 | `scripts/loop-eval.ts`（441 行） | 在：接真模型、mkdtemp 靶子、判卷面锁定（越界改判卷单独记账）、`--reps` 单次读数不宣称趋势 |
| 双读数纪律 | loop-eval 头注 | 在：「准确率」与「$/成功任务」并列，不报单边 |
| 内置 gym（假模型档） | `gym-check` 门（帽 2400ms） | 在：日常门面里跑的是这档 |
| 数据集 | —— | **不在**（仓内 jsonl 全是门夹具）；真实基准数据须外部取 |

## 二、三把外部尺映射到既有面

| 基准 | 映射到 | 改造量 | 最小可测口径 |
| --- | --- | --- | --- |
| **Aider-Polyglot 式本地练习** | `TaskSpec{kind:"dir", seed:练习目录, verifier:{command:"测试命令"}}` | **最小**：练习目录＋判卷命令本就是 TaskSpec 的原生形状，写个导出脚本即可 | n≥20 练习 × `--reps 1`；读数＝通过率＋$/成功任务＋判卷面零越界 |
| **SWE-bench Verified（抽样）** | `fromSweBenchJsonl`（已测） | 适配在；缺：数据集文件、失败补丁的判卷面（官方 eval 容器或自有判卷） | 先 10-30 条抽样跑通端到端，读数同上；「判卷面」必须与任务集分开记账（loop-eval 已有此纪律） |
| **Terminal-Bench** | 无现成适配 | **最大**：任务在容器里跑，`runInSandbox` 是 macOS seatbelt 不是容器 ⇒ 需要容器运行时裁决（Docker/orbstack）＋适配层 | 前两把出数后再议；硬先决＝容器决策 |

## 三、拦在哪（全是用户裁决，没有技术悬念）

1. **真模型凭据**：`loop-eval` 用法写死「凭据只走 env，不落文件」（`M0_API_KEY`／`M0_ENDPOINT`／`M0_MODEL`）——
   需要你给一个 key 或指定端点；没有它，能力 10 永远停在「没有尺」那一格，这不是失败但也不是读数。
2. **数据集获取**：SWE-bench JSONL 需网络下载（几百 MB 级）；Polyglot 式练习可自建 20 条起。
3. **容器与否**（只影响 Terminal-Bench，前两把不需要）。
4. **花钱授权**：一次 n=20 × reps=1 的真模型跑，成本上限建议先设 `--max-steps`＋每任务预算帽（`maxBudgetUsd` 机制已有），估 $1-5 量级。

## 四、建议的最小第一步（等你点头就跑）

Aider-Polyglot 式本地练习 20 条（自建，零网络）：`parseTaskSetJson` 喂入 → `loop-eval --reps 1` →
产出第一份「准确率＋$/成功任务」双读数。它同时是能力 10 与能力 9 的交汇点：成本可观测从此有了真模型价格点。
