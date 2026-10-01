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

## 增量（commit 2 · 本目录下半部分证据）：worker diff 的逐文件接受/拒绝

**一句话**：跑完后在交互终端里对每个 write worker 的 diff **逐文件审阅**（`a` 全合并 / `r` 全拒绝 /
`1,3` 或 `1、3` 编号子集 / 回车跳过）；子集＝先把被拒文件在 worktree 里还原再发 merge 卡；
**顺带修掉一个实测断口**——diff 收据的整块渲染判定在主干路径上**从未匹配到**（见下）。

### 交付（增量）

| 文件 | 动作 | 说明 |
|---|---|---|
| `src/agent/diff-review.ts` | 新 | 纯逻辑 + 真 git 还原：`isWorkerDiffReceipt`（`[diff] v` 头 / `diff-` 老兜底两支）、`reviewCandidates`（write∧done∧未决）、`parseSelection`（回车跳过 / a / r / 编号列表；非法给 error 不静默全收）、`parsePorcelainZ`（-z 解析，改名条目新前源后）、`revertPlan` / `applyReverts`（新增⇒删、改删⇒checkout、改名⇒manual；路径包含性检查）、`patchSectionOf` |
| `src/cli.ts` | 改 | `reviewWorkerDiffs` 流程（TTY 才弹；还原失败/需人工时**不发合并卡**——拒绝的绝不混进合并；跳过/非交互打"现场 + 手工命令"）；`renderEvent` 的 diff 判定改为 `isWorkerDiffReceipt` |
| `src/agent/fork-cli.ts` | 改 | `formatReplay` 同一判定；diff 摘要从 `## patch` 段解析 |
| `tests/diff-review.test.ts` | 新 | 14 条：判定（含生产端源头棘轮）/候选/选择/porcelain/还原计划 + **真 git 夹具**（被拒改回原样、新档删掉、被接受保留、越界拒执行） |
| `tests/cli-surface.test.ts` | 改 | diff 夹具**同步成真形状**（spawn callId + `[diff] v` 头，老兜底形状留证人）——旧夹具喂老形状所以一直绿，见下 |

### 实测断口（本增量修）

第 245 页起收据 callId 走 **spawnCallId**（回执合并语义；`orchestrator-hold` 有判卷钉着），
而 cli/fork-cli 的判定还写着 `callId.startsWith("diff-")` ⇒ **主干路径上"diff 整块打出来"从未生效**
（一直被压成首行；`cli-surface` 的夹具当年喂的是老形状，所以测试一直绿——判卷与被测现实分家）。
修法：按生产端有意埋的 `[diff] v` 头判定（老兜底支保留）；`diff-review.test.ts` 里配跨文件棘轮
（orchestrator 源码仍在写 `[diff] v`），两侧标记再分家会当场红。

### 增量证据

| 证据 | 文件 | 读数 |
|---|---|---|
| 判卷（含真 git 夹具） | `tests/diff-review.test.ts` | 14 条全绿；夹具在 tmp 仓库真跑 `git checkout --` / `rm` |
| 反向验证（还原分类 mutant） | `reverse-verify-review-flip.log` | 把「新增⇒删文件」错分成「checkout」⇒ **2 条红**（计划单测 + 真 git 夹具），exit=1 |
| 复原 | `reverse-verify-review-hash-{before,after}.txt` + `reverse-verify-review-restored.log` | sha256 `c3fa6c9…` 逐字节同 ⇒ 14 绿 exit=0 |
| 全量判卷 | `full-suite.log` | `Test Files 270 passed (270)｜Tests 3628 passed (3628)｜exit=0`（较 M8 主笔 3613 ⇒ 只增不减，+15＝本增量 14 条＋过渡版 1 条） |
| typecheck | `typecheck-inc.log` | ✅ `tsc --noEmit 通过（0 条报错）` |

### 实测踩坑（值得留档）

**用例标题是留档 json 的重数键**：本增量把 `cli-surface` 里一条 `it` 标题润色后，全量判卷在
`head-cert-deps` 的「真机整表」红了一条——它按**标题**在现源码里重找成因，而留档
`outputs/judge-timeout-2026-10-01/suite-quiet.json`（已入库的判定输入）里存的是旧标题 ⇒
`notResolved` 0→1。处置：标题**逐字恢复**（准确的新描述放进块注释），并把「改名要同时重产那份
留档 json」的警告写进该测试块头。教训与 `cfa91e1`/M2 探针同族：**判定输入的键漂了，红的是覆盖它的每一笔**。

### 增量边界（如实记）

1. **未做真 TTY 的端到端**：交互流在 `cli.ts`（提问/打印），决策逻辑全在可离线判卷的 helpers 里；
   合并/拒绝动作本身由既有 `m3c`/orchestrator 判卷覆盖（本增量不碰 orchestrator 一行）。
2. **改名/复制条目不自动还原**（标 `manual` 且**不发合并卡**，提示人工两步操作）——不猜语义。
3. **合并塔随进程退出失效**：跳过/非交互时把 worktree 与分支与手工命令打出来（"保留了"必须可执行）。
4. 全拒 ⇒ `reject` 卡（worktree 清理，未提交改动一并消失，prompt 已明写）；本次不提供"留分支"开关。

## 开放项

1. ~~**diff 审查增强（逐文件接受/拒绝）未随本笔交付**~~ → **已交付**（本目录"增量"一节；同笔提交）。
2. ~~**硬杀（SIGKILL）半写尾行的边界**~~ → **已收口（2026-10-01 晚，`outputs/hold-closeout-2026-10-01/`）**：
   `src/events` 的 `repairPartialTail` 在新开句柄时裁掉半写尾段并响亮告警（只修尾部、不动中间坏行），
   判卷 `tests/events-tail-repair.test.ts` + 反向验证闭环。原先记的"append 会与其拼成一条坏行、
   事件不可见"正是修复要治的那一格。
3. `--fork` 与 `--goal` 可同时给（目标写在**新会话**上）——这是有意允许，但判卷里没有专门用例钉它。
4. 合并由集成 owner/业主执行；本笔只提交到工作分支，一笔一事。
