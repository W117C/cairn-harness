# m0 — 可重放的 agent harness

一个事件溯源（event-sourced）的 agent 内核：每一步都落成 JSONL 事件，因此**同一份日志可以被重放、分叉、审计**。
没有 UI、没有 Electron、没有构建步骤——克隆下来 `npm install` 完就有一条 `m0` 命令。

```sh
git clone <this-repo> && cd m0-agent-loop
npm install                       # CLI 走 tsx 通道（devDependency），必须装齐才能跑
export OPENAI_API_KEY=<你的 key>
./bin/m0.mjs "把 tests 里失败的那个用例修好"
```

> 本包是 `"private": true`，**不经 npm 分发**：没有 `npm install -g m0` 这条路。上面是克隆仓库后的用法——
> tsx 在 devDependencies 里，源码经 tsx 通道直接跑。

---

## 快速开始

需要 Node 20.3+（`AbortSignal.any` 的下限，`package.json` 的 `engines` 已声明）与 pnpm。仓库根目录：

```sh
pnpm install
pnpm typecheck        # tsc --noEmit
pnpm test             # 整跑（core-only 全部测试文件）
```

### 量一量：固定开销与任务达成

两个尺子，各自回答一个不同的问题：

```sh
pnpm prompt-cost      # 每轮固定开销（工具说明书 + 系统提示词），零花费、秒级
pnpm bench            # 拿真模型跑一套固定任务，出「成功率 / token / 耗时」三读数
```

`pnpm bench` 用的是**主 CLI 同一套凭据**：`OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL`，
或 `M0_API_KEY` / `M0_ENDPOINT` / `M0_MODEL`（前者优先）。凭据一律走环境变量，不落文件——
和主 CLI 同一条规矩：

```sh
export OPENAI_BASE_URL=https://openrouter.ai/api/v1
export OPENAI_API_KEY=<你的 key>
export OPENAI_MODEL=<模型名>
pnpm bench
```

任务集在 `fixtures/bench/tasks.json`。想量化一次改动的效果，就跑它前后各一次——
**别拿单次数字当趋势**，模型自身的方差比改动幅度大是常事：

```sh
# 多跑几轮看分布（reps 越大越可信，代价线性增长）
pnpm bench -- --reps 3

# 只跑其中几条（改完某个子系统时先冒烟）
pnpm bench -- --only B1-bugfix-crossfile
```

读数落在 `outputs/bench/readings.json`。

跑一轮：

```sh
# 在当前工作区
./bin/m0.mjs "你的任务"

# 在别的工作区
./bin/m0.mjs --workspace ~/code/some-repo "把失败的测试修好"

# 接着上一次那条会话跑（不抹掉之前的转录）
./bin/m0.mjs --session cli-1756289123456 "接着刚才那个往下做"

# 装成命令（npm link；本包未发布，见上）
npx m0 --help
```

### 零凭据试一下：`--provider demo`（**读之前先看这段**）

没有 API key 也能看一遍完整流程——它跑的是**预录剧本**，不拨号、不花钱：

```sh
./bin/m0.mjs --provider demo --mode auto --workspace /tmp/m0-demo "随便写点什么"
```

**这个通道有三件事必须说在前面**，否则很容易把它读成产品能力：

1. **它跟你的任务无关**。剧本是固定的（`fixtures/mock/todo-fix.jsonl`），
   内容是「读 `src/todo.ts` → 写 `src/todo.ts` → 跑 `pnpm test`」。
   你给的任务文本**不进剧本**——写「把 README 翻成英文」，它照样去动 `src/todo.ts`。
2. **它结尾那句「任务完成」是剧本台词，不是判卷结论**。剧本会这么说，
   而同一趟运行里工具可能全是失败态（工作区没那个文件、没有测试可跑）。
   想看真实结论请看**退出码**，不要看台词。
3. **它会在你的 `--workspace` 里真的建 `src/todo.ts`**（用的是写工具，走同一套权限门）。

它的用途只有一个：**在不花钱的前提下看流程长什么样**（事件流、工具面、审批、退出码）。
想量能力，用 `pnpm bench`（见上），别用 demo。

### 目标模式：一轮收束 ≠ 目标达成

`--goal` 给这轮挂一个目标，判据不达标就自动再跑一轮，直到达标、撞轮次/美元上限、或者证据红到没救：

```sh
./bin/m0.mjs --goal "把 tests 全跑绿" --max-turns 8 --max-usd 0.5 "修掉失败的那些用例"
```

目标与停止理由都落在事件日志里（`goal_set` / `goal_stopped`），终端上也会打出来——
**「为什么不跑了」必须是用户看得见的事实**，而不是进程安静地退出。

几个边界：目标只能挂在会话上（所以与 `--log` 互斥）；无人值守的 run（`--unattended`、
stdin 是管道）**不会自动续跑**——那条路上审批一律 fail-closed 拒，写不了盘也验不出绿，
续跑只会白烧钱，于是会停下来并把这个理由落到事件流上。美元闸要价表里查得到那个模型才生效，
查不到时它明写自己没生效，绝不按 $0 继续烧。

### 手动压缩一条会话

```sh
./bin/m0.mjs --session cli-1756289123456 --compact
```

把一条已有会话的历史压成一段摘要，压完退出。**这条命令会调模型**（摘要器
`createGlmSummarizer` 走 GLM），所以要 `M0_API_KEY`；没有 key 时它 fail-closed 拒绝并退出 1，
**不会静默截断**历史——把长会话悄悄砍掉比报错糟得多。

边界：只能指一条**已有**会话（缺 `--session` 直接 exit 2，不编一个 id 出来再报「不存在」）；
与 `--goal` 互斥（压缩的是已有历史，不跑目标轮）；与 `--log` 互斥（`--session` 自己决定落在哪）。

### 配 provider

key 从环境变量读，**缺 key 会明确报错退出，不会静默换一家、也不会悄悄跑演示档**：

| provider | 环境变量 |
|---|---|
| `glm` | `M0_API_KEY` |
| `openai` | `OPENAI_API_KEY` |
| `anthropic` | `ANTHROPIC_API_KEY` |
| `gemini` | `GEMINI_API_KEY` |

**DeepSeek**（这个仓库叫 deepseek harness，但 `src/providers/` 下**没有** deepseek 专用适配器——它走的是现成的 OpenAI 兼容通道，
`providers/openai.ts` 的 `baseURL` 本来就可配，`glm.ts` 就是它的预设）：

```sh
export OPENAI_BASE_URL=https://api.deepseek.com/v1
export OPENAI_API_KEY=<deepseek key>
npx m0 "..."
```

`OPENAI_BASE_URL` 给到 `/v1` 这一层就行，缺 `/chat/completions` 会自动补；已经带全的写法也照样认。

**档位表以外的名字用 `--model`**。默认只拨 `providers/registry.ts` 档位表里登记过的那几档（bandit 与预算折钱
都按那张表走），但表外的模型——OpenRouter、各家网关的别名、预览版——可以直接点名：

```sh
export OPENAI_BASE_URL=https://openrouter.ai/api/v1
export OPENAI_API_KEY=<key>
npx m0 --provider openai --model stealth/space-bunny-alpha "..."
```

`--model` 是显式 opt-in：它不进档位表，因此**不参与 bandit 路由**；预算闸查不到它的价时按既有口径惰掉并明写，
绝不按 $0 继续烧。它的上下文窗口缺省取档位表里**最小**的那个（今天 128k）——这个缺省对**更小**的模型是高估，
高估会撞远端 400。指向小窗或网关模型时用 `--ctx-window <n>` 申报真实窗口（只配 `--model` 用）：

```sh
npx m0 --provider openai --model some/small-model --ctx-window 32768 "..."
```

没给 `--provider` 时按上表顺序找第一个配了 key 的；一个都没配 ⇒ exit 2 并告诉你要设哪个变量。

---

## 权限档（默认 fail-closed）

| 档 | 含义 |
|---|---|
| `read-only` | 只读面，写工具一律拒 |
| `default` | **默认档**：写操作逐次审批（交互终端里问你 y/a/n） |
| `guided` | 按风险分级放行 |
| `auto` | 自动放行——**必须显式 `--mode auto`**，不是缺省 |

审批门在没人能答的时候（管道 / CI）**当场按拒绝收束**，不等超时——一次没人应答的审批不会伪装成工具失败。

模型主动开的两扇门也在终端里问你，没人能答时各自**当场结算**（都不是挂起等超时）：

| 门 | 模型什么时候开 | 交互终端 | 管道 / CI / `--unattended` | `--mode auto` |
|---|---|---|---|---|
| `propose_plan` | 要写文件前提交方案 | 打出方案（目标 + 每个文件的动作/路径/摘要），问 `[y] 批准 [n] 拒绝` | **拒绝**；写禁不解除，模型须修订后重提 | **当场批准**（见下） |
| `clarify` | 任务有歧义 | 逐题问，答选项序号或直接写自由文本 | 提交**空答案** `{}`——如实告诉模型「没人答，自己拿主意」 | 同左 |

两者形状不同是有原因的：`propose_plan` 是**审批**，拒绝即维持写禁；`clarify` 只是**要信息**，
而 `ClarifyGate` 只有提交、没有拒绝（唯一的负向出口是中止整轮）。
提交空答案不是批准，也不解除任何门——写禁只由 `propose_plan` 落下。
**编造答案才是这里唯一真正危险的事**，空 map 恰好是最不编造的那一种。

**`--mode auto` 下方案门当场批准**（2026-09-29 改）：`auto` 是用户在命令行上显式给的授权
（它不是缺省档），既然整轮写操作都已获授权，方案门再按「没人能答 ⇒ 拒」收束就自相矛盾——
模型提交方案 → 当场被拒 → 写禁不解除 → 连读工具都进不去，最后什么都没做成。
实测代价：管道里用 `auto` 建一个文件，两次方案被自动拒、约 32k token 白烧，
模型还反过来建议用户「去 git 面板点批准」——而 core-only 树里没有那个面板。
现在 `auto` 档**当场批准**，并把「批准依据是命令行授权、不是有人看过了」印在 stderr 上，
免得把一次策略放行读成一次人工审阅。`default` / `guided` 一字未改，仍是 fail-closed。

`run_shell` 在 macOS 上走 Seatbelt 沙箱（写收敛到工作区、`.ssh`/`.aws` 等敏感目录拒读、默认断网）。
沙箱不可用时 CLI 会明说，不假装有。

**沙箱里 `pnpm test` 只在项目自己用 vitest 时才被改写成直连 vitest**（2026-09-29 改）：
这条改写原本无条件生效（为 `fixtures/todo-app` 写的，坑三：Seatbelt 下 pnpm 起不来），
于是任何非 vitest 项目（如 `node --test`）的验证拍都被换成 vitest ⇒ **项目自己 3/3 全过、
harness 的 verify 报红**（假红，且事件里报的是原始命令，模型无法归因，只能停下来问用户）。
现在按该工作区自己声明的 `scripts.test` 判：写 vitest 才改写，否则逐字不动。

---

## 事件日志

每轮落一份 JSONL，默认在 `<workspace>/.agent/sessions/cli-<时间戳>.jsonl`：

```
user_message → assistant_message → tool_call → tool_result → … → usage
```

它**可重放**——这是这个 harness 的设计前提，也是它把凭据脱敏后再落盘的原因
（`src/agent/loop.ts` 的 `redactSecrets`：`run_shell` 读到的密钥不该永久留在 JSONL 里）。

重放一份日志看模型当时看到了什么：

```ts
import { replay } from "./src/events";
const events = await replay("<path>.jsonl");
```

多 agent 的 worker 事件、目标事件都落同一份。worker 的 diff 借一条 `callId: "diff-<agentId>"`
的 `tool_result` 落地（`events/` 里没有承载 diff 本体的事件类型），CLI 会把它**整块**打出来——
stat 和 patch 都在，因为看不见的 diff 等于没有审查面。

---

## 设置（`<workspace>/.agent/settings.json`）

CLI 走 `handleAgentRun` 这个装配入口，所以它第一次真正读盘上的设置。缺省开着的是这些：

| 开关 | 缺省 | 做什么 |
|---|---|---|
| `impactAnalysis` | **开** | 每次写文件后算一遍跨文件波及面（谁调用了我），把摘要回注给模型——改第二处之前先看见第一处 |
| `promptCache` | 开 | provider 支持时的稳定前缀缓存 |
| `autoVerify` | 开 | 收束前补一拍验证（模型没自调 verify 时） |

**改真实花钱行为**、因而默认关着需要手开的是 `routingBandit`（每轮按代价换模型）与 `maxBudgetUsd`（美元闸）。
仓里目前没有外部基准读数可以拿来裁，所以它们没随这版一起翻：

```json
{ "routingBandit": true, "maxBudgetUsd": 2.5 }
```

---

## 工具

静态注册表 9 个（`src/tools/index.ts`，`tools-check` 钉着这个数）：

`read_file` · `write_file` · `edit_file` · `run_shell` · `grep`（真 ripgrep）· `glob` ·
`lsp`（真 spawn 语言服务器）· `clarify` · `propose_plan`

运行时注入（`installAppTools`，不占静态名额）：`remember`（记忆沉淀）· `spawn_agent` / `wait_for_agents` /
`cancel_agents`（多 agent 编排，CLI 上真能派 worker——`runAgent` 每轮都建会话级编排器）·
`refine_goal`（模型改自己目标的措辞）· `web_fetch`（抓一个给定 URL 还原成纯文本，只按 URL 取、不做检索）。

`web_fetch` 只收 http(s)，私网/回环/云元数据地址与每一跳重定向都逐个判掉，**四档权限一律审批**、
无人值守 fail-closed——与 `run_shell` 跑 curl 同一条红线（`web-fetch-check` 钉着这条）。它不在 worker 面上：
worker 要联网只能回主会话发。

另有两个不是普通工具：

- `verify` — 系统验证门，由 loop 的 verify 钩子处理（未接线 = fail-closed），不在工具表里
- `impact-query` — 跨文件波及面读端，worker 侧按需挂载

工具面不是提示词自觉，是**硬闸**：`allowedTools` 给出时不在表内的工具一律拒绝执行（摘表，不是劝告）。
路径另有一道 realcontainment 闸——软链解析后越出 workspace 的读写一律拒。

**CLI 上没有 `automation_*` 那五个定时任务工具**。它们要调度器在跑才有意义（60 秒 tick、七天补跑、
并发闸 ≤2，全是长驻进程语义），而 CLI 是一次性进程。它们**规格面与执行面一起摘**：只摘执行面的话
模型照样看得见这五把工具、只吃得到一句 `unknown tool`——比现状更糟。摘干净之后模型连看都看不见，
也就不会去建一个没人会 tick 的任务。调度器与 `Scheduler` 类本身原样保留，长驻服务时再接。

---

## 退出码

| 码 | 含义 |
|---|---|
| 0 | 成功 |
| 1 | 跑完了但有失败（工具失败 / 验证红 / provider 报错） |
| 2 | 用法错或配置错（argv 打错、缺 key） |

---

## 这个仓库是什么

内核质量很高、**产品面刚补上**的一棵树：strict 零报错，fail-closed 是设计意图而非事后补丁，
变异测试的判红标准很硬。桌面层已按明确要求移除（无 Electron / renderer / preload），
剩下的 electron-free 应用服务在 `src/main/`。

- `src/agent/` — 事件循环、编排、worker、压缩、判卷层
- `src/events/` — append-only 事件流 + 重放 / 分叉
- `src/tools/` — 工具实现
- `src/permissions/` — 权限策略
- `src/providers/` — provider 适配器与模型注册表
- `src/main/` — electron-free 的应用服务（装配根）
- `scripts/` — headless 闸（`pnpm gates` 全跑，清单在 `scripts/gate-manifest.ts`，即事实源）

开发规则见 [AGENTS.md](AGENTS.md)；架构说明见 [docs/CODE-WIKI.md](docs/CODE-WIKI.md)。

