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
