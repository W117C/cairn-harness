# 半截会话续不回去：孤儿 tool_call 在投影出口合上（2026-09-23）

对应任务 #57（已结案）。改动已在 HEAD：`b4ce2c5`（修 + 判卷）、`0df3d6b`（行号坐标）、`8804ea3`（注释纠错，见 §五）、
`4c18fb7`（**我自己那两笔的回归**，见 §八）、`b49bee7`（第三条锚点）。

## 一、现场读数（可复跑）

```
node -e '…读 ~/Library/Application Support/m0-agent-loop/sessions/*.jsonl 末三行…'
  会话文件数= 1
  tool_result      {"callId":"c2","ok":false,"output":"[permission denied] write_file 在 default 档下被门拒绝（未获批准）"}
  assistant_message {"content":"修复完成，跑测试验证。"}
  tool_call        {"id":"c3","name":"run_shell","args":{"command":"pnpm test"}}
  末事件= tool_call c3 · 盘上有配对 tool_result 吗= false
```

⇒ 这台机器上唯一一条持久化会话**以一次没有结果的调用收尾**。分母只有 1，所以这条不是
「统计出来的高频缺陷」，而是「一条真轨迹足以证明这条面没人看过」。

## 二、判据（不是我的偏好，是 provider 的硬要求）

`projectContext` 是逐事件投影：一条 `tool_call` 推一条 `assistant.tool_calls`、一条
`tool_result` 推一条 `role:"tool"`。断掉的会话因此留下一条**永远等不到结果**的 assistant 消息。
OpenAI 兼容端要求「带 `tool_calls` 的 assistant 之后必须紧跟覆盖这些 id 的 tool 消息」
⇒ 不满足是 **400 请求体错误**，不是"历史少一句"。

后果落在能力 4 的正面上：**这条历史续不下去**——重开一个被切断的会话 = 一次失败的请求 +
用户看到"打不开"。`tests/context-dangling-tool-call.test.ts` 里的判据不复制实现，
它按上面那条规则直接量投影结果（`firstIllegal`）。

## 三、修法与面选择

改在**投影出口**（`closeDanglingToolCalls`），事件流一个字节不动：

- 不在写盘时补一条假 `tool_result` 事件 ⇒ 那会污染时间线、靶场草稿（#53 刚建的「半截轨迹要出声」
  判据正是数这种未答调用），也会让 `solpi` 的 `sent()` 误记一次可见发送（它按 tool_result
  **事件**配对计数，补出来的消息没有对应事件 ⇒ 天然不计，测试里单独核过）。
- 只补"紧邻缺位"的 id ⇒ 已配对的完整历史投影**逐字不变**（反面对手钉着）。
- 补的正文说的是实话：「没有收到结果…别假设它已生效——需要就重新发起，或先确认盘上现状」。
  不编一个结果骗模型。代价：只在断会话上多一条消息，完整历史 0 增量。

## 四、验证读数

| 面 | 读数 |
| --- | --- |
| 判卷先写后跑 | 改前 **3 红 / 2 绿**（红＝末笔就断、中段就断、一次中断吞两笔；绿＝反面对手、worker 子流那条）。失败消息带位置与 id：`firstIllegal` 返回「第 N 条 assistant 的 tool_calls 缺结果：<ids>」（该串现在就在那份判卷文件里，可直接核） |
| 改后 | `tests/context-dangling-tool-call.test.ts` **6 passed**，exit 0（第 6 条是 §八 那笔回归补的） |
| 邻域回归 | solpi-runtime(9) + compaction(27) + context-auto-verify-note(9) ⇒ 当时 4 文件 50 测试 exit 0；**但这条邻域没抓到回归**，见 §八 |
| 全树类型 | `pnpm typecheck` → **0 条报错** |
| 静态针脚体检 | `--check-needles`：三条锚点入库后 **736 条 —— 阻断 0，待复认 0，未覆盖 0**；改法语法体检 736 条全合法 |
| 分辨力（真跑，非静态） | `dangling-exit-not-wired` ✅、`dangling-note-claims-success` ✅、`dangling-answered-set-ignored` ✅，三条共 3.4s，无 `.mutbak` 残留，`src/agent/context.ts` 复原后对 HEAD 干净 |

两条锚点各钉一面：**接线**（`return closeDanglingToolCalls(msgs)` → `return msgs`，函数在、判卷在、
真路径照旧吃 400 = 「两头断」那一族的又一格）与**诚实性**（文案改成「已经收到结果了」⇒ 400 消失
但模型被喂了一句假事实，比红更坏的静默幻觉）。

⚠️ **本文 §四原先写的「两条锚点只在树里、不在 HEAD」已在当天结案**（原判据下文保留，不静默改写）：

- 前两条（`dangling-exit-not-wired`、`dangling-note-claims-success`）被**另一会话的整文件提交一起带走**了
  ——`scripts/mutate-verify.mjs` 当时是混 hunk 文件，我按纪律没提交它 ⇒ 我那条"欠入库"的声明
  **在十几分钟内就过期**。核法（可复跑）：
  `git show HEAD:scripts/mutate-verify.mjs | grep -c -E "dangling-exit-not-wired|dangling-note-claims-success"` → 2。
  通用教训：**"欠入库"这类声明必须自带复算命令，且下次开工先复算**，否则它会变成一颗读起来像现态的错字。
- 第三条 `dangling-answered-set-ignored` 是我**自己那笔回归**的锚点（见 §八），提交前
  `git diff -- scripts/mutate-verify.mjs | grep "id: \""` 只输出我这一条 ⇒ 已单文件提交（`b49bee7`）。
- 三条真跑读数：`node scripts/mutate-verify.mjs dangling-exit-not-wired dangling-note-claims-success dangling-answered-set-ignored`
  ⇒ **3 ✅，3.4s**，无 `.mutbak` 残留；`--check-needles` 736 条阻断 0。⇒ 该不变量现在判卷与锚点**两侧都在 HEAD**。

## 五、本轮顺手抓到的两处自身错误（原文保留）

1. **写死的行号坐标**：判卷头注原先写 `src/agent/context.ts:179-191` ——我自己这次改动就把那段推下去
   30 多行，即写即漂。改成按符号定位（并发热点文件的行号一律不写死，AGENTS.md 已立过这条）。
2. **不成立的归因**：修法的注释原先写「被压缩摘掉 tool_result 时也会踩到」。读 `atomicUnits`
   （`src/agent/compaction.ts`，切点纪律 1）后**证伪**：它按 callId 把 `tool_call↔tool_result` 并成
   一个原子单元，切点不拆对 ⇒ 压缩面不产这种形状。已改成为「任何投影出口都不留未答调用」的兜底，
   并把成因只写进程切断。留着原句就是下一颗读起来像现态的错字。

## 六、与既有各面的关系（避免重复记账）

- **#53（靶场草稿说「这条轨迹是半截的」）**：同一现场的**读法**那一半——草稿面出声给人看；
  本条是**送模型那一半**——不修则用户根本走不到"重开这条会话"那一步。两支取料面各测一件事，
  不互相替代。
- **能力 5 的自动验证拍（`avnote-*`）**：同文件同族的注入分支，锚点簇现共 6+2 条。
- **归因面同族**：本条不属于 callId 撞号那一族（worker 子流的调用在投影里就不进主流，测试第 5 条
  钉住了"补位也不许为它造 tool 消息"）。

## 七、重开条件与留位

- 若将来有面单独摘除 `tool_result`（压缩策略变更），本条出口守卫仍成立；但届时应在**那一面**补一条
  自己的判卷，而不是靠这里兜。
- 「一次中断吞多笔」目前按 assistant 消息内并列 `tool_calls` 各补一条；provider 若改为一次 assistant
  携带多笔调用且允许乱序回答，紧邻扫描的写法需要重读（现在的判卷只保证"至少覆盖 id 集合"）。
- 分母只有 1：真窗口里"重开被切断的会话"端到端未跑（要花真钱，与 worker 界面那条
  「点了真生效四半边」同批开口）。这里只声称投影层可发送，不声称续跑体验已验收。

## 八、我自己那两笔的回归（`4c18fb7`，由全量 test 门抓出）

上面 §三 写的「只补**紧邻缺位**的那些」是错的判据，且错的是一条**普通路径**：

```
工具 run() 里 ctx.emit({type:"assistant_message"}) ⇒ 落流顺序是
  tool_call(c1) → assistant_message("EMITTED") → tool_result(c1)
投影后：assistant(tool_calls:[c1]) → assistant("EMITTED") → tool(c1)
按"assistant 之后紧邻的 tool 段"判缺位 ⇒ c1 被判成没结果 ⇒ 凭空插入一句
  "[harness] 工具调用 c1 没有收到结果…"，而下一格就是它的真结果
```

`tests/loop.test.ts > loop context feedback > includes tool-emitted events in persisted order`
实测收到 `[null, "<harness> …没有收到结果…", "EMITTED", "RESULT"]`，期望 `[null, "EMITTED", "RESULT"]`。

**为什么邻域没抓到、全量抓到了**：我改后跑的是 context-dangling + solpi-runtime + compaction +
context-auto-verify-note（4 文件 50 测试全绿）——**我新写的那份判卷本身没有"结果在后头"这一格**，
而既有那条 loop 用例有。⇒ 再次坐实既有规矩「跑改动邻域 ≠ 跑那道门」（规则 58）；这条回归的
观测者不是我写的断言，所以它同时是"全量门抓回归"的证据，而不是"我补个测试盖住自己"。

修法：缺位判定改成「按 id 在**全列表**里查有没有 tool 消息回答过它」（`answered` 集），注入按 id 去重。
新增第 6 条判卷钉住这个形状；锚点 `dangling-answered-set-ignored` 的改法**即复现该失效方式**
（把 `answered.has(tc.id)` 那一半去掉）。读数：5 文件 72 测试 exit 0、typecheck 0 错、三条锚点 3 ✅。

## 九、面板面的先量后改（原开成任务 #58）

把这条真会话离线过一次投影（脚本跑完即删，不落仓）：

```
文件= 会话 2026-09-10 03:13.jsonl   事件数= 9
projectPanelData(...).terminal 行数= 1
ok===null 的行= ["c3:pnpm test"]        ← 「执行中…」那一格，当场量到
带 agent_id 的 tool_call 事件数= 0        ← 归因那一格在这条素材上分母为 0
tool_result 事件数= 2
```

⇒ 第一格（缺席当运行中）是**真实现场**，不是代码读出来的可能性；第二格（子流混进父面板）在这条素材上
量不到 ⇒ 只能靠构造用例，且据此说明"为什么它的判卷只有单元层、没有真窗口层"。修法与读数见 §十。

## 十、面板面那两格也收了（`5432cad` + `eeb8731`）

同一条断会话往下一格：`projectPanelData` 把无结果的 `run_shell` 投成 `ok === null`，字段注释写着
「null = 结果未回（运行中）」，`app.js` 据此渲染「执行中…」⇒ **重开这条早死掉的会话，右栏终端面板
永远挂着 "pnpm test 执行中…"**。这是"结果缺席"被当"仍在运行"的代理信号（与 §八 那笔同类：都在猜，没看事实）。

修法两层：状态判据收成一份纯投影 `terminalRowState(ok, live)` 四态（running / lost / ok / failed），
liveness 由渲染层给 —— `panelLive = !historyEvents && !!real.running`，写在 `refreshPanels` 里与投影同拍；
`data-term-state` 是给门禁的读点（不依赖中文文案，走 `data-impact` 那条既有规矩）。

同一段循环还漏了第二格：**它没过 `entersMainConversation`**，而对话面两处都过了 ⇒ worker 子流执行的命令
出现在父会话的「本会话命令」里。按 #53 的教训两侧都挡（`seen` 用 provider 的 callId，缺省是流内序号 ⇒
parent 与 worker 可以都有 `call-0`）。

读数（判卷两层 + 门一层）：

| 面 | 读数 |
| --- | --- |
| 单元（`tests/renderer-terminal-liveness.test.ts`，先写后跑） | 接线 3 条改前全红 ⇒ 改后 **10 passed**；归因 2 条改前红（第 3 条反面对手本来就绿） |
| 真窗口（`pnpm panels-check` 新增 B26 五条断言） | **exit 0**；实测无结果那行 `state="lost"` 文案「无结果（上次运行在这次调用中途结束）」，配对行 `state="ok"`「✓ 执行完成」（手法同 B23：追加既有事件 + 切走再切回，零模型调用） |
| 邻域 | projections / panel-data / panel-dirty-freshness / renderer-agents-view / history-window 全绿 |
| 锚点 | `term-null-always-claims-running` ✅、`term-terminal-no-attribution-filter` ✅（2.3s）——**同样只在树里**，`scripts/mutate-verify.mjs` 此刻又被别人的 `lr-*` 一批占着，复算：`git show HEAD:scripts/mutate-verify.mjs \| grep -c term-null-always-claims-running` |
| 全量 | 面板簇入库后复跑：`TERM=dumb node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts` ⇒ **206 files / 2144 tests / 0 failed，exit 0**（同轮 `pnpm typecheck` 0 错、`node --check src/renderer/app.js` 0、`pnpm run panels-check` exit 0） |

未证/口径：**归因那一格只有单元判卷，没有真窗口侧**（check 窗口里没有带 worker 的会话素材）；
`panelLive` 取的是「不是重放 ∧ 有 run 在飞」，跨会话同时跑的窗口未验证（同一时刻只有一个 `real`，
开着别的会话必然带 `historyEvents` ⇒ 推理上够，但那是推理，不是读数）。

## 十一、旁注（别人的在飞面，不归我修，留个指针）

`--check-needles` 这一轮报 742 条里有一条 ⚠️ 待复认：`probe-delta-sign-reversed` 的针脚在
`src/agent/gym/probe.ts` 的**在飞版本**里命中 2 处，而 `replace` 只改第一处 ⇒ 那条锚点现在打在哪个符号上
需要持有该簇的会话复认（阻断仍是 0，不是红）。

## 十二、第四格：未确认的写入曾读起来像已落盘（`2993e0f`，任务 #60）

同一条流继续往下找面，第四格在**写入行**：无结果的 `write_file` 投出 `ok: null, created: true`
（离线过投影的实测读数），而渲染层只在 `ok === false` 时挂「未落盘」chip，null 什么都不写
⇒ 审阅页把"这笔写入没有结果"显示成一条正常新增；**文件树更彻底——它连「未落盘」都没写过**
（同一个字段的两处渲染各自判据，其中一处判据干脆缺席）。能力 7「操作可审计」被折叠成"成功"。

修法换了个位置：**三态在投影期派生、挂到行上**（`projectPanelData.files[].write = fileWriteState(ok)`，
`kind ∈ written / rejected / unconfirmed`），两处渲染读同一份数据 ⇒ 以后再加面也不会"各写各的判据、
漏一处"。读点 `data-write-state`。成功仍不报数（本仓政策），未确认必须占位。

| 层 | 读数 |
| --- | --- |
| 单元（先写后跑） | 新 4 条里 3 条改前红 ⇒ 改后本文件 **18 passed** |
| 真窗口 `panels-check` B27 | **exit 0**，六条：未确认行 `data-write-state="unconfirmed"`、被拒行 `"rejected"`（既有那句不改指）、落成的行 `["no-chip","false"]`（反面对手） |
| 锚点 | `term-write-null-collapses-to-written` ✅ 1.2s（第 4 条，仍在工作树等窗口，见 #59） |
| 全量 | **207 files / 2162 tests / 0 failed exit 0**；`pnpm typecheck` 0 错；`node --check src/renderer/app.js` 0 |

随字段补的两处既有判卷：`tests/panel-data.test.ts` 的整行 `toEqual`、`tests/renderer-panels-real-data.test.ts`
的构造行——都用 `fileWriteState(...)` 真实现派生，**不在测试里抄一份政策**。

未证半边：文件树那一格靠"同一份 `f.write` 数据"推定，**树视图本身没有独立的真窗口断言**（B27 读的是审阅页那一行）。

## 十三、第三格：转录面（`d73077f`），以及我这一跳自撞的两处

（编号按"物理阅读顺序"排：本节写在前一次提交里、标题曾为 §十二，`59fa7bb` 的提交信息即指本节。
先有转录格、后有上面那格写入行，两节的**内容**都没改过。）

`app.js` 的 `tool_call` 分支一律先画 `<span class="ti-state pending">…</span>`、等 `tool_result` 来改口
⇒ 被切断的会话重开后，末笔**永远挂着省略号**（同一件事实的第三个取料面）。判据只留一份：
`projections.unansweredToolCalls(events)`（子流两侧都挡），`showHistory` 一次算好，渲染按 id 读，
读点 `data-tool-state`。

两处我自己造的错（都由**验证**抓到，不是推出来的）：

1. **新读点在状态翻转时不跟着改口** —— B26 第一次真跑就报 `paired="pending"`：有结果的那笔被门禁读成
   "还没结果"。而我当时那条反面对手写的是 `!== "lost"`（弱断言），**恰好放过了自己的假读数**。
   已补 `setAttribute`、把断言收成 `=== "ok"`、给 `verify_result` 那张卡补同一读点；
   现测 `{cut:"lost", paired:"ok"}`。⇒ 立一条新规矩：给门禁加的读点，凡是"另有可变状态"的，
   改口处必须同步，且反面对手要断"正确的值"，不是断"不等于坏值"。
2. **新全局打断三套跑 app.js 切片的判卷**（15 条红：`renderer-history-live` 10 / `renderer-run-control` 3 /
   `renderer-panels-real-data` 2，全在 `showHistory` 里 `ReferenceError: unansweredToolCalls is not defined`）。
   走共用绑料 `tests/renderer-vm-module.ts` 补真实现（不塞桩）。⇒ 规则 55 的又一格：**给 app.js 加一个
   模块级绑定 = 给所有切片判卷加一笔债**；这笔债是 ReferenceError（响亮），不是静默换判据，所以可接受，
   但下次加之前先数有几家在跑切片。

读数：全量 **206 files / 2148 tests / 0 failed exit 0**（中途那次 15 红就是第 2 条，已修）、
`pnpm typecheck` 0 错、`node --check src/renderer/app.js` 0、`pnpm run panels-check` exit 0；
锚点 `term-*` 三条真跑 **3 ✅**（2.8s）——仍在工作树里等窗口（任务 #59，含这第三条）。
