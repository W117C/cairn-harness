# M8 台账 · 人机协作：fork / replay（2026-10-01，qoder 会话）

**一句话**：`m0 --fork <会话> --from <轮次>` 与 `m0 --replay <会话>` 两扇入口落地（事件溯源本来就支持分叉，
缺的一直是**入口**）；13 条判卷（纯函数 + 真跑 bin 的离线 e2e）；反向验证（id 复用 mutant → 3 红）；
顺带修掉一个实测出来的真缺陷——**`--replay` 被 provider key 解析拦下**（没配 key 就连只读回放都跑不了）。

## 交付

| 文件 | 动作 | 说明 |
|---|---|---|
| `src/agent/fork-cli.ts` | 新 | 纯逻辑层：`forkPointOf`（轮次→分叉事件点，轮以 user_message 为界）、`forkSessionName`、`formatReplay`（决策链渲染：gate 判定/验证 cause/审批对/worker diff 压形状行/未知类型不静默丢）、`firstLine`/`argsDigest`（从 cli.ts 移入，避免第二份） |
| `src/cli.ts` | 改 | `--fork <id> --from <n>`：读源日志→算分叉点→`forkSession` 写 scrub 目录→rename 成 `<id>-f<n>.jsonl`→会话 id 换新；`--replay <id>`：只读打决策链后退出；help/用法闸（互斥与边界逐条点名）；**provider 解析推迟到 replay 分支之后**（见下） |
| `tests/cli-fork-replay.test.ts` | 新 | 13 条：分叉点算术（含末轮被中断/越界/空会话）、渲染（delta 合并/diff 形状行/未知类型）、e2e（replay 只读 sha 不变；fork 前缀**逐字节**一致 + `session_meta.branch_of` + 源 sha 不变 + 续跑；用法闸；SIGINT 收束后继续追加且可重放） |

## 实测发现并修掉的缺陷（本笔自曝）

**`--replay` 曾被 provider key 解析拦死**（首轮 e2e 跑出 exit 2 报「没有配置任何 provider 的 API key」）——
回放是**纯只读**、根本不碰 provider，却被一把它不需要的钥匙挡在门外（"读路径被无关闸门挡住"形状）。
修法：三个 provider 原始 flag 只收不解析，解析推迟到 `main()` 的 replay 分支之后；`--compact` 与目标轮
照旧在起跑前解析（它们真要主模型）。证据：`replay-no-key.log`（四个 key 全删、`--replay` exit=0 且 gate 判定可读）。

## 验收对照（PLAN §M8）

| 计划书验收 | 证据 |
|---|---|
| fork 出的会话事件流可独立重放、原会话不受影响（贴两份日志对比） | e2e：新日志前 `lastIncluded` 行与源日志**逐字节相同** + `session_meta.branch_of` 指向源 + 源 sha256 前后不变（`reverse-verify-restored.log` 内） |
| 中断（Ctrl-C）后事件流完整可续 | SIGINT e2e：收束后 `replay` 可读，续跑追加的 `user_message("接着来")` 在重放里读得到 |
| 全量判卷绿 | `full-suite.log` | `Test Files 269 passed (269)｜Tests 3613 passed (3613)｜exit=0`（基线 3563 ⇒ 只增不减） |
| 反向验证：fork 的新会话 id 改成复用原 id → 判卷红 | `reverse-verify-id-reuse-flip.log`：**3 条红**（命名单测 + 两条 fork e2e），exit=1；复原 sha256 `a2d95a6…` 逐字节同 ⇒ 13 绿（`reverse-verify-restored.log`） |

## 开放项

1. **diff 审查增强（逐文件接受/拒绝）未随本笔交付**。已侦查清底：合并出口在核心里是有的
   （`handleCardAction` 的 diff 卡协议 → `mergeWorker`/`rejectWorker`），且 worker 改动在 merge 前
   **未提交地留在 worktree**（`commitAndMerge` 才 `git add -A && commit`）⇒ 逐文件拒绝可落为
   "先把被拒文件在 worktree 里 `git checkout --` 还原，再走 merge 卡"。这是一笔独立的增量
   （cli.ts 交互 + 真 git 夹具判卷），不在本笔塞进来。
2. **硬杀（SIGKILL）半写尾行的边界**：`createEventLog.append` 是"整行+换行一次写"，`replay` 对**尾部**
   坏行降级容错（本笔 SIGINT e2e 覆盖的是优雅路径）；但**硬杀**在 write 半途留下的半行，其后的
   append 会与其拼成一条坏行（事件不可见）——这是 `src/events` 的既有行为、不在本模块写范围，
   如实记为边界（判卷文件头也写了这句）。要不要加"续跑前把尾部半行裁掉"的 WAL 恢复，属 events 层裁决。
3. `--fork` 与 `--goal` 可同时给（目标写在**新会话**上）——这是有意允许，但判卷里没有专门用例钉它。
4. 合并由集成 owner/业主执行；本笔只提交到工作分支，一笔一事。
