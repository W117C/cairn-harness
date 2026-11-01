# 两个纯函数各抄了两份 · 2026-11-01

检查起点与交付面都是共享工作树，HEAD `be9c0be5`；本批改动未提交。

## 这一批改了什么

本轮用「跨文件同体函数」扫描（比对归一化后的函数体哈希，而不是比名字）找到的两组：

| 函数 | 两份在哪 | 为什么会漂 |
|---|---|---|
| `repoNameFromUrl` | `src/main/git-ops.ts`（决定**落库的项目名**）与 `renderer/components/AddProjectMenu.tsx` 的 `repoNamePreview`（「将克隆到：」**预览**） | 改一处就漂：预览说 `bar`、落库说 `bar-2`，或预览空、落库有名。渲染层那份的注释自称「薄镜像」 |
| `triggerLabel` | `agent/evolve/playbook.ts`（经验条目正文）与 `main/evolve/promotion.ts`（晋升包正文） | 同一条件在两处说两个词 |

`repoNameFromUrl` 收到 `src/git-url.ts`（纯字符串解析，不碰网络/文件系统），`git-ops.ts` 转出口保持既有 import 路径可用；`triggerLabel` 由 `playbook.ts` 导出、`promotion.ts` 改读。

## 读数（工作树，未提交）

| 判卷面 | 读数 |
|---|---|
| `shared-pure-helpers.test.ts` | 渲染层写回自己的解析 ⇒ **1 红**；`promotion` 写回自己那份（`on-signal` 改说「触发了」）⇒ **1 红**；改后与 `git-ops.test.ts` 合跑 **9/9 绿** |
| 核心套件 | **607 文件 / 7548 条全绿**，exit 0 |
| 桌面套件 | **2073 条全绿**，exit 0（含 boundary 绿） |
| 两端 typecheck | 0 / 0 |

## 一次观察到的抖动（如实记）

桌面套件**第一次**跑时 `tests/terminal-login-shell.test.ts` 有 1 条红（「命令真的执行…产品走 `$SHELL -l`」，登录 shell 子进程相关）；单独跑该文件 **3/3 绿**，整套重跑 **2073 全绿**。判定为并行负载下的抖动，与本批改动无关（本批没碰终端）。首跑日志留在 `desktop-first-run-flake.log`，未被吞掉。

## 文件

- `red-green.log`：两处造红与复原后的绿。
- `core.log` / `desktop.log` / `desktop-first-run-flake.log` / `typecheck.log`：套件与 tsc 原文。
- `scoped.patch`：本批七个文件的差量（两个新文件相对 /dev/null）。
- `docs-check.log`：台账门在补页之后的读数。

## 边界

- `repoNameFromUrl` 的判据口径没变（非法一律 `null`，不猜），原 `git-ops.test.ts` 的六条断言仍绿。
- `triggerLabel` 只搬位置，不改编排；五种触发的词一个没动。
- 终端那条抖动本轮只记录、未修（要修得先能稳定复现，否则就是拍脑袋改超时）。

## 复现

```sh
npx vitest run tests/shared-pure-helpers.test.ts tests/git-ops.test.ts --config tests/vitest.config.ts
cd apps/desktop && pnpm test
```
