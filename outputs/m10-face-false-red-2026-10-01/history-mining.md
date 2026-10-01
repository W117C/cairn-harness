# 历史判卷：红过几次、红的时候谁在并行

扫描 1199 个文件 / 94492 行 ⇒ 汇总行 124 条，去重后 **84 趟**

| 分类 | 趟数 |
|---|---:|
| 绿 | 73 |
| **红** | **11** |
| 其中撞窗态 | 3 |
| 其中独占态 | 6 |
| 其中并发未印（判不了） | 2 |

| 并发状态 | 趟数 | 红 | 红率 |
|---|---:|---:|---:|
| 独占 | 65 | 6 | 9.2% |
| 未印 | 10 | 2 | 20.0% |
| 撞窗 | 9 | 3 | 33.3% |

### 红的那些趟（逐条）

| 树 | 失败文件 | 失败用例 | 退出码 | 并发状态 | 出处 |
|---|---:|---:|---:|---|---|
| (这趟没印树) | 1 | -1 | ? | (这趟没印并发) | outputs/code-review-report-2026-09-13.md:451 |
| bd5ec4496 | 2 | 2 | 1 | 起前 1 套／跑完 2 套（撞窗：本仓判卷有读写共享 /tmp 的用例） | outputs/evidence-typecheck-gate-2026-10-01/head-cert-bd5ec44-run1.log:41 |
| 8a9ce3e8e | 1 | 1 | 1 | 起前 0 套／跑完 0 套（两端独占） | outputs/exec-cause-mix-2026-09-30/head-cert.log:13 |
| fd59ad9 | 2 | 2 | 1 | (这趟没印并发) | outputs/head-cert-one-command-2026-09-26/01-认证一棵树从此是一条命令.md:41 |
| 73ed49d | 1 | 1 | 1 | 起前 1 套／跑完 0 套（撞窗：本仓判卷有读写共享 /tmp 的用例） | outputs/hook-budget-291-2026-10-01/wait-and-verify.log:78 |
| 940dbb9df | 1 | 1 | 1 | 起前 0 套／跑完 0 套（两端独占） | outputs/impact-samefile-fix-2026-09-30/head-cert-940dbb9.log:36 |
| 8ad8b70d5 | 1 | 1 | 1 | 起前 0 套／跑完 0 套（两端独占） | outputs/ledger-sha-face-2026-09-30/head-cert-final.log:36 |
| dd0e8d9df | 2 | 2 | 1 | 起前 0 套／跑完 0 套（两端独占） | outputs/ledger-sha-face-2026-09-30/kill-fix-and-cert.log:45 |
| bcf346dd9 | 1 | 1 | 1 | 起前 0 套／跑完 0 套（两端独占） | outputs/observer-census-282-2026-10-01/head-cert-bcf346d.log:40 |
| b4919e3e5 | 1 | 1 | 1 | 起前 0 套／跑完 0 套（两端独占） | outputs/selector-uniqueness-2026-09-30/head-cert-b4919e3.log:37 |
| e42b4afa0 | 2 | 1 | 1 | 起前 0 套／跑完 1 套（撞窗：本仓判卷有读写共享 /tmp 的用例） | outputs/witness-face-widen-290b-2026-10-01/head-cert-e42b4af.log:44 |

### 容量红签名（`Test timed out` / `Hook timed out`）共 3 处

| 出处 | 时限 | 上下文 |
|---|---:|---|
| outputs/hook-budget-291-2026-10-01/wait-and-verify.log:9 | 10000ms | ✅ prose-scan-heavy-hook-left-on-default-timeout — 把真仓那支 `beforeAll` 的显式时限摘掉（回到第 287 页落下来的形 |
| outputs/orchestrator-hold-column-2026-09-30/self-check-1.log:39 | 5000ms | [31m[1mError[22m: Test timed out in 5000ms. |
| outputs/orchestrator-hold-column-2026-09-30/self-check-1.log:52 | 5000ms | [31m[1mError[22m: Test timed out in 5000ms. |
