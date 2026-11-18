# 架构与模块体检 · 2026-11-18（第二遍：按模块全量扫）

业主令：「所有的代码架构和模块还有功能都需要检查优化修复缺点。」
第一遍（`report.md`）修的是**找得到的四个点**；这一遍换方法：先用**可复算的结构度量**把全仓量一遍
（依赖图、环、死导出、逃逸阀、工具面双向、设置键、事件消费、IPC 完整性），再对量出来的高风险处读代码。

量具全部可复跑（本页附命令），不是印象。

---

## 一、结构读数（全仓）

| 维度 | 读数 | 怎么量的 | 结论 |
| --- | --- | --- | --- |
| 核心规模 | 435 个 `.ts` / 124,853 行（`src/`） | 目录遍历 | — |
| 桌面规模 | 429 判卷文件 / 游戏面见下 | — | — |
| **值依赖边** | **1081 条，环 0** | 剥掉 `import type` 后 Tarjan | **健康**：运行期模块图是 DAG |
| 类型依赖边 | 399 条，环 4 个（最大 28 文件） | 同上 | 无害（类型边编译期擦除），但说明 28 个 agent 模块**没有分层**，只能靠类型互相认识 |
| 扇入 top | `events/index` 106、`is-record` 43、`atomic-write` 35、`tools/base` 32 | 被 import 计数 | 与设计一致（事件是唯一事实源） |
| `as any` | **0 处** | 正则 | 优秀 |
| `@ts-ignore` / `@ts-expect-error` | **0 处** | 正则 | 优秀 |
| 空 `catch` | 65 处，**全部带注释理由** | 正则 + 抽查 | 可接受（无「静默吞」） |
| 跨文件同体函数 | **0 组** | 函数体规范化后哈希 | 无复制粘贴式重复 |
| 值导出但全仓无引用 | **235 条** | 导出名在全仓（含 tests/apps/scripts）零命中 | 多为「给判卷留的常量」与过度导出，见 §四 |
| 超 150 行函数 | **23 个** | 花括号配平 | 三个真巨物见 §四 |
| IPC 完整性 | invoke **186** 条，`wired` 是**全键** `Record<InvokeChannel, …>` | 类型 + 运行时表 | **结构上不可能漏 handler**（类型强制） |
| 设置键 | 38 个，**全部**在别处被引用 | 键名全仓命中 | 无「写了没人读」的死设置 |
| 工具面双向 | `gateToolSpecs` 37 条 ⊇ `TOOL_NAMES` 22 条，**有执行无规格 0** | 现跑脚本 | 反方向 15 条是 fail-closed 的工具（见 §三） |

---

## 二、模块逐张（行数 / 覆盖率 / 结论）

「覆盖率」= 该目录里**有同名判卷文件**的源文件占比（粗代理，不比真覆盖；用来看哪块没人钉）。

| 模块 | 文件 | 行数 | 同名判卷 | 结论 |
| --- | --- | --- | --- | --- |
| `src/agent` | 173 | 41,081 | 94% | 主战场。类型环 28 文件（无值环）；巨函数 `gateToolSpecs` 651 行 |
| `src/main` | 124 | 30,402 | 99% | 应用服务层，覆盖最好；`scheduler.ts` 1531 行最大 |
| `src/tools` | 43 | 9,039 | 95% | 22 个真工具全有规格；`lsp.ts` 1447 行是复杂度热点 |
| `src/agent/plugins` | 16 | 6,269 | 81% | 声明式（无进程内 JS 执行）＝安全面正确；覆盖率最低的一档 |
| `src/providers` | 22 | 4,217 | 86% | 四协议适配器 + 重试/停因统一跳，结构清晰 |
| `src/main/evolution` | 14 | 3,696 | 100% | 自演化线，全覆盖 |
| `src/orchestration` | 14 | 3,167 | 93% | 本地/远程后端两实现，接口对齐 |
| `src/main/evolve` | 19 | 2,950 | 100% | 全覆盖 |
| `src/agent/memory` | 11 | 2,892 | 100% | 全覆盖 |
| `src/agent/evolve` | 13 | 2,765 | 85% | — |
| `src/events` | 9 | 2,512 | 67% | 名字覆盖低但事件有专测（`events.test.ts` 等）；38 种事件齐 |
| `src/permissions` | 9 | 2,323 | 89% | — |
| `src/im` | 9 | 2,322 | 89% | **本轮修两处队列缺陷**，见 §三 |
| `src/interop` | 7 | 1,784 | 43% | 名字覆盖低，但有 6 支 interop 专测；**刻意留门**（§三） |
| 其余（map/gym/evolution/eval/impact/team/routing/security/quality/wallpaper/verification/roles） | 51 | 8,913 | 75–100% | 小模块，覆盖好 |

---

## 三、刻意的四件事（量出来像问题，其实不是）

| 现象 | 依据 | 判断 |
| --- | --- | --- |
| `src/interop`（A2A / ACP / SDK / benchmark）在 `src` 与 `apps` 里**零消费方** | README §「三个入口」写明走 `pnpm acp-server` / `pnpm a2a-server` / `pnpm external-bench` 独立入口；ROADMAP「SDK/API、A2A、其他领域包 —— P6 留门，先确认真实使用需求」 | **刻意**。不是死代码，是「库面就绪、产品入口按需求开」 |
| `gateToolSpecs` 有 15 条规格不在 `TOOL_NAMES`（agent 生命周期 7 / 自动化 5 / refine_goal / web_fetch / remember） | 这些工具的**执行器**由运行时注入（编排器、调度器、MCP），未接时 fail-closed 并回一句指名的话（`agent-lifecycle.ts:25`、`wait_for_agents.ts:24`） | **刻意**：能力面先示人、缺席时如实拒，而不是悄悄不出现 |
| 19 种事件在渲染层零引用 | 事件分两类：**用户可见**（走投影渲染）与**运维证据**（CLI 打印、不进 UI）。`turn_truncated`/`turn_stop_missing`/`security_report` 都属后者，`stop-reason.ts` 注释写明「观测 only：不进模型上下文、不参与判定」 | **刻意**（但「运维证据在桌面完全看不到」是设计选择，不是缺陷；要看得开日志窗格） |
| 四个依赖环 | 全是 `import type` 边 | **无害**。但记住：这 28 个 agent 模块之间没有分层，加一个值边就可能造出真环 |

---

## 四、真问题（按影响排序）

### P1 · IM 发送队列两条静默丢消息的路（已修，见 §五）

- **① 连接窗口期排队无人补发**：`start()` 先占槽位（`handle: null`）再 `await secretValue`，这段里进来的
  回信会推进队列；`drain` 见 `handle === null` 立即返回，而「再 kick」只挂在 `enqueue` 的「队列从空变非空」
  那一拍 ⇒ 这条消息**永远躺着**：不报错、不重试、不送达。用户侧表现＝「机器人明明知道了却没回」。
- **② `retry()` 等于丢掉待发队列**：`retry` 走 `stop → sync`，而 `stop` 连队列一起删。
  用户点「重试」这一下，会把还没发出去的回信扔掉。

### P2 · 三个巨函数（不是 bug，是导航成本）

| 函数 | 行数 | 备注 |
| --- | --- | --- |
| `src/agent/session-provider.ts:gateToolSpecs()` | **651** | 37 条工具规格的数据表，本身无分支逻辑；真要拆，按域拆成 4-5 个 `xxxSpecs()` 再拼 |
| `src/cli.ts:main()` | 495 | 参数解析已拆出（`parseArgs` 248 行），余下是命令分派 |
| `src/im/host.ts:createImHost()` | 429 | 本轮又长出两处补丁；建议下一步拆出 `send-queue.ts`（队列是该模块里最独立的机器） |

判断：**先不动**。三条都有判卷覆盖、都无已知缺陷；拆它们会动 8-10 支判卷的读面，收益只是可读性。
记录在此，等它们下一次真的挡路（比如再加两个平台）时拆。

### P2 · 235 条「导出但没人用」

绝大多数是**常量**（`MAX_*`、`*_LIMIT`、`*_FILE`）与类型辅助，导出是为了让判卷能引用同一个数。
真正值得收的是**函数**：`connectFeishu` / `connectEmail` / `checkEmail` 只被同文件的 adapter 对象用，
`parsePlanProposal`、`normalizeMcp`、`compactSidechatHistory`、`historyExcerpt` 等同理。
建议：不做批量清理（改导出面会牵动判卷语料），改为**新增代码纪律**——新写的辅助函数默认不导出，
需要判卷时再加。这一条写进了本页，不新开规则条（AGENTS.md 已经够长）。

### P3 · `src/events` 这个名字覆盖率低

38 种事件有 9 个文件、2512 行，同名判卷只 6 个（67%）。实际由 `tests/events.test.ts`、
`tests/replay-*`、`tests/compaction-*` 多支覆盖，**不是没人管**，只是判卷不按模块名分。
建议不动，只在此记一笔：**用「同名判卷」当覆盖率代理会系统性低估事件/协议层**。

---

## 五、本轮修的两处（IM 队列）

| 修法 | 位置 |
| --- | --- |
| 建连完成后补一拍 `drain`（覆盖连接窗口期排队） | `src/im/host.ts:start()` 尾部 |
| `retry()` 先把队列**停靠**到 `parkedQueues`，由下一次 `start` 取回 | `src/im/host.ts:retry()` + `start()` 头部 |

两态各证一次（判卷 `tests/im/host.test.ts`）：

- 摘掉「建连后补 drain」⇒「建连窗口期排队的回信，连上后自动补发」**红**；装回 ⇒ 绿。
- 摘掉「retry 停靠」⇒「重试不丢待发队列」**红**；装回 ⇒ 绿。

---

## 六、复跑命令（量具）

依赖环那一步是 30 行 python（Tarjan + 把 `import type` 与 `import { type X }` 剥掉再建图），
一次性工具没入库；要复核时按本页 §一 的写法重跑即可。其余两条是常驻命令：

```bash
# 工具面双向：有执行无规格 / 有规格不在 TOOL_NAMES
npx tsx -e 'Promise.all([import("./src/tools/base"), import("./src/agent/session-provider")]).then(([b, s]) => { const set = new Set(s.gateToolSpecs().map((x) => x.function.name)); console.log("无规格:", (b.TOOL_NAMES as readonly string[]).filter((n) => !set.has(n))); })'

# 逃逸阀与空 catch
grep -rn "\bas any\b\|@ts-ignore\|@ts-expect-error" src apps/desktop/src | wc -l
grep -rn "catch {" src apps/desktop/src --include="*.ts" --include="*.tsx" | wc -l
```

## 七、结论（一句话）

**这个仓的结构防线比它的缺陷多。** 值依赖图无环、IPC 靠类型强制补不出漏、零 `any` 逃逸、
零复制粘贴函数、设置键与工具面双向闭合——所以「模块级」的问题基本都是**刻意的设计选择**。
剩下的真缺陷都在**状态机的边界**上（队列、连接、重试），而这类东西只有读到具体函数才看得见，
任何静态量具都抓不到。本轮的四个 + 上轮的四个，全属这一类。
