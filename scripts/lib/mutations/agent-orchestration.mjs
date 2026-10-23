// agent-orchestration 域的变异配置条目（2026-10-17 从 scripts/mutate-verify.mjs 按域拆出，见 PROGRESS 第 501 页）。
// 每条 = 一处语义突变 + 期望被它杀死的具体用例标题。追加条目时放进对应域的文件；
// **组间顺序不影响任何判据**（每条独立），同一文件内保持原顺序以便 diff。
export const MUTATIONS = [
  {
    id: "user-agent-duplicate-name-silent-override",
    src: "src/agent/roles/user-agents.ts",
    test: "tests/user-agent-roles.test.ts",
    desc: "两个来源同名时静默覆盖 ⇒ 用户改了文件却没生效，而且没人吭声（清单与查找还各自剩一条）",
    apply: (s) => s.replace("      if (hit !== undefined) {", "      if (false) {"),
    expectFail: "同名冲突：DSH 自己的目录赢，并点名被盖住的那条路径（静默覆盖=改了没生效）",
  },
  {
    id: "unknown-role-error-hides-user-form",
    // 针脚随实现搬家（2026-10-17 三缝拆分）：resolveStageRole 整支搬到 orchestrator-approvals.ts，锚文逐字未动。
    src: "src/agent/orchestrator-approvals.ts",
    test: "tests/worker-role.test.ts",
    desc: "未知角色的报错少列一种合法形态 ⇒ 猜错名字的模型被告知「这条路不存在」，而它本来写得对",
    apply: (s) => s.replace("plugin-name:agent-name / user:agent-name 形态", "plugin-name:agent-name 形态"),
    expectFail: "未注册的角色出声拒：不落 agent_spawned、不建 worker，并指回缺省行为",
  },
  {
    id: "spawn-receipt-hides-in-flight-and-cap",
    src: "src/agent/orchestrator.ts",
    test: "tests/cancel-agents-tool.test.ts",
    desc: "回执不报在途数与上限 ⇒ 「还要不要再拆一个」只能凭感觉，撞到 MAX_CONCURRENT_WORKERS 才知道有闸",
    apply: (s) => s.replace("        in_flight: this.inFlightAgents().length,\n        worker_cap: MAX_CONCURRENT_WORKERS,", ""),
    expectFail: "spawn 回执把在途数与上限摆在模型面前（不报价位就只能凭感觉拆）",
  },
  {
    id: "join-timeout-note-names-phantom-tool",
    src: "src/agent/orchestrator-join.ts",
    test: "tests/cancel-agents-tool.test.ts",
    desc: "超时提示回到「可再 cancelAgent」——那是编排器的方法名，模型面上没有 ⇒ 文案给一扇不存在的门",
    apply: (s) => s.replace("可再 wait_for_agents 或 cancel_agents", "可再 wait_for_agents 或 cancelAgent"),
    expectFail: "超时提示里的取消通道 = 模型面上真有的那个工具名（幻影门第 N 次复发）",
  },
  {
    id: "supervise-unknown-key-silently-ignored",
    src: "src/agent/supervise-contract.ts",
    test: "tests/supervise-contract.test.ts",
    desc: "笔误键被静默吃掉 ⇒ 模型申报了禁改面、实际一面都没禁（申报了却没生效比少个字段更坏）",
    apply: (s) => s.replace("  if (unknown.length > 0) {", "  if (false) {"),
    expectFail: "笔误键必须点名并列出资格上的合法键 —— 静默吃掉 = 申报了却没生效",
  },
  {
    id: "supervise-budget-ownership-note-lost",
    src: "src/agent/supervise-contract.ts",
    test: "tests/supervise-contract.test.ts",
    desc: "拒 budget 时不说「归人」⇒ 模型以为换个写法就能申报，而钱闸归谁这句话消失了",
    apply: (s) => s.replace("    const owned = unknown.includes(\"budget\")", "    const owned = false"),
    expectFail: "申报 budget ⇒ 拒，并说清这条闸归人（模型不能给自己开预算）",
  },
  {
    id: "supervise-forbidden-type-error-swallowed",
    src: "src/agent/supervise-contract.ts",
    test: "tests/supervise-contract.test.ts",
    desc: "forbidden 形状不校验 ⇒ 字符串/混型进来变空列表 = 没有禁改面，而回执上看不出来",
    apply: (s) => s.replace("    if (!Array.isArray(o.forbidden) || o.forbidden.some((x) => typeof x !== \"string\" || x.trim() === \"\")) {", "    if (false) {"),
    expectFail: "forbidden 不是字符串数组 ⇒ 拒（旧口径 parseStringList 会把混进来的数字静默丢掉）",
  },
  {
    id: "semantic-admission-never-reports",
    src: "src/agent/lease-conflicts.ts",
    test: "tests/impact-admission.test.ts",
    desc: "语义波及相交不再上报（B1 退化回「只看 glob」：两个 worker 各改各文件却波及同一批调用点，合并时才打架）",
    apply: (x) => x.replace('if (shared.length > 0) out.push({ agentId: w.agentId, resource: "波及 " + shared.join("、") });', 'if (false) out.push({ agentId: w.agentId, resource: "波及 " + shared.join("、") });'),
    expectFail: "utils.js × math.js：glob 不相交，波及集相交 ⇒ 语义闸报冲突",
  },
  {
    id: "semantic-admission-guard-removed",
    src: "src/agent/lease-conflicts.ts",
    test: "tests/impact-admission.test.ts",
    desc: "去掉「未接钩子 / 空声明 / 无 worker」前置（impactAnalysis 关闭时 spawn 会被 undefined 钩子炸掉）",
    apply: (x) => x.replace("if (!hook || resources.length === 0 || workers.length === 0) return [];", "if (resources.length === 0 || workers.length === 0) return [];"),
    expectFail: "未接钩子 / 无声明 / 无活跃 worker ⇒ []（零行为 = 连 warn 噪声都没有）",
  },
  // ---- 门 0（ipc-reachability）：可达性棘轮的解析面 ----
                    // ---- worker 上下文预算认模型（1e85544）----
  {
    id: "worker-budget-window-ignored",
    src: "src/agent/orchestrator-config.ts",
    test: "tests/worker-budget.test.ts",
    desc: "worker 预算不再采信模型窗口（256k/1M 档仍按硬编码 128k 提前压缩 = 多烧一次摘要 + 白丢冷细节）",
    // 针脚改指（2026-10-02 修）：`4c10272`（P3 输出预留跟着窗口缩）把"窗口是否采信"从
    // `budgeted !== base` 这条**推断**改成了显式谓词 `windowUsable`（那边注释记着理由：
    // `withModelBudget` 现在对任何正窗口都返回新对象 ⇒ 同一性推断失效）。
    // 意图一字不变：不采信窗口 ⇒ 退回 `base`。
    apply: (s) => s.replace("const budgeted = windowUsable ? withModelBudget(base, window) : base;", "const budgeted = base;"),
    expectFail: "窗口比基线大 ⇒ 抬到真实窗口（256k 档不再按 128k 提前压缩），worker 专属 ratio 保留",
  },
  {
    id: "worker-budget-clamp-removed",
    src: "src/agent/orchestrator-config.ts",
    test: "tests/worker-budget.test.ts",
    desc: "去掉「显式覆盖绝不超出模型窗口」的钳制（超窗请求发给远端吃 400，本地 fail-closed 失效）",
    // 针脚改指（2026-10-02 修）：同上一支，判据由 `budgeted !== base` 换成显式谓词 `windowUsable`；
    // 意图不变：拿掉钳制 ⇒ 原样返回 `merged`。
    apply: (s) => s.replace("return windowUsable ? { ...merged, inputLimit: Math.min(merged.inputLimit, budgeted.inputLimit) } : merged;", "return merged;"),
    expectFail: "显式覆盖超出模型窗口 ⇒ 本地钳到窗口（超窗必吃远端 400，fail-closed 不留给远端）",
  },
  {
    id: "worker-budget-handle-window-lost",
    src: "src/agent/orchestrator.ts",
    test: "tests/worker-budget.test.ts",
    desc: "spawn 处不把 spec 的 ctxWindow 写进 handle（纯函数与调用点断线：路由选到 strong 档，worker 预算照旧 128k）",
    apply: (s) => s.replace("      ...(routedSpec ? { modelCtxWindow: routedSpec.ctxWindow } : {}),\n", ""),
    expectFail: "路由选中 strong 档 ⇒ handle 带该档 ctxWindow（无需 registry 二次查名）",
  },
  // ---- 会话成本闸（§4.4.8 BYOK 底线）的估价来源 ----
  {
    id: "session-budget-table-fallback-dropped",
    // 针脚随实现搬家（2026-10-17 三缝拆分）：budget 域整箱搬到 orchestrator-budget.ts，锚文逐字未动。
    src: "src/agent/orchestrator-budget.ts",
    test: "tests/m3c.test.ts",
    desc: "单价缺省时不再查内置价表（估价恒 0 ⇒ 用户只设 maxBudgetUsd 的常见配置下，spec 的 BYOK 底线静默失效）。针脚必须指**给钱的那一行**：上一版指相邻的 budgetRateKnown 早退，那行删掉行为不变（spentUsdFor 自己就 null→0），变异当场存活",
    apply: (s) => s.replace("    return bucketsSpendUsd(this.budgetBuckets());", "    return null;"),
    expectFail: "成本闸没填单价 ⇒ 按内置价表分列估价（用户只设 maxBudgetUsd 就该拦住，不是恒 0）",
  },
  // ---- 09-23「每桶按自己那一档折」新增的三格（同一把尺的三个组成面）----
  {
    id: "budget-worker-buckets-dropped",
    // 针脚随实现搬家（2026-10-17 三缝拆分）：计价桶整箱搬到 orchestrator-budget.ts。
    src: "src/agent/orchestrator-budget.ts",
    test: "tests/session-spend-ruler.test.ts",
    desc: "worker 桶全被当成「不产生真钱」跳过 ⇒ 上限只按主会话那一小段算，派活越多越拦不住",
    apply: (s) => s.replace("        realMoney: w.price !== null,", "        realMoney: false,"),
    expectFail: "会话档=flash、worker 档=standard：worker 一份重活就把上限花完 ⇒ 下一次 spawn 被拒",
  },
  {
    id: "budget-worker-priced-at-session-tier",
    // 针脚随实现搬家（2026-10-17 三缝拆分）：桶的价键改指 orchestrator-budget.ts。
    src: "src/agent/orchestrator-budget.ts",
    test: "tests/session-spend-ruler.test.ts",
    desc: "worker 桶改按**会话那一档**计价（= 旧尺换了个位置）⇒ 便宜档 worker 被贵档顶死，上限早触发白停",
    apply: (s) => s.replace("        price: w.price ?? null,", '        price: priceForModel(b?.priceModel ?? ""),'),
    expectFail: "反向那一半：worker 档比会话档便宜 ⇒ 尺跟着降，不再把便宜档的 token 按会话价高估到白拦",
  },
  {
    id: "budget-main-bucket-never-accumulated",
    src: "src/agent/orchestrator.ts",
    test: "tests/session-spend-ruler.test.ts",
    desc: "拆桶时把主会话那一段漏掉（只统计带 agent_id 的）⇒ 闸只看得到 worker，主 loop 烧的钱不进账",
    apply: (s) => s.replace("          if (e.agent_id === undefined) {", "          if (false) {"),
    expectFail: "主会话那一桶与 worker 那一桶各算一次：不漏 main，也不因为拆桶而双计",
  },
  // ---- #97：用户自定义子代理的 CC 连字符字段名必须被那一份投影读到（此前 `allowed-tools` 落进未知键被丢）----
  {
    id: "role-alias-allow-not-read",
    src: "src/agent/sequencer.ts",
    test: "tests/role-field-aliases.test.ts",
    desc: "别名退回只认驼峰 ⇒ CC 写法的白名单被当未知键丢弃，角色**按默认面**跑＝静默比声明更宽的工具面",
    apply: (s) => s.replace('  const tools = readToolListField(fm, "tools", "allowed-tools", "intersect", warnings);', '  const tools = parseToolList(fm.tools);'),
    expectFail: "真跑起来：模型每轮拿到的规格面恰好是声明的那两把，且比默认面只缩不涨",
  },
  {
    id: "role-field-conflict-silent",
    src: "src/agent/sequencer.ts",
    test: "tests/role-field-aliases.test.ts",
    desc: "两种写法值不同却不自称相等 ⇒ 静默择一（本仓唯一允许的收法是保守面交集＋点名，不然是「看着生效实际另一份在跑」）",
    apply: (s) => s.replace("  const same = primary.length === aliased.length && primary.every((x) => aliased.includes(x));", "  const same = true;"),
    expectFail: "tools 与 allowed-tools 值不同：警告点名两个键与两个值，并按保守面（交集）收",
  },
  {
    id: "budget-unpriced-tokens-swallowed",
    src: "src/agent/orchestrator-join.ts",
    test: "tests/session-spend-ruler.test.ts",
    desc: "算不出价的 token 数被吞（仍不折成 $0 计入美元）⇒ 调用方拿不到「闸可能晚于实际上限」的读数，也就不会出声",
    apply: (s) => s.replace("      unpricedTokens += tokens;", "      unpricedTokens += 0;"),
    expectFail: "真实但价不可知的一桶：不折成 $0，token 计入 unpricedTokens，已知的部分照算",
  },
  {
    id: "session-budget-inert-silent",
    // 针脚随实现搬家（2026-10-17 三缝拆分）：budgetBlocked 整支搬到 orchestrator-budget.ts。
    src: "src/agent/orchestrator-budget.ts",
    test: "tests/m3c.test.ts",
    desc: "「估不出价所以闸不生效」不再出声（用户设的成本底线悄悄不存在，且读日志的人也拿不到模型名）",
    apply: (s) => s.replace("      if (!this.budgetInertWarned) {", "      if (false) {"),
    expectFail: "单价填了仍以单价为准（旧语义逐字保留）；估不出价 ⇒ 不拦但出声一次，不拿 $0 冒充实付",
  },
  {
    id: "orchestrator-prompt-cache-not-plumbed",
    src: "src/agent/orchestrator.ts",
    test: "tests/prompt-cache-breakpoints.test.ts",
    desc: "路由分支合成模型时不把开关交给分派层（断点逻辑全对，但没有任何调用方能打开它 = 又一次「发货了没人接」）",
    apply: (s) => s.replace("toWorkerModel(routedSpec, this.opts.promptCache === true ? { promptCache: true } : {})", "toWorkerModel(routedSpec)"),
    expectFail: "开 promptCache ⇒ worker 出网的请求体里确有 cache_control（能力真可达，不是纸面开关）",
  },
  {
    id: "worker-impact-spec-not-appended",
    src: "src/agent/worker-shell-tools.ts",
    test: "tests/worker-impact-query.test.ts",
    desc: "worker 规格面不再追加 impact_query（执行表里有、模型看不到 ⇒ 又是一次「能力已发货、模型面不可见」，本仓第 4 例）",
    apply: (s) => s.replace("  const extras: GlmToolSpec[] = opts.impactAnalysis === true\n", "  const extras: GlmToolSpec[] = false\n"),
    expectFail: "read 档：开关开启时规格与实例同名同时出现，白名单同步",
  },
  {
    id: "worker-impact-instance-not-attached",
    src: "src/agent/worker-tool-table.ts",
    test: "tests/worker-impact-query.test.ts",
    desc: "只挂规格不挂实例（模型调了就 unknown tool；反向的两头断同样致命）",
    apply: (s) => s.replace("  if (opts.impactAnalysis === true) {\n", "  if (false) {\n"),
    expectFail: "开关开启时执行面真的挂着 impact_query 实例（不是只有规格——「模型看得见、一调就 unknown tool」）",
  },
  {
    id: "worker-impact-whitelist-not-appended",
    src: "src/agent/orchestrator-config.ts",
    test: "tests/worker-impact-query.test.ts",
    desc: "白名单忘了追加（规格与实例都挂上了，却被 loop 的 allowedTools 硬闸摘掉 ⇒ 模型一调就「不在本会话工具表」——三重闸各自为政）",
    apply: (s) => s.replace("  return impactAnalysis ? [...base, WORKER_IMPACT_TOOL] : base;\n", "  return base;\n"),
    expectFail: "read 档：开关开启时规格与实例同名同时出现，白名单同步",
  },
  {
    id: "worker-role-budget-not-applied",
    src: "src/agent/worker-prompt.ts",
    test: "tests/worker-role-budget.test.ts",
    desc: "角色块不收窄 ⇒ 插件 agents/*.md（或 spawn_agent 传入）整篇文档作为 system 首块，且它永不进摘要输入 ⇒ 每个 worker 每轮付费",
    apply: (s) => s.replace("clampToTokenBudget(w.roleDefinition, WORKER_ROLE_TOKEN_BUDGET, \"worker 角色定义\")", "w.roleDefinition"),
    expectFail: "200KB 的插件角色定义被收到预算内，且任务书仍在最后一条 user 里",
  },
  {
    id: "worker-role-budget-zeroed",
    src: "src/agent/worker-prompt.ts",
    test: "tests/worker-role-budget.test.ts",
    desc: "预算写死 0 ⇒ 内置角色也被掐头（一两百 token 的角色定义被截成空壳），worker 的 verdict 纪律整段丢失",
    apply: (s) => s.replace("export const WORKER_ROLE_TOKEN_BUDGET = 2000;", "export const WORKER_ROLE_TOKEN_BUDGET = 0;"),
    expectFail: "内置角色逐字进首块（零回归）",
  },
  {
    id: "worker-report-cjk-count-collapsed",
    src: "src/agent/worker-report.ts",
    test: "tests/worker-report-clip.test.ts",
    desc: "报告裁剪退回 chars/4 ⇒ 中文 worker 报告留 cap*4 字符（≈4× cap token），主会话每轮都要重付这份虚高",
    apply: (s) => s.replace("const out = truncateToTokenBudget(text, capTokens, notice);", "const out = text.length <= capTokens * 4 ? text : text.slice(0, capTokens * 4) + notice;"),
    expectFail: "超预算的中文报告截完真的 ≤ 预算，且提示行计入预算",
  },
  {
    id: "worker-report-truncated-flag-lies",
    src: "src/agent/worker-report.ts",
    test: "tests/worker-report-clip.test.ts",
    desc: "truncated 恒报 false ⇒ 上层以为拿到的是完整报告（面板与主会话据此判断 worker 有没有说清楚）",
    apply: (s) => s.replace("return { text: out, truncated: out !== text };", "return { text: out, truncated: false };"),
    expectFail: "超预算的中文报告截完真的 ≤ 预算，且提示行计入预算",
  },
      // ---- W1a 收队（spec §3 / 计划 Task 1–5）：三段帽 + 等待边界 + 工具 fail-closed + 静态门自身 ----
  {
    id: "join-row-cap-not-counted",
    src: "src/agent/orchestrator-join.ts",
    test: "tests/orchestrator-join.test.ts",
    desc: "逐行帽不计入截断提示 ⇒ 「≤400 token」变成「400 + 提示」，承诺被提示自己撑破（SHELL_NOTICE_RESERVE / 报告裁剪同族坑）",
    apply: (s) => s.replace("const clipped = clipWorkerSummary(input.report, WAIT_ROW_TOKEN_CAP);", "const clipped = { text: input.report, truncated: false };"),
    expectFail: "单行超帽 ⇒ 截断且提示计入预算（总长仍 ≤ 帽，不是「帽 + 提示」）",
  },
  {
    id: "join-batch-cap-dropped",
    src: "src/agent/orchestrator-join.ts",
    test: "tests/orchestrator-join.test.ts",
    desc: "取消整批帽 ⇒ 并发 4 时 4×400 仍能塞穿父上下文（数量有界 ≠ 体积有界）",
    apply: (s) => s.replace("const fits = used + cost <= WAIT_BATCH_TOKEN_CAP;", "const fits = true;"),
    expectFail: "整批超帽 ⇒ 后段降级为一行状态并登记 degraded（数量有界 ≠ 体积有界）",
  },
  {
    id: "join-degraded-row-vanishes",
    src: "src/agent/orchestrator-join.ts",
    test: "tests/orchestrator-join.test.ts",
    desc: "被整批帽牺牲的行整条消失 ⇒ 模型只能以为那个 worker 白跑（静默丢信息比丢摘要更坏）",
    apply: (s) => s.replace("      rows.push({ agent_id: input.agentId, status: input.status, task: input.task, summary: \"\", truncated: false, usage: input.usage, ...spent });\n      continue;", "      continue;"),
    expectFail: "整批超帽 ⇒ 后段降级为一行状态并登记 degraded（数量有界 ≠ 体积有界）",
  },
  {
    id: "join-timeout-silently-defaults",
    src: "src/agent/orchestrator-join.ts",
    test: "tests/orchestrator-join.test.ts",
    desc: "非法 timeout 静默回落缺省 ⇒ 模型以为自己设了 10 分钟、实际只等 2 分钟（fail-visible 反例）",
    apply: (s) => s.replace("return { ms: WAIT_TIMEOUT_DEFAULT_MS, clamped: false, rejected: \"timeout_ms 必须是数字\" };", "return { ms: WAIT_TIMEOUT_DEFAULT_MS, clamped: false };"),
    expectFail: "超时：缺省用默认值；过大钳到硬帽并如实报钳制；非数一律 fail-visible 拒绝",
  },
  {
    id: "wait-unknown-id-enters-waiters",
    // 针脚随实现搬家（2026-10-17 三缝拆分）：waitForAgents 整支搬到 orchestrator-approvals.ts；
    // 锚文跟着搬家后的读法改字面量（this.workers → this.deps.workers）。
    src: "src/agent/orchestrator-approvals.ts",
    test: "tests/orchestrator-wait.test.ts",
    desc: "未知 id 不先摘 ⇒ 进 terminalWaiters 永不触发：这次等待永挂 + 等待项泄漏（waitForAgentTerminal 的原语行为，所以必须在调用方挡）",
    apply: (s) => s.replace("const known = targets.filter((id) => this.deps.workers.has(id));", "const known = [...targets];"),
    expectFail: "未知 id fail-visible 摘出（喂进 waitForAgentTerminal 会永挂 + 泄漏等待项）",
  },
  {
    id: "wait-returns-before-terminal",
    // 针脚随实现搬家（2026-10-17 三缝拆分）：waitForAgents 整支搬到 orchestrator-approvals.ts，锚文逐字未动。
    src: "src/agent/orchestrator-approvals.ts",
    test: "tests/orchestrator-wait.test.ts",
    desc: "把「等终态」摘成立即返回 ⇒ 收队永远只报 running，模型读到的是「团队还没干活」而不是「我在等」",
    apply: (s) => s.replace("Promise.all(known.map((id) => this.waitForAgentTerminal(id))).then(() => \"done\" as const),", "Promise.resolve(\"done\" as const),"),
    expectFail: "超时：未收敛的 id 进 timedOut，已收敛的照常带 summary（超时不算失败）",
  },
  {
    id: "wait-timeout-gate-removed",
    // 针脚随实现搬家（2026-10-17 三缝拆分）：waitForAgents 整支搬到 orchestrator-approvals.ts，锚文逐字未动。
    src: "src/agent/orchestrator-approvals.ts",
    test: "tests/orchestrator-wait.test.ts",
    desc: "取消超时闸 ⇒ 收队变成无界等待：主会话的整轮挂在一次工具调用上（等人门必须有上限，同 UNATTENDED_GATE_WAIT_MS 族）",
    apply: (s) => s.replace("new Promise<\"timeout\">((resolve) => { timer = setTimeout(() => resolve(\"timeout\"), timeoutMs); timer.unref?.(); }),", "new Promise<\"timeout\">(() => {}),"),
    expectFail: "超时：未收敛的 id 进 timedOut，已收敛的照常带 summary（超时不算失败）",
  },
  {
    id: "gb-parity-face-blind",
    src: "src/agent/tool-surface.ts",
    test: "tests/tool-surface-parity.test.ts",
    desc: "对账函数恒返回空 ⇒ 静态门变成盖章机器；门的分辨力必须被它自己测到，否则后续每条「绿」都是空转",
    apply: (s) => s.replace("return names.filter((n) => !face.has(n));", "return [];"),
    expectFail: "对账本身有分辨力（反向对照：没这条的静态门等于没立）",
  },
  // ---- W4a/W4b：worker 收束闸与证据标记（tests/m3b.test.ts + tests/worker-evidence.test.ts）----
    {
    id: "evidence-red-beat-as-verified",
    src: "src/agent/worker-report.ts",
    test: "tests/worker-evidence.test.ts",
    desc: "只看「有没有 verify 拍」不看 ok ⇒ 红的验证拍被读成 verified，证据位反成粉饰工具",
    apply: (s) => s.replace('  if (!lastVerifyOk) return "failed";', "  if (false) return \"failed\";"),
    expectFail: "最后拍是红的 ⇒ failed（不粉饰）",
  },
  {
    id: "evidence-ignores-write-order",
    src: "src/agent/worker-report.ts",
    test: "tests/worker-evidence.test.ts",
    desc: "丢掉「验后又写」的次序判定 ⇒ 描述的不是即将合并的那份代码也算证据（能力 5 最忌的假绿）",
    apply: (s) => s.replace('  return lastWrite > lastVerify ? "stale" : "verified";', '  return "verified";'),
    expectFail: "验过之后又写了盘 ⇒ stale（那份绿证据描述的不是即将合并的代码）",
  },
  {
    id: "evidence-counts-failed-writes",
    src: "src/agent/worker-report.ts",
    test: "tests/worker-evidence.test.ts",
    desc: "被权限门拒掉的写也算「改过盘」⇒ 一次没落盘的 tool_call 就把绿证据打成 stale（读数反过来不诚实）",
    apply: (s) => s.replace("      if ((e.ok || e.fusedWrite === true) && c !== undefined && mayHaveWrittenDisk(c.name, c.args)) lastWrite = i;", "      if (c !== undefined && mayHaveWrittenDisk(c.name, c.args)) lastWrite = i;"),
    expectFail: "被拒的写（ok:false）不构成过期证据",
  },
    // ---- W3② 价格标签（tests/worker-spent-usd.test.ts）：钱的话只准一处说，且不可知 ≠ 免费 ----
  {
    id: "spent-usd-unknown-as-zero",
    src: "src/agent/orchestrator-join.ts",
    test: "tests/worker-spent-usd.test.ts",
    desc: "价格不可知时回 $0 而不是 null ⇒ 「这个 worker 没花钱」成为假证据（把不可知记成免费）",
    apply: (s) => s.replace("  const id = price?.priceId;\n  if (id === undefined) return null;", "  const id = price?.priceId;\n  if (id === undefined) return { usd: 0, calibrated: false };"),
    expectFail: "价格不可知（无档位 / 无 priceId）→ null，绝不返回 0",
  },
  {
    id: "spent-usd-claims-calibrated",
    src: "src/agent/orchestrator-join.ts",
    test: "tests/worker-spent-usd.test.ts",
    desc: "标定态写死 true ⇒ GLM 三档的占位单价被读成厂商实测价，「省了钱」的宣称失去约束",
    apply: (s) => s.replace("calibrated: row.calibrated === true };", "calibrated: true };"),
    expectFail: "已知档位：花费 = costUsd 同值，且如实带上标定态",
  },
  {
    id: "spent-usd-price-drift-as-free",
    src: "src/agent/orchestrator-join.ts",
    test: "tests/worker-spent-usd.test.ts",
    desc: "价表查不到时兜一个 0 价档 ⇒ 两表漂移被读成「这个 worker 免费」，且 worker 终态还照常绿（最贵的读数是假的）",
    apply: (s) => s.replace("  const row = priceRow(id);\n  if (row === null) return null;\n", "  const row = priceRow(id) ?? { inputPerMTok: 0, outputPerMTok: 0 };\n"),
    expectFail: "价表缺这个档位（两表漂移）⇒ 退化成一行的 warn + null，绝不把 worker 终态炸掉",
  },
  {
    id: "spent-usd-infinite-passes",
    src: "src/agent/orchestrator-join.ts",
    test: "tests/worker-spent-usd.test.ts",
    desc: "不做有限性检查 ⇒ Infinity 进 JSON 静默变 null、整批合计被带成 NaN，「省了多少」从此是噪声而不是数",
    apply: (s) => s.replace("  if (!Number.isFinite(usd)) {", "  if (false) {"),
    expectFail: "usage 里冒出非有限数 ⇒ null（NaN 进 JSON 会变成 null，整批合计也会被带成 NaN）",
  },
  {
    id: "price-tag-silent-when-unknown",
    src: "src/agent/orchestrator-join.ts",
    test: "tests/worker-spent-usd.test.ts",
    desc: "算不出价时把这一行留空 ⇒ 回执看起来像「报价被省略」，没人知道价格面是黑的",
    apply: (s) => s.replace("if (price === null || price === undefined || price.priceId === undefined) return PRICE_UNKNOWN;", 'if (price === null || price === undefined || price.priceId === undefined) return "";'),
    expectFail: "回执一行：带模型名 + 单价 + 标定态；不可知时出现「价格未知」且没有 $0",
  },
  {
    id: "join-note-hides-unknown-count",
    src: "src/agent/orchestrator-join.ts",
    test: "tests/worker-spent-usd.test.ts",
    desc: "合计只加已知的却不报有几个未知 ⇒ 模型把部分和当整批花费（本仓「整块省略要说省了谁」同族）",
    apply: (s) => s.replace('(unknown > 0 ? "；另有 " + String(unknown) + " 个 worker 价格未知未计入" : "")', '""'),
    expectFail: "合计只加已知的，未计数量如实报出",
  },
  {
    id: "join-degraded-row-loses-spent",
    src: "src/agent/orchestrator-join.ts",
    test: "tests/worker-spent-usd.test.ts",
    desc: "整批帽摘摘要时顺手摘掉花费 ⇒ 最贵的那几条恰好看不见钱（判分工值不值的读数被裁掉）",
    apply: (s) => s.replace('task: input.task, summary: "", truncated: false, usage: input.usage, ...spent });', 'task: input.task, summary: "", truncated: false, usage: input.usage });'),
    expectFail: "shapeJoinRows 把 spent 逐行带到 rows（被整批帽摘掉摘要也不摘花费）",
  },
  {
    id: "receipt-drops-price-line",
    src: "src/agent/orchestrator.ts",
    test: "tests/worker-spent-usd.test.ts",
    desc: "回执不报价 ⇒ 派工时模型只看得到「有几个并发槽」看不到单价，「要不要再拆一个」只能凭感觉（W3② 的正面）",
    apply: (s) => s.replace("        price: priceTagText(price, this.workerSpentSoFarUsd()),\n", ""),
    expectFail: "真实 provider 路径：回执带单价、终态带 spent_usd 与标定态、收队行带同一笔钱",
  },
  {
    id: "price-resolver-skipped",
    src: "src/agent/orchestrator.ts",
    test: "tests/worker-spent-usd.test.ts",
    desc: "价格解析整段不跑（真实 provider 也被判成不可知）⇒ 钱面全黑而回执仍「像在工作」，实测读数无从积累",
    apply: (s) => s.replace("    if (!isScriptedModel(model)) {", "    if (false) {"),
    expectFail: "真实 provider 路径：回执带单价、终态带 spent_usd 与标定态、收队行带同一笔钱",
  },
  {
    id: "scripted-marker-never-set",
    src: "src/agent/worker-model.ts",
    test: "tests/worker-spent-usd.test.ts",
    desc: "剧本模型不打 scripted 标 ⇒ 冻结回放被折算成「花了钱」，checks/demo 轨迹从此污染价格读数",
    apply: (s) => s.replace("  model.scripted = true;", "  void model;"),
    expectFail: "冻结剧本 worker：回执写价格未知，终态与收队行都不带 spent_usd",
  },
  {
    id: "worker-hooks-never-threaded",
    src: "src/agent/orchestrator.ts",
    test: "tests/worker-hooks.test.ts",
    desc: "worker 的 runLoop 不接钩子引擎 ⇒ 用户装的 PreToolUse 拦截钩子挡不住并行 worker 写盘（门装了不锁；§9.10 明文 worker 继承主会话插件启用集）",
    apply: (s) => s.replace("        ...(workerHooks ? { hooks: workerHooks } : {}),", "        ...(false ? { hooks: workerHooks } : {}),"),
    expectFail: "PreToolUse 阻断真的挡住 worker 的写：worktree 里不落盘，tool_result 带钩子理由",
  },
  {
    id: "worker-agent-id-not-threaded",
    src: "src/agent/orchestrator.ts",
    test: "tests/worker-hooks.test.ts",
    desc: "编排器不把 w.agentId 交给 loop ⇒ 钩子收到的 stdin 里 agent_id 恒缺席，§4.4 的归因面（哪个 worker 触发的）在钩子侧丢失",
    apply: (s) => s.replace("        signal: w.controller.signal,\n        agentId: w.agentId,", "        signal: w.controller.signal,\n        agentId: undefined,"),
    expectFail: "钩子拿到 agent_id = 该 worker 的 id 与模型实下的参数（§4.4 归因）",
  },
  {
    id: "subagent-start-not-fired",
    src: "src/agent/orchestrator.ts",
    test: "tests/worker-hooks.test.ts",
    desc: "worker 生命周期不发 SubagentStart ⇒ §9.5 表里这一行只剩枚举，插件作者给子任务的注入面（施工须知 / 项目黑话表）整条失效",
    apply: (s) => s.replace('      const startContext = await this.subagentHook(w, "SubagentStart");', '      const startContext = "";'),
    expectFail: "SubagentStart 的 additionalContext 真的进模型收到的 system 块（不是发完就丢）",
  },
  {
    id: "subagent-start-context-not-threaded",
    src: "src/agent/orchestrator.ts",
    test: "tests/worker-hooks.test.ts",
    desc: "发了 SubagentStart 却不把 additionalContext 传进 system ⇒ 钩子跑了、模型一个字也没看到——「收下即丢」的第三种写法（前两种：字段不读、回执不接）",
    apply: (s) => s.replace('      const system = await buildWorkerSystemMessages(w, this.opts.workspace, startContext);', '      const system = await buildWorkerSystemMessages(w, this.opts.workspace);'),
    expectFail: "SubagentStart 的 additionalContext 真的进模型收到的 system 块（不是发完就丢）",
  },
  {
    id: "subagent-stop-not-fired",
    src: "src/agent/orchestrator.ts",
    test: "tests/worker-hooks.test.ts",
    desc: "不发 SubagentStop ⇒ 「每次子任务收束都过一次审计钩子」这条承诺（§9.10 的另一半）落空，且终态已经写完才发现没人验收",
    apply: (s) => s.replace('      await this.subagentHook(w, "SubagentStop");', '      void 0;'),
    expectFail: "两条事件各恰好一次，且 SubagentStop 晚于 agent_result 落流（审计钩子要看得见产出）",
  },
  {
    id: "subagent-stop-fired-twice",
    src: "src/agent/orchestrator.ts",
    test: "tests/worker-hooks.test.ts",
    desc: "SubagentStop 在运行体和终态漏斗各发一次 ⇒ 每个 worker 被审计两遍（次数断言才看得见：只判「有没有」的哨兵会放它过去）",
    apply: (s) => s.replace('      await this.finish(w, "done");', '      await this.subagentHook(w, "SubagentStop");\n      await this.finish(w, "done");'),
    expectFail: "两条事件各恰好一次，且 SubagentStop 晚于 agent_result 落流（审计钩子要看得见产出）",
  },
  {
    id: "subagent-agent-type-fabricated-empty",
    src: "src/agent/orchestrator.ts",
    test: "tests/worker-hooks.test.ts",
    desc: "无名 worker 也塞一个 agent_type 空串 ⇒ 写了 matcher 的钩子从「不匹配」变成「可能匹配上伪造值」，而作者读到 stdin 会以为这子任务真有个空名字的类型",
    apply: (s) => s.replace('        ...(w.agentType !== undefined ? { agent_type: w.agentType } : {}),', '        agent_type: w.agentType ?? "",'),
    expectFail: "普通 spawn 没有角色名 ⇒ agent_type 整键缺席（拿空串伪造一个类型是伪造输入）",
  },
  {
    id: "subagent-agent-type-not-on-handle",
    src: "src/agent/orchestrator.ts",
    test: "tests/worker-hooks.test.ts",
    desc: "spawn 时没把角色名落到 handle ⇒ 事件照发、agent_type 永远缺席，§9.5 里 Subagent* 唯一的 matcher 字段在流水线 stage 上也配不出来",
    apply: (s) => s.replace('      ...(stageRole?.role !== undefined ? { agentType: stageRole.role } : {}),', '      ...(false ? { agentType: stageRole.role } : {}),'),
    expectFail: "流水线 stage 的 worker 带 agent_type = 角色名（§9.5 的 matcher 字段有值可配）",
  },
  // ---- verify_result 子流归因（2026-09-20 补）：摘掉归因 = 三处下游同时被骗，必须有锚点 ----
  {
    id: "verify-result-out-of-attribution",
    src: "src/agent/worker-projection.ts",
    test: "tests/worker-attribution.test.ts",
    desc: "把 verify_result 摘出归因面 ⇒ worker 的验证证据回到「与父会话难分」的状态：上下文红回流、父验证计量、假完成率三处同时被骗",
    // 针脚随 turn_truncated 进白名单而改指（2026-09-21）；再随「串条件换成 WORKER_STREAM_TYPES 表」
    // 改指一次（2026-09-22）：语义逐字不变——仍然只摘 verify_result。
    apply: (s) => s.replace('["tool_result", "verify_result", "error"]', '["tool_result", "error"]'),
    expectFail: "verify_result 进归因面：worker 的验证证据必须能被认出不是父会话的",
  },
  // ---- M5b 级联升级接进产品路径 + 终态收尾窗口（2026-09-20 任务 #45）----
  // 这一簇的动机本身就是「两头断」：runCascade 只有验收脚本用 stub rung 调过，产品里零调用者，
  // 而 docs/m5-acceptance.md B5 标着「已证」。下面 7 条锁的是接上后的**判据面**——
  // 什么算红、什么算绿、往哪些档升、升不动时怎样，以及新发现的收尾窗口竞态。
  {
    id: "cascade-trigger-wider-than-objective-fail",
    // 针脚随实现搬家（2026-10-17 三缝拆分）：runChain 整支搬到 orchestrator-approvals.ts，锚文逐字未动。
    src: "src/agent/orchestrator-approvals.ts",
    test: "tests/cascade-wiring.test.ts",
    desc: "升级判据放宽成「不是 verified 就算红」⇒ 这一路压根没跑过 verify 的环也被拉去升档，拿猜测换账单",
    apply: (s) => s.replace("evidenceOf(t) === \"failed\" || evidenceOf(t) === \"stale\";", "evidenceOf(t) !== \"verified\";"),
    expectFail: "worker 没跑过 verify（证据 absent）⇒ 不升级：没有客观判据就不拿猜测换账单",
  },
  {
    id: "cascade-rung-accepts-absent-evidence",
    // 针脚随实现搬家（2026-10-17 三缝拆分）：runChain 整支搬到 orchestrator-approvals.ts，锚文逐字未动。
    src: "src/agent/orchestrator-approvals.ts",
    test: "tests/cascade-wiring.test.ts",
    desc: "升上来的那一档不再要求绿证据 ⇒ 花真钱买回一份比触发时更弱的证据还把环标成 done（假绿形状）",
    apply: (s) => s.replace("t.status === \"done\" && t.result !== null && evidenceOf(t) === \"verified\";", "t.status === \"done\" && t.result !== null;"),
    expectFail: "升上来的那一档没跑过 verify（absent）⇒ 不算收敛：不花真钱买回一份比触发时更弱的证据",
  },
  {
    id: "cascade-ladder-cross-provider",
    // 针脚随实现搬家（2026-10-17 三缝拆分）：cascadePlanFor 整支搬到 orchestrator-budget.ts，锚文逐字未动。
    src: "src/agent/orchestrator-budget.ts",
    test: "tests/cascade-wiring.test.ts",
    desc: "阶梯不再限定同 provider ⇒ 一次 BYOK 会话在升档时被悄悄换成别家的 key 与模型",
    // 针脚跟上现读（2026-10-11）：阶梯那半从 `DEFAULT_MODEL_TABLE.filter(…===…)` 改成
    // `effectiveModelTable().filter(…===…)`（级联接进产品路径那笔）；变异体照旧「换成反集」。
    // 反向验证：把 `===` 换成 `!==` 跑 killer（tests/cascade-wiring.test.ts 那条同 provider 断言），
    // 实测转红（先试过「整支丢掉过滤」——那条在本表序下仍选回同 provider 的档，**存活**，故不用它）。
    apply: (s) => s.replace("effectiveModelTable().filter((s) => s.provider === picked.provider)", "effectiveModelTable().filter((s) => s.provider !== picked.provider)"),
    expectFail: "verify 红 ⇒ 同 provider 升一档重跑，链的终态由最后一档负责，被淘汰那档的 worktree 回收",
  },
  {
    id: "cascade-ready-ignores-routing",
    // 针脚随实现搬家（2026-10-17 三缝拆分）：cascadeReady 整支搬到 orchestrator-budget.ts，
    // 开关的读法跟着搬成 `this.deps.opts.*`（锚文其余逐字未动）。
    src: "src/agent/orchestrator-budget.ts",
    test: "tests/cascade-wiring.test.ts",
    desc: "cascadeReady 丢掉 routing 前置 ⇒ 未路由时档位无从知晓，「升档」退化成花两遍钱跑同一个模型",
    apply: (s) => s.replace("    if (this.deps.opts.routing !== true) {\n      if (!this.cascadeWarned) {", "    if (false) {\n      if (!this.cascadeWarned) {"),
    expectFail: "只开 cascadeUpgrade、没开 routing ⇒ 不级联：阶梯起点与升档都靠路由，缺了就等于花两遍钱跑同一模型",
  },
  {
    id: "terminal-sync-reads-finished-not-resolved",
    // 针脚随实现搬家（2026-10-17 三缝拆分）：waitForAgentTerminal 整支搬到 orchestrator-approvals.ts，锚文逐字未动。
    src: "src/agent/orchestrator-approvals.ts",
    test: "tests/terminal-sync-window.test.ts",
    desc: "sequencer 同步点回到只读 finished ⇒ 落在收尾窗口（diff/安全流水/emit 未完）的调用方拿到「done + result 空」",
    apply: (s) => s.replace("if (w && w.terminalResolved) {", "if (w && w.finished) {"),
    expectFail: "join 落在窗口内 ⇒ 回执说 running + timedOut 点名；不说 done + 空报告",
  },
  {
    id: "join-settled-reads-finished",
    // 针脚随实现搬家（2026-10-17 三缝拆分）：waitForAgents 整支搬到 orchestrator-approvals.ts；
    // 锚文跟着搬家后的读法改字面量（this.workers → this.deps.workers）。
    src: "src/agent/orchestrator-approvals.ts",
    test: "tests/terminal-sync-window.test.ts",
    desc: "收队把「finished 已真」当已收敛 ⇒ 窗口里的 worker 不进 timedOut，报告记空串冒充已知",
    apply: (s) => s.replace("known.filter((id) => this.deps.workers.get(id)?.terminalResolved === true)", "known.filter((id) => this.deps.workers.get(id)?.finished === true)"),
    expectFail: "join 落在窗口内 ⇒ 回执说 running + timedOut 点名；不说 done + 空报告",
  },
  {
    id: "cascade-climbs-past-other-class-failure",
    // 针脚随实现搬家（2026-10-17 三缝拆分）：runChain 整支搬到 orchestrator-approvals.ts，锚文逐字未动。
    src: "src/agent/orchestrator-approvals.ts",
    test: "tests/cascade-wiring.test.ts",
    desc: "升上来的那档终态 failed/cancelled 仍继续往上爬 ⇒ 换一档重跑同一个坏环境，把预算烧在没判据说能修好的失败上",
    apply: (s) => s.replace("if (!ok && term.status !== \"done\") stopClimb =", "if (false) stopClimb ="),
    expectFail: "升上来的那档直接崩（终态 failed）⇒ 立刻停止爬升：同一环境换一档只会再花一遍钱",
  },
  {
    id: "bandit-rewards-self-reported-done",
    // 针脚随实现搬家（2026-10-17 三缝拆分）：rewardBandit 整支搬到 orchestrator-budget.ts，锚文逐字未动。
    src: "src/agent/orchestrator-budget.ts",
    test: "tests/cascade-wiring.test.ts",
    desc: "奖励只看终态 done、不看客观证据 ⇒ 在恰好被判红的那一跑上给便宜档加分，级联越开越学出「便宜但红」",
    apply: (s) => s.replace("const reward = status === \"done\" && evidence !== \"failed\" && evidence !== \"stale\" ? 1 : 0;", "const reward = status === \"done\" ? 1 : 0;"),
    expectFail: "done 但客观证据红 ⇒ bandit 不加分：否则级联越开越学出「便宜但红」的方向",
  },
  {
    id: "bandit-cost-term-zeroed",
    // 针脚随实现搬家（2026-10-17 三缝拆分）：代价项那一行搬到 orchestrator-budget.ts，锚文逐字未动。
    src: "src/agent/orchestrator-budget.ts",
    test: "tests/bandit-runtime.test.ts",
    desc: "代价项换成常量 0（§1.3 那次「从 token 代理升级成真钱」被静默摘掉：路由只学成功率、不看钱 ⇒ 越学越往贵的档走也没人发现）。旧断言 β≥2 / β>2 对这条完全无分辨力，现由等式 + 比例性一条判住",
    apply: (s) => s.replace("const cost = costUsd(w.routeModelId, w.usage);", "const cost = 0;"),
    expectFail: "代价项真的按真钱进 β：同样 done、用量差 10 倍 ⇒ β 增量差 10 倍（reward 相同时只有钱能改这个数）",
  },
  {
    id: "finish-throw-orphans-terminal-waiters",
    src: "src/agent/orchestrator.ts",
    test: "tests/terminal-sync-window.test.ts",
    desc: "收尾中途抛异常时只置标志不放行等待方 ⇒ sequencer 在没有超时的等待上永挂（整链无终态、worktree 清不掉、cancel 又被 finished 拒）",
    apply: (s) => s.replace("        this.resolveTerminalWaiters(w.agentId, \"failed\", null);\n", ""),
    expectFail: "收尾中途 emit 抛 ⇒ 等待方照旧被放行（宁可这环红，不许整链永挂）",
  },
  {
    id: "merge-admits-worker-still-in-finish-window",
    // 针脚随实现搬家（2026-10-17 三缝拆分）：mergeWorker 整支搬到 worker-merge.ts，锚文逐字未动。
    src: "src/agent/worker-merge.ts",
    test: "tests/terminal-sync-window.test.ts",
    desc: "合并准入回到只看 finished ⇒ 收尾窗口里 lastFindings 还没填，gate 档被「零条高危」假通过，未扫描的代码被系统代为 commit 并进主树",
    apply: (s) => s.replace("if (!w.terminalResolved) return { ok: false, error: \"worker 尚未收敛（done 后才可合并）\" };", "if (false) return { ok: false, error: \"worker 尚未收敛（done 后才可合并）\" };"),
    expectFail: "收尾窗口里叫合并 ⇒ 拒绝：窗口内 lastFindings 还空着，gate 档会被「无 findings」假通过",
  },
  {
    id: "price-for-model-lookup-dropped",
    src: "src/agent/orchestrator-join.ts",
    test: "tests/goal-price.test.ts",
    desc: "反查被摘掉，只认显式传入的档位 id ⇒ 模型名那一态恒不产值表键（worker 未路由时与 goal 续跑两条路一起退回「价格不可知」）",
    apply: (s) => s.replace("  const id = findSpecByNameOrId(table, model)?.id ?? pickedId;", "  const id = pickedId;"),
    expectFail: "用户在设置里选的那个名字（provider 模型名）逐档都算得出钱",
  },
  {
    id: "worker-truncation-reaches-parent-untagged",
    src: "src/agent/worker-projection.ts",
    test: "tests/turn-truncated.test.ts",
    desc: "withAgentId 的类型白名单不收 turn_truncated ⇒ 子流截断以「主会话上一轮没说完」落进父转录与父目标判据",
    // 2026-09-22 改指：串条件换成了 WORKER_STREAM_TYPES 表（provider 那一半进 Record），语义不变——仍然只摘 turn_truncated。
    apply: (s) => s.replace('  turn_truncated: true,\n', ''),
    expectFail: "worker 子流的截断会被装饰 agent_id（否则它以「主会话上一轮没说完」落进父转录）",
  },
  // ---- 截断卡的标题面（tests/renderer-truncation-label.test.ts，2026-09-21）----
      {
    id: "worker-prose-unattributed",
    src: "src/agent/worker-projection.ts",
    test: "tests/worker-attribution.test.ts",
    desc: "归因面不收 assistant_message ⇒ worker 的正文以父会话「自己说过」的形态进父投影",
    apply: (s) => s.replace('  assistant_message: true,\n', ''),
    expectFail: "正文与错误三类都进归因面（漏一型 = 它以父会话的形态落进主转录）",
  },
  {
    id: "worker-delta-unattributed",
    src: "src/agent/worker-projection.ts",
    test: "tests/worker-attribution.test.ts",
    desc: "不收 assistant_delta：流式那半句同样越界（正文不是只从 assistant_message 来的）",
    apply: (s) => s.replace('  assistant_delta: true,\n', ''),
    expectFail: "正文与错误三类都进归因面（漏一型 = 它以父会话的形态落进主转录）",
  },
  {
    id: "worker-error-unattributed",
    src: "src/agent/worker-projection.ts",
    test: "tests/worker-attribution.test.ts",
    desc: "不收 error ⇒ worker 炸了在主转录里显示成父会话的错误（并会进父的失败沉淀）",
    apply: (s) => s.replace('"tool_result", "verify_result", "error"]', '"tool_result", "verify_result"]'),
    expectFail: "正文与错误三类都进归因面（漏一型 = 它以父会话的形态落进主转录）",
  },
  // ---- 子流准入的界面那一半（projections + 两条渲染器，2026-09-22）----
            // ---- 工具摘要政策的一份实现（projections.toolArgsSummary，2026-09-22）----
          // ---- 面板重绘触发集的双向闸（projections.PANEL_DIRTY_TYPES，2026-09-22）----
        // ---- 落流脱敏的覆盖面（worker-projection 的正文表，2026-09-22）----
  {
    id: "redaction-drops-delta-from-body-table",
    src: "src/agent/worker-projection.ts",
    test: "tests/stream-redaction.test.ts",
    desc: "把 assistant_delta 从正文表里摘掉 ⇒ 擦了最终消息、留着流式分片——同一句话的另一个出口静默失效",
    apply: (s) => s.replace('  assistant_delta: [["text"]],\n', ""),
    expectFail: "没有未表态的类型（新增一型不列进任何桶 = 当场红）",
  },
  {
    id: "redaction-stops-recursing-into-containers",
    src: "src/agent/worker-projection.ts",
    test: "tests/stream-redaction.test.ts",
    desc: "容器只原样复制不再归叶子 ⇒ verify_result.results / plan_proposed.plan / agent_result.artifacts 里的正文整段不扫（表看着列了路径，其实什么都不擦）",
    apply: (s) => s.replace("for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = scanStringLeaves(x);", "for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = x;"),
    expectFail: "verify_result 的声明路径种得进密钥、也擦得掉",
  },
  {
    id: "redaction-scrubs-user-authored-text",
    src: "src/agent/worker-projection.ts",
    test: "tests/stream-redaction.test.ts",
    desc: "把用户自己贴进来的正文也扫掉 ⇒ 用户贴密钥让 agent 配环境这条正常意图被毁；边界要有名字，不是靠「顺手一起扫」",
    apply: (s) => s.replace('  goal_stopped: [["reason"]],', '  goal_stopped: [["reason"]],\n  diff_comment: [["body"]],'),
    expectFail: "四个桶互斥",
  },
  {
    id: "redaction-mutates-the-source-event",
    src: "src/agent/worker-projection.ts",
    test: "tests/stream-redaction.test.ts",
    desc: "就地改事件本体 ⇒ worker 内存态（provider 投影与报告回读用）被脱敏文本污染，模型看到的和自己写的不是同一份",
    apply: (s) => s.replace("const copy = { ...(e as unknown as Record<string, unknown>) };", "const copy = e as unknown as Record<string, unknown>;"),
    expectFail: "不改动传入的原对象",
  },
  // ---- 自定义子智能体的发现面与如实报错（sequencer + plugins，2026-09-22）----
  {
    id: "role-unimplemented-keys-silent",
    src: "src/agent/sequencer.ts",
    test: "tests/plugin-role-discoverability.test.ts",
    desc: "§9.6 采纳未落地的字段（effort/skills/memory/background）不吭声 ⇒ 用户以为配上了，执行端从没读过",
    apply: (s) => s.replace('  for (const key of PLUGIN_UNIMPLEMENTED_KEYS) {\n    if (fm[key] !== undefined) {\n      warnings.push("插件 agent frontmatter." + key + " 执行端还没有读它的地方（§9.6 采纳未落地），已忽略");\n    }\n  }\n', ""),
    expectFail: "CC 有、执行端没有面的字段：警告说清「采纳未落地」",
  },
  {
    id: "role-unknown-key-silent",
    src: "src/agent/sequencer.ts",
    test: "tests/plugin-role-discoverability.test.ts",
    desc: "笔误键静默吃掉 ⇒ disallowed_tools 写成下划线就等于「申报了剔除面、实际按默认面跑」，工具面静默变宽",
    apply: (s) => s.replace('    if (!known.has(key)) {\n      warnings.push("插件 agent frontmatter." + key + " 不认识，已忽略（合法键：" + PLUGIN_ROLE_CONSUMED_KEYS.join("/") + "）");\n    }', "    if (!known.has(key)) { /* 沉默 */ }"),
    expectFail: "笔误键必须点名合法键集",
  },
                  {
    id: "worker-git-newline-not-a-separator",
    src: "src/agent/worker-shell-tools.ts",
    test: "tests/shell-bypass-composition.test.ts",
    desc: "去掉「换行 ↦ 分号」的归一化 ⇒ `echo hi\\ngit push --force` 整段首词是 echo，git 段从没被看过（bash 语义里换行就是分隔符）",
    apply: (s) => s.replace("command.replace(/\\r?\\n/g, \";\")", "command"),
    expectFail: "换行是命令分隔符：`echo hi\\ngit push --force` 不得因为整段首词是 echo 而漏判",
  },
  {
    id: "worker-git-uses-raw-first-token",
    src: "src/agent/worker-shell-tools.ts",
    test: "tests/shell-bypass-composition.test.ts",
    desc: "有效二进制退回「段首字面词」⇒ sudo/env/nohup/timeout/command/绝对路径/`bash -c` 载荷七类包装各漏一支（09-21 复现报告第③段就是这个形态，当时红 6）",
    apply: (s) => s.replace("if (inv.bin === \"git\") subs.push(inv.args[0] ?? \"\");", "if (seg.trim().startsWith(\"git\") && inv.bin === \"git\") subs.push(inv.args[0] ?? \"\");"),
    expectFail: "非只读一律拦：包装、链段、值选项、`shell -c` 载荷、`command -p` 都不给缝",
  },
  {
    id: "readonly-gate-metachar-veto-lost",
    src: "src/agent/worker-shell-tools.ts",
    test: "tests/shell-bypass-composition.test.ts",
    desc: "只读闸去掉「写面元字符一票否决」⇒ `echo x > /etc/hosts` 变成 echo（白名单内）过闸；而 shell_ro 刻意不进静态威胁表，这道一没别的防兜它",
    apply: (s) => s.replace("if (SHELL_WRITE_META.test(command)) {", "if (false) {"),
    expectFail: "写面元字符一票否决仍在（对 shell_ro 而言它是 `> /etc/hosts` 唯一那道防）",
  },
  {
    id: "readonly-gate-whitelist-lost",
    src: "src/agent/worker-shell-tools.ts",
    test: "tests/shell-bypass-composition.test.ts",
    desc: "只读闸不再查命令白名单 ⇒ `rm -rf /` 与 `sudo …` 直接进 flagViolation，只读 worker 拿到写盘能力",
    apply: (s) => s.replace("if (!READONLY_SHELL_COMMANDS.includes(head)) {", "if (false) {"),
    expectFail: "写面元字符一票否决仍在（对 shell_ro 而言它是 `> /etc/hosts` 唯一那道防）",
  },
  {
    id: "readonly-gate-newline-joined-not-split",
    src: "src/agent/worker-shell-tools.ts",
    test: "tests/shell-bypass-composition.test.ts",
    desc: "换行归一从「换成分号」改成「换成空格」⇒ `cat x\\ngit push --force` 成了一段、首词 cat 落在白名单内（P0-1 审查根因 1 的复活形状）",
    apply: (s) => s.replace("command.replace(/\\r\\n?|\\n/g, \";\")", "command.replace(/\\r\\n?|\\n/g, \" \")"),
    expectFail: "写面元字符一票否决仍在（对 shell_ro 而言它是 `> /etc/hosts` 唯一那道防）",
  },
  {
    id: "worker-gitguard-ignores-git-behind-unknown-head",
    src: "src/agent/worker-shell-tools.ts",
    test: "tests/shell-bypass-composition.test.ts",
    desc: "worker 闸退回只认「有效二进制是 git」的那些 ⇒ 未知首词把 git 藏在参数里（setsid / flock / prlimit …）就整段不算 git 调用，强推在 worker 侧静默放行（09-22 实测的第二支面）",
    apply: (s) => s.replace(
      "      if (sub !== undefined && DESTRUCTIVE_GIT_SUBCOMMANDS.includes(sub)) subs.push(sub);",
      "      if (false && sub !== undefined) subs.push(sub);",
    ),
    expectFail: "worker 那一支不受降级影响：push 非只读 ⇒ fail-closed 一直拦得住",
  },
  {
    id: "worker-gitguard-hidden-git-not-bound-to-verb-table",
    src: "src/agent/worker-shell-tools.ts",
    test: "tests/shell-bypass-composition.test.ts",
    desc: "藏在未知首词后面的那一刀退回「只要不是只读动词就拦」⇒ `grep -rn git src`、`echo no git here` 这类惯用写法被 worker 打死（⑩ 第一版的真实代价，收窄靠的就是这张动词表）",
    apply: (s) => s.replace(
      "      if (sub !== undefined && DESTRUCTIVE_GIT_SUBCOMMANDS.includes(sub)) subs.push(sub);",
      "      if (sub !== undefined) subs.push(sub);",
    ),
    expectFail: "worker 侧那条界要钉住：只按破坏动词表拦藏在未知首词后面的调用，「git 只是个词」的写法留得住",
  },
  {
    id: "verify-exit-evidence-env-blind",
    src: "src/agent/worker-report.ts",
    test: "tests/verify-attribution-exits.test.ts",
    desc: "worker 证据那格恒假 ⇒ 环境红落成 failed；级联升档与 bandit 奖励都只读这一格（一只缝不是两只），于是「换个更贵的模型重跑一个装不上工具链的错」成为默认行为",
    apply: (s) => s.replace("      if (!e.ok && isEnvVerifyCause(e.cause)) return;", "      if (false) return;"),
    expectFail: "出口②：环境拍不把 worker 证据判成 failed（级联升档与 bandit 只由这一格驱动）",
  },
  {
    id: "control-tags-arm-dropped",
    src: "src/agent/control-tags.ts",
    test: "tests/instruction-provenance.test.ts",
    desc: "共用实现里只留角色行那一臂、摘掉控制标签臂 ⇒ 四处出口同时失去中和而「函数还在」：" +
      "钉在唯一取料点上，不给四臂各造一条会各自漂移的尺",
    apply: (s) => s.replace("    .replace(CONTROL_TAG, (m) => m.replace(/</g, \"&lt;\").replace(/>/g, \"&gt;\"))\n", ""),
    expectFail: "入口① 工具输出（prune 之前的原文）",
  },
  // ---- 「自定义子智能体」簇：角色落流 / 点名解析 / 重派整包转发 / 面板载荷 ----
  // 共同形状：一条参数从事件流走到重新 spawn，中间每一跳都可能静默掉一位；掉的那一位没人报错，
  // 只会让「按原参数重派」这句话变成假的。
  {
    id: "agent-spawned-role-not-emitted",
    src: "src/agent/orchestrator.ts",
    test: "tests/worker-role.test.ts",
    desc: "agent_spawned 不再带 role ⇒ 角色只活在内存（handle.agentType），崩溃恢复与审计面都读不到",
    apply: (s) => s.replace("      ...(stageRole?.role !== undefined ? { role: stageRole.role } : {}),\n", ""),
    expectFail: "点名的角色随 agent_spawned 落流，且**不改** args 里的 mode（角色不给写权限）",
  },
  {
    id: "spawn-role-resolution-short-circuited",
    src: "src/agent/orchestrator.ts",
    test: "tests/worker-role.test.ts",
    desc: "模型点名的 role 被当成空 ⇒ 未注册角色静默按默认面跑（申报的角色面被吞掉）",
    apply: (s) => s.replace('    const roleArg = typeof args.role === "string" ? args.role.trim() : "";', '    const roleArg = "";'),
    expectFail: "未注册的角色出声拒：不落 agent_spawned、不建 worker，并指回缺省行为",
  },
  {
    id: "respawn-args-drops-role",
    src: "src/agent/recovery.ts",
    test: "tests/worker-role.test.ts",
    desc: "respawnArgsFrom 不映射 role ⇒ 恢复卡的 artifacts.respawn 少一位（重派换了一张角色面）",
    apply: (s) => s.replace("    ...(spawned.role !== undefined ? { role: spawned.role } : {}),\n", ""),
    expectFail: "respawnArgsFrom 把 role 映射进重派参数；源事件没 role ⇒ 键缺席（不替它编一个默认角色）",
  },
  {
    id: "respawn-forward-back-to-field-list",
    src: "src/agent/orchestrator.ts",
    test: "tests/worker-role.test.ts",
    desc: "重派改回逐字段列写（漏掉 role 等四位）⇒ 映射端补了、转发端没跟上，这一跳静默丢参数",
    // 2026-10-22：`971fe18c` 给这一跳加了 recovery 承载（`carried`）⇒ 针脚跟着实现走：
    // 旧行整行不再逐字存在，突变会变成空操作（no-effect），表就少了一条分辨力。
    apply: (s) => s.replace("    return await this.spawn(respawnSpawnArgs(args), carried === undefined ? ctx : { ...ctx, recovery: carried });", "    return await this.spawn({ task: args.task, mode: args.mode }, carried === undefined ? ctx : { ...ctx, recovery: carried });"),
    expectFail: "真链：落流的角色 → respawnArgsFrom → respawn() 的新 agent_spawned 仍带同一角色（全新 agent_id）",
  },
  // 署名（规则 57：没有锚点的那一格要有名字与理由）：worker 侧**非工具档**那行 `frozenJudgePaths`
  // 钉不住——实测摘掉它，worker 判卷用例照样绿（第一版就写了这条锚点，存活后撤掉，不留恒绿针）。
  // 消费面是这样的：`worker-tool-table.ts` 三个写向工具显式传 `{ autonomy: w.toolAutonomy }`，
  // 回落到 `w.autonomy` 的只有 `remember`（非写向 ⇒ L0 那段永不命中）。装配那行**保留**
  // （将来任何走回落的写向工具都要它），但它今天是一格无人观测的防御，不是被守着的不变量。
  // 还欠一条：`judge-set-swallowed-empty`（把 `src/frozen.ts` 的"解析失败/空表 ⇒ 显式抛"折成空集，
  // 判卷用例 ⑧ 应红）——该文件自 09-23 起在别人手里，**在飞时补会被拒绝变异**，故留名待落地后补。
  {
    id: "judge-worker-toolface-wiring-dropped",
    src: "src/agent/orchestrator.ts",
    test: "tests/judge-frozen-gate.test.ts",
    desc: "worker 的**工具执行档**（toolAutonomy，write worker 恒 auto）不装冻结集 ⇒ 正是「自主档不许复活」那一格在并行路径上失守",
    apply: (s) => s.replace("      toolAutonomy: newAutonomySession(mode === \"write\" ? \"auto\" : tier, {\n        rules: this.opts.rules ?? [],\n        sandboxAvailable: this.opts.sandboxAvailable ?? null,\n        frozenJudgePaths: frozenJudgePathSet(this.opts.workspace),\n      }),", "      toolAutonomy: newAutonomySession(mode === \"write\" ? \"auto\" : tier, {\n        rules: this.opts.rules ?? [],\n        sandboxAvailable: this.opts.sandboxAvailable ?? null,\n      }),"),
    expectFail: "write worker（工具档恒 auto）写判卷路径 ⇒ tool_result 仍是冻结拒绝且 worktree 里逐字未变；同 run 写普通文件照常放行",
  },
  // ---- 09-24 supervise 判据取料面（真语料三次复跑全死于 escalate，逐笔读到）----
  // 五格各钉一针：caller 读不读凭据、escalate 删不删现场、机器凭据/过期证据/禁改面三条优先级。
  // 前两条今天只有 supervisor-check 的门在守（手工注入过：换掉 evidence 红 7 项、改回全量 reject
  // 只红现场两条），但变异表只跑 vitest ⇒ 门侧的分辨力无常驻判据，故另落 tests/supervise-evidence.test.ts。
  {
    id: "supervise-caller-ignores-credential",
    // 针脚随实现搬家（2026-10-17 三缝拆分）：spawnSupervise 整支搬到 orchestrator-approvals.ts，锚文逐字未动。
    src: "src/agent/orchestrator-approvals.ts",
    test: "tests/supervise-evidence.test.ts",
    desc: "caller 不读 `artifacts.verified`（判据退回纯散文）⇒ implement 角色永远取不到判据，supervise 恒 escalate 并删掉改对的成果",
    apply: (s) => s.replace("        evidence: term.result.artifacts.verified,", "        evidence: undefined,"),
    expectFail: "绿凭据 + 报告没有 verdict 行 ⇒ accept 并合并落盘（判据来自 caller 读到的凭据，不是散文）",
  },
  {
    id: "supervise-escalate-destroys-scene",
    // 针脚随实现搬家（2026-10-17 三缝拆分）：spawnSupervise 整支搬到 orchestrator-approvals.ts，锚文逐字未动。
    src: "src/agent/orchestrator-approvals.ts",
    test: "tests/supervise-evidence.test.ts",
    desc: "escalate 出口把最终环一起 reject ⇒ 先删 worktree 再回去问人，裁决发生时证据已不在",
    apply: (s) => s.replace("        await rejectRings(ringAgentIds.filter((id) => id !== agentId));\n        return { ok: false, output: \"spawn_agent(supervise): 已升级人工裁决：", "        await rejectRings(ringAgentIds);\n        return { ok: false, output: \"spawn_agent(supervise): 已升级人工裁决："),
    expectFail: "改了盘但取不到凭据、报告也无契约行 ⇒ escalate，且回执点名保留的 worktree 仍在盘上",
  },
  // ---- 第 40 页 · spawn_agent 逐型参数面：这一档不读的键必须**在派活前**点名拒绝并指路 ----
  {
    id: "spawn-supervise-drops-stages-silently",
    src: "src/agent/orchestrator.ts",
    test: "tests/spawn-arg-surface.test.ts",
    desc: "摘掉早期拒绝那一行 ⇒ 申报了不读的键重新静默蒸发（真轨迹那次：三阶段计划整支丢掉、回执无一句话）",
    apply: (s) => s.replace("    if (surfaceError !== null) return { ok: false, output: surfaceError };\n", "\n"),
    expectFail: "supervise + stages ⇒ 拒绝、点名 stages 与 pipeline，且零 worker 零审批（不花真钱、不打扰人）",
  },
  {
    id: "spawn-surface-check-uses-wrong-mode",
    src: "src/agent/orchestrator.ts",
    test: "tests/spawn-arg-surface.test.ts",
    desc: "检查拿错档位（写死 read）⇒ 合法 pipeline 申报 stages 被凭空拒一次，比漏拒更早咬到真调用",
    apply: (s) => s.replace("unconsumedSpawnArgs(mode, args).message()", 'unconsumedSpawnArgs("read", args).message()'),
    expectFail: "pipeline 带 stages + resources ⇒ 不被参数面拒（resources 是它读的那一档）",
  },
  {
    id: "spawn-mode-error-hides-supervise",
    src: "src/agent/orchestrator.ts",
    test: "tests/spawn-arg-surface.test.ts",
    desc: "纠错文案退回写死档名 ⇒ 打错 supervise 的模型被告知「supervise 不是档位」，一条纠错消息自己制造第二次错",
    apply: (s) => s.replace('output: "spawn_agent: mode 必须是 " + SPAWN_MODES.join("|")', 'output: "spawn_agent: mode 必须是 read|write|pipeline"'),
    expectFail: "打错档名的纠错消息列出全部档位（写死清单会把真存在的档说成不存在）",
  },
  {
    id: "spawn-surface-refusal-loses-direction",
    src: "src/agent/spawn-surface.ts",
    test: "tests/spawn-arg-surface.test.ts",
    desc: "拒绝语只说不读、不指路 ⇒ 模型知道失败却不知道 stages 该走 pipeline（本笔的价值一半在指路）",
    apply: (s) => s.replace('return who.length === 1 ? k + "（改用它：mode=" + who[0] + "）"', "return who.length === 1 ? k"),
    expectFail: "supervise + stages ⇒ 拒绝、点名 stages 与 pipeline，且零 worker 零审批（不花真钱、不打扰人）",
  },
  {
    id: "spawn-arg-table-loses-a-reader",
    src: "src/agent/spawn-surface.ts",
    test: "tests/spawn-arg-surface.test.ts",
    desc: "表里删掉某档的一个读键而代码仍在读 ⇒ 该键变成「谁都不读」，合法调用被凭空拒（过报侧唯一的机器哨兵）",
    apply: (s) => s.replace('"depends_on", "resources", "stages"]),', '"depends_on", "resources"]),'),
    expectFail: "表里每个键至少被一档读（新增一个谁都不读的参数 ⇒ 本条立刻红）",
  },
  {
    id: "spawn-arg-unknown-keys-silently-ignored",
    src: "src/agent/spawn-surface.ts",
    test: "tests/spawn-arg-surface.test.ts",
    desc: "未知键不再上报 ⇒ agent_type 这类笔误静默按默认面跑（与已修的 supervise 内层契约同一半没守住）",
    apply: (s) => s.replace("const unknown = declared.filter((k) => !known.has(k)).sort();", "const unknown: string[] = [];"),
    expectFail: "模型发明或笔误的顶层键（agent_type）算 unknown，并列出合法键对照",
  },
  // ---- 第 41 页 · 链申报的写租约逐环真持有（不是只在审批卡上印一行） ----
  {
    id: "chain-ring-does-not-hold-lease",
    // 针脚随实现搬家（2026-10-17 三缝拆分）：runChain 整支搬到 orchestrator-approvals.ts，锚文逐字未动。
    src: "src/agent/orchestrator-approvals.ts",
    test: "tests/chain-lease-held.test.ts",
    desc: "环不带链冻结的写面 ⇒ 登记表回到空租约，后来者看不见这条链正在写盘（合并阶段才炸）",
    apply: (s) => s.replace('        ...(ringResources.length > 0 && resolved.mode === "write" ? { resources: ringResources } : {}),\n', ""),
    expectFail: "pipeline：整链申报 resources ⇒ 环的 agent_spawned 带它，且环活着时 leaseConflicts 认得它",
  },
  {
    id: "chain-supervise-ring-drops-lease",
    // 针脚随实现搬家（2026-10-17 三缝拆分）：spawnSupervise 整支搬到 orchestrator-approvals.ts，锚文逐字未动。
    src: "src/agent/orchestrator-approvals.ts",
    test: "tests/chain-lease-held.test.ts",
    desc: "只修 pipeline 那一支（本仓点名的「同一条解析只硬化一支」）⇒ supervise 那条真轨迹路径照旧丢租约",
    apply: (s) => s.replace('          ...(ringResources.length > 0 && stageRole.mode === "write" ? { resources: ringResources } : {}), // 见上：申报过就真占（只读环不挂空租约）\n', ""),
    expectFail: "supervise：受限循环的环同样持有（真轨迹那次就是这么申报的）",
  },
  {
    id: "chain-read-ring-holds-phantom-lease",
    // 针脚随实现搬家（2026-10-17 三缝拆分）：runChain 整支搬到 orchestrator-approvals.ts，锚文逐字未动。
    src: "src/agent/orchestrator-approvals.ts",
    test: "tests/chain-lease-held.test.ts",
    desc: "去掉 write 守卫 ⇒ 只读环也在事件里挂一份永不生效的租约（「印了不占」的缩小版重演）",
    apply: (s) => s.replace('ringResources.length > 0 && resolved.mode === "write"', "ringResources.length > 0"),
    expectFail: "只读环不挂空租约：链声明了 resources 而环是 review ⇒ 环上没有它，也不占面",
  },
  {
    id: "automation-spec-invents-a-field",
    src: "src/agent/automation-surface.ts",
    test: "tests/automation-tool-surface.test.ts",
    desc: "规格发明一个校验器不认的字段 ⇒ 模型照规格写必被拒成「未知字段」（规格与校验器两处手写的必然下场）",
    apply: (s) => s.replace('name: "automation_create", fields: [...AUTOMATION_MODEL_FIELDS],', 'name: "automation_create", fields: [...AUTOMATION_MODEL_FIELDS, "owner"],'),
    expectFail: "每个工具申报的字段都在 KNOWN_TOP_FIELDS 里",
  },
  {
    id: "worker-selfname-ignored-by-orchestrator",
    src: "src/agent/orchestrator.ts",
    test: "tests/usage-attribution.test.ts",
    desc: "算出来不接（规则 230）：自述名有了、取值式子里却不读它 ⇒ 注入面带不带名字都一样，" +
      "而带名字那条用例只看 usage_model 会误绿——所以见证比的是「两档给出两个不同的钱数」",
    apply: (s) => s.replace(
      "usageModel = usageNameOf(model) || routedSpec?.model || glmDefaultModelName();",
      "usageModel = routedSpec?.model || glmDefaultModelName();",
    ),
    expectFail: "注入带自述名的模型 ⇒ 键用真名，且折价随它换档（旧实现两档注入给出同一个数）",
  },
  {
    id: "usage-name-of-skips-callable-check",
    src: "src/agent/worker-model.ts",
    test: "tests/usage-attribution.test.ts",
    desc: "不核可调用 ⇒ 任意带 usageName 字段的对象都被当成一路模型（这一格的入参来自 provider 侧，脏数据不该产出键）",
    apply: (s) => s.replace('  if (typeof model !== "function") return "";', "  if (false) return \"\";"),
    expectFail: "取值只有一个入口，且优先级写在式子里：自述名 > 路由 spec > 缺省档",
  },
  {
    id: "usage-name-of-accepts-non-string",
    src: "src/agent/worker-model.ts",
    test: "tests/usage-attribution.test.ts",
    desc: "自述位不核类型 ⇒ 数字/对象被当成模型名往下传，后面 `priceForModel` 反查不到却也不出声——" +
      "「不可知」要由空串表达，不能由一个非字符串值表达",
    apply: (s) => s.replace('return typeof name === "string" ? name : "";', "return (name ?? \"\") as string;"),
    expectFail: "取值只有一个入口，且优先级写在式子里：自述名 > 路由 spec > 缺省档",
  },
  {
    id: "orchestrator-spawned-usage-model-dropped",
    src: "src/agent/orchestrator.ts",
    test: "tests/usage-attribution.test.ts",
    desc: "spawned 事件不带归因键 ⇒ 主会话的钱可有数了，worker 那一半仍然定不了价（同一份预算里两条通路只修通一条，就是半落库）",
    apply: (s) => s.replace(
      '      ...(usageModel !== "" ? { usage_model: usageModel } : {}),\n',
      "",
    ),
    expectFail: "注入真拨模型 ⇒ 落 glmDefaultModelName 那一档，且跟着 CAIRN_MODEL 走（不是写死的名字）",
  },
  // ── 第 160 页 · 「能派不可撤」要在派活之前说出口（任务 #5）
  {
    id: "strands-predicate-ignores-visible-side",
    src: "src/agent/tool-surface.ts",
    test: "tests/skill-tool-policy.test.ts",
    desc: "只看「撤活被摘」、不看「派活还在不在」 ⇒ 连派活一起摘的配置也会喊一句「派出去撤不回」——那格根本没东西可派，喊出来是噪声（规则 208 的反向那一半）",
    apply: (s) => s.replace(
      "  return denied.has(CANCEL_AGENTS_NAME) && visible.has(SPAWN_AGENT_NAME);",
      "  return denied.has(CANCEL_AGENTS_NAME);",
    ),
    expectFail: "反向哨兵：连派活一起摘 ⇒ 不许再喊撤不回（没东西可派，就不该有这句吓人的话）",
  },
  {
    id: "strands-predicate-sides-swapped",
    src: "src/agent/tool-surface.ts",
    test: "tests/skill-tool-policy.test.ts",
    desc: "两边弄反（禁了派活、留着撤活时喊「撤不回」）⇒ 真该出声的那格（禁撤留派）永远不出声，而模型偏偏在这一轮把钱花成不可撤销",
    apply: (s) => s.replace(
      "  return denied.has(CANCEL_AGENTS_NAME) && visible.has(SPAWN_AGENT_NAME);",
      "  return denied.has(SPAWN_AGENT_NAME) && visible.has(CANCEL_AGENTS_NAME);",
    ),
    expectFail: "只摘撤活时注脚必须点出后果：派出去的 worker 这一轮撤不回来",
  },
  {
    id: "cancel-name-constant-drifts",
    src: "src/agent/tool-surface.ts",
    test: "tests/skill-tool-policy.test.ts",
    desc: "名字改动一处、另一处忘跟 ⇒ 谓词查的是不存在的键，这格从此恒不成立（工具名在本仓已有 `src/tools/cancel_agents.ts` 那份常量，这条锚点钉的是「两份不许漂」）",
    apply: (s) => s.replace(
      'export const CANCEL_AGENTS_NAME = "cancel_agents";',
      'export const CANCEL_AGENTS_NAME = "cancel";',
    ),
    expectFail: "名字不许长出第二份：tool-surface 的两个常量与 tools 里的常量、注入面清单三处同源",
  },
  {
    id: "worker-shell-cause-layer-unwired",
    src: "src/agent/worker-shell-tools.ts",
    test: "tests/shell-family-cause.test.ts",
    desc: "worker 两条 shell 出口不补归因 ⇒ 宿主注入沙箱 runner 时（那条路整个绕过 run_shell）"+
      "worker 的回执没有这一句。两处代码逐字相同 ⇒ 改法走逐行式、一次摘两层；"+
      "**只摘其中一支没有专属锚点**——那一支由自己的用例当行为证人（shell_rw 那条不许冒领 shell_ro 的断言）",
    apply: (s) => s.split("\n").map((l) => (l.includes("return annotateExecCause(res,")
      ? l.replace("annotateExecCause(res, { timedOut: res.timedOut === true, exitCode: res.exitCode ?? null })", "res")
      : l)).join("\n"),
    expectFail: "shell_ro 走注入出口",
  },

  /* ── 第 229 页（#45）：编排侧「这一次压根没派发出 worker」的结构列 `hold`。六支各钉一种坏法：
      返回体不盖章、依赖校验那一支不盖章、落流那两处不盖章、传播断在中间、落盘面把这一格丢掉、枚举漂出一格。
      刻意没有「取消／并发帽」两处落点的锚：同一挡位在两个出口上字面完全同形（`hold: "cancelled"` 两处），
      replace 只改第一处 ⇒ 第二处的证人照样绿，写了也是假装守护（规则 259/261）。 ── */
  {
    id: "orchestrator-hold-budget-return-not-stamped",
    // 针脚随实现搬家（2026-10-17 三缝拆分）：成本闸返回体整支搬到 orchestrator-budget.ts，
    // 锚文逐字未动（那把尺的取料面已并上该文件，见 tests/orchestrator-hold.test.ts 的 ORCH_SRC_ALL）。
    src: "src/agent/orchestrator-budget.ts",
    test: "tests/orchestrator-hold.test.ts",
    desc: "成本闸那条拒绝只留散文、不留结构列 ⇒ 模型看得见「被拒」，下游看不见是被哪一挡拒的：" +
      "钱与人手与取消在这一列上又长成同一个人。钉的是**返回体**那一半（落流那一半另有证人）",
    apply: (s) => s.replace('return { ok: false, hold: "budget", output:', 'return { ok: false, output:'),
    expectFail: "成本闸拒绝的 spawn 回执与出声事件都带 hold=budget",
  },
  {
    id: "orchestrator-hold-dependency-return-not-stamped",
    src: "src/agent/orchestrator.ts",
    test: "tests/orchestrator-hold.test.ts",
    desc: "把依赖校验第三支的盖章摘掉 ⇒ 「前环已经倒下」与「参数写错了」重新长成同一种红，" +
      "而这一格的正证恰好是**只有第三支**该有这一列：同用例里的负控（ghost 那条不盖章）会一起失去意义",
    apply: (s) => s.replace('return { ok: false, hold: "dependency-failed", why:', 'return { ok: false, why:'),
    expectFail: "前环倒下后的 spawn 回执带 hold=dependency-failed",
  },
  {
    id: "orchestrator-hold-chain-outlet-not-stamped",
    // 针脚随实现搬家（2026-10-17 三缝拆分）：failChain 整支搬到 orchestrator-approvals.ts，锚文逐字未动。
    src: "src/agent/orchestrator-approvals.ts",
    test: "tests/orchestrator-hold.test.ts",
    desc: "整链 failed 的落流不盖章 ⇒ 五挡里只有这一挡的读者回到零：链级「后面的环压根没起」在事件流上又不可读",
    apply: (s) => s.replace('      hold: "chain-failed",', ""),
    expectFail: "整链 failed 的落流带 hold=chain-failed",
  },
  {
    id: "orchestrator-hold-deferred-propagation-dropped",
    // 针脚随实现搬家（2026-10-17 三缝拆分）：triggerDeferredSpawn 整支搬到 orchestrator-approvals.ts，锚文逐字未动。
    src: "src/agent/orchestrator-approvals.ts",
    test: "tests/orchestrator-hold.test.ts",
    desc: "后环那一处只把因写进正文、不把结构列传下去 ⇒ 生产端与投影面对同一个因各判一次，" +
      "而这条用例同时钉着两半：结构那一格与正文里那个记号（两者要一起断才算这张网在）",
    apply: (s) => s.replace("        ...(r.hold === undefined ? {} : { hold: r.hold }),", ""),
    expectFail: "后环被成本闸拒绝：落流的 hold 与散文里的 reason= 由同一处派生",
  },
  // 第 315 页：记忆注入的降级面。三个消费者各一枚 ＋ 共用出口本身一枚（四枚各红不同用例）。
  {
    id: "memory-degraded-worker-silent-again",
    src: "src/agent/worker-prompt.ts",
    test: "tests/memory-degradation.test.ts",
    desc: "worker 侧不再拼那句降级说明 ⇒ 回到空 catch 的行为：整次注入断掉时 worker 读到的"
      + "「没有记忆」与「这仓库没写过教训」同形——它会据此决定要不要相信自己的经验",
    apply: (s) => s.replace(
      'if (mem.unavailable) messages.push({ role: "system", content: mem.unavailable });',
      'if (false) messages.push({ role: "system", content: mem.unavailable });',
    ),
    expectFail: "消费者① worker 任务书：同一个触发下，那句说明出现在 system 块里（从前那里是空 catch）",
  },
  // 第 320 页：三格无人判的模型可见断言（clampTier／supervise 契约／provider key 闸）。
  // 三根针脚都钉在 HEAD 已有的生产行上 ⇒ 这一轮「钉在飞文本」也应是 0（同数不同因，见第 319 页第 5 条）。
  {
    id: "clamp-tier-equal-rank-now-clamps",
    src: "src/agent/worker-report.ts",
    test: "tests/permission-mode-single-source.test.ts",
    desc: "把「不越界」那支的 `<=` 收紧成 `<` ⇒ 同档（default 派 default）也被当成越界并夹一遍，"
      + "worker 拿到 warning 说它「越界」——不越界那一支没有观测者时，这类收紧是无声的（第 320 页现读：全仓零测试调用 clampTier）",
    apply: (s) => s.replace(
      "if (permissionModeRank(requested) <= permissionModeRank(parent)) return { mode: requested, clamped: false };",
      "if (permissionModeRank(requested) < permissionModeRank(parent)) return { mode: requested, clamped: false };",
    ),
    expectFail: "clampTier 两支都钉：越界回父档并给出整句警告，不越界原样放过且不给警告",
  },
  {
    id: "supervise-unknown-keys-silently-accepted",
    src: "src/agent/supervise-contract.ts",
    test: "tests/supervise-contract.test.ts",
    desc: "把未知键那一步筛空 ⇒ 笔误键被静默收下、契约照建：模型以为 `forbiden` 禁住了某一面，实际什么都没禁，"
      + "而那句「拼错的键不会生效，故直接拒」永远不再出现（申报面与生效面分家＝本仓点过名的最坏形状）",
    apply: (s) => s.replace(
      "const unknown = Object.keys(o).filter((k) => !legal.includes(k));",
      "const unknown: string[] = [];",
    ),
    expectFail: "拒因里那句「拼错的键不会生效」跟着拒一起走：删掉它行为一件不变、模型少知道一件事",
  },
  {
    id: "plugin-role-security-keys-warning-merged-into-unknown",
    src: "src/agent/sequencer.ts",
    test: "tests/plugin-role-discoverability.test.ts",
    desc: "把安全约束那三件的警告并回普通未知键（丢掉「CC 安全约束照抄 §9.6」这一件）⇒ 用户看不出为什么 "
      + "hooks / permissionMode 被拒而 effort 只是「没落地」，本仓 §9.6 那条采纳口径就只剩注释在说",
    apply: (s) => s.replace("不支持（CC 安全约束照抄 §9.6），已忽略", "未知，已忽略"),
    expectFail: "安全约束那三件仍按原口径警告（本次改动不许把它们并入普通未知键）",
  },
  {
    id: "worktree-clean-glob-whitelist-dead",
    src: "src/agent/worktree.ts",
    test: "tests/worktree-pure.test.ts",
    desc: "A6 的 glob 白名单失效 ⇒ 含 [ ? * 的 agentId 拼进 `branch --list` 会匹配全部 agent 分支并循环删除",
    apply: (s) => s.replace("if (!/^[A-Za-z0-9_-]+$/.test(agentId)) {", "if (false) {"),
    expectFail: "含 glob 元字符 / 路径分隔 / 命令分隔符的 agentId 一律拒绝，且不动盘",
  },
  {
    id: "worktree-slug-empty-fallback-dropped",
    src: "src/agent/worktree.ts",
    test: "tests/worktree-pure.test.ts",
    desc: "空 slug 的 `task` 兜底被摘 ⇒ 折叠到空的 task 会造出空分支名/空 slug 目录",
    apply: (s) => s.replace("return s === \"\" ? \"task\" : s;", "return s;"),
    expectFail: "折叠到空 ⇒ 落 `task`（不许产出空分支名）",
  },
  {
    id: "orphan-ignores-owned-agents",
    src: "src/agent/worktree.ts",
    test: "tests/worktree-pure.test.ts",
    desc: "孤儿过滤不看 orchestrator 归属 ⇒ 另一会话运行中/待合并的 worker 在本会话日志里没有终态，"
      + "目录却是 workspace 级，于是被列进「可清理」面板——用户一点就删掉别人正在干活的树",
    apply: (s) => s.replace("!ownedAgentIds.has(agentId) && ", ""),
    expectFail: "进程内仍有归属（运行中/待合并）⇒ 不算孤儿；未归属的 running 仍算（崩溃遗留仍要捞）",
  },
  {
    id: "orphan-scan-drops-owned-wiring",
    src: "src/main/state-handlers.ts",
    test: "tests/orphan-cross-session.test.ts",
    desc: "扫描入口不把归属集合接进去 ⇒ 纯函数那一格写对了但这一格永远传空集：跨会话活 worker 照样进清理面板"
      + "（规则 230：只写纯函数不接＝没有读数）",
    apply: (s) => s.replace("    new Set(ownedWorktreeAgentIds()),", "    new Set(),"),
    expectFail: "orchestrator 仍归属的 w1 ⇒ 即使本会话日志没有终态，也不列孤儿",
  },
  {
    id: "orphan-clean-ignores-live-owner",
    src: "src/agent/worktree.ts",
    test: "tests/worktree-branch-reuse.test.ts",
    desc: "显式 clean 不看归属 ⇒ 旧界面/脚本直接调 clean 就能删掉运行中/待合并的活树；"
      + "展示层过滤不是删除决策的闸，clean 自己必须再拒一次",
    apply: (s) => s.replace("  if (opts.ownedAgentIds?.has(agentId)) {", "  if (false) {"),
    expectFail: "仍归属的 agent：cleanOrphanWorktree 也拒绝，文件原样保留（clean 不假定调用方筛过）",
  },
  {
    id: "worktree-slug-dangling-hyphen-kept",
    src: "src/agent/worktree.ts",
    test: "tests/worktree-pure.test.ts",
    desc: "截断后的悬空连字符回退被摘 ⇒ 24 字符处正好截在连字符上时分支名以 `-` 结尾",
    apply: (s) => s.replace("    .slice(0, 24)\n    .replace(/-+$/g, \"\");", "    .slice(0, 24);"),
    expectFail: "截断后不留悬空连字符（否则分支名以 `-` 结尾）",
  },
];
