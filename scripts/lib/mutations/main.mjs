// main 域的变异配置条目（2026-10-17 从 scripts/mutate-verify.mjs 按域拆出，见 PROGRESS 第 501 页）。
// 每条 = 一处语义突变 + 期望被它杀死的具体用例标题。追加条目时放进对应域的文件；
// **组间顺序不影响任何判据**（每条独立），同一文件内保持原顺序以便 diff。
export const MUTATIONS = [
  {
    id: "ask-gate-unattended-fail-closed",
    src: "src/main/ask-gate.ts",
    test: "tests/ask-gate.test.ts",
    desc: "unattended 不立即拒绝而是进 60s 等待（fail-closed 退回等待）",
    apply: (s) => s.replace("if (this.opts.unattended || (this.opts.hasAnswerer && !this.opts.hasAnswerer())) {", "if (false) {"),
    expectFail: "M4a unattended：无人值守立即拒绝（fail-closed 不等 60s），落流 reason=unattended",
  },
  {
    id: "ask-gate-unattended-notify",
    src: "src/main/ask-gate.ts",
    test: "tests/ask-gate.test.ts",
    desc: "unattended 仍调用 notify（弹审批 UI，与「无人在场」矛盾）",
    apply: (s) => s.replace(
      '      this.opts.notifyOutcome?.(askId, "rejected", "unattended");',
      '      this.opts.notify?.({ askId, tool, args });\n      this.opts.notifyOutcome?.(askId, "rejected", "unattended");',
    ),
    expectFail: "unattended 下 notify 不被调用（无 UI 等待，直接拒绝）",
  },
  {
    id: "ask-gate-session-id-not-forwarded",
    src: "src/main/ask-gate.ts",
    test: "tests/ask-gate.test.ts",
    desc: "发卡时不把会话归属透进 notify 载荷（审批卡重新变成无主项——渲染层无从判断这张卡在问哪个会话，跨会话串台的成因）",
    apply: (s) => s.replace(
      "      this.opts.notify?.({ askId, tool, args, ...notifyCtx });",
      "      const { sessionId: _dropped, ...restCtx } = notifyCtx as Record<string, unknown>;\n      this.opts.notify?.({ askId, tool, args, ...restCtx });",
    ),
    expectFail: "ctx.sessionId 透进 notify 载荷（卡的会话归属）；缺省 = 键缺席而非 undefined 属性",
  },
  {
    // 桌面层第五条锚点（第 490 页）：BYOK 的 fail-closed。`!backend ⇒ 拒存` 这一支若被摘掉，
    // headless（未装配 safeStorage）上 putProviderKey 会继续往下走——而下游那几步默认假定
    // 「已经加密过了」，于是明文 key 落盘。**这正是 secrets.ts 那条纪律要防的事**，
    // 而它在本文件里此前没有变异锚点。
    id: "provider-key-no-backend-fails-open",
    src: "src/main/provider-keys.ts",
    test: "apps/desktop/tests/provider-keys.test.ts",
    // 被测面在 core、判卷在桌面层 ⇒ **必须自带 config**。第一版漏了它 ⇒ runTest 拿核心那份
    // 配置在库根跑，而桌面判卷不在核心 include 里 ⇒ 选中 0 条、退出码 0，
    // 于是这一条读成 vacuous（第 490 页：桌面锚点忘带 config 就是这个形状）。
    config: "apps/desktop/vitest.config.ts",
    desc: "无安全后端时不再拒存（fail-closed 那支被摘）⇒ headless 上明文 provider key 落盘；"
      + "功能面看不出异常（有后端时两条路行为逐字相同），只有未装配 safeStorage 才分得开",
    // needle 必须**唯一**：`if (!backend) return { ok: false, error: PROVIDER_KEY_NO_BACKEND_ERROR };`
    // 在源里出现两次（put 与 delete）。第一版只写那一行 ⇒ 针脚体检报「命中 2 处，需人工复认」。
    // 连下一行一起写才唯一（`isProviderId` 那一支只有 put 有）。
    // 标题必须逐字等于桌面判卷里那条用例名（近似标题 ⇒ 选择子零命中＝vacuous，第 483/490 页栽过两次）。
    apply: (s) => s.replace("  if (!backend) return { ok: false, error: PROVIDER_KEY_NO_BACKEND_ERROR };\n  if (!isProviderId(provider)) return { ok: false, error: \"未知 provider：\" + provider + \"（白名单：\" + PROVIDER_IDS.join(\"/\") + \"）\" };", "  // 变异：fail-closed 那支摘掉"),
    expectFail: "fail-closed：safeStorage 不可用 ⇒ 装配拒绝 + set 拒绝不落明文（目录零文件）；未装配后端同判",
  },
  {
    id: "provider-keys-fail-closed",
    src: "src/main/provider-keys.ts",
    test: "tests/provider-keys.test.ts",
    desc: "safeStorage 不可用时仍装配后端（绕过 fail-closed → 明文退路）",
    apply: (s) => s.replace("if (!io.isEncryptionAvailable()) return false;", "if (false) return false;"),
    expectFail: "fail-closed：无后端（safeStorage 不可用）→ 拒存 + 显式错误；任何路径不产生 store 文件",
  },
  {
    id: "license-sig-verify",
    src: "src/main/license.ts",
    test: "tests/license.test.ts",
    desc: "签名校验失败仍放行（伪造/篡改的 license 被接受，离线授权形同虚设）",
    apply: (s) => s.replace("if (!sigOk) return { state: \"invalid\",", "if (false) return { state: \"invalid\","),
    expectFail: "验签矩阵②：篡改 body（licensee / expires_at 改任一字节）→ invalid（签名校验失败）",
  },
  {
    id: "license-expiry",
    src: "src/main/license.ts",
    test: "tests/license.test.ts",
    desc: "过期判定被拆（过期 license 仍 valid，时效授权可无限续用）",
    apply: (s) => s.replace("if (parsed.expiresAt !== null && Date.parse(parsed.expiresAt) < now) {", "if (false) {"),
    expectFail: "验签矩阵③：过期判定（expires_at 早于 now）→ expired；等于边界内不算过期",
  },
  {
    id: "license-expiry-boundary",
    src: "src/main/license.ts",
    test: "tests/license.test.ts",
    desc: "过期比较从严格小于改成小于等于（恰在到期时刻被误判过期）",
    apply: (s) => s.replace(
      "parsed.expiresAt !== null && Date.parse(parsed.expiresAt) < now",
      "parsed.expiresAt !== null && Date.parse(parsed.expiresAt) <= now",
    ),
    expectFail: "验签矩阵③：过期判定（expires_at 早于 now）→ expired；等于边界内不算过期",
  },
  {
    id: "license-unknown-fields",
    src: "src/main/license.ts",
    test: "tests/license.test.ts",
    desc: "未知字段不拒绝（license 可夹带任意额外内容，规范边界破裂）",
    apply: (s) => s.replace("if (unknown.length > 0) return { error: \"未知字段：", "if (false) return { error: \"未知字段："),
    expectFail: "验签矩阵⑤：结构坏（非对象 / licensee 缺 / signature 缺 / 未知字段 / expires_at 非法）→ invalid 带原因",
  },
  {
    id: "license-canonical-order",
    src: "src/main/license.ts",
    test: "tests/license.test.ts",
    desc: "canonical body 字段序被打乱（签发与验签不一致，合法 license 全部验签失败）",
    apply: (s) => s.replace(
      "JSON.stringify({ licensee: lic.licensee, expires_at: lic.expires_at ?? null })",
      "JSON.stringify({ expires_at: lic.expires_at ?? null, licensee: lic.licensee })",
    ),
    expectFail: "licenseBodyOf 是 canonical（字段序固定 + 缺省 expires_at 归一 null）——签发与验签共用",
  },
  {
    id: "license-badjson-not-inactive",
    src: "src/main/license.ts",
    test: "tests/license.test.ts",
    desc: "坏 JSON 冒充 inactive（损坏的 license 被当成「未激活」而非 invalid，状态机混淆）",
    apply: (s) => s.replace("const missing = (err as NodeJS.ErrnoException).code === \"ENOENT\";", "const missing = true;"),
    expectFail: "verifyLicenseFile：无文件 = inactive（未激活不阻断）；坏 JSON = invalid；好文件走同一矩阵",
  },
  {
    id: "sandbox-sensitive-deny",
    src: "src/main/sandbox.ts",
    test: "tests/sandbox.test.ts",
    desc: "敏感目录拒读规则被移除（.ssh/.aws/Keychains 在沙箱内可读 = 密钥泄漏）",
    apply: (s) => s.replace("lines.push('(deny file-read* (subpath \"' + join(home, rel) + '\"))');", "/* mutated: 敏感目录拒读被移除 */"),
    expectFail: "可写根与敏感目录路径全部 realpath（坑一：/tmp 实为 /private/tmp）",
  },
  {
    id: "sandbox-deny-default",
    src: "src/main/sandbox.ts",
    test: "tests/sandbox.test.ts",
    desc: "移除 (deny default)（沙箱从默认拒绝变成默认放行，所有约束失效）",
    apply: (s) => s.replace("    \"(deny default)\",\n", ""),
    expectFail: "默认断网：deny default 且无任何 network 放行",
  },
  {
    id: "sandbox-write-confinement",
    src: "src/main/sandbox.ts",
    test: "tests/sandbox.test.ts",
    desc: "写收敛退化为全盘可写（沙箱外任意路径可写 = 破坏面失控）",
    apply: (s) => s.replace("'(allow file-write* (subpath \"' + root + '\"))'", "'(allow file-write*)'"),
    expectFail: "可写根与敏感目录路径全部 realpath（坑一：/tmp 实为 /private/tmp）",
  },
  {
    id: "sandbox-realpath",
    src: "src/main/sandbox.ts",
    test: "tests/sandbox.test.ts",
    desc: "SBPL 路径不走 realpath（/tmp 与 /private/tmp 对不上，规则静默失效 = 假沙箱）",
    apply: (s) => s.replace(
      "  const root = real(writableRoot);\n  const home = real(homedir());",
      "  const root = writableRoot;\n  const home = homedir();",
    ),
    expectFail: "可写根与敏感目录路径全部 realpath（坑一：/tmp 实为 /private/tmp）",
  },
  {
    id: "sessions-delete-force-false",
    src: "src/main/sessions.ts",
    test: "tests/sessions.test.ts",
    desc: "删除改用 force:true（不存在的会话静默成功，fail-loud 语义失效）",
    apply: (s) => s
      .replace("await rename(source, staged);", "await rename(source, staged).catch(() => undefined);")
      .replace("await rm(staged, { force: false });", "await rm(staged, { force: true });"),
    expectFail: "非法名字 fail-closed（路径分隔/点开头/空）；删除不存在会话抛错",
  },
  {
    id: "sessions-mtime-desc",
    src: "src/main/sessions.ts",
    test: "tests/sessions.test.ts",
    desc: "会话列表排序反转（最近在上 → 最旧在上，当前会话回退取错）",
    apply: (s) => s.replace("// 竞态删除/不可读：跳过，不出现在列表\n    }\n  }\n  return out.sort((a, b) => b.mtimeMs - a.mtimeMs);", "// 竞态删除/不可读：跳过，不出现在列表\n    }\n  }\n  return out.sort((a, b) => a.mtimeMs - b.mtimeMs);"),
    expectFail: "mtime 降序（最近在上）——当前会话回退取列表首个的数据面",
  },
  {
    id: "sessions-collision-suffix",
    src: "src/main/sessions.ts",
    test: "tests/sessions.test.ts",
    desc: "撞名序号从 2 起（① 冲突覆盖：同名会话被新建空文件覆盖）",
    apply: (s) => s.replace("  for (let attempt = 2; ; attempt += 1) {", "  for (let attempt = 1; ; attempt += 1) {"),
    expectFail: "新建撞名自动加序号；空目录列表为空",
  },
  {
    id: "sessions-lines-nonempty",
    src: "src/main/sessions.ts",
    test: "tests/sessions.test.ts",
    desc: "行数口径把空行计入（投影事件数虚高 +1，验收口径破裂）——2026-09-20 改指 d9f4d0b 搬进 countNonEmpty 的那一处",
    apply: (s) => s.replace("for (const s of segments) if (s.trim().length > 0) n++;", "for (const s of segments) n++;"),
    expectFail: "追加后按增量计数：含纯空白行不计、未换行尾段计 1 且补全后不双计",
  },
  {
    id: "sessions-name-trim",
    src: "src/main/sessions.ts",
    test: "tests/sessions.test.ts",
    desc: "会话名 trim 检查被拆（前后空白的名字合法，列表显示与文件名不一致）",
    apply: (s) => s.replace("name.trim() === name", "true"),
    expectFail: "前后空白的名字非法（trim 规则）",
  },
  {
    id: "sessions-name-charset",
    src: "src/main/sessions.ts",
    test: "tests/sessions.test.ts",
    desc: "会话名字符集闸整条拆除（路径分隔/控制字符/点号全放行 → 目录穿越与伪装名）",
    apply: (s) => s.split("\n").map((l) => (l.includes("name.trim() === name") ? "  return true;" : l)).join("\n"),
    expectFail: "控制字符 / 点号开头的名字非法",
  },
  {
    id: "sessions-path-guard",
    src: "src/main/sessions.ts",
    test: "tests/sessions.test.ts",
    desc: "sessionPath 的非法会话名闸被拆（重命名到可写路径的非法名字静默成功）",
    apply: (s) => s.replace("if (!isValidSessionName(id)) throw new Error(`非法会话名: ", "if (false) throw new Error(`非法会话名: "),
    expectFail: "deleteSession / readSessionEvents 对非法名字直接拒绝（消息=非法会话名，而非 ENOENT）",
  },
  {
    id: "sessions-rename-clash",
    src: "src/main/sessions.ts",
    test: "tests/sessions.test.ts",
    desc: "重命名撞名检查被拆（目标会话被静默覆盖，用户数据丢失）",
    apply: (s) => {
      const lines = s.split("\n");
      const i = lines.findIndex((l, j) => l.trim() === "try {" && lines[j + 1] !== undefined && lines[j + 1].includes("await stat(to);"));
      if (i < 0) return s;
      let j = i + 1;
      while (j < lines.length && lines[j] !== "  }") j++;
      lines.splice(i, j - i + 1);
      return lines.join("\n");
    },
    expectFail: "重命名撞名被拒：目标会话内容不被覆盖",
  },
  {
    id: "sessions-queue-orphan-inherited",
    src: "src/main/sessions.ts",
    test: "tests/sessions.test.ts",
    desc: "新建会话不再清孤儿 sidecar（JSONL 被外部删掉后，同名新会话继承上一条会话没发完的队列 —— 别人的待发消息会被当成新会话的话发出去）",
    apply: (s) => s.replace(
      "  await rm(queuePath(root, id), { force: true }).catch(() => undefined);",
      "  // 变异：不清孤儿 sidecar",
    ),
    expectFail: "孤儿 sidecar 不被同名新会话继承（JSONL 被外部删掉后留下的队列不许易主）",
  },
  {
    id: "sessions-meta-head-strict",
    src: "src/main/sessions.ts",
    test: "tests/sessions.test.ts",
    desc: "scheduled 徽标的投影条件被拆（每个会话都带上自动化徽标 = 面板在撒谎）——2026-09-20 改指 d9f4d0b 搬进 projectHeadLine 的那一处；同行的 meta.type 校验是 belt-and-braces，判据看不见它（首行本来就是 session_meta），不另立锚点",
    apply: (s) => s.replace('...(meta.origin === "scheduled"', "...(true"),
    expectFail: "首行是 session_meta 但没有 origin ⇒ 同样不投影（origin 半边：上面那条判不到它，变异存活实测抓出来的缺口）",
  },
  // ---- 09-27 同一族的第三、四支：**主会话**那一桶的价键。两道美元闸原先读设置盘字段、拨号读 resolved
  // spec，实测三种合法配置下分叉（留空 ⇒ 闸惰；指定强档 ⇒ 只读到实付 1/4；指定便宜档 ⇒ 读到 10 倍）。
  {
    id: "session-budget-key-from-settings-field",
    src: "src/main/agent-runner.ts",
    test: "tests/budget-price-key.test.ts",
    desc: "会话成本闸的价键退回设置盘那个字段（拨号仍按 resolved 档）⇒ 闸与实付两个数：最常见的「model 留空」配置下整闸惰掉",
    apply: (s) => s.replace("priceModel: budgetPriceKeyOf(runModel ?? resolveRunModel(s))", "priceModel: s.model"),
    expectFail: "两处消费各自接线在位",
  },
  {
    id: "goal-budget-key-from-settings-field",
    src: "src/main/goal-handlers.ts",
    test: "tests/budget-price-key.test.ts",
    desc: "只修会话闸、goal 美元闸那一半退回读盘上字段 ⇒ 同一个 run 里两道闸各说各话（判据要求两条接线同时在位）",
    apply: (s) => s.replace("  const model = D().budgetPriceKeyOf(args.runModel);", "  const model = (await store().get()).model;"),
    expectFail: "两处消费各自接线在位",
  },
  {
    id: "run-model-resolution-drops-request-model",
    src: "src/main/agent-runner.ts",
    test: "tests/budget-price-key.test.ts",
    desc: "解析时丢掉逐请求指定的模型 ⇒ 闸与拨号仍然「一致」但一起错档：只比「闸=拨号」的判据零分辨力，咬住它的是那条「必须与设置盘字段折出的数不同」的牙齿",
    apply: (s) => s.replace("    ...(requestModel !== undefined ? { requestModel } : {}),\n", ""),
    expectFail: "per-run 指定强档",
  },
  // ---- #84（plan 半）：方案门读的是**盘上事实**，不是内存布尔 ----
  // 摘掉 run 入口那次播种，门就退回「每条用户消息从全 false 重武装」：未批准的方案跨不出本轮，
  // 而 propose_plan 给模型的回执原文写的是「写禁保持（存在未批准 plan）」——承诺与行为再次分叉。
  {
    id: "plan-pending-drops-at-next-run",
    src: "src/main/agent-runner.ts",
    test: "tests/plan-persist-cross-run.test.ts",
    desc: "run 入口不播种 ⇒ 第一轮被拒/没人批的方案，第二轮写面敞开（那句话只在 run 内为真，换个 turn 就翻脸）",
    apply: (s) => s.replace("if (opts.sessionId) seedPendingPlanFromEvents(await replay(opts.logPath)", "if (opts.sessionId) void (await replay(opts.logPath)"),
    expectFail: "第一轮方案被拒 ⇒ 第二轮（新 run）写盘仍被方案门挡住，盘上不留痕",
  },
  // ---- 能力 8/10 的诚实性：run 抛异常也要落一条 goal_stopped（否则芯片继续显示「续跑中」）----
  {
    id: "goal-stopped-not-emitted-on-throw",
    src: "src/main/agent-runner.ts",
    test: "tests/goal-stopped-on-throw.test.ts",
    desc: "catch 里的补记录摘掉 ⇒ 异常收场不落 goal_stopped：事件流与渲染层一起说「还在跑」，而那条 run 已经死了",
    apply: (s) => s.replace("try { await emitGoalStoppedOnThrow(opts.logPath, opts.sessionId, err); }", "try { void 0; }"),
    expectFail: "run 中途抛 ⇒ 盘上恰有一条点名异常的 goal_stopped，投影读得到 stopped",
  },
  {
    id: "goal-gate-call-site-bypassed",
    src: "src/main/goal-handlers.ts",
    test: "tests/goal-continue.test.ts",
    desc: "调用点递空窗口（函数没错、闸拿不到数）⇒ 美元闸惰掉，理由退到轮次上限，用户设的钱闸变随机数",
    apply: (s) => s.replace("goalWindowSpend(view.window, model)", "goalWindowSpend([], model)"),
    expectFail: "设 $0.05 上限 × 一轮 200k/20k 用量 ⇒ goal_stopped 点名美元上限（不被轮次/无产出理由顶包）",
  },
  {
    id: "goal-lag-count-not-passed-at-call-site",
    src: "src/main/goal-handlers.ts",
    test: "tests/goal-stop-decision.test.ts",
    // 第一版写这条时**变异存活**：goalReminder 的默认值是 0 ⇒ "省略这一位"与"传 0"行为逐字相同，
    // 而可选参数后面加不了必填，编译器也接不了这格。改由那条生产入口形状断言守住
    // （与 `decision.hint` 同一处、同一手法），这条才有了可杀的靶子。
    desc: "调用点不递第 6 个实参 ⇒ 提醒块永远不提「本拍的美元里还没有在途 worker 那一段」",
    apply: (s) => s.replace("goalReminder(view.spec, turn, spentUsd, view.evidence, decision.hint, unbookedWorkers)", "goalReminder(view.spec, turn, spentUsd, view.evidence, decision.hint)"),
    expectFail: "生产入口真的把 decision.hint 传进去（拆分后住 goal-handlers，仍只能钉这一行的形状）",
  },
  {
    id: "prompt-cache-default-flipped-back-off",
    src: "src/main/settings.ts",
    test: "tests/settings.test.ts",
    desc: "缺省翻回 false（2026-09-19 开闸裁决被静默撤销：新用户首启即关，Anthropic 写侧断点整条不上线）",
    apply: (s) => s.replace("  promptCache: true,\n", "  promptCache: false,\n"),
    expectFail: "缺省值本身也是开（两处必须同向：DEFAULT_SETTINGS 与读盘回退）",
  },
  {
    id: "prompt-cache-reader-loses-fallback",
    src: "src/main/settings.ts",
    test: "tests/settings.test.ts",
    desc: "读法退回 `=== true`（磁盘上已有 settings JSON 的老用户没这个键 → undefined === true 把「缺省开」读成关；DEFAULT_SETTINGS 仍写着 true，只看对象测不出）",
    apply: (s) => s.replace(
      "    promptCache: typeof r.promptCache === \"boolean\" ? r.promptCache : d.promptCache,\n",
      "    promptCache: r.promptCache === true,\n",
    ),
    expectFail: "老 JSON（完全没有该键）读回来必须是 true",
  },
  {
    id: "verify-exec-timeout-not-forwarded",
    src: "src/main/agent-runner.ts",
    test: "tests/verify-exec-sandbox.test.ts",
    desc: "沙箱出口把 timeoutMs 丢掉 ⇒ 语言探测的 300s 在发货缺省路径上不生效，冷编译照旧被 60s 掐死",
    apply: (s) => s.replace("const res = await run(mapped, { cwd, ...(timeoutMs ? { timeoutMs } : {}) });", "const res = await run(mapped, { cwd });"),
    expectFail: "超时透传给 runInSandbox；未给时不写这个键（沿用沙箱自己的缺省，不越权改写）",
  },
  {
    id: "verify-exec-sandbox-bypassed",
    src: "src/main/agent-runner.ts",
    test: "tests/verify-exec-sandbox.test.ts",
    desc: "沙箱可用与否都直接走 defaultExec ⇒ verify 的 lint/test 逃逸到沙箱外跑（写收敛 / 拒读 / 断网三道壁全失效）",
    apply: (s) => s.replace("  if (!sandbox?.available) return defaultExec;", "  if (true) return defaultExec;"),
    expectFail: "超时透传给 runInSandbox；未给时不写这个键（沿用沙箱自己的缺省，不越权改写）",
  },
  {
    id: "verify-exec-pnpm-mapping-lost",
    src: "src/main/sandbox-test-command.ts",
    test: "tests/verify-exec-sandbox.test.ts",
    desc: "丢掉「沙箱内 pnpm 映射为直连 vitest」（坑三）⇒ 冻结剧本里的 pnpm test 在 Seatbelt 下必然起不来，验证门空转。第 141 页把三处内联副本收成一份 `mapSandboxTestCommand`，针脚跟着搬到那一份身上——现在摘掉它＝worker／验证门／模型 run_shell 三条路一起坏，一条锚点管得住三处。",
    apply: (s) => s.replace("  return aliases.includes(command.trim()) ? VITEST_DIRECT : command;", "  return command;"),
    expectFail: "pnpm test / pnpm run test 映射为直连 vitest；其它命令逐字不动",
  },
  {
    id: "sandbox-model-alias-widened",
    src: "src/main/sandbox-test-command.ts",
    test: "tests/verify-exec-sandbox.test.ts",
    desc: "把模型那条 `run_shell` 的窄名单悄悄放宽成全表 ⇒ 我们开始替模型改写它自己下的命令（这条差集是裁决，不是漂：改的是「同意范围」那一族）",
    apply: (s) => s.replace('export const MODEL_SHELL_TEST_ALIASES: readonly string[] = ["pnpm test"];', "export const MODEL_SHELL_TEST_ALIASES: readonly string[] = [...SANDBOX_TEST_ALIASES];"),
    expectFail: "窄名单逐字钉住，且与全表的双向差集都要点名（加一条进窄表＝绕开裁决给模型改命令）",
  },
  {
    id: "sandbox-mapping-copy-reintroduced",
    src: "src/main/session-assembly.ts",
    // 2026-10-17 搬迁：锚文随实现搬去 session-assembly.ts（agent-runner 三刀之第三刀），逐字未动。
    test: "tests/verify-exec-sandbox.test.ts",
    desc: "worker 那一支退回内联三元 ⇒ 同一谓词 again 两份副本，下一轮改动只会漂其中一份（第十三族；第 141 页复认针脚歧义时就是被这三行逐字相同的副本坑到的）",
    // 针脚改指（2026-10-02 修）：`404249c`（修 verify 假红）把 `mapSandboxTestCommand(command)` 扩成
    // 工作区感知的 `mapSandboxTestCommandForWorkspace(command, ctx.workspace)` ⇒ 旧针脚失针。
    // 谓词的**副本判定**没变（判卷数的是 `? VITEST_DIRECT : command` 的出现次数必须是 1），
    // 所以变异体逐字照旧，只把针脚跟上新调用。
    // 注释必须留在 `apply:` **外面**：写在调用里会让静态取针读不出字面量（体检当场报「未覆盖」，实测）。
    apply: (s) => s.replace(
      "  return async (command, ctx) => {\n    const mapped = mapSandboxTestCommandForWorkspace(command, ctx.workspace);",
      '  return async (command, ctx) => {\n    const mapped = command.trim() === "pnpm test" || command.trim() === "pnpm run test" ? VITEST_DIRECT : command;',
    ),
    expectFail: "消费者不再各自内联那句三元：`? VITEST_DIRECT : command` 全文件只剩映射器里那一处",
  },
  {
    id: "verify-exec-reports-internal-command",
    src: "src/main/agent-runner.ts",
    test: "tests/verify-exec-sandbox.test.ts",
    desc: "结果里回报内部映射串 ⇒ 事件流与面板显示的是我们拼出来的绝对路径命令，人看不到模型实际下的那条（可审计性受损）",
    apply: (s) => s.replace("      command,\n      ok: res.ok,", "      command: mapped,\n      ok: res.ok,"),
    expectFail: "结果里的 command 用模型下的原命令（事件流给人看的不是内部映射串）",
  },
  {
    id: "prompt-command-dispatch-never-runs",
    src: "src/main/agent-runner.ts",
    test: "tests/plugin-commands-dispatch.test.ts",
    desc: "派发拿到的命令表是空的 ⇒ commands/*.md 又被装载一次却依旧没人解析（§9.4「渲染成用户消息进事件流」回到今日现状），用户敲 /cmd 得到一串死文本",
    apply: (s) => s.replace("    const expanded = expandPromptCommand(rt?.commands() ?? [], opts.message, (c) => rt?.substitutionFor(c) ?? {});", "    const expanded = expandPromptCommand([], opts.message, (c) => rt?.substitutionFor(c) ?? {});"),
    expectFail: "/cmd-demo:wave 张三 → 落流的是渲染后的正文，不是那串斜杠",
  },
  {
    id: "prompt-command-refused-silent",
    src: "src/main/agent-runner.ts",
    test: "tests/plugin-commands-dispatch.test.ts",
    desc: "user-invocable:false 不再出声 ⇒ 那串斜杠原样进模型，模型只能猜（把「不可调用」降级成静默）",
    apply: (s) => s.replace("    if (expanded.refused !== null) {", "    if (false) {"),
    expectFail: "user-invocable:false 的命令：不出正文也不静默丢给模型，出声说明被拒",
  },
  {
    id: "session-end-producer-removed",
    src: "src/main/agent-runner.ts",
    test: "tests/hook-session-end.test.ts",
    desc: "摘掉 finally 里的 SessionEnd 生产者 ⇒ 事件名还在枚举表上、面板照旧计数，但没有任何会话会触发收尾钩子",
    apply: (s) => s.replace('        const se = await rtNow.hooks.run("SessionEnd", { event: "SessionEnd", trigger: "exit" });', '        const se = { errors: [], blocked: false };'),
    expectFail: "提示词被钩子阻断的早退路径也收尾（生产者在 finally，不在 try 尾）",
  },
  {
    id: "session-end-double-producer",
    src: "src/main/agent-runner.ts",
    test: "tests/hook-session-end.test.ts",
    desc: "SessionEnd 在 try 尾与 finally 各挂一处 ⇒ 每次会话终止跑两遍收尾钩子（提交、通知、清理这类有副作用的钩子最恨被跑两遍）。哨兵必须**追加**写才看得见这条：写成功与否是个布尔，看不出 1 次还是 2 次",
    apply: (s) => s.replace('        await rt.hooks.run("Stop", { event: "Stop", trigger: "run_complete" });', '        await rt.hooks.run("SessionEnd", { event: "SessionEnd", trigger: "run_complete" });\n        await rt.hooks.run("Stop", { event: "Stop", trigger: "run_complete" });'),
    expectFail: "会话终止真的跑 SessionEnd 钩子，且只跑一次",
  },
  {
    id: "skill-tool-drops-args-arg",
    src: "src/main/tool-gates.ts",
    test: "tests/plugin-commands-dispatch.test.ts",
    desc: "工具执行面不读 args.args ⇒ 替换器永远收到空串。上面那条锚点杀的是「runtime 不替换」，这条杀的正是最后那一跳：接缝都在、参数没接",
    apply: (s) => s.replace('        return rt.triggerSkill(name, typeof args.args === "string" ? args.args : "");', '        return rt.triggerSkill(name);'),
    expectFail: "模型经 skill 工具下的 args 真的进替换器（tool_result 里是替换后的正文）",
  },
  {
    id: "skill-tool-spec-hides-args",
    src: "src/main/tool-gates.ts",
    test: "tests/plugin-commands-dispatch.test.ts",
    desc: "规格面不声明 args ⇒ 执行面读得到但模型看不见，等于这条参数通道对模型不存在（§4.4 三面同源的老形状）",
    apply: (s) => s.replace('          args: { type: "string", description: "传给 skill 的参数原文（正文里的 $ARGUMENTS / $1 / $name 按此替换；无参数可省略）" },', '          ...(false ? { args: { type: "string", description: "x" } } : {}),'),
    expectFail: "skill 工具的规格面声明了 args（模型看得见才有那条参数通道；与执行面同源）",
  },
  {
    id: "plugin-lsp-never-activated",
    src: "src/main/agent-runner.ts",
    test: "tests/plugin-lsp-activation.test.ts",
    desc: "运行时装载了插件、面板数了 .lsp.json，却没人调激活 ⇒ 装载即陈列回到原样（这条锚点杀的是**入口那一跳**，不是激活函数本身）",
    apply: (s) => s.replace("      rt.activateLsp();", "      void 0;"),
    expectFail: "runAgent 里注册的 id 与面板口径同源；未激活（把那一行摘掉）就是红",
  },
  {
    id: "user-skill-face-never-dispatched",
    src: "src/main/agent-runner.ts",
    test: "tests/skill-user-invocation.test.ts",
    desc: "用户侧 skill 派发整条取消 ⇒ 用户敲 /skill 得到一串死文本，disable-model-invocation 的 skill 变成永远不可用",
    apply: (s) => s.replace("      ? expandSkillInvocation(rt?.skills() ?? [], expanded.text, (s) => rt?.substitutionFor(s) ?? {})", "      ? { text: expanded.text, hit: null as { invoke: string; args: string } | null }"),
    expectFail: "/sk-demo:say 你好 → 落流的是替换过的正文，且带 skill 归属",
  },
  {
    id: "user-skill-substitution-context-dropped",
    src: "src/main/agent-runner.ts",
    test: "tests/skill-user-invocation.test.ts",
    desc: "用户侧不传替换上下文 ⇒ 同一条 SKILL.md 模型点开来变量是活的、用户点开来是一串 ${SKILL_DIR}",
    apply: (s) => s.replace("      ? expandSkillInvocation(rt?.skills() ?? [], expanded.text, (s) => rt?.substitutionFor(s) ?? {})", "      ? expandSkillInvocation(rt?.skills() ?? [], expanded.text)"),
    expectFail: "用户侧触发同样吃 §9.3 的变量面（${SKILL_DIR} 不是只给模型的那条才展开）",
  },
  {
    id: "user-skill-hit-not-threaded-to-loop",
    src: "src/main/agent-runner.ts",
    test: "tests/skill-user-invocation.test.ts",
    desc: "派发命中了却不把归属交给 loop ⇒ 事件流里那条 user_message 看不出是谁，重挂永远看不见用户点的 skill",
    apply: (s) => s.replace("      ...(skillFace.hit ? { userMessageSkill: skillFace.hit } : {}),", "      ...(false ? { userMessageSkill: skillFace.hit } : {}),"),
    expectFail: "/sk-demo:say 你好 → 落流的是替换过的正文，且带 skill 归属",
  },
  {
    id: "skill-policy-not-granted-on-user-slash",
    src: "src/main/agent-runner.ts",
    test: "tests/skill-tool-policy.test.ts",
    desc: "用户 /skill 那条 face 不登记（只模型那条登记）⇒ 同一条 SKILL.md 两条 face 的工具面语义分叉，用户点的说了不算",
    apply: (s) => s.replace("      if (sk) rt?.grantSkillScope(scopeHit.invoke, sk.frontmatter);", "      void sk;"),
    expectFail: "派发即登记：面板（agent:state）读到的就是这条 skill 的账",
  },
  {
    id: "skill-policy-not-granted-on-command",
    src: "src/main/agent-runner.ts",
    test: "tests/skill-tool-policy.test.ts",
    desc: "prompt command 的 allowed-tools 不登记（§9.4 明写命令也带这个字段）⇒ 命令侧申报永远是空的",
    apply: (s) => s.replace("      if (cmd) rt?.grantSkillScope(expanded.invoked, cmd.frontmatter);", "      void cmd;"),
    expectFail: "命令侧申报走同一个登记入口（§9.4 的 allowed-tools 不是只有 skill 才有）",
  },
  {
    id: "skill-allow-note-silent",
    src: "src/main/tool-gates.ts",
    test: "tests/skill-tool-policy.test.ts",
    desc: "门卡不解释「申报了但没放行」⇒ 收紧点变成一条只有读源码的人才知道的规则，用户看到的效果是「插件写了 allowed-tools 却还是问我」而无从判断谁对",
    apply: (s) => s.replace("  const invo = currentPluginRuntime()?.skillAllowNote(tool) ?? null;", "  const invo: string | null = null;"),
    expectFail: "门卡的 reason 说清「申报了但没放行」——收紧点要让使用者看得见（能力 8：可解释）",
  },
  {
    id: "precompact-manual-producer-dropped",
    src: "src/main/compact-and-report.ts",
    test: "tests/hook-precompact-producer.test.ts",
    desc: "手动 /compact 不再把钩子引擎递下去 ⇒ 压缩卡照出、钩子一个不跑（回归到「只有函数有源」的老形态；本条用真实 spawn 的哨兵文件计数钉住）",
    apply: (s) => s.replace('    onPreCompact: (trigger) => firePreCompactHook(hooks, trigger),', '    ...(false ? { onPreCompact: (t: "manual" | "auto") => firePreCompactHook(hooks, t) } : {}),'),
    expectFail: "matcher=manual 的那条恰好跑一次，matcher=auto 的那条不跑",
  },
  {
    id: "spec-face-predicate-not-wired",
    src: "src/main/tool-gates.ts",
    test: "tests/skill-tool-policy.test.ts",
    desc: "run 起点算面时不把活闸谓词递给规格组装 ⇒ 登记面、执行面、规格面三处只有两处对得上（同源接线断在中间那一跳）",
    apply: (s) => s.replace("    ...(skillDenial ? { skillDenial } : {}),", "    ...(false ? { skillDenial } : {}),"),
    expectFail: "规格面同步：激活后那把工具从模型可见清单消失，只摘申报的那把、不误伤别个",
  },
  {
    id: "mcp-grade-arg-dropped-at-gate",
    src: "src/main/tool-gates.ts",
    test: "tests/mcp-grade-gate.test.ts",
    desc: "执行侧不递 info.grade ⇒ 采集面、注册表都齐了，最后一步没接（本仓点名的「接缝都在、末步未接」形状）",
    apply: (s) => s.replace("      const d = evaluate(name as ToolName, args, s.autonomy, info.grade);", "      const d = evaluate(name as ToolName, args, s.autonomy);"),
    expectFail: "带 readOnlyHint 的工具体在自主档自动执行（注解真抵达了门）",
  },
  {
    id: "mcp-noninteractive-denial-unexplained",
    src: "src/main/tool-gates.ts",
    test: "tests/mcp-grade-gate.test.ts",
    desc: "非交互拒绝时把门给的理由丢掉 ⇒ 模型只看到「非交互模式」，不知道是注解缺失，换路也无从下手（能力 8 可解释）",
    apply: (s) => s.replace("      const d = evaluate(name as ToolName, args, s.autonomy, info.grade); // MCP scoped 名进同一管线（规则/风险/档位全生效）\n      const aMode = s.autonomy.mode;\n      if (d.verdict === \"deny\") return denied(name, aMode, d.reason, { ...gateBase(d, aMode), verdict: \"denied\" });\n      let manualScope: AskScope | undefined;\n      if (d.verdict === \"ask\") {\n        if (!s.askGate) return denied(name, aMode, \"非交互模式（fail-closed）：\" + d.reason, { ...gateBase(d, aMode), verdict: \"unattended\" });", "      const d = evaluate(name as ToolName, args, s.autonomy, info.grade); // MCP scoped 名进同一管线（规则/风险/档位全生效）\n      const aMode = s.autonomy.mode;\n      if (d.verdict === \"deny\") return denied(name, aMode, d.reason, { ...gateBase(d, aMode), verdict: \"denied\" });\n      let manualScope: AskScope | undefined;\n      if (d.verdict === \"ask\") {\n        if (!s.askGate) return denied(name, aMode, \"非交互模式（fail-closed）：\", { ...gateBase(d, aMode), verdict: \"unattended\" });"),
    expectFail: "无注解的工具体在自主档不自动执行，且拒绝原因指明依据（stub 未被调用）",
  },
  {
    id: "mcp-spec-carrier-drops-grade",
    src: "src/main/tool-gates.ts",
    test: "tests/session-tools.test.ts",
    desc: "规格面不带注解出厂 ⇒ 下游的 mode 判定没有输入，只能凭空猜哪把是只读的（摘除面与门面重新分家）",
    apply: (s) => s.replace("    out.push({ name: scoped, description: info.description, parameters: info.inputSchema, grade: info.grade });", "    out.push({ name: scoped, description: info.description, parameters: info.inputSchema });"),
    expectFail: "只读档规格面同步：门必拒的 MCP 工具不再挂给模型，带 readOnlyHint 的照旧在列",
  },
  {
    id: "plan-required-default-flipped-on",
    src: "src/main/settings.ts",
    test: "tests/plan-required.test.ts",
    desc: "缺省被翻成开 ⇒ 用户没同意过就默认拦写向工具",
    apply: (s) => s.replace('planRequiredByDefault: false,', 'planRequiredByDefault: true,'),
    expectFail: "DEFAULT_SETTINGS 里每个布尔键都能经 set() 翻面并读回",
  },
  {
    id: "settings-whitelist-drops-plan-required-key",
    src: "src/main/settings.ts",
    test: "tests/plan-required.test.ts",
    desc: "合并基漏登记一个标量键（旧写法抄名单漏一项、新写法在 rest 解构里点名剔掉一项，同一件事）⇒ 开关看着能动、重启就没",
    apply: (s) => s.replace(
      "const { layout: layoutPatch, ...scalars } = patch;",
      "const { layout: layoutPatch, planRequiredByDefault: _drop, ...scalars } = patch;",
    ),
    expectFail: "DEFAULT_SETTINGS 里每个布尔键都能经 set() 翻面并读回",
  },
  {
    id: "goal-continuation-hook-skipped",
    src: "src/main/agent-runner.ts",
    test: "tests/goal-continue.test.ts",
    desc: "run 尾不再问判据（整条续跑/停止链被旁路）⇒ goal_set 成了只写不读的陈列，理由也从不上屏",
    apply: (s) => s.replace("const next = await goalNextTurn({ logPath, sessionId, unattended: over.unattended === true || over.noAnswerer === true, aborted: () => over.signal?.aborted === true, runModel: modelSelection });", "const next: { message: string; origin: GoalTurnOrigin } | null = null;"),
    expectFail: "设了目标但这一轮没写盘也没验证 ⇒ 立刻停，并落一条写明理由的 goal_stopped（读答型目标不烧钱）",
  },
  {
    id: "goal-continuation-unattended-guard-dropped",
    src: "src/main/goal-handlers.ts",
    test: "tests/goal-continue.test.ts",
    desc: "摘掉「无人值守不自动续跑」这道闸 ⇒ 定时任务回到按判据决定续不续：那条路审批全被 fail-closed 拒，写不了盘、验不出绿，却能一路烧到轮次上限",
    apply: (s) => s.replace("  if (args.unattended) {", "  if (false) {"),
    expectFail: "无人值守 run 到点就停且不续跑（#53）：理由点名这条路，且**排在判据之前**",
  },
  {
    id: "goal-stopped-flag-ignored",
    src: "src/main/goal-handlers.ts",
    test: "tests/goal-continue.test.ts",
    desc: "已停之后还继续判 ⇒ 用户再发一条消息就把自动续跑唤回来，goal_stopped 落第二条（停止不再是终态）",
    // 针脚跟上现读（2026-10-11）：续跑判据那行加了 `|| view.paused !== null`（goal 挂起/恢复那笔），
    // 变异体只摘 `stopped` 那一半（挂起照旧不续），表达的还是：停止不再是终态。
    apply: (s) => s.replace("if (view === null || view.stopped !== null || view.paused !== null) return null;", "if (view === null || view.paused !== null) return null;"),
    expectFail: "停过的目标不会因用户再发一条而自动复活：停止是终态，要再跑得改设目标",
  },
  {
    id: "goal-clear-branch-removed",
    src: "src/main/goal-handlers.ts",
    test: "tests/goal-continue.test.ts",
    desc: "清除分支整个摘掉 ⇒ 点「清除」掉进设定分支，报一句 objective 缺失，用户关不掉自动续跑（只能反复按停止）",
    apply: (s) => s.replace("if (req.clear === true) {", "if (false) {"),
    expectFail: "清除目标 = 落一条 goal_stopped（不开新事件、不开新通道）：幂等，且此后不再自动续跑",
  },
  {
    id: "goal-clear-not-idempotent",
    src: "src/main/goal-handlers.ts",
    test: "tests/goal-continue.test.ts",
    desc: "已停还补记第二条 goal_stopped ⇒ 审计面上「这个目标停过几次」变成假的（重复点击 = 重复落事实）",
    apply: (s) => s.replace("if (view.stopped !== null) return { ok: true };", "if (false) return { ok: true };"),
    expectFail: "清除目标 = 落一条 goal_stopped（不开新事件、不开新通道）：幂等，且此后不再自动续跑",
  },
  {
    id: "goal-clear-enoesnt-read-as-io-error",
    src: "src/main/goal-handlers.ts",
    test: "tests/goal-continue.test.ts",
    desc: "新建会话（日志还不存在）的 ENOENT 不再当成「没有目标」⇒ 把文件系统噪声端给用户当结论，且拒因文案消失",
    apply: (s) => s.replace('if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return [] as AgentEvent[];', 'if ((err as NodeJS.ErrnoException)?.code === "ENOTDIR") return [] as AgentEvent[];'),
    expectFail: "清除目标 = 落一条 goal_stopped（不开新事件、不开新通道）：幂等，且此后不再自动续跑",
  },
  {
    id: "plan-required-run-override-ignored",
    src: "src/main/agent-runner.ts",
    test: "tests/goal-continue.test.ts",
    desc: "run 入口只看 settings、丢掉 runtime override ⇒ 调用方（IPC 覆盖 / 测试 / 将来的按会话武装）说了不算",
    apply: (s) => s.replace("planRequired: over.planRequired ?? (await store().get()).planRequiredByDefault,", "planRequired: (await store().get()).planRequiredByDefault,"),
    expectFail: "unattended + 武装方案门 ⇒ 拒因来自方案门而不是无人值守闸，盘上不留痕（J3：不是被忽略）",
  },
  {
    id: "plan-gate-armed-for-every-run",
    src: "src/main/agent-runner.ts",
    test: "tests/goal-continue.test.ts",
    desc: "每次 run 无条件武装方案门 ⇒ 「缺省零行为」破了：没开 plan 模式的会话第一次写就被拒（未武装那支当场换拒因）",
    apply: (s) => s.replace("enterPlanRunScope(opts.planRequired === true);", "enterPlanRunScope(true);"),
    expectFail: "unattended + 武装方案门 ⇒ 拒因来自方案门而不是无人值守闸，盘上不留痕（J3：不是被忽略）",
  },
      {
    id: "manual-compact-push-only-never-persisted",
    src: "src/main/agent-runner.ts",
    test: "tests/compact-wiring.test.ts",
    desc: "手动压缩只推不落盘（历史原样）⇒ 压缩卡当场看得见、下一次 run 重放又是全文：花一次摘要的钱换个零效果。演示那条支用会话管线，所以它红着门也绿",
    apply: (s) => s.replace(
      "      const commit = hooks.onAppend?.(hookEvent);\n      try {\n        await log.append(e);\n      } catch (error) {\n        hooks.onAppendFailed?.(hookEvent);\n        throw error;\n      }\n      commit?.();\n      hooks.onEvent?.(hookEvent);",
      "      hooks.onEvent?.(hookEvent);",
    ),
    expectFail: "压缩事件既上屏**也**落盘：只推不写就是花一次摘要钱换个零效果",
  },
  {
    id: "manual-compacts-last-run-instead-of-open-session",
    src: "src/main/agent-runner.ts",
    test: "tests/compact-wiring.test.ts",
    desc: "丢掉 sessionId ⇒ 压到 lastLogPath（本进程最后一次 run 的会话）。用户点的是屏幕上这条，压错的后果是「按了没效果 + 另一条被偷偷改写」",
    apply: (s) => s.replace("if (over.sessionId !== undefined) {", "if (false) {"),
    expectFail: "压的是 sessionId 那条，不是「本进程最后跑过的」那条",
  },
                                                    // ---- 新建定时任务的表单面（#62）：形状映射、白名单、回条，一条都不能是摆设 ----
                        // ---- 运行历史六态筛选（§12.2.6）：筛在 main，界面只存「选了哪个状态」这一份 UI 态 ----
    {
    id: "snapshot-ignores-the-history-filter",
    src: "src/main/scheduler.ts",
    test: "tests/schedule.test.ts",
    desc: "收到筛选值却不筛、回全量 ⇒ 段头写着「只看 失败」而列表里躺着成功与跳过：标签与内容相反，用户按错的名单判断哪条任务健康",
    apply: (s) => s.replace("history: Scheduler.filterHistory(history, historyFilter),", "history,"),
    expectFail: "snapshot(状态) 真按状态筛",
  },
        {
    id: "unknown-history-filter-becomes-a-real-state",
    src: "src/main/scheduler.ts",
    test: "tests/schedule.test.ts",
    desc: "跨进程来的未知值不归一、直接当筛选值用 ⇒ 拼错或被改的输入筛出一片空记录：假空比填空更坏，用户会以为任务从没跑过",
    apply: (s) => s.replace("(HISTORY_FILTERS as readonly string[]).includes(raw)", "true"),
    expectFail: "snapshot(状态) 真按状态筛",
  },
  // ---- 设置写并发串行化（8aa1e41，panels-check B3b 的真红）----
  {
    id: "settings-writes-not-serialized",
    src: "src/main/settings.ts",
    test: "tests/settings.test.ts",
    desc: "撤掉写队列：两笔 set 同时跑 ⇒ 撞同一个临时文件名（pid+毫秒同值）抛 ENOENT，或后落地那笔拿旧缓存把对方字段盖回",
    apply: (s) => s.replace("const next = this.writes.then(() => this.applyPatch(patch));", "const next = this.applyPatch(patch);"),
    expectFail: "layout 与 theme 两笔并发",
  },
  {
    id: "settings-scalar-patch-dropped",
    src: "src/main/settings.ts",
    test: "tests/settings.test.ts",
    desc: "标量合并退回「手抄名单」的下场（名单漏一项 = 整笔 patch 静默丢成 {}）：theme/mode 再也落不了盘",
    apply: (s) => s.replace(
      "const { layout: layoutPatch, ...scalars } = patch;",
      "const layoutPatch = patch.layout; const scalars: Record<string, unknown> = {};",
    ),
    expectFail: "写序守恒",
  },
  {
    id: "sbx-network-branch-dropped",
    src: "src/main/sandbox.ts",
    test: "tests/sandbox.test.ts",
    desc: "allow 支不再写 network 规则 ⇒ §11.4「批准 → Enabled」回到空头：审批存在但网络永远拿不到（sandbox:check ④b 同红）",
    apply: (s) => s.replace('if (opts.network === "allow") {', 'if (false) {'),
    expectFail: "allow 支只加两条 network 放行，写收敛与拒读一字不动",
  },
  {
    id: "sbx-network-escort-ors-conditions",
    src: "src/main/sandbox.ts",
    test: "tests/sandbox.test.ts",
    desc: "三条取用条件由 && 退化成 || ⇒ auto 档没问过人工也拿到网络（§11.4 红线「网络全开不是免批条件」被构造性违反）",
    apply: (s) => s.replace('return input.wantsNetwork && input.asked && input.approved ? "allow" : "deny";', 'return input.wantsNetwork || input.asked || input.approved ? "allow" : "deny";'),
    expectFail: "真值表：三条条件缺一即 deny，全齐才 allow",
  },
  {
    id: "sbx-note-gate-dropped",
    src: "src/main/sandbox.ts",
    test: "tests/sandbox.test.ts",
    desc: "断网提示不再看 network 支 ⇒ 已放行的命令也被贴「被默认沙箱断网」，模型照提示重发＝白烧一轮",
    apply: (s) => s.replace('if (network === "allow" || !looksLikeNetworkDenial(result.output)) return result;', 'if (!looksLikeNetworkDenial(result.output)) return result;'),
    expectFail: "deny 支下补一行可行动的提示；allow 支与无提示串一律原样返回",
  },
  // ---- goal 的 hint 通道：判据算出来的那句必须真送到模型面前（2026-09-21）----
  {
    id: "goal-hint-lost-at-callsite",
    src: "src/main/goal-handlers.ts",
    test: "tests/goal-stop-decision.test.ts",
    desc: "生产入口不传 decision.hint ⇒ 被收走的那一轮仍收到「针对红字继续」（算了没人读的第 10 次）",
    apply: (s) => s.replace("goalReminder(view.spec, turn, spentUsd, view.evidence, decision.hint, unbookedWorkers)", "goalReminder(view.spec, turn, spentUsd, view.evidence, undefined, unbookedWorkers)"),
    expectFail: "生产入口真的把 decision.hint 传进去（拆分后住 goal-handlers，仍只能钉这一行的形状）",
  },
  {
    id: "runner-impact-hook-never-constructed",
    src: "src/main/agent-runner.ts",
    test: "tests/impact-runner-wiring.test.ts",
    desc: "构造点永不出钩子 ⇒ 影响面「两头断」复活：模块、事件、消费端、单测全在，只有 runLoop 那一环没人接（`tests/impact-wiring.test.ts` 手搭 ctx，看不见这一环）",
    apply: (s) => s.replace(
      "const impactHook = opts.impactAnalysis === true ? defaultImpactHook(opts.workspace) : undefined;",
      "const impactHook = false ? defaultImpactHook(opts.workspace) : undefined;",
    ),
    expectFail: "开：写盘后事件流里真有 impact_report，且摘要回进了 tool_result",
  },
  {
    id: "runner-impact-hook-always-constructed",
    src: "src/main/agent-runner.ts",
    test: "tests/impact-runner-wiring.test.ts",
    desc: "构造点不看设置位、永远注入钩子 ⇒ 关着的用户每次写盘都白付一次全仓建图（成本与「缺省零行为」两条纪律一起破）",
    apply: (s) => s.replace(
      "const impactHook = opts.impactAnalysis === true ? defaultImpactHook(opts.workspace) : undefined;",
      "const impactHook = true ? defaultImpactHook(opts.workspace) : undefined;",
    ),
    expectFail: "关（缺省）：一条 impact_report 都不许出现，但同一条写盘仍成功",
  },
  // ---- 能力 5 收束闸的默认（用户裁决 2026-09-23：§483「桌面产品 lint/test 两者默认开」→ 只翻 autoVerify）。
  //      两支都要钉：光钉 DEFAULTS 那一行会漏掉「老机器读不到缺省开」这一整类（本仓 09-19 就为 promptCache 踩过）。
  {
    id: "settings-default-on-key-read-by-strict-true",
    src: "src/main/settings.ts",
    test: "tests/settings.test.ts",
    desc: "缺省开的键改用 `=== true` 读 ⇒ 盘上 JSON 没有这个键的老机器静默拿到 false：" +
      "DEFAULT_SETTINGS 那行改得再对也到不了用户手上，而单测只测对象的话全绿" +
      "（这正是 promptCache 当年写那条注释的原因，同族第二实例）",
    apply: (s) => s.replace(`typeof r.autoVerify === "boolean" ? r.autoVerify : d.autoVerify`, "r.autoVerify === true"),
    expectFail: "autoVerify：旧机器（JSON 里压根没这个键）读回来必须是 true",
  },
  {
    id: "settings-auto-verify-default-reverted",
    src: "src/main/settings.ts",
    test: "tests/settings.test.ts",
    desc: "缺省被悄悄改回关 ⇒ §483 的「桌面产品默认开」失效，能力 5 的收束闸退回零真流量" +
      "（09-19 设计稿 D7 记的就是这串默认关造成的『永远未证』）",
    apply: (s) => s.replace("  autoVerify: true,", "  autoVerify: false,"),
    expectFail: "autoVerify 默认：DEFAULT_SETTINGS 与读盘回退同向（翻一处忘另一处 = 老用户永远拿不到新默认）",
  },
  // 中间那一棒（`over.autoVerify ?? settings`）此前零观察着 = 「两头断」第 12 次。
  // 两半各钉一条：只钉一支，另一支写坏都不会红（②b 与 ②c 只差一个显式 false）。
  {
    id: "autoverify-ipc-settings-fallback-dropped",
    src: "src/main/agent-runner.ts",
    test: "tests/auto-verify-wiring.test.ts",
    desc: "生产入口不再回退到 settings 的值 ⇒ 设置页那半边白做：用户在界面里打开的开关到不了 loop（真流量恒关）",
    apply: (s) => s.replace("autoVerify: over.autoVerify ?? (await store().get()).autoVerify,", "autoVerify: over.autoVerify ?? false,"),
    expectFail: "②b 走 handleAgentRun + allow 批条 ⇒ 写成功，那一拍真补上（正向观察）",
  },
  {
    id: "autoverify-ipc-override-ignored",
    src: "src/main/agent-runner.ts",
    test: "tests/auto-verify-wiring.test.ts",
    desc: "那一行改成「只读 settings」⇒ 调用方显式传的 false 被吞掉（要临时关一次的人只能去改设置文件），且没有任何用例会红",
    apply: (s) => s.replace("autoVerify: over.autoVerify ?? (await store().get()).autoVerify,", "autoVerify: (await store().get()).autoVerify,"),
    expectFail: "②c settings 侧为真、overrides 显式 false ⇒ 那一拍不补（override 那一半的观察着）",
  },
  // 同一族：`agent-runner.ts` 里那批「把设置里的开关接进内核」的写法。数目**不写在这里**——
  // 哪些行只读盘、哪些行还留两半（`over.x ?? 读盘`），事实源是 AST 从源码扫出来的那份，
  // 由 `scripts/lib/wiring-coverage.ts` + `tests/wiring-coverage.test.ts` 逐行要求"每半各一条锚点"。
  // 这张表只负责提供锚点；漏一行是判据红，不是这里有人记得补。
  {
    id: "impact-analysis-settings-fallback-dropped",
    src: "src/main/agent-runner.ts",
    test: "tests/impact-runner-wiring.test.ts",
    desc: "生产入口不读盘上的 impactAnalysis ⇒ 设置界面那个开关是空的（第三环两格直接把值交给 runAgent，照绿）",
    apply: (s) => s.replace("impactAnalysis: (await store().get()).impactAnalysis,", "impactAnalysis: false,"),
    expectFail: "开（只写进 settings.json）：生产入口仍真构造钩子并出 impact_report",
  },
  {
    id: "request-metering-settings-fallback-dropped",
    src: "src/main/agent-runner.ts",
    test: "tests/session-tools.test.ts",
    desc: "盘上的 requestMetering 到不了主会话 ⇒ 计量报告只剩 worker 有，主会话的钱看不见",
    apply: (s) => s.replace("requestMetering: (await store().get()).requestMetering,", "requestMetering: false,"),
    expectFail: "production settings forward C2/D flags and reopen private reports across two IPC runs",
  },
  {
    id: "evidence-receipts-settings-fallback-dropped",
    src: "src/main/agent-runner.ts",
    test: "tests/session-tools.test.ts",
    desc: "盘上的 evidenceReceipts 到不了主会话 ⇒ 私密报告不落盘，「可审计」那一面在主会话静默没有",
    apply: (s) => s.replace("evidenceReceipts: (await store().get()).evidenceReceipts,", "evidenceReceipts: false,"),
    expectFail: "production settings forward C2/D flags and reopen private reports across two IPC runs",
  },
  {
    id: "economic-compaction-settings-fallback-dropped",
    src: "src/main/agent-runner.ts",
    test: "tests/session-tools.test.ts",
    desc: "盘上的 economicCompaction 到不了主会话 ⇒ 经济报告恒 null，压缩债务没人记账",
    apply: (s) => s.replace("economicCompaction: (await store().get()).economicCompaction,", "economicCompaction: false,"),
    expectFail: "production settings forward C2/D flags and reopen private reports across two IPC runs",
  },
  {
    id: "action-fusion-settings-fallback-dropped",
    src: "src/main/agent-runner.ts",
    test: "tests/action-fusion.test.ts",
    desc: "盘上的 actionFusion 到不了主会话 ⇒ 设置里那个开关换不来一次省掉的往返（override 那一格照绿）",
    apply: (s) => s.replace("actionFusion: over.actionFusion ?? (await store().get()).actionFusion,", "actionFusion: over.actionFusion ?? false,"),
    expectFail: "settings 里的 actionFusion 走得到生产入口（不给 override）",
  },
  {
    id: "plan-required-settings-fallback-dropped",
    src: "src/main/agent-runner.ts",
    test: "tests/goal-continue.test.ts",
    desc: "盘上的 planRequiredByDefault 到不了主会话 ⇒ 设置里那句「每轮先出计划」是装饰（J3 那格给的是 override，照绿）",
    apply: (s) => s.replace("planRequired: over.planRequired ?? (await store().get()).planRequiredByDefault,", "planRequired: over.planRequired ?? false,"),
    expectFail: "settings.planRequiredByDefault=true ⇒ 生产入口自己就该拒写，且拒因来自方案门",
  },
  {
    id: "plan-required-override-ignored",
    src: "src/main/agent-runner.ts",
    test: "tests/goal-continue.test.ts",
    desc: "那一行改成「只读 settings」⇒ 调用方显式传的 planRequired 被吞（J3 那格的武装态从此失效，闸不再说话）",
    apply: (s) => s.replace("planRequired: over.planRequired ?? (await store().get()).planRequiredByDefault,", "planRequired: (await store().get()).planRequiredByDefault,"),
    expectFail: "unattended + 武装方案门 ⇒ 拒因来自方案门而不是无人值守闸，盘上不留痕（J3：不是被忽略）",
  },
  {
    id: "action-fusion-override-ignored",
    src: "src/main/agent-runner.ts",
    test: "tests/action-fusion.test.ts",
    desc: "那一行改成「只读 settings」⇒ 调用方显式传的 actionFusion 被吞（C1 的 runtime 通道整条失效）",
    apply: (s) => s.replace("actionFusion: over.actionFusion ?? (await store().get()).actionFusion,", "actionFusion: (await store().get()).actionFusion,"),
    expectFail: "handleAgentRun forwards the explicit override",
  },
  {
    id: "observation-pack-settings-fallback-dropped",
    src: "src/main/agent-runner.ts",
    test: "tests/session-tools.test.ts",
    desc: "盘上的 observationPack 到不了主会话 ⇒ 第 3 次发送仍全文（那条 `obs_recall` 标记不算数：`observationPack || evidenceReceipts` 任一为真都有它）",
    apply: (s) => s.replace("observationPack: (await store().get()).observationPack,", "observationPack: false,"),
    expectFail: "observationPack 由盘上的键决定第 3 次发送的形状（前两封全文、第三封起投影；关掉则恒全文）",
  },
  // ── BYOK 可达性（providers-check ⑦⑧；判据的两半：注入面按清单跑 + 缺口按各自对照面算）
  {
    id: "byok-injector-glm-only",
    src: "src/main/provider-key-inject.ts",
    test: "tests/provider-keys.test.ts",
    desc: "注入面退回硬编码 glm（本轮之前的真实形态）⇒ 白名单扩家那天，key 存得进、没人读，M6 的多 provider 路由仍然只有 glm 能用",
    apply: (s) => s.replace("  for (const provider of providers) {", '  for (const provider of providers.filter((p) => p === "glm")) {'),
    expectFail: "注入面按清单逐家注入各自的 env 名",
  },
  {
    id: "byok-injector-missing-envmap-falls-back",
    src: "src/main/provider-key-inject.ts",
    test: "tests/provider-keys.test.ts",
    desc: "未登记 env 名的 provider 不崩、静默借用 glm 的变量名 ⇒ 白名单加一家而忘了登记映射时，用户以为「存了 key 就生效」，实际拿 CAIRN_API_KEY 去拨别家",
    apply: (s) => s.replace("    const envName = envKeyOf(provider);", '    const envName = envKeyOf(provider) ?? "CAIRN_API_KEY";'),
    expectFail: "未登记 env 名映射的 provider：崩，不许静默跳过那一家",
  },
        {
    id: "remember-gate-if-chain-back",
    src: "src/permissions/index.ts",
    test: "tests/remember.test.ts",
    desc: "remember 门退回按档位字面量的 if 链 ⇒ 表外档位一路掉到底、直接落盘（粗档表在这条路上没人读）",
    apply: (s) => s.replace('const decision = SIDE_EFFECT_DECISION[opts.mode] ?? "ask";', 'const decision = opts.mode === "read-only" ? "deny" : opts.mode === "default" ? "ask" : "allow";'),
    expectFail: "表外档位不落盘：走 ask，无审批口即 fail-closed（旧 if 链在这里静默放行）",
  },
  {
    id: "remember-project-scope-free-write",
    src: "src/permissions/index.ts",
    test: "tests/remember.test.ts",
    desc: "项目层免批那一支被摘掉 ⇒ default 档下每次 remember 都出卡，而无 ask gate 时 fail-closed。" +
      "实测代价（2026-10-15 桌面端会话）：agent 两次想把「本仓 verify 全量 219s 跑不进 60s 帽」" +
      "写进项目记忆，两次被挡 ⇒ 下一场会话从零开始踩同一个坑。",
    apply: (s) => s.replace('if (decision === "ask" && opts.scope === "global") return "ask";', 'if (decision === "ask") return "ask";'),
    expectFail: "default 档项目层免批直写（与沉淀轮的分层裁决同一条口径）",
  },
  {
    id: "remember-global-scope-free-write",
    src: "src/permissions/index.ts",
    test: "tests/remember.test.ts",
    desc: "免批边界从 scope 改成「一律免批」⇒ 全局层跨项目回注无声落盘。" +
      "这一格是上一条的反向：项目层值得省一张卡，全局层不值得（它改的是所有项目）。",
    apply: (s) => s.replace('opts.scope === "global"', 'opts.scope === "global_never"'),
    expectFail: "default 档全局层照旧逐次审批（跨项目回注，不许无声写）",
  },
  {
    id: "judge-frozen-wiring-dropped",
    src: "src/main/agent-runner.ts",
    test: "tests/judge-frozen-gate.test.ts",
    desc: "主会话不装冻结集 ⇒ 端到端那条 ⑨ 立刻空转：写判卷文件被放行、文件真被改写",
    apply: (s) => s.replace("      frozenJudgePaths: frozenJudgePathSet(opts.workspace),\n", ""),
    expectFail: "⑨ 写判卷路径 ⇒ tool_result 出「判卷文件冻结」且文件逐字未变；同一 run 里写非判卷路径照常放行",
  },
  // 返修开关的 **runner 那一腿**：上面三条全部从 `runLoop` 直接进（测试自己传 opts），所以
  // `agent-runner.ts` 里那句「从设置盘取」整行换成 false，一条都不会红——第 14 次「两头断」。
  // 补法：走 `handleAgentRun` + 只写 settings.json + 剧本按 `round_end` 切出中间轮（见 mock.ts）。
  {
    id: "auto-verify-repair-settings-fallback-dropped",
    src: "src/main/agent-runner.ts",
    test: "tests/auto-verify-repair-runner.test.ts",
    desc: "生产入口不读盘上的 autoVerifyRepair ⇒ 设置界面那个「拍红后再要一轮去修」的开关是空的（内核那 7 条用例照绿）",
    apply: (s) => s.replace("autoVerifyRepair: (await store().get()).autoVerifyRepair,", "autoVerifyRepair: false,"),
    expectFail: "开（只写进 settings.json，overrides 一律不给）：红拍之后真多要一轮并再验一拍",
  },
  // 崩溃恢复「重派」的两跳（2026-09-24 实测：这两跳此前**全都不可达**——重启后 `session`/
  // `activeOrchestrator`/`lastLogPath` 三个内存态一起归零，卡片按钮先撞在 emit 守卫上）。
  // 观察着 = `tests/recovery-parent-mode.test.ts` 最后一格（走真 `handleCardAction`）。
  {
    id: "recovery-orchestrator-unreachable-after-restart",
    // 2026-10-12（第 447 页）：实现从 `agent-runner.ts` 搬到 `card-action-handlers.ts`
    // ⇒ 针脚与替换文本同笔改指新位置。判据、killer 指针一个字没动。
    src: "src/main/card-action-handlers.ts",
    test: "tests/recovery-parent-mode.test.ts",
    desc: "重派那支不再兜底建编排器 ⇒ 恢复卡的「重派」在唯一要用它的场景里点不动（报「无可用事件管线」），而所有直接调 orch.respawn 的用例照绿",
    apply: (s) => s.replace("    (req.action === \"respawn\" && req.cardType === \"agent_result\" ? await D().ensureSessionOrchestrator() : null);\n", "    (false ? await D().ensureSessionOrchestrator() : null);\n"),
    expectFail: "会话历史是 read-only + 设置盘默认 auto ⇒ 重派 write worker 必须被拒（拒因点名 read-only）",
  },
  {
    id: "recovery-parent-mode-from-settings",
    src: "src/main/session-assembly.ts",
    // 2026-10-17 搬迁：锚文随实现搬去 session-assembly.ts（agent-runner 三刀之第三刀），逐字未动。
    test: "tests/recovery-parent-mode.test.ts",
    desc: "重派回来的会话又顶著「新对话默认档」当父档 ⇒ 全局 auto 的用户一重启，read-only 会话就变成可派 write worker 的会话（§11.7.6 单调继承被换松一档）",
    apply: (s) => s.replace("    parentMode: recoveryParentMode(await replay(logPath).catch(() => []), (await store().get()).mode),\n", "    parentMode: (await store().get()).mode,\n"),
    expectFail: "会话历史是 read-only + 设置盘默认 auto ⇒ 重派 write worker 必须被拒（拒因点名 read-only）",
  },
  {
    id: "recovery-log-path-only-from-memory",
    src: "src/main/session-assembly.ts",
    // 2026-10-17 搬迁：锚文随实现搬去 session-assembly.ts（agent-runner 三刀之第三刀），逐字未动。
    test: "tests/recovery-restart-current-session.test.ts",
    desc: "恢复兜底只认内存里的 lastLogPath ⇒ 真重启后（三个内存态全归零）恢复卡的「重派」依旧点不动，只换了句错误文案",
    apply: (s) => s.replace("  const logPath = sessionId ? pathOf(requireSessionsDir(), sessionId) : D().lastLogPath();\n", "  const logPath = D().lastLogPath();\n"),
    expectFail: "会话留痕是 read-only + 设置盘默认 auto ⇒ 重派 write worker 被拒（拒因点名 read-only）",
  },
  // 构造口把**项目规则库**递给编排器。这一格此前整个 suite 一条都不红：2026-09-24 实测把
  // `rules: a.rules,` 换成 `rules: []`，全量 236 files / 2523 tests 全绿。原因不是规则逻辑坏了，
  // 而是端到端那条 worker 判卷自己 `new Orchestrator({...})` 传 rules，**绕开了产品入口的构造口**
  // （`tests/worker-project-rules.test.ts` 的注释里有这条来历）。
  {
    id: "orchestrator-project-rules-not-passed",
    src: "src/main/session-assembly.ts",
    // 2026-10-17 搬迁：锚文随实现搬去 session-assembly.ts（agent-runner 三刀之第三刀），逐字未动。
    test: "tests/worker-project-rules.test.ts",
    desc: "构造口不递项目规则库 ⇒ worker 侧的 deny 全线失效（P0-2 那句「否则规则对 worker 全表失效」重新成立），而所有直接 new Orchestrator 的用例照绿",
    apply: (s) => s.replace("    rules: a.rules,\n", "    rules: [],\n"),
    expectFail: "有 deny write_file 的项目规则 ⇒ worker 那笔写被拒，且拒因点名这条规则",
  },

  // ── 第 148 页 · usage 模型归因（钱轴第一次可有数；七条各对应一种假绿／假数形状）
  {
    id: "usage-stamp-call-dropped",
    src: "src/main/agent-runner.ts",
    test: "tests/usage-attribution.test.ts",
    desc: "盖章器建出来了却没接进落盘漏斗 ⇒ 消费端照旧读到恒零归因，钱轴继续报不可测，而这一层的代码全在（「装配存在」≠「这格有不变量」那一族）",
    apply: (s) => s.replace(
      "        usageAttribution.stamp(e); // 落盘前先盖：live 与盘必须是同一个对象（同 events 盖 ts 的口径）\n",
      "",
    ),
    expectFail: "pipeline 里 stamp 在 append **之前**（live 与盘必须同一个对象），且这一份文件里只有这一处盖章",
  },
  {
    id: "usage-stamp-after-append",
    src: "src/main/agent-runner.ts",
    test: "tests/usage-attribution.test.ts",
    desc: "先落盘后盖章 ⇒ 盘上那条没 model、内存里那条有：`onEvent` 看板算得出钱，重放与评估面算不出，两条对不上时没人知道自己看的是哪一份",
    apply: (s) => s
      .replace(
        "        usageAttribution.stamp(e); // 落盘前先盖：live 与盘必须是同一个对象（同 events 盖 ts 的口径）\n",
        "",
      )
      .replace("        commit?.();", "        commit?.();\n        usageAttribution.stamp(e);"),
    expectFail: "pipeline 里 stamp 在 append **之前**（live 与盘必须同一个对象），且这一份文件里只有这一处盖章",
  },
  {
    id: "main-usage-model-ignores-scripted-channel",
    src: "src/main/agent-runner.ts",
    test: "tests/usage-attribution.test.ts",
    desc: "归因键不再问「这一轮走的是剧本吗」⇒ 冻结剧本的用量被盖上真档位名，评估面把从未发生的花费当真钱（与 `isScriptedModel ⇒ price=null` 同一口径）",
    apply: (s) => s.replace(
      '  return scriptedMainModelPath() === null ? budgetPriceKeyOf(selection) : "";',
      "  return budgetPriceKeyOf(selection);",
    ),
    expectFail: "五个剧本通道逐个枚举 ⇒ 各指向自己的剧本，且归因键一律置空",
  },
  {
    id: "runner-sandbox-exit-cause-unwired",
    src: "src/main/tool-gates.ts",
    test: "tests/shell-family-cause.test.ts",
    desc: "主会话开沙箱那条出口（run_shell 被 runInSandbox 整个顶掉）不补归因 ⇒"+
      "同一台机器上换档就没人归因（第十三族：同一条判据只硬化一支）",
    apply: (s) => s.replace(
      "annotateExecCause(sand, { timedOut: sand.timedOut === true, exitCode: sand.exitCode ?? null })",
      "sand",
    ),
    expectFail: "三处都真的调了同一只归因函数",
  },
  {
    id: "provider-key-blank-value-counts-as-configured",
    src: "src/main/provider-runtime.ts",
    test: "tests/providers.test.ts",
    desc: "去掉「非空白」那一半条件 ⇒ 一个空白字符串就算「已配置」：真实通道拿着空 key 去请求，"
      + "失败点在远端 401，而不是这里那句「请配置该 provider 的 key」——缺凭据该在这里停的那一半没人守了",
    apply: (s) => s.replace(
      'return typeof value === "string" && value.trim() !== "";',
      'return typeof value === "string";',
    ),
    expectFail: "反向：key 在场就放行——只有全空/纯空白算缺（一律拒会把这条闸变成装饰）",
  },
  {
    id: "always-rule-written-to-tracked-file",
    src: "src/main/tool-gates.ts",
    test: "tests/d57-write-face.test.ts",
    desc: "授权记录写回**被 git 跟踪**的 permissions.json ⇒ 谁 clone 谁继承那一次授权（#57 的原形状）",
    apply: (s) => s.replace("const path = alwaysRulesPath(workspace);", 'const path = join(workspace, ".agent", "permissions.json");'),
    expectFail: "落点是 alwaysRulesPath(workspace)，不是受跟踪的 permissions.json",
  },
  {
    id: "verify-card-non-approval-grants",
    src: "src/main/verify-trust-gate.ts",
    test: "tests/verify-trust-fingerprint.test.ts",
    desc: "卡的非批准结局被当成批准 ⇒ 拒／超时都放行并记账，信任闸退化成「走过一张卡」的仪式",
    apply: (s) => s.replace(`      if (r.outcome !== "approved") return false;`, `      if (false) return false;`),
    expectFail: "首次那张卡被拒 ⇒ 那一拍不发生（不假绿也不假红）、命令没跑、条目没写",
  },
  {
    id: "verify-unattended-emits-a-card",
    src: "src/main/verify-trust-gate.ts",
    test: "tests/verify-trust-fingerprint.test.ts",
    desc: "无人值守那半边闸被摘 ⇒ 在没人能答的通道上悬一张 60s 的卡（定时任务／CI／非 TTY 都吃到悬等），"
      + "且这条判卷用的是「门被配成可答的交互门」那一形——门自己那支 unattended 顶不住配错",
    apply: (s) => s.replace(`      if (deps.askGate === null || deps.unattended === true) return false;`,
      `      if (deps.askGate === null) return false;`),
    expectFail: "无人值守那道闸住在这一门里：门被配成可答的交互门也不发卡、不悬等、不记账",
  },
  {
    id: "runner-leaves-verify-trust-unwired",
    src: "src/main/agent-runner.ts",
    test: "tests/verify-trust-fingerprint.test.ts",
    desc: "生产装配又不递 resolver ⇒ 回到 `trustedRepo` 恒 false 那个今日形态：缺省开着的自动验证拍一次都不跑"
      + "（48 份留档 0 条），而这一格只有跑到 runner 的判卷看得见",
    apply: (s) => s.replace(`trustResolver: verifyTrust, // 生产那一半`, `trustResolver: undefined, // 生产那一半`),
    expectFail: "首次那张卡被批准 ⇒ 那一拍真发生且仓库自带的命令真跑（常量 false 时代永远到不了这里）",
  },
  {
    id: "automation-face-latch-removed",
    src: "src/main/agent-runner.ts",
    test: "tests/automation-mount-conditional.test.ts",
    desc: "「执行面定终身」那把闩被摘 ⇒ 第一场判假、第二场盘上有了任务就翻真，而说明书面早已定档"
      + " ⇒ 出现「能调看不见」那半张脸。这一格是**两道闸同拦一件事**（规则 226）：await 之前一条早退、"
      + "await 之后一次重读（并发那一场在中途装了执行面时只能跟它），**摘掉任一道另一道都还守着**——"
      + "实测单摘一道变异存活，所以这条改法必须两道一起摘才是「那一格没了」的形状（存活不等于守卫多余）。",
    apply: (s) => s.replace("  if (installed) return installedAutomation;\n", "")
      .replace(`  return installed ? installedAutomation : automationArmedOnce;`, `  return automationArmedOnce;`),
    expectFail: "第一场假 ⇒ 执行面定终身：第二场盘上有了任务也不许翻（不抛、不「看得见调不到」）",
  },
  {
    id: "automation-judgement-blind-to-disk",
    src: "src/main/agent-runner.ts",
    test: "tests/automation-mount-conditional.test.ts",
    desc: "盘上那份任务清单不再参与判据 ⇒ 定时五件的说明书对**没有任何任务**的仓也常驻每轮静态字节"
      + "（这一格住的正是成本纪律，不是便利）",
    apply: (s) => s.replace(`  if (!automationArmedOnce && await automationsScheduled(workspace)) automationArmedOnce = true;`,
      `  if (!automationArmedOnce && false) automationArmedOnce = true;`),
    expectFail: "盘上有任务：判据真 ⇒ 面上五件按 AUTOMATION_TOOLS 声明序齐全",
  },
  /* ---- 2026-10-05 第 397 页：#96 写向悬挂的修法（装配点两格 ＋ 门内一格）----
   * 为什么三根而不是两根：同一件事有三处各自可回归的写法——noAnswerer 的路由、生产那只门递不递
   * 「有没有应答人」这把判据、门内那一句当场拒的分支。摘掉任一处，另两处仍在，但**红的是不同用例**
   * （每格的观察者只有对应那一处会不见）。上一笔的四根存活里有一根正是"观察者与被测维度不同处"，
   * 这次每根先问一遍「生产行变了，这条用例会红吗」。 */
  {
    id: "noanswerer-not-routed-to-ask-gate",
    src: "src/main/agent-runner.ts",
    test: "tests/write-hang-repro.test.ts",
    desc: "管道形状（cli 在非 TTY 那一路只翻 noAnswerer，刻意不翻 unattended——后者会连带关掉会话尾沉淀）"
      + "又不被路由到无人值守那只门 ⇒ 每条写向等满 60s 看门狗才收束；同一个槽在 goal 续跑闸那里早就两值同判，只有这一行漏了",
    apply: (s) => s.replace("askGate: over.unattended || over.noAnswerer === true ? unattendedAskGate : appAskGate,",
      "askGate: over.unattended ? unattendedAskGate : appAskGate,"),
    expectFail: "⑤ 管道形状（只给 noAnswerer，不给 unattended）⇒ 不出卡、当场按无人值守拒收束，不等 60s",
  },
  {
    id: "prod-ask-gate-not-handed-an-answerer-probe",
    src: "src/main/agent-runner.ts",
    test: "tests/write-hang-repro.test.ts",
    desc: "生产那只交互门不再被递「有没有应答人」这把判据 ⇒ 没注册 onAsk 的调用方（把 handleAgentRun 当库直接调）"
      + "回到「卡片被静默丢弃、写向挂在 timer 上」那个形状",
    apply: (s) => s.replace("  hasAnswerer: () => hooks.onAsk !== undefined,\n", ""),
    expectFail: "⑥ 生产装配的交互门没注册应答人 ⇒ run 当场收束（这条钉的是装配点那一句，不是门自己）",
  },
  {
    id: "unarmed-ask-request-still-pends",
    src: "src/main/ask-gate.ts",
    test: "tests/write-hang-repro.test.ts",
    desc: "门内那半句「卡送不出去也算无人值守」被摘 ⇒ hasAnswerer 判假也照样进 pending 挂满 timer"
      + "（判据给了、不接＝等于没给）。两条件刻意合在**同一条分支**里：分开写会让 notifyOutcome 那句在同一文件出现两次，"
      + "把既有锚点 ask-gate-unattended-notify 的针脚从唯一命中弄成两处待复认（第 397 页实测 2→3）。"
      + "反向半边（判真时照旧送卡并等到决议）住在同文件的 ⑥c——那一格钉的是「这一闸不许把所有审批都变成拒」",
    apply: (s) => s.replace("this.opts.unattended || (this.opts.hasAnswerer && !this.opts.hasAnswerer())",
      "this.opts.unattended"),
    expectFail: "⑥b 门自身那一格（负）：hasAnswerer 判假 ⇒ 不 notify、当场拒、pending 归零",
  },
  {
    id: "plugin-data-root-assembly-falls-back-to-tmp",
    src: "src/main/state-handlers.ts",
    test: "tests/plugin-data-root-durable.test.ts",
    desc: "装配面退回「缺省落 os.tmpdir()」⇒ 信任表与插件 userConfig 一起回到会被回收、"
      + "且在共享 runner 上目录名固定可猜的那一顶（别的本机用户预建 plugin-trust.json 即免审批激活）。"
      + "纯函数那条判卷分辨不出这个：它只问取值式，不问谁在用它",
    apply: (s) => s.replace(`    pluginDataRoot: pluginDataRootOf(process.env, homedir()),`, `    pluginDataRoot: process.env.M2E_PLUGIN_DATA ?? join(tmpdir(), "m2e-plugin-data"),`),
    expectFail: "⑦ 那一条接的是 pluginDataRootOf 连入参，且同一行不再出现临时区",
  },
  // ---- 第 432 页：`--doctor` 第七项（信任与插件数据落点）----
  // 这一族守的是同一条承诺：**读不出的东西不许报成「干净」**。三处「读不出」（目录 stat 抛、
  // 表 JSON 坏、表不在目录里但落点是文件）各有一处会被写错的分支折成合法空态，所以各钉一根。
  {
    id: "doctor-trust-world-writable-silent",
    src: "src/main/doctor.ts",
    test: "tests/doctor.test.ts",
    desc: "世界可写那一维摘掉（`false`）⇒ 数据根落在谁都能写的目录里也不再出声，"
      + "而这条洞正是第 424 页搬家前那个 tmpdir 落点的原形——搬家不等于关死，报告要看得见",
    apply: (s) => s.replace(`  const worldWritable = t.dirMode !== null && (t.dirMode & 0o002) !== 0;`, `  const worldWritable = false;`),
    expectFail: "世界可写（0777）⇒ ✗ 并点名这条洞，但仍不是致命项",
  },
  {
    id: "doctor-trust-stat-error-folds-to-absent",
    src: "src/main/doctor.ts",
    test: "tests/doctor.test.ts",
    desc: "把 stat 的所有抛都读成 ENOENT ⇒ EACCES／路径中段是文件一律报「还没建」，"
      + "于是「这台机器上doctor读不到它」与「这台机器干净」在报告里长成同一句话",
    apply: (s) => s.replace(`    dirState = (err as { code?: string }).code === "ENOENT" ? "absent" : "unreadable";`, `    dirState = "absent";`),
    expectFail: "只有 ENOENT 才读成 absent，其余抛（EACCES／ENOTDIR）留在 unreadable",
  },
  {
    id: "doctor-trust-not-a-directory-counts-as-ok",
    src: "src/main/doctor.ts",
    test: "tests/doctor.test.ts",
    desc: "去掉 isDirectory 那道判断（stat 成功就算目录）⇒ 落点被一个同名文件占了也照样报权限位与条数，"
      + "而那时信任表根本不可能在那儿",
    apply: (s) => s.replace(`    if (st.isDirectory()) {`, `    if (true) {`),
    expectFail: "落点同名但是个文件 ⇒ ✗（stat 成功不等于它是目录，不许落成「还没建」）",
  },
  {
    id: "doctor-trust-broken-store-reads-as-ok-empty",
    src: "src/main/doctor.ts",
    test: "tests/doctor.test.ts",
    desc: "表读不出时把状态折成 ok ⇒ doctor 报「一切正常」而装载面其实一条决议都没读到；"
      + "报告与装载各说各话，用户按报告去信任了一个根本没生效的表",
    apply: (s) => s.replace(`      storeState = parsed === null ? "unreadable" : "ok";`, `      storeState = "ok";`),
    expectFail: "表是坏 JSON ⇒ ✗ 并说「读不出」；同一路径换成 0 字节也是读不出，两条都不许报成 0 条决议",
  },
  {
    id: "doctor-trust-root-recomputed-not-shared",
    src: "src/main/doctor.ts",
    test: "tests/doctor.test.ts",
    desc: "doctor 自己拼一遍数据根（写死 .config/cairn/plugin-data）⇒ env 给的落点被忽略，"
      + "报的是「我以为它在哪」而不是装配面真正在用的那个地址；第 424 页那种搬家下次还会漂",
    apply: (s) => s.replace(`  const root = pluginDataRootOf(env, home);`, `  const root = join(home, ".config", "cairn", "plugin-data");`),
    expectFail: "表里有决议 ⇒ 如实报条数，且报的是 env 给的那个落点（不是 home 下拼出来的第二个）",
  },
  {
    id: "doctor-trust-check-computed-not-pushed",
    src: "src/main/doctor.ts",
    test: "tests/doctor.test.ts",
    desc: "纯核算出来了却没接进清单 ⇒ 第七项在报告里彻底消失，而判卷里那 12 条用例照绿（恒真的接线），"
      + "这一格只有把 push 摘掉才看得见它本来在不在",
    apply: (s) => s.replace(`  checks.push(trustFaceCheck(f.trust));\n`, ``),
    expectFail: "固定清单＝七项，顺序即渲染顺序，第七项是 trust（第 432 页带进来的那一格）",
  },
  // ---- 第 438 页：CLI 上的插件/skill 发现面与信任决议（#7 的 ②＋①）----
  {
    id: "plugin-cli-decide-failure-reads-approved",
    src: "src/main/plugin-cli-face.ts",
    test: "tests/plugin-cli-face.test.ts",
    desc: "决议没落地却报「已批准」——人以为自己批过了，下一次装载照样出卡，这是最难查的那种不一致",
    apply: (s) => s.replace("  if (!ok) {", "  if (false) {"),
    expectFail: "决议没落地就绝不说「已批准」/「已拒绝」",
  },
  {
    id: "plugin-cli-unreadable-trust-state-folded",
    src: "src/main/plugin-cli-face.ts",
    test: "tests/plugin-cli-face.test.ts",
    desc: "「表读不出」与「表还没写」两档互换 ⇒ 坏文件被报成没事，没写的被报成有病",
    apply: (s) => s.replace(`ctx.trust.state === "absent"`, `ctx.trust.state === "unreadable"`),
    expectFail: "没写过表 ≠ 读不出表：后者明说不给条数",
  },
  {
    id: "plugin-cli-absent-trust-file-folds-to-zero",
    src: "src/main/plugin-cli-face.ts",
    test: "tests/plugin-cli-face.test.ts",
    desc: "取不到文件就回「已信任 0 条」＝把「没尺」印成「干净」（本仓点名的第三态折成一态那一族）",
    apply: (s) => s.replace(
      `    if (code === "ENOENT" || code === "ENOTDIR") return { state: "absent" };`,
      `    return { state: "ok", trusted: 0, declined: 0 };`,
    ),
    expectFail: "文件不在 = absent",
  },
];
