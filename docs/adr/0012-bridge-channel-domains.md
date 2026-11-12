# ADR 0012：桥面域归属表——把「这块能力归谁管」变成通道声明的一部分

- 状态：**已接受**——2026-11-12 业主令「按照我们调研的数据开始优化我们的项目」
- 日期：2026-11-12
- 决策者：仓库所有者
- 取代：`docs/adr/0010-claude-desktop-5x-benchmark.md` 第四节待办的第 3 条
- 关联：`apps/desktop/src/main/channels.ts`、`apps/desktop/tests/channel-domains.test.ts`（新）、
  `apps/desktop/tests/channels.test.ts`、`docs/adr/0010-claude-desktop-5x-benchmark.md`

## 一、动因

对标 Claude Desktop 5.1231.2 得到的实测：**上游的桥是按域命名空间组织的**
（`claude.web` / `claude.settings` / `claude.internal.ui` / `claude.internal.computerUse` /
`claude.hybrid` / `claude.skills` / `claude.design` … 约 24 个命名空间对象），
于是「这块能力属于哪个域」在那边**可枚举**。

本仓的桥是**单一扁平面**：`contextBridge.exposeInMainWorld("agent", api)` 一个全局名，
底下 156 条 invoke + 9 条 push 通道平铺。归属信息**不是没有，而是长错了地方**——
它只活在 `apps/desktop/tests/channels.test.ts` 里那张 **156 条的手写「接真名单」**中，
而那张名单证明的是「每条通道有没有接真」，**不是「归谁管」**；两份事实被塞进了同一张表。

## 二、做法：归属写进通道声明，不另抄一张表

在 `apps/desktop/src/main/channels.ts` 里加：

- `ChannelDomain`（18 个域的联合类型）；
- `CHANNEL_DOMAINS: { [K in InvokeChannel]: ChannelDomain }`——**映射类型**，
  与 `INVOKE_CHANNELS` 同款红线：`AgentApi` 增删方法而这里不加行 ⇒ **typecheck 红**；
- `PUSH_CHANNEL_DOMAINS: { [K in PushChannel]: ChannelDomain }`；
- `CHANNEL_DOMAIN_DESC` / `PUSH_DOMAIN_DESC`：每个域一句人话说明（谁拥有这条能力）。

**通道条数不变**（156 + 9）：`channels.test.ts` 的表长断言与 `README.md` 里那个数都不受影响，
`tests/readme-invoke-channel-count.test.ts`（核心套件）也不用动。

### 18 个域与它们的通道数（invoke 侧）

`run` 10 ｜ `session` 21 ｜ `project` 18 ｜ `app` 18 ｜ `settings` 15 ｜ `plugin` 15 ｜ `pane` 15 ｜
`automation` 9 ｜ `provider` 8 ｜ `evolve` 7 ｜ `integration` 5 ｜ `sidechat` 4 ｜ `orchestration` 3 ｜
`skills` 2 ｜ `memory` 2 ｜ `feedback` 2 ｜ `usage` 1 ｜ `lsp` 1。
push 侧 9 条：`run` 3 ｜ `pane` 4 ｜ `app` 2。

切法按「**谁拥有这条能力**」分，不按功能细分：域太多则名存实亡，太少则查不了。
`usage` 与 `lsp` 只有一条通道，也**不并进别的域**——它们的归属恰恰是最需要被看见的
（用量账与 LSP 状态是两块最容易被误当成「app 的一部分」的能力）。

## 三、判卷（`apps/desktop/tests/channel-domains.test.ts`，8 条）

1. **归属表与通道表同生共死**：invoke 归属表键集 = 通道表键集（双向相等）；push 同理。
2. **域名不许手滑**：归属值必须在已声明的域集合里（拼错的域当场红）。
3. **域不是名存实亡**：每个声明的域至少有一条通道（invoke 或 push），且都有 ≥10 字的说明。
4. **各域通道数被钉住**：改归属是**显式动作**，不是随手拖一条。

### 红绿证明（现跑，三种失配各一）

| 造的红 | 变红的格 |
|---|---|
| 把 `listSkills` 的归属从 `skills` 改成 `run` | 「各域的通道数被钉住」 |
| 删掉一条归属（`listSkills` 那行） | 「归属表与通道表同生共死」＋「各域计数」 |
| 把 `lsp` 域的说明清空 | 「每个域都有说明」 |

三条都红、还原后 **8/8 复绿**。

## 四、明确不做（并附理由）

- **不把桥改成按域分组**（`agent.session` / `agent.run` …）。上游那 24 个命名空间对象是
  **claude.ai Web 应用**的形态；本仓的渲染层已经直接用 `window.agent.<方法>`，
  改形状会让 30+ 个渲染层调用点与判卷一起翻，**收益只是「看起来像上游」**。
  ⇒ 取的是「**域可枚举**」这一个性质，不是上游的命名空间数量。
- **不把归属表暴露给渲染层**。它现在是仓内的账，由判卷与将来的能力面审计消费；
  在没有消费者的前提下往 `AgentApi` 加字段会动核心协议（`IPC_PROTOCOL_VERSION`），
  那是「以后可能用得上」的典型 ⇒ 不做。等真有人要画「能力面」时，账已在手。
- **不新增通道**，不改任何既有通道的行为。

## 五、边界

- 域的切法是**人的裁决**，脚本生成不了；本批 18 个域的归属由本轮逐条判定
  （归类脚本有覆盖率自检：未归类/多余/重复即报错，165 条一次过）。
- 归属表**不判「接真」**：那张 156 条的接真名单仍是 `channels.test.ts` 的职责，两件事不混。
- 本批**零视觉改动**、零行为改动（只加了一张只读的归属表与它的判卷）。
