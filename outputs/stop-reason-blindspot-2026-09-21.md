# 停止原因零读者：被砍断的一轮原本记账成「成功」（2026-09-21）

## 一句话

三家 provider 每轮都送来「这一轮为什么停了」，本仓**四个适配器一个都没读**。于是被
`max_tokens` 拦腰砍断的一轮与答完的一轮在事件流里长得一模一样，而 loop 判任务结束的
唯一依据是「这一轮有没有 tool_call」 ⇒ **截断被记账成成功**。这是能力 5（执行-验证-修正）
与「返工少」的直接病灶：模型踩着半句话继续盖楼，harness 全程不知情。

## 实测证据（本轮全部可重跑）

1. **字段在线上一直存在**（不是"上游没给"）：冻结夹具逐字记着
   `fixtures/providers/anthropic/text-stream.sse:23` `stop_reason:"end_turn"`、
   `openai/text-stream.sse` `finish_reason:"stop"`、`gemini/text-stream.sse` `finishReason:"STOP"`。
2. **零读者**：`src/` 全树 `stop_reason|finish_reason|finishReason` 命中 **4 处**，
   全部是 `src/providers/{anthropic,openai,gemini}.ts` 与 `glm.ts` 注释里的**类型声明/注释**，
   读取点 **0**。`glm.ts` 整文件委托 `streamOpenAI`，所以实际是三家四适配器同一件事。
3. **判定面**：`src/agent/loop.ts:219-221` 对每个流事件只问 `output.type !== "tool_call"`
   就 continue；收束在 `:377 if (!sawToolCall) { ... return; }`。停止原因**从不参与**这个判定。
4. **同族只修了一半**（本轮最高价值的一条）：三个适配器各自的 C7 注释明写着
   「上游把一帧截断了…而流随后正常收尾会让本轮以「不完整输出」成功收束（**loop 无从得知**）」，
   并为此在 `JSON.parse` 失败时抛死。**同一个危害，认过一次错的地方通常只修了一半**——
   它管的是「半帧丢失」，没管「帧到齐但篇幅不够」，而后者才是日常发生的那一种。
5. **测试面也零覆盖**：`fixtures/providers/**` 12 份夹具里出现的停止原因只有
   `end_turn / tool_use / stop / tool_calls / STOP`（+ 若干 `null`）——
   **没有一份夹具走到过非正常收尾**。
6. **文档缺口**：`agent-plan.md` 里 `stop_reason` 零命中（唯一命中的 `stopReason` 是 §9.5
   hook 的 JSON 输出契约，另一码事）。这条不是"实现漏了方案"，是**方案本身没写**。

## 本轮落了什么（只到「感知」，没碰「动作」）

- `src/providers/stop-reason.ts`（新）：三家词表 → 中立结局（`completed / tool_use /
  output_budget / content_blocked / unknown`）；**未收录值一律 `unknown` 且不落证据**
  （「不知道」≠「知道它坏了」，把不知道说成坏就是自造证据）。
- `turn_truncated` 事件（`src/events/index.ts`）：**只在非正常收尾时落**——答完的轮
  零新事件，既有转录与 12 份冻结夹具字节不变。只存机器可读 token，界面文案留给渲染层投影。
- 三家适配器各接一处，payload 由**同一个** `turnTruncatedEvent()` 构造：一份政策两份实现，
  其中一支迟早悄悄少做几件事（sidechat 与 worker 回传的输出扫描就是这么撞车的）。
- `src/agent/context.ts`：`truncationNote()` 把截断投影成一行 `[harness]` 说明，
  **紧跟在被砍断那段正文之后**（不做「只投最新一份」：截断是发生在特定位置的既成事实，
  位置本身就是信息，摘掉旧的等于假装那半句完整过）。
- `src/agent/sidechat.ts`：主会话只读投影加一个 case（与 `error` 同档——那句回答不完整，
  是用户接着提问的前提事实）。

### 顺手被结构性检查抓到的一件事

把 `turn_truncated` 加进 `AgentEvent` 联合后，`tsc` 当场点名 `sidechat.ts` 的
`renderProjectionLine`「缺结尾 return」——那是本仓刻意的**穷尽 switch**（新事件类型必须让
每个投影器表态）。**这就是 M7 影响面那条规矩在门内的样子**：不是靠人记得去 grep。

## 验证读数（工作树态，含并发会话的在飞 hunk）

- `TERM=dumb node node_modules/typescript/bin/tsc --noEmit` → 本轮触及面 0 错。
  唯一残留红因是**未跟踪草稿** `scripts/sidebar-probe.ts`（不属本轮、不属任何提交）。
  备案一条归因纪律：本轮第一次 tsc 里那条 `src/agent/sidechat.ts(110,47) TS2366` **起初被我
  记成对方在飞 hunk 的错，实测是自己造成的**——我给 `AgentEvent` 加了成员、还没补 sidechat
  的穷尽 switch。补上 case 后该行即消失，而对方那两个 hunk 全程无害。
  ⇒ 见到在飞文件的红，先按「我刚刚动了什么」验一遍再指认别人（规则 5 的镜像：误派的代价是
  让别人重做没坏的东西）。
- 全量 `test` → **182 files / 1697 tests passed，exit 0**（新事件类型未破任何投影/门）。
- 新增 `tests/turn-truncated.test.ts` **17 条**。

### 一次自我纠错（值得留，因为它暴露了主树测不出来的那类错）

首笔提交 `77b18f3` **HEAD 悬空**：测试文件把 `ModelOutput` 从 `../src/events` 导入，
而它的真身在 `../src/providers`。主树三重读数全部放行——
① `tsc` 是在**建这个测试文件之前**跑的（顺序错了，不是判断错了）；
② `test` 走 vitest，`import type` 编译期整体擦除，**运行时永不暴露**这类错；
③ 全量绿 + 门绿都不能反证类型干净。
抓到它的唯一一档证据 = **干净 HEAD 的隔离 worktree 重跑 tsc**（无未跟踪草稿、无在飞 hunk，
且文件集就是提交里那份）。已作为第二笔修复。

⇒ 教训成一条可复用的口径：**新增 `.ts` 文件后，tsc 必须在「文件已存在」的状态下重跑一次**；
且「先跑门、后写测」的次序等于没跑门。

### 分辨力实测（HEAD 隔离 worktree 手注入，主树零改动）
  | 注入 | 结果 |
  |---|---|
  | 三家 provider 的读取全摘 | **恰好 3 条红**（每家一条），6 条负控全绿 |
  | 只摘 anthropic 那一处 | **恰好 1 条红**（另两家不受影响 ⇒ 三条不是冗余副本） |
  ⇒ 三条 provider 用例各自有分辨力，且「正常收尾零事件」那三条负控不是恒真摆设。

## 刻意留的边界（别看成已完成）

**这一轮只让截断「可见」，没有让 harness「接着做完」。** `runLoop` 的收束语义一字未动
（测试里显式锁住 `requests === 1`）：截断后仍按原样返回，**不多要一轮模型**。

为什么不顺手做：自动续跑 = 每次截断多烧一轮真钱，而本仓对「花钱的动作」有一条硬规矩——
先拿准确率与 `$/成功任务` 的实测再决定开闸，不在零读数的情况下默认开。
所以动作那一半（在截断处续写 / 收窄范围重做）留作下一步，且它的**前置条件正好是本轮**：
没有停止原因，续跑策略连"该不该续"都判不出来。

同一条通道现在解锁了两件此前量不了的事：
1. **思考档位**（`0ae8c46` 那份量测文档点名「真前置是三家的停止原因全是零读者」）——
   现在有了读者，档位这一格动作空间才谈得上开。
2. **输出预留够不够**——`output_tokens` 第一次随截断一起落盘，
   「8192 的预留是否 binding」从猜测变成可数的事件。

## 待办（按优先级）

1. 沉淀面：`failureDigestFromEvents`（能力 6/10）现在只看 `verify_result(ok:false)` 与
   `tool_result(ok:false)`——**截断两种都不属于**，所以它是失败轨迹里价值最高、
   沉淀器却完全看不见的一类。补进 digest。（⚠️ `src/agent/memory/distill.ts` 另有
   在飞 hunk，动前先确认对方已落库。）
2. 面板可见：渲染层按 `outcome` 出文案（main 只落 token 的规矩，#48 同口径）。
3. ~~门/锚点~~ **已落（与变异表同一笔提交）**：变异表 +8，逐条在 HEAD 隔离 worktree 实测**全杀**
   （`stop-reason-keeps-wire-text` / `-emits-on-benign-reason` / `-drops-case-fold` /
   `-hides-zero-output-tokens` / `anthropic-never-reads-stop-reason` /
   `openai-never-reads-finish-reason` / `gemini-never-reads-finish-reason` /
   `context-never-projects-truncation`），主树一个字节未动；
   `pnpm mutate-needles-check` 全表 551 条针脚 0 阻断 / 0 待复认 / 0 未覆盖。
   其中 `stop-reason-hides-zero-output-tokens` 是一条**通用形状**的针：
   `...(x !== null && x !== undefined ? {…} : {})` 被顺手改成 `...(x ? {…} : {})` ——
   `output_tokens = 0` 是读数，不是「没上报」。
4. 动作半（截断续跑）：需真钱 A/B，先出 `$` 与准确率两个数再裁默认值。

## 复算命令

```
TERM=dumb node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts tests/turn-truncated.test.ts
grep -rn "stop_reason\|finish_reason\|finishReason" src/ | wc -l   # HEAD 实测 4（全是声明/注释）→ 本轮后 23
```
（`wc -l` 两边都数：单看修复后的 23 说明不了任何事，修复**前**那个 4 才是缺陷本身——
4 个命中全在类型声明与注释里，读取点为 0。）
分辨力注入法（不动主树）：`git worktree add --detach /tmp/x HEAD` + 软链 `node_modules`
→ 把 `src/` 同步进去 → `git checkout -- src/providers/{anthropic,openai,gemini}.ts` → 跑同一份测。
