# 第 966 页：进程探活三态（2026-11-01）

## 缺口

`kill(pid, 0)` 的判活回执此前在 8 个文件里各写一遍：

- 7 处核心/主进程：`src/main/session-lock.ts`、`src/main/session-mutation-lock.ts`、
  `src/main/evolution/canary.ts`、`src/orchestration/local-backend.ts`、
  `src/orchestration/store.ts`、`src/permissions/rules.ts`、`src/agent/plugins/mcp.ts`；
- 1 处脚本层：`scripts/lib/tool-lock.ts`。

其中 `session-mutation-lock.ts` 的 `catch { return false; }` 把 EPERM 当「已退出」：
另一进程持有会话根锁、只是当前进程无权 signal 它时，会被误报成「崩溃遗留」并要求人工删除。
orchestration 的 writer lock 则把「不知道」当「已死」直接回收。canary 与 session-mutation
还用 `Number.parseInt` 解析锁文件，`12abc` 会被截成 12 去探活另一个进程。

## 改法

- 新增 `src/process-liveness.ts`，返回三态 `alive | dead | unknown`：成功 = alive，
  ESRCH = dead，EPERM = alive，坏 pid / 其它 errno = unknown。
- 7 个核心/主进程消费面改读共享判据；锁的回收只在 `dead` 时发生。
- `session-mutation-lock.ts` 新增 `parseMutationLockPid`，只认完整十进制 pid；
  `canary.ts` 同样改成严格解析。
- `scripts/lib/tool-lock.ts` 保留一份同口径独立适配：树闸判卷的靶子树只搬 `scripts/`
  下的被测代码（`tests/mutate-verify-gates.test.ts`），该层 import `src/` 会 MODULE_NOT_FOUND；
  判据单独钉它不反向 import、且只有 ESRCH 算死。

## 判卷与读数

| 面 | 读数 |
|---|---|
| 共享三态实现 | 1 处 |
| 核心/主进程消费面 | 7 个 |
| scripts 独立适配 | 1 个（靶子树约束，判据单独钉口径） |
| 红 1 | 共享实现把 EPERM 改判 dead ⇒ **3 红 / 2 绿**（值域 / 会话根锁 / orchestration 锁） |
| 红 2 | `permissions/rules.ts` 写回内联探活 ⇒ **1 红**（源码唯一性，点名该文件） |
| 绿 | 复原后定向 **6 文件 / 233 条全绿**；sha256 与造红前一致 |
| 核心套件 | **614 文件 / 7582 条全绿**，exit 0 |
| 桌面套件 | **309 文件 / 2071 条全绿**，exit 0（boundary 绿） |
| typecheck | **0 报错** |
| docs-check | 受检项全绿；1012 张页标题｜新撞 0｜下一个未占用页号 967 |

## 取料

- `red-1-eperm-dead.log`：共享实现 EPERM→dead 的定向失败原文（3 红）。
- `red-2-local-probe.log`：`permissions/rules.ts` 写回内联探活的源码唯一性失败原文。
- `green-targeted.log`：复原后的 6 文件 / 233 条定向绿。
- `core.log`：核心全套 614 / 7582，exit 0。
- `desktop.log`：桌面全套 309 / 2071，exit 0，含 boundary 绿。
- `typecheck.log` / `docs-check.log`：0 报错 / 受检项全绿。
- `sha-before.txt`：造红前四个关键文件的 sha256；复原后 `shasum -a 256 -c` 全 OK。

## 边界

- 未改各锁的公开 API 与落盘格式；session-mutation 锁仍写纯 pid，canary 锁仍写纯 pid。
- `unknown` 一律按「可能还活着」处理（fail closed），只有 ESRCH 允许回收。
- `scripts/lib/tool-lock.ts` 是唯一保留的独立探活副本，原因是判卷靶子树只搬 `scripts/`，
  不是遗漏；`tests/process-liveness.test.ts` 单独钉住其口径与不反向 import。
- 未跑 `gates` / `head-cert` / `mutate-verify`；本页不宣称 HEAD 认证。
