# HEAD 整表门禁读数（隔离 worktree 实跑，2026-09-20）

> 快照，不是"全部通过"。事实源 = 这次跑的输出，不是本文件；条数以 `scripts/gate-manifest.ts` 为准。

## 0. 这一跑证明的是**通道**，不只是结果

此前「整表验证」被一条铁律挂起：**绝不在另一个会话的写入窗口内、于主树跑会改源文件的门**
（`mutate-verify` 逐条往源码里植变异再回滚，主树有别人的在飞文件时等于改他们的代码）。
挂起 = 挂到对方收口为止，挂了几轮之后它就变成"没人跑过"。

现在的通道：`git worktree add <tmp> <head> --detach` + symlink 主树 `node_modules`
+ **`pnpm gates --direct`**（换执行器：`/bin/sh -c <package.json 脚本正文>`，绕开 pnpm 11 对
"node_modules 解析目标不在项目根内"的 `ERR_PNPM_UNSAFE_MODULES_DIR` 拒绝）。门清单与命令正文
一个字都没改，只换执行器。

**本次实跑**：`/tmp/dsh-head` @ `27ff34d`，32 道全跑，含 `mutate-verify` **296 条锚点全杀 exit=0（491056ms ≈ 8.2 分钟）**。

跑完后 `git -C /tmp/dsh-head status --short` 为空 ⇒ `mutate-verify` 的「植变异必回滚」不变量当场得证。
当前 HEAD `9091480` 比上表多 2 条锚点（`spent-usd-price-drift-as-free`、`spent-usd-infinite-passes`），
在同一 worktree `checkout --detach 9091480` 后单跑：**两条全杀**（"全部变异被正确杀死（断言非恒真）"）。
⇒ 整表 = 296 @ `27ff34d` + 新增 2 @ `9091480`，合计 298 条在当前 HEAD 上都有实跑证据。

## 1. 逐道退出码（原样照抄汇总行）

```
typecheck=0 test=1 e2e=1 ipc:check=1 ipc-reachability-check=0 sandbox:check=0 build=0 fork-check=0
gate-check=1 docs-check=0 autonomy-check=0 compaction-check=0 panels-check=0 tools-check=0 map-check=0
prune-check=0 providers-check=0 provider:check=0 memory-check=0 plugins-check=0 sidechat-check=0
security-check=0 agents-check=0 schedule-check=0 commercial-check=0 gym-check=0 routing-check=0
supervisor-check=0 renderer-arch-check=0 a11y-check=0 mutate-verify=0 mutate-needles-check=0
```

绿 28 / 32，红 4。耗时量级：`mutate-verify` 491s ≫ `panels-check` 130s > `test` 54.9s >
`agents-check` 14.1s > `plugins-check` 13.6s > `tools-check` 8.2s > `supervisor-check` 6.1s，
`typecheck` 2.4s，其余在 1s 级以下。

## 2. 四条红的归因（**全部是 worktree 形状，不是 HEAD 缺陷**）

同一个根因：**fixtures 靶子在 worktree 里没有自己的 `node_modules`**（symlink 只覆盖仓根的
`node_modules`，`fixtures/todo-app` 的依赖在 .gitignore 里、不随 worktree 生成）。

| 红门 | worktree 表现 | 主树复验（HEAD `9091480`，即上表之后两笔） |
|------|--------------|-------------------------------------------|
| `test` | 1267 passed / **2 failed**（`gated-tools`、`runner-gates`） | `node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts tests/gated-tools.test.ts tests/runner-gates.test.ts` → **2 files / 4 tests passed** |
| `e2e` | 1.569s 即红（起不来靶子依赖，没跑完闭环） | 主树 exit=0：`[e2e] 全部断言通过，闭环成立` |
| `ipc:check` | 1.625s 即红（同上） | 主树 exit=0：`全部断言通过（分支 A 靶子修复）` |
| `gate-check` | `verify 第 1 次即通过` 处 `TypeError: Cannot read properties of undefined`（事件序列里没有 `verify_result`，因靶子测试跑不了） | 主树 exit=0：`[gate-check] 全部断言通过` |

⇒ 判读规矩：**这四条在 worktree 里红是预期值，不许据此改代码**；整表跑完后必须在主树逐条复验，
归因写"worktree 形状 + 主树复验绿"才允许算闭合。反过来，若某条**在主树也红**，那就不是形状问题。

## 3. 未证 12 项（不等于通过）

汇总行原文：`⚠️ 未证 12 项（连网/凭据限制未跑到的断言——**不等于通过**）`。
成因同前：`M0_API_KEY` 不在场 ⇒ provider 真连、各 check 的暗卷段、testdino 远程 MCP 跑不到。
`DSH_STRICT_UNVERIFIED=1` / `--strict-unverified` 可把这 12 项直接判红。

## 4. 体检命中 1 条（已立案，非本轮新伤）

```
❌ commercial-check.ts:152 [empty-assert] check(true, "D2e 引导向导在产品里可达（消费者：" + …)
```

`check(true, …)` 是**字面恒真**——这条断言永远不会红，因此"引导向导可达"从未被证明过。
任务清单 #15 挂着（补 vanilla 版 vs 按裁决归档），属产品裁决面，本轮不动判据。

## 5. 复现命令

```sh
git worktree add /tmp/dsh-head 27ff34d --detach
ln -s "<主树绝对路径>/node_modules" /tmp/dsh-head/node_modules
cd /tmp/dsh-head && pnpm gates --direct          # 或 DSH_GATE_DIRECT=1
git worktree remove --force /tmp/dsh-head        # 跑完清掉
```

symlink 的 `node_modules` **只读用途**：不要在里面装包。需要 `out/` 产物或 Electron 的门
（`build` / `panels-check` / `renderer-arch-check` / `a11y-check`）本次在 worktree 里也是绿的
——它们各自会现场构建，不依赖主树的 `out/`。
