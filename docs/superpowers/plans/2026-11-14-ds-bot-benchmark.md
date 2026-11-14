# 调研计划（自研）：以 DS-Bot 为参考材料，拆「bot 团队协作核心」

> 性质：**调研计划**，不是设计，也不是实现授权。本文件只定「怎么查、查到哪算够、结论落哪」。
> 实施（写 spec、写代码）另起一轮，需业主看过本计划与裁决文档再放行。

**业主裁决（2026-11-14）**：

- **范围**＝bot 团队协作核心；
- **落点形态**＝由本调研的差距表裁决（不预设）；
- **定位＝自研**。DS Bot 只是**参考材料**：我们**不复制**它的代码、命名、数据结构、文案与界面，
  只取三样知识——**它解决了什么问题、用了什么机制、为此付了什么代价**——然后按**本仓自己的地基**重新设计。
  （它本身是 Apache-2.0，法律上可以复用；此处不复用是**产品裁决**，不是法务限制。）

**版本**：v2（深化版）。v1 只给了调研提纲；v2 补了三样此前缺失的东西——
① 上游 10 篇已决设计读完后的**机制数据形状**（不读就没有候选设计，全靠猜）；
② **候选数据模型 × 本仓铁律的相容性矩阵**（bot 实体/群聊/段/@路由/记忆/管家/长文本各 2–3 个候选）；
③ **落点候选 A/B/C/D 的轮廓与定价**（让 Q10 在 Phase 3 真能被裁决，而不是到时候才现编）。
新增 6 个调研问题（Q11–Q16），补 1 条完成判据（J6）。
v2.1（2026-11-14 晚）：业主定「**自研**」⇒ 全文从「移植可行性」改读作「**参考性**」，
形态 B（插件化落点）作废，新增 §1.1 自研原则、Q17/Q18。
v2.2（2026-11-14 晚）：业主定「**根据我们仓库的项目自研**」⇒ 新增 §3.5「本仓原生自研骨架」：
团队＝成员档案 ＋ 成员线程 ＋ 编排三层，全部挂在既有件上；真正新增只有三件（成员档案/发言权/段）。

---

## 一、目标与完成判据

上游 `Fei2411/DS-Bot` 把 harness 变成「一队长期存活的 bot」。本轮要在本仓**自研**同一种能力之前，
先把三件事做实：**上游机制读透**（取问题与取舍，不取实现）、**本仓现状核清**、**落点形态给出裁决**。

调研本身的可判卷完成标准（六条同时成立才算调研做完）：

| # | 判据 | 产物在哪 |
|---|---|---|
| J1 | 上游 12 个核心机制逐个有「机制说明 + 数据形状 + 上游出处 + 本仓对应物」 | 本文件 §二 + ADR 0015 |
| J2 | 本仓 12 个目标能力面逐项有 `file:line` 证据与「已有/部分/无」判定 | 本文件 §三（初盘，待 Phase 2 复核到 HEAD） |
| J3 | 落点形态给出裁决 + 理由 + 「选另一形态会多付什么」的对照 | ADR 0015 §裁决 |
| J4 | 每条建议的实现都有判卷口径（写成测试的断言形态，不写「做得好」） | ADR 0015 §判卷 |
| J5 | 结论进 ADR、台账进 PROGRESS 一页、原始证据进 `outputs/`（非 TS 制品） | ADR 0015 / PROGRESS / `outputs/ds-bot-benchmark-2026-11-14/` |
| J6 | 【新】每个候选数据模型都写明它与本仓四条铁律的相容性，以及**它需要哪些上游没有的基础设施**（无等价物的必须点名） | 本文件 §四 |

**不做**：本轮不写 bot 团队的任何实现代码，不改冻结判据，不动事件日志种类。

### 1.1 自研原则（四条不可越线）

自研定位要在**方法**上落成规矩，否则「参考」会不知不觉变成「照抄」：

1. **不复制实现**：不搬上游代码、不沿用上游命名（`message_bot`／`post_to_group`／`group_goal`／
   `MEMORY.md` 条目格式／`state.json` 字段名）、不搬文案与界面。
   ⇒ 我们的命名必须从**本仓既有约定**出发（事件种类、`permission_mode`、`session_meta` 补丁通道、
   `AgentPermissionMode` 等），让「像本仓的」成为可判卷的判据。
2. **只取问题与取舍**：每个上游机制进仓时，必须写成「它解决什么问题 / 代价是什么 / 我们要不要」三行，
   **不以「上游这么做」作为理由**。理由必须落在本仓的约束上（事件溯源、分叉、权限单调继承、门禁）。
3. **以我们的地基为准**：本仓有上游没有的东西——**重放、分叉、审计、gate 留痕、单调继承的权限档**。
   ⇒ 每个机制都要先问「用我们的地基能不能做得更强」，再问「上游怎么做」。
4. **缺口也要自己填**：上游自承的坑（无私密性强度、无总量上限、依赖宿主附件库、群日志单写者）
   不是可选抄的细节，而是**我们的设计输入**；抄坑等于自研失败。

**自研与「抄」的分界线（可判卷）**：

| 判据 | 抄 | 自研 |
|---|---|---|
| 上游的东西在本仓出现时 | 能说出「上游叫什么、在哪个文件」 | 只能说出「它解决什么问题、我们的解法是什么」 |
| 命名 | 与上游同名同义 | 与本仓既有约定同源（同一个词在本仓已有含义时不另造） |
| 机制取舍 | 「上游也这么做」 | 「我们的约束要求这样，因为……」 |
| 缺口 | 跟着上游缺 | 明确写出我们补了什么、判卷是什么 |

---

## 二、上游事实基线（参考材料，非移植源）

### 2.1 身份与形态

- 仓库：`Fei2411/DS-Bot`（Apache-2.0；README 自述为**独立社区项目，非 DeepSeek 官方**）。
- 形态五种，同一套插件源码跑五种壳：`ds-bot` 插件（DSH Web/Desktop）、独立桌面 App、`link/` relay 中转、
  `mobile/` 移动端、`browser-plugins/` 浏览器插件。
- 上游自己的产品定位（`docs/vision.md`）：**十条核心要求**（建于 DSH 而彼此独立、可靠、记忆与持久、
  权限层级、群聊、工作目录、专属浏览器、界面与动效、独立 App、本地 agent），取舍原则三条：
  「正确行为优先于兼容 DSH」「数据留在用户电脑上」「done means checked」。
- **已决设计有 33 篇中文文档**（`docs/plans/`），本轮读了其中 10 篇（切片内全部核心机制）。

### 2.2 体量与接入方式（实测）

| 维度 | 实测值 | 复算命令（见 §十 证据落点） |
|---|---|---|
| 宿主层 `ds-bot/src/host/` | 约 3.0 万行（`groups.js` 单文件 1956 行、`memory.js` 1797、`turns.js` 1244、`tools.js` 1227） | `find ds-bot/src/host -name '*.js' \| xargs wc -l` |
| 客户端层 `ds-bot/src/client/` | 36194 行 / 104 个文件（自绘 UI，非主题换皮） | `find ds-bot/src/client -name '*.js' \| xargs wc -l` |
| 测试 | `ds-bot/test/` 200+ 个 `.test.js`（每个机制一个文件） | `ls ds-bot/test \| wc -l` |
| 已决设计 | `docs/plans/` 33 篇中文设计文档 | `ls docs/plans` |
| 接入方式 | cordis 插件注入 `llm / tools / systemPrompt / sessionController / sessions / sessionTitle / workspaceRegistry / connection` | 读 `ds-bot/index.js` 头部 `export const inject` |

> 上游插件的关键前提：**它是 cordis 插件，能注入 `sessionController` 并改写客户端 bundle**。
> 本仓插件面是声明式 hook（§3.3），**不满足这条前提**——这是落点裁决的第一条硬证据。

### 2.3 十二个核心机制（本轮切片）

| # | 机制 | 规则要点 | 上游出处 |
|---|---|---|---|
| M1 | 长期存活的 bot 实体 | 每个 bot ＝一个 root Session ＋ 名字/角色/指令/模型/思考强度/工作目录/能力；roster 增删改落 `state.json`；主 bot（Chief）权限最高、可建删他人；bot 的 `id` 就是第一个私聊段的 Session id，永不变 | `src/host/roster.js`、`docs/plans/2026-10-10-bot-runtime.md` |
| M2 | bot↔bot 消息 | `message_bot` 把消息投给另一个 bot；未读消息**按发件人合成一条**；`request_id` 幂等（同 caller+场合+名字+内容指纹 ⇒ 返回首次回执，不重发）；回执**先写盘再送达** | `src/host/delivery.js`、`src/host/requests.js`、`docs/plans/2026-10-16-bot-handoffs.md` |
| M3 | 群聊 | 两种回复模式（`admin` 管理员先答 / `everyone` 全员按序）；`@all` 只有管理员说才算；同一条消息点到的成员**同时开工**且互相看不见对方这轮的回答；`@` 一发出来就生效；一轮进行中用户的话立刻进群；每成员同时只答一个叫它的消息；空转守卫（连续 6 轮 0 工具调用 ⇒ 暂停，等用户发言才恢复）；`[PASS]` 跳过（但「收到/这就去查」这种要先续推一次） | `src/host/groups.js`、`src/shared/mentions.js`、`docs/plans/2026-10-07-group-chat.md` |
| M4 | @ 接力与交接 | 被 @ 的 bot 独立干活、群里继续、事后回报；交接用**交接笔记 + 交接包**；**每个群成员在群里有自己的段（隐藏 Session）**；派活是一棵**树**（下面没交回，上面就不交） | `src/host/handoffs.js`、`src/host/parts.js`、`docs/plans/2026-10-16-bot-handoffs.md` |
| M5 | 每 bot 工作目录 | bot 可有自己的工作目录；群可统一目录；越出团队工作区要审批；**私密 bot 的目录强制不重叠** | `src/host/folders.js` |
| M6 | 每 bot 权限档位 | **两层权限互不干涉**：角色权限由 DS Bot 自己查（谁能建/改/删 bot、谁能推进群 Goal）；沙盒权限交给 DSH 的 preset 执行；生效优先级 `room?.permission ?? bot.permission`；**只有人能改**，bot 改一律拒；改档要**每个 Session 重新 apply** | `src/host/permissions.js`、`src/host/tools.js`、`docs/plans/2026-10-07-roles-and-permissions.md` |
| M7 | 私密 bot | 单向边界：别的 bot 读不到它的目录/记忆/聊天；对外分享要人审批；不能是主 bot、不能入群、不能复制；**它的子 agent 也一并关闭** | `src/host/privacy.js`、`docs/plans/2026-10-27-private-bots.md` |
| M8 | 三档记忆作用域 | bot 自己的 / 群共享的 / 团队共享的；Markdown 条目（Agent Memory Repo 格式）；`remember`/`forget`/`recall`；**四种读法**（常驻冻结 / 增量 / 自动召回 / 按需）；每层额度（群 12000、bot 8000、团队 4000 字符），每层进提示词 ≤ 可用窗口 2%；原子写（`pending.json` → 改文件 → journal 行 → 删 pending）；冻结 ⇒ 提示词逐字节不变（保前缀缓存） | `src/host/memory.js`、`src/host/memory-entries.js`、`docs/plans/2026-10-09-context-and-memory.md`、`docs/plans/2026-11-09-memory-layers.md` |
| M9 | 上下文管家 | **不做普通压缩**：四条线跟着模型走（W=窗口声明、U=W−回复预留、H=0.95U、C=checkRatio×U 默认 0.8）；回合结束且 ≥C 才判一次（回落后要再涨 C/4 才再判）；判定＝**一次独立小模型调用**，输入只有本段最近消息（≈6000 tokens/单条 ≤1500 字/40 行）+ 三行元信息，输出**封闭二值** `{"action":"switch"\|"compact"}`，判定失败 ⇒ 换段 | `src/host/steward.js`、`src/host/parts.js` |
| M10 | 聊天全文索引 | `node:sqlite` FTS5（trigram + BM25），索引从 Session 日志派生，`read_own_chat` 搜 bot 私聊**所有段**（含被压缩掉的） | `src/host/chat-index.js` |
| M11 | 用量统计 | 按时间 / 按 bot / 按模型三视角；会话日志回溯 + 流式补充；只算 token 不算钱 | `src/host/usage.js` |
| M12 | 密钥 | bot 用卡片申请、**永远看不到明文**；按 bot 或全员授权；以 `DSH_SECRET_<NAME>` 注入环境；输出掩码；`secrets.json` 600 原子写 | `src/host/secrets.js` |

### 2.4【深化】机制的数据形状与**可参考性**判定

这一节是 v2 的核心：**上游哪些是「纯规则、换个地基照样成立」（可参考思路），哪些是「绑死在上游的文件式存储上」（只当反面教材）」**。
自研定位下，读它的目的是**分清可参考的思路与不可照搬的实现**：
上游的数据形状是**它的答案**，不是我们的需求；我们要的是它**回答了哪些问题**、以及**为此付了什么代价**。

| 机制 | 上游的权威数据形状（**参考对象，非我们的需求**） | 落盘 | 可参考性判定（只问：换个地基还成立吗） | 我们要自己怎么解 |
|---|---|---|---|---|
| bot 实体 | `state.bots[id] = { id, name, role, color?, avatar?, model?, effort?, workDir?, sectionId?, instructions, createdAt, createdBy, capabilities: [] }`；运行期追加 `sessionId` / `segments[]` / `kickoff` / `blocked` / `private` / `appliedModel` | `state.json`（整份重写） | ⚠️ **半参考**：字段语义可借鉴，载体必须换（见 §四 4.2） | bot 身份不再挂在 Session id 上；`segments[]` 改成事件分界 |
| 群 | `state.rooms[id] = { id, name, members: [botId], admin, mode: 'admin'\|'everyone', notice, createdAt, createdBy }`；运行期追加 `log`（最近 60 行）/ `seq` / `sessions[botId]` / `segments[botId][]` / `parts[]` / `seen` | `state.json` | ⚠️ **半参考**：群成员/管理员/模式可直接借鉴；`log`/`seq` 要换成事件流 | 群的「行号」= 事件序号；轮次 slot 落在哪儿（§四 4.3） |
| 轮次 | `round = { roomId, members, startSeq, slots[], batches, passed[], failed[], started[], soleAdmin?, kickoff?, goalNudge? }`；`slot = { id, name, status, batch, ordered?, fromBot?, ... }`，status ∈ waiting/speaking/posted/passed/missed/working/waiting-approval/failed/left | `state.json` | ⚠️ **需自己重解**：轮次是**运行期簿记**，上游落 state.json；我们的事件种类封闭（39 种不可新增）⇒ 轮次要么走既有事件的可选字段，要么只做投影 | 轮次是**投影**还是**事件**？这是 Q13 的核心 |
| 群日志 | 一行 = `{ seq, botId?, text(前 2000 字), length?, time, kind?, who? }`；`kind` ∈ notice/lookup/approval/working/goal/round/anchor | **`ledger/group-<id>.jsonl`（只追加，全文）** ＋ `state.json` 存最近 60 行缓存 | ✅ **同构（思路可参考）**：上游的「只追加账本 + 有损热缓存」＝ 我们的「事件日志 + 投影」 | 把 `state.json` 那层换成我们的投影 |
| bot 间消息 | `state.exchanges[] = { id, from, to, text(前 2000 字), length?, files?, sessionId?, role, time, replyTo? }`；已迁到 **`ledger/pair-<a>-<b>.jsonl`**（请求/回复/停止 + 「已送达」标记） | 账本 | ✅ **同构（思路可参考）** + 一条硬约束：**先写盘再交付** | 用 `agent_message` 事件承载（§四 4.5） |
| 派活树 | `state.works[id] = { from, to, room, parent, open: [workId], results: [], name, at }`；结果全文落 `handoff-results/<id>.txt`，**文件先写、团队文件再引用它** | `state.json` ＋ 文件 | ⚠️ **半参考**：树结构可借鉴；等待关系是**跨重启要续等**的运行期状态 | 等待关系落事件还是落投影（Q13） |
| 请求幂等 | key = `` `${caller}\0${context}\0${name}` ``；记录 `{ fingerprint(sha256(payload)), outcome: pending\|delivered\|uncertain, at, run, receipt? }`；**永不过期** | `state.json` | ✅ **纯规则（可参考）** | 我们已有 `requestId` 幂等键的先例（工具提交），形状要对齐 |
| 权限 | `bot.permission` / `room.permission`（preset id）；生效优先级 `room?.permission ?? bot.permission`；改档要每个 Session 重新 apply，回滚用**请求序号**保证只有最新一次能回 | `state.json` | ✅ **规则可搬**，但 preset 目录来自 DSH；我们已有 `permissions/modes.ts` 五档 + 单调继承 | 我们的档位语义是 read-only/default/guided/auto/full-access，与上游三档**不是一一对应**，要画映射 |
| 段（part） | 一个 part ＝ 一个 DSH Session；三种容器：`bot.segments[]` / `room.segments[botId][]` / `room.parts[]`；段记录 `{ sessionId, endedAt, tokens?, note?, fallback?, noteFrom? }` | Session 文件 | ❌ **强绑定（只当反面教材）**：上游用 Session id 索引段 ⇒ 我们要换成**事件序号/分界标记**（Q11） | 这是上游与本仓最不同的一处，必须重新设计 |
| 检查点 | `[Checkpoint N]` ＋ 摘要 ＋ 面向 Bot 的原话；**软约束**结构（必须写：做到哪/结果/决定与被否掉的/用户约束/剩下的/需原样保留的数据） | 写回同一 Session（就地替换旧消息） | ✅ **纯规则（可参考）**：派生物与原件分离，原件永不修改 | 我们的对应物 = `compaction` 事件 + 投影 |
| 交接包 | `[Handoff · part N]` ＝ 交接笔记 ＋ 最近消息原文 ＋ 其余在哪；**交接笔记是硬约束 8 小节**（Goals / Constraints and preferences / Progress / Decisions / Facts to keep / Open threads / Next step / Where to look），缺一节就整篇作废重问 | 新段的第一条消息 | ✅ **纯规则（可参考）**，但落点是「结构性的新消息」 | 我们的对应物 = 一个**投影生成的消息**，且必须标「这是引用不是指令」 |
| 记忆 | 目录 `memory/{bots/<botId>,groups/<roomId>,team}/` ＋ `journal.jsonl`（含改动前后那一行）＋ `pending.json`（未完成改动）＋ `snapshots/<sessionId>.md`（冻结段）＋ `retired.jsonl`（软归档） | 文件树，原地改 | ❌ **强绑定（只当反面教材）**：原地改 Markdown + 单条撤销 | 若记忆做成**投影**，`journal` 的「前一行/后一行」与单条撤销做不出来 ⇒ 必须裁决「记忆是事件还是投影」（§四 4.6） |
| 全文索引 | `chat-index.sqlite` FTS5（trigram + BM25），索引从 Session 日志派生 | sqlite | ⚠️ **需自己重解**：我们无 sqlite 依赖，且**中文两字词 trigram 匹配不了**（上游自己承认，于是记忆排序改成内存 BM25） | 是否引 SQLite（Q8） |
| 长文本 | 热处只存前 2000 字 + `length` + 全文在哪；> 20000 字的 bot 消息转 **DSH 附件**（内容寻址，相同内容存一份） | 附件库 | ❌ **我们没有等价物（自研必须自己造或换方案）**：上游唯一一处依赖 DSH 提供附件服务的地方 | 冷存储落哪（§四 4.8，Q12） |

**三条「纯规则」（上游自己拆得很干净——思路值得参考，代码我们自己写）**：

1. **管家的二值判定与判定输入最小化**：把「这段对话是否告一段落」剥成独立封闭判定
   `f(最近 N 条消息 + 3 个标量) → {switch|compact}`，判定请求**不带 bot 的长前缀**（否则判定本身打爆上下文）、
   **用 bot 自己的模型**（不用便宜模型判断强模型的活）、**失败即换段**（保守前进，不留在原地）。
   落点在我们这边要换（段 = 事件分界，不是 Session），**判定函数本身与存储无关**。
2. **压缩/切换两结局分立，且派生物与原件分离**：compact ⇒ 就地检查点、同段继续；switch ⇒ 交接包开新段；
   两者共同点是**原件永不修改**。这正是我们事件溯源的地基，**不是要额外设计的东西**。
3. **热/冷分层 + 幂等恢复 + 单一写入口**：热视图有损有界可重算；冷记录不可变只追加；
   跨文件改动走「先写 pending → 改文件 → 写日志行 → 删 pending」，中断后按 pending 补完，同一行不写两遍；
   半行是证据不是数据（挪进 `journal.torn`）。在我们这边对应「投影可有损、事件不可变、投影重算天然幂等」。

**上游刻意不做的事（我们的设计增量，别照抄成短板）**：

- 删掉了所有总量/链长/轮数上限（消息链 6 跳、10 条未读、每群 3 轮、用户发言后全团队 40 条），
  改用「结果自动往上游走」＋「只拦发往等待者的消息」防绕圈；代价是**没有 TTL**——
  上游自己承认「bot 之间不停互相提问会一直跑到用户停下」。
- 不做细粒度角色权限表，界面上也不展示权限矩阵。
- 私密 bot **不拦网络工具**（web_fetch/web_search/浏览器/MCP/shell 里的外联都不拦），
  自己写明「DSH 的文件沙箱不限制读取，路径检查是在工具钩子里做的，不是系统安全边界」。
  ⇒ 若我们做私密性，要么连这些限制一起承认，要么给出更强替代（我们已有权限层与 gate 留痕，可作强于上游的落点）。

### 2.5 上游自己的坑（我们不踩的清单）

- `@` 名字在等待行被宿主当文件引用切断（`@New Bot` 会被切成文件「New」＋「Bot please check」）。
- `web-search-auto` 关闭后 `WEB_PROVIDER_CONFIGURED_MISSING` 全线失败（配置覆盖是整行替换）。
- 插件无法重建 DSH 的原生库（CentOS 7 跑不了 AppImage）。
- 路径检查偏保守：与受保护位置**同前缀**的路径会被一并拒绝；外部改动造成目录重叠时遍历搜索**失败关闭**（牺牲可用性，不泄内容）。
- 密钥掩码只挡**逐字复制**（编码/拆分/反转仍可泄漏）；Windows 上 600 权限无效；非 HTTPS 页面密钥明文过网。

---

## 三、本仓现状

### 3.1 目标能力面逐项判定

| # | 能力面 | 本仓现状 | 证据 | 差距 |
|---|---|---|---|---|
| M1 | 长期存活 bot / roster / 主 bot | 部分：角色定义只读加载，无 roster、无 bot 实体、无高权限主 bot | `src/agent/roles/user-agents.ts:31`、`src/agent/sequencer.ts:62`、`src/agent/supervisor.ts:12` | **大** |
| M2 | bot↔bot 消息 | 部分：`send_agent` 是父→已派 worker 的线程通道，非对等 bot 互聊；无 request_id 幂等回执树 | `src/tools/agent-lifecycle.ts:47`、`src/agent/local-agent-runtime.ts:106` | 中 |
| M3 | 群聊（成员/管理员/轮次/[PASS]/多@并行） | **无**：全仓无群聊实体；`orchestration/engine.ts` 的 group 是控制组（竞速/法定人数），语义无关 | `src/orchestration/engine.ts:29` | **大** |
| M4 | @接力 / 隐藏 session | 部分：交接靠 worker 任务书 + progress/summary 事件；`@` 在本仓是**文件引用**不是 @bot | `src/agent/orchestrator-types.ts:62`、`src/agent/sidechat.ts:234` | **大** |
| M5 | 每 bot 工作目录 | 部分：write worker 有独立 git worktree；无群统一目录 | `src/agent/worktree.ts:19` | 小 |
| M6 | 每 bot 权限档位 | 部分：档位是会话/worker 级，子档不得宽于父档（单调继承已实现）；**我们的五档与上游三档不是一一对应** | `src/permissions/modes.ts:8`、`src/agent/worker-report.ts:30` | 中 |
| M7 | 私密 bot | **无**：记忆只有**项目层 `.agent/` ＋ 全局层 appData**（按工作区分，不按 bot 分），无「别的 bot 读不到」这层 | `src/agent/memory/store.ts:44`、`src/agent/memory/store.ts:38` | 中大 |
| M8 | 三档记忆作用域 | 部分：已有 **常驻**（`inject.ts`）、**沉淀**（`distill.ts`）、**整理**（`consolidate.ts`）、**检索**（`retrieval.ts`/`semantic.ts`）、**写**（`remember` 工具）；**缺增量读、模型侧 forget、三档作用域、额度与「每层 ≤ 窗口 2%」、冻结快照逐字节不变** | `src/agent/memory/store.ts:1`、`src/agent/memory/store.ts:23`、`src/tools/remember.ts:68`、`src/main/memory-handlers.ts:49` | 中大 |
| M9 | 上下文管家 | 部分：阈值规则 + 摘要器压缩（`shouldCompact` → `runCompaction`），**无段/交接包、无小模型二值判定** | `src/agent/compaction.ts:150` | 中 |
| M10 | 聊天全文索引 | 部分：线性扫描 + 8MiB 字节帽，**无 SQLite/FTS5**（全仓零命中） | `src/main/session-search.ts:28`、`src/agent/history-search.ts:126` | 中 |
| M11 | 用量按 bot 分桶 | 部分：事件级 agent_id→模型归因；聚合层 bucket 只到 (day, model) + 一个 `workerUsageCount`，不按 bot 分桶 | `src/agent/usage-attribution.ts:25`、`src/main/usage-analytics.ts:44` | 小 |
| M12 | 密钥按 bot 授权 | 部分：provider/plugin 粒度 + safeStorage + 启动注入 + 输出脱敏；**无「bot 申请卡片 + 按 bot 授权」** | `src/agent/plugins/secrets.ts:28`、`src/main/provider-key-inject.ts:42`、`src/events/redact.ts:67` | 中 |

### 3.2【深化】本仓已有的承载机制（可直接复用，不重写）

上游靠「cordis 注入 + 自绘 36k 行 UI」实现的东西，本仓**大部分已有对应件**：

| 已有机制 | 是什么 | 用在 bot 团队的哪一环 | 证据 |
|---|---|---|---|
| `session_meta` 事件 | 会话身份事件，已有 `kind` / `parent_session_id` / `fork` / `evolve` / `verify` 字段 | **bot 身份**与**群成员会话**的载体（`kind` 加一个枚举值即可，不新增事件种类） | `src/events/types.ts:179` |
| `session_meta_update.patch` | **自由键值补丁通道**（`Record<string,string>`，缺席＝不变） | roster 的可变字段（名字/角色/模型/思考强度）落这里，不必造新事件 | `src/events/types.ts:225` |
| `sessionMetaPatch()` 投影 | 把 meta 补丁折叠成键值 map | roster 投影的读面 | `src/events/projection.ts:174` |
| `projectAgentThreads()` | 从事件日志**重建逻辑 agent 线程**，可重复重放、不产生日志外状态 | bot 团队投影的范式（先例就在这儿） | `src/agent/agent-thread-projector.ts:38` |
| sidechat 会话 | **独立文件组** `sessionsRoot/sidechats/<id>/events.jsonl` ＋ 首行 `session_meta{kind,parent_session_id}` | 群成员「隐藏 session」的现成范式（每个 bot 在群里有自己的会话） | `src/main/sessions.ts:766`、`src/main/sessions.ts:802` |
| `withSessionMutation()` | **sessionsRoot 级**变更锁 | 群聊跨多会话写入的原子性已有机制 | `src/main/session-mutation-lock.ts:86` |
| `forkSessionPointer()` | 分叉是**指针**：只写一行 `session_meta{fork}`，重放按链解析 | 「群分叉」时成员会话各自分叉的语义基础 | `src/events/session.ts:162` |
| worker 工具表构造期不含 `spawn_agent` | 深度恒 1 的**机制化保证** | 「bot 不无限派生 bot」的现成做法 | `src/agent/worker-tool-table.ts:26` |
| `clampTier` 单调继承 | worker 档不得宽于父档，越界裁剪并出声 | 每 bot 一档与继承规则的接缝 | `src/agent/worker-report.ts:30` |
| `sidechat` 侧聊 | 独立 session + 主会话只读投影 + 只读工具白名单 | 群成员的「从快照起一个不跑工具的侧聊」 | `src/agent/sidechat.ts:1` |
| 编排引擎 FlowNode/AcceptanceCheck | 并行/分支/竞速/验收 | 群 Goal 的多阶段推进可复用编排件，不必自造 | `src/orchestration/types.ts:18` |

### 3.3 落点形态的硬约束（裁决用证据）

1. **插件面是封闭的声明式扩展**：插件只能贡献 skill / prompt command / agent role / hook
   （`command|http|mcp_tool|prompt|agent`，其中 `agent` 档装载期即拒）/ MCP / LSP；
   **不能**提供自定义 UI 面板、前端路由、后台常驻任务、自定义 API 路由。
   证据：`src/agent/plugins/types.ts:1`、`src/agent/plugins/hooks.ts:99`、
   渲染层分类枚举 `apps/desktop/src/renderer/derived/plugins.ts:14`、
   窗格 union `apps/desktop/src/renderer/pane-registry.ts:7`、
   IPC 通道表 `apps/desktop/src/main/channels.ts:133`。
   ⇒ **上游那种「插件自带 36k 行客户端 UI + 注入 sessionController」的形态，本仓照搬不了。**
2. **事件日志种类是封闭的**（39 种，见 `src/events/types.ts`）：新增种类只允许日志结构控制记录；
   描述「agent 干了什么」的事必须走既有事件的可选字段。
   ⇒ bot 实体、群成员、@ 接力路由**不能**新造事件种类来承载。
3. **已有可承载面**：`agent_spawned` / `agent_status` / `agent_message` / `agent_result` 四条多智能体事件已带
   `agent_id` / `thread_id` / `fence` 血缘；其中 `agent_message` 已有 `direction: to_agent|from_agent` 与
   `kind: progress|report`（`src/events/types.ts:538`）——bot↔bot 消息的落点大概率在这条事件的可选字段上。
4. **渲染层分层规则**：新面板只能落在 `state/` → `derived/` → `components/`+`panes/` → `App.tsx`，
   单文件 ≤ 1200 行、`App.tsx` ≤ 900 行（`pnpm renderer-layer-check`）。
5. **核心边界**：`src/` 核心不得 import Electron/UI（`scripts/desktop-boundary-check.ts`）；
   ⇒ 群调度器、记忆作用域、权限档位必须住在 `src/`，UI 只做投影与操作。

### 3.4【深化】本仓体量数字（定价用）

| 面 | 实测 | 用法 |
|---|---|---|
| `src/agent/` | 163 文件 / 39850 行 | 核心内建方案要碰的面 |
| `src/main/` | 121 文件 / 29446 行 | 应用服务（IPC 门面、调度器宿主） |
| 渲染层 `state/` | 33 文件 / 5648 行 | 状态簇（新面板的状态钩子） |
| 渲染层 `derived/` | 22 文件 / 1874 行 | 纯投影（bot 名单/群列表的读面） |
| 渲染层 `components/` | 121 文件 / 20134 行 | 组件（最大的文件 1096 行，1200 帽） |
| 渲染层 `panes/` | 9 文件 / 2033 行 | 窗格（最大 979 行） |
| `App.tsx` | 17 行 | 组合根已经很薄 |
| 测试 | 核心 673 文件 / 桌面 385 文件 | 判卷落点 |
| 上游客户端 | 36194 行 / 104 文件 | 全量 bot 团队的 UI 代价 |

### 3.5【自研推导】本仓原生骨架：团队 ＝ 成员档案 ＋ 成员线程 ＋ 编排

这一节回答业主那句「**根据我们仓库的项目自研**」：不看上游的形状，只问
**「本仓已经有什么能长出团队」**。结论是：本仓**已有一个事件面（会话）＋一个事件面（编排）**
＋ 三块可直接挂靠的平面，团队能力可以**几乎全部挂在既有件上**，真正新增的只有三件。

#### 3.5.1 推导起点：本仓已有的四块地基

| 地基 | 是什么 | 证据 |
|---|---|---|
| ① 会话事件日志 | 运行时权威；可重放、指针分叉、审计 | `src/events/`、`src/events/session.ts:149` |
| ② **编排事件日志** | 计划面**也是事件溯源**（同一个 `createEventLog`）＋ 投影 `projectOrchestration` ＋ 单一写者锁 | `src/orchestration/store.ts:10`、`src/orchestration/project.ts` |
| ③ 角色面 / 能力面 / 线程面 | 角色定义（**只读加载**）、能力清单、**跨 run 稳定的 thread** | `src/agent/roles/user-agents.ts:95`、`src/orchestration/types.ts:9`、`src/events/types.ts:484`、`src/agent/local-agent-runtime.ts:15` |
| ④ 记忆五件套 ＋ 权限五档 ＋ 审批门 | 常驻/沉淀/整理/检索/写；`permission_mode` 五档 ＋ 单调继承；`ask-gate`/`card_action` | `src/agent/memory/`、`src/permissions/modes.ts:8`、`src/agent/worker-report.ts:30`、`src/main/ask-gate.ts` |

> 关键一句：**上游「bot ＝ 一个长期存活的会话 ＋ 一份档案」，我们已有的是「thread ＋ 档案位」。
> 缺的不是运行体，是那份档案。**

#### 3.5.2 自研 v0 骨架（三层，全部挂在既有件上）

| 层 | 是什么 | 复用本仓哪一件 | **新增的最小件** |
|---|---|---|---|
| **成员档案** | 长期存在的成员定义：名字/角色/模型/思考强度/能力/权限档/记忆作用域/工作目录 | `UserAgentRole` 的角色面 ＋ `Capability` ＋ `permission_mode` ＋ 会话侧车 `model`/`thinking` ＋ `worktree` | ① **成员档案的可写与可版本化**（现在只有只读加载） |
| **成员线程** | 成员的运行体：跨轮次存活的 thread ＋ 自己的会话（可分段） | `thread_id` ＋ `local-agent-runtime` 的 spawn/followUp/send/wait/resume/close ＋ sidechat 的**独立文件组**范式（`sessionsRoot/sidechats/<id>/events.jsonl`） | ② 成员会话的**归属标记**（走 `session_meta` 既有 `kind`/补丁通道，不新增事件种类） |
| **团队会话** | 共享可见的对话流 ＋ 一轮内的发言秩序 ＋ 阶段验收 | 编排引擎：`race`/`gather`/`ControlGroup` ＋ `AcceptanceCheck`（command/artifact/evidence/human）＋ `Contract`（`idempotency_key`/`rollback`）＋ `EvidenceState` ＋ `TaskPhase` | ③ **「发言权」规则**（谁这一轮说、并行还是排队、沉默如何计）＋ 共享流的投影 |

#### 3.5.3 十二机制的本仓落点映射（自研版：只取问题，不取形状）

| 上游机制（只取它解决的问题） | 挂靠的本仓既有件 | 自研落点 | 需要新增的最小件 |
|---|---|---|---|
| M1 长期存活的成员 | `UserAgentRole`＋`thread_id`＋会话侧车 | 成员＝thread ＋ 档案；档案落**编排事件日志**（已是事件溯源） | 成员档案字段/事件 |
| M2 成员间消息 | `agent_message`（`direction`/`kind` 已封闭）＋ `send_agent` 的幂等 `message_id` | 对等消息走 `agent_message` 的可选字段；幂等沿用本仓 `requestId` 先例 | 一个可选字段 ＋ 回执去重 |
| M3 群聊轮次 | `race`/`gather`/`ControlGroup` ＋ `TaskPhase` | 一轮＝一次控制组 ＋ 发言权仲裁 | 发言权规则 ＋ 共享流投影 |
| M4 @接力 | `worker-prompt` 的任务书 ＋ `worker-merge`/`worker-finish` 收队 ＋ `orchestrator-join` 收队面 | 被 @ 的成员在自己线程里干活，回执走既有 `agent_message`/`agent_result` | @ 解析器（与文件引用共存） |
| M5 每成员工作目录 | `worktree.ts`（write 模式）＋ 权限路径检查 | 成员目录＝worktree 扩展到 read 模式 ＋ 落点闸 | 目录归属 ＋ 越界审批 |
| M6 每成员权限档 | `permission_mode` 五档 ＋ `clampTier`（成员 ≤ 父）＋ 审批门 | **成员档 ≤ 团队档 ≤ 用户档**；「只有人能改」＝走审批门，不给工具参数 | 档位归属关系 |
| M7 私密成员 | 记忆作用域 ＋ 权限规则 ＋ **gate 留痕** | 可见性用**留痕式拒绝**（比上游强：上游不拦网络外联且自承不是系统边界） | 可见性规则 ＋ 拒绝留痕面 |
| M8 三档记忆 | `memory/store`（项目层/全局层）＋ `distill`/`consolidate`/`retrieval`/`inject`/`remember` | 作用域**正交扩展**：团队/成员/群 × 现有类型轴 | 作用域解析 ＋ 额度 ＋ 冻结 |
| M9 上下文管家 | `compaction`（阈值 ＋ 摘要 ＋ verified 判据） | **并存**：管家只判「就地检查点 vs 开新段」，compaction 留作兜底 | 段（事件分界）概念 ＋ 二值判定 |
| M10 全文检索 | `session-search`（线性扫描 ＋ 字节帽）＋ `history-search` | 先量体量再决定要不要倒排 | 索引（条件性） |
| M11 用量按成员 | `usage-attribution`（agent_id→模型）＋ `usage-analytics`（day×model 桶） | 聚合层加一维成员 | 桶维度 ＋ 成员映射 |
| M12 密钥 | `provider-keys`（safeStorage）＋ `provider-key-inject`（环境注入）＋ `events/redact`（脱敏） | 成员级授权 ＋ 环境注入 ＋ 掩码 | 申请/授权的卡片面 |

#### 3.5.4 只加不改清单（自研的纪律，逐条可判卷）

1. **不新增事件种类**：团队语义全部走既有事件的可选字段
   （`session_meta` / `session_meta_update.patch` / `agent_message` / `card_action` / `usage`）。
2. **不新增存储面**：成员档案落**编排事件日志**（已有 `createEventLog` ＋ 投影），
   共享对话流落**会话事件日志**；不建第三套真源。
3. **不新增权限档**：沿用五档 ＋ 单调继承；成员档只能在既有档位里选。
4. **不新建「团队编排」引擎**：轮次复用 `race`/`gather` ＋ `AcceptanceCheck`，只加「发言权」。
5. **不复制上游命名**：Q17 的词表从本仓既有词长出来。

#### 3.5.5 这个骨架对落点裁决的影响（先给结论）

- **形态 A 的成本比初估低**：多数能力挂在既有件上（编排引擎、权限档、记忆五件套、线程、
  sidechat 文件组、审批门），真正新增的只有**成员档案 ＋ 发言权 ＋ 段**三件。
  ⇒ 形态 A 的核心工作量＝三件新增件 ＋ 桌面面板族。
- **形态 C 更不可取**：它做的正是「只有皮没有骨」那一层；在自研定位下等于自建一个假的 bot 团队。
- **形态 D 的唯一理由只能是「产品定位不合」**，不能是「成本太高」——本仓既有件已覆盖大部分机制。

#### 3.5.6 自研骨架是否成立的判据

1. 每个新增件都要能指出它挂在哪个既有件上；指不出的 ⇒ 要么砍掉，要么写明为何必须新造。
2. §3.5.3 的「需要新增的最小件」合计**不超过 5 件**；超了说明在造平行体系。
3. 运行时真相只在事件日志里；编排面只存计划与档案；不得出现第三真源。
4. 全程零上游命名（Q17 判据）。
5. 每条机制都要能写出「上游怎么做 → 我们怎么解 → 判卷是什么」（Q18 判据）。

---

## 四、【深化】候选数据模型 × 本仓铁律相容性

### 4.1 本仓四条铁律（一切候选必须过这四条）

1. **事件 id = 1-based 行号**（`src/events/session.ts` 的链解析与 `effectiveEvents` 都按行号定位）。
2. **`replay()` 逐字返回**（含控制记录），解释控制记录是**投影**的活（`src/events/projection.ts:164`）。
3. **分叉是指针不是拷贝**（`session_meta.fork = { from_session_path, boundary_event_id }`）。
4. **事件种类封闭 39 种**，新语义只能走既有事件的可选字段。

### 4.2 bot 实体：三个候选

| 候选 | 形状 | 过铁律 | 代价 | 风险 |
|---|---|---|---|---|
| **B1 事件即 bot** | bot ＝ 一个会话；身份字段落 `session_meta` 新增可选字段（`bot?: {id, role, …}`），可变字段走 `session_meta_update.patch` | ✅ 1/2/3/4 全过（`session_meta` 是既有事件型，加字段＝允许） | 需要投影出「bot 名单」（`projectAgentThreads` 是先例） | 一个 bot 在多个群/话题里 = 多个会话；「bot 身份 ↔ 会话」不再一一对应，须显式定义 bot_id |
| **B2 独立 registry 文件** | 另起 `bots.json`（上游 `state.json` 的简化版） | ❌ 破 2/3：registry 是文件态，不在事件日志里 ⇒ 重放重建不出、审计看不到、且与日志**双真源** | 实现最省 | 与本仓地基冲突，除非 registry 明确降级为「可重建缓存」并由事件重建 |
| **B3 混合（事件为真 + registry 为投影）** | 真相在事件（同 B1），另存一份 `bots.json` **作为可重建读面**（像会话列表侧车） | ✅ 过铁律（前提：registry 声明为投影，可随时删掉重建） | 多一份缓存的一致性维护 | 若忘了「可重建」这一条，就会退化成 B2 的双真源 ⇒ 需要判卷钉住 |

### 4.3 群聊：三个候选

| 候选 | 形状 | 过铁律 | 代价 | 风险 |
|---|---|---|---|---|
| **G1 单会话多写者** | 一份 events.jsonl，成员轮次各写各的 | ✅/⚠️：行号成立（串行写）；但「谁写的」要靠事件字段判；分叉是一个文件一个指针（群不可按成员分别分叉） | 写放大集中在一份文件 | **私密 bot 冲突**：同文件里成员的私话对全体可见 ⇒ 与 M7 天然矛盾；并发写要排队 |
| **G2 群会话 + 每成员子会话（上游做法）** | 群 transcript 一处；每个成员在群里有自己的会话（`room.sessions[botId]`） | ✅ 1/2/3；⚠️ 4：成员会话的 `session_meta.kind` 要加枚举值 | 两处写、需跨会话锁（`withSessionMutation` 已有）；群 transcript 与成员会话内容重复 | **群不再是单一分叉单元**：分叉群 = 成员会话各自分叉，群 transcript 怎么办？（上游没这问题，它是文件态） |
| **G3 成员各写各的 + 群视图是投影** | 成员各在自己的会话写事件；群的可见对话流由投影聚合（成员事件 → 群视图） | ✅ 全过：分叉天然按成员会话；投影可重算 | 群 transcript 需物化才能「可分叉/可引用」；实时投影要增量 | 群消息与成员事件的关系要一条新语义（本仓 39 种事件里哪条承载？） |

### 4.4 段（part）：两个候选

| 候选 | 形状 | 过铁律 | 代价 | 风险 |
|---|---|---|---|---|
| **P1 段 ＝ 新会话文件**（上游做法） | 开新段 = 新建一个会话（sidechat 已有范式） | ✅ 现成机制照搬 | 段与 bot 身份解耦 ⇒ 需要 `bot_id` 字段贯穿 | 与我们的「事件日志是一份」哲学略偏（多份日志） |
| **P2 段 ＝ 事件分界标记** | 段是**同一个会话日志里的分界**（投影按分界切片） | ✅ 最贴铁律：一份日志、重放自然、分叉自然 | 需给事件加「段」语义（走既有事件可选字段，如 `session_meta` 的补丁通道） | 「交接包」要作为投影生成的消息插入对话流 ⇒ 与「用户真实输入」必须可区分（上游用 `source.handoff` 标记，我们也要有等价的可判别信号） |

### 4.5 @ 路由：两个候选

| 候选 | 形状 | 过铁律 | 代价 | 风险 |
|---|---|---|---|---|
| **R1 名字表在事件里，路由表是投影** | bot 名字落 `session_meta`/`patch`，`@名字` 的解析与派发由投影提供的名单驱动 | ✅ 全过 | 需要 `@` 解析器与文件引用解析器**共存**（本仓 `@` 现在是文件引用） | 语义撞车：`@foo` 是文件还是 bot，要定优先级（上游的规则：名字长者优先、只 `@名字` 算、前后字符约束） |
| **R2 名字表是独立索引文件** | 另建 `bot-names.json` | ❌ 双真源 | 省事 | 与 B2 同病 |

### 4.6 记忆作用域：两个候选

| 候选 | 形状 | 过铁律 | 代价 | 风险 |
|---|---|---|---|---|
| **S1 扩展现有轴（正交）** | 现有＝项目层/全局层 × 四类记忆类型（user/feedback/project/reference）；再加 bot/群/团队三轴 | ✅ 可行，但作用域解析变 2×3 维 | 解析规则复杂、易出「读到了不该读的」 | 与既有 `memory/store.ts` 的目录解析耦合深，改动面大 |
| **S2 替换为三档（对齐上游）** | 作用域＝bot / 群 / 团队三档；项目层≈团队层 | ✅ 简单、与上游一一对应 | **丢掉现有 Claude Code 四类型语义**（user/feedback/project/reference 有别的用途） | 我们已有的 distill/consolidate/recall 全按现有轴写 ⇒ 要重写检索层 |

### 4.7 上下文管家：两个候选

| 候选 | 形状 | 过铁律 | 代价 | 风险 |
|---|---|---|---|---|
| **C1 替换 compaction** | 把现有阈值压缩换成「小模型二值判定 + 检查点/交接包」 | ⚠️ 现有 `compaction` 事件是既有事件型，语义要扩 | 现有 compaction 有 verified/证据判据（比上游摘要器严）⇒ 换掉是**倒退风险** | 上游判定失败即换段，语义激进；我们的 compaction 更保守 |
| **C2 并存分层（推荐候选）** | 保留现有 compaction 作兜底；另加「段」机制，管家的二值判定只决定「就地检查点 vs 开新段」 | ✅ 两边都不破 | 两套机制并存要写清「谁先谁后」的判据 | 需要一条明确口径：什么条件下管家先于 compaction 介入 |

### 4.8 长文本冷存储：两个候选（**我们没有等价物**）

| 候选 | 形状 | 过铁律 | 代价 | 风险 |
|---|---|---|---|---|
| **L1 大 payload 落事件** | 超长消息作为事件文本整体落盘 | ✅ 最省事 | 事件文件膨胀、无内容寻址去重 | 超长内容进 JSONL ⇒ 内存与扫描成本上升；我们的 session-search 是线性扫描，会被拖慢 |
| **L2 自建内容寻址 blob 目录** | 自己写 `<hash>` 文件 + 事件里存引用 | ✅ 与上游同构（上游用 DSH 附件库） | **要新建一个存储面**（写、原子落盘、回收、备份） | 新增基础设施面 ⇒ 触到「outputs/ 之外的新存储面」的架构裁决 |

### 4.9 相容性矩阵汇总（一眼看哪几个候选能活）

| 机制 | 候选 | 铁律 1（行号） | 铁律 2（逐字重放） | 铁细则 3（指针分叉） | 铁律 4（种类封闭） | 结论 |
|---|---|---|---|---|---|---|
| bot 实体 | B1 事件即 bot | ✅ | ✅ | ✅ | ✅ | **可做** |
| | B2 registry 文件 | ❌ | ❌ | ❌ | ✅ | 破地基 |
| | B3 混合（registry=投影） | ✅ | ✅ | ✅ | ✅ | **可做**（须钉住「可重建」） |
| 群聊 | G1 单会话多写者 | ⚠️ | ✅ | ⚠️ | ⚠️ | 与私密性冲突 |
| | G2 群会话+成员子会话 | ✅ | ✅ | ⚠️ | ✅ | **可做**（要定义群分叉） |
| | G3 成员会话+群视图投影 | ✅ | ✅ | ✅ | ⚠️ | **可做**（要定承载事件） |
| 段 | P1 段=新会话文件 | ✅ | ✅ | ✅ | ✅ | 现成范式 |
| | P2 段=事件分界标记 | ✅ | ✅ | ✅ | ⚠️ | **可做**（要定可判别信号） |
| @ 路由 | R1 事件为真+投影 | ✅ | ✅ | ✅ | ✅ | **可做**（要定 @ 优先级） |
| | R2 独立索引文件 | ❌ | ❌ | ❌ | ✅ | 破地基 |
| 记忆作用域 | S1 扩展现有轴 | ✅ | ✅ | ✅ | ✅ | 可做但复杂 |
| | S2 替换为三档 | ✅ | ✅ | ✅ | ✅ | 可做但要重写检索层 |
| 上下文管家 | C1 替换 compaction | ⚠️ | ⚠️ | ✅ | ✅ | 有倒退风险 |
| | C2 并存分层 | ✅ | ✅ | ✅ | ✅ | **推荐** |
| 长文本 | L1 大 payload 落事件 | ✅ | ✅ | ✅ | ✅ | 可做（扫描成本） |
| | L2 自建 blob 目录 | ✅ | ✅ | ✅ | ✅ | 可做（新基础设施面） |

---

## 五、【深化】落点候选 A/C/D：轮廓与定价（B 已因「自研」出局）

Q10 要在 Phase 3 被裁决 ⇒ 现在必须先把四个候选的轮廓与代价写出来。

### 形态 A：核心内建（团队本体进 `src/`）

- **做什么**：bot 实体/群/段/记忆作用域/权限档位作为内核能力（`src/agent/` + `src/main/`），UI 只做投影与操作；
  桌面新增「bot 团队」侧栏区 + 群聊窗格 + bot 详情/记忆面板。
- **触及面**：核心新增若干模块（估计 3–5k 行，含测试）；渲染层新增 6–10 个文件（估计 2–4k 行，落在 `state/`+`derived/`+`components/`+`panes/`）。
- **优点**：与事件溯源/分叉/审计一致；权限与私密性能在内核统一裁决；不留两套真源。
- **代价**：触及面最大；渲染层 1200 行帽需要提前分配文件；桌面端要做新面板族。
- **【v2.2 修正】成本比初估低**：按 §3.5 的推导，核心真正新增的只有**成员档案 ＋ 发言权 ＋ 段**三件，
  其余挂在既有件（编排引擎、权限五档、记忆五件套、thread、sidechat 文件组、审批门）上；
  核心工作量＝三件新增件 ＋ 桌面面板族。

### 形态 B：先扩插件面，再把团队做成插件 —— **已排除（自研定位）**

业主已定「**自研**」：bot 团队是**本仓自己的产品能力**，不是可插拔插件。
⇒ 形态 B 出局，不再评估。其唯一留下的遗产是一条判断：**不要为了做这件事去扩插件面**
（插件面的封闭枚举是多处代码的硬边界，扩它属产品级架构裁决，与本任务无关）。

### 形态 C：桌面层先行（只做可见的「团队视图」，底层仍是现有编排）

- **做什么**：桌面侧做一个「团队」视图，把现有 `orchestrator` 的一次性 worker 包装成可命名的「成员」；不做长期 bot 实体、不做群聊轮次、不做三档记忆。
- **触及面**：仅桌面层（1–2k 行）。
- **优点**：最快能看到「团队」的样子；不碰内核铁律。
- **代价**：与上游语义差距最大（无长期身份、无记忆、无群聊）；**这是「看起来像」而不是「是」**——业主的 UI 偏好里明确反对装饰性/空跑元素，做一个只有皮没有骨的团队视图风险很高。
- **【v2.2 判定：不可取】** 自研定位下，这一形态等于自建一个假的 bot 团队——皮有了，骨（成员档案/发言权/段）没做，
  与 §1.1 第 4 条「缺口也要自己填」直接冲突。
- **回滚**：最容易。

### 形态 D：不做（判定上游机制与本仓定位不合）

- **什么时候选**：若 Phase 3 发现 bot 团队的核心价值（长期身份 + 群聊协作）与本仓「可重放的单人编码 harness」定位冲突，且成本压不下来。
- **必须写清**：不做的**理由**与**放弃清单**（哪些上游机制明确不追），以及是否有更小的切口（例如只做「多 bot 并行 + 收队」的既有能力打磨）。

### 定价小结（给 Phase 3 用的对照表骨架）

| 维度 | A 核心内建 | B 扩插件面 | C 桌面先行 | D 不做 |
|---|---|---|---|---|
| 与四条铁律 | 一致 | 一致（但插件面本身要改） | 不冲突（但语义薄） | — |
| 触及面 | 核心＋桌面 | 插件机制＋核心＋桌面 | 桌面 | 无 |
| 能否达成 M1–M12 | 全部 | 全部（若插件面扩得够） | 仅 M2/M5/M6 的表层 | 无 |
| 上游可照搬比例 | 高（规则层） | 中 | 低 | — |
| 架构裁决需求 | 中（记忆作用域/段语义） | **高**（插件面边界） | 低 | — |
| 回滚成本 | 中 | 高 | 低 | — |

**Phase 3 必须补的定价数字**：形态 A 的 UI 工作量要按上游 104 个客户端文件对应的功能面**逐项对照**，
只数我们真要做的（团队侧栏/群聊/详情/记忆面板/权限面板/用量），并对照本仓渲染层现有 20k 行 components 的余量。

---

## 六、【深化】风险与交叉表

| # | 风险/交叉 | 证据 | 处置 |
|---|---|---|---|
| R1 | **我们没有内容寻址附件库**：上游超长消息转 DSH 附件，我们无等价物 | 上游 `delivery.js:179-192`；本仓无附件服务 | Q12 二选一（L1/L2）；**不许默认塞进事件 payload** |
| R2 | **事件种类封闭 vs 运行期簿记**：轮次 slot、派活等待关系、换段中的归属，上游全落 `state.json`；我们要落事件或投影 | `src/events/types.ts`（39 种封闭）；上游 `state.works`/`round.slots`/`state.switching` | Q13 裁决：能投影就别造事件；跨重启必须续等的才考虑走既有事件的可选字段 |
| R3 | **群不是单一分叉单元**：上游群 transcript 是文件，G2 形态下群分叉语义未定义 | 本仓 `forkSessionPointer`（`src/events/session.ts:162`） | Q2 明确：群分叉＝成员会话各自分叉 + 群视图重建 |
| R4 | **`@` 语义撞车**：本仓 `@` 是文件引用 | `src/agent/sidechat.ts:234` | Q4 定优先级（长名优先 + 只在 bot 名单命中时才算） |
| R5 | **权限档位映射**：上游三档（只读/工作区/全权）vs 本仓五档（read-only/default/guided/auto/full-access）；且上游的 `'auto'`（Auto review）**是会话级**，不能当 bot 档 | `src/permissions/modes.ts:8`；上游 `permissions.js:6,18,45` | Q5 给映射表 + 「bot 不得提权」的判据；`auto` 档在 bot 语境下的含义要单独定 |
| R6 | **既有未决项交叉**：STATE.md 记着「权限规则链按最长前缀匹配，是设计裁决未决」「置顶消息进对话目录未实现」 | `STATE.md` 未决段 | bot 团队的权限档位若引入新的档位语义，**会踩同一条未决** ⇒ 两批必须串行，不能并行改权限链 |
| R7 | **渲染层帽**：components 现有最大文件 1096 行（帽 1200）；新面板若超帽必须先拆 | `apps/desktop/src/renderer/state/workbench.ts` | Phase 2 出文件分配表；renderer-layer-check 门禁不降 |
| R8 | **上游私密性的安全边界很弱**（不拦网络工具、shell 可绕过） | 上游 `docs/plans/2026-10-27-private-bots.md:58,66` | 自研定位下的正解：**给出更强替代**——我们有 gate 留痕与权限层，可做「留痕式拒绝」（谁在什么语境下被拒都查得到），并明写我们自己仍覆盖不到的面（网络外联） |
| R9 | **空转/无上限的上游代价**：上游删掉所有上限，代价是「bot 互问会一直跑到用户停下」 | 上游 `2026-10-16-bot-handoffs.md:110-111,128` | 我们若做派活树，**要带 TTL 或总量闸**（这是设计增量，不是照抄） |
| R10 | **上游「只读进程」概念**：第二个 dsh 打开同一份数据只读 | 上游 `store.js` 的 `state.lock` | 我们天然多写者 ⇒ 该语义变成「第二个订阅者」，实现不同但语义要保留 |

---

## 七、调研问题清单（Q1–Q18）

前 10 条为 v1 保留并按深化结果修订；后 6 条是深化新增。

| # | 问题 | 为什么必须问 | 取证方法 | 判据形态 |
|---|---|---|---|---|
| Q1 | bot 实体落哪：事件即 bot（B1/B3）还是 registry 文件（B2）？ | 决定 bot 能不能被重放/分叉/审计——本仓地基是事件溯源，上游是 `state.json` 文件式 | 对比上游 `roster.js` 字段与本仓 `session_meta`/`patch` 承载面 | 裁决 + 「重放后能还原出同一支 bot 名单」的验收场景 |
| Q2 | 群聊的日志形状：G1 / G2 / G3？ | 决定并发写、行号铁律、私密性、群分叉四条怎么同时成立 | 读上游 `groups.js` 的 session 构造；本仓 `session-mutation-lock` + `forkSessionPointer` | 「谁写哪条日志」+ 并发写判定 + 群分叉语义 |
| Q3 | bot↔bot 消息落 `agent_message` 的哪个字段？ | `kind` 现在只有 `progress|report`，装不下「一条私信」 | 读 `src/events/types.ts:538` 与 `src/tools/agent-lifecycle.ts` 的 send 语义 | 字段方案 + 「不得新增事件种类」的证明 |
| Q4 | `@bot` 的名字表在哪、谁解析、怎么和文件引用共存？ | 本仓 `@` 现在是文件引用，语义会撞车 | 上游 `shared/mentions.js` 的 `mentionSpans`；本仓 `@` 解析面 | 解析优先级规则（可写成测试） |
| Q5 | 每 bot 一档权限怎么和单调继承（clampTier）共存？上游三档怎么映射到我们五档？ | 上游「只有人能改」是产品承诺；上游 `'auto'` 档不能用于 bot | 读 `src/permissions/modes.ts`、`src/agent/worker-report.ts`；上游 `permissions.js` | 档位映射表 + 「bot 改不了权限」的可执行判据 |
| Q6 | 记忆作用域：S1 扩展现有轴 vs S2 替换为三档？ | 两套坐标系会打架；我们已有四类记忆类型有别的用途 | 读 `src/agent/memory/store.ts` 的目录解析与类型映射 | 作用域解析表 + 「读到的记忆来自哪一档」的判卷 |
| Q7 | 上下文管家：C1 替换 compaction vs C2 并存分层？ | 我们 compaction 已有 verified/证据判据（比上游摘要器严） | 读 `src/agent/compaction.ts`；上游 `steward.js` | 关系定义 + 触发阈值口径 + 「管家失败即换段」是否采纳 |
| Q8 | 全文检索要不要引 SQLite？ | 上游用 `node:sqlite` FTS5；本仓线性扫描 + 8MiB 帽；**中文两字词 trigram 匹配不了**（上游自承） | 核本仓 engines 与 `node:sqlite` 可用性；量会话体量 | 「量到多大必须换」的阈值判据，不先拍板 |
| Q9 | 用量按 bot 分桶：现有 agent_id→模型归因能否升级成按 bot 聚合？ | 切片里最便宜的一项 | 读 `src/agent/usage-attribution.ts`、`src/main/usage-analytics.ts` | 「按 bot 看用量」的口径 + 数据来源（日志 vs 流式） |
| Q10 | 落点形态：A/B/C/D 哪个？ | 业主明确「由调研裁决」 | 用 §五 的四个候选 + §3.3 的硬约束 + Phase 2 的定价数字 | 裁决 + 每条候选的代价（触及面/门禁/回滚） |
| **Q11** | **段（part）在我们的事件日志里怎么表示：P1 新会话文件 vs P2 事件分界标记？** | 上游用 Session id 索引段，是上游与本仓最不同的一处；决定「交接包」「检查点」的落点 | 上游 `parts.js` 的三种容器与开新段 7 步；本仓 sidechat 范式 + `session_meta.kind` | 裁决 + 「一个 bot 跨段后仍可被重放识别」的判卷 |
| **Q12** | **超长消息的冷存储落哪：L1 事件大 payload vs L2 自建内容寻址 blob？** | 上游依赖 DSH 附件库（内容寻址），我们**完全没有等价物**；上游自己踩过 6.5MB state.json 的坑 | 上游 `2026-10-16-long-messages.md` 的三条取舍 + `delivery.js` 附件化；本仓 session-search 的扫描成本 | 裁决 + 「一条 500 万字消息不会拖垮检索与重放」的判卷 |
| **Q13** | **轮次 slot / 派活等待关系 / 换段中归属：是事件还是投影？** | 上游全落 `state.json`；我们事件种类封闭 39 种不可新增，但**跨重启要续等**的状态不能只做内存态 | 上游 `state.works`/`round.slots`/`state.switching`；本仓 `agent_message`/`session_meta` 可选字段 | 裁决 + 「重启后未完成的派活仍能续等」的判卷（若裁决为投影，则明确「不可重放」的边界） |
| **Q14** | **群「一轮」的调度器归谁：内核轮次引擎 vs 桌面服务？** | 核心不得 import Electron；一轮要跨模型调用、要能被打断 | 上游「一轮由 DS Bot 自己跑」（不占群会话）；本仓 `orchestrator`/`supervisor` 的位置 | 裁决 + 「一轮被打断后状态不丢」的判卷 |
| **Q15** | **记忆的四种读法（常驻/增量/自动召回/按需）我们要做到哪几种？** | 上游四种齐全且各有额度；我们已有常驻/沉淀/整理/检索，缺增量读 | 读 `src/agent/memory/{inject,distill,consolidate,retrieval}.ts` 与 `src/tools/remember.ts` | 每种读法的采纳/不采纳 + 理由 + 判卷 |
| **Q16** | **bot 的模型/思考强度/工作目录落哪？** | 上游 bot 记录自带这三样；我们 session 已有 `model`/`thinking` 侧车字段与 worktree 机制 | 本仓 `SessionMetadataRecord.model/thinking`、`src/agent/worktree.ts` | 裁决 + 「bot 换模型只影响它自己」的判卷 |
| **Q17** | **自研的概念与命名体系怎么定？** | 自研定位下不能沿用上游命名（`message_bot`／`post_to_group`／`group_goal`／`MEMORY.md` 条目格式），但也不能另造一套与本仓脱节的词 | 盘本仓既有词表（事件种类、`permission_mode`、`session_meta` 补丁通道、`AgentPermissionMode`、`session_kind`），逐个机制定「我们的词」 | 一张「上游概念 → 本仓概念 → 落在哪个既有词上」的对照表；判据：每个新词都能指到本仓既有概念，或写明为何必须新造（词表从 §3.5 的三层骨架长出来） |
| **Q18** | **自研要在哪些点上明确做得比上游不同？** | 抄上游＝自研失败；但「不同」不等于「为不同而不同」 | 逐条读 §2.5 的上游自承坑与 §六 的风险表，挑出我们能用本仓地基（重放/分叉/审计/gate 留痕/权限单调继承）做得更强的点 | 每个差异点写：**上游怎么做 → 我们怎么解 → 判卷是什么**；至少覆盖「私密性强度」「派活总量闸」「长文本冷存储」「群分叉语义」四处 |

---

## 八、阶段与门

### Phase 0 — 取证纪律与快照（已完成大半）

- 上游快照：`main` 分支 tarball 已落 `_bench/dsbot-src/`（仓外，不入库）。
- 已读：上游 README（插件 + 项目页）、`docs/vision.md`、`docs/known-issues.md`、
  **10 篇已决设计文档**（群聊/接力/角色权限/私密 bot/群 Goal/bot 运行时/上下文与记忆/记忆分层/长消息/消息账本）、
  宿主层 20 个模块的导出面、`store.js`/`roster.js`/`steward.js`/`memory.js`/`parts.js` 的数据形状。
- 纪律（Phase 1–3 全程适用）：
  1. **先读本仓 → 再读上游 → 再比**；写「本仓没有 X」之前必须在本仓现读核实，
     且 `grep` 没搜到 ≠ 不存在（至少再翻一遍 `docs/CODE-WIKI.md` 的组件清单）。
  2. 断言「代码里有什么」前用 `git show HEAD:<path>` 核对，**不能拿工作树当 HEAD**。
  3. 上游的「结论」以**源码与已决设计文档**为准，README 只当索引。
  4. 本仓侧数字（行数、条数、字节）一律用命令现测并记命令，**不手抄**。
- **门**：快照可复算（命令 + 摘要）→ 进 Phase 1。

### Phase 1 — 上游机制拆解（12 机制 × 四行 × 证据）

对 §2.3 的 12 个机制各产出四行：
**规则**（保证什么）＋ **数据形状**（字段/键/落盘，只作参考对象）＋ **边界**（自承的坑）＋
**我们的自研方向**（一句话：它解决什么问题 → 我们的解法方向是什么），各配 file:line 证据。
- 已完成：M1（bot 运行时）、M3（群聊）、M4（接力）、M6（角色权限）、M7（私密 bot）、M8（记忆）、M9（管家）、M10/M11/M12 的面。
- **待补**：M2（bot 间消息的送达/回执/未读合成）、M5（工作目录与越界审批）、M11（用量三视角）、M12（密钥卡片与授权）四条的完整四行 + 证据。
- **门**：12 × 四行齐 ⇒ 进 Phase 2。第四行只是**假设**，Phase 2/3 才裁决（不许在这里定案）。

### Phase 2 — 本仓复核（把 §三 初盘回到 HEAD，并补实测数字）

- 逐条复核 §3.1 的 12 项判定到 HEAD；补齐「不确定」项（`src/orchestration/remote-backend.ts` 协议语义、
  `src/agent/evolution|evolve|gym|map` 是否含间接能力）。
- 实测本仓渲染层行数分布 → 出「形态 A 的 UI 文件分配表」（§五 定价）。
- 排除 `agent-canon/`（36MB 竞品原始资料，`git ls-files` 零受控文件，不是本仓能力）。
- **门**：12 项判定全部有 HEAD 级证据；定价数字有复算命令 ⇒ 进 Phase 3。

### Phase 3 — 差距表与落点裁决（写 ADR 0015）

- ADR 内容：12 机制对照表（含数据形状）、逐项差距、**§3.5 本仓原生骨架的确认或修订**、
  **§四 七个候选模型的裁决**、**§五 落点形态裁决**、
  逐条建议的判卷口径（J4）、明确不抄清单与理由、风险处置（§六）。
- **门**：ADR 写完且业主认可 ⇒ 进 Phase 4。

### Phase 4 — 写成 spec 与实施计划

- 落 `docs/superpowers/specs/2026-11-xx-bot-team-design.md`（设计）→ 再落实施计划
  （`docs/superpowers/plans/`，逐条带判卷）。
- **门**：spec 过自检（占位符/自相矛盾/歧义/范围）并经业主复核 ⇒ 才允许动代码。

---

## 九、判卷口径与落点约定

调研阶段不写实现，但**每条建议都要先想好怎么判卷**，否则落地时必然变成「看着挺像」。

| 建议方向 | 判卷形态（落 ADR 时逐条细化） |
|---|---|
| bot 实体 | 新建一个 bot 后，事件日志重放能还原出同一支 bot 名单（测试：重放后 roster 快照一致） |
| 群聊轮次 | 造一轮「管理员先答 + 成员按序 + 沉默 [PASS] + 两个 @ 并行」的假模型回合，断言发出的轮次行序与并行批次 |
| @接力 | 被 @ 的 bot 在**自己的会话**里干活并回报；群里不出现它的工作流（测试：两个会话的事件流各自断言） |
| 权限档位 | bot 尝试改自己的档位被拒；人改档位生效并落日志（测试：篡改请求被 gate 拒） |
| 记忆作用域 | 群成员在群里读到群记忆、在自己聊天里读不到（测试：跨作用域读断言） |
| 上下文管家 | 超阈值时产生检查点或新段之一，且**用户原话逐字保留**（测试：检查点后原句仍在可检索面） |
| 检索 | 旧消息能被全文检索命中，且命中返回可点开的锚点 |
| 用量 | 按 bot 的用量合计 == 各会话用量之和（测试：对账） |
| 密钥 | 工具结果与请求体里都不出现明文（测试：正则扫输出） |
| 段/交接包 | 交接包被标为「引用不是指令」，且新段能读到最后一条用户真实消息 |

**落点约定**：
- 核心行为 → `tests/`（核心 vitest 配置；命名沿用 kebab-case 特征名，如 `bot-roster-projection.test.ts`、`group-round.test.ts`）。
- 桌面行为 → `apps/desktop/tests/`（如 `bot-team-panel.test.tsx`）。
- 渲染层规则 → 走既有 `pnpm renderer-layer-check`，不新造门。
- 统一做法：每条判据先写**红**的用例（证明现在没有），再做实现让它变绿；实现完删用例＝改判卷，不许。

---

## 十、证据与落点（文件级）

| 产物 | 落点 | 说明 |
|---|---|---|
| 上游原始快照 | `_bench/dsbot-src/`（**仓外，不入库**） | 仓外是因为 `outputs/` 受 `tsconfig.evidence.json` 类型检查 ⇒ 源码副本会让相对 import 失配、触发假红；备份靠 git 历史 |
| 本轮证据（命令输出、摘录、截图） | `outputs/ds-bot-benchmark-2026-11-14/` | **只放非 TS 制品**（`.md` / `.json` / `.log` / 截图）；放 `.ts` 副本＝假危险代码 ⇒ `pnpm evidence-typecheck-check` 转红 |
| 结论与裁决 | `docs/adr/0015-ds-bot-benchmark.md` | 沿用 ADR 0009/0010/0014 的对标体例（取证 → 事实 → 裁决 → 判卷 → 边界） |
| 台账 | `PROGRESS.md` 追加一页 | 追加式、页号唯一（下一个可用号以 `pnpm docs-check` 印出的为准）；不重写旧页 |
| 现态 | `STATE.md` 整体重写 | 本轮不改现态（调研不动现役基线）⇒ 留到实施批 |

**引用纪律**：文档指针不用行号指向 `.md`（D-3 判据），用锚点；源码指针可用 `path:line`。
台账引用的证据工件必须在 HEAD 里追得到（D-11）。

---

## 十一、边界（本轮没验证的）

- 上游**没有实跑**：只有静态取证（源码 + 已决设计 + 模块导出面）。上游 `dev/bench.sh` 有 mock 模型测试台，
  若 Phase 1 需要行为级证据（尤其群聊轮次与管家判定的真实走向），可跑上游 bench 取一手读数
  ——代价是装它的依赖（Node 24 + pnpm），列为 Phase 1 的可选项，由业主决定是否值得。
- 上游 `app/`（桌面壳）、`link/`（relay）、`mobile/` 只读了目录与 README，**未读实现** —— 本轮切片不含这三块。
- 上游客户端（`src/client/`）**未读实现**（只量了体量与文件数）——UI 形态判断在 Phase 1 补。
- 上游 `2026-10-13-dsh-concessions.md`（DSH 让步总账）未读——它记录了上游对 DSH 的妥协清单，
  是「哪些机制因宿主限制而变形」的索引，值得在 Phase 1 补读一篇。
- 本仓 `src/agent/evolution|evolve|gym|map` 四处未逐一读，Phase 2 补。
- 本仓桌面渲染层的行数分布已测（§3.4），但**新面板的文件分配表**未出，Phase 2 补。
- 本轮只写文档，**没有跑任何测试或门禁**（`pnpm docs-check` 在本文件落盘后跑过，全绿）。

**自研定位的三条边界**（免得「参考」在执行期走样）：

- **本轮只读上游、未产出任何上游代码**；`_bench/dsbot-src/` 是**仓外**的只读快照，不入库、不参与构建。
- **未评估自研实现的实际工作量**：那是 Phase 4 spec 的事，本轮不估（估了也没有依据）。
- **命名与概念体系尚未定案**（Q17）：在它定案之前，**不要把上游的 `message_bot`／`post_to_group`／
  `group_goal`／`MEMORY.md` 条目格式／`state.json` 字段名带进本仓**——
  这些名字一旦进代码/进文档，就等于默认了移植路线。本仓的词必须从本仓既有约定里长出来。

---

## 十二、与后续的衔接

调研批次的台账页（PROGRESS）与 ADR 0015 在 Phase 3 一并落；`STATE.md` 不动（现役基线未变）。
业主看过 ADR 0015 并认可后，才进 Phase 4 写 spec —— 在那之前**本仓不出现任何 bot 团队的实现代码**。
