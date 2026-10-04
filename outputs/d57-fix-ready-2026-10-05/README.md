# #57 写入端：**已于 2026-10-05 落地**（本目录保留为可复核的备档）

> 备妥时 `src/main/agent-runner.ts` 正被另一会话持有；备妥后约 10 分钟它被提交、文件让出，
> 于是同一天按 `apply.mjs` 的前置门落地。本目录不再是"待落"，是这一笔的**取证面**：
> 补丁原文、判卷片段、落地门、以及"备妥阶段验到什么程度"的如实记录。
> 落地读数：写入面判卷 2/2 ＋ 读侧面 6/6 ＋ 权限面回归 **91/91**；typecheck tracked 面 0 报错。

## 这一笔要闭的是什么

`<workspace>/.agent/permissions.json` 在本仓是**有意跟踪**的（策展过的项目策略，该随仓库走）。
但「用户在审批卡上点一次总是允许」→ `persistAlwaysRule` 把一条 allow 写进**同一个文件**
⇒ **授权记录随仓库分发：谁 clone，谁就继承那一次授权**。

## 已经落地的另一半（别重复做）

`src/permissions/rules.ts`（第 15596331 笔）已经落：
- `ALWAYS_RULES_FILE = "permissions.always.json"` 与 `alwaysRulesPath(workspace)`；
- `loadPermissionRules` **透明并入**同目录那一份（同为 project 层）；
- `.gitignore` 已排除 `.agent/permissions.always.json`。

⇒ 所以**读侧已经通了**，只差写入端改一行。落地后批准过的「总是允许」照样生效。

## 本目录四件

| 文件 | 作用 |
|---|---|
| `agent-runner.patch` | 写入端补丁：import 加 `alwaysRulesPath`，`persistAlwaysRule` 换落点 |
| `judge-fragment.test.ts` | 写入面判据（落地时放到 `tests/d57-write-face.test.ts`） |
| `apply.mjs` | 落地门：**先验目标文件不在飞**，才许 apply；再跑 typecheck ＋ 两处判卷 |
| `README.md` | 本页 |

## 落地步骤

```sh
node outputs/d57-fix-ready-2026-10-05/apply.mjs            # 只读前置检查
node outputs/d57-fix-ready-2026-10-05/apply.mjs --apply    # 真落 + 验证
# 然后：git add src/main/agent-runner.ts tests/d57-write-face.test.ts && git commit
```

## 备妥时已验到什么程度（照实说）

- 补丁 `git apply --check` 对当时的工作树**贴得上**；
- 在隔离树（`.worktrees/verify-57prep-15596331`）里**真落地并跑过**：权限面六支判卷 **120/120 绿**（含 S2 路径面、worker 项目规则、auto-verify 接线）⇒ 换落点**零回归**；
- 写入面判据在隔离树里通过，并**反向验证**过：把落点改回受跟踪那份 ⇒ 当场红；
- **没验到**：没有驱动一次真实审批流去看它写哪个文件（`persistAlwaysRule` 不在导出面上）。
  所以写入面是「源码形状 + 零回归」两条证据，不是端到端。落地后若想补端到端，
  在审批路径上加一条真跑用例即可。
