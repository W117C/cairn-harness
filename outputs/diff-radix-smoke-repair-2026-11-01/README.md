# 两支延迟冒烟：一支坏了、两支都只量不判 · 2026-11-01

检查起点与交付面都是共享工作树，HEAD `be9c0be5`；本批改动未提交。

## 一、坏掉的那支

`diff-render-latency.cjs` 用 `textContent.includes('edit_file')` 找要点的工具行。产品自「不暴露实现名」之后，
行上只写中文动词（`edit_file` → 「编辑」，词表在 `derived/tool-verbs.ts`），于是它**永远等不到那一行**：

```
[diff-render-latency] 崩了: Error: 等待超时：edit tool row   → EXIT=1
```

也就是说 `REPOSITORY-STATUS` 里「4000 行 diff 挂载 191.1 ms」这个读数，在改词之后**已经复现不出来**。
修法：按动词选行（「编辑」），不按实现名。

> 先试过给工具行加 `data-tool={r.tool}` 当钩子——被 `stream-rework.test.tsx` 当场拦下
> （`expect(html).not.toContain("run_shell")`：渲染出的 HTML 里不许出现实现名）。钩子已撤回。

## 二、两支都「量过 ≠ 判过」

| 脚本 | 改前 | 改后 |
|---|---|---|
| `diff-render-latency.cjs` | `ok` 只看结构（20 hunks / 4000 行 / 已截断 / 无控制台错误），`elapsedMs` 只打印 | 加 `CAIRN_DIFF_BUDGET_MS`（默认 2000 ms），超帽 FAIL + exit 1 |
| `radix-open-latency.cjs` | 无条件 `app.exit(0)`——首开 3 秒也绿 | 加 `CAIRN_RADIX_FIRST_BUDGET_MS`（默认 500）/ `CAIRN_RADIX_WARM_BUDGET_MS`（默认 200，判复开 p95） |

帽都取实测的 10 倍上下：拦数量级回归，不拦 ±10%（本机单跑离散度 1.66×，见第 956 页）。

## 三、读数（都是真跑）

| 跑 | 读数 |
|---|---|
| diff 造红（帽 1 ms） | `超预算：挂载 192.6ms > 帽 1ms`，**exit 1** |
| radix 造红（首开帽 1 ms） | `超预算：首开 26.2ms > 帽 1ms`，**exit 1** |
| diff 复原（默认帽） | **PASS 185.4 / 193.6 / 203.3 ms**（三跑），20 hunks / 4000 行 / 24,621–24,625 节点，exit 0 |
| radix 复原（默认帽） | 首开 **11.9 / 26.8 ms**，复开 p95 **13.9 / 14.3 ms**，exit 0 |
| 桌面套件 | **2085 条全绿**，exit 0（含 boundary 绿） |

## 四、边界

- 只加「时间超帽即失败」，不改两支冒烟的取数口径与夹具。
- diff 的 4000 行来自 `--cairn-large-diff-fixture`（20 hunks × 200 行），不是真实仓库 diff；量的是 renderer 挂载。
- radix 用 `sendInputEvent` 发真实鼠标输入；首开与复开分开判。
- 三跑 diff 的 185–203 ms 与 10-27 的 191.1 ms 同量级——**不是**回归，是从来没被判定过。

## 复现

```sh
cd apps/desktop
env -u ELECTRON_RUN_AS_NODE npx electron scripts/diff-render-latency.cjs /tmp/diff.json
env -u ELECTRON_RUN_AS_NODE npx electron scripts/radix-open-latency.cjs /tmp/radix.json 12
CAIRN_DIFF_BUDGET_MS=1 env -u ELECTRON_RUN_AS_NODE npx electron scripts/diff-render-latency.cjs /tmp/red.json   # 应 exit 1
```
