# 清理临时目录不许把绿判据弄红 · 2026-11-01

检查起点与交付面都是共享工作树，HEAD `be9c0be5`；本批改动未提交。

## 这一批改了什么

上一轮桌面套件首跑时 `terminal-login-shell.test.ts` 红了一条，本批先查清原因再动手：

**判据本身没坏，坏的是清理。** 那条判据用隔离 HOME 起真登录 shell（`$SHELL -l`），
`afterEach` 里裸 `rmSync(dir, { recursive: true, force: true })` ——登录 shell 退出前还在往
那个 HOME 写 `.zcompdump` / `.zsh_history`，清理与写入撞上就是 `ENOTEMPTY`（`force: true`
只忽略 ENOENT，不忽略 ENOTEMPTY），于是一条本该绿的判据变红。

修法：`tests/helpers/temp-dir.ts#removeTempDir`——带重试地删（`maxRetries: 10, retryDelay: 50`），
真删不掉也咽下（留下的是系统临时目录，OS 迟早会收）。`terminal-login-shell.test.ts` 改用它。

## 读数（工作树，未提交）

| 面 | 改前 | 改后 |
|---|---|---|
| 该测试的清理 | 裸 `rmSync`（ENOTEMPTY ⇒ 红） | `removeTempDir`（重试 + 咽下） |
| 探针：写入量 200 文件 | 裸 `rmSync` **15/15** 抛 ENOTEMPTY | 重试+咽下 **0/15** |
| 探针：写入量 400 文件 | 裸 `rmSync` **15/15** 抛 ENOTEMPTY | 重试+咽下 **0/15** |
| 该测试单跑 | 10/10 绿（本来就难复现） | **15/15** 绿 |
| 桌面套件整套 | 首跑 1 红（清理竞态） | **307 文件 / 2076 条全绿**，exit 0 |

## 文件

- `race-probe.mjs` / `race-probe.log`：清理竞态探针（裸 vs 带重试）。
- `desktop.log` / `typecheck.log`：桌面整套与两端 tsc。
- `scoped.patch`：本批四个文件的差量（两个新文件相对 /dev/null）。
- `docs-check.log`：台账门在补页之后的读数。

## 边界

- 这条修的是「清理」，不是「判据」：登录 shell 那一路到底执行没执行，判据一个字没松。
- `removeTempDir` 的保证是「**不抛**」，不是「一定删干净」——`tests/temp-dir-cleanup.test.ts` 另有一条钉「正常目录真的会被删掉」，防止它退化成「一律不删」。
- 没有全仓批量改另外 74 个 `rmSync` 调用点：那些没有活子进程并发写，改了是无差别噪声。

## 复现

```sh
node outputs/temp-dir-cleanup-race-2026-11-01/race-probe.mjs
cd apps/desktop && npx vitest run tests/temp-dir-cleanup.test.ts tests/terminal-login-shell.test.ts --config vitest.config.ts
```
