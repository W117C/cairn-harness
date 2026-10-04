# impact / map 接线取证 — HEAD `a6a87627`（2026-10-04）

只读取证。所有出处均为 **HEAD blob 的行号**（取料一律 `git show "${REV}:path"` / `git grep -n <pat> "$REV"`，未把工作树脏版本当现状）。
脏/净状态在末节逐文件标注。

判定：**通了**（两条能力各有模型可见出口 + 接线证人 + 变异锚点），带两处已核实的薄点（见第二节末、第四节）。

---

## 一、谁调用 impact / map：三条活链 + 一条，全部有人调，无死代码

**结论：`impact` 在 HEAD 上有三条活的调用链（写后回注＝每次写盘那一刻跑；`impact_query` 读端＝模型按需主动调；语义租约＝spawn 准入机械消费），`map` 有一条（会话首轮注入、压缩后重建一次）。都不是死代码，都不是"只在测试里跑"。**

调用链 A — 写后回注（触发时机＝**每个写工具成功的那一刻**，不是每轮）：

- `src/tools/write_file.ts:63` — `const output = await appendImpact(ctx, rel, summary + diag);`
- `src/tools/edit_file.ts:89` — 同一支（替换成功后）
- `src/tools/apply_patch.ts:288` — `if (diag !== "") output = await appendImpact(ctx, p.rel, output + diag);`
- `src/tools/base.ts:205` — `appendImpact` 本体；`src/tools/base.ts:199-201` 是 `ImpactHook` 类型
- `src/agent/impact/index.ts:523` — `defaultImpactHook`；`:525` `const r = await fileImpact(workspace, fileRel, cacheDir);`；`:470` `contextNoteFor`；`:529` 产 `type: "impact_report"` 事件
- 透传：`src/agent/loop.ts:64`（`impact?: ToolContext["impact"]`）→ `src/agent/loop.ts:489`（`...(opts.impact ? { impact: opts.impact } : {})`）
- 构造点（**唯一的活构造点**）：`src/main/agent-runner.ts:1723` — `const impactHook = opts.impactAnalysis === true ? defaultImpactHook(opts.workspace) : undefined;`，`src/main/agent-runner.ts:1756` 交给 `runLoop`
- 开关缺省＝**开**：`src/main/settings.ts:129` — `impactAnalysis: true`（字段声明 `src/main/settings.ts:83`）；生产入口读盘：`src/main/agent-runner.ts:2099` — `impactAnalysis: (await store().get()).impactAnalysis`

调用链 B — `impact_query` 读端（触发时机＝**模型按需**，动身前问「谁在调用它」）：

- `src/tools/impact-query.ts:155` / `:256-258` — 工具名 `impact_query` 与模型可见 description
- `src/main/agent-runner.ts:1726` — `createImpactQueryTool()`（同一个 `impactAnalysis` 开关）
- `src/main/agent-runner.ts:1742` — 规格面（模型清单）注入；`src/main/agent-runner.ts:1775` — 执行面实例注入（两面同源）
- worker 侧三处同源：`src/agent/orchestrator.ts:1812`（`const impactOn = this.opts.impactAnalysis === true;`）、`:1819`（specs）、`src/agent/worker-shell-tools.ts:250`（规格面）、`src/agent/worker-tool-table.ts:39-40`（实例面）、`src/agent/orchestrator-config.ts:42`/`:47-49`（白名单）
- `src/main/agent-runner.ts:334` — 编排器继承同一个设置位

调用链 C — 语义租约（**非模型面**，机械准入）：

- `src/main/agent-runner.ts:410` — `...(s.impactAnalysis ? { semanticLease: (globs: string[]) => affectedFilesOf(a.workspace, globs) } : {})`
- `src/agent/impact/index.ts:589` — `affectedFilesOf`

调用链 D — map（触发时机＝**首轮；压缩后重组装时再跑一次**）：

- `src/agent/glm-session.ts:736` — `const mapBuilder = opts.map === false ? null : opts.mapBuilder ?? createMapBuilder();`（缺省＝建，生产无人传 `map:false`：对 `src/main/`、`src/agent/loop.ts`、`src/agent/orchestrator.ts` grep `map: false|map: true|mapBuilder` **零命中**）
- `src/agent/glm-session.ts:930` — `buildMapText` 定义；`:931` — 闸 `if (!mapBuilder || historyForMap.length > 2) return null;` ⇒ **只有首轮**
- `src/agent/glm-session.ts:947` — `return mapInjectText(built);`；`:953` — 抛错支 `mapUnavailableText(why)`
- `src/agent/glm-session.ts:956` — 首轮调用；`:1047` — 压缩后重建；`:1052` — 进 `composeTurnMessages`
- `src/main/agent-runner.ts:13` — `import { buildMap }` 只服务演示通道（`:1834` 注释 `M2B_MAP_DEMO=1`），**不是**主路径；主路径是上面 glm-session 那一条
- 内部消费：`src/agent/map/build.ts:14` 吃 `render.js`（`renderMapBudget`，调用点 `src/agent/map/build.ts:380`）、`:13` 吃 `rank.js`、`:15` 吃 `retrieve.js`、`:16` 吃 `cap.js`、`:17` 吃 `../impact/coverage.js` ⇒ `map/render.ts` 不是孤块

历史缺口（已被上面闭合，不是今天状态）：`tests/impact-wiring.test.ts:3-5` 记着「`defaultImpactHook` 此前在 src/ 零调用者、sidechat 的 `impact_report` 投影是死代码」。

---

## 二、模型看不看得见：三条出口都有；但提示层零背书，`persist` 落盘只被读端消费

**结论：模型两侧都看得见。地图以 `role:"system"` 块出现；`impact_query` 在工具注册表里；写后波及摘要并进 `tool_result`。这一格不是「有计算、无使用」。**

出口 1 — system 块（地图）：

- `src/agent/glm-session.ts:592` — `composeTurnMessages`；`:627-631` — `if (opts.mapText) { msgs.push({ role: "system", content: "[符号地图] 仓库符号索引…" }) }`
- `src/agent/glm-session.ts:1052` — 真请求组装点；`src/events/index.ts:606` — `mapChars`（注释「首轮才注入，未注入记 0」）

出口 2 — 工具注册表（`impact_query`）：

- `src/agent/tool-surface.ts:29` — `{ name: "impact_query", specFace: "runtime", workerReachable: "both", reachableWhenReadOnly: true, mainSessionSideEffect: false }`
- `src/agent/model-surface.ts:59` — `PINNED_SURFACE_TOOLS = new Set(["skill", "obs_recall", "impact_query"])`（预算降配时最后才被丢）
- 面装配：`src/main/agent-runner.ts:1742`（规格）与 `:1775`（实例）

出口 3 — `tool_result`（写后回注）：

- `src/tools/base.ts:211` — `return base + "\n" + r.contextNote;`（摘要直接拼进工具输出）
- 摘要正文形状：`src/agent/impact/index.ts:470`（`contextNoteFor`）、`:506`（`[impact] … 波及 M 个文件` 那句）

两处已核实的薄点（**不构成「无出口」**）：

- **提示层零背书**：`src/agent/system-prompt.ts`、`src/agent/prompt-surface.ts`、`src/agent/plugins/`、`src/tools/index.ts` 四处对 `impact|影响面|符号地图|map_query` grep **零命中** ⇒ 模型对这两块的全部认知只来自 `impact-query.ts:258` 那一句工具说明书 + 首轮那一块地图正文；没有任何一句提示词教它「动身前先问影响面」。`impact_query` 也**不在静态 TOOLS 表**里（`src/tools/index.ts` 零命中），纯运行期注入 ⇒ 开关一关，模型面对这一格付零字节（这条纪律本身写在 `src/tools/impact-query.ts:9`）。
- **`persist.ts` 落盘这条支只有读端在消费**：`src/agent/impact/index.ts:169`（`if (opts.persistIndex === true)`）→ `:173-177` 调 `loadImpactIndex`/`saveImpactIndex`（`src/agent/impact/persist.ts:92`/`:152`）。开启点只有 `src/tools/impact-query.ts:177` 与 `:202`（`persistIndex: true`）。而写后回注那一支 `src/agent/impact/index.ts:525` 只传 3 个参数（`persistIndex` 为 undefined ⇒ `src/agent/impact/index.ts:169` 判假）⇒ 每次写盘都重新解析，持久索引热载在写后路径上**没被吃到**。`persist.ts` 本身不是死代码（读端在跑、`src/agent/impact/index.ts:17` 有 import）。

---

## 三、有没有判卷证人：钉的是**接线**，而且接线锚点成对（开/关双向）

**结论：有，且两侧都有真接线证人——证人断言的是「发出去的那次请求/那条 tool_result 里有没有这句话」，不是纯函数算得对。impact 与 map 各另有变异锚点专门杀死「模块在、中间那根线没人接」。**

impact 侧（三环，逐环递进，注释自陈分工）：

- `tests/impact-wiring.test.ts:1-5` — 工具级证人，**手搭** `ctx.impact`（`:31`），钉 `:56` `expect(r.output).toContain("[impact]")`；反向守卫 `:82` `not.toContain`。它自己承认看不见构造点（`tests/impact-runner-wiring.test.ts:5-6` 复述了这点）。
- `tests/impact-runner-wiring.test.ts:85` — `describe("影响面第三环：settings ⇒ 构造点 ⇒ 事件流（走真实 runAgent，不手搭 ctx）")`；走 `src/main/agent-runner.ts` 真入口（`tests/impact-runner-wiring.test.ts:20`、`:60`）。
  - 开：`:87` 标题「事件流里真有 impact_report，且摘要回进了 tool_result」，`:99` `expect(out, "事件发了但摘要没回注 = 模型侧仍看不见波及面").toContain("[impact]")` — **这就是「结果进上下文」那一钉**
  - 关：`:105`、`:114` 零事件、`:115` 写盘仍成功（防「根本没写盘」假绿）
  - 第四环：`:121-122`、`:151` 钉生产入口读 `settings.json` 那一行右半边（对应 `src/main/agent-runner.ts:2099`）
- worker 三处同源：`tests/worker-impact-query.test.ts:1-3`（「规格面/执行面/loop 白名单」），`:20` 反向钉「关着时三处一处都不加」（`it.each` 在 `:20`，三枚断言 `:21` 规格面／`:22` 执行面／`:23` 白名单）
- 读端可达性：`tests/impact-query.test.ts:204` `describe("可达性与成本不变量（「发货了没人接」的那类缺陷）")`

impact 侧变异锚点（HEAD `scripts/mutate-verify.mjs`）：

- `:5035` `runner-impact-hook-never-constructed` → 期望红 `tests/impact-runner-wiring.test.ts`
- `:5046` `runner-impact-hook-always-constructed`（成对：**不看设置位**也红 ⇒ 缺省零行为那条也守着）
- `:5700` `impact-analysis-settings-fallback-dropped`（`src/main/agent-runner.ts:2099` 那行改 `false` ⇒ 「设置界面那个开关是空的」）
- `:1553` `impact-query-spec-name-drift`（规格名改 `impact` ⇒ 「模型调 impact_query、工具表只有 impact」那类原罪）
- `:1833` / `:1841` / `:1849` worker 规格面 / 实例面 / 白名单三处各一枚

map 侧：

- `tests/map-turn-gate.test.ts:1-9` 自陈守的是 `src/agent/glm-session.ts:931` 那一支；`:66-67` `expect(seen[0]).toContain("[符号地图]")` + `toContain("MAP-BODY")`，`:70-71` 次轮两反向钉。`seen` 是**真实发给 transport 的整串消息**（`:43` 注入 builder、`:32` 起 `twoRequests` 发两次真请求、`:45` 把发出去的整串 messages 回读进 `seen`）⇒ 钉的是通道，不是纯函数。
- `tests/map-self-report.test.ts:5` 明写「加一条**接线**证人——地图文本要真的进到发出去的那次请求里，而不是只活在纯函数里」；`:99` `describe("接线：那两句要真的发出去")`，`:102`、`:104-105`、`:112-113` 逐句断言。
- map 侧变异锚点：`:9242` `map-turn-gate-bound-loosened`（`> 2` 改 `> 200` ⇒ 红）、`:9254` `map-turn-gate-prints-degradation`（把「没有这一位」改成「送一句降级说明」⇒ 红，两枚各咬一半）、`:9221` `map-self-report-dropped`、`:9215+16` `map-candidates-denominator-lost`
- 门：`scripts/gate-manifest.ts:24` 列 `map-check`（`scripts/map-check.ts:1` 「M2b 符号地图明卷」）；`scripts/gate-manifest.ts:81` 登记 `impactAnalysis: true` 是**默认开着**的付账对象。
- 纯函数证人也在（`tests/impact.test.ts`、`tests/map-parse|map-rank|map-render|map-build` 等），但**不是只有这类**——上面那些接线的钉子是分开的另几格。

缺口（未证到的部分，如实标出）：

- **没有一枚证人钉「map 用的是真的缺省 `createMapBuilder()`」**：`tests/map-turn-gate.test.ts:43` 与 `tests/map-self-report.test.ts` 都注入**假 builder**，而 `src/agent/glm-session.ts:736` 的 `opts.mapBuilder ?? createMapBuilder()` 那右半边、以及「生产装配点没人传 `map:false`」这件事，我只在 src/ 的 grep 零命中上确认了**当前为真**，没有判卷能在此链接被删时变红（对 `scripts/mutate-verify.mjs` grep `createMapBuilder|opts.map|mapText` **零命中**）。⇒ 这一格是「现读通了，但没证人」。
- `map-check` 未进 CI 门面的原因见 `scripts/gate-manifest.ts:169`/`:187`（53.0s 超线），属耗时取舍不是接线缺口。

---

## 四、要把这一格更彻底地接通到模型面前：最小改动

现状已是「通了」，所以最小改动只剩三件**收口**动作，按性价比排序：

1. **提示层补一句「动身前先问影响面」**（补第二节的「零背书」）
   - 文件：`src/agent/system-prompt.ts` — 加一行工具使用指引（`impact_query` 的名字与只读属性照抄 `src/tools/impact-query.ts:258`）。
   - 脏状态：**CLEAN**（不在 `git status --porcelain` 里）。
   - 配套判卷：现有证人不会因这句变红，需要新尺的话落在 `tests/cli-surface.test.ts` / `tests/tool-surface-parity.test.ts` 那一族。**这两份都没读**，故此处标 **未证**（缺一步：先确认哪把尺守系统提示文本）。

2. **让写后回注那条支也吃到持久索引**（补第二节的 `persist` 不对称）
   - 文件：`src/agent/impact/index.ts:525` — `fileImpact(workspace, fileRel, cacheDir)` → 补第 5 位 `persistIndex`（签名在 `:417-423`，判定在 `:169`，落盘在 `:173-177`）。
   - 脏状态：**DIRTY（在隔壁手里，等让位）** — `git status --porcelain -- src/agent/impact/index.ts` 报 ` M`；`src/agent/impact/persist.ts` 同为 ` M`。
   - 代价口径：`tests/impact-persistence.test.ts:161` 钉的正是「`persistIndex` 缺省 false ⇒ 一字节都不落盘（反作弊对照）」——翻这个缺省会撞那把尺，属于改判据，不是改接线。

3. **给「map 走真缺省 builder」补一枚接线证人**（补第三节的唯一缺口）
   - 文件：`src/agent/glm-session.ts`（不改代码，只现读 `:736` 那一支）+ 新增/扩展 `tests/map-turn-gate.test.ts`：加一格**不注入 `mapBuilder`**、只给一个真临时 workspace 的请求，断言 `seen[0]` 含 `[符号地图]`；再给 `scripts/mutate-verify.mjs` 加一枚锚点（把 `opts.mapBuilder ?? createMapBuilder()` 改成 `opts.mapBuilder`）。
   - 脏状态：`src/agent/glm-session.ts` = **CLEAN**；`tests/map-turn-gate.test.ts` = **CLEAN**；`scripts/mutate-verify.mjs` = **DIRTY（在隔壁手里，等让位）**。
   - 注意：`src/agent/map/build.ts`、`src/agent/map/render.ts` 都是 **DIRTY**，这一格虽不直接改它们，但真 builder 会穿过去，跑判卷时会读到隔壁的半成品。

本轮**未跑**任何判卷 / `typecheck` / `scripts/*.ts` 门 / `mutate-verify`（认证窗在隔壁）。以上全部为 HEAD blob 静态取证。
