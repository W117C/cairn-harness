# m0 — 可重放的 agent harness

一个事件溯源（event-sourced）的 agent 内核：每一步都落成 JSONL 事件，因此**同一份日志可以被重放、分叉、审计**。
没有 UI、没有 Electron、没有构建步骤——克隆下来 `npm install` 完就有一条 `m0` 命令。

```sh
git clone <this-repo> && cd m0-agent-loop
npm install                       # CLI 走 tsx 通道（devDependency），必须装齐才能跑
export OPENAI_API_KEY=<你的 key>
npx m0 "把 tests 里失败的那个用例修好"
```

> 本包是 `"private": true`，**不经 npm 分发**：没有 `npm install -g m0` 这条路。上面是克隆仓库后的用法——
> tsx 在 devDependencies 里，源码经 tsx 通道直接跑。

---

## 快速开始

需要 Node 20.3+（`AbortSignal.any` 的下限，`package.json` 的 `engines` 已声明）与 pnpm。仓库根目录：

```sh
pnpm install
pnpm typecheck        # tsc --noEmit
pnpm test             # 整跑（core-only 的 236 个测试文件）
```

跑一轮：

```sh
# 在当前工作区
./bin/m0.mjs "你的任务"

# 在别的工作区
./bin/m0.mjs --workspace ~/code/some-repo "把失败的测试修好"

# 装成命令（npm link 或发布后）
npx m0 --help
```

### 配 provider

key 从环境变量读，**缺 key 会明确报错退出，不会静默换一家、也不会悄悄跑演示档**：

| provider | 环境变量 |
|---|---|
| `glm` | `M0_API_KEY` |
| `openai` | `OPENAI_API_KEY` |
| `anthropic` | `ANTHROPIC_API_KEY` |
| `gemini` | `GEMINI_API_KEY` |

**DeepSeek**（这个仓库叫 deepseek harness，但 `src/` 里 "deepseek" 出现 0 次——它走的是现成的 OpenAI 兼容通道，
`providers/openai.ts` 的 `baseURL` 本来就可配，`glm.ts` 就是它的预设）：

```sh
export OPENAI_BASE_URL=https://api.deepseek.com/v1
export OPENAI_API_KEY=<deepseek key>
npx m0 "..."
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

`run_shell` 在 macOS 上走 Seatbelt 沙箱（写收敛到工作区、`.ssh`/`.aws` 等敏感目录拒读、默认断网）。
沙箱不可用时 CLI 会明说，不假装有。

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

---

## 工具

静态注册表 9 个（`src/tools/index.ts`，`tools-check` 钉着这个数）：

`read_file` · `write_file` · `edit_file` · `run_shell` · `grep`（真 ripgrep）· `glob` ·
`lsp`（真 spawn 语言服务器）· `clarify` · `propose_plan`

运行时注入（`installAppTools`，不占静态名额）：`remember`（记忆沉淀）· `spawn_agent`（编排器未接线时 fail-closed 拒绝）。

另有两个不是普通工具：

- `verify` — 系统验证门，由 loop 的 verify 钩子处理（未接线 = fail-closed），不在工具表里
- `impact-query` — 跨文件波及面读端，worker 侧按需挂载

工具面不是提示词自觉，是**硬闸**：`allowedTools` 给出时不在表内的工具一律拒绝执行（摘表，不是劝告）。
路径另有一道 realcontainment 闸——软链解析后越出 workspace 的读写一律拒。

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
- `scripts/` — 26 道 headless 闸（`pnpm gates` 全跑，清单即事实源）

开发规则见 [AGENTS.md](AGENTS.md)；架构说明见 [docs/CODE-WIKI.md](docs/CODE-WIKI.md)。

