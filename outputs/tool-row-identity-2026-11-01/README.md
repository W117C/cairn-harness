# 工具行折叠态 · 2026-11-01

检查起点与交付面都是共享工作树，HEAD `be9c0be5`；本批改动未提交，未跑 `head-cert-check` / `mutate-verify`
（两者量的是 HEAD）。

## 这一批改了什么

1. `apps/desktop/tests/stream-rework.test.tsx`：旧断言 `toContain("run_shell")` 与 2026-10-31 R1 起的
   「有中文动词的行不显示实现名」相反；改钉两面——已知工具的实现名不出现、未知工具（`mystery_tool`）保留原名。
2. `apps/desktop/src/renderer/components/Stream.tsx`：`TOOL_VERBS` 补六把静态工具（grep/glob/lsp/clarify/
   propose_plan/render_image）与 verify；撤掉陈旧键 `list_dir`（工具已由 glob 取代）及它的字形分支。
3. `apps/desktop/src/renderer/derived/stream.ts`：`summarize` 的取值链把 `pattern` 插到 `path` 之前。
4. 新增 `apps/desktop/tests/tool-row-summary.test.ts`（7 条）：词表与工具面读同一份事实源
   （`TOOL_NAMES` + `INJECTED_TOOLS`），不在测试里另抄一张。
5. `apps/desktop/design/desktop-design-spec.md`：补第 40/41 条（名字口径、摘要求值链）。

## 读数（工作树，未提交）

| 面 | 改前 | 改后 |
|---|---|---|
| `tests/stream-rework.test.tsx` | 1 红（`toContain("run_shell")`） | **16/16 绿** |
| `tests/tool-row-summary.test.ts`（新） | **4 红 / 3 绿** | **7/7 绿** |
| `summarize({pattern:"TODO", path:"src/agent"})` | `"src/agent"`（搜什么没了） | `"TODO"` |
| `summarize({pattern:"src/**/*.ts"})` | `"{\"pattern\":\"src/**/*.ts\"}"`（整行 JSON） | `"src/**/*.ts"` |
| 桌面全量 | — | **298 文件 / 2003 条全绿，exit 0**（含 boundary） |
| 根 typecheck / 桌面 tsc | — | 0 报错 / 0 报错 |

## 文件

- `before-summary.log` / `after-summary.log`：`summarize` 五个真值的前后输出（一次性探针直接调
  `derived/stream.ts` 的 `summarize`，不是另抄的样例；常驻判据见 `tests/tool-row-summary.test.ts`）。
- `before-judge.log` / `after-judge.log`：新判卷在改前（4 红）与改后（7 绿 + stream-rework 16 绿）的原文。
- `desktop-clean.log`：桌面套件与 boundary 的同树实跑。
- `typecheck.log`：根与桌面 tsc。
- `scoped.patch`：本批五个文件的差量（相对本批开始时的内容）。
- `docs-check.log`：台账门在补页之后的读数。

## 边界

- 运行期注入的 20 个工具名（`wait_for_agents` / `automation_*` / `mcp_*` 等）还没有动词，仍以原名上屏；
  本批判据只覆盖静态工具面 `TOOL_NAMES`。
- `summarize` 仍不认识 lsp 的 `operation`、clarify 的 `questions`、子代理的 `ids` 等字段，那几行仍落 JSON 兜底。

## 复现

```sh
cd apps/desktop
npx vitest run tests/tool-row-summary.test.ts tests/stream-rework.test.tsx --config vitest.config.ts
pnpm test
cd ../..
node --import tsx scripts/typecheck.ts
```
