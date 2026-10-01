### 2026-10-01 · M8 · 人机协作：`--fork` / `--replay` 两扇入口落地（13 条判卷 + 反向验证 3 红闭环）；顺带修掉「只读回放被 provider key 拦死」

取料面（全名逐支）：`outputs/m8-fork-replay-2026-10-01/` 下 `LEDGER.md`、`replay-no-key.log`、`reverse-verify-fork-hash-{before,after}.txt`、`reverse-verify-id-reuse-flip.log`、`reverse-verify-restored.log`、`full-suite.log`。

1. **交付**：`src/agent/fork-cli.ts`（纯逻辑：轮次→分叉点、命名、决策链渲染；`firstLine/argsDigest` 自 cli.ts 移入，不留第二份）+ `src/cli.ts` 接线（`--fork <id> --from <n>` / `--replay <id>` + 用法闸 + help）+ `tests/cli-fork-replay.test.ts`（13 条）。
2. **`--from N` 的口径写死并进 help**：**保留前 N 轮（含）**，新任务作为第 N+1 轮跑在**新会话 `<id>-f<N>`** 上；「轮」以 `user_message` 为界。末轮被中断（轮内半截）也按边界算；越界/非正整数/空会话/目标已存在各自点名拒绝（不覆盖既有转录）。
3. **e2e 读数（离线 demo 通道）**：新日志前 `lastIncluded` 行与源日志**逐字节相同** + 追加 `session_meta.branch_of` + 源会话 sha256 前后不变；继续在分叉会话上跑第三轮，源会话仍逐字节不变；`--replay` 只读（sha 不变）且 gate 判定（`[auto-approved·L3-rule]`）可读。
4. **实测发现并修掉的真缺陷（本笔自曝）**：首轮 e2e 里 `--replay` 在无 key 环境 **exit 2**——provider key 解析在 parseArgs 里先行，"看一条已有会话的决策链"被一把它不需要的钥匙拦下（读路径被无关闸门挡住）。修法：provider 三 flag 只收不解析，解析推迟到 `main()` 的 replay 分支之后；`--compact`/目标轮照旧起跑前解析。证据 `replay-no-key.log`（四 key 全删仍 exit 0）。
5. **反向验证（PLAN §M8 要求）**：`forkSessionName` 改成复用原 id ⇒ **3 条红**（命名单测 + 两条 fork e2e），exit=1；复原 sha256 `a2d95a6…` 逐字节同 ⇒ 13 绿。
6. **中断可续**：SIGINT 收束后 `replay` 可读、续跑追加的 `user_message` 在重放里读得到（确定性 e2e）。**边界**：硬杀（SIGKILL）write 半途的半写尾行——**当日晚已收口**（`src/events` 的 `repairPartialTail` 在新开句柄时裁剪 + 响亮告警；判卷 `tests/events-tail-repair.test.ts`，证据 `outputs/hold-closeout-2026-10-01/`）。
7. **未随本笔交付**：**diff 审查增强（逐文件接受/拒绝）**。底已摸清（合并出口＝`handleCardAction` 的 diff 卡协议；worker 改动 merge 前未提交地留在 worktree ⇒ 逐文件拒绝＝先在 worktree 还原再走 merge 卡），是一笔独立增量（cli.ts 交互 + 真 git 夹具判卷），见 LEDGER 开放项 1。
8. **判卷/门/typecheck**：全量判卷 `Test Files 269 passed (269)｜Tests 3613 passed (3613)｜exit=0`（基线 3563 ⇒ 只增不减）；typecheck 0 报错（`pnpm typecheck`）；快门面 20 道与证据面两道（`evidence-typecheck-check`/`docs-check`）见 `../m9-ci-2026-10-01/`。
