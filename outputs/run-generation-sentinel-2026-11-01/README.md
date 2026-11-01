# run 代际守卫的哨兵 · 2026-11-01

检查起点与交付面都是共享工作树，HEAD `be9c0be5`；本批改动未提交，未跑 `head-cert-check` / `mutate-verify`
（两者量的是 HEAD）。

## 这一批改了什么

1. `apps/desktop/tests/run-generation.test.ts` 的「停止态写入同样按代际守卫」：原来钉的是带缩进的原文
   （`{` + 换行 + 10 空格 + `setStoppedIds`），同树另一笔把守卫搬进 `drainQueue(initial, async (msg) => {…})`
   回调（`apps/desktop/src/renderer/state/run-queue.ts:121`）后缩进多一层就红。改成按词序判的正则，并另加一条 `res.aborted` 语义钉。
2. 新增「起点删除同样按代际守卫」一条（`apps/desktop/src/renderer/state/run-queue.ts:141` 的 `runStartBySession.current.delete(sid)`
   此前没有任何判据）。
3. 产品代码一行未改（守卫本来就在），断言未删、未放宽。

## 读数（工作树，未提交）

| 面 | 读数 |
|---|---|
| `run-generation.test.ts` | 改前（HEAD 版判卷 × 现工作树源码）**1 红 / 1 绿** → 改后 **3/3 绿** |
| 变异 A（守卫条件改 `true`） | 「停止态写入」红，1 红 / 2 绿 |
| 变异 B（摘掉起点的守卫） | 新增那条红，1 红 / 2 绿 |
| 复原 | `run-queue.ts` sha256 `2a5d664ed142de17cb4e8c7c70bd4326ca80e34a74d11ffa58d7b6fc4011f64c` |
| 桌面套件 | **299 文件 / 2022 条全绿**，exit 0（含 boundary 绿） |

## 文件

- `before.log` / `after.log`：同一份源码下，HEAD 版判卷与改后判卷的原文。
- `mutation.log`：两条变异各红一次，均从备份复原并核 sha256。
- `desktop.log`：桌面套件 + boundary 的同树实跑。
- `scoped.patch`：本批一个文件的差量。

## 边界

- 这是判据债不是产品债：守卫语义没动，改的只是「怎么读源码」。按词序判抓不住「同块重排」（把
  `setStoppedIds` 提到守卫外），那要靠行为判卷。
- 同族还有四处「换行 + 固定缩进」的源码哨兵（`apps/desktop/tests/session-stream-isolation.test.ts:64`、
  `apps/desktop/tests/render-structure.test.tsx:741`、`apps/desktop/tests/plan-mode-wiring.test.ts:35`、
  `apps/desktop/tests/desktop-review-batch.test.ts:30`）；
  此刻都绿，本批不动，登记备查。

## 复现

```sh
cd apps/desktop
npx vitest run tests/run-generation.test.ts --config vitest.config.ts
pnpm test
```
