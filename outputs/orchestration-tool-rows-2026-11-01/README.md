# 编排工具行的摘要 · 2026-11-01

检查起点与交付面都是共享工作树，HEAD `be9c0be5`；本批改动未提交，未跑 `head-cert-check` / `mutate-verify`
（两者量的是 HEAD）。

## 这一批改了什么

1. `apps/desktop/src/renderer/derived/stream.ts`：`summarize(args)` → `summarize(tool, args)`，先按工具挑主语
   （spawn→task、send→message、wait/cancel→「N 个子任务」/「本会话全部子任务」、list→「本会话全部子任务」、
   resume/close→thread_id、clarify→第一个问题＋共 N 问），挑不到才回通用链/JSON 兜底。
2. `apps/desktop/src/renderer/derived/timeline.ts`：时间线标签同源改调。
3. `apps/desktop/src/renderer/components/Stream.tsx`：`TOOL_VERBS` 补六个子任务动词（发消息/等待/撤销/列出/恢复/关闭）。
4. `apps/desktop/tests/tool-row-summary.test.ts`：+7 条（编排族六格 + clarify 两格 + 兜底一格 + 行面 SSR）。
5. `apps/desktop/design/desktop-design-spec.md`：补第 42 条。

## 读数（工作树，未提交）

| 工具 | 改前 | 改后 |
|---|---|---|
| `spawn_agent {task, mode}` | `{"task":"把 a.ts 的 XX 改掉并跑测试","mode":"write"}` | `把 a.ts 的 XX 改掉并跑测试` |
| `send_agent {thread_id, message}` | `{"thread_id":"th-1","message":"再看一下 b.ts"}` | `再看一下 b.ts` |
| `wait_for_agents {agent_ids:["a1","a2"]}` | `{"agent_ids":["a1","a2"]}` | `2 个子任务` |
| `wait_for_agents {}` / `cancel_agents {}` / `list_agents {}` | `{}` | `本会话全部子任务` |
| `resume_agent {thread_id}` | `{"thread_id":"th-1"}` | `th-1` |
| `clarify {questions:[…]}` | `{"questions":[{"question":"要 A 还是 B？",…}]}` | `要 A 还是 B？` |

| 判卷面 | 读数 |
|---|---|
| `tool-row-summary.test.ts` | 关掉 ownSubject 复现 **6 红 / 8 绿** → **14/14 绿** |
| 行面 SSR | `派发子任务 把 a.ts 的 XX 改掉` / `等待 2 个子任务`；HTML 不含 `&quot;task&quot;` |
| 桌面套件 | **298 文件 / 2010 条全绿**，exit 0（含 boundary 绿） |
| 根 typecheck / 桌面 tsc | 0 报错 / 0 报错 |

## 文件

- `before-summary.log` / `after-summary.log`：`.tmp/probe-orchestration.mts` 对八个真值的前后输出（改前那份是把
  `ownSubject` 关掉复现的第 916 页行为）。
- `red-green.log`：ownSubject 关闭 ⇒ 6 条红；复原后 30 条绿（新判 14 + stream-rework 16）。
- `desktop.log`：桌面套件 + boundary 的同树实跑。
- `typecheck.log`：根与桌面 tsc。
- `scoped.patch`：本批五个文件的差量（相对第 916 页交付时的内容）。
- `docs-check.log`：台账门在补页之后的读数。

## 边界

- 只做了七个工具的主语；`remember` / `skill` / `automation_*` / `mcp_*` 仍是 JSON 兜底或原名。
- 「N 个子任务」是数量口径，不列 id；id 在展开区的原始参数里。
- `list_agents` 的空参数行写「本会话全部子任务」——工具规格里缺省即全部，不是猜。

## 复现

```sh
cd apps/desktop
npx vitest run tests/tool-row-summary.test.ts tests/stream-rework.test.tsx --config vitest.config.ts
pnpm test
cd ../..
node --import tsx scripts/typecheck.ts
```
