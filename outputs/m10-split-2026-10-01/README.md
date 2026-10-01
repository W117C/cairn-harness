# M10 拆分第一轮 · 系统提示词面搬出 2,771 行的 `agent-runner.ts`（2026-10-01）

**一句话**：按计划书 M10 第③项"只做一轮"抽了一块——`BASE_SYSTEM` + 按档取面 → 新模块
`src/agent/system-prompt.ts`（56 行）；**行为逐字未变**（sha256 相同、8 条变异锚点全被杀、尺子读数逐字相同），
**门的取料面从 111 个模块降到 53／64**。
代码在分支 `feat/m10-split-prompt-face`（两笔：`8a71c09` + `f7a15ae`），**待集成 owner 合并**（见 §八）。

---

## 一、为什么挑这一块（不是随手挑的）

计划书原文：「把 `agent-runner.ts` / `orchestrator.ts` 里的**纯函数口径**抽到独立模块…
**每抽一块必须全量绿 + 门禁绿**」。

`agent-runner.ts`（2,771 行）里最纯的一块就是**系统提示词面**：

| 属性 | 值 |
|---|---|
| 内容 | 一段 697 字的常量文本（`BASE_SYSTEM`）+ read-only 档两张改写表 + 一个纯函数 `systemPromptFor` |
| 依赖 | **零**——唯一引入是 `applyModeLineEdits`（`./prompt-surface`，那里才是"按档改共用文本"的唯一做法） |
| 观察密度 | **8 条变异锚点**钉在这份文本的**字面量**上 + 3 个判卷文件 + 2 道门从外面读它 |

**观察越密 ⇒ "行为没变"越可证。** 这是选它的唯一理由：一块没人看着的代码，"我没改坏"只能靠嘴说；
这一块有 8 副牙齿盯着，我能让机器替我说。

**没选那一簇看似更划算的**（`resolveRunModel` / `budgetPriceKeyOf` / `scriptedMainModelPath` / `mainUsageModelOf`，
只有 2 条锚点）：它跟 `ROOT` / `GATE_FIXTURE` / `LSP_DEMO_FIXTURE` 这些夹具路径常量**纠缠在一起**，
搬它得把那一串路径常量一起搬 ⇒ 那已经不是"抽纯函数口径"，而是搬家。**锚点少的簇不一定好搬**。

---

## 二、读数（验收项要的"行数与扇入"）

| 读数 | 主树（`5c0510c`） | 分支（`f7a15ae`） | 变化 |
|---|---:|---:|---|
| `src/main/agent-runner.ts` 行数 | 2,771 | **2,738** | −33 |
| `src/agent/system-prompt.ts` 行数 | —（不存在） | **56** | 新增 |
| 扇入：import `agent-runner` 的仓内文件数 | 39 | **37** | −2 |
| `scripts/prompt-cost.ts` 传递依赖模块数 | **111** | **53** | **−52%** |
| `scripts/prompt-surface-check.ts` 传递依赖模块数 | **111** | **64** | **−42%** |
| 新模块自己的传递依赖模块数 | — | **16** | 它确实是轻的 |

> 传递依赖是**静态**算的（沿 `import`/`export … from` 的**相对路径**做闭包；包依赖不算本仓模块面）——
> 比"import 花了多少毫秒"稳：实测同一个入口的动态 import 中位 5.7ms、离群值 456ms（每次带 query 重估全图，
> 噪声盖过信号）。**读数要用稳的那把尺。**

---

## 三、★ 拆巨型文件必须先做的一件事：**变异锚点同步改指**

**这是本次摸出来的、计划书里没写的硬依赖。** 本仓用**变异锚点**做规模化反向验证（全仓 **1,213 条**），
而锚点靠 `s.replace("<源文本字面量>", …)` 定位——**文本被搬走，锚点就失针**。

| 文件 | 锚点数 |
|---|---:|
| `src/main/agent-runner.ts` | **70** |
| `src/agent/orchestrator.ts` | **51** |
| 全仓 | **1,213** |

**本仓已经被咬过一次**：`d1371dd` 把实现搬走、没同步改指锚点，4 条锚点失针，
`mutate-needles-check` 到现在还是红的（那笔账挂在任务 #23 上）。我动手前的基线就是这个数：
**阻断 5 条**。搬完代码**不还这笔账，就等于给这笔账加利息**。

本次实际搬走的文本里钉着 **8 条**锚点，全部同步把 `src:` 从 `src/main/agent-runner.ts` 改指
`src/agent/system-prompt.ts`：

| 锚点 | 它守的是哪条纪律 |
|---|---|
| `base-system-test-first-rule-removed` | 「先写复现测试跑到红」（能力 5 最关键那条的字面抓手） |
| `base-system-patch-first-rule-removed` | 「改已有文件用 edit_file 打补丁」 |
| `base-system-judging-file-conflict-restored` | 「第 4 条是新增用例，不是改判卷面」 |
| `orchestration-rule-dropped` | 整段编排纪律 |
| `orchestration-collect-duty-removed` | 「派完先调 wait_for_agents 收队」半句 |
| `orchestration-taskbook-removed` | 「任务书必须自包含」半句 |
| `orchestration-rule-renumbered` | 编排段不许编进 1–6（断号会让模型以为后面可省） |
| `prompt-surface-readonly-text-not-applied` | 装配点真的按档取文本 |

**另有两条看着同族、刻意没动**：`verify-exec-pnpm-mapping-lost` 与 `sandbox-model-alias-widened`——
它们守的是**沙箱命令映射**，那段**留在原地**。**锚点改指必须对着"针脚真的搬了"改，不能按名字顺手一起改**。

### 可复用的操作规程（下次拆 `orchestrator.ts` 直接照这个走）

1. **选块前先普查**：把候选范围的行号与全部锚点针脚的行号求交 —— 落在范围里的锚点，就是这次要还的账。
2. **逐字搬**：一个空格都不能改（锚点认字面量）。搬完拿 **sha256** 比对新旧输出，别靠肉眼。
3. **同步改指**：只改针脚真的搬走的那几条；留下的（如本例的沙箱映射）一条都不许动。
4. **提交后再体检**：`--check-needles` 里"被测面不在 HEAD 里"那一类**只能靠提交消除**——
   没提交时它一定报（检查器自己写着修法："把那份源文件提交"）。
5. **拿变异验证收口**：`mutate-verify <这 8 条 id>` 必须 **8/8 被杀死**。

---

## 四、"行为没变"的四条证明（都不靠"我看了一遍"）

| # | 证明 | 读数 |
|---|---|---|
| 1 | **逐字等价** | `BASE_SYSTEM` 与四个档面的 sha256 搬迁前后**完全相同**：`BASE_SYSTEM=8b392601f917f106`（697 字）／`read-only=fcf369c856228306`（581 字）／`default`=`guided`=`auto`=`undefined` 与 `BASE_SYSTEM` 同 sha |
| 2 | **对外接口一行不变** | `agent-runner.ts` 再导出（与 `gates.ts` 再导出 `assertion-health` 同一惯例）⇒ 3 个判卷文件与其它消费方**一行都没改** |
| 3 | **8 副牙齿全在** | 同步改指后逐条跑变异：**8/8 被正确杀死**，`全部变异被正确杀死（断言非真）`，本次耗时 16.8s（每条 2 拍） |
| 4 | **尺子读数逐字相同** | `prompt-cost --json` 两树输出一致（read-only 1270 / default 2501 / guided 2501…）；判卷文件数 3632 的时代与工作树 270 文件 / 3627 条均全绿 |

**门禁**：`typecheck` 0 报错；20 道快门面 **20/20 绿**；`prompt-surface-check` / `head-import-check` /
`docs-check` 3/3 绿；**针脚体检 阻断 5 → 阻断 5（与主树基线逐字相同，我没让门变坏）**。

---

## 五、自己踩的坑（写进代码注释了，也记在这儿）

1. **`export { X } from "…"` 不进本地作用域。** 我先只写了再导出，改完立刻两条
   `Cannot find name 'BASE_SYSTEM'`——因为本文件下面还有两处在**本地**用它（`providerFor` 与脚本通道两个
   `createProvider` 调用点）。正确写法是**先 `import` 再 `export`**，两条都在。这类坑不靠读文档、靠 typecheck 抓。
2. **工作树里 `--check-needles` 会先报 8 条"未入库面"**，看着像自己弄坏了，其实是**没提交**。
   报告里"未入库面"那一栏就是给这件事用的——读它之前先看有没有未提交的新文件。

---

## 六、计划书验收项对照

| 验收项（M10 原文） | 本笔 |
|---|---|
| 拆分（只做一轮，不求拆完） | ✅ 一轮 = 提示词面一块（`orchestrator.ts` 未动，见 §七） |
| 抽**纯函数口径**到独立模块 | ✅ 零依赖的常量文本 + 一个纯函数 |
| 每抽一块必须**全量绿 + 门禁绿** | ✅ 270 文件 / 3627 条绿；20 道快门面 20/20 绿；typecheck 0 |
| **行数与扇入读数改善** | ✅ 2,771→2,738 行；扇入 39→37；门的取料面 111→53／64 |
| 降智信号清单落 `outputs/` | ✅ 已在 `outputs/m10-degradation-signals-2026-10-01/` |
| `no-progress` 有生产调用者 | ⏸️ **未做**——调用点在 `loop.ts`（M5 写范围），我已交**接线请求**，见同目录 §五之二 |

---

## 七、诚实标注

- **`orchestrator.ts`（2,564 行 / 51 条锚点）一个字没动。** 计划书说"只做一轮，不求拆完"，这是那一轮的边界。
- **那 5 条既有坏锚点不是我引入的**：动手前后都是 5，逐字相同。任务 #23 的账我没顺手替它还（越界）。
- **块小是本轮的取舍，不是成果的上限**：−33 行对 2,771 行是零头。价值在**操作规程**（§三）——
  下次拆 `orchestrator.ts` 时，51 条锚点要先普查、再逐条判"搬没搬"，那一步不做就会重演 `d1371dd`。
- **传递依赖计数只算相对路径**：包依赖（`node_modules`）不计入，所以这个数是"本仓模块面"的口径，不是"总加载量"。
- **判卷数量在两棵树间不可直接比**：主树 3,632 条里含**未跟踪的在飞用例**（`tests/impact-multilang.test.ts` 等）；
  分支是干净树，270 文件 / 3,627 条。要比就比"同一棵树上的绿/红"，不要比条数。

---

## 八、给集成 owner 的一件事

代码在分支上，**我没有自己并**——按计划书 §5.3「合并由集成 owner（或业主）做，不由模块作者自己并」，
这条规矩正是为了防"我并我自己"跳过审查（我并 `port2` 时踩过：与另一个会话同时改同一个测试文件，
我的修法作废、还要额外撤一次重复机制）。

```sh
git log --oneline 5c0510c..feat/m10-split-prompt-face   # 两笔：8a71c09（搬迁+改指）、f7a15ae（消费方）
git merge --no-ff feat/m10-split-prompt-face            # 基点即 zcode 的 5c0510c；若 zcode 已前进，冲突面只在这 4 个文件
```

涉及文件（冲突面就这些）：`src/agent/system-prompt.ts`（新）、`src/main/agent-runner.ts`、
`scripts/mutate-verify.mjs`、`scripts/prompt-cost.ts`、`scripts/prompt-surface-check.ts`。

**合并是干的**：`git merge-tree --write-tree zcode feat/m10-split-prompt-face` **exit=0**（无冲突），
且 `zcode` 自 `5c0510c` 起**没动过** ⇒ 分支是直系后代，合并就是快进。
改动面只有 5 个文件：`+82 −50`（`scripts/mutate-verify.mjs` 16 行、`scripts/prompt-cost.ts` 5、
`scripts/prompt-surface-check.ts` 4、`src/agent/system-prompt.ts` 56、`src/main/agent-runner.ts` 51）。

**清理**：验证用的工作树 `.worktrees/m10-split` **已回收**（本机工作树已有 98 棵，不留多余的一棵；
改动全在分支上，不依赖那棵树）。要复跑 §九 的读数就自己起一棵：

```sh
git worktree add .worktrees/m10-split feat/m10-split-prompt-face && cp -al node_modules .worktrees/m10-split/node_modules
```

## 九、怎么复现这几条读数

```sh
# 逐字等价（两个树各跑一次，比 sha）
node --import tsx outputs/m10-split-2026-10-01/prompt-sha.mts "<树根>"          # 见 §四 表 1 的读数

# 8 条锚点还咬不咬得住
node --import tsx scripts/mutate-verify.mjs base-system-test-first-rule-removed \
  base-system-patch-first-rule-removed base-system-judging-file-conflict-restored \
  orchestration-rule-dropped orchestration-collect-duty-removed \
  orchestration-taskbook-removed orchestration-rule-renumbered \
  prompt-surface-readonly-text-not-applied

# 针脚体检（主树基线也是阻断 5）
node --import tsx scripts/mutate-verify.mjs --check-needles

# 传递依赖模块数（静态闭包；脚本见 §二 的口径说明）
node --import tsx outputs/m10-split-2026-10-01/graph-count.mts "<树根>" "scripts/prompt-cost.ts"

# 动态 import 成本（§二 那个"不稳"的读数就是这么来的：5 次带 query 重估全图）
node --import tsx outputs/m10-split-2026-10-01/import-cost.mts "<树根>" "/src/main/agent-runner.ts" 5
```

## 十、锚点普查的原始读数

`anchors-agent-runner.json`（本次生成的原始读数）：全仓锚点 1,213 条；
`agent-runner.ts` 70 条，其中针脚能在文件里定位到 **60** 条、9 条是单引号/多行针脚（我的取针正则只认双引号）、
**1 条已失针**（`sandbox-mapping-copy-reintroduced`，与 §三 那笔 `d1371dd` 的账同族）。
针脚行号分布（用来判断"哪一段动得起"）：`149 150 152 156×4 197 310 361 433 456 463 530 635 654×2 736 779 922 1439 1443 1447 1585…2241 2318`。
