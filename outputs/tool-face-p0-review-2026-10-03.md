# P0 方案技术评审结论（2026-10-03）

> 评审对象：`outputs/tool-face-p0-design-2026-10-03.md`（P0 打点设计）+ `outputs/工具面与laya接入-专题研究结论-2026-10-03.md` §8（P0–P3）。
> 评审方式：技术方案评审团三线并行独立分析（架构与扩展性 / 权限与安全 / 验收边界与质量），主理人逐条复核成员引用并**亲自复现**其中的事实纠正。
> 基线 HEAD `467caa0`。**全部结论为静态代码核验：未跑任何测试、typecheck、门禁或靶场，未修改任何代码。**

---

## 0. 裁决

**条件放行。** 方向、落点、可逆性三项成立——但**不能照现文施工**：设计文档有 11 处与代码不符的事实陈述，其中 3 处会**当场变红**、2 处会让读数**答错本设计要回答的问题**。

「合理正确可用」的逐项回答：

| 维度 | 判定 | 依据 |
|---|---|---|
| **合理**（方向/次序） | ✅ 成立 | 「先补尺再动引擎」的次序正确；可逆性递增（纯观测 < 纯函数判据 < 新机制）；落点选在全仓唯一同时握有 system 与最终工具表的地方 |
| **正确**（事实/口径） | ❌ **不成立**，须修 11 处 | 见 §1；其中 `account` 口径错误与「假判据」是实质性的 |
| **可用**（可施工/可验收） | ⚠️ 修正后可用 | 缺 4 处强制改动点登记、缺 emit 失败语义、验收判据 V2 跑不起来 |

**放行条件（Definition of Ready，缺一不建议开工）**：见 §5。

---

## 1. 已复核确认的事实错误（主理人亲自复核，非仅采信成员）

| # | 设计文档原文 | 代码事实 | 证据 | 后果 |
|---|---|---|---|---|
| **E1** | 「加类型必须同时改**两处**：联合 + `KNOWN_TYPES`」 | **至少 4 处**：联合 `src/events/index.ts:557`、`KNOWN_TYPES:590`、**`src/agent/sidechat.ts:111–165` 的穷尽 switch**、**`src/agent/worker-projection.ts:87/105/112/118` 四桶之一** | 逐条实读；`tests/stream-redaction.test.ts:68–71`「新增一型不列进任何桶 = 当场红」 | 只改两处 ⇒ `typecheck` 红 + 判据红，**开不了工** |
| **E2** | 「一致性由 `tests/event-registry.ts` 判」 | **该判据不存在**。`tests/event-registry.ts` 只是**取料口**；其 `unionTypes()` **全仓零消费者**（grep 仅定义处 `:21`）；`tests/event-type-coverage.test.ts` **已不存在**；`scripts/mutate-verify.mjs:4652` 的引用是腐注释。唯一真自动网是 `tests/stream-redaction.test.ts` | 主理人 grep 复核 + 架构师 F1 + 验收 结论4 独立同证 | **V2 与 §8 的回滚判据是假的**（永远绿 = 没判） |
| **E3** | 「`gym/runner.ts:80`、`gym/probe.ts:177`、**sidechat** 未给 `opts.emit`」 | `gym/runner.ts:80` ✅ 属实。`gym/probe.ts:169` **声明** `emit?`、`:189` **条件转发**（只是调用方不给）。**sidechat 根本不过 `planSurfaceBudget`**：`createSidechatProvider`（`sidechat.ts:319–345`）用 `SidechatModel`（缺省 `streamGlm`，`:328`）直连 | 主理人复核 `planSurfaceBudget` 全仓调用点 = `glm-session.ts:829` + checks/tests | fallback 对 sidechat **永不生效**；应声明为**已知覆盖缺口**而非受益方 |
| **E4** | §4.1「主会话 / **worker** / 靶场 / 探针 / 暗卷都从本 provider 走」 | **worker 不过**。`createWorkerProvider`（`src/agent/orchestrator.ts:2466`）自建 `stream()` → `runOneRound()`，用 `workerToolSpecs()`，不调 `planSurfaceBudget` | 主理人实读 `orchestrator.ts:2466–2480` + `:1822` 调用点 | 覆盖面须收窄；**成员冲突**见 §4 |
| **E5** | §6「`piecesTop` + `toolCount` + `toolSpecChars` 给出真实会话含插件的**最终面**」 | **`account` 是降配前算的**：`model-surface.ts:151` `accountModelSurface({...input, limitChars, volatileChars})` 传的是 `input.specs`（声明面）；而 `surface.specs`（`:210`）是**降配后**。**两个基混在一条记录里** | 主理人实读 `model-surface.ts:145–217` | **降配轮答错**——恰是本设计最关心的场景。且 24k 帽下**送出面** ≤24k 字符 ≈ 6.7k token **恒 <10K**，不区分两基会**误触发**上游 §7 的证伪行 |
| **E6** | §3 字段 `fixedChars` / `volatileChars` | **全仓无任何调用方传 `volatileChars`** ⇒ `volatileChars ≡ 0`、`fixedChars ≡ totalChars`。模块注释（`:20–21`、`:56`）却声称池子含「易变 system 块」 | 主理人 grep：`volatileChars` 仅出现在 `model-surface.ts` 内部定义/默认值 | 两个**恒 0/恒等**的字段会「说谎」；且 `systemChars = opts.system.length` **只是首条 system**，不含 memory/skills/地图/附件 |
| **E7** | §2.1「`grep -n surface` 全部 **13** 条命中」 | 实测 **12** 条 | 主理人 `grep -c` 复核 | 实质结论仍成立（除 `surfaceNote` 外无消费方） |
| **E8** | §2.3「`LOG_HANDLE_MAX=32`，`src/events/index.ts:737–745`」 | 常量声明在 **`:628`**，淘汰逻辑在 **`:700–708`**；`:737–745` 是注释 | 三个成员一致 | 引用错位 |
| **E9** | §2.3「事件 id = 1-based 行号 `src/events/index.ts:831`」 | doc 注释在 **`:826`**；`replayIncremental` 定义在 **`:896`**（我写的 `840–866` 是 `replay` 区） | 架构师 F9 + 验收 R7 | 结论正确、行号漂移 |
| **E10** | §2.3「约 **31** 个成员的联合类型」 | 实测联合 **30** 成员、`KNOWN_TYPES` **30** 项 | 架构师 F10 + 验收静态统计 | 计数偏差 |
| **E11** | §2.3「`loop.ts:486` 是给了 `opts.emit` 的路径」 | `loop.ts:486` 是**工具 ctx** 的 `emit`（`events.append`），**不是 provider 选项**；provider emit 只在 `agent-runner.ts:1767/1886/1896` 等 | 架构师 F5 + 验收 | 引用错位 |

---

## 2. 三份评审的收敛发现（我判定为阻断或高优先）

| # | 发现 | 提出来源 | 严重度 | 最小修复 |
|---|---|---|---|---|
| **C1** | 新类型必须落 **`stream-redaction` 四桶之一**，否则 `tests/stream-redaction.test.ts:68–71` 当场红。这是**唯一一个「工具名要不要脱敏」的安全决策点** | 安全 S-1 + 架构 F2 + 验收 R1（**三方独立**） | **阻断** | 明确选 `PROSE_FREE_TYPES`（`worker-projection.ts:118–124`，定义=枚举/id/计数/路径标识；先例：`tool_call.name` 今天也不在扫描路径）**并写明「工具名视为标识符、不脱敏」的理由**；替代方案是落 `SCANNED_TEXT_PATHS` 并补 `SAMPLES` |
| **C2** | `sidechat.ts:111–165` 的穷尽 switch 无 default ⇒ 加联合成员**编译失败**（TS2366，`strict:true`）。它**迫使**实施者做一个方案没写的安全决定：若渲染该事件，**主会话工具面（含只读档本应「根本不存在于表内」的写向工具）会进 sidechat 并发往外部 provider** | 安全 S-5 + 验收 R1 | **阻断** | 在 `renderProjectionLine` 把 `surface_account` **显式**归入 `return null` 分组（不要依赖「没写 case」）；V3 判据扩到 sidechat 投影 |
| **C3** | **采样会掩盖「面变小」**（run 中途 `requestFace` 摘 skill/工具但未超帽 ⇒ 三条采样条件一条都不命中 ⇒ 不落事件）。而我援引的 PC2/PC3 兜不住：PC1–PC4 只跑在 `scripts/prefix-churn-check.ts:43–105` 的**合成驱动器**上，全仓无判据读真实会话的逐轮面变化 | 架构 A1 + 验收 R6 + 安全 S-4（**三方独立**） | **高** | 采样条件改为「首轮 ∪ **面指纹变化**（工具名序列长度+首尾名的轻量 hash，O(1)）∪ 降配」；并把对 PC1–PC4 的委托措辞改成「合成门，不覆盖真实会话」 |
| **C4** | `opts.emit` 无 try/catch ⇒ **新单点故障**：本事件每 run 首轮必过，emit 抛错会让每个 run 在首轮崩，**而今天不会** | 安全 S-3 + 验收 R5 | **高** | **必须明确表态**：fail-open（catch + `console.warn`，落流失败不阻断请求）或 fail-closed（写进契约说明为何观测面允许阻断热路径）。**不许静默** |
| **C5** | 照抄现有 fallback 的 `finally close()` ⇒ 每次 append 实为 **open + stat + 读尾 1 字节**，不是「1 次 Map.get」；且 `close()` 会删缓存句柄、与同路径另一 writer 存在交错窗口 | 安全 S-3 + 架构 + 验收 R5 | 高 | fallback **不 close**（依赖 `LOG_HANDLE_MAX` 有界缓存），或复用 pipeline 的 helper；成本按实写 |
| **C6** | `request` 不能复用 `successfulRequests`（`:809`，**请求成功后才 ++**）⇒ 失败/中断请求不推进，会出现连续多条 `request:1`，且「本 run 首请求」与「成功请求数」语义混用 | 验收 R4（唯一） | 中 | 在 `turnGenerator` 顶部加独立单调计数器；语义写死为「本 provider 实例内的请求序号」 |
| **C7** | **顺序不变量**：`compaction` 必须是会话日志的**最后一条**（`tests/compaction.test.ts:481`、`tests/compact-wiring.test.ts:77`、`tests/hook-precompact-producer.test.ts:232`）⇒ 发射点必须落在 compaction 块（`~884–920`）**之前** | 验收 R10（唯一） | 中 | 在 §4.1 写明落点约束，并把这三条断言写进 V 表 |
| **C8** | 体积上界盖错字段：`SURFACE_EVENT_PIECES_TOP=12` 只盖 `piecesTop`，而 **`shortened`/`dropped` 无界**（≤ 工具数 × ~25 B）⇒ 单事件最坏 ≈3–4 KB 而非「~500 B」；采样含「任何降配」时病态会话每轮都落 | 架构 A4 + 验收 B1 | 中 | 写清真上界；或只留前 N 名 + 计数字段 |
| **C9** | `piecesTop` 的 12 件里**含 `system:base`** ⇒ 实际只点到 11 把工具，读侧会误以为 12 把 | 架构 A7（唯一） | 低 | 落名时排除 `tier === "system"`，或注释写明 |
| **C10** | **悬挂依赖**：上游 §8 的 P0 第 3 格（宣布选对率不可测 + 立工具选择靶场）**两份文档都没有设计**，而 P2 的完成标准却依赖它（「gym 同 case A/B 给选错工具率 + token 双读数」） | 架构 A10（唯一） | 中 | 把第 3 格显式立成 **P1.5** 并指定完成标准与归属，否则 P2 到不了验收 |
| **C11** | 建议把 `KNOWN_TYPES` 从 `Set` 改成 `Record<AgentEvent["type"], true>`，让「忘了加」变成**编译期**错误——否则回滚完整性没有机械判据 | 验收 R11（唯一） | 中 | 作为 P0 的**第 0 步**（否则 V2 永远假绿） |

---

## 3. `(a) 蕴含 (b)` 的最终裁定（主理人点名攻的第 1 条）

**结论成立，理由不成立——两处都要改。**

- **成立的部分**：`surface_account` 落流后，上游 P0-b（「给出一个含插件的 tok/轮 数」）确实不必另建脚本。原因不是 `piecesTop`，而是 **`totalChars` / `toolSpecChars` 这两个总数**；读侧按 `scripts/prompt-cost.ts:29` 的 `CHARS_PER_TOKEN = 3.6` 折算，与既有 `2 501 tok/轮` 同口径可比。
- **不成立的部分（我原 §6 的论证）**：
  1. **`piecesTop` 的 12 件截断与 (b) 完全无关**——(b) 只要总数，「截断够不够」是**伪问题**（架构师称其为红鲱鱼）。
  2. **真正的缺陷是 E5 的两基混用**：降配轮的 `toolSpecChars/totalChars/piecesTop` 是**声明面**。24k 帽下**送出面** ≈≤6.7k token **恒 <10K**，所以「判 >10K 或 <10K」这一问**只有在读声明面时才有信息量**。不区分两基，读侧会算出 >10K，从而**误触发**上游 §7 的证伪行（「含插件真实面 >10K ⇒ 紧迫性上升」）。
- **最小修复**：字段分基落名——`declaredToolSpecChars` / `sentToolSpecChars`、`declaredToolCount` / `sentToolCount`；读侧脚本显式 import `CHARS_PER_TOKEN` 并在输出里标注基与系数（**Alt-C**：不要在读侧写第二份系数）。

---

## 4. 成员冲突：worker 是否过 `planSurfaceBudget`（主理人裁决）

- **架构师**：§4.1「主会话 / worker / 靶场 / 探针 / 暗卷都过这里」**成立**——依据是 `glm-session.ts:824–827` 的源码注释。
- **验收工程师**：**不成立**——`createWorkerProvider`（`orchestrator.ts:2466`）是**另一套 provider**，全仓 `planSurfaceBudget` 唯一生产调用点是 `glm-session.ts:828`。
- **我的裁决：验收工程师对，架构师沿用了过期的源码注释。** 复核证据：主理人实读 `orchestrator.ts:2466–2480`，`createWorkerProvider` 返回自建 `stream()` → `runOneRound()`，工具面来自 `workerToolSpecs()`，**不调用 `planSurfaceBudget`**；grep 复核 `planSurfaceBudget` 在 `src/` 下仅 `glm-session.ts:35`（import）+ `:829`（调用）+ `model-surface.ts:145`（定义）。
- **连带结论**：① 设计文档的覆盖面必须收窄为「走 session provider 的装配路径」（主会话 / gym 明卷暗卷 / probe）；② **worker 面与 sidechat 面本来就不受 24k 闸管**，这也意味着 **P1 改降配判据不会动到它们**（对 P1 范围有实质影响，需在 P1 开工前写明）；③ 源码注释 `glm-session.ts:824–827` 关于 worker 的那半句是**腐注释**，建议顺手登记（不属 P0 范围）。

---

## 5. 放行清单（Definition of Ready）

| # | 动作 | 类型 | 成本 |
|---|---|---|---|
| **G0** | `KNOWN_TYPES` 改 `Record<AgentEvent["type"], true>`（把「忘了加」变成编译期错误） | 前置改进 | 1 处，小 |
| **G1** | 改动清单写全 **4 处**：联合 / `KNOWN_TYPES` / `sidechat.ts` switch（显式 `return null`）/ `worker-projection.ts` 四桶之一 + 可选 `context.ts:316` 注释 | 文档+代码 | 小 |
| **G2** | 事件字段按 **declared / sent 分基落名**；`systemChars` 口径写明「只是首条 system，不含 memory/skills/地图/附件」 | 接口 | 小 |
| **G3** | 删掉或改名 `fixedChars` / `volatileChars`（恒 0 / 恒等的「说谎字段」） | 接口 | 小 |
| **G4** | 采样加「**面指纹变化**」一支；§4.3 对 PC1–PC4 的委托改成「合成门，不覆盖真实会话」 | 设计 | 小 |
| **G5** | **emit 失败语义二选一写明**（fail-open 推荐）+ fallback 不 close 共享句柄 | 设计+代码 | 小 |
| **G6** | `request` 改独立单调计数器（不复用 `successfulRequests`） | 代码 | 小 |
| **G7** | 落点约束写明「必须在 compaction 块之前」；体积上界按实重算并给出硬帽 | 设计 | 小 |
| **G8** | 覆盖面声明收窄；sidechat/worker 的「无读数」显式登记为已知缺口 | 文档 | 小 |
| **G9** | **Alt-A**（验收建议，我认可）：先只落 9 个字段（`request` / declared+sent 各两项 / `overChars` / `shortened` / `dropped` / `unresolvable`），**暂不落 `piecesTop`** ⇒ §1 四问与 (b) 全可答，单事件降到 ~120–200 B，体积争论消失；`piecesTop` 留到 P1 真做「按效用丢」时再加 | 设计 | 减负 |
| **G10** | 把上游 P0 第 3 格（工具选择靶场）立成 **P1.5** 并指定归属 | 计划 | 小 |

---

## 6. 我判定**不是问题**的（避免过度修）

| 项 | 判定 | 依据 |
|---|---|---|
| fallback 会让既有 gym 判据假红 | **不会**（我的 §8 担忧无对应判据） | 三份评审独立一致 + 主理人复核：gym 只读 `tool_call` 计数 / `usage` 求和 / verify / `changedFiles`、probe 只正则数 `"type":"compaction"`；按事件序列断言的测例全部走 mock/scripted provider，不过 `turnGenerator` |
| 目标文件在冻结面 | **不在**。`scripts/frozen-sha256.json` 66 项**全为 `fixtures/**`** | 安全 §一 + 架构 + 验收三方核对 |
| 加新类型会撞 exhaustive `never` | **不会**。所有事件类型消费者（`cli.ts`、`fork-cli.ts`、`tool-choice.ts`、`gym/draft.ts`、`sidechat.ts`）**全是 permissive `default:`** | 架构 A5 实读 |
| `projectContext` 会放进模型面 | **不会**（if-chain 无 default） | 安全 §一 + 架构 A9 + 验收；但保护点是 **V3 断言**，不是注释 |
| 旧 JSONL 重放会坏 | **不会**。`parseReplayLine` 只校验 `type` 是 string；事件 id 只追加不重编号 | 验收 C1–C3 |

---

## 7. 建议补进 V 表的判据（**全部未执行**，未经执行的测试只能列为计划）

| # | 判据 | 类型 |
|---|---|---|
| V1 | 未超帽轮次模型可见面与改动前**逐字节相同**（现成判据：`tests/model-surface.test.ts:44–49`、`scripts/model-surface-check.ts:140`） | 回归（复用） |
| V2（**改写**） | `pnpm typecheck` 绿（sidechat case 已补）+ `tests/stream-redaction.test.ts` 绿；**反向**：不登记桶 ⇒ 该判据必须红 | 判据 |
| V3（**扩展**） | 主会话 JSONL 尾追加一条 `surface_account` ⇒ `projectContext` **与 sidechat 只读投影**都逐字节不变 | 判据 |
| V4 | 旧 JSONL 重放 / 压缩 / prune / fork 逐字不变 | 回归 |
| V5 | gym/probe/暗卷路径能真落盘（fallback 生效，断言文件里读得到） | 判据 |
| V6 | 真实 desktop profile 抓 3 个会话，回答 §1 四问；**并留痕**（JSONL 片段 + 检索脚本 + 命中计数存 `outputs/<日期>-p0-readings/`） | 交付 |
| V7 | **顺序不变量**：含该事件的日志 `last.type === "compaction"` | 判据（复用/新增） |
| V8 | `emit` 抛错语义（按 G5 所选）；**不许静默** | 判据 |
| V9 | declared ≠ sent：60×1200 声明面 ⇒ 断言 `sentToolSpecChars < declaredToolSpecChars`；未降配轮断言两者相等 | 判据 |
| V10 | 面变小场景落不落事件、落几条（C3 修复后） | 判据 |
| V11 | 单事件字节数上界 + 「每轮都变」20 轮的条数上界 | 边界 |
| V12 | 零工具会话**不落事件**；读侧脚本对「无读数」显式输出（不得静默空输出） | 边界 |
| V13 | `request` 序号在首请求抛错后仍正确 | 异常 |
| V14 | `KNOWN_TYPES` 删任一项 ⇒ `typecheck` 红（G0 落地后） | 判据 |

---

## 8. 未执行与未覆盖（不得读成通过）

- **未执行**：任何 `pnpm test` / `typecheck` / `gates` / `gym-check` / 真实会话抓样 / `model-surface-check`。所有「红/绿」均为**静态推断**。
- **未复核**：设计文档 §2.2「68 个会话日志未发现 24k 降配记录」——**无留痕物证**（无路径、无脚本、无命中计数）。这是方案动机的核心事实，验收工程师判为 R8（中）。V6 必须补存证页。
- **未覆盖**：`apps/desktop` 与插件宿主的工具注入路径；desktop 渲染层对未知事件类型的处理（决定新事件是否需要 UI 侧登记）；会话导出/分享的数据分级口径（决定「工具名落盘」的影响上界）。
- **未审**：上游 §九自陈的安全面缺口——**laya 读攻击者可控的第三方工具描述**（其注入检测官方读数仅英文 0.698 / multilingual 0.578）。P3 会让本地模型消费 MCP/插件可控的描述；**P3 的立项前置必须补「注入面 + 压制/抬高攻击」评估**（被注入的描述可以压下 `verify`/`obs_recall` 等安全相关工具，或抬高近名仿冒工具），而不只是体积 + 精度 + ECE。
- **P2 的前置约束**（安全岗提出，我采纳）：必须写明「检索/清单工具的**候选池 = 当前权限档已过滤的面**，且拉取动作不得绕过 `gateToolSpecs`/`allowedTools`」——本仓自己点名过这个失败形状（`agent-runner.ts:707–720`：「规格面与执行面一起摘」，只摘一头就是「模型看得见却执行被拒」的镜像缺陷）。

---

## 9. 覆盖范围

技术方案评审团三位成员**全部返回**（coverage 3/3，无失败、无降级）。三份意见在 E1/E2/E3/E5/C1/C2/C3/C4 上**收敛**；唯一实质冲突是 **E4（worker 覆盖面）**，已由主理人裁决（见 §4）。成员原始结论未各自落盘为文件，本文是主理人核验后的统一交付。
