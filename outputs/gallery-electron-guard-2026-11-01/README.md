# 画廊脚本先做环境体检 · 2026-11-01

检查起点与交付面都是共享工作树，HEAD `be9c0be5`；本批改动未提交。

## 这一批改了什么

环境里带 `ELECTRON_RUN_AS_NODE=1` 时，`npx electron scripts/ui-gallery.cjs` 实际是 **node** 在跑：
`require("electron")` 退化成字符串，`app` 是 undefined，脚本在 `app.whenReady()` 处报
「Cannot read properties of undefined (reading 'whenReady')」，catch 里的 `app.exit(1)` 再抛一次
「reading 'exit'」——真正的原因（那个环境变量）谁都看不见，只剩一段 node 栈。

改：脚本开头体检（没有 `app` 就印原因与复跑命令、以 2 退出）；catch 改成 `process.exit`。
判卷 spawn 一个带该环境变量的 node 进程，钉「退 2 + 输出里有 ELECTRON_RUN_AS_NODE + 不再出现 whenReady」。

## 读数（工作树，未提交）

| 面 | 改前 | 改后 |
|---|---|---|
| `ELECTRON_RUN_AS_NODE=1 node scripts/ui-gallery.cjs` | `[gallery] FAIL TypeError: … reading 'whenReady'` + node 栈，**exit 1** | `[gallery] 当前进程里没有 Electron 的 app：很可能是环境里有 ELECTRON_RUN_AS_NODE=1…` + 复跑命令，**exit 2** |
| 真 Electron（`env -u ELECTRON_RUN_AS_NODE npx electron …`） | — | **exit 0**，20 张截图 + 全部分区自查打印，`[gallery] done` |

| 判卷面 | 读数 |
|---|---|
| `gallery-guard.test.ts` | 去掉体检 ⇒ **1 红**（`expected 1 to be 2`）；改后 **1/1 绿** |
| 桌面套件 | **2052 条全绿**，exit 0（含 boundary 绿） |
| 根 typecheck / 桌面 tsc | 0 / 0 |

## 文件

- `before.log` / `after.log`：同一环境变量下改前改后的完整输出与退出码。
- `red-green.log`：去掉体检的红与复原后的绿。
- `gallery.log`：真 Electron 那一趟（20 张截图、`[gallery] done`）。
- `desktop.log` / `typecheck.log`：桌面套件与两端 tsc。
- `scoped.patch`：本批三个文件的差量。
- `docs-check.log`：台账门在补页之后的读数。

## 边界

- 只给画廊这一个入口做了体检。`apps/desktop/scripts/` 下另有几十个 smoke 脚本同样 `require("electron")`
  （其中大半还是未提交的新文件），同一个环境变量会让它们报同样的栈——本批不批量改别人的在飞文件
  （试过，45 个文件里 43 个是未跟踪的在写文件，已全部回退）。
- 退出码 2 = 环境问题，与「断言失败」的 1 分开。

## 复现

```sh
cd apps/desktop
ELECTRON_RUN_AS_NODE=1 node scripts/ui-gallery.cjs; echo "exit=$?"     # 期望 2 + 指认环境
env -u ELECTRON_RUN_AS_NODE npx electron scripts/ui-gallery.cjs        # 期望 0 + [gallery] done
npx vitest run tests/gallery-guard.test.ts --config vitest.config.ts
```
