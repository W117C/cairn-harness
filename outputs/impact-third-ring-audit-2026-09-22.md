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

