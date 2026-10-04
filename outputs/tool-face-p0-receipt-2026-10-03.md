# P0 施工回执：装配账落事件流（2026-10-03）

> 状态：**已落地，验证通过**。本文是**施工回执**，与设计（[tool-face-p0-design-2026-10-03.md](tool-face-p0-design-2026-10-03.md)）、评审（[tool-face-p0-review-2026-10-03.md](tool-face-p0-review-2026-10-03.md)）两份分开。
> 基线 HEAD `467caa0` ＋ 本次改动。**§3 的每条验证都是实跑过的，命令可复跑。**

---

## 1. 改动清单

| 文件 | 性质 | 内容 |
|---|---|---|
| `src/events/index.ts` | 接口 + 注册表 | 新增 `SurfaceAccountEvent`（14 字段）；联合新增成员；**G0**：`KNOWN_TYPES` 由 `new Set([...])` 改为 `Record<AgentEvent["type"], true>`，运行时查找改 `Object.hasOwn`（不用 `in`：原型链会把 `toString` 认成已登记） |
| `src/agent/glm-session.ts` | 发射点 | `attemptSeq` 独立计数器 + 精确面签名；`recordSurfaceAccount()`（declared/sent 双基、采样、fail-open、不 close 句柄）；落点在 compaction 块**之前** |
| `src/agent/sidechat.ts` | **强制登记点** | `surface_account` 显式归入 `return null` 分组（不是靠「没写 case」） |
| `src/agent/worker-projection.ts` | **强制登记点** | 登记进 `PROSE_FREE_TYPES`；「工具名按标识符、不脱敏」的理由写成注释 |
| `src/agent/context.ts` | 显式登记 | 忽略类型注释里点名 `surface_account`，让「不进模型上下文」是写下的事实而非巧合 |
| `tests/event-registry.ts` | 取料口 | 跟着 `Record` 改解析；找不到声明/不是对象字面量都当场抛，**绝不静默返空数组**（那会让「未表态类型」判据假绿） |
| `scripts/observe-surface.ts` | **新增·只读尺子** | 读一条或多条会话 JSONL，答 P0 四问；零读数**显式出声**；退出码：量出来恒 0、用法错/读不开 2 |
| `tests/surface-account.test.ts` | **新增·判据** | 8 条 |
| `package.json` | 1 行 | `"observe-surface"`（与 `prompt-cost` / `tool-choice` 同层） |

diffstat（本次改动，不含并发会话的改动）：7 文件 `+179 −40`，另加 2 个新文件。

---

## 2. G0–G10 逐项处置（评审放行清单）

| # | 放行条件 | 状态 | 说明 |
|---|---|---|---|
| G0 | `KNOWN_TYPES` 改 `Record`，让「忘登记」变编译期错误 | ✅ | 并做了**反向验证**（§3 第 1 条） |
| G1 | 改动清单写全 4 处 | ✅ | 联合 / `KNOWN_TYPES` / `sidechat` switch / `worker-projection` 四桶；另加 `context.ts` 注释 = 第 5 处显式登记 |
| G2 | declared / sent 分基落名 | ✅ | `declaredToolCount` / `declaredToolSpecChars` / `sentToolCount` / `sentToolSpecChars`；`baseSystemChars` 注释写明不含 memory/skills/地图/附件 |
| G3 | 删掉恒 0 的「说谎字段」 | ✅ | 未引入 `fixedChars` / `volatileChars` |
| G4 | 采样加「面指纹变化」；改写对 PC1–PC4 的委托 | ✅ | 签名是**精确**的（工具名按数组序拼接），不是「长度+首尾」——中途换掉一把而长度不变时，前者抓得到、后者抓不到 |
| G5 | emit 失败语义二选一 + fallback 不 close | ✅ | **fail-open**：`catch` + `console.warn`，落流失败不断请求；fallback **不 close**（句柄交 `LOG_HANDLE_MAX` 有界缓存） |
| G6 | `attemptSeq` 用独立单调计数器 | ✅ | 不复用 `successfulRequests`（后者成功后才 ++） |
| G7 | 落点约束 + 体积上界 | ✅ | 落点注释写明「必须在 compaction 块之前」并给出三条断言的出处；**Alt-A**：未落 `piecesTop`，单事件约 200 字节 |
| G8 | 覆盖面声明收窄 | ✅ | 见 §5 |
| G9 | 采纳 Alt-A（只落核心字段） | ✅ | 14 字段 = 9 个核心 + `limitChars` / `prefixStableChars` / `faceChanged` / `baseSystemChars`（后 4 个都已在作用域内，零额外成本）；`piecesTop` 未落 |
| G10 | 把 P0 第 3 格（工具选择靶场）立成 P1.5 | ⏳ | **未做**——这是计划动作，不是代码动作，留待 §6 |

---

## 3. 验证证据（全部实跑，可复跑）

| # | 验证 | 命令 | 实测结果 |
|---|---|---|---|
| 1 | **反向验证 G0**（评审要求：证明登记是强制的） | 临时删掉 `surface_account: true,` 后跑 `node --import tsx scripts/typecheck.ts` | ✅ 编译失败：`src/events/index.ts(647,7): error TS2741: Property 'surface_account' is missing ... but required in type 'Record<...\| "surface_account", true>'`；已恢复并确认 |
| 2 | 新增判据 | `vitest run tests/surface-account.test.ts` | ✅ **8/8** |
| 3 | 脱敏覆盖闸（含「未表态类型当场红」） | `vitest run tests/stream-redaction.test.ts` | ✅ **21/21** |
| 4 | 零回归支（未超帽逐字不变） | `vitest run tests/model-surface.test.ts` | ✅ **11/11** |
| 5 | **顺序不变量**（评审 C7 点名的三条） | `compaction` / `compact-wiring` / `hook-precompact-producer` | ✅ **30 + 4 + 7 全绿** |
| 6 | 事件面 | `events` / `routing-events` / `events-tail-repair` | ✅ 全绿 |
| 7 | 复跑面登记（D-8 第五判据） | `vitest run tests/replay-readings-registry.test.ts` | ✅ **4/4**（见下方说明） |
| 8 | **全量核心套件** | `node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts` | **298 文件 / 4249 用例：4248 通过，1 失败**（归因见 §4） |
| 9 | typecheck | `node --import tsx scripts/typecheck.ts` | 本次改动的文件**零报错**；归因器把唯一报错文件标为 `tests/autonomy.test.ts`（并发会话改脏） |
| 10 | **端到端读数** | `node --import tsx scripts/observe-surface.ts <合成会话>` | ✅ 四问可答；declared/sent 两列分明；零读数会话**显式打印**「无 surface_account 读数…」；退出码 0 |

**第 7 条的经过值得留档**：`scripts/observe-surface.ts` 最初放在 `scripts/replay/` 下，被 D-8 第五判据（「未登记且没人 import 的复跑面 = 孤儿」）当场判红。那条判据是对的，**错的是位置**——`scripts/replay/` 住的是登记在案的判卷读数（要求同提交里有文档写 `replay:<id>`），而本件与 `prompt-cost` / `tool-choice` 同性质：手动跑、指哪读哪的**尺子**。挪到 `scripts/` 顶层并加 pnpm 脚本后转绿。这个教训（判据挂在机制上、位置要对）已写进脚本头注。

---

## 4. 归因：唯一失败**不属**本次改动

```
FAIL tests/loop.test.ts > auto-verify on completion > 可验面探测炸（config 存在但 JSON 坏）⇒ 不炸 run、不补拍
  AssertionError: expected [ { type: 'verify_result', …(7) } ] to have a length of +0 but got 1
```

- `tests/loop.test.ts` **工作树干净**（无人改过它）。
- `src/agent/loop.ts` **被并发会话改脏**（`M`），其唯一 diff 摘要正是新增一条 `type: "verify_result"` 的发射，注释原文：「fail-closed 口径与 manual 对齐：探测失败是一次坏的 verify 证据，**必须进事件流**」。
- 该用例断言的恰恰是「探测失败**不**补拍」。⇒ **行为变更先于用例更新**，属那个会话的收尾动作。
- 本次改动不碰 verify 面（我的事件类型不同，且发射被 `surface` 非空门住）。**未代其修**——AGENTS.md 明写「保留其它会话的脏改动，不要 reset 或 stash」。

---

## 5. 已知覆盖缺口（写下来，不装没有）

1. **worker 与 sidechat 不产生装配账**。两者各起自己的 provider（`createWorkerProvider` / `createSidechatProvider`），`planSurfaceBudget` 全仓唯一生产调用点是 `glm-session.ts`。P0 读数覆盖：主会话 / gym 明卷暗卷 / probe。副作用一条（对 P1 有实质影响）：**worker 面与 sidechat 面本来就不受 24k 闸管**。
2. **权限档 / skill 摘除只以「面变了」的形式可见**。事件不带 `requestFace` 的 `removed`/`skipped`（那需要扩 provider 契约）。这是评审 S-4 登记的边界，不是缺陷，但要读的人知道。
3. **未落 `piecesTop`**（Alt-A）。逐件账留到 P1 真做「按效用丢」时再加。
4. **`baseSystemChars` 不是「模型面总开销」**。它只是 `opts.system` 的长度，不含 memory / skills / 符号地图 / 附件——那些是 `composeTurnMessages` 推入的另外的 system 块。
5. **V6 已从历史日志补出一半**（2026-10-03 晚）：`request/header` 事件里存着每次请求的完整工具表，因此「真实面多大、有没有越过触发线」**不必等新构建**即可量出——135 次真实请求给出 p50 60 件 / 52,716 字符 ≈ 14.6k token，**117/135 越过官方 10K 触发线**。完整读数见 [tool-face-p0-readings-2026-10-03/00-读数.md](tool-face-p0-readings-2026-10-03/00-读数.md)。**另一半仍未做**：`surface_account` 在真实会话上的落账（降配梯会不会开火、丢了谁）——那需要改动进到跑着的 app 里。

---

## 6. 下一步

P0 已完成；**P0 读数也已从历史日志补出**（见 §5 第 5 条与 [读数](tool-face-p0-readings-2026-10-03/00-读数.md)）。按那份读数，上游 §7 的证伪条件已可判：

- **P1（改降配判据）应当推进，且最急**：真实面 p50 52,716 字符对上 24k 帽 ⇒ **每次请求要砍掉约 55%**，而现在是按数组位置砍的。
- **P2（渐进式披露）应当推进**：117/135 请求越过 10K token 触发线；前 10 把工具覆盖 93.9% 的调用。
- **B（静态分面）是零新机制的最大杠杆**：`ego_*` 33 把 + `univer_*` 14 把 = 47 把情境能力常驻，占历史可见宇宙 124 把的 38%。

仍要在新构建上落一次 `surface_account` 账，才能回答「降配梯开火时**丢了谁**」：

```
pnpm observe-surface <会话.jsonl> [...]        # 或
node --import tsx scripts/observe-surface.ts <会话.jsonl>
```
