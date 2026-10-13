# 本仓第一对**严格同提交**的真模型读数（`cn:hy3` × 12 条 × 2 趟）

**为什么要有这一对**：2026-10-12 那两趟读数（`outputs/bench-hy3-2026-10-12/` 与
`outputs/bench-hy3-rep2-final/`）跨了三个提交——另一会话在我跑的同时在提交，
`loop-eval` 的 `headSha` 是**跑的那一刻**现读的 ⇒ 严格说那不是「同一棵树上的两趟」。
这一对自己重跑过，两趟都盖着同一个 `sha`。

## 配置（两趟逐字相同）

`headSha=87a787fcdb1d6f083d51f8e47d08da03b02ba97b`｜`model=cn:hy3`｜`maxSteps=20`｜`reps=1`｜
`arm=base`｜`providerFace=真会话`｜任务集 `fixtures/bench/tasks.json`（12 条）｜端点 `http://127.0.0.1:7863/v1`

## 读数

| 指标 | 趟 A | 趟 B | 差（= 噪声带） | 判定 |
|---|---|---|---|---|
| 成功率 | 75.0%（9/12） | 83.3%（10/12） | **8.3%** | 带内 |
| 输入 token | 495295 | 495997 | 1404 | 带内 |
| 输出 token | 27654 | 28407 | 1506 | 带内 |
| 墙钟(秒) | 417.5 | 451.0 | 67.1 | 带内 |
| 内存峰(MB) | 351 | 352 | 2 | 带内 |
| 工具失败 | 6 | 11 | 11 | 带内 |

逐靶（两趟都跑同一 12 条；这一格 `report.ts` 自己的配对面印不出来——见下「已知形状」）：

| 靶 | 趟 A | 趟 B | |
|---|---|---|---|
| B1-bugfix-crossfile | FAIL | FAIL | 两趟都红 |
| **B2-feature-export** | **FAIL** | **PASS** | **唯一翻转** |
| B3 / B4 / B5 / B6 / B7 / B8 / B9 / B10 / B11 | PASS | PASS | 两趟都绿 |
| B12-long-horizon | FAIL | FAIL | 两趟都撞 `maxSteps=20` |

## 这一对量出来的那句话（本仓此前没有的尺）

**同一配置下，12 条里会翻转 1 条（8.3%）⇒ 单条靶的涨落正好落在噪声底上。**
也就是说：`reps=1`、12 条的这套配置**测不出「一次改动带来 1 条靶提升」**；
要声称有效果，至少得 ≥2 条靶的移动，或提高 `--reps`。
这正是计划 D-A 里那句「这把尺现在测不出…」第一次被量化。

## 已知形状（两趟都是分块跑再拼的）

整趟跑在本机会被外部信号杀掉（前台后台都试过，共 5 次死在中途）⇒ 每趟分 3 块、每块 4 条，
跑完按 id 拼成整批。副作用：`report.ts` 的**逐靶配对面**按 `ranAt` 分趟 ⇒ 它看到的是 6 个
「同面 1 趟」的面（每块一个时间戳），于是那一格印 `0 个共同靶`。
上面那张逐靶表是手工按 id 对齐算的，**不是** `report.ts` 的输出——两处口径不同，别混读。

## 复跑

```sh
OPENAI_BASE_URL=http://127.0.0.1:7863/v1 OPENAI_API_KEY=<key> OPENAI_MODEL=cn:hy3 \
  node --import tsx scripts/loop-eval.ts --tasks fixtures/bench/tasks.json --reps 1 \
  --only B1-bugfix-crossfile,B2-feature-export,B3-refactor-callsite,B4-bugfix-pagination \
  --out outputs/<新目录>

node --import tsx scripts/eval/report.ts \
  --baseline outputs/bench-hy3-head-a-final/readings.json \
  --baseline outputs/bench-hy3-head-b-final/readings.json \
  --candidate outputs/bench-hy3-head-b-final/readings.json
```

`report-noise-band.txt` 是同一条命令的原文（出口码 0）。
