# 第 438 页取料：CLI 上的插件／skill 发现面与信任决议（#7 的 ②＋①）

本轮零模型调用、零网络请求；下面每个数都是本机跑出来的原文，命令在文末逐字可复算。

## 1. 缺口现读（用被测方自己的谓词，不写正则猜）

```
$ node --import tsx /tmp/pface7.mjs      # 直接调 discoverPlugins，根取装配面那一份
trust file = /Users/ze/.config/cairn/plugin-data/plugin-trust.json
default root = /Users/ze/.config/cairn/plugin-data
plugins 0 loose 0 errors 0 warnings 0
dup plugin names = []
pending = 0
$ ls -d .agent/skills .agent/plugins
.agent/skills                       ← 盘上真有 `.agent/skills/graphflow/SKILL.md`
ls: .agent/plugins: No such file or directory
```

* 发现面报「什么都没有」，而工作区里摆着一支项目 skill ⇒ 缺陷是**根没被扫**，不是 skill 坏了。
* `grep -rn 'agent/skills' src` 只命中我这一笔 ⇒ 全仓没有任何读取 `<ws>/.agent/skills` 的代码（负控：同一把尺搜 `.agent/plugins` 命中 `src/main/agent-runner.ts:2850`）。
* `grep -n 'plugin|trust' src/cli.ts` 零命中 ⇒ CLI 交付面上没有信任决议入口。
* 同名歧义面现读 0 条（`dup plugin names = []`）⇒ **这一页不做歧义闸**（发生率 0，不外推玩具面）。

## 2. 形状（三处「只有一个出处」）

| 格 | 唯一出口 | 为什么在这而不是别处 |
| --- | --- | --- |
| 缺省的项目 skill 根 | `projectSkillsRootOf(workspace)`（`src/agent/plugins/index.ts`） | `PluginRuntime.load` 接缺省 ⇒ 桌面面板／每次 run／CLI 一起吃到，不必动隔壁在飞的 `agent-runner.ts` |
| 扫了哪几顶根 | `discoverPlugins` 用它自己那批 `opts.*` 填 `manifest.roots` | 列出的根＝真扫的根；调用方再拼一遍就是第二份事实（规则 236 那一族） |
| 决议写哪张表 | `PluginRuntime.trustDecide`（CLI 与桌面面板同一个方法） | 判卷面（`plugin-cli-face.ts`）连 `TrustStore` 都不 import，被 ㉗ 那条判卷钉住 |

`pluginRuntimeOpts` 由 private 变 `export`：CLI 的 `--plugins` 必须与一次真 run 吃同一批根（env `M2E_USER_PLUGINS`／`M2E_LOOSE_SKILLS`／`M2E_TRUST_FILE` 只在这一处读）。

信任门方向：新根走 `scanScopeRoot(dir, "project", trustOf)`，**不是** `looseRoots` 那条恒 trusted 的路——否则「为了可用」把 E3（description 直进 system prompt）的闸拆了。

## 3. 真跑读数（本机原文，未截断）

```
$ node bin/cairn.mjs --plugins
插件与 skill 发现面（工作区 /Users/ze/Downloads/Cairn/deepseek harness）
  扫描根：
    用户级插件：没给这一顶（没扫）
    项目插件：…/.agent/plugins
    项目 skill：…/.agent/skills
    免信任散装：没给这一顶（没扫）
  名称｜种类｜作用域｜状态｜根
  graphflow｜散装 skill｜project｜pending｜…/.agent/skills/graphflow
  待信任 1 条：这一档只列出、不激活（钩子／MCP／skill 路由都不生效）
  信任表还没写过（/Users/ze/.config/cairn/plugin-data/plugin-trust.json）
  批准：cairn --trust-plugin <名称>　拒绝：cairn --decline-plugin <名称>
  决议按「绝对路径@内容指纹」记账：改过插件内容就得重新批一次。
```

决议面（`M2E_TRUST_FILE=/tmp/t437/trust.json` 隔离，不碰真表）：

| 台 | 命令 | 退码 | 出声／表内容 |
| --- | --- | --- | --- |
| A | `--trust-plugin nosuch` | 1 | 「不在这次发现面里 ⇒ 一条决议也没写下」；表文件**没被创建** |
| B | `--trust-plugin graphflow` | 0 | `trusted: ["…/.agent/skills/graphflow@7ab77bc0ff2ae4697c87beb948deb0fb"]` |
| C | 再跑 `--plugins` | 0 | `graphflow｜…｜trusted`、`待信任 0 条`、`信任表 已信任 1 条／已拒绝 0 条` |
| D | `--decline-plugin graphflow` | 0 | 同一条从 trusted 移到 declined（B 的条目被替换，不残留相反决议） |
| E | `--trust-plugin a --decline-plugin b` | 2 | 用法错（不让后一枚赢） |
| F | `--plugins 干活` | 2 | 「插件那三条旗标不跑任务」（不静默吞任务还报 0） |
| G | `--trust-plugin`（缺值） | 2 | pick 那句既有的缺值闸 |

B→C 那一趟就是「感知→执行→验证」在这一格最短的一次闭环。

## 4. 判卷与锚点（尺与针脚同笔）

* 判卷 `tests/plugin-cli-face.test.ts`：**31 条**（现读 `Tests 31 passed (31)`，独占 1.99s／wall 2.23s）。分五层：纯函数合成面 ①–⑫、信任表三态真盘 ⑬–⑮、装配面真扫 ⑯–⑱、真 spawn CLI ⑲–㉓、接线㉔–㉛。
* 锚点 7 根（`scripts/mutate-verify.mjs`，表长脏树面 1519）：

| 锚点 id | 改法（一句话） | killer 用例 |
| --- | --- | --- |
| `plugin-cli-decide-failure-reads-approved` | 把失败分支摘掉（`if (!ok)` → `if (false)`） | ⑨ 决议没落地就绝不说「已批准」/「已拒绝」 |
| `plugin-cli-unreadable-trust-state-folded` | absent／unreadable 两档互换 | ⑧ 没写过表 ≠ 读不出表 |
| `plugin-cli-absent-trust-file-folds-to-zero` | 取不到文件就回「0 条」 | ⑬ 文件不在 = absent |
| `project-skills-root-bypasses-trust-gate` | 新根改走恒 trusted | ⑯ 首次装载是 pending |
| `plugin-cli-face-rebuilds-runtime-opts` | CLI 自己拼一份 opts | ㉖ 扫面吃装配面那一份配置 |
| `plugin-cli-decide-name-counted-as-positional` | 从取值型旗标表里摘掉两枚 | ⑳ 批准后信任表里那条是路径@指纹 |
| `plugin-cli-task-message-swallowed` | 摘掉「带任务描述就拒」那道闸 | ㉒ 带着任务描述就拒跑（退 2） |

* 判卷自己给生产句作证的那格（本轮被自己的尺抓到一次）：`promise-recall-inventory` 报
  `src/cli.ts#parseArgs｜批准与拒绝是相反的决议` 欠证人——句子里有 `只能` 这个能力标记，而它的取料面是
  **`trackedExistingFiles(ROOT, "tests")`**，我那条断言当时写在**未跟踪**的新判卷文件里 ⇒ 证人不 exists。
  `git add` 那两份新文件之后同一趟转绿。⇒ 这条不是「记得提前 add」的纪律问题，是**取料面本身就是 tracked 面**；
  「新文件暂存挂在首次 import 它的那一笔」这条老规矩在这里多一重理由：没 add 的新判卷在台账尺眼里等于没写。

## 5. 落库前的秒级读数（两面都记，归因按面分）

| 尺 | 脏主树面 | 备注 |
| --- | --- | --- |
| `node --check scripts/mutate-verify.mjs` | 通过（RC 0） | 锚点表写长的第一步就查语法 |
| `scripts/typecheck.ts` | 0 条报错 | |
| `--check-needles` | 阻断 20 ＝ 我这簇 14（未入库面 10 ＋ 钉在飞文本 4）＋ 隔壁 6 | 待复认 2、未覆盖 1、逐行式 5、松钉 10 |
| `scripts/docs-check.ts` | 退 0 全绿（另有 3 项未检） | 「下一个未占用页号：437」是 HEAD 面读数 |
| `scripts/prose-needle-scan.ts` | 顶包候选 11 ＞ 帽 10 | 11 条里**没有一条**来自本笔；在飞那 4 条全指 `tests/docs-check.test.ts`（隔壁） |
| `tests/assertion-health-scan.test.ts` | 17 passed | |
| 全量判卷（脏主树，隔壁在飞面也在） | `Tests 7 failed ｜ 5243 passed (5250)` | 7 条红：1 条是我的欠证人（已修，见 §4），6 条属隔壁在飞（§6） |

## 6. 外因归因（只记不修）

1. `tests/cli-surface.test.ts` —「提示里点名了要设哪个环境变量」：`已装自定义 provider：agnes-ai(1 个模型…` 里缺 DeepSeek 那句；本笔没动 provider 文案。
2. `tests/mutate-verify-gates.test.ts` — 选择子水位帽 3，现读 4：`shape-leading-env-assignment-not-skipped(0)`、`settings-default-on-key-read-by-strict-true(2)`、`settings-auto-verify-default-reverted(2)`、`docscheck-source-cite-stale-branch-dead(2)`——四根都不是本笔的锚点。
3. `tests/prose-needle-scan.test.ts` — 顶包候选 11（在飞 4 条来自隔壁的 `tests/docs-check.test.ts`）。
4. `tests/prompt-surface-check.test.ts` — 接线那条读的是隔壁在飞的 `agent-runner.ts`（`BASE_SYSTEM` 装配点）。
5. `tests/provider-config.test.ts` — 派生档位字段多了一格（`…(5)` vs `…(4)`），本笔没碰 providers。
6. `tests/repo-hygiene-check.test.ts` — 面②「帽 3100 ≤ 现状最大 `src/main/agent-runner.ts`（3110 行）」：该文件工作树 3109→3110 里本笔只占 2 行（注释＋`export`），其余是隔壁 +137；HEAD 面另计（隔壁页 437 记的是 HEAD 2970 行）。
7. 另有一处**文档不适格**登记但不归本笔：隔壁在飞的 `AGENTS.md` managed 块写着 `dsh plugin --profile web add @roarpeng/graphflow`——`HEAD:AGENTS.md` 里搜不到这句（退 1），且本仓 `package.json` 的 bin 是 `cairn` 而非 `dsh`，`src/cli.ts` 也没有 `plugin` 子命令。改别人的托管块不由我决定，等它落库或由工具自己重写；等业主点头后可以按「README 那三行」的形状补一条真存在的命令。

## 7. 刻意未做（写在纸上，免得被下游读成已做）

* 不做同名歧义闸（§1 现读 0 条）；补的反转条件：一旦 `dup plugin names` 非零，先给 `trustDecide` 加「按名字解析到多根 ⇒ fail-closed」。
* 不给 `--plugins` 加 `--json` 面（现在没有消费者；先让文字面被真用一次）。
* 不动桌面面板：S2-12 那轮已经让 pending 的 loose skill 能列能批，这一格缺的是 CLI 侧。
* 不扫用户级 skill 根（`~/.dsh/skills` 之类）——现读没有消费者，且会把免信任的目录变大。
* 不装 `.git/hooks/pre-commit`（共享状态，等业主明文点头）。

## 8. 复算命令（逐字）

```sh
node --import tsx src/cli.ts --plugins
M2E_TRUST_FILE=/tmp/t437/trust.json node --import tsx src/cli.ts --trust-plugin graphflow; echo RC=$?
node --import tsx scripts/mutate-verify.mjs --check-needles; echo RC=$?
node --import tsx scripts/prose-needle-scan.ts; echo RC=$?
node --import tsx scripts/docs-check.ts; echo RC=$?
node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts tests/plugin-cli-face.test.ts
```
