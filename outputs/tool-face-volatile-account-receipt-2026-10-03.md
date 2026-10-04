# 施工回执：给装配账补易变侧 + 改正帽的注释（2026-10-03）

范围：**只做读数 §5.4 判为「①该修 + ②可修」的两条，③明确不做**（用户 2026-10-03 确认）。
目标树：本仓 `m0-agent-loop`（甲口径）。未触碰官方 DeepSeek Harness App 的任何文件。

---

## 一、改了什么

| 文件 | 改动 | 性质 |
|---|---|---|
| `src/events/index.ts` | `SurfaceAccountEvent` 增 5 个字段：`volatileChars` / `memoryChars` / `skillsBlockChars` / `mapChars` / `attachmentContextChars` | 加观测字段 |
| `src/agent/glm-session.ts` | ①易变侧四块的构建整段**上移**到降配计划之前；②`recordSurfaceAccount` 增第四参，四数照实进事件 | 纯重排 + 取值 |
| `src/agent/model-surface.ts` | **只改注释**：帽的文档改成「固定面（system+工具）」，并在文件头写清为什么不把易变侧接进判定 | 注释订正 |
| `scripts/observe-surface.ts` | 读侧：每轮表加「易变侧」列；汇总加「最大易变侧合计」及四个分项；判读清单补一条；顺带订正 USAGE 里已迁走的旧路径 | 读侧 |
| `tests/surface-account.test.ts` | 补齐夹具字面量；未降配用例钉四块「记 0 而非省略」；**新增 1 条判据**：四块照实进账且**不进降配判定** | 判据 |

## 二、为什么必须上移那一段

落点受一条硬约束：`surface_account` 必须排在压缩事件之前，否则
`tests/compaction.test.ts:481`（`expect(last.type).toBe("compaction")`）与
`tests/compaction.test.ts:490-497`（**用数组下标当事件 id** 的两向断言）会红。

而易变侧四块原本构建在降配之后（记忆 `:903`、skills 块 `:907`、地图 `:932`）⇒ 想记它们就得上移。
已核实四块与降配**互不依赖**（谁都不读谁的结果），故是纯重排：
- 记忆只依赖 `workspace`；skills 块只依赖 `events` + `liveNote`；地图只依赖 `history` / `events` / `round`。
- 压缩判定（`AssemblyOverhead`）在 `:936-942` 构造，读的仍是同一批已算好的字符串 ⇒ **零重复计算**。

## 三、字段口径（钉在 `src/events/index.ts`，不靠注释外传）

**这是「降配计划那一刻」的快照，不是实际发出值。**
压缩那一轮四块会被重建：记忆与压缩无关（准）；地图按 `history.length ≤ 2` 重判（可能变）；
**skills 块可能变大**——重挂只认已被 `compaction` 事件摘掉的激活记录（`plugins/index.ts:466-470`），
压缩后摘除集合变大 ⇒ 更多 skill 具备重挂资格。

⇒ 它**既不是上界也不是实发值**（这一句是对先前口头说法「压缩前上界」的更正）。
压缩那一轮的实发口径以 compaction 预算自己的 `AssemblyOverhead` 为准。

## 四、为什么 ③ 不做（不把易变侧接进 `planSurfaceBudget`）

1. **解不开的循环**：压缩那侧的开销估算 `toolSchemaChars` 要消费**降配后**的 tools
   （`glm-session.ts:939`）⇒ 降配必须排在压缩前；而压缩会重建易变侧 ⇒ 真值要到降配之后才知道。
2. **手段不对口**：梯级 A/B 只会压描述、丢工具，**对记忆/skills 块一个字节都削不掉**，
   只会因为记忆太大而误伤工具面。
3. **接进去会撞判据**：`accountModelSurface` 的 `volatileChars` 从恒 0 变成真值后，
   `fixedChars` / `totalChars` 语义改变，`scripts/model-surface-check.ts` 的 MS1（判 `fixedChars <= limitChars`）
   与 MS3 的基准都要重跑。
4. **不是钱在偷烧**：另两把账是全的——压缩预算 `AssemblyOverhead`（含 skillsBlock / memoryChars /
   mapChars / attachmentContext）与最终 fail-closed 硬闸 `finalChars`。

准确结论（已写进 `model-surface.ts` 文件头）：**最便宜的那把刀在压力真正来处永远拔不出来。**

## 五、验证

| 项 | 结果 |
|---|---|
| `tests/surface-account.test.ts` | **9/9 通过**（原 8 条 + 新增「易变侧四块照实进账」1 条） |
| 高风险路径定点回归 | `compaction` / `compact-wiring` / `hook-precompact-producer` / `final-budget` / `model-surface` / `prefix-churn` / `stream-redaction` = **91/91 通过** |
| 全量核心套件 | 299 文件 / 4261 用例，**4260 通过、1 失败**。失败为 `tests/loop.test.ts:197`，**非本次改动**：该文件本身干净，失败源自旁 session 未提交的 `src/agent/loop.ts` 改动（其 diff 新增 `type: "verify_result"` 落盘），与该断言直接冲突 |
| `node --import tsx scripts/typecheck.ts` | 本次改的 5 个文件**零报错**。余下报错文件：`tests/autonomy.test.ts`（tracked 且脏，旁 session）、`tests/head-cert-provenance.test.ts`（未跟踪草稿，旁 session）—— 均非本次 |
| `node --import tsx scripts/docs-check.ts` | **受检项全绿**（另有 3 项未检：STATE.md 不存在，迁移前属正常） |
| 读侧端到端 | 造了一份真日志跑 `pnpm observe-surface`：22 件面 / 10,801 字符、易变侧 1,096 字符（skills 块 31 / 地图 1,027 / 附件 38）、超帽 `-` ⇒ 易变侧**记到了且没有污染降配判定**，与新判据一致 |

## 六、已知未修（**2026-10-04 已处理，见 [四条老坑回执](tool-face-followups-receipt-2026-10-04.md)**）

> 下表四条已全部处理：①④ 是真问题（补注释+守卫判据 / 补 fail-closed 闸），
> **②③ 经实测推翻了我原先的说法——不是缺陷**，改的是注释不是代码。
> 本节保留原文是为了留住「当时为什么先没动」，并已标注结论变化。



- **`tests/final-budget.test.ts:20` 断言「硬闸拦下时盘上零字节」**，与 `glm-session.ts` 调用点注释
  「被最终装配硬闸拦下时仍留一条」**直接矛盾**。今天不红只因该用例不传工具面（`surface = null`）。
  一旦那条路径带上工具面，两条约定必有一方要改。**这是先于本次改动就存在的地雷**，未动。
- **符号地图用 chars/4 定预算**（`map/render.ts:19-21` 的 `mapTokensOf` → `compaction.ts` 的
  `estimateTokens`），而 `model-surface.ts:13` 明写 chars/4 对中文低估 3–4 倍。同一个「token」字
  在地图侧是 ASCII 乐观值、在记忆/重挂侧是 CJK 感知值。
  → **2026-10-04 复核：我原话说重了。** 地图文本实测宽字符仅占 **1.7%**（装的是文件路径与符号名），
  chars/4 与 CJK 感知只差 **5.2%**（995 vs 1,047 tok）。那个 3–4 倍只对**散文块**成立。
  **未改代码**，已在 `map/render.ts` 的 `mapTokensOf` 上写明实测与「三族不许混算」。
- **生产调用的地图预算是 1,024 token 而非 `MAP_TOKENS_MAX` 的 4,096**（`glm-session.ts` 只传
  `maxInputTokens: 128_000` ⇒ `clampBudget(undefined, …)` 取缺省）。
  → **2026-10-04 复核：不是 bug**，`MAP_TOKENS_DEFAULT` 本来就是 1024，生产跑的正是文档写的缺省值；
  `MAP_TOKENS_MAX` 是上限，生产从未取到。已在调用点**显式传 `budgetTokens`**（零行为变化），
  并在 `map/render.ts` 文件头点明三个常量是三种身份。
- **`attachmentContext` 在 runner 层有帽（`MAX_ATTACHMENTS` / `MAX_TOTAL_PATH_CHARS`），
  但 provider 层零校验**——任何直构 provider 的调用方可传任意长字符串。
  → **2026-10-04 已修**：provider 工厂加 `ATTACHMENT_CONTEXT_CHAR_LIMIT = 32_768` 的 fail-closed 闸
  （越界抛，不静默截断），并在 `run-attachments.test.ts` 加判据。

## 七、读数同步

`outputs/tool-face-repo-rebaseline-2026-10-03/00-读数.md` §5 已按本次实现口径订正
（「压缩前快照，不是上界」）。测量脚本 `measure-volatile.mts` 可复跑。