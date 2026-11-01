# 时间线的工具步 · 2026-11-01

检查起点与交付面都是共享工作树，HEAD `be9c0be5`；本批改动未提交，未跑 `head-cert-check` / `mutate-verify`
（两者量的是 HEAD）。

## 这一批改了什么

1. 词表 `TOOL_VERBS` 与 `toolVerb` 从 `apps/desktop/src/renderer/components/Stream.tsx` 搬到
   `apps/desktop/src/renderer/derived/tool-verbs.ts`（派生层：对话流与时间线都能读，组件层不再拥有词表）。
   `Stream.tsx` 改为 import + re-export，既有 import 路径不破。
2. `apps/desktop/src/renderer/derived/timeline.ts`：tool 步 label 从 `${e.name} ${summarize(...)}`
   改成 `${toolVerb(e.name) ?? e.name} ${summarize(...)}`。
3. `apps/desktop/tests/timeline-pane.test.tsx`：旧钉 `read_file a.ts` 改指现值，并加反向钉与「未知工具回落原名」一格。
4. `apps/desktop/tests/tool-row-summary.test.ts`：词表 import 改指新模块（同一份事实源）。
5. `apps/desktop/design/desktop-design-spec.md`：补第 43 条。

## 读数（工作树，未提交）

| 事件 | 改前 label | 改后 label |
|---|---|---|
| `read_file {path:"a.ts"}` | `read_file a.ts` | `读取 a.ts` |
| `run_shell {command:"pnpm test"}` | `run_shell pnpm test` | `运行 pnpm test` |
| `grep {pattern:"TODO", path:"src"}` | `grep TODO` | `查找 TODO` |
| `mystery_tool {q:"x"}` | `mystery_tool {"q":"x"}` | `mystery_tool {"q":"x"}`（未知工具保持） |

| 判卷面 | 读数 |
|---|---|
| `timeline-pane.test.tsx` | 改回 `${e.name}` 复现 **3 红 / 4 绿** → **7/7 绿** |
| 桌面套件 | **298 文件 / 2011 条全绿**，exit 0（含 boundary 绿；13:28 那一趟） |
| 根 typecheck / 桌面 tsc / renderer-layer | 0 / 0 / 绿（172 个渲染层源文件，+1 新模块） |

## 文件

- `before-labels.log` / `after-labels.log`：`.tmp/probe-timeline.mts` 对四个 tool_call 的 label 前后输出
  （改前那份是把 label 改回 `${e.name}` 复现的旧行为）。
- `red-green.log`：timeline-pane 改前 3 红、复原后 7 绿。
- `desktop.log`：桌面套件 + boundary 的同树实跑（13:28 那趟，本批代码就位）。
- `desktop-after-other-session.log`：13:32 同树另一笔在飞改动后的全量——`run-generation` 一条源码哨兵
  被那笔改红（不属本批，未认领）。
- `typecheck.log`：根与桌面 tsc、renderer-layer。
- `scoped.patch`：本批六个文件的差量（新模块相对 /dev/null）。
- `docs-check.log`：台账门在补页之后的读数。

## 边界

- 只搬词表、没改词表内容；未知工具仍显示实现名（宁缺不编）。
- 时间线的 `kind` 词与几何没动；`roundTimeline`（rail 悬停面板）不走这条标签。

## 复现

```sh
cd apps/desktop
npx vitest run tests/timeline-pane.test.tsx tests/tool-row-summary.test.ts --config vitest.config.ts
pnpm test
cd ../..
node --import tsx scripts/typecheck.ts
pnpm renderer-layer-check
```
