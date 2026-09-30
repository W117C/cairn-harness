# 交接：`port2` 分支待合并（14 笔）

**给正在 `zcode` 上开发的会话** —— 这是一个并行会话（DSH 优化轮）攒下的一批改动，
已全部落地、验证、并在写这份说明时**实测能零冲突并入**。

- **分支**：`port2`
- **基点**：`6022571`（我挑改动时的 `zcode`；写说明时 `zcode` 已到 `bd5ec44`）
- **提交数**：14
- **合并冲突**：**0**（在 `bd5ec44` 上实测两次，`git merge --no-commit` 干净）

---

## 一、你要做的（三条命令）

```sh
cd "/Users/ze/Downloads/deepseek harness"      # 主树，当前在 zcode
git merge port2                                 # 预期：0 冲突
node --import tsx scripts/typecheck.ts          # 预期：0 报错
node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts   # 预期：260 文件 / 3397 条全绿
```

**分支上的实测读数**（我在 `port2` 上跑过的，合并后应当一致或更好）：

| 项 | 读数 |
|---|---|
| typecheck | 0 报错 |
| 全量判卷 | **260 文件 / 3397 条全绿**，178.4s |
| 门禁（子集） | gate-check / docs-check / tools-check / security-check 4/4 绿，零命中，清单漂移校验通过 |
| 真模型 bench | 3/3 达标（`pnpm bench`） |

**回滚**：`git merge --abort`（若已在解决冲突中）或 `git reset --hard <合并前的 sha>`。
合并前建议先 `git rev-parse HEAD` 记一下。

---

## 二、这 14 笔里最要紧的四处（都是「任务直接做不成」级）

### 1. 方案门在 `--mode auto` 下锁死任务 ← **最要紧**

`promptForPlan` 在 `!ask`（管道/CI）时**不看档位**，无条件 `decidePlan(false)`。
于是 auto 这条显式授权的路上：模型提方案 → 当场被拒 → 写禁不解除 → 连读工具都进不去。

**实测**（12 个独立 bug 的长任务靶子，`--mode auto`）：

| | 写操作 | 轮数 | 结果 | 退出码 | 耗时 |
|---|---|---|---|---|---|
| 修复前 | **0 次** | 9 | **12 个 bug 一个没修** | 1 | 51s |
| 修复后 | **12 次** | 14 | **12/12 全修 + verify 通过** | 0 | **35s** |

判据抽成纯函数 `planDecisionFor({mode, ask})`；三档穷举（auto→批准 / 交互→问人 / 管道非 auto→拒绝）。

### 2. 退出码把失败报成成功

此前只有 `error` 事件与 verify 红会置 1 ⇒ **写盘被门拒掉时退出码仍是 0**。
实测：`--mode default` 在管道里写盘被拒、工作区一字未动、退出码 0、台词还说「任务完成」。
改成纯函数 `runFailed(五个计数器)`，全取自媒体流；会话末沉淀轮（`X-` 层）按前缀排除。

### 3. 流内 5xx 打死整轮任务

对端把 5xx **塞进 SSE 体**（HTTP 200 + error 帧）时，`establishStream` 管不着 ⇒ 整轮任务死。
实测连续 7 次跑全挂。加流内重试，**安全边界：吐过输出就不重放**（重放会把同一轮吐两遍）。
线上证据：`pnpm bench` 三轮里三条任务全部撞 502 并重试，**最终 3/3 全过**。

### 4. 验证环节假红（`verify` 跑错 runner）

harness 把靶子的 `pnpm test` **无条件**换成自己的 vitest ⇒ 项目自己 3/3 全过、verify 报红，
且事件里报的是原始命令 ⇒ 模型无法归因。改成按该工作区**自己声明的** `scripts.test` 判。

---

## 三、其余 10 笔（省 token / 可观测性）

| 笔 | 内容 | 读数 |
|---|---|---|
| P1 | 三把「能力没开却挂说明书」的工具摘掉（refine_goal/remember/lsp） | 固定开销 2286 → 1746 tok/轮 |
| P3 | 子代理三件套做成开关（`settings.subagentTools`，缺省开） | 关掉省 **857 tok/轮**（两次实测逐字一致） |
| P3 | 输出预留跟着窗口缩 | 修掉「小窗口模型开箱即坏」（12k 窗口从 exit=1 崩 → exit=0 全修） |
| P2 | 沉淀轮与主会话同前缀 | 缓存命中 2.2% → **98.8%**，占整场有效代价 27.4% → 5.8% |
| P2 | 沉淀指令送不到模型（真 provider 只认事件日志） | 修后模型只回「无」（输出 152 → **2** tok） |
| P4 | 度量台 `pnpm bench` + `pnpm prompt-cost` | 成功率/token/耗时/CPU/内存 五读数 |

---

## 四、新增的文件（合并后你会看到）

**新脚本**：`scripts/prompt-cost.ts`（每轮固定开销的尺）、`scripts/session-cost.ts`（会话有效代价的尺）、
`scripts/loop-eval.ts`（已有文件，加了资源采样与凭据回退）。

**新测试**（+41 条）：`tests/cli-plan-auto.test.ts`、`tests/cli-exit-code.test.ts`、
`tests/optional-tool-surface.test.ts`、`tests/session-cost.test.ts` 等。

**新夹具**：`fixtures/bench/**`（3 条自包含基准任务，`node --test` 判卷、不联网、不需要装依赖）。

**新 package.json scripts**：`pnpm bench`、`pnpm prompt-cost`。

---

## 五、合并时若真出现冲突（预期不会有）

我实测过**两次都是 0 冲突**。真出现的话，按这个优先级解：

1. **`README.md`** —— 若冲突，**取 `zcode` 那一侧**。我改过的 README 内容是搬来的旧快照，
   而你那边已经把它修得更准了；我的度量台段落可以事后单独补。
2. **`src/agent/glm-session.ts`** —— 若冲突，很可能是**两侧都是新增**
   （你加 `readOnlyDescriptions`，我加 `OPTIONAL_TOOL_NAMES`）⇒ **两个都留**，不是二选一。
3. 其余文件理论上不会冲突。

---

## 六、诚实标注：这条分支的已知局限

- **成功率没有提升的证据**。单次跑的方差比改动幅度大：有一轮 4 次 A/B 对照，开关两个方向
  各有一次成败。**本分支只声称「没有退化」，不声称「变好了」**——要说得有 8~10 次重复。
- **P1 那句「≤1300 tok 且能力无损」不成立**。1135 是**关掉可选能力**时的数；全挂着是 2286。
  实测后确认剩下 12 把工具每把都真需要，再降只能砍能力或砍描述质量 ⇒ 没硬凑这个数。
- **`pnpm bench` 的 3 条任务只够冒烟**，不够当趋势。要判改动效果用 `--reps 3` 以上。

---

## 七、不要做的事

- **不要**把 `README.md` 的旧快照当基线往回改（见第五节第 1 条）。
- **不要**为了省 token 去摘 `verify` / `propose_plan`——它们是所有档位的必需件，
  只有 `refine_goal` / `remember` / `lsp` / 子代理三件套 是可选的（判据见 `OPTIONAL_TOOL_NAMES`）。
- **不要**在 `installAppTools` 上按「每场 run」的实时状态算开关：执行面进程级只装一次，
  规格面每场重算 ⇒ 会分家（模型看得见却调不到）。这条我在实现里踩过，改成了「只累积不回退」。

---

*本说明由并行会话（`opt/agent-v2` → `port2`）生成。原始 14 笔的完整提交信息里有每处的
实测对照与判据，需要细节直接 `git log port2`。*
