# 影响面（M7）全链路审计 + 第三环补测 · 2026-09-22

能力轴 1「不只看懂单个函数，而是理解这个改动会影响哪里」的实现是 M7 影响面。
本审计回答一个问题：**这条能力今天真到用户/模型手上了吗**，并把缺的那一环补上判据。

## 链路逐环取证（走 `runAgent` 真实入口，不看单测自建的那份）

| 环 | 事实 | 证据 |
| --- | --- | --- |
| 设置 | `impactAnalysis` 存在、**默认 false**、非 true 一律回落 false | `src/main/settings.ts` 的 schema 字段、默认值表、读侧校验 |
| 设置⇒run | `over.impactAnalysis ?? store().get().impactAnalysis` 进 RunOptions | `src/main/agent-runner.ts` L1558（工作树行号） |
| 构造钩子 | `opts.impactAnalysis === true ? defaultImpactHook(workspace) : undefined` | 同文件 L1287 |
| 透传 runLoop | `...(impactHook ? { impact: impactHook } : {})` | 同文件 L1307 → `src/agent/loop.ts` L322 进每次工具调用的 ctx |
| 写侧消费 | `write_file` / `edit_file` 落盘成功后 `appendImpact(ctx, rel, …)` | `src/tools/write_file.ts` L59、`src/tools/edit_file.ts` L89、`src/tools/base.ts` L167-L178 |
| 事件 | `impact_report` 先于 `tool_result` 落流；进 `AgentEvent` 联合与 `KNOWN_TYPES` | `src/events/index.ts` L181-L189 / L462 / L494 |
| 读端工具 | 同开关下注入 `impact_query` 实例 + 规格；worker 侧「规格/实例/白名单」三处同源 | `agent-runner.ts` L1290-L1293、`orchestrator.ts` L1669-L1672、`worker-tool-table.ts` L36 |
| 消费端 | sidechat 压成一行；渲染层经通用记录卡显示（标签「影响面报告」） | `src/agent/sidechat.ts` L134-L135、`src/renderer/app.js` L3080-L3105 |

**结论：第三环（设置⇒构造⇒事件）本来就是通的**，此前只是没人能证明；本审计没找到「两头断」，
但找到了它一直**不可证**——见下。

## 补的那一环：`tests/impact-runner-wiring.test.ts`（2 条，0.8s）

既有 `tests/impact-wiring.test.ts` 是**手搭 `ToolContext.impact`** 验的，所以「runner 里那行构造被删」
它照绿。新测试走 `runAgent`，并**成对**钉开关：开 ⇒ 必须有 `impact_report` 且摘要回进 `tool_result`；
关 ⇒ 一条都不许有，**且同一条写盘仍必须成功**（否则"关"那半边会被"根本没写盘"满足，等于没测）。

锚点 +2（`scripts/mutate-verify.mjs`）：`runner-impact-hook-never-constructed`（构造永不出钩子 ⇒ 开 case 红）、
`runner-impact-hook-always-constructed`（不看设置位永远注入 ⇒ 关 case 红）。

## 顺手量出来的一条假红（对后续所有影响面测试都成立）

第一版测试拿 `fixtures/todo-app` 当工作区，结果**零事件**，看着像"第三环断了"。实测：

```
buildImpact(fixtures/todo-app).files = ["tests/todo.test.ts"]     ← 没有 src/todo.ts
```

原因：扫描层是 `rg --files`（尊重 `.gitignore`），而 `.gitignore:18` 显式忽略
`fixtures/todo-app/src/todo.ts`（跑完留下的状态不进 git，由 `fixtures/mock/todo-bug.ts` 重置）。
⇒ 被改的文件压根不在图内，`fileImpact` 按契约返回 `null`、不发事件。**判据没错，是取料面选错了。**
修法：测试自建临时工作区（`src/todo.ts` + 一个跨文件调用它的 `src/app.ts`），并在文件头把这条写成注释，
免得下一个人再拿靶子量一次假红。

⚠️ 这条不只是测试技巧：对真实用户仓库同样成立——**被 `.gitignore` 忽略的源码（如生成物、
`src/` 被 ignore 的老项目）对影响面永久不可见**，且表现是"静默无报告"（与"没有跨文件调用点"
两种语义共用一次 null/空 up）。留作待裁：是否要在 `impact_query` 的"不在图内"文案里点出
「被 .gitignore 忽略」这一因（工具面对不在图内已有一句 ok:false，见 `src/tools/impact-query.ts` L22）。

## 仍未接的两环（明确记账，不偷偷做）

> 本节的第 1 条已在同日接上（见下「面板这一环已接」），第 2 条仍是留位。原文一字不改留着，
> 因为「当时不可写」这件事本身是这条链路的取证。

1. **右栏面板不读 `impact_report`**：`projectPanelData`（`src/renderer/projections.ts` L993-L1037）
   四个投影里没有 impact 分支 ⇒ 波及面只能在会话流的通用记录卡里看，面板读数不随它变。
   影响：「开设置跑一轮 ⇒ 面板读数变化」这条端到端断言现在**不可写**，panels-check 对 impact 零断言。
2. **worker 写侧不接钩子**（`orchestrator.ts` L1708 的 runLoop 不传 `impact`）：
   这是**有名字的刻意取舍**（`src/agent/orchestrator-types.ts` L191-L195：worktree 是仓库副本，
   缓存按绝对路径键 ⇒ 每个 worker 冷启动重建整图，代价随 worker 数线性放大；波及真正有意义在合并回主树那一刻）。
   worker 拿到的是读端 `impact_query`。若日后要求 worker 也写后回注，需先解掉"每 worker 重建整图"的代价。

## 面板这一环已接（同日第二次更新，#29）

`projectPanelData` 现在按被改文件汇聚 `impact_report` 并挂到审阅页那一行：

- 投影（`src/renderer/projections.ts`）：`projectImpactByFile`（同文件多条报告**取最后一条**，不累加）、
  `impactLabel`（`波及 N 处 · M 个文件`，撞帽写 `N+`，`sites===0` 单独一句「无跨文件调用点」），
  `PanelFileEntry.impact?`——**没有报告 ⇒ 字段缺席**，不写 0（设置关着时界面不能说「测过、半径 0」）。
- join 键两侧归一（`normRel`）：diff 侧的路径来自模型写的 `args.path`（可能带 `./` 或反斜杠），
  impact 侧是 workspace 相对正斜杠——不归一就是「面板永远空白」那种静默错。
- 渲染层（`src/renderer/app.js` `reviewViewHTML`）：一行 `<span class="dim" data-impact="2/2">`，
  `data-impact` 是给门禁的不依赖中文文案的读点。
- 观察者三层：单测 `tests/panel-data.test.ts`（5 条：汇聚 / 缺席≠0 / join 键 / 取最后一条 / 帽标记）、
  切片影子 `tests/renderer-panels-real-data.test.ts`（行渲染 + 无报告那行不写读数）、
  真窗口 `panels-check` **B23**（9 条断言，含「只有带报告的那一行挂读数」的对照侧）。
- 锚点：7 条（`impact-panel-never-attached` / `-absent-as-zero` / `-join-key-not-normalised` /
  `impact-projection-first-report-wins` / `-truncated-plus-dropped` / `-sites-counted-as-files` /
  `review-row-drops-impact-span`）。
- ⚠️ 第一条**变异存活**过，原因不是锚点写错而是靶子两侧同值：join 那一支原先只把 diff 侧的
  `normRel(d.path)` 改回原值，而测试数据里脏写法全在 impact 侧 ⇒ 另一支仍把键对上。
  归一这件事有**三个取料面**（`out.set(normRel(e.file))` / `files.add(normRel(s.file))` / `impacts.has(get(d.path))`），
  改法现在三支一起改，测试也补了「脏写法在 diff 侧」那半边（`./src/sort.ts` 写入 + 干净路径的报告）。
  教训通用：**一条不变量由几支面共同成立，变异就要一次废掉几支**，只废一支的存活是必然。

## B23 挤到 B20 前面：量出来的虚拟化缺陷（另立任务 #31）

B23 最初放在 B15 与 B16 之间，结果**同码同机连红三轮**的是后面那相 B20（三张截断卡上屏）。
用「同 HEAD 开 worktree 对照」把归属钉死（规则 46/61）：

| 跑的代码 | B20 结果 |
| --- | --- |
| 干净 HEAD（无 B23） | ✅ 绿（全部门禁 exit 0） |
| HEAD + 本次三支改动 | ❌ 红 6 条，`实测 0 张：[]` |

红了以后先别猜，给 B20 加只读读数一层层切（这是本轮最值钱的产出，已留在门里）：
`距底 px` / `挂载子节点数 + 两个占位高` / `#eventCount` / `盘上行数与尾部类型` / `审阅页文件行数`。
读到的态是：**盘上 30 行、`#eventCount` 30、审阅页读得到那 2 条写入（面板不虚拟化），
而转录 `scrollTop 250 / scrollHeight 890 / clientHeight 640`（已贴底）却只有 8 张卡、
未挂载区占位 190.273px** ⇒ 末单元停在未挂载区。

三条被排除的归因（都实测过，别写回来）：
①「B23 把抽屉留着打开污染下游」——收尾加 `#drawerClose` 仍红；
②「窗口停在顶上没吸底」——实测距底 0px；
③「等一帧就好」——给 settle 每拍 `scrollTop = 0 → scrollHeight` 打一拍**也没修好**。
新写的假 DOM 观察者 `tests/renderer-history-mount.test.ts`（双向：贴底要全挂 / 会话一长必须真有界）
在现实现下**两条都绿** ⇒ 我的假 DOM 少算了真实盒模型里的东西（`.stream` 的 CSS `gap`/flex 与
`mountHistory` 只按 `height + 12` 记账是两套口径）。这正是 #31 要建模并修的那件事。

补两条后来的排除（同一实验台上跑的，`/tmp/dsh-raf`）：
- **不是 rAF 停摆**：`document.visibilityState = "visible"`、`document.hidden = false`；且给 Electron
  加 `--disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling`
  之后**数字逐字不变**（仍是占位 190.273px、卡片头 8 个）⇒ 这条与 AGENTS.md 记的那批
  「Electron/CDP 挂载时序 flake」**不同族**，它是确定性的真缺陷。
- **不是我的追加被丢**：`#eventCount` 与盘上行数同为 30、审阅页也读得到（面板不虚拟化）
  ⇒ 断层只剩「投影出单元 → 挂进 DOM 那一窗」这一段。

现在最像的两处账目差（#31 按这个顺序做：先让假 DOM 红起来，再动实现）：
① `.stream{padding:var(--sp-10) 0}` 使 `origin()` 的 `base` 非 0，而 `draw()` 先
   `top = scrollTop - base`、又 `windowRange(offsets, correctedTop - base, …)` ⇒ 同一份 padding 扣两遍；
② 没测过的单元保留 120 估高 ⇒ `offsets[n]` 高估 ⇒「真实空间已贴底」在 offset 空间里不算贴底，
   末单元被折进 after-spacer，形成**自洽的错定态**（这解释了为什么再滚一次也不收敛）。

**第五排除（当场量，很关键）：不是「等不到下一帧」。**同一实验里测 `requestAnimationFrame`
在 400ms 内拍了 **50 次**（≈125fps），而卡片头仍是 8 个、占位高仍是 190.273px
⇒ 帧在正常走，缺的不是「再排一次 draw」而是 **draw 算出来的窗本身就短一截**（且重复滚底也不改）。
按 ①② 的任一版本手推 `windowRange` 都推不出「贴底却 end<n」，所以**下一步必须换手段**：
在 mount 里临时打一行 `units.length / offsets[n] / range` 的读数（或把假 DOM 的测高做成
「首拍留估高」+ 容器 padding），拿到当场数再谈修法——继续坐在数字外推只会产出下一条错归因。

相位处理：把 B23 移到 B20 之后（各自钉自己的前提，红了才分得清是谁弄的），**断言阈值一字未改**；
修好 #31 后应把 B23 挪回 B20 之前跑一次，让「追加事件把单元数推过估算窗」成为 B20 的正向回归。

## 验证

- 新测：2 passed（1.3s，全量里最便宜的端到端一环）
- 全量 `pnpm test`：**196 files / 1970 tests 全绿**（本轮 #29 之后待复跑，见下）
- `pnpm typecheck`：HEAD 内 0 错（唯一红是别人在飞的 `scripts/sidebar-probe.ts`）
- `mutate-needles-check`：645 条针脚阻断 0，改法语法体检全过
- 两支新锚点的真杀死验证在同 HEAD 的 worktree 里补跑（`agent-runner.ts` 正被别的会话改着，变异器拒变在飞文件）

本轮（#29）补记：`panels-check` exit 0（含 B23 九条）；`tests/panel-data` + `tests/renderer-panels-real-data`
+ `tests/renderer-history-mount` = 19 passed；针脚 652 条阻断 0。
全量 test / 其余门与锚点真杀在提交后按同 HEAD worktree 复跑。

## 追加：第一个候选修法已被实验证伪（别重复做）

按「`draw()` 挂了新节点却不续拍」这条做了修法（`if (changed) schedule()` → `if (changed || mountedNew) schedule()`），
并给假 DOM 加了「新挂载节点首帧量得 0、下一帧才落定」这层建模 —— 假 DOM 那条判据当场从绿转红
（`missing:[10], tailSpacer:120`，与真窗口同形状），加修法后相关 6 个文件 37/37 全绿。
**但真窗口一字未变**：`grep mountedNew out/renderer/assets/*.js` 命中（确认改动进了构建产物），
B20 仍是「卡片头 8 / 挂载子节点 11 / 占位 190.273px / 距底 0px」。
⇒ 那个模型测到的是**另一件事**，不是本缺陷的复现；三处改动已全部 `git checkout` 回退，
HEAD 停在「B23 在 B20 之后 + 全门绿」的态。**这条判据（假 DOM 那条）别当成 #31 的复现器。**

当场读数（临时探针写在 `container.dataset.probe`，throwaway worktree，跑完即删）：
`{n:20, start:0, end:16, offLen:21, total:1620, atEnd:1430, st:250, sh:890, ch:640, base:24, mounted:9, changed:false}`
最有信息量的是这一对矛盾：**最后一次 draw 算出 `range.end = 16`，而 DOM 里只有 9 个节点**
（探针写在挂载循环之前 ⇒ 那一拍本应把缺的 7 个补上）。两种解释还没被区分：
① 之后另有一拍把窗缩回 9（`end` 在 9↔16 之间**振荡**，采样多半落在 9 那侧）；
② 节点插了却被后续 `node.remove()` / `insertBefore` 的顺序问题吃掉。
**#31 的下一步只做这一件事**：把每拍的 `{end, mounted.size, scrollTop, offsets[n]}` 逐拍写进
`container.dataset.probeSeq` 并读出序列 —— 振荡还是丢节点一眼可分；在那之前不再提修法。
（探针手法可复用：值写进 dataset，panels-check 一行 eval 读回，成本 = 一次跑。）

## 第七读数：#31 根因锁定（同日第三次更新，逐拍序列读出来了）

按上一条做了逐拍探针（throwaway worktree `/tmp/dsh-virt`，跑完即删）：`mountHistory` 每拍把
`{n,start,end,holes,outside,kids,hasAfter,st0,cTop,st,sh,total,offEnd,tail,changed,atBottom,hts}`
写进 `globalThis.__dshVirtSeq`，另在 `draw()` 入口计数 `__dshDrawEntered`、在挂载循环外加 try/catch
把异常原文写进 `__dshInsertErr`（**记录后原样 rethrow**，不改行为）。触发条件照 B23 那份事件补进
B20 的转录（同一相自己撞上）。读到的东西一次把六种外推全推翻：

| 拍 | 读数 | 说明 |
| --- | --- | --- |
| inst 5（n=10，健康） | 3 拍：`total 1200→710`、`tail 0px` | 测高回修正常收敛 |
| inst 8 第 1 拍（n=20） | `st0=0`、`cTop=0`、`start=0,end=10`、`hts` 全是 120、`tail 1200px`、`changed=false` | 首拍在 app.js 吸底**之前**跑的 ⇒ 窗算在顶上；且首拍没有可测高的节点（节点是这一拍才挂的），`changed` 必假 ⇒ 不续拍 |
| inst 8 第 2 拍 | **`__dshDrawEntered=25` 而 seq 只有 25 条记录里的最后一拍到 f=1** ⇒ 第 2 拍没留下记录 | 它抛异常了：`insertErr = "f=1 i=13 TypeError: Cannot read properties of null (reading 'style')"` |

那条 TypeError 就是根因，且**不是虚拟化的错**：

- 挂载循环从 `range.end-1` **倒着**插，插到 `i=13` 时 `renderUnit(units[13])` 返回了 **null**，
  `node.style.margin = ...` 当场抛 ⇒ 这一拍死在 rAF 回调里（**无人观测：不报红、不进 console 断言**），
  `13..10` 那几格永远没挂上，而 `19..14` 已经挂上了。
- 为什么返回 null：`app.js` 的 `buildUnit` 末尾 `return frag.querySelector('.msg')`，
  而 `renderEvent` 的 `case 'tool_result'` 第一行就是 `const item = rc.cards.get(e.callId); if (!item) break;`
  —— **一条找不到对应工具组的 tool_result 什么也不渲染**，那一格连一个 `.msg` 壳都没有。
  app.js:2534 写着不变量「一个展示单元恰好产出一个 .msg」，**但全仓库没有一处实现或检验它**（第十一族：注释不是实现）。
- 当场点名的破损单元（`__dshNullUnits`，整轮 7 条）：`turn|tool_result`、`turn|tool_result,tool_result`——
  全是「只有结果、没有调用」的 turn。生产可达路径不止一条：同一 `callId` 的**重复投递**
  （`rc.cards.delete(callId)` 让第二条结果无处安放）、调用行与结果行的 `agent_id` 归因不一致、
  以及崩溃/截断后 JSONL 少一行。**判卷 fixture 里本来就写满了这种行**
  （panels-check:1125/1126/1267 三条 tool_result 从来没有对应的 tool_call），
  所以这条不是「构造出来的边角」，是天天在门里走的那条。
- 于是前面六条排除全部成立却都问错了问题：帧在走（rAF 正常）、事件事后确实到齐（`#eventCount` 与盘上一致）、
  可见性正常、贴底正常——**缺的不是「再排一拍」，是那一拍本身死在半路**。而「窗短一截」是它的下游现象。

三条要各自收口的缺陷（同一根因，不同面）：
① 事实丢失：孤儿/重复的 `tool_result` 在转录里无声消失（能力 5 的反面——用户看不到那次调用的结果）；
② 一个渲染不出来的单元拖死整窗：`mountHistory` 无条件信任 `renderUnit` 非 null；
③ **零观测者**：异常死在 rAF 回调里，六轮外推没有任何一层能看见它——这是本轮最贵的教训：
   **读数读不到时，先问「有没有异常没被打印」**，`__dshDrawEntered` 与 seq 记录数的差就是那把尺。

修法（按①②②的顺序，阈值不放宽）：① `case 'tool_result'` 找不到工具组时落成一张记录卡（事实要看得见，
且保证那一格有一个 `.msg`）；② `mountHistory` 拿到 null 时按 0 高记账并跳过，绝不让一格决定整窗；
③ 三层观测者：假 DOM 那条测「null 单元不许吞掉邻居」、vm 切片那条测「孤儿 tool_result 仍产出一个 .msg」、
真窗口把 B23 挪回 B20 之前（这条正是本门现成的复现器——它当时红了，只是没人能解释为什么）。

## 收口（同日第四次更新，#31 结案）

修法两处各一半，阈值一字未放宽：
① `renderEvent` 的 `case 'tool_result'` 找不到可并入项时落成一张记录卡（标题走中文，
带结果原文，`out || '（无输出）'` 保住「空输出」与「没这条」两句话）；
② `mountHistory` 拿到 null 按 0 高记账并跳过，两个占位高的赋值移到挂载循环之后
（否则那一格留 120px 幻影），一格渲染失败只损失它自己。

观测者三层 + 两条锚点，全部实跑：

| 判据 | 位置 | 当场读数 |
| --- | --- | --- |
| 假 DOM：null 单元不许吞邻居（含不留幻影高） | `tests/renderer-history-mount.test.ts` | 3 passed（143ms） |
| vm：not-found 一支必须流向 `appendRecordCard`、标题不许是原始类型名 | `tests/renderer-history-live.test.ts` | 14 passed |
| 真窗口 B24：孤儿卡上屏 + 结果原文 + **它后面那条单元**仍挂载 + 两侧计数 | `scripts/panels-check.ts` | exit 0，`卡片头 18 / 孤儿卡 4 = 盘上 3 + 追加 1`，`4 < 结果总数 5 + 1` |
| 锚点 | `null-unit-eats-whole-window`、`orphan-tool-result-silent-drop` | 同 HEAD worktree 内**两条都被真杀死**；针脚 654 条阻断 0 |
| 造红复验（新判据必须当场红） | worktree 里按锚点形状回退 ①（`if (!item) { break; }`，② 保留） | B24 三条全红（`3 项失败`，其余全绿）。读数本身把两半分开钉死：**卡片头 18→14**（四张孤儿卡没了＝事实丢失那半）、**尾单元仍 = true**（② 保住那半：四格渲染不出壳也没拖死整窗） |

门禁：`test` 197 files / 1980 tests 全绿；`typecheck` HEAD 内 0 错（唯一红是别人在飞的未跟踪
`scripts/sidebar-probe.ts`）；`panels-check` exit 0；`renderer-arch-check` 84/84；`a11y-check` 4/4；
`gate-check` / `docs-check` 通过；`ipc:check`（分支 A 靶子修复）/ `sandbox:check`（分支 A 沙箱生效）/
`e2e` 全部断言通过。构建由 panels-check 的 B0 相同源码跑通。
另按「谁读渲染层谁就得跑」实测取料面（`grep -l src/renderer scripts/*`）补齐四道：
`arch-boundary-check`、`sidechat-check`（33 ✅）、`agents-check`（255 ✅）、`schedule-check`（67 ✅）——
读渲染层的门至此全绿（`renderer-arch-check`/`a11y-check` 走构建产物 `out/renderer`，同一份源码）。

**另记一条未追的缝（不在本次修法内，已单列待办）**：同一实验里还见过一次
`NotFoundError: Failed to execute 'insertBefore' on 'Node'`——抛在 `draw()` 的挂载循环里，
条件是 `next` 不再是 container 的子节点。最像的成因是 `app.js` 的 `clearTranscript`
（`streamInner.innerHTML = ''`）在某个 mountHistory 实例还活着时把它的 `after` 占位一起抹了。
本次没测到它复现，所以只记形状不写结论。



## 第八：把「被吞掉的异常」变成门里的常驻判据（panels-check 新增 B25）

第七读数的教训是**观测面缺失**，不是某一次算术错。所以这一相不收在文档里，收在门里：
`Cdp` 现在开 `Runtime.enable` 并把 `Runtime.exceptionThrown` 累积起来，B 相收尾时判两扇窗
「全程 0 条未捕获异常」。**关键是这条判据自带可证那一半**：收尾后当场往页面投两条必然未捕获的
异常（一条 `requestAnimationFrame` 里抛、一条 `setTimeout` 里抛），要求同一条通道当场收回至少一条。

为什么不能只写「0 条」就算完——第一次把这条例程拿去找缺陷必现的那份码复验，读到的竟也是「0 条」：
一条永远读到 0 的判据比没有判据更坏，它会把「我没在看」说成「没有这回事」。自检投两条（而不是只投 rAF 一条）
的理由也在这：宿主节流/遮挡时 rAF 可以整段不拍（AGENTS.md 记的假红族），只挂 rAF 的自检会在那种时刻误判成
「通道坏了」。

复验（临时 worktree `/tmp/dsh-b25` 停在 **ff2a699 = 修法落地前那份码**，跑的却是同一份新门）：

| 跑的代码 | B25 干净检查 | B25 通道自检 |
| --- | --- | --- |
| ff2a699（缺陷在） | ❌ 第二窗 14 条：`TypeError: Cannot read properties of null (reading 'style') ← at draw (...out/renderer/assets/index-*.js)` | ✅ 两条都收回（timer + raf） |
| HEAD 637d827（修完） | ✅ 两窗各 0 条 | ✅ 两条都收回 |

⇒ 这道门若早存在，#31 不需要六轮外推：第一次跑就会带着栈帧报出来。

三点要如实记下：
1. **异常道是补位，不是主判据**。同一份 ff2a699 的码，两次跑一条读到 0 条、一条读到 14 条——
   因为那一拍的抛出有时落在 rAF（未捕获），有时落在 `showHistory` 的同步调用里、被 app.js
   开会话那段 `try/catch` 接走。红与不红取决于宿主时序 ⇒ 行为道（B24「它后面的单元仍挂载」）
   才是稳定判据，B25 负责把「有异常但没人接住」这一类从隐身变成显式。
2. **占位高移到挂载循环之后没有代价**：`滚动一屏 max` 在 HEAD 读到 16.2ms、同机 pre-fix 读到 16.7ms；
   中间一次 276.9ms 的红色读数按 AGENTS 判读法单跑复验即回到 20.1/16.2ms ⇒ 是宿主负载抖动，
   不是改动引入的回退（该阈值的 flake 族与本相无关，未放宽阈值）。
3. **上一条记的 `insertBefore NotFoundError` 在 HEAD 两次全量 B 相里都没复现**（0 条）。它只在
   「探针自己把 draw 打断」的态下见过 ⇒ 那个形状是探针破坏 `draw` 之后引出的下游现象，不是独立缺陷。
   任务 #32 因此降级为「判据常驻，出现即报」，不预先改实现去防一个没测到的态。

### 补（同日第五次更新）：把这条判据从「两扇窗」扩成「所有连上的窗」

第一版把 `Runtime.enable` 开在各相自己调的 `watchExceptions()` 里——**漏调一次，那扇窗就静默不收**，
正是规则 64 记的那族失效（借「怎么开」的表去判「有没有开着」）。现在改成：`connect()` 里直接开，
并把窗登记进 `exceptionWatched`；收尾扫一遍所有「连过 CDP 又没被显式判过」的窗（已判的不重复判，
避免同一扇窗两次计分）。实跑覆盖：B 相两窗 + B21/B22 那四次真启动（第 3~6 扇窗），各 0 条，
`panels-check` exit 0；`typecheck` 无新错。⇒ 以后新增任何自开窗口的相，不写一行判据代码也在这道门里。

## 第九：偶发半挂载的**另一半机制**——收敛曾被押在一条可能不来的 scroll 事件上（已修）

修法收口后（① 孤儿结果落成卡、② null 格按 0 高跳过）又抓到一次 B20/B24 红，形状是：
`卡片头 8 / 盘上 25 行 / #eventCount 25 / 距底 0px（scrollTop 1078 = scrollHeight 1718 − clientHeight 640）`，
而 **B25 两条道都是 0 条**（无未捕获异常、无 console.error）⇒ 这一次不是崩溃，是**根本没续拍**。
同一份码紧接着一跑就全绿 ⇒ 这是概率性的，与 null 那条是两个独立机制。

机制（读代码 + 一条假 DOM 判据把它钉死）：首拍进入时容器是空的 ⇒ `wasAtBottom` 判为真 ⇒
拍尾把 `scrollTop` 钉到底；而**新节点是这一拍才挂上的**，测高循环读的是上一拍的 `mounted` ⇒ 扑空 ⇒
`changed` 恒假 ⇒ 不排下一拍。此时唯一的续拍来源是 ResizeObserver 或 app 那句吸底带来的 scroll 事件——
而吸底赋值常常换不来事件（值本来就已到底）。窗口于是永远停在「按 120 估高算出来的那一窗」。

- 复现器：`tests/renderer-history-mount.test.ts` 新增 `quietScroll` 那条——假 DOM 里把「赋值但换不来
  scroll 事件」这一支建模出来，判据变成**收敛不许依赖外面再推一把**。旧码当场红，读数就是真窗口那个形状
  （`[0..9]` 已挂、第 10 格留在未挂载区）。
- 修法：`draw()` 记下本拍是否挂了新节点，`if (changed || mountedNew) schedule()`。
- ⚠️ 这条修法**先前被「证伪」过一次**（当时真窗口一字未变）。原因是它被 null 崩溃压在下面：
  那一拍会先抛异常，续不续拍都一样。⇒ 教训：证伪的结论要连着它的前提一起记，前提变了必须复跑
  （已写进项目记忆规则 75）。

### 收口验证与一处该纠正的读数

- 新判据当场造红：加 `quietScroll` 那条判据时旧实现**立刻红**（`[0..9]` 已挂、第 10 格留在未挂载区），
  加 `if (changed || mountedNew) schedule()` 后 16 条测（本文件 4 条 + 渲染器切片 12 条）全绿。
- 锚点 2 条（`mount-no-followup-frame`、`null-shell-silent-skip`）在 `e436cb7` 的干净 worktree 里**真杀死**；
  针脚 656 条阻断 0、改法语法全过；`panels-check` exit 0（滚动 17.6ms ≤ 200ms，未放宽阈值）。
- ⚠️ 纠正我自己前面两次回复里的说法：「全量 test 197/1980 全绿」算的是**主树工作树**（带着别人在飞的
  `agent-runner.ts` / `tools/base.ts`）。同 HEAD 开 worktree 复算是 **193 files / 1962 绿 + 2 红**
  （`gated-tools`、`runner-gates`），且这 2 红在我全部改动之前的 `ff2a699` 上同样红 ⇒ 不是本几笔引入，
  是 AGENTS.md 那句「HEAD 没有待收口的红测」已漂移。已单列待办 #33，等那两支票落地时一并判绿；
  我不去改别人在飞的表面（每表面唯一 writer）。

### 一处自我纠正：判据的两半曾分在两个表面，其中一半漏入库

`e436cb7` 把「产品出声」（`buildUnit` 的 console.error）与它两条判据提交进 HEAD，却把**收 console.error 的那半**
（panels-check 的收集器 + 那条「console 道」通道自检）整支留在工作树 ⇒ 那一刻的 HEAD 上，B25 只收异常、
自检也只证异常道，「产品出声有人接」这条我报过的话在 HEAD 上不成立（我复核时跑的是工作树，所以全绿——
正是本页上面刚记的那族「工作树读数冒充 HEAD 读数」）。补交 `f970bf8`，并在 `f970bf8` 的**干净 worktree** 复跑：
28 条渲染器测全绿、`panels-check` exit 0（186 ✅，含异常道与 console 道两条通道自检）。
教训已进记忆（原子簇按「判据的两半」算；提交后按自己列的改动清单复核残留，而非看全仓 `git status`）。

## 第十：把「那一格」的判据升成「整族」——逐型通判 `projectUnits → buildUnit`

（读数时间 2026-09-23 01:0x，HEAD = `a68caa7`；本节的每条数字都在**同 HEAD 的干净 worktree** 复算过，工作树读数另列）

### 为什么第九节还不算收口

第九节撤掉了「一格产不出壳 → 整窗不挂」这个爆炸半径，代价是**跳过变成新的静默**：
`buildUnit` 出声（`console.error`）之后，只有真窗口的 B25 收得到那句——离线一侧只剩
`tests/renderer-history-live.test.ts` 里两条**源码形状**断言（孤儿那一支要落成卡、`!first` 分支要出声）。
形状断言看不见的是「别的型也画不出壳」。`projectUnits` 会为一整排类型各成一格（`cardTypes` 30 型里 28 型），
其中任何一型画不出壳，事实就照样丢，而且**从此不再崩溃**，只留一行没人读的 console.error。

### 设计取舍：为什么判「对」而不是判「边」

先写的版本是正则扫 `renderEvent` 的 case 体，找 `if (x) break;` 且体内不含产出壳的调用。当场发现两种写法
**文本同、语义反**：

| 现状实例 | 形状 | 语义 |
|---|---|---|
| `case 'plan_approved'`: `if (tag) { tag.textContent = …; break; }` | 提前退出、体内无建壳调用 | **正当**——它把决议写进前一格已有的卡里 |
| 修复前的孤儿 `tool_result`: `if (!item) break;` | 同上 | **缺陷**——那一格既没卡也没壳 |

任何「case 体必须含产出壳的调用」还会误伤 `tool_result` / `assistant_delta`（它们本就该续写别人的壳）。
⇒ 判据改成跑 **shipped 的那一对**：注册表 30 型各喂一条样例事件，`projectUnits` 成几格就要求几格都产出 `.msg`，
并把 `buildUnit` 的 `console.error` 声道接进 vm context（没有 `console` 的 vm 里那句会抛 ReferenceError，
判据就从「出声」变成「崩掉」——这正好是规则 73 的反面，探针不许自己抛）。
顺带把「静默跳过」也钉住：允许成不了单元的类型**恰等于** `usage` / `session_meta` 两型，多一型即红
（那一型落了盘、进了上下文，界面却永远看不见它）。

### 实现位置与 fake DOM 的边界

`tests/renderer-run-control.test.ts`（它已有 `bootRenderer`，切片绑定只此一份，见该文件头注）：
切片从三段加到四段（新增「消息流构造 + 底栏同步」——`appendUser`/`ensureAi`/`finalizeAi`/`finalizePending` 住在那儿，
判 `user_message` 与 `assistant_*` 绕不开）；共享绑定 `tests/renderer-vm-module.ts` 补 `skipReasonLabel`
（`EVENT_LABELS` 支给 `automation_skipped` 时调它，绑定只准给真实现，不许塞桩）。
fake DOM 为跑通那三支补了 `classList` / `closest` / `remove`，并让 `innerHTML=` 按串里出现过的 class 名造占位子节点。
**这不叫解析 HTML**：层级与文本一律不仿——那部分是 panels-check 真窗口的判面，在 fake 里造出来只会把
「只有真窗才有的差别」照成绿。

### 读数

- 同 HEAD（`a68caa7`）干净 worktree：`typecheck` exit **0**；`test` **195 files / 1964 绿 + 2 红**
  （`gated-tools`、`runner-gates`，即待办 #33——别人在飞的 `agent-runner.ts` + `tools/base.ts`，本笔之前就在红）。
- 工作树（含别人在飞改动）：`test` **197 files / 1986 测全绿** exit 0，`typecheck` exit 0。两个读数不是同一件事。
- 新锚点 `per-type-shell-blindspot`（把通用记录支的某一型提前 `break` 在卡外）在 `a68caa7` 的干净 worktree 里
  **真杀死**：基线绿 → 突变红在期望用例（`AssertionError: goal_set 成了单元却渲染不出 .msg 壳`）→ 还原绿。
- 判据自己造过红：临时删掉样例表里 `goal_stopped` 一行 → 该文件当场 **2 条红**（覆盖断言 + 逐型主判据），
  逐字还原后 15 条全绿。⇒ 「加新事件型要顺手补样例」这条规矩不是写在注释里的期望，是有门的。
- 针脚体检 **657 条，阻断 0**、改法语法全过。

### 两处自己踩的坑（都已进记忆，写在这里是为了读数能对上）

1. 锚点第一次跑报「1 条变异存活或误伤」，而输出里明写着突变体被抓住了。原因是 `expectFail` 是
   `hit.out.includes(...)` 的**子串比对判据**，我把它写成了对判据的散文 ⇒ 永远对不上 ⇒ 好锚点长得跟坏锚点一样
   （`a68caa7` 修的是标签，产品与测试一字未改）。已升为项目记忆规则 77。
2. `pnpm typecheck | tail -15` 的退出码是 `tail` 的：它报 "exit code 0" 时日志里明写着 TS2345 与
   `[ELIFECYCLE] Command failed`。差点把一次真红报成绿。已补进「报数前先重测」。

### 仍留的洞（有名有姓，不当已完成）

`buildUnit` 交回的是 `frag.querySelector('.msg')`——**「恰好一个」只判住了「零个」，没判住「多个」**：
一个单元真产出两个壳时，这条通判与 B25 都是绿的（多余那个只是把布局撑高）。要钉住它，得让产品侧
对 `>1` 也出声（一行 + 一条断言 + 锚点扩到同时废「零壳」与「多壳」两支，规则 69 的形状）。已立待办 #35。

### 补：上面那句「仍留的洞」当场关掉（同一晚，`7173800`）

原文保留不改写（那是 `eaed2fb` 那一刻的真态）。补法与读数：

- 产品侧：`buildUnit` 改成**数壳**——`0 个` 与 `>1 个` 各出一句 `console.error`（阈值一字未改，只是把不变量的
  另一半说出来）。多壳不崩、也不少东西，所以它比零壳更需要出声：B25 的 console 道是它在真窗口唯一的读者。
- 离线侧：逐型通判从「有没有壳」升成「**恰好一个**壳」；整窗那条同时判两侧（每格一个 ⇒ 单元数 == 壳数），
  因为只数总数会放过「一格两壳 + 另一格无壳」这种自我抵消。
- 锚点四条在同 HEAD（`7173800`）干净 worktree **全部真杀死**：`null-shell-silent-skip`、
  `per-type-shell-blindspot`（零壳那一半）、`per-type-double-shell`（多壳那一半：孤儿支改用 `openMsg` 另开一格）、
  `orphan-tool-result-silent-drop`。
- 读数：`typecheck` exit **0**；全量 `test`（工作树，含别人在飞的 `agent-runner.ts`/`tools/base.ts`）
  **197 files / 1986 测全绿** exit 0；`panels-check` exit **0**（186 ✅，B25 四扇窗 × 两条通道自检全绿，
  滚动 17ms 未放宽阈值）。针脚 **658 条、阻断 0**、改法语法全过。
