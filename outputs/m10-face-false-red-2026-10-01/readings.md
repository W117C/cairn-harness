# M10 多面一起跑 · 假红率读数

阶段：arms=Q;reps=2;suites=2 ｜ arms=C;reps=2;suites=1


### 各面各臂读数（exit=0 绿）

| 臂 | 趟 | 面 | exit | 墙钟 |
|---|---:|---|---:|---:|
| Q | 1 | typecheck | 0 ✅ | 5.5s |
| Q | 1 | test-a | 0 ✅ | 176.1s |
| Q | 1 | gates | 0 ✅ | 18.9s |
| C | 1 | typecheck | 0 ✅ | 8.6s |
| C | 1 | test-a | 0 ✅ | 178.9s |
| C | 1 | gates | 0 ✅ | 25.3s |
| C | 2 | typecheck | 0 ✅ | 6.0s |
| C | 2 | test-a | 0 ✅ | 180.6s |
| C | 2 | gates | 0 ✅ | 20.5s |

### 并发条件（臂内每 2s 采一次：`ps -eo pid,pgid,rss,command` + `uptime`）

- 臂内采样点 279 个（起跑前/收工后的边界点不计入——它们跨阶段同名）
- 环境里的**别的判卷套数**（仓里现成的 `countConcurrentSuites`，按 pgid 去重）：0–2（取不到的点 0 个）
- load average(1m)：3.86–6.65
- node 进程数：9–19；RSS 合计：105–1288MB（峰 1288MB）

| 采样段 | 点数 | 判卷套数 | load1 | node 进程 | RSS 合计 MB |
|---|---:|---|---:|---:|---:|
| Q-r1 | 100 | 0–1 | 3.86–6.2 | 9–12 | 105–658 |
| C-r1 | 89 | 1–2 | 5.02–6.65 | 9–19 | 200–1288 |
| C-r2 | 90 | 1–2 | 4.18–6.54 | 9–15 | 188–1125 |

### 判卷 json 里的失败用例（逐条列名）

- `suite-quiet.json`：3632 条，通过 3632，**红 0**
- `suite-a.json`：3632 条，通过 3632，**红 0**
- `suite-b.json`：**不存在** ⇒ 这一格没量到

### 逐条用例 vs 自己的预算（贴帽 = 用时 ≥ 有效预算 80%）

- **quiet**：3632 条｜贴帽 0 条｜无显式预算 3372 条｜离帽最近：m3c.test.ts·M3c pipeline 哑 sequencer（零 15207/25000ms=61%；evidence-typecheck.test.ts·门那一半：runner 的两个拒绝分支各自要出声 拼 3449/15000ms=23%；evidence-typecheck.test.ts·真环境：这一格得在真仓里跑得出东西（规则 237/3 3133/15000ms=21%（缺省＝config 里的 testTimeout=30000ms）
- **a**：3632 条｜贴帽 0 条｜无显式预算 3372 条｜离帽最近：m3c.test.ts·M3c pipeline 哑 sequencer（零 15242/25000ms=61%；evidence-typecheck.test.ts·门那一半：runner 的两个拒绝分支各自要出声 拼 3596/15000ms=24%；evidence-typecheck.test.ts·门那一半：runner 的两个拒绝分支各自要出声 归 2898/15000ms=19%（缺省＝config 里的 testTimeout=30000ms）
- **b**：/Users/ze/Downloads/deepseek harness/outputs/m10-face-false-red-2026-10-01/raw/suite-b.json 不存在 ⇒ 这一格没量到（不等于「0 条贴帽」）

有效缺省预算 30000ms（来源：缺省＝config 里的 testTimeout=30000ms）

| json | 用例 | 用时 | 预算 | 占比 |
|---|---|---:|---:|---:|
| quiet | m3c.test.ts·M3c pipeline 哑 sequencer（零 LLM） 未获 | 15207ms | 25000ms | 60.8% |
| quiet | evidence-typecheck.test.ts·门那一半：runner 的两个拒绝分支各自要出声 拼错的开关 ⇒ 退 | 3449ms | 15000ms | 23.0% |
| quiet | evidence-typecheck.test.ts·真环境：这一格得在真仓里跑得出东西（规则 237/320） 真仓那一 | 3133ms | 15000ms | 20.9% |
| quiet | evidence-typecheck.test.ts·门那一半：runner 的两个拒绝分支各自要出声 归属面取料那一行必 | 3126ms | 15000ms | 20.8% |
| quiet | head-cert-deps.test.ts·清场读数：常驻残留的 scratch 树要自己报数（任务 #33）  | 5454ms | 30000ms | 18.2% |
| a | m3c.test.ts·M3c pipeline 哑 sequencer（零 LLM） 未获 | 15242ms | 25000ms | 61.0% |
| a | evidence-typecheck.test.ts·门那一半：runner 的两个拒绝分支各自要出声 拼错的开关 ⇒ 退 | 3596ms | 15000ms | 24.0% |
| a | evidence-typecheck.test.ts·门那一半：runner 的两个拒绝分支各自要出声 归属面取料那一行必 | 2898ms | 15000ms | 19.3% |
| a | head-cert-deps.test.ts·清场读数：常驻残留的 scratch 树要自己报数（任务 #33）  | 5202ms | 30000ms | 17.3% |
| a | mutate-verify-gates.test.ts·树闸接线：真跑本脚本——主检出拒跑且一个字节都没改过盘，linked | 2433ms | 15000ms | 16.2% |

### 备注

- ⚠️ 起跑时环境判卷套数=0（-1=取不到；0=真独占）
- ⚠️ 起跑时环境判卷套数=1（-1=取不到；0=真独占）
