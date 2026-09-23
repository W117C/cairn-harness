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

## 九、同一现场的下一格（已开任务 #58，未动代码）

`projectPanelData` 的 terminal 段（`src/renderer/projections.ts`）把 `ok: null` 注成
「null = 结果未回（**运行中**）」，`app.js` 据此渲染「执行中…」。⇒ 重开这条断会话，右栏终端面板会
**永远**挂着 `pnpm test 执行中…`，而那进程早死了。这是同一条不变量在**面板面**的缺失，
且顺带露出第二格：那个循环**没有过 `entersMainConversation`**，而对话面两处都过了
（`app.js` 的投递循环、`history-window.js` 的 `projectUnits`；行号不写死，那两个文件是并发热点）
⇒ worker 子流的 `run_shell` 会被算进父会话的终端面板（同一份解析只硬化一支，第六族）。
两条都还没实测真伪（本 § 只陈述代码读到的判据形状），开工先做：**用这条真会话文件离线跑一次投影，
量出 terminal 行数与 `ok===null` 的条数**，再决定是"取运行态"还是"取事件流末态"。
