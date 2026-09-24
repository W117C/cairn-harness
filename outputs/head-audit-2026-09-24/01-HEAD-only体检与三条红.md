# 第 44 页 · 整条会话的 HEAD-only 体检：三条红里有一条是本线欠的

日期 2026-09-24。做这页的原因很朴素：本会话今天报的每一个「typecheck 绿」都是**盘上**读数，
而盘上有别人的未提交改动。规则 141 已经记过一次这个形状，但它当时只记到「HEAD 报 34 条」就停了，
**归因没判完**——这页把那件事判到底，并顺手把 HEAD 的另外两面（针脚、全量测试）量了。

## 一、读数（四行，全部可复跑）

隔离树：`git worktree add --detach .worktrees/head-audit-0924 HEAD` + `cp -al node_modules .worktrees/head-audit-0924/`。

| 面 | 读数 | 命令（在该树根跑） |
| --- | --- | --- |
| typecheck（原样） | **34 条错**，全在 `src/main/index.ts`(32) + `src/preload/index.ts`(2) | `TERM=dumb node --import tsx scripts/typecheck.ts` |
| typecheck（补 4 条顶层链接后） | **0 条错** ✅ | 同上，前置见 §二 |
| 变异针脚体检 | 963 条：阻断 **0**、待复认 3、未覆盖 0、钉在飞文本 **0** ⇒ exit 0 | `TERM=dumb node scripts/mutate-verify.mjs --check-needles` |
| 全量测试 | 252 文件 / 2673 条：**3 failed**, 2670 passed ⇒ exit **1** | `TERM=dumb node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts` |

## 二、那 34 条不是 HEAD 缺陷（归因判完，别停在「先按环境判」）

- 构成：3×`TS2307 Cannot find module 'electron'` + 31×`TS7006 Parameter '_event' implicitly has an 'any' type`。
  后者是前者的**下游**：模块解析不到 ⇒ `ipcMain.on(...)` 回调参数拿不到类型 ⇒ `noImplicitAny` 逐参数各报一条。
- 根因：`cp -al node_modules` 复制的是**当前已装面**，不是 **HEAD 声明的依赖面**。
  `git show HEAD:package.json` 声明 `electron ^44.2.0` / `electron-builder` / `electron-vite` / `vite` 四个，
  而盘上未提交的 `package.json` 只剩 `vitest` 命中这一族，且重装过 ⇒ 顶层链接没了（包体仍在 `.pnpm` 里）。
- 补链接（不联网、不动主树）后同一棵 HEAD 报 0 错：
  `ln -s .pnpm/<name>@<ver>…/node_modules/<name> <name>`，`name ∈ {electron, electron-builder, electron-vite, vite}`。
- ⇒ **通用找法**：在隔离树跑任何依赖敏感的门之前，先做差集
  `git show HEAD:package.json` 的 deps ∩ `ls node_modules`，缺项先补链接再读红。
  一个错的归因（「HEAD 本来就红」）会直接关掉下一步（「那我不必再查」）。

## 三、HEAD 上确有 3 条红测，且**不属**在飞改动

对照：同三条用例在**主树盘上**（含别人的全部未提交改动）跑出**逐字相同**的三个数 ⇒ 确定性红，
既不是他人未提交的实现缺口，也不是环境。**这条读数直接推翻「pnpm test 在 HEAD 是绿的」这个默认预期。**

| 用例 | 断言（两棵树同数） | 归属 |
| --- | --- | --- |
| `tests/compaction-cost.test.ts:148` | `expected 6 to be less than or equal to 5` | 压缩摊销线（`a228a19`/`c46db3c`），非本会话 |
| `tests/gym-long-replay.test.ts:88` | `expected 5 to be less than or equal to 4` | 同上（同一条链的 A/B 面） |
| `tests/skill-tool-policy.test.ts:217` | 摘除后剩 10 把，期望 3 把 | **本线欠的**，见 §四 |

前两条的语义是「**把摊销开关打开 ⇒ 压缩次数反而更多**」——那是那条能力线的产品缺陷，
不由本会话替它改（改谁的缺陷 = 抢别人的原子单元），此处只署名并把数留下。

## 四、§9.3 申报面：七把工具对 `disallowed-tools` 免疫

`tests/skill-tool-policy.test.ts` 那条红报的是：一条 skill 申报「把整个 `TOOL_NAMES` 键域全摘」之后，
模型面上**还剩**这七把本该被摘掉的：

```
automation_create  automation_update  automation_delete  automation_list  automation_run_now
cancel_agents      refine_goal
```

机制读法（三段，全在 shipped 实现里）：

1. `src/agent/plugins/skills.ts` 的 `skillToolPolicy()` 用 `resolveToolName()` 归一申报名；
2. `resolveToolName()`（`src/tools/base.ts`）只认 `TOOL_NAMES` ∪ `CC_TOOL_ALIAS`，认不出 ⇒ `null`；
3. `null` 被推进 `unknown` 桶（"点名，不静默丢"），**于是这条 deny 根本没进 `deny[]`，闸没收到它**。

⇒ 后果不是账面难看：`disallowed-tools` 是 §9.3 的**权限联动承诺**，而它今天**够不到运行时注入面**——
包括 `spawn_agent` 这种 `mainSessionSideEffect: true` 的工具（见 `src/agent/tool-surface.ts`）。
一条写着「禁用一切」的 skill 今天禁不掉派活、禁不掉排定时任务。这正是本仓判死过多次的那一族：
**机制挂在手抄登记表上，换一种形状即静默绕过**（规则 64 / 第十三族），只是这次的"登记表"是 `TOOL_NAMES`。

## 五、两个候选改法，各自量过牵连（不凭感觉选）

| 改法 | 做法 | 实测牵连 | 冲突 |
| --- | --- | --- | --- |
| A：把七把并进 `TOOL_NAMES` | 静态改 3 行（名字表即联合类型） | 试验树里 **typecheck 0 错**、全量 **252 文件里 250 绿**（只剩 §三那两条压缩红），且**现有判据一字未改即转绿**（2671 passed vs 2670） | 与 `tool-surface.ts` 的入表条件相反（那行写「该工具**不在**静态注册表里」才进注入面清单），且会把 `ToolName` 从「M0a 静态内核」扩成「整张模型面」 |
| B：申报域 = 整张模型面 | `resolveToolName` 回落认 `TOOL_NAMES ∪ INJECTED_TOOLS[].name`（**复用现成唯一清单，不再手抄**）；`SkillToolPolicy.deny/allow` 由 `ToolName[]` 放宽到名字串 | 需要改判据：那条用例的申报源必须从 `TOOL_NAMES` 换成「整张面」，期望残差随之变 | 改动跨 `plugins/skills.ts` + `main/agent-runner.ts`（后者是并发热点），且**扩大第三方插件能压制的面** ⇒ 属政策裁决 |

**A 更便宜且不动判据，但它让 `ToolName` 的含义与自己文档里的定义相反**——这个名字表若变成"整张面"，
`toolTableFor()`（`src/permissions/autonomy.ts:505`，注释自称「与 gateToolSpecs 的工具集同源」，实际是
**又一份手抄的十把**）就同时变成第四份抄本。**没有一条 A/B 之争是纯技术的**：A 修账面，B 修机制。

⇒ 因此本线**不落 A**：A 会让"下次加第八把"继续静默漏（判据只数了 `TOOL_NAMES` 的长度），
而 B 的机制判据是"`INJECTED_TOOLS` 里每一行都可申报"——加一行即自动可申报，不需要有人记得改第三张表。
B 的政策侧（插件能压制 `spawn_agent` 算不算越界）交用户裁，见 `BLOCKED.md` 本追加段。

## 六、今天可判的断言（已登记进 `verify-claims.mts`）

- **44:C1**（谓词跑 shipped 实现，不读源码文本）：`resolveToolName("automation_create") === null`
  ⇒ 成立 = 缺口还在；一旦被修掉，该谓词变假，机器 exit 1 并点名"该页这句不再成立"。
- **44:C2**（分母，形状类）：`INJECTED_TOOLS` 里名字不在 `TOOL_NAMES` 的条数 > 0
  ⇒ 即"注入面对申报面不可达"的规模读数（今天 14 条全不在）。

## 判据表（这两条今天必红，且已落成可跑谓词）

| C1 | 一条 skill 在 `disallowed-tools` 里写 `automation_create`，今天必红地被当成不存在的名字丢掉（deny 收不到它） | `resolveToolName("automation_create") === null`，跑 shipped 实现 |
| C2 | 注入面里有名字的工具体在 `TOOL_NAMES` 之外，今天必红地成立（14 条全在外）⇒ 申报域与模型面不同源 | `INJECTED_TOOLS.some(t => !TOOL_NAMES.includes(t.name))`，分母由两张现成表相减，不手抄 |

> 顺带把本仓自己那台覆盖机的一条盲区留在这里：它按**措辞**抽判据行，且只认 `## 四、`／`## 判据表` 段里的
> 表行。本页第一版把断言写成 §六 的项目符号 ⇒ `claim-coverage` 抽 0 行而 exit 0，
> **一条"没被抽到"看起来完全像"没有欠登记"**。所以判据行必须落在它能抽的形状上（见规则 136 的近亲）。

## 七、顺带查到的方向变更（只记事实，不评价）

主树 `BLOCKED.md` 已被并发会话改写为：「The requested **desktop layer removal** is complete …
No desktop blocker is tracked in this **core-only checkout**」，且该改动**未提交**。与之一致的盘上事实：
`src/main/index.ts`、`src/preload/index.ts` 在盘上是删除态，`src/renderer/*` 整批删除，
`package.json` 剥掉 electron 系四个依赖，`scripts/mutate-verify.mjs` 少 159 条锚点（盘上 804 / HEAD 963）。
⇒ **HEAD 仍是"桌面 agent"，盘上正在变成"core-only"**。这不影响本页任何读数的正确性
（读数全部在 HEAD 隔离树里跑），但它决定下一条能力该落在哪一层——**待用户裁**。

> **为什么这条裁决请求没写进 `BLOCKED.md`**：那个文件此刻整体在别人的未提交原子单元里
> （上面那段英文就是他们改的）。我的追加段没有 HEAD 里的上下文可贴 ⇒
> 只暂存自己那一 hunk 在机械上做不到（context 对不上）。本页 §五/§六 即是该请求的载体，
> 待 `BLOCKED.md` 回到干净态时把同一段文字挪过去，**别另立第二处事实源**。

## 八、未做与撤针条件

- 没有改任何 shipped 代码：A/B 的选择先落判据（§六）再落实现，避免"先动共享内核再找理由"。
- §三前两条红**不由本会话修**；若那条线自己收口（两条转绿），本段的数就过期，按规则 75 连前提一起复跑。
- 撤针条件：`tests/skill-tool-policy.test.ts:212` 那条转绿（无论走 A 还是 B）⇒ §四 的"七把免疫"句失效，
  届时在本页追加二次复核块，**不回改本节原文**（那是该日快照）。

## 九、二次复核（同日，约 20 分钟后）：§三 的归因**是错的**，两条红也是我欠的

§三 写着「前两条属压缩摊销线（`a228a19`/`c46db3c`/`6b8895d`），非本会话」。**逐笔定点复跑推翻它**：

| 判据 | 绿 | 红 | 翻面那一笔 |
| --- | --- | --- | --- |
| `tests/gym-long-replay.test.ts:88` | `dee8139`（面 6,544 B） | `a0db9ea`（面 7,180 B） | **`a0db9ea` refine_goal 规格**（本线） |
| `tests/compaction-cost.test.ts:148` | `a0db9ea` | `bd2cf3e`（面 10,024 B） | **`bd2cf3e` 定时五件规格**（本线） |

（复跑法：同一棵 HEAD 隔离树里 `git checkout --detach <sha>` + 只跑那一个测试文件，逐格读数一致。）

**真机制**：这两条 A/B 把「每请求固定开销」取成**活的工具面**，而触发点 = 阈值 − 该常数。
实测这条链的有效窗口只有 **~640 B**：6,544 绿 / 7,180 红 / 10,024 红。所以任何一次往模型面加规格
都会撞红它，而撞红的一方**看不到任何因果**（它没碰压缩）。**上一版的错**：我只核到"盘上=HEAD 同数"
就判"不是未提交缺口 ⇒ 是那条线的产品缺陷"——那是把**归因**与**定性**混成一跳；
少了「逐笔复跑找翻面提交」这一步，就直接把账记错了人。

**已修（同一个原子单元）**：给 `probeAssembly`/`replayLongAssembly` 加 `toolsOverride` 接缝
（缺省 undefined ⇒ 逐字节旧行为），两条判卷各把面**冻成常数**：
- gym 钉回当初那档（13 把 × 描述重复 122 次 = 6,543 B）⇒ **三条断言一字未改即转绿**；
- compaction-cost 钉成小常数，并顺手把「压缩次数不更多」收紧成「**严格**更少」
  （只写 `≤` 时，把整条摊销策略摘掉照样绿 ⇒ 那条护栏本来没有观察着）。

**分辨力两侧都当场验过**：在干净 HEAD 树里把 `amortizedCompactionConfig` 改成恒返回 undefined ⇒
四条 A/B 断言全红（含 `expected 3 to be less than 3`）。中途还踩到"冻结过度"：
第一次把面钉成 1 把小规格，两支作废字节变成 `26604 vs 26604`、断言读成 `expected 0 < 0`
——那是**样本失去分辨力**，不是策略坏，于是改钉回原尺寸档。

**认证读数（HEAD + 只我这三个文件，隔离树全量）**：`2673` 条里 **1 failed / 2672 passed**，
exit **1**；剩那一条正是 §四 的 `tests/skill-tool-policy.test.ts`（**待 #19 裁决**，不是新缺陷）。
主树侧：typecheck 0 错，`--check-needles` 阻断仍是原有那 5 条（我的 `probe.ts` 改动**没顶掉任何针脚**）。

## 十一、"三件错事"的第三件由读数裁成暂不建（`replay:cascade-traffic`）

verify 归因（judgment-layer §9 第 0 步）说环境红同时做三件错事：烧模型额度、触发升档换更贵的档、
被跨会话沉淀计成失败。今天实测：**第 1、3 件已经接好了**——`src/agent/loop.ts` 的
`if (!envBeat && chargedAttempts >= maxVerify)`（环境拍不占额度）与
`src/agent/memory/distill.ts` 的 `isEnvVerifyCause`（注释明写"两面都要挡"）。
**只有第 2 件没接**：`src/routing/cascade.ts` 里 `cause` 零命中，rung 的 `run()` 只交
`{ok, output?}` ⇒ 级联升档不看红的原因。

动它要改 `src/agent/orchestrator.ts` 的升档调用点（**本树最热的在飞文件之一**），所以先量分母：
新增复跑面 `scripts/replay/cascade-traffic.ts`。今天读数：

```
取料 = 20 个 jsonl · 红拍=3 其中带 cause 字段=0 环境因（结构∪文案）=0
不可测（路径零流量）：20 条流里 routing_decision=0 · [cascade] 播报=0
```

⇒ **裁：不在零流量的路上建机制**（与 pipeline 加环那一裁同形）。这里分子恒 0 只兼容
"机制没被触发"，**不**兼容"环境红没白花钱"；现在动 `orchestrator.ts` 拿不到任何可证的效果，
只会新增一格"装配存在但没人观测"。**反转条件（写死，别靠记忆）**：语料里出现 **≥1 次**升档
（`routing_decision.reason` 含 `cascade`，或有 `[cascade]` 播报）⇒ 本面会从「不可测」翻成
「该量」并直接印出环境因占比，那时再决定给 `runCascade` 的 rung 加 cause。

同轮三条自造的坑（全是本仓老规则又响了一次）：① 第一版把环境因集合**手抄**进读数面，
还漏了 `no-surface`/`hook-error`、多写了不存在的 `no-deps` ⇒ 改回复用仓内唯一谓词
`isEnvVerifyCause`（规则 64/146）；② isMain 守卫第一版写 `import.meta.url === "file://" + argv[1]`，
本仓路径含空格被百分号编码 ⇒ 脚本会"exit 0 且什么都不印"；③ 自检第一版期望值写错
（合成流里只有 1 条 `routing_decision`，我写 2）⇒ **尺把自己拦在 exit 1**，
这正是"每次跑都注入自检"要买的东西（规则 74）。

## 十二、`toolTableFor`：注释自称"与 gateToolSpecs 同源"，实测是第四份手抄表

顺着 §十一 找"还有没有别的消费面没接 cause"时撞到的。`src/permissions/autonomy.ts` 里
`toolTableFor(mode)` 注释写「与 `gateToolSpecs` 的工具集同源」，实测（shipped 实现、HEAD 与盘上同数）：

| 面 | 表 `toolTableFor` | 真发货 `sessionToolSpecs` | 差 |
| --- | --- | --- | --- |
| default | 10 把 | **20 把** | 表少 10 把（定时五件、`cancel_agents`、`refine_goal`、`remember`、`spawn_agent`、`wait_for_agents`） |
| read-only | 7 把 | 8 把 | 表少 `refine_goal` |
| "写向"集合 | 3 把（`edit_file`/`run_shell`/`write_file`） | **12 把** | 差 9 把（含 `spawn_agent`、五个 `automation_*`） |

⇒ 后果不是产品行为错（只读档真把注入面摘了，`tool-surface.ts` + G-B 那条逐行对账守着），
而是 **`scripts/autonomy-check.ts` 那句「只读档：写向工具从工具表摘除（模型上下文不可见）」
证明的范围只有它字面的一半**——它读的是这张 10 把的表。这属本仓点名的"同一谓词多份副本、
宽度各不相同"（第十三族）与"注释自称同款接线、代码是另一回事"（第八次复发）的合流。

**已做（刻意选最小、且不动行为）**：那张手抄名单改成读 `TOOL_NAMES`（实测两边**逐字同集**），
注释改成写清"只覆盖静态注册表这一组，注入面归 tool-surface + G-B"。
等价性不是嘴说的：改前/改后对四个档（`read-only`/`default`/`guided`/`auto`）各跑一次
`toolTableFor` 并 `diff` ⇒ **逐字相同**；`autonomy-check` 门 exit 0、
`tests/autonomy` + `tests/session-tools` + `tests/tool-surface-parity` 共 40 条全绿、
typecheck 0 错、针脚体检阻断仍是原有 5 条（没顶掉任何锚点）。

**没做（并说明为什么不划算）**：把 `toolTableFor` 扩成整张模型面会撞两个既有边界——
① 返回类型 `ToolName[]` 放宽 ⇒ 热文件 `tests/session-tools.test.ts`（别人在飞）会跟着编译红；
② `autonomy.ts` 若改从 `glm-session` 取面 ⇒ **成环**（`glm-session` 已 import `permissions/autonomy`）。
所以"表该不该等于模型面"与 §四/§五 的申报域是**同一个问题的两面**，一并交 #19 裁，
不在这里私自扩面（那会让 #19 的 A/B 之差被一次无关重构悄悄改掉）。

## 十三、HEAD-only 整表（37 道）第一次有数，并且它当场翻出一个今天早上的漏改

跑法（隔离树 = `6a06249`，`cp -al node_modules` + 硬链 `electron/dist`，实测 `require('electron')` 指向真二进制）：

```
cd .worktrees/head-audit-0924 && TERM=dumb CODEBUDDY_SAFE_DELETE_BULK_STATE_DIR= \
  node --import tsx scripts/gates.ts --direct
```

读数：**绿 27 / 红 10｜未证 12 项**（`--direct`，逐道退出码在 `/tmp/head-gates.log`）。
本页 §一 之前只有 vitest 面的读数（1 红），**整表从没在干净 HEAD 上跑过** ⇒ 这正是规矩 58「跑改动邻域 ≠ 跑那道门」的又一次实证：整表多抓出来的东西里，有一条是我自己今早的。

### 逐道归因（10 道红，五种性质）

| 门 | 退出 | 红在哪 | 归因 |
|---|---|---|---|
| `gate-check` | 1 | H7 冻结表与判卷区双向一致：`inTableNotOnDisk=[fixtures/no-progress/*.jsonl ×7]`，`onDiskNotInTable=[]` | **我第一版把它记成"环境（.jsonl 不在 git，新 worktree 天生没有）"——那条归因是错的，已在下方撤回。** 真因：HEAD 的 `src/frozen.ts:49` 只把 4 个目录当判卷区，而 `fixtures/no-progress` 在**冻结表里**却不在扫描区里 |
| `panels-check` | 1 | 整表里耗时 148,728ms，`[panels-check] 1 项失败 ❌`（失败名被"尾 12 行"窗口截掉） | **抖动，已用单跑复验定名**：同一棵树单跑 `node --import tsx scripts/panels-check.ts` ⇒ **全部断言通过 ✅**，且自带计时读数「起窗 9 次 · 等端口累计 6ms · 其中 0 次不是立刻空的」。这就是 HEAD 自己那条「panels-check 有实测时序 flake」与规矩 111（真窗口门与整表并发 ⇒ 假红）说的那一格 |
| `mutate-verify` | **124** | 无末行输出，gates 打「超时（1200s）… 整组 SIGKILL（子进程未自还原）」，耗时 1,215s | **预算**：这道门在 1200s 内跑不完冷树 ⇒ 认证面上它**没有读数**，不许记成"红"也不许记成"过" |
| `mutate-needles-check` | 1 | 唯一一条红字：「残留 `src/main/agent-runner.ts.mutbak`——针脚是从它算的，不可信」 | **上一条的下游后果**，不是独立缺陷：SIGKILL 正好落在突变窗口。复跑同一棵树 ⇒ **exit 0**，`963 条：阻断 0 / 待复认 3 / 未覆盖 0 / 逐行式 11 / 钉在飞文本 0`。⇒ 顺带得到一条新事实：**HEAD 的针脚阻断是 0**，§一 里主树那"原有 5 条"全属在飞文件 |
| `test` | 1 | 见下「`test` 这一格我抄错了，重测后是两条不同的事」 | **上一条推论不成立**：§一 的"唯一红＝`skill-tool-policy`"是**整表跑之前**的读数，且我没复核名字 |
| `gym-check` | 1 | 4 条：两条 B1「明卷两次跑逐字段一致」+ 另两条 | **判卷面含不可复现量**：`changedFiles` 里混进了 `.agent/snapshots/<毫秒>–<case>/src/…` ⇒ 两次跑的毫秒目录名必然不等 ⇒ 这条"自一致性"判据在任何一次跑上都恒假（靶场自己的尺，不是产品） |
| `prefix-churn-check` | 1 | PC7-摊销确实少付账（A/B 同一条会话）：关 ⇒ 压缩 5 次 / 重写 42,588 字符；开 ⇒ 压缩 6 次 / 重写 34,925 字符 | **今天第二个"我修了两支、漏了第三支"**：`501880b` 把压缩 A/B 的分母钉成常数时，只钉了 `tests/compaction-cost.test.ts` 与 `tests/gym-long-replay.test.ts`；PC7 是**同一件事的第三面**（它经 `createGlmSessionProvider` 吃**活工具面**），所以我改完它仍红 ⇒ 见下面「待办」 |
| `agents-check` / `schedule-check` / `ipc:check` | 各 1 | A1 / J1+J2 / 重放等价，三条都是 `JSON.stringify` 逐字比 | **一个今天早上的 shipped 决定的漏改**——详见下节，已复现、已给验证过的补丁 |

### `test` 这一格：我把 §一 的归因直接抄了过来，重测后它是**两条不同的事**

第一次写本节时我在表里填了"与 §一/§九 同一条：`skill-tool-policy`（#19 待裁），无新增"——那是**从退出码相等推出来的**，没有名字级证据。补测后：

1. **整跑（隔离树，`--config`，85.4s）**：`Test Files 2 failed | 251 passed (253)`、`Tests 1 failed | 2668 passed (2669)`。
   ⇒ **两行必须都读**：只看 `Tests 1 failed` 会漏掉那个**文件级**红（`Failed Suites 1`：`Cannot find module …/tests/chain-lease-held.test.ts`），而它一个用例都没跑就不算进 `Tests`。这是"汇总行也是判据"的又一格。
2. `tests/skill-tool-policy.test.ts:217` 那条（申报域应等于 `TOOL_NAMES` 十把）——**单跑 18/18 全绿，整跑才红**，红的形状正是 #19 那道叉：
   `expected ['automation_create', …(9)] to deeply equal ['remember','spawn_agent',…]` ⇒ 整跑时注入面那 7 把**没有被摘掉**，说明有另一个文件把工具注册表改在共享态里且没清（跨文件污染）。
   ⇒ 直接后果：**#19 的证据面本身是 order-dependent 的**——"A 案牵连为零"这类读数必须由该文件单跑给出，不能引用整跑的绿/红。
3. `tests/chain-lease-held.test.ts` **单跑 8/8 绿**，且该文件在隔离树里的 mtime 落在整跑窗口内（22:30，跑批起于 22:29:18、历时 85s）⇒ 那次 `Cannot find module` 是**跑到一半文件被重写**造成的。
   机制未定名（两个候选：① 有测试把 `mutate-verify` 当子进程跑，而表里确有 1 条锚点的 `src` 指向 `tests/**`；② 外部进程动过这棵树）。**不猜因果**：留成本节最后一条待查，并把"HEAD-only 全量 vitest 的数还不可复现"这句话写在这里，免得下一轮把 2669 当基线。

### 撤回一条我写错的归因：H7 不是"环境"，是**恒真红**（分辨只用了三步）

第一版表里我把 `gate-check` 的 H7 记成"`.jsonl` 语料从不在 git 里，新 worktree 天生没有 ⇒ 环境"。
这条听起来自洽（104 那一格确实说过"干净树上读到 0＝没有尺"），但它**没被证伪过**。补测：

1. `frozenCoverageDrift(隔离树)` 用隔离树自己的 `src/frozen.ts` ⇒ `inTableNotOnDisk=7`（与门上红字逐字同形）；
2. **反向那一侧**（缺这条就可能永远选错）：`frozenCoverageDrift(主树)` 用 **HEAD 那份实现**、而主树 7 份语料**确实在盘上**（`ls fixtures/no-progress/*.jsonl` = 7）⇒ 仍然 `inTableNotOnDisk=7`；
3. `src/frozen.ts:49` 取料：`areas` 只有 `fixtures/mock`、`fixtures/todo-app/tests`、`fixtures/gym/cases`、`fixtures/impact` 四项——**判卷表里有 `fixtures/no-progress`，扫描区里没有** ⇒ 表侧有、盘侧永远没有 ⇒ 无论文件在不在都红。

⇒ 定性：**判据缺陷（恒真红）**，不是环境、不是回归。我的"环境"说法把一次集合漏项说成了别人的语料没入库——那正是规矩 141 点名的"归因句一闭，下一步就没了"。
另一路读数（见下节的同页第二作者）与我独立撞到同一根因，且比我先给出 culprit（`90b0533` 加表、扫描区没跟着加）；
主树在飞的 `src/frozen.ts` 已把 `areas` 改成多项列表，实测同一函数返回 **0/0** ⇒ 这一根**别人已在修**，我不重复动。
方法论留一句：**两个相反归因都能自圆其说时，分辨动作是"把实现搬到另一棵树/另一个输入上再跑一次"**，不是再写一段理由。

### 本页现在有**两个** `## 十三、`：同一表面两个 writer（本仓明令避免的形态，记下来别再犯）

本节（`## 十三、HEAD-only 整表（37 道）第一次有数…`）与后一节
（`## 十三、整表跑完的二次复核：十道红逐道定名（同一棵隔离树，detached 6a06249）`）是同一天、同一棵我建的隔离树上
**两条独立跑的整表读数**——后者不是我写的（我编辑本节时系统两次提示"文件自上次读取后已被修改"）。
两半**不冲突且互补**，但重复编号会让下一次引用指错地方，所以在这里点名而不是改写别人的段落：

- 后一节做了我没做的**逐笔 bisect**，给出 culprit：`8361657`（ts）、`90b0533`（H7 表/区不一致）、`3391a65`（gym B1）、`aa30513`/`a0db9ea`（PC7 的时间界），
  并留了两条更值钱的方法论：① **`git checkout --detach <sha>` 会把未提交改动一路带走** ⇒ 第一次 bisect 的"五笔都红"是被污染的读数；② **「`exit≠0` 且 ❌ 计数 0」＝崩，不作红读**。
- 后一节把 `gym-check` B1 认成**已登记的债** `IDENTITY_DEBTS[0] D7-snapshot-path-ms`（"RD 那面用了分类器，B1 这面没用"）
  ⇒ 我据此**撤回**本轮新开的"这是新发现的尺缺陷"说法（那条与已登记的是一条，不是第二条）。
- 本节有后一节没有的三样：`panels-check` 的**单跑复验已定名**（同树单跑 ⇒ `全部断言通过 ✅`，起窗 9 次·等端口累计 6ms·0 次非立刻空 ⇒ 就是 HEAD 自陈的那条时序 flake 与规矩 111）；
  `test` 一格的**名字级证据**（`skill-tool-policy` 单跑 18/18 绿、整跑红 ⇒ 跨文件污染，且 `Test Files` 那行另有一道文件级红）；
  以及三面补丁的**门后复跑读数**（67✅/259✅/exit 0 + 针脚阻断 0 + typecheck 0）。

### 三条门红的同一条根因：`8361657` 改了 4 个判卷面，另有 3 个没改

`8361657`（**今天 04:06**，"事件流落盘处统一盖时钟戳"）把 `ts` 改成在 `append` 这一处盖（`src/events/index.ts:664` `stamped = { ...event, ts: event.ts ?? Date.now() }`），
commit message 自己写明：「四条「replay == 写入 / 两次 run 逐字节不变」判据随之改成只剥 ts 一个键再比（强度不降）」——它改的是 `tests/` 那 4 面（附 `tests/helpers/stream-equals.ts`）。
**同一句承诺在门面上还有 3 个副本没改**：`scripts/agents-check.ts:204`（A1）、`scripts/schedule-check.ts:475,476`（J1/J2）、`scripts/ipc-check.ts:79-82`（重放等价，拿"内存态"比"盘上态"）。
⇒ `pnpm gates` 从 04:06 起就是红的，而 **vitest 全绿**——所以这条只能被整表抓到。这就是同族副本那一族（`dsh-sibling-exec-policies` 第十三族）第一次踩在**判卷面自己**身上。

复现（一次性，写在隔离树里 `repro-roundtrip.mts`，跑完即随树删）：

```
#0 不一致
   append 前: {"type":"user_message","content":"hi"}
   replay 后: {"type":"user_message","content":"hi","ts":1790259570673}
```

**验证过的补丁（17 行，三面各引现成的 `stripTs`，不新造第四份口径）**，形状一律是"剥 `ts` 一个键后逐字比 **+ 每条必须带数字 `ts`**"——
第二半是**加强**：旧写法根本无法表达"戳真的盖上了"，剥键之后如果不补这半句，就是把判据改松（规矩 130 要求的"实现前后都跑"两侧都在这里）。
J2 改成 `raw.endsWith(JSON.stringify(back[3]))`：它要钉的是"行字节 = 该事件自己的序列化、没有被重排/美化"，用**落盘后**的那个对象当期望，承诺不变而戳在场。

```diff
-    check(JSON.stringify(legacyReplayed) === JSON.stringify(legacy), "A1 旧形态日志重放逐字无损");
+    check(
+      JSON.stringify(stripTs(legacyReplayed)) === JSON.stringify(legacy) &&
+        legacyReplayed.every((e) => typeof (e as { ts?: unknown }).ts === "number"),
+      "A1 旧形态日志重放逐字无损（剥落盘时钟戳 `ts` 一个键，且每条都必须带数字 ts）",
+    );
```
（另两面同形状；`ipc-check` 是 `stripTs(fromDisk)` vs `stripTs(collected)`，`schedule-check` 是 J1 同形 + J2 换期望对象。）

隔离树实测：`schedule-check` **67 ✅ / 0 ❌ exit 0**（原 65/2）、`agents-check` **259 ✅ / 0 ❌ exit 0**（原 258/1）、
`ipc:check` **exit 0（分支 A 靶子修复）**；改完复跑 `--check-needles` ⇒ **阻断 0**（没顶掉任何针脚）、`typecheck` ⇒ **0 错**。

**为什么没有落进主树**：这三个文件正是桌面层那笔在飞改动里被删的一个子集——
`comm -23` 实测 HEAD 37 道 → 盘上 26 道，被删的 11 道里就含 `agents-check / ipc:check / schedule-check`。
主树里它们对 HEAD 是 `D`，我去改盘等于把别人原子单元里删掉的东西**悄悄复活**（AGENTS.md「提交前相交检查」+ 规矩：preserve unrelated dirty changes）。
⇒ 补丁以本节为载体，交 #20 落地时一起走；**若 core-only 方向成立，这 3 个守门人会消失，"重放逐字无损"只剩 `tests/` 那 4 面**——那 4 面也有一部分在渲染层树里，届时须重读一遍还剩几面。

### 待办（由本次读数直接产生）

1. **PC7 是今天第三个"活工具面"分母**：把 `501880b` 的冻结面搬进 `scripts/prefix-churn-check.ts` 之前，先按规矩 121 问一句"那支的限制是谁要的"——PC7 明确写了「tail 三个旋钮刻意不覆盖：拿生产缺省」，
   说明它**故意**贴近生产装配面；那么钉工具面就与它的原意冲突。两条出路：① 给它一条与 A/B 同向的**绝对量**判据（少付字节数 + 压缩次数不增，分母用当场读到的面尺寸归一）；② 承认它量的是"生产缺省下是否仍成立"，那它红 = **真红**，须改产品摊销而不是改尺。
   ⇒ 本轮不擅自动它（两种读法结论相反，而 ② 会牵动摊销策略本体）。
2. **gym-check 的 B1 自一致性判据要剔掉时刻量**：`.agent/snapshots/<毫秒>--<case>` 不该出现在"两次 run 逐字段一致"的比较字段里（要么归一化掉快照前缀，要么把 `changedFiles` 收成仓内相对路径集）。这条与产品无关，是靶场的尺。
3. `mutate-verify` 需要一个能跑完的预算（冷树 >1200s），否则"HEAD-only 认证"永远缺一道门；先量一遍它单跑要多久再决定（不凭感觉调大）。

## 十三、整表跑完的二次复核：十道红逐道定名（同一棵隔离树，detached `6a06249`）

第一节那张表只跑到一半（当时 8 道红）。整表落定后是 **绿 27 / 37，红 10**：
`test=1 ipc:check=1 gate-check=1 panels-check=1 agents-check=1 schedule-check=1 gym-check=1 prefix-churn-check=1 mutate-verify=124 mutate-needles-check=1`
（余下全 0，含 `typecheck=0`、`e2e=0`、`build=0`、`plugins-check=0`、`supervisor-check=0`、`a11y-check=0`。）

| 红门 | 一根原因（实测，非推断） | culprit | 归谁 |
| --- | --- | --- | --- |
| `test` | 唯一一条是 §9.3 待裁那条（申报域 A/B），2672/2673 | — | 待用户裁（#19） |
| `ipc:check` `agents-check` `schedule-check` | 三道同一根：`append` 处新盖的 `ts` 没穿到门这面，"replay == 写入"恒不等 | `8361657` | 我；补丁在 §十二，未落盘（文件在别人的原子单元里是 `D`） |
| `gate-check` H7 | **新发现、独立一根**：HEAD 的 `frozenCoverageDrift` 只扫四个判卷区，`fixtures/no-progress` 进了冻结表却没进扫描区 ⇒ 表里有、"盘上没有"恒红 | `90b0533` 加表，扫描区没跟着加 | 别人的在飞改动已在修（`src/frozen.ts`/`scripts/gate-check.ts` 都是 `M`） |
| `gym-check` B1 ×4 | 差异只在快照目录名的毫秒 ⇒ 与已登记的 `IDENTITY_DEBTS[0] D7-snapshot-path-ms` 是同一条债；**RD 那面用了分类器，B1 这面没用** | `3391a65`（实测父提交全绿、该提交 4 红） | 我；等 BLOCKED 待办 #56 的 A/B 裁决 |
| `prefix-churn-check` PC7 | "开"臂压缩反而多一次：又是拿活工具面当 A/B 分母 | `aa30513`（`a0db9ea` 17:20 仍 9/9，17:30 起红） | 我；§十二 待办 1 的两种读法未裁 |
| `mutate-verify` | 冷树 >1200s，被 gates 的预算整组 SIGKILL | 表规模 vs 预算 | 待测（下面） |
| `mutate-needles-check` | **派生红**：上一道被杀留下 `agent-runner.ts.mutbak`，该门明写"残留 ⇒ 针脚不可信"。实测残留与 HEAD 逐字节相同（没有未还原的突变体），已移出 | — | 随上一道一起消 |
| `panels-check` | 尚未归因：148s 的红要按 AGENTS.md 判读法单跑复验，但整表在跑时并发会造计时假红（规矩 111），故排到最后 | — | 待单跑 |

### 一条方法论更正（本轮自己踩的，必须留在原处）

第一次逐笔 bisect 的读数是**被污染的**，而它看起来完全像证据。两件事实叠在一起：

1. `git checkout --detach <sha>` **会把未提交的改动一路带着走**——只要该文件在两个提交之间逐字节相同，git 就不报冲突。我 §十二 那份三文件补丁因此跟着穿过了整段历史；
2. 走到 `8361657^` 时，它 `import` 的 `tests/helpers/stream-equals.ts`（`8361657` 才新建）在盘上被 checkout 删掉了 ⇒ 三道门以 `ERR_MODULE_NOT_FOUND` **崩**，退出码 1 而 ❌ 计数 0。

于是我第一次写下"这三道门在五个提交上都红"——那是"崩了"不是"红"。同一段里我还把 `git ls-files`（读索引）当成了 HEAD（第 92 条规矩的原样复发）。
⇒ 立两条：**bisect 前先 `git status` 确认被测文件干净**；**「exit≠0 且 ❌=0」= 崩，不作红读**（红必须有具名断言行）。
第二次的父子对照（`3391a65^`/`aa30513` 两侧）是在干净树上重跑的，那两条 culprit 才算数。

### §十三 补：gym-check B1 已落（同一天，读数在下面）

`scripts/gym-check.ts` 的 B1 改为把差异交给 **`src/agent/reproducibility.ts` 那只唯一判据**
（`diffJsonPaths` → `classifyDivergence` → `reproducibleVerdict`，`requireDebtHit` 按该模块自己的口径保持关闭）。
配套：`changedFiles` 那一路**原样传数组**——登记债的 `pathPrefix` 是 `changedFiles[`，字符串化会把整只数组压成一个根路径，于是那条债永远命中不上。

两侧各跑一次（不是只跑绿的那次）：

- 改完：`33 ✅ / 0 ❌ exit 0`，四条 B1 的读数各自带 **"按登记身份债吸收 1 处"** ⇒ 债出声，绿不被读成"没有债"。
- 反向（临时给 `r2.changedFiles` 塞一个非毫秒假文件 `decoy-not-wallclock.ts`，跑完即删）：
  **`exit 1`、`4 项失败`**，读数同时打出被吸收的那处与真泄漏的那处 ⇒ 尺的分辨力没被换掉。
- `typecheck` 0 错；`--check-needles` 报告里 `gym-check` **零命中**（阻断 5 条全是 #11 那批在飞文件：`np-write-suppression-ignored`、`event-stamp-dropped`、`event-stamp-overwrites-producer-ts`、`sessions-delete-force-false`、`supervise-retired-error-verdict-revived`）。

**这不等于 #56 偿清**：快照目录名仍含 `Date.now()`，`D7-snapshot-note-ms`（毫秒混进模型可见文本那半）仍在账上，
`IDENTITY_DEBTS` 两条一条没删。改的只是"同一承诺在两道门里读出两个结论"这一格。
**这条判据的分辨力挂在"债还活着"这一事实上**：#56 一旦按 A 或 B 偿清，B1 与旧写法等价——届时无需撤针，因为它不再守任何东西，而 RD 那条 `requireDebtHit` 复查会先一步把过期条目念出来。

### §十三 补二：PC7 的两读法已被两个事实拆开（一条 grep、一行代码）

上面 待办 1 说"两种读法结论相反，本轮不擅自动它"。本轮把那两个前提各自量了一遍：

1. **次数是**有价的：`src/agent/compaction.ts:45` 明写一次多余的摘要替换「多烧一次摘要调用 + 白丢冷细节」
   ⇒ PC7 的 `b.compactions < a.compactions` 那一半**不是代理指标**，它对应一次真模型请求。字符那一半（−18%）不能替它抵账。
   ⇒ 读法 ① 「把它换成绝对字节量」当场作废：换了就等于把一次摘要调用的成本从尺上抹掉。
2. **但这条策略生产里根本没接线**：`amortizeRewriteCost` 在 `src/` 只有一个**读侧**
   （`glm-session.ts:770` `enabled: opts.compaction.amortizeRewriteCost === true`），
   **全仓零写侧**——三个设值点全在判卷面上（`scripts/prefix-churn-check.ts:186`、`src/agent/gym/probe.ts`、`tests/compaction-cost.test.ts:125`）。
   ⇒ 红的是**一只只有台架会打开的开关**：今天不花用户的钱，代价是"这条策略在新装配面尺寸下不再省次数"⇒ **它因此不该被接上**（方向是 fail-safe 的）。

⇒ 结论：**PC7 的红既不是产品事故也不是尺坏了**，是"一条未接线策略的适用边界被后来的加面挪走了"。
按规矩 57 给它挂名字而不是拆判据：要接这条策略，先让它在**当前面尺寸**下重新同时满足两只读数（改 `COMPACT_TAIL_AMORTIZE_FACTOR` / `floorTokens`，或在 `amortizedCompactionConfig` 里按面尺寸定 floor），
而不是把次数那一半删掉。本轮不动判据、不动策略（两侧都还欠一个"在新尺寸下重测"的动作，且改的是同一只纯函数）。

