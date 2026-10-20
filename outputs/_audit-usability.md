# m0（deepseek harness）可用性审计：真实用户能不能用起来

**审计范围**：`/Users/ze/Downloads/deepseek harness`，HEAD `6849e35`（2026-09-28），工作树有 33 个未提交修改（属他人进行中工作，本次审计**未改动仓库任何一个字节**，只读 + 在 `/tmp` 与本地假 provider 上实测）。
**环境**：macOS、Node v22.23.2、npm 10.9.8、pnpm 11.21.0。
**方法**：照 README 走新用户路径；用本地假 OpenAI 兼容 SSE 服务器（`/tmp/m0-audit/mock-openai.mjs`）在没有真 key 的前提下把「有 key 的通道」端到端跑通；用真 pty 模拟坐在终端前的用户回答审批。每条结论都标了 ✅ 能用 / ⚠️ 有坑 / ❌ 坏或没有，并给出命令+实测结果或 `file:line`。

---

## 一句话结论

**这不是一个"用户能装上就用"的产品，而是一棵内核质量很高、但产品面只做了一半的开发者研究工件。** 已经克隆好仓库、手里有 API key、并且愿意读中文源码注释的人，能真的拿它干活（我实测跑通了「流式回复 → 写文件 → 回灌工具结果 → 用量统计」的完整闭环）；但任何一个"按 README 第一次上手"的新用户都会连环卡住：它**装不上**（`private: true` + `version 0.0.1`，`npm publish` 拒绝；就算发出去，`tsx` 是 devDependency，生产安装一启动就 `ERR_MODULE_NOT_FOUND` 崩），README 第一行给的 `npx m0` 只在仓库目录里有效（换到别处会去 npm 下载**一个同名的无关包** `m0@0.0.7`），没有 key 时唯一的离线通道会把一段**跟你任务毫无关系的 `src/todo.ts` 假剧本**跑给你看、结尾还宣称"任务完成"，而文档全程没告诉你这个 `--provider demo` 怎么进。加上全中文界面、没有 `--version`、没有会话列表、失败的工具调用**退出码仍然是 0**，它现在更适合当"内部研发工具"，不适合当"给用户的产品"。

---

## 1. 第一次上手：装、跑、以及"能不能装成命令"

- ✅ **README 声明的 Node 下限是真的、理由也对得上**：`package.json:9-11` 写 `"node": ">=20.3.0"`；README:16 说理由是 `AbortSignal.any`，代码里确实在用（`src/providers/retry.ts:72`、`src/main/agent-runner.ts:1363`）。本机 Node v22.23.2 跑得通。
- ⚠️ **README 自己前后不一致**：README:7 让你 `npm install`，README:19 又说需要 pnpm 并给 `pnpm install`。仓库是 pnpm workspace（`pnpm-workspace.yaml`、`pnpm-lock.yaml`）。两条都能装上：我在 `/tmp` 复制 `package.json` 后 `npm install --dry-run` → 4 秒解析 204 个包；`npm install --omit=dev` → 装了 102 个包（35s）。但走 npm 时 **lockfile 被完全忽略**，装出来的依赖树不保证可复现。
- ✅ **仓库内直接跑 CLI 是通的**：`./bin/m0.mjs --help` → exit 0，完整中文帮助；`./bin/m0.mjs --provider demo --mode auto --workspace /tmp/... "..."` → exit 0，写出 `.agent/sessions/cli-<ts>.jsonl`（19 条事件）。
- ❌ **它根本发不出去、也装不了**：`package.json:4` `"private": true`，`package.json:3` `"version": "0.0.1"`，没有 `license` 字段、没有 `files` 白名单、仓库里也没有 LICENSE/CHANGELOG/`.github`。npm 的 private 检查在 `libnpmpublish/lib/publish.js:15-21`（`EPRIVATE`：`This package has been marked as private`）。我实测 `npm publish --registry http://127.0.0.1:9/` 停在 `ENEEDAUTH`（认证检查先于 private 检查），也就是说：包会被打出来，但任何人 `npm publish` 都会被 private 挡下。**用户没有任何"安装"的路径，只能克隆仓库。**
- ❌ **`tsx` 在运行时被依赖，这是一个真实的部署约束**，不是洁癖：`bin/m0.mjs:7` 直接 `import { register } from "tsx/esm/api"`，而 `tsx` 只写在 `devDependencies`（`package.json:46-51`）。我做了对照实验：把 `bin/ + src/ + package.json` 复制到 `/tmp/m0-audit/pkg`，`npm install --omit=dev` 成功装 102 个包后运行 `node bin/m0.mjs --help` →
  ```
  Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'tsx' imported from /private/tmp/m0-audit/pkg/bin/m0.mjs
  ```
  **结论：任何"生产安装"（`npm i -g`、`npm i --omit=dev`、发布后安装）都会在启动第一行崩掉。** README:4 的"没有构建步骤——装上就有一条 `m0` 命令"只对"在仓库里、devDeps 装好了"这一种情况成立。
- ⚠️ **`npx m0` 只在仓库目录里能用**：在仓库根 `npx --no-install m0 --help` → 打出的是本项目的帮助（exit 0，npm exec 会用当前项目自己的 bin）。但换到 `/tmp` 再跑 `npx --no-install m0 --help` → `npx canceled due to missing packages ... ["m0@0.0.7"]`。我下载并拆开了那个包：npm 上的 `m0` 是 **Brent Jackson 的一个无关的 MDX/React 开发服务器**（`package/cli.js` 用 meow + `react-dev-utils/openBrowser`），`bin` 也叫 `m0`。**README:9 让新用户执行 `npx m0 "把 tests 里失败的那个用例修好"`，只要他不在仓库目录里，跑起来的就是别人的包。** README:37 的"装成命令（npm link 或发布后）"同理：发布不可能，`npm link` 能用的唯一原因是它软链回仓库、正好蹭到仓库里装好的 devDeps——我实测 `npm install -g --prefix /tmp/m0-audit/prefix <仓库>` → 装在临时前缀下的 `bin/m0` 是软链，`m0 --help` exit 0。
- ❌ **打包卫生不成立**：没有 `files` 字段，`npm pack --dry-run` 的结果是 **20 801 个文件 / 压缩后 133.7 MB / 解压 357 MB**，其中 `.worktrees` 19 753 个文件、`outputs/` 381 个、`PROGRESS.md`、`tests/`、`scripts/`、`fixtures/`、`.mimosa/`、`.agent/permissions.json` 全在里面。（`.worktrees/` 只被 `.git/info/exclude` 排除，npm 不认它。）
- ⚠️ **文档没有任何"新用户导览"**：`docs/` 只有 3 个很短的英文文件（`docs/README.md` 18 行、`docs/DOCS-MAP.md` 15 行、`docs/CODE-WIKI.md` 13 行），剩下 3 个是 40KB 级的中文内部提案（`docs/m5-proposal.md` 等），不是给用户的。没有安装指南、没有教程、没有示例工程。`fixtures/demo/README.md` 还引用着本树里已不存在的 `src/main/index.ts` 和 `docs/*.png`（桌面层被删后的残留）。
- ❌ **没有 `--version`**：`node bin/m0.mjs --version` → exit 2，报的是"需要一个任务描述：m0 <任务>"——用户想看版本号，得到的是"你不会用"。

---

## 2. 没有 API key 时能干什么（`--provider demo`）

- ✅ **缺 key 的报错是诚实且清楚的**：`node bin/m0.mjs "你好"`（清掉 4 个 key 环境变量）→ exit 2，消息列全 4 个变量名、给 DeepSeek 走 OpenAI 兼容通道的配方、并提示"只想看演示：加 --provider demo"（`src/cli.ts:261-266`）。**它没有偷偷回落 demo**，这一点做得对，也和 README:71 一致。
- ✅ **demo 通道真的离线可跑**：`node bin/m0.mjs --provider demo --mode auto --workspace /tmp/m0-audit/ws1 "把 README 翻译成英文"` → exit 0，19 条事件落 `.agent/sessions/cli-1790692066749.jsonl`，还真的往工作区写了一个 `src/todo.ts`。离线跑通"模型输出→工具→事件流"这条链路，作为冒烟测试是有效的。
- ❌ **但它演示的不是你的任务，而是一段冻结剧本**：剧本是 `fixtures/mock/todo-fix.jsonl`（7 行，`src/main/agent-runner.ts:132` 写死，`:1254` 装配）。我给的题目是"把 README 翻译成英文"，终端上打出来的是：
  ```
  我先读一下 src/todo.ts，定位失败原因。
    ✗ read_file: 文件不存在或不可读: src/todo.ts
  找到了：completedCount 没有过滤 done。我来修复。
    ✓ [auto-approved] 已写入 src/todo.ts（725 字节，新建 +30 行）
  修复完成，跑测试验证。
    ✗ [auto-approved]  RUN  v5.0.0 /private/tmp/m0-audit/ws1
  3 条测试全部通过，bug 已修复，任务完成。
  ```
  用户的任务字符串只作为 `user_message` 落进日志，对剧本没有任何影响。
- ❌ **剧本自己打自己的脸**：同一条运行里，事件日志记着 `read_file ok=false`、`run_shell ok=false`，可模型台词照样说"3 条测试全部通过，bug 已修复，任务完成"。**一次什么都没做成的运行，终端上看起来像成功。**
- ❌ **"沉淀轮"把整段剧本又放了一遍**：demo 运行的第二段是会话尾记忆沉淀轮，它拿的是**新建的 provider 实例**（`src/main/agent-runner.ts:1641` `provider: createProvider(...)`；demo 分支 `:1254` → 新的 `createMockProvider`，游标从 0 开始，`src/providers/mock.ts:56-58`），于是同一段剧本**逐字重放**，而沉淀轮只允许 `remember`，每个工具调用都被拒：
  ```
  我先读一下 src/todo.ts，定位失败原因。
    ✗ [denied] [distill] 沉淀轮只允许 remember 工具，read_file 已拒绝
  ...
  ```
  新用户看到的是"同一个假剧本跑两遍 + 4 条 `[denied]`"，最自然的解读是"我是不是把工具用坏了"。
- ⚠️ **可发现性为零**：README 全文只在第 71 行提到"演示档"四个字，**从没写过 `--provider demo` 怎么用**（`grep -n "demo\|演示" README.md` 只有这一处）；只有 `--help`（`src/cli.ts:544`）里列了它。也就是说：读 README 的人只被告知"没 key 就报错"，而不会知道有个离线演示；自己猜到 demo 的人，看到的是上面那段误导性剧本。
- ✅ 退出码语义：demo 缺省 `--mode default` 在管道里会打一行明确提示并 fail-closed（`[m0] stdin 非交互（管道 / CI）——审批一律 fail-closed 拒绝…`），这点和 README:121 一致。

**诚实评价**：demo 通道是"管线冒烟测试"，不是"演示这个工具能干什么"。它能证明 CLI→provider→工具→事件流 是通的；它同时会**主动误导**第一次用它的人（无关任务、假成功台词、重放剧本、莫名拒绝）。在 README 不提它、也不说明"这是预录剧本"的前提下，这是净负面体验。

---

## 3. 有 API key 时能干什么

- ✅ **四家 provider 的接线是真的**：env 名与 README:73-78 逐字一致（`src/providers/env-keys.ts:6-11`：`M0_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY`）；注册表白名单四家（`src/providers/registry.ts:22`），路由按 `spec.provider` 分发到四个真适配器（`registry.ts:133-174`）；档位表 12 行（`registry.ts:45-63`）。DeepSeek 走 `OPENAI_BASE_URL` 的说法也成立（`registry.ts` 注释 + `openai.ts:127-129`）。
- ✅ **"有 key 的完整闭环"我用本地假端点实测跑通了**（没有真 key 也能验通道本身）：
  ```
  OPENAI_BASE_URL=http://127.0.0.1:8899/v1 OPENAI_API_KEY=fake-key-for-audit \
    node bin/m0.mjs --provider openai --mode auto --workspace /tmp/m0-audit/ws4 "写一个 hello.txt，内容是 hello"
  ```
  实测结果：exit 0；SSE 增量上屏；`⚙ write_file hello.txt` → `✓ [auto-approved] 已写入 hello.txt（25 字节）`；工具结果回灌给模型后收尾；打印 `· tokens in=2345 out=12`；工作区真的出现 `hello.txt`（25 字节，内容正确）。假服务器日志确认 `baseURL` 的 `/v1` 被正确补成 `/v1/chat/completions`（`openai.ts:109-112`），并带了 `stream_options.include_usage`（`openai.ts:136`）。
- ✅ **流式 / 工具调用 / 用量统计都是真实现，不是桩**：OpenAI 兼容适配器 301 行，含 SSE 半帧容错、`tool_calls` 按 index 跨块拼接、`finish_reason=length` → `turn_truncated`、usage（含 cache read/write）分块上报（`src/providers/openai.ts:116-301`）；另有原生 `anthropic.ts`、`gemini.ts`；重试与停滞守卫在 `src/providers/retry.ts`；价表在 `src/routing/pricing.ts:56`。
- ✅ **测试面存在且在跑**：`node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts tests/providers.test.ts tests/cli-surface.test.ts` → **2 files / 100 tests 全绿，19.7s**（其中 `providers.test.ts` 39 条，覆盖四家同构对话等价、工具分片拼接、坏帧必须抛错、baseURL 归一）。这些测试全部用 fixture 注入 `fetchImpl`，不需要真 key——**但也因此没有任何一条测试证明"用真 key 打真端点能通"**。
- ⚠️ **档位表里的模型名自己承认没核实过**：`registry.ts:4` 文件头写"档位模型名与价格为**占位**——需联网实测校准"；`:49` 给 `glm-5.2-pro` 标了 `⚠️ 未证`。缺省档（tier=standard）里 anthropic 是 `claude-sonnet-5`（`:56`）、gemini 是 `gemini-3.8-flash`（`:61`）。我没有凭据去核实这两个名字今天是否存在，但**这正是"第一次用真 key 就 400/404"的典型形状**，而 CLI 里除了 `--model` 之外没有任何"改模型/看模型"的入口，`--model` 又会退出档位表（不参与路由与折价）。
- ⚠️ **默认不给钱数**：`maxBudgetUsd` 缺省 0（`src/main/settings.ts:101`），CLI 只打 token 不打美元；价表存在但 GLM 三档仍是占位价（`src/routing/pricing.ts` 文件头）。
- ⚠️ **每次会话结束多一次隐藏模型调用**：`autoMemory` 缺省开（`settings.ts:100`），会话尾会再发一次请求（`src/main/agent-runner.ts:1636-1658`）。实测：缺省 3 次请求，写 `{"autoMemory":false}` 后 2 次。更糟的是**这一轮的模型输出会当成普通助手发言打到终端上**——同一条回复在屏幕上出现两遍（`已写好 hello.txt。` + `· tokens in=2345 out=12` 各两次），用户会以为模型答了两次。README 全篇没提这件事。
- ⚠️ **Anthropic 的 prompt cache 是唯一的写侧缓存**，其余三家"传了也是零行为"（`registry.ts:126-130`）；README:171 那句"provider 支持时的稳定前缀缓存"严格来说没错，但在 GLM/OpenAI/Gemini 配置下它是惰性的。

---

## 4. 用户真正碰到的产品面（逐项实测）

- ✅ **`--help`**：exit 0，中文帮助完整，每个 flag 都有说明；测试也钉住"没进 help 的选项等于不存在"（`tests/cli-surface.test.ts:84,111,319-322`）。
- ✅ **会话续跑 `--session <id>`**：同一 id 跑两次 → 第二次不抹掉转录（38 条事件，第一条 `user_message` 仍是"第一次"）。
  ⚠️ 但**没有任何列出会话的命令**（`src/cli.ts` 里没有相关 flag），而结尾打印的是 `事件日志：/tmp/.../cli-1790692066749.jsonl`——把这个整路径当 `--session` 传进去会 exit 2：`--session 非法会话名：…（不得含 / \ . 或控制字符）`。用户必须自己把目录和 `.jsonl` 后缀剪掉。
- ✅ **`--compact`**：完全符合 README:62-67。没有 key → exit 1 + `无 M0_API_KEY，手动压缩不可用（fail-closed，不静默压缩）`，会话日志一个字节没动；缺 `--session` → exit 2；与 `--goal` 同给 → exit 2。
- ✅ **`--goal`**：`goal_set` / `goal_stopped` 两条事件都写进日志并上屏。管道场景下它**停下来了而不是白烧钱**：`⏹ 目标停止（第 1 轮，证据 absent）：无人值守 run 不自动续跑…`——与 README:51-54 一致。（交互终端里的"自动续跑"我没有验，pty 里跑目标模式代价高。）
- ✅ **权限档**：
  - `read-only` 会把写类工具**从模型看到的工具表里摘掉**（假服务器收到的 `tools` 里没有 `write_file/edit_file/run_shell`，只剩读与门工具），写请求被拒 `[denied] [permission denied]`。
  - `default` 在真终端里会问人——我用真 pty 驱动实测：`批准？ write_file src/todo.ts 风险=none [y] 批准一次 [a] 本会话内同类批准 [n] 拒绝 >` → 按 y → `✓ [approved] 已写入 src/todo.ts`。交互审批是可用的。
  - `guided` / `auto` 存在且有语义（`src/permissions/modes.ts:8`，`src/permissions/autonomy.ts:149`）。
  - ⚠️ 终端里没人回答时会**等 60 秒超时**（我实测到 `✗ [timeout] [permission denied] run_shell …（未获批准）`），而管道/CI 是当场拒。README:121 只说了后一半，前半段（人离开键盘）没写。
- ⚠️ **`.agent/settings.json` 是真读，但和 README 的描述有出入**：
  - ✅ 有效：写 `{"autoMemory":false}` 后请求数 3→2，重复发言消失——证明设置确实落到了运行里；`impactAnalysis` / `promptCache` / `autoVerify` 的缺省值与 README:168-172 表格一致（`settings.ts:113,122,127`）。
  - ❌ README:166 说"CLI 走 `handleAgentRun` 这个装配入口，所以它第一次真正读盘上的设置"——**`provider` / `model` 两个字段对 CLI 完全无效**：写 `{"provider":"demo"}` 后不给任何 key，仍然是 exit 2 的缺 key 报错（`src/cli.ts:231-245` 只看 argv 与环境变量）。
  - ⚠️ **坏 JSON 静默吞掉**：`.agent/settings.json` 写成 `{ this is not json` → 跑完 exit 0，没有任何警告（`validateSettings` 回落缺省）。
  - ⚠️ README 只文档化了 5 个字段，而 `AppSettings` 有 24 个（`settings.ts:32-88`）；其中 `layout / theme / PANEL_IDS / onboarded / updateManifestUrl / safeMode` 在 core-only 树里是**死配置**（`src/cli.ts` 完全不消费它们）。
- ❌ **退出码与 README:211-216 不符**：README 写"1 = 跑完了但有失败（工具失败 / 验证红 / provider 报错）"，但 `src/cli.ts:643-644` 只在 `error` 事件和 `verify_result` 失败时置 `failed`，**工具失败不置**。实测两例：
  - demo 运行里 `read_file`、`run_shell` 都 `ok=false` → **exit 0**；
  - `--mode read-only` 下写被门拒绝 → **exit 0**，台词还说"任务完成"。
  全仓只有一条测试钉 exit 1，钉的是 `--compact` 失败（`tests/cli-surface.test.ts:633`）。**用户拿它写 CI 或包一层脚本，会把失败当成功。**
- ⚠️ **没 key 时 argv 错误被缺 key 错误盖住**：没有 key 的机器上跑 `--log x --goal y`（互斥用法）→ 打的是"没有配置任何 provider 的 API key"，`--compact`（缺 `--session`）、`--max-turns`（缺 `--goal`）也一样。原因是 `src/cli.ts:140` 先解析 provider，`:150-164` 才做互斥检查。配上 key 之后这三条都给出正确消息并 exit 2 ✅——但**新用户恰恰是最可能没 key 的那个人**。
- ⚠️ **沙箱与影响面是活的**：demo 里 `pnpm test` 被改写成直连 vitest（`agent-runner.ts:163-171` 的别名映射），说明 macOS Seatbelt 路径在跑；写文件后有 `↔ src/todo.ts：无跨文件调用点`（README:170 的 impactAnalysis）✅。
- ✅ **工具表与 README:185-198 一致**：假服务器上观察到的静态 9 个 `read_file / write_file / edit_file / run_shell / grep / glob / lsp / clarify / propose_plan`，运行时注入 `remember / spawn_agent / wait_for_agents / cancel_agents / refine_goal`，另有 `verify` 与 `impact_query`；`automation_*` 确实**不在**模型可见的工具表里（`src/cli.ts:728` `automationTools: false`）——README:202-205 这一段是准确的。

---

## 5. 明显缺失的东西（"能用工具"还是"研发工件"？）

- ❌ **没有安装/发布/分发链**：`private: true` + `0.0.1` + 无 `publishConfig` + 无 LICENSE + 无 CHANGELOG + 无 `.github/` + 无安装脚本 + 无 `--version`；打包 133.7MB/2 万文件且无 `files` 白名单。**用户拿不到它，只能 git clone。**
- ❌ **桌面/UI 是刻意删掉的**（`AGENTS.md`），但删得不干净：CLI 成了唯一产品面，而 `.agent/settings.json` 里还留着 `layout / PANEL_IDS / theme / onboarded / updateManifestUrl` 这些**只有 UI 才消费**的字段；给模型的系统提示词里还写着"write worker 的合并/提交唯一出口是**用户侧 git 面板**"（`src/main/agent-runner.ts:154`），而这个树里没有任何 git 面板——`grep -n "git" README.md` 命中 0 次，用户也无从得知被派出去的 worker 改完的文件该怎么合并回来。
- ❌ **没有会话管理面**：不能列会话、不能删会话、不能用人类可读的方式回放日志。README:153-156 教你"重放一份日志"的方式是**写 TypeScript**：
  ```ts
  import { replay } from "./src/events";
  const events = await replay("<path>.jsonl");
  ```
  这对目标用户（想修 bug 的人）不是可用产品，是 SDK。
- ❌ **全中文，且没有英文入口**：README、`--help`、报错、系统提示词（`src/main/agent-runner.ts:150-156`）全是中文。`docs/` 那 3 个英文文件加起来 46 行。非中文用户无法开始使用。
- ❌ **用户文档覆盖不到产品面**：设置 schema（24 字段）、项目权限库 `.agent/permissions.json`（仓库里是 `{"rules": []}`，README/docs 里**零提及**）、记忆沉淀行为与成本、会话生命周期、美元成本口径——都没有面向用户的说明。`scripts/docs-check.ts:118-120,178-187` 这类门只检查 docs/ 的页数预算与"不许放二进制"，**不校验 README 的说法是否与代码一致**，所以文档夸大不会被任何门抓住。
- ❌ **没有调度/自动化/更新通道**：CLI 刻意摘掉 `automation_*`（合理，且有测试钉住），代价是"让 agent 自己定时干活"这个卖点在这棵树上完全不可达；`telemetry` 缺省关且无实现；`updateManifestUrl` 没有消费者（没有升级路径）。
- ⚠️ **规模与产品面严重不匹配**：`src/` 35 000 行（README:221 说 33k ✅）、241 个测试文件、"全绿 3017 条"级别的内部门禁（`scripts/gates.ts` + `gate-manifest.ts`）、766KB 的 `PROGRESS.md` 开发日志——但用户能碰的东西只有：一段帮助文本、一条运行命令、4 个真正有用的 flag、一份要靠自己写代码读的 JSONL。
- 结论：**它是"研发工件 + 一个够用的内部 CLI"，不是"可交付的产品"**。内核（事件溯源、权限、provider、门禁）明显是认真做的，缺的恰恰是"从零到一个能用的东西"之间那一整层。

---

## 如果我是新用户，我会卡在哪（按发生顺序）

1. **README 第一段就让我做一件只在仓库目录里成立的事**：`npm install` + `npx m0 "…"`。我一旦在别处敲 `npx m0`，装下来的是**别人的同名包**（npm 上的 `m0@0.0.7`，一个 MDX 开发服务器）。
2. **我想把它装成命令**：`npm i -g` 到一个发布包——不存在（`private: true`）；就算有人把 private 去掉发出去，生产安装里没有 `tsx`，`m0 --version`（还没有这个 flag）都会崩在 `ERR_MODULE_NOT_FOUND`。
3. **我没有 key，试了一下**：报错很清楚地让我设 4 个变量之一，或"加 `--provider demo`"——但 README 里没写这个开关。我猜到了 demo，然后看到一段**跟我的任务毫无关系的 `src/todo.ts` 剧本**，结尾还告诉我"任务完成"，同一条日志里却全是 `ok=false` 和 `[denied]`。
4. **我有 key 了**：第一次真跑可能因为档位表里没核实过的模型名（`claude-sonnet-5` / `gemini-3.8-flash` / `glm-5.2-pro`）直接 400/404，而 CLI 没有"列模型/选模型"的正规入口，只有 `--model`（还会退出路由与折价）。
5. **我想接着上次的会话**：没有会话列表命令；结尾打印的是一整条文件路径，直接当 `--session` 传会被判非法。
6. **我想写进脚本/CI**：工具失败、写被拒、目标没达成，退出码都还是 0——我的脚本会把失败当成功。
7. **我想调设置**：README 只列了 5 个字段，实际有 24 个；我写错的 JSON 会被静默忽略；我写的 `provider: "demo"` 根本没生效。
8. **我想让别人也用**：全中文，且没有安装包、没有版本号、没有许可证。

---

## 附：文档夸大/不实清单（README 逐条对照）

| README 原文 | 实测 | 判定 |
|---|---|---|
| `README:4` "没有 UI、没有 Electron、没有构建步骤——**装上就有一条 `m0` 命令**" | 没有可发布的包；生产安装缺 `tsx` 直接崩 | ❌ 前半句真、后半句假 |
| `README:9` 快速开始 `npm install` → `npx m0 "…"` | 仅当 cwd 是仓库根时 `npx m0` 才是本 CLI；别处是无关的 npm 包 `m0@0.0.7` | ❌ |
| `README:37` "装成命令（npm link 或发布后）`npx m0 --help`" | `npm link`/`--prefix` 全局装可用（软链回仓库）；"发布"不可能（private） | ⚠️ 一半 |
| `README:63` `--compact` 需 `M0_API_KEY`，没有就 fail-closed exit 1 | 实测 exit 1 + `无 M0_API_KEY，手动压缩不可用`，日志未动 | ✅ |
| `README:71-78` 四家 env 变量 | 与 `src/providers/env-keys.ts:6-11` 逐字一致 | ✅ |
| `README:89` `OPENAI_BASE_URL` 给到 `/v1` 会自动补 `/chat/completions` | 假端点实测请求路径正是 `/v1/chat/completions` | ✅ |
| `README:108` 没给 `--provider` 时按顺序找 key，一个都没有 ⇒ exit 2 | 实测 exit 2，消息列全 4 个变量 + demo 提示 | ✅ |
| `README:121` 审批门在管道/CI 当场拒绝、不等超时 | 管道实测当场拒 ✅；但**交互终端里没人回答会等 60s 超时**（未写） | ⚠️ 不完整 |
| `README:135` macOS Seatbelt + 沙箱不可用会明说 | 沙箱在跑（`pnpm test` 被改写为直连 vitest），无告警 | ✅ |
| `README:166` "CLI …第一次真正读盘上的设置" | settings 真读（`autoMemory` 生效），但 `provider`/`model` 字段对 CLI 无效 | ⚠️ 夸大 |
| `README:168-179` 设置表（3 开 + 2 关） | 缺省值与代码一致；但实际 24 个字段，且坏 JSON 静默吞 | ⚠️ 不完整 |
| `README:185-205` 9 个静态工具 + 注入工具 + 没有 `automation_*` | 假服务器上观察到的工具表逐项吻合 | ✅ |
| `README:211-216` 退出码 1 = "跑完了但有失败（**工具失败** / 验证红 / provider 报错）" | 工具失败**不置** exit 1；实测两次失败运行都是 exit 0 | ❌ |
| `README:221` "33k 行 `src/`、strict 零报错" | `find src -name '*.ts' \| xargs wc -l` = 35 000 行；团队 typecheck exit 0 | ✅ |
| `README:205` 调度器与 `Scheduler` 类"原样保留" | `src/main/scheduler.ts`、`automations.ts` 在树里，但 CLI 不可达 | ✅（但用户侧=没有） |

---

### 复现用的关键命令（全部只读或写在 /tmp）

```sh
# 1) 装/发布现实
npm pack --dry-run                     # 20801 files / 133.7MB / 357MB unpacked
npm publish --registry http://127.0.0.1:9/   # → ENEEDAUTH（private 检查在库内 libnpmpublish/lib/publish.js:15-21）
cp -R bin src package.json /tmp/pkg && (cd /tmp/pkg && npm install --omit=dev && node bin/m0.mjs --help)
                                       # → ERR_MODULE_NOT_FOUND: Cannot find package 'tsx'

# 2) 无 key 的 demo 真相
node bin/m0.mjs --provider demo --mode auto --workspace /tmp/ws "把 README 翻译成英文"

# 3) 有 key 的通道（本地假 OpenAI 兼容 SSE 端点，无需真 key）
node /tmp/m0-audit/mock-openai.mjs &
OPENAI_BASE_URL=http://127.0.0.1:8899/v1 OPENAI_API_KEY=fake node bin/m0.mjs \
  --provider openai --mode auto --workspace /tmp/ws4 "写一个 hello.txt，内容是 hello"

# 4) 交互审批（真 pty）
python3 /tmp/m0-audit/pty-run.py node bin/m0.mjs --provider demo --mode default --workspace /tmp/ws12 "修一下 bug"

# 5) 定向测试（没再起全量）
node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts tests/providers.test.ts tests/cli-surface.test.ts
```
