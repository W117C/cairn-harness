// 变异验证器：证明单元测试不是恒真的（make-neg-controls.mjs 的逻辑层泛化）。
//
// 理念：门禁体检只能静态查出「恒真式/空断言」；一条断言即便非空，也可能根本不针对
// 被测逻辑。唯一可靠的经验证法是**注入一处行为突变，看测试是否真的红**：
//   存活（mutation survived）= 测试对该逻辑无分辨力 = 恒真式等价物。
// 这把「我觉得代码能跑」变成「我证明了换掉这段逻辑，验收会抓住」。
//
// 用法（须经 tsx 运行——判据本体是 TS，见 scripts/lib/mutate-gates.ts）：
//   pnpm mutate-verify                    # 跑配置表里全部条目
//   pnpm mutate-verify <id>               # 只跑一条或几条
//   pnpm mutate-verify --list             # 列出条目
//
// 安全：被测源文件先备份，finally 原样还原；进程退出前强制再校验一次
// `git diff HEAD --quiet`——还原失败即判红，绝不把突变留在工作树里。
// （与 M7 在飞集零相交：只动自己登记的源文件，且进出都校验零 diff。）
// 可判性三分（entryDisposition）：源文件在飞/未跟踪 = 拒绝并抛死（无回滚兜底）；
// **判卷测试文件**在飞 = 本条记「未证」跳过——否则别人的在飞编辑会伪装成「变异存活」或「基线红」。

import { cpSync, existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import ts from "typescript";
import { execFileSync } from "node:child_process";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// 判据本体在 TS 侧（可被 tests/ 直接断言）；本脚本经 tsx 运行，见 package.json 的 mutate-verify。
import { entryDisposition, auditNeedles, backupPathOf, duplicateIds, leftoverBackupPaths, leftoverActionOf, splitRunnable, needleProblemLine, needleSeverity, classifyArgs, isLineWiseApply, budgetMsOf, untrackedAnchorPaths, untrackedAnchorLine, headOnlyNeedleProblems, headOnlyNeedleLine, anchorFaces, blockingTotalOf } from "./lib/mutate-gates.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VITEST = join(ROOT, "node_modules/vitest/vitest.mjs");

/** 变异配置表：每条 = 一处语义突变 + 期望被它杀死的具体用例标题。新增模块只追加。 */
const MUTATIONS = [
  {
    id: "cascade-fail-closed",
    src: "src/routing/cascade.ts",
    test: "tests/cascade.test.ts",
    desc: "去掉 fail-closed：无客观判据时也升级（放行）",
    apply: (s) => s.replace("if (!opts.hasJudge)", "if (false)"),
    expectFail: "失败但无客观判据 → fail-closed 不升级、不猜",
  },
  {
    id: "cascade-max-rungs",
    src: "src/routing/cascade.ts",
    test: "tests/cascade.test.ts",
    desc: "去掉 maxRungs 上限检查（允许无限爬升）",
    apply: (s) => s.replace("if (upgrades >= maxRungs)", "if (false)"),
    expectFail: "达到 maxRungs 上限不再爬升（防无限升级）",
  },
  {
    id: "frozen-s3-9",
    src: "src/frozen.ts",
    test: "tests/frozen-drift.test.ts",
    desc: "S3-9 原 bug 复活：清单单文件无条件计入盘上集合（掩盖判卷文件消失）",
    apply: (s) => s.replace(
      "if (await stat(join(root, f)).then(() => true, () => false))",
      "if (true)",
    ),
    expectFail: "S3-9 回归：gym/index.json 不存在时不算入盘上集合（不掩盖判卷文件消失）",
  },
  {
    id: "secrets-fail-closed",
    src: "src/agent/plugins/secrets.ts",
    test: "tests/secrets.test.ts",
    desc: "safeStorage 不可用时仍装配后端（绕过 fail-closed → 敏感值明文退路）",
    apply: (s) => s.replace("if (!io.isEncryptionAvailable()) return false;", "if (false) return false;"),
    expectFail: "fail-closed：无后端 → 拒存 + 显式错误；safeStorage 不可用 → 不装配且拒存",
  },
  {
    // 5ed68bf 把这份实现收进 src/atomic-write.ts（原判据与三条锚点都在 secrets.ts 上，
    // 实现搬走后针脚必然失配——规则一条没少：落定靠 rename、不许裸直写、失败清 tmp）。
    id: "atomic-rename-dropped",
    src: "src/atomic-write.ts",
    test: "tests/secrets.test.ts",
    desc: "去掉 rename：tmp 写完不落定（崩溃即丢密文）",
    apply: (s) => s.replace(
      '    await writeFile(tmp, text, "utf8");\n    await rename(tmp, path);',
      '    await writeFile(tmp, text, "utf8");',
    ),
    expectFail: "原子写：经 tmp→rename 落盘，成功后无 .tmp 残留",
  },
  {
    id: "atomic-direct-write-no-tmp",
    src: "src/atomic-write.ts",
    test: "tests/secrets.test.ts",
    desc: "tmp+rename 退回裸 writeFile（写中途崩溃截断密文存储）",
    apply: (s) => s.replace(
      '    await writeFile(tmp, text, "utf8");\n    await rename(tmp, path);',
      '    await writeFile(path, text, "utf8");',
    ),
    expectFail: "原子写：经 tmp→rename 落盘，成功后无 .tmp 残留",
  },
  {
    id: "ask-gate-unattended-fail-closed",
    src: "src/main/ask-gate.ts",
    test: "tests/ask-gate.test.ts",
    desc: "unattended 不立即拒绝而是进 60s 等待（fail-closed 退回等待）",
    apply: (s) => s.replace("if (this.opts.unattended) {", "if (false) {"),
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
    id: "clarify-submit-unknown",
    src: "src/agent/gates.ts",
    test: "tests/clarify.test.ts",
    desc: "提交到无人等待的 callId 误返回 true（误挂/误改状态）",
    apply: (s) => s.replace("    if (!resolve) return false;\n    this.pending.delete(callId);\n    resolve(answers);",
                            "    this.pending.delete(callId);\n    resolve(answers);"),
    expectFail: "提交到无人等待的 callId → 返回 false（不误挂）",
  },
  {
    id: "provider-keys-fail-closed",
    src: "src/main/provider-keys.ts",
    test: "tests/provider-keys.test.ts",
    desc: "safeStorage 不可用时仍装配后端（绕过 fail-closed → 明文退路）",
    apply: (s) => s.replace("if (!io.isEncryptionAvailable()) return false;", "if (false) return false;"),
    expectFail: "fail-closed：无后端（safeStorage 不可用）→ 拒存 + 显式错误；任何路径不产生 store 文件",
  },  {
    id: "lsp-config-fail-loud",
    src: "src/tools/lsp.ts",
    test: "tests/lsp.test.ts",
    desc: "坏 JSON 不 fail loud 而是静默关闭（配置错误被吞，该启用的服务器没启用）",
    apply: (s) => s.replace(
      'throw new ToolError("lsp: .agent/lsp.json 不是合法 JSON: " + (err instanceof Error ? err.message : String(err)));',
      'return { enabled: false, servers: {} };',
    ),
    expectFail: "配置：缺省关闭；lsp:false 关闭；坏 JSON fail loud",
  },
  {
    id: "lsp-diag-severity",
    src: "src/tools/lsp.ts",
    test: "tests/lsp.test.ts",
    desc: "去掉 ERROR 级过滤（警告也回流，污染 edit/write 输出）",
    apply: (s) => s.replace("diags.filter((d) => d.severity === DiagnosticSeverity.Error)", "diags"),
    expectFail: "无错误（仅 WARN 或干净文件）→ 空串（输出不变）",
  },
  {
    id: "lsp-diag-cap",
    src: "src/tools/lsp.ts",
    test: "tests/lsp.test.ts",
    desc: "去掉 ≤20 条上限（诊断洪水灌满工具输出，挤掉真正信息）",
    apply: (s) => s.replace(".slice(0, MAX_DIAGNOSTICS)", ""),
    expectFail: "只取 ERROR 级，≤20 条，附 <diagnostics> 块在输出尾部",
  },
  {
    id: "lsp-diag-1based",
    src: "src/tools/lsp.ts",
    test: "tests/lsp.test.ts",
    desc: "诊断行号忘 +1（对外 1-based 契约破裂，行号全偏 1）",
    apply: (s) => s.replace(
      '"ERROR [" + String(d.range.start.line + 1) + ":" + String(d.range.start.character + 1) + "] "',
      '"ERROR [" + String(d.range.start.line) + ":" + String(d.range.start.character + 1) + "] "',
    ),
    expectFail: "只取 ERROR 级，≤20 条，附 <diagnostics> 块在输出尾部",
  },
  {
    id: "lsp-broken-no-retry",
    src: "src/tools/lsp.ts",
    test: "tests/lsp.test.ts",
    desc: "broken 服务器仍重试（已知坏的服务器每次调用都重新 spawn/挂起）",
    apply: (s) => s.replace("if (broken.has(key)) {", "if (false) {"),
    expectFail: "server 启动失败进 broken 且不重试",
  },
  {
    id: "verify-fail-closed-empty",
    src: "src/agent/verify.ts",
    test: "tests/verify.test.ts",
    desc: "无配置时不 fail-closed 而放行（验证门空转，未验证即宣称通过）",
    apply: (s) => s.replace("if (commands.length === 0) {", "if (false) {"),
    expectFail: "⑤ 无配置无 scripts → fail-closed（ok:false，不空转放行）",
  },
  {
    id: "verify-all-green",
    src: "src/agent/verify.ts",
    test: "tests/verify.test.ts",
    desc: "任一命令失败仍判 ok（全绿门槛被拆，验证门可被单条失败绕过）",
    apply: (s) => s.replace("return { ok: results.every((r) => r.ok), results };", "return { ok: true, results };"),
    expectFail: "失败命令 → ok:false；failureDigest 摘要含命令与输出",
  },
  {
    id: "verify-bad-array-fail-loud",
    src: "src/agent/verify.ts",
    test: "tests/verify.test.ts",
    desc: "verify.lint 非数组不抛错（外部配置错误被吞，静默执行非法命令）",
    apply: (s) => s.replace("throw new Error(`verify.${key} 必须是字符串数组`);", "/* mutated: 吞掉配置错误 */"),
    expectFail: "verify 配置字段非数组 → fail loud（外部输入不静默放行）",
  },
  {
    id: "verify-bad-json-fail-loud",
    src: "src/agent/verify.ts",
    test: "tests/verify.test.ts",
    desc: "config.json 坏 JSON 不重抛（非 ENOENT 也降级到探测，配置错误被掩盖）",
    apply: (s) => s.replace('if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err; // 配置存在但坏 → fail loud', 'if (false) throw err; // 配置存在但坏 → fail loud'),
    expectFail: "config.json 坏 JSON → fail loud（ENOENT 才可降级到探测）",
  },
  {
    id: "verify-pkgjson-fail-loud",
    src: "src/agent/verify.ts",
    test: "tests/verify.test.ts",
    desc: "package.json 坏 JSON 不重抛（静默降级到语言探测）⇒ 与 config.json 那条是**两道独立闸**，只拆一条另一条仍在，故各须一条锚点",
    apply: (s) => s.replace('if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err; // package.json 存在但坏 → fail loud', 'if (false) throw err; // package.json 存在但坏 → fail loud'),
    expectFail: "package.json 坏 JSON → fail loud（不许静默降级到语言探测，那是第二道独立闸）",
  },
  {
    id: "process-env-sanitize",
    src: "src/tools/process.ts",
    test: "tests/process.test.ts",
    desc: "白名单+密钥剥除退回全量继承（BYOK 明文 key 泄进子进程→事件流→模型）",
    apply: (s) => s.replace(
      "  for (const k of ENV_ALLOW) {\n    const v = process.env[k];\n    if (v !== undefined) env[k] = v;\n  }\n  for (const k of Object.keys(env)) {\n    if (ENV_SECRET_RE.test(k)) delete env[k];\n  }",
      "  Object.assign(env, process.env);",
    ),
    expectFail: "剥除密钥类变量，只留白名单",
  },
  {
    id: "process-killgroup-tree",
    src: "src/tools/process.ts",
    test: "tests/process.test.ts",
    desc: "killGroup 不杀进程组只杀直接子进程（孙进程成孤儿，持有管道致 'close' 永不触发）",
    apply: (s) => s.replace("process.kill(-pid, signal)", "process.kill(pid, signal)"),
    expectFail: "killGroup 收掉整棵进程树（孙进程不留孤儿）",
  },
  {
    id: "process-timeout-kill",
    src: "src/tools/process.ts",
    test: "tests/process.test.ts",
    desc: "超时只回调不杀树（onTimeout 结算但进程继续跑，资源泄漏）",
    apply: (s) => s.replace("    opts.onTimeout();\n    killGroup(child);\n", "    opts.onTimeout();\n"),
    expectFail: "超时后整棵进程树被杀（孙进程不留孤儿、不泄漏）",
  },
  {
    id: "autonomy-allow-critical",
    src: "src/permissions/autonomy.ts",
    test: "tests/autonomy.test.ts",
    desc: "allow 规则可豁免 critical（任何档位强制审批被绕过）",
    apply: (s) => s.replace("    if (risk === \"critical\") {", "    if (false) {"),
    expectFail: "allow 规则也批不掉 critical（任何档位强制审批）",
  },
  {
    id: "autonomy-readonly-strip",
    src: "src/permissions/autonomy.ts",
    test: "tests/autonomy.test.ts",
    desc: "只读档不摘除写向工具（只读边界破裂，worker 可写）",
    apply: (s) => s.replace("if (mode === \"read-only\") {", "if (false) {"),
    expectFail: "read-only 档工具表不含 write_file/run_shell；其余档完整",
  },
  {
    id: "autonomy-breaker",
    src: "src/permissions/autonomy.ts",
    test: "tests/autonomy.test.ts",
    desc: "断路器不触发（连续自动放行无上限，失控自动化）",
    apply: (s) => s.replace("if (s.consecutiveAutoApprovals >= MAX_AUTO_APPROVALS) s.breakerTripped = true;", "if (false) s.breakerTripped = true;"),
    expectFail: "第 51 次降级：50 次 scope 自动放行后，下一次送审且直至会话重开",
  },
  {
    id: "autonomy-network-once",
    src: "src/permissions/autonomy.ts",
    test: "tests/autonomy.test.ts",
    desc: "网络类命令吃 session scope 放行（出网审计被绕过）",
    apply: (s) => s.replace(
      "!s.breakerTripped && !isNetworkCommandCall(tool, args) && s.sessionScopes.has(key)",
      "!s.breakerTripped && s.sessionScopes.has(key)",
    ),
    expectFail: "网络类命令不吃 scope 放行（强制 once，出网审计）",
  },
  {
    id: "autonomy-critical-denial-limit",
    src: "src/permissions/autonomy.ts",
    test: "tests/autonomy.test.ts",
    desc: "critical 降档提示始终返回（拒 1 次就建议降档，误判用户意图）",
    apply: (s) => s.replace("if (s.consecutiveCriticalDenials < CRITICAL_DENIAL_LIMIT) return null;", "if (false) return null;"),
    expectFail: "critical 连拒 3 次 → 降档提示",
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
    id: "updater-manifest-https-only",
    src: "src/main/updater.ts",
    test: "tests/updater.test.ts",
    desc: "manifest URL 放行 http/file（借主进程网络面做 SSRF/明文劫持）",
    apply: (s) => s.replace("if (p.protocol !== \"https:\") return { state: \"error\",", "if (false) return { state: \"error\","),
    expectFail: "manifest URL 只允许 https（D5：放行 http/file = 借主进程做 SSRF/明文劫持）",
  },
  {
    id: "updater-semver-direction",
    src: "src/main/updater.ts",
    test: "tests/updater.test.ts",
    desc: "同版 manifest 被判为有新版（重复弹更新卡，版本语义反转）",
    apply: (s) => s.replace("if (cmp <= 0) return { state: \"up-to-date\",", "if (cmp < 0) return { state: \"up-to-date\","),
    expectFail: "checkUpdate：同版 / 旧版 → up-to-date（显式「已是最新」）",
  },
  {
    id: "updater-semver-strict",
    src: "src/main/updater.ts",
    test: "tests/updater.test.ts",
    desc: "semver 解析放宽（非三段版本被接受，版本比较可返回错误结果）",
    apply: (s) => s.replace("if (!/^\\d+\\.\\d+\\.\\d+$/.test(v)) return null;", "if (!/.*/.test(v)) return null;"),
    expectFail: "semver 比对矩阵（三段逐段数值比较；非法 = null）",
  },
  {
    id: "updater-manifest-unknown-fields",
    src: "src/main/updater.ts",
    test: "tests/updater.test.ts",
    desc: "manifest 未知字段不拒绝（恶意 manifest 可夹带任意内容）",
    apply: (s) => s.replace("if (unknownKeys.length > 0) return { state: \"error\",", "if (false) return { state: \"error\","),
    expectFail: "checkUpdate：manifest 结构坏（未知字段 / version 非法 / 缺 url / 当前版本非法）→ error",
  },
  {
    id: "updater-safe-external-url",
    src: "src/main/updater.ts",
    test: "tests/updater.test.ts",
    desc: "下载页白名单放行任意协议（file:/javascript: 经 openExternal 执行 = RCE/信息泄漏面）",
    apply: (s) => s.replace("return p.protocol === \"https:\" || p.protocol === \"http:\";", "return true;"),
    expectFail: "下载页白名单：仅 http(s) 可 openExternal（防 manifest 注入 file:/自定义协议）",
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
    id: "prune-minimum-tokens",
    src: "src/agent/prune.ts",
    test: "tests/prune.test.ts",
    desc: "最小修剪闸被拆（低于 20k 也裁，无效修剪照做）",
    apply: (s) => s.replace("if (wouldSave < config.minimumTokens) {", "if (false) {"),
    expectFail: "①预计裁剪未达 20k → 不修剪（too-small，零替换）",
  },
  {
    id: "prune-protect-region",
    src: "src/agent/prune.ts",
    test: "tests/prune.test.ts",
    desc: "保护区累计闸被拆（protectStart 恒为 0，全部事件成候选）",
    apply: (s) => s.replace("if (acc >= config.protectTokens) {", "if (false) {"),
    expectFail: "②最近 2 轮不被剪；第 1 轮的旧大结果被剪",
  },
  {
    id: "prune-recent-rounds",
    src: "src/agent/prune.ts",
    test: "tests/prune.test.ts",
    desc: "最近 N 轮边界恒为 0（全部事件判为最近轮，免剪区吞掉整个裁剪面）",
    apply: (s) => s.replace("if (seen === recentRounds) return i;", "if (false) return i;"),
    expectFail: "②最近 2 轮不被剪；第 1 轮的旧大结果被剪",
  },
  {
    id: "prune-event-id-1based",
    src: "src/agent/prune.ts",
    test: "tests/prune.test.ts",
    desc: "替换映射的 1-based 事件 id 变 0-based（投影行号错位，消费者取错事件）",
    apply: (s) => s.replace("out.replacements.set(i + 1, stub);", "out.replacements.set(i, stub);"),
    expectFail: "②最近 2 轮不被剪；第 1 轮的旧大结果被剪",
  },
  {
    id: "prune-exempt-tools",
    src: "src/agent/prune.ts",
    test: "tests/prune.test.ts",
    desc: "免剪名单失效（skill/remember/memory 注入内容可被裁掉，跨会话指令丢失）",
    apply: (s) => s.replace("config.exemptTools.includes(callName)", "false"),
    expectFail: "免剪名单（skill/remember/memory）免剪；普通 read_file 不免剪",
  },
  {
    id: "prune-grep-glob-lsp",
    src: "src/agent/prune.ts",
    test: "tests/prune.test.ts",
    desc: "grep/glob/lsp 整形结果免剪失效（已整形产物被重复裁剪，信息损失大于收益）",
    apply: (s) => s.replace('if (callName === "grep" || callName === "glob" || callName === "lsp") return true;', "if (false) return true;"),
    expectFail: "grep/glob/lsp 命中免剪（整形产物不裁）",
  },
  {
    id: "prune-error-result-exempt",
    src: "src/agent/prune.ts",
    test: "tests/prune.test.ts",
    desc: "失败/拒绝结果免剪失效（高价值短结果被裁，错误上下文从上下文消失）",
    apply: (s) => s.replace("if (!(e as { ok?: boolean }).ok) return true;", "if (false) return true;"),
    expectFail: "失败结果（ok:false）免剪；同类成功结果不免剪",
  },
  {
    id: "prune-non-toolresult-exempt",
    src: "src/agent/prune.ts",
    test: "tests/prune.test.ts",
    desc: "非 tool_result 免剪失效（user_message/tool_call 进候选，裁剪面越界）",
    apply: (s) => s.replace("if (e.type !== \"tool_result\") return true;", "if (false) return true;"),
    expectFail: "非 tool_result 一律免剪（user_message / tool_call）",
  },
  {
    id: "prune-verify-card-exempt",
    src: "src/agent/prune.ts",
    test: "tests/prune.test.ts",
    desc: "verify 卡片投影免剪失效（验证卡面数据源被裁，卡片渲染瞎）",
    apply: (s) => s.split("\n").map((l) => (l.includes(".test(e.output)") ? l.replace("e.output", "false") : l)).join("\n"),
    expectFail: "卡片投影免剪：[verify] 前缀的 tool_result 在最近轮外仍免剪",
  },
  {
    id: "prune-attachment-safesegment",
    src: "src/agent/prune.ts",
    test: "tests/prune.test.ts",
    desc: "附件名路径穿越清洗被拆（模型侧 ../../ 直接越出 attachmentsDir）",
    apply: (s) => s.split("\n").map((l) => (l.includes("return raw.replace") ? "  return raw.slice(0, maxLen);" : l)).join("\n"),
    expectFail: "sessionId 含 ../../ 时清洗后附件仍落在 attachmentsDir 内",
  },
  {
    id: "remember-global-memory-only",
    src: "src/tools/remember.ts",
    test: "tests/remember.test.ts",
    desc: "全局层只许记忆笔记的闸被拆（全局层可写根三文件，项目/全局边界破裂）",
    apply: (s) => s.replace("if (scope === \"global\" && k !== \"memory\") {", "if (false) {"),
    expectFail: "全局层 + 根三文件 kind → 拒绝；非法 topic → 拒绝",
  },
  {
    id: "remember-topic-replace-mismatch",
    src: "src/tools/remember.ts",
    test: "tests/remember.test.ts",
    desc: "topic replace 精确命中检查被拆（不匹配也静默改写，报错重试语义失效）",
    apply: (s) => s.replace("if (oldContent !== oldBody) {", "if (false) {"),
    expectFail: "replace 不命中 → old_content_mismatch（消息可区分）",
  },
  {
    id: "remember-empty-change-same",
    src: "src/tools/remember.ts",
    test: "tests/remember.test.ts",
    desc: "old_content===content 的空变更闸被拆（无写值改写落盘，modified 白滚）",
    apply: (s) => s.replace("        if (oldContent === content) {", "        if (false) {"),
    expectFail: "空变更：空白 content 与 old_content===content 都报 empty_change（无内容可沉淀）",
  },
  {
    id: "remember-rootfile-empty-change-same",
    src: "src/tools/remember.ts",
    test: "tests/remember.test.ts",
    desc: "根文件分支的空变更闸被拆 ⇒ 把 MEMORY.md 原样再写一遍也算「有变更」并落盘；topic 分支与这根是两条独立闸，只拆一条另一条仍在（故须各一条锚点）",
    apply: (s) => s.replace("    if (oldContent === content) {\n      throw new MemoryError(\"empty_change\"", "    if (false) {\n      throw new MemoryError(\"empty_change\""),
    expectFail: "根三文件 replace 的空变更同样报 empty_change（与 topic 分支是两道独立闸）",
  },
  {
    id: "remember-empty-content-whitespace",
    src: "src/tools/remember.ts",
    test: "tests/remember.test.ts",
    desc: "空白 content 闸被拆（空笔记写入记忆，错误码分型坍塌）",
    apply: (s) => s.replace("if (content.trim().length === 0) {", "if (false) {"),
    expectFail: "空变更：空白 content 与 old_content===content 都报 empty_change（无内容可沉淀）",
  },
  {
    id: "remember-decisions-append-only",
    src: "src/tools/remember.ts",
    test: "tests/remember.test.ts",
    desc: "DECISIONS 追加式闸被拆（日志可被整段改写，修订链断裂）",
    apply: (s) => s.replace("if (k === \"decision\" && op === \"replace\") {", "if (false) {"),
    expectFail: "DECISIONS 追加式：replace 被拒（修订=新条目「取代」）",
  },
  {
    id: "remember-op-enum",
    src: "src/tools/remember.ts",
    test: "tests/remember.test.ts",
    desc: "op 枚举闸被拆（delete 等任意操作被接受，删除权回到模型侧）",
    apply: (s) => s.replace("if (op !== \"append\" && op !== \"replace\") {", "if (false) {"),
    expectFail: "kind/操作集里不存在 delete",
  },
  {
    id: "remember-memory-type-required",
    src: "src/tools/remember.ts",
    test: "tests/remember.test.ts",
    desc: "kind=memory 必带 type 闸被拆（无类型记忆写入，索引投影缺字段）",
    apply: (s) => s.replace("if (!isMemoryType(type)) {", "if (false) {"),
    expectFail: "全局层 + 根三文件 kind → 拒绝；非法 topic → 拒绝",
  },
  {
    id: "remember-topic-required",
    src: "src/tools/remember.ts",
    test: "tests/remember.test.ts",
    desc: "topic 必填闸被拆（空/非法 topic 进入文件名，记忆落盘命名失控）",
    apply: (s) => s.replace("if (typeof topic !== \"string\" || topic.length === 0) {", "if (false) {"),
    expectFail: "topic 空串/非串由工具层先拦（必带 topic，先于 store 层格式校验）",
  },
  {
    id: "remember-rootfile-replace-mismatch",
    src: "src/tools/remember.ts",
    test: "tests/remember.test.ts",
    desc: "根三文件 replace 精确命中检查被拆（不匹配也静默改写 .agent/ 根文件）",
    apply: (s) => s.replace("if (cur === null || cur !== oldContent) {", "if (false) {"),
    expectFail: "根三文件 replace 不命中 → old_content_mismatch，原文不被静默改写",
  },
  {
    id: "remember-default-op",
    src: "src/tools/remember.ts",
    test: "tests/remember.test.ts",
    desc: "kind 默认操作映射反转（decision 默认 replace → 追加式日志被改写拒）",
    apply: (s) => s.replace("kind === \"architecture\" || kind === \"preference\" ? \"replace\" : \"append\"", "kind === \"architecture\" || kind === \"preference\" ? \"append\" : \"replace\""),
    expectFail: "architecture/decision/preference 映射 .agent/ 根三文件",
  },
  {
    id: "sessions-delete-force-false",
    src: "src/main/sessions.ts",
    test: "tests/sessions.test.ts",
    desc: "删除改用 force:true（不存在的会话静默成功，fail-loud 语义失效）",
    apply: (s) => s.replace("await rm(sessionPath(root, id), { force: false });", "await rm(sessionPath(root, id), { force: true });"),
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
    apply: (s) => s.replace("非法会话名: ${JSON.stringify(name)}`);\n  let id = base;\n  for (let i = 2; ; i++) {", "非法会话名: ${JSON.stringify(name)}`);\n  let id = base;\n  for (let i = 1; ; i++) {"),
    expectFail: "新建撞名自动加序号；空目录列表为空",
  },
  {
    id: "sessions-lines-nonempty",
    src: "src/main/sessions.ts",
    test: "tests/sessions.test.ts",
    desc: "行数口径把空行计入（投影事件数虚高 +1，验收口径破裂）——2026-09-20 改指 d9f4d0b 搬进 countNonEmpty 的那一处",
    apply: (s) => s.replace("for (const s of segments) if (s.trim().length > 0) n++;", "for (const s of segments) n++;"),
    expectFail: "新建 → 出现在列表；事件追加后行数 = JSONL 行数",
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
    id: "sessions-meta-head-strict",
    src: "src/main/sessions.ts",
    test: "tests/sessions.test.ts",
    desc: "scheduled 徽标的投影条件被拆（每个会话都带上自动化徽标 = 面板在撒谎）——2026-09-20 改指 d9f4d0b 搬进 projectHeadLine 的那一处；同行的 meta.type 校验是 belt-and-braces，判据看不见它（首行本来就是 session_meta），不另立锚点",
    apply: (s) => s.replace('...(meta.origin === "scheduled"', "...(true"),
    expectFail: "首行是 session_meta 但没有 origin ⇒ 同样不投影（origin 半边：上面那条判不到它，变异存活实测抓出来的缺口）",
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
  {
    id: "impact-closure-glob-broken",
    src: "src/agent/impact/index.ts",
    test: "tests/impact-admission.test.ts",
    desc: "波及闭包的入面从 glob 匹配退化成整串相等（目录型 resources 声明\n 再也算不出波及）",
    apply: (x) => x.replace("if (!globs.some((g) => globMatchesPath(g, file))) continue;", "if (!globs.includes(file)) continue;"),
    expectFail: "目录 glob 把整个子树的波及并进来",
  },
  {
    id: "http-retry-replays-fatal-status",
    src: "src/providers/retry.ts",
    test: "tests/http-retry.test.ts",
    desc: "可重试判定变成「全部状态都重试」（400/401/404 这类请求本身的问题被反复重放，白烧预算与限流额度）",
    apply: (s) => s.replace("return status === 408 || status === 409 || status === 425 || status === 429 || (status >= 500 && status <= 599);", "return true;"),
    expectFail: "400 是请求本身的问题：一次即抛，文案与迁移前逐字一致",
  },
  {
    id: "http-retry-ignores-cancellation",
    src: "src/providers/retry.ts",
    test: "tests/http-retry.test.ts",
    desc: "重试循环不再看调用方取消信号（用户按停止后仍把剩余 attempts 跑满 = 停止键失灵）",
    apply: (s) => s.replace(" || o.callerSignal?.aborted === true", ""),
    expectFail: "调用方取消不是故障：不重试、不吞取消",
  },
  {
    id: "http-retry-drops-retry-after",
    src: "src/providers/retry.ts",
    test: "tests/http-retry.test.ts",
    desc: "忽略 Retry-After 头（对端明确要求等多久我们照打 500ms，限流窗口被二次打满）",
    apply: (s) => s.replace("const headerMs = retryAfterMs(res.headers?.get?.(\"retry-after\") ?? null, Date.now(), capMs);", "const headerMs = null;"),
    expectFail: "429 两次后成功：共 3 次请求、两次重试可查、Retry-After 被遵从",
  },
  {
    id: "auto-verify-default-on",
    src: "src/agent/loop.ts",
    test: "tests/loop.test.ts",
    desc: "收束闸缺省变开（每 run 多拍一次真 lint/test，撞 action-fusion 已钉的验证执行次数记账）",
    apply: (s) => s.replace("opts.verify && opts.autoVerify === true && wroteThisRun", "opts.verify && opts.autoVerify !== false && wroteThisRun"),
    expectFail: "零行为回退：缺省不开闸（未给 autoVerify） → 无 verify_result、请求数与旧行为同形",
  },
  {
    id: "auto-verify-surface-probe-unguarded",
    src: "src/agent/loop.ts",
    test: "tests/loop.test.ts",
    desc: "可验面探测的 catch 翻成放行（写坏 .agent/config.json 时整轮被 SyntaxError 炸掉）",
    apply: (s) => s.replace("          hasSurface = false;\n          console.warn(", "          hasSurface = true;\n          console.warn("),
    expectFail: "可验面探测炸（config 存在但 JSON 坏）⇒ 不炸 run、不补拍",
  },
  {
    id: "session-spawn-visible-side-effect",
    src: "src/permissions/autonomy.ts",
    test: "tests/session-tools.test.ts",
    desc: "spawn_agent 从写向工具集合里摘掉（只读档会话就能派 worker：花真钱 + write 档 worker 会写盘）",
    apply: (s) => s.replace('  "spawn_agent",\n', ""),
    expectFail: "主会话模型可见面含 spawn_agent；只读档随写向工具一并摘除",
  },
  {
    id: "context-budget-ignores-model-window",
    src: "src/agent/glm-session.ts",
    test: "tests/session-provider.test.ts",
    desc: "预算基线退回硬编码 128k（高档位模型提前压缩 = 多烧一次摘要 + 白丢冷细节；误拒合法请求）",
    apply: (s) => s.replace("{ ...withModelBudget(DEFAULT_COMPACTION_CONFIG, window), ...opts.compaction?.config }", "{ ...DEFAULT_COMPACTION_CONFIG, ...opts.compaction?.config }"),
    expectFail: "同一份历史：缺省 128k 帽下 fail-closed 拒发，换 256k 窗口模型后照常发出",
  },
  // ---- 门 0（ipc-reachability）：可达性棘轮的解析面 ----
  {
    id: "ipc-preload-crossline-attribution-lost",
    src: "scripts/ipc-reachability-check-core.ts",
    test: "tests/ipc-reachability.test.ts",
    desc: "方法名归属在遇到任何非键行时被清空（跨行写的箭头体全查不到通道 → A1a 漏红）",
    apply: (s) => s.replace("if (key) current = key[1];", "if (key) current = key[1]; else current = null;"),
    expectFail: "invoke 归属最近的方法名；带返回类型注解不算漏；subscribe 记为 push",
  },
  {
    id: "ipc-preload-push-subscribe-blind",
    src: "scripts/ipc-reachability-check-core.ts",
    test: "tests/ipc-reachability.test.ts",
    desc: "push 识别只认 ipcRenderer.on、不认 subscribe 包装（preload 三条推送桥全蒸发，A1c 变成空判）",
    apply: (s) => s.replace("subscribe[\\w<>,\\s]*|", ""),
    expectFail: "invoke 归属最近的方法名；带返回类型注解不算漏；subscribe 记为 push",
  },
  {
    id: "ipc-preload-orphan-call-misattributed",
    src: "scripts/ipc-reachability-check-core.ts",
    test: "tests/ipc-reachability.test.ts",
    desc: "去掉「不在对象内就不归属」前置（对象外的 ipcRenderer 调用被挂到上一个键上 = 桥表凭空多出一条，棘轮基线被污染）",
    apply: (s) => s.replace("    if (!current) continue;\n", ""),
    expectFail: "对象外的 ipcRenderer 调用不归属任何方法（不误挂到上一个键上）",
  },
  {
    id: "ipc-renderer-bracket-chain-name-lost",
    src: "scripts/ipc-reachability-check-core.ts",
    test: "tests/ipc-reachability.test.ts",
    desc: "全括号链 `window[\"agent\"][\"X\"]()` 收的是整段匹配而非方法名（这类引用一律判成「渲染层没调」→ 已接上 UI 的桥被误算成孤儿）",
    apply: (s) => s.replace('for (const m of src.matchAll(/\\]\\s*\\[\\s*"(\\w+)"\\s*\\]/g)) out.add(m[1]);', 'for (const m of src.matchAll(/\\]\\s*\\[\\s*"(\\w+)"\\s*\\]/g)) out.add(m[0]);'),
    expectFail: 'api.X / window.agent.X / agent?.X / api["X"] 都算引用',
  },
  {
    id: "ipc-ratchet-added-blind",
    src: "scripts/ipc-reachability-check-core.ts",
    test: "tests/ipc-reachability.test.ts",
    desc: "棘轮只查「变好」不查「变坏」（新写一条 UI 不引用的桥不再红 → 门 0 要防的那种塌陷正好漏掉）",
    apply: (s) => s.replace("added: [...o].filter((c) => !b.has(c)).sort(),", "added: [],"),
    expectFail: "新增孤儿桥 ⇒ added 点名（A2a 的判据：写一条 UI 不引用的桥就红）",
  },
  {
    id: "ipc-ratchet-stale-blind",
    src: "scripts/ipc-reachability-check-core.ts",
    test: "tests/ipc-reachability.test.ts",
    desc: "基线失效方向不再比对（欠账只增不减：接上了也不删记录，基线沦为免检声明）",
    apply: (s) => s.replace("fixed: [...b].filter((c) => !o.has(c)).sort(),", "fixed: [],"),
    expectFail: "基线里的通道已接上 UI ⇒ fixed 点名（A2b 的判据：还留着欠账记录也算红）",
  },
  {
    id: "ipc-a3-unknown-ref-blind",
    src: "scripts/ipc-reachability-check-core.ts",
    test: "tests/ipc-reachability.test.ts",
    desc: "A3 内核恒返回空表（桥名拼错的引用不再点名 → 澄清卡那类「渲染得出、按钮按不动」的 P1 回到无人可查；正是要防的那次实踩）",
    apply: (s) => s.replace("  return [...bad].sort();", "  return [];"),
    expectFail: "非表内的 api.X / api?.X 点名（桥名是本仓自己拼的，拼错＝调用静默变 undefined、卡片渲染得出按钮按不动）",
  },
  {
    id: "ipc-a3-alias-width-lost",
    src: "scripts/ipc-reachability-check-core.ts",
    test: "tests/ipc-reachability.test.ts",
    desc: "去掉「独立别名」前置（任何对象的 .api.X 都被当成 window.agent 的调用 = 误报面回来了，A3 会被当成噪声门关掉）",
    apply: (s) => s.replace("(?<![.\\w])api\\??\\.", "api\\??\\."),
    expectFail: "表内名字不报；宽度只认独立别名 api（svc.api.list / window.agent.foo 都不收，同名对象不该被卷进来）",
  },
  {
    id: "ipc-comment-face-counts-as-ref",
    src: "scripts/ipc-reachability-check-core.ts",
    test: "tests/ipc-reachability.test.ts",
    desc: "引用面不剥注释（散文里写一句 `api.submitClarify ? …` 就把没人调的桥记成「已可达」，欠账清单可被一句话抹掉——本仓 2026-09-20 实踩）",
    apply: (s) => s.replace("export function stripCommentFaces(src: string): string {", "export function stripCommentFaces(src: string): string {\n  return src;"),
    expectFail: "注释里的桥名不算引用（否则一句话就能把棘轮的欠账记录抹掉）",
  },
  // ---- worker 上下文预算认模型（1e85544）----
  {
    id: "worker-budget-window-ignored",
    src: "src/agent/orchestrator-config.ts",
    test: "tests/worker-budget.test.ts",
    desc: "worker 预算不再采信模型窗口（256k/1M 档仍按硬编码 128k 提前压缩 = 多烧一次摘要 + 白丢冷细节）",
    apply: (s) => s.replace("const budgeted = withModelBudget(base, window);", "const budgeted = base;"),
    expectFail: "窗口比基线大 ⇒ 抬到真实窗口（256k 档不再按 128k 提前压缩），worker 专属 ratio 保留",
  },
  {
    id: "worker-budget-clamp-removed",
    src: "src/agent/orchestrator-config.ts",
    test: "tests/worker-budget.test.ts",
    desc: "去掉「显式覆盖绝不超出模型窗口」的钳制（超窗请求发给远端吃 400，本地 fail-closed 失效）",
    apply: (s) => s.replace("return budgeted !== base ? { ...merged, inputLimit: Math.min(merged.inputLimit, budgeted.inputLimit) } : merged;", "return merged;"),
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
    src: "src/agent/orchestrator.ts",
    test: "tests/m3c.test.ts",
    desc: "单价缺省时不再查内置价表（估价恒 0 ⇒ 用户只设 maxBudgetUsd 的常见配置下，spec 的 BYOK 底线静默失效）。针脚必须指**给钱的那一行**：上一版指相邻的 budgetRateKnown 早退，那行删掉行为不变（spentUsdFor 自己就 null→0），变异当场存活",
    apply: (s) => s.replace("    return bucketsSpendUsd(this.budgetBuckets());", "    return null;"),
    expectFail: "成本闸没填单价 ⇒ 按内置价表分列估价（用户只设 maxBudgetUsd 就该拦住，不是恒 0）",
  },
  // ---- 09-23「每桶按自己那一档折」新增的三格（同一把尺的三个组成面）----
  {
    id: "budget-worker-buckets-dropped",
    src: "src/agent/orchestrator.ts",
    test: "tests/session-spend-ruler.test.ts",
    desc: "worker 桶全被当成「不产生真钱」跳过 ⇒ 上限只按主会话那一小段算，派活越多越拦不住",
    apply: (s) => s.replace("        realMoney: w.price !== null,", "        realMoney: false,"),
    expectFail: "会话档=flash、worker 档=standard：worker 一份重活就把上限花完 ⇒ 下一次 spawn 被拒",
  },
  {
    id: "budget-worker-priced-at-session-tier",
    src: "src/agent/orchestrator.ts",
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
  {
    id: "budget-unpriced-tokens-swallowed",
    src: "src/agent/orchestrator-join.ts",
    test: "tests/session-spend-ruler.test.ts",
    desc: "算不出价的 token 数被吞（仍不折成 $0 计入美元）⇒ 调用方拿不到「闸可能晚于实际上限」的读数，也就不会出声",
    apply: (s) => s.replace("      unpricedTokens += tokens;", "      unpricedTokens += 0;"),
    expectFail: "真实但价不可知的一桶：不折成 $0，token 计入 unpricedTokens，已知的部分照算",
  },
  // ---- goal 美元闸（同一把尺的第二支，`1a36de2`）----
  {
    id: "goal-window-booked-sum-dropped",
    src: "src/agent/goal.ts",
    test: "tests/goal-price.test.ts",
    desc: "worker 回执里已入账的表价不再累加 ⇒ 闸只看主会话那一段，派多少活都不涨钱（上限形同虚设）",
    apply: (s) => s.replace("      if (typeof s === \"number\" && Number.isFinite(s) && s > 0) booked += s;", "      if (typeof s === \"number\" && Number.isFinite(s) && s > 0) booked += 0;"),
    expectFail: "正向那一格：worker 跑贵档并已入账 ⇒ 闸按入账的钱停，不按会话的便宜档低估",
  },
  {
    id: "goal-window-prices-worker-at-session-tier",
    src: "src/agent/goal.ts",
    test: "tests/goal-price.test.ts",
    desc: "把 worker 的 token 也并进主会话桶 ⇒ 回到「全部 token × 会话档」，与同一屏的回执分叉（40 倍）",
    apply: (s) => s.replace("      if (e.agent_id === undefined) {", "      if (true) {"),
    expectFail: "反向那一格：会话档很贵而 worker 跑便宜档 ⇒ 闸只看回执里那 $0.0202，不乘成 $0.808",
  },
  {
    id: "goal-gate-call-site-bypassed",
    src: "src/main/agent-runner.ts",
    test: "tests/goal-continue.test.ts",
    desc: "调用点递空窗口（函数没错、闸拿不到数）⇒ 美元闸惰掉，理由退到轮次上限，用户设的钱闸变随机数",
    apply: (s) => s.replace("goalWindowSpend(view.window, model)", "goalWindowSpend([], model)"),
    expectFail: "设 $0.05 上限 × 一轮 200k/20k 用量 ⇒ goal_stopped 点名美元上限（不被轮次/无产出理由顶包）",
  },
  {
    id: "goal-lag-note-never-shown",
    src: "src/agent/goal.ts",
    test: "tests/goal-price.test.ts",
    desc: "在途 worker 的滞后不再说出口 ⇒ 下一轮数字突然跳升，会被模型和人读成「上一轮什么都没花」",
    apply: (s) => s.replace("  const lag = pendingWorkerSpend > 0", "  const lag = pendingWorkerSpend < 0"),
    expectFail: "在途 worker 的那一段写进提醒块；没有在途时逐字不提（每轮重送，少一行是一行的 token）",
  },
  {
    id: "goal-lag-count-not-passed-at-call-site",
    src: "src/main/agent-runner.ts",
    test: "tests/goal-stop-decision.test.ts",
    // 第一版写这条时**变异存活**：goalReminder 的默认值是 0 ⇒ "省略这一位"与"传 0"行为逐字相同，
    // 而可选参数后面加不了必填，编译器也接不了这格。改由那条生产入口形状断言守住
    // （与 `decision.hint` 同一处、同一手法），这条才有了可杀的靶子。
    desc: "调用点不递第 6 个实参 ⇒ 提醒块永远不提「本拍的美元里还没有在途 worker 那一段」",
    apply: (s) => s.replace("goalReminder(view.spec, turn, spentUsd, view.evidence, decision.hint, unbookedWorkers)", "goalReminder(view.spec, turn, spentUsd, view.evidence, decision.hint)"),
    expectFail: "生产入口真的把 decision.hint 传进去（goalNextTurn 未导出 ⇒ 只能钉这一行的形状）",
  },
  {
    id: "session-budget-inert-silent",
    src: "src/agent/orchestrator.ts",
    test: "tests/m3c.test.ts",
    desc: "「估不出价所以闸不生效」不再出声（用户设的成本底线悄悄不存在，且读日志的人也拿不到模型名）",
    apply: (s) => s.replace("      if (!this.budgetInertWarned) {", "      if (false) {"),
    expectFail: "单价填了仍以单价为准（旧语义逐字保留）；估不出价 ⇒ 不拦但出声一次，不拿 $0 冒充实付",
  },
  // ---- 缓存分块进事件流（444fdcd）----
  {
    id: "anthropic-total-excludes-cache-buckets",
    src: "src/providers/anthropic.ts",
    test: "tests/provider-cache-usage.test.ts",
    desc: "总输入退回只报 input_tokens（Anthropic 的该字段**不含**缓存读写量 → 长会话输入少算一个量级，底栏 1.5k 而模型实吃 300k）",
    apply: (s) => s.replace("inputTokens: (inputTokens ?? 0) + (cacheRead ?? 0) + (cacheWrite ?? 0),", "inputTokens: inputTokens ?? 0,"),
    expectFail: "input_tokens 不含缓存 ⇒ 事件 inputTokens 补成含缓存总输入，分块另列",
  },
  {
    id: "anthropic-start-cache-frame-ignored",
    src: "src/providers/anthropic.ts",
    test: "tests/provider-cache-usage.test.ts",
    desc: "只认 message_delta 的缓存字段（对端在 message_start 起报、delta 不再回时，整次命中被判成零）",
    apply: (s) => s.replace("        if (event.message?.usage?.cache_read_input_tokens !== undefined) cacheRead = event.message.usage.cache_read_input_tokens;\n        if (event.message?.usage?.cache_creation_input_tokens !== undefined) cacheWrite = event.message.usage.cache_creation_input_tokens;\n", ""),
    expectFail: "缓存量只出现在 message_start（delta 不回缓存字段）时同样要认",
  },
  {
    id: "anthropic-delta-cache-frame-ignored",
    src: "src/providers/anthropic.ts",
    test: "tests/provider-cache-usage.test.ts",
    desc: "不认累计帧 message_delta 里的缓存字段（末帧才是权威累计值，漏读即分块恒缺）",
    apply: (s) => s.replace("        if (event.usage?.cache_read_input_tokens !== undefined) cacheRead = event.usage.cache_read_input_tokens;\n        if (event.usage?.cache_creation_input_tokens !== undefined) cacheWrite = event.usage.cache_creation_input_tokens;\n", ""),
    expectFail: "缓存量只出现在 message_delta（累计帧）时也认，且不跨帧累加",
  },
  {
    id: "openai-cache-read-not-forwarded",
    src: "src/providers/openai.ts",
    test: "tests/provider-cache-usage.test.ts",
    desc: "命中量只进 metering 不进事件（UI/账本/回放/bandit 代价面看不见缓存，A1 开不开没有分母）",
    apply: (s) => s.replace("    ...(read !== null ? { cacheReadInputTokens: read } : {}),\n", ""),
    expectFail: "prompt_tokens_details.cached_tokens 透出为 cacheReadInputTokens（inputTokens 保持含缓存口径）",
  },
  {
    id: "openai-invents-zero-for-write-bucket",
    src: "src/providers/openai.ts",
    test: "tests/provider-cache-usage.test.ts",
    desc: "对端没报写桶时凭空补 0（「缺报」被冒充「写缓存零命中」，meteredCost 的 fail-closed 前提被拆掉）",
    apply: (s) => s.replace("...(write !== null ? { cacheWriteInputTokens: write } : {}),", "cacheWriteInputTokens: write ?? 0,"),
    expectFail: "prompt_tokens_details.cached_tokens 透出为 cacheReadInputTokens（inputTokens 保持含缓存口径）",
  },
  // ---- A1 写侧断点与缓存价（27cadba）----
  {
    id: "anthropic-prompt-cache-default-on",
    src: "src/providers/anthropic.ts",
    test: "tests/prompt-cache-breakpoints.test.ts",
    desc: "断点开关缺省变开（未经用户同意就改写请求体形状：system 从整串变块数组，且每次缓存重写多付 25%）",
    apply: (s) => s.replace("body.system = opts.promptCache === true", "body.system = true"),
    expectFail: "缺省与显式 false ⇒ system 仍是整串、全站零 cache_control（逐字旧行为）",
  },
  {
    id: "anthropic-breakpoint-on-last-system-block",
    src: "src/providers/anthropic.ts",
    test: "tests/prompt-cache-breakpoints.test.ts",
    desc: "断点从首块挪到末块（把逐轮变化的记忆/地图圈进缓存条目 = 每轮重写一段大前缀，比不打点更贵）",
    apply: (s) => s.replace("...(i === 0 ? { cache_control: { type: \"ephemeral\" } } : {})", "...(i === systemParts.length - 1 ? { cache_control: { type: \"ephemeral\" } } : {})"),
    expectFail: "开启 ⇒ 断点只落在静态段：末个 tool + system 首块（易变的记忆/地图留在断点之后）",
  },
  {
    id: "anthropic-breakpoint-on-every-tool",
    src: "src/providers/anthropic.ts",
    test: "tests/prompt-cache-breakpoints.test.ts",
    desc: "每个 tool 都打断点（Anthropic 上限 4 个断点，工具一多直接 400；且重复条目只会多付写价）",
    apply: (s) => s.replace("...(opts.promptCache === true && i === last ? { cache_control: { type: \"ephemeral\" } } : {}),", "...(opts.promptCache === true ? { cache_control: { type: \"ephemeral\" } } : {}),"),
    expectFail: "开启 ⇒ 断点只落在静态段：末个 tool + system 首块（易变的记忆/地图留在断点之后）",
  },
  {
    id: "pricing-cache-null-priced-as-zero",
    src: "src/routing/pricing.ts",
    test: "tests/prompt-cache-breakpoints.test.ts",
    desc: "缓存价未标定当成 0（把「不知道多少钱」冒充「命中免费」，bandit 会为了虚假的省钱信号涌向缓存档）",
    apply: (s) => s.replace("const readRate = p.cacheReadPerMTok ?? p.inputPerMTok;", "const readRate = p.cacheReadPerMTok ?? 0;"),
    expectFail: "未标定档位 ⇒ 带缓存分块与不带的成本逐字同值（上界口径，零回归）",
  },
  {
    id: "pricing-cache-buckets-unclamped",
    src: "src/routing/pricing.ts",
    test: "tests/prompt-cache-breakpoints.test.ts",
    desc: "分块不夹进总输入区间（对端报数不一致时未命中段变负数，成本能被缓存量抵成负的）",
    apply: (s) => s.replace("const read = Math.max(0, Math.min(usage.cacheReadInputTokens ?? 0, usage.inputTokens));", "const read = Math.max(0, usage.cacheReadInputTokens ?? 0);"),
    expectFail: "分块大于总输入（对端报数不一致）⇒ 夹到区间内，不出现负数输入",
  },
  {
    id: "orchestrator-prompt-cache-not-plumbed",
    src: "src/agent/orchestrator.ts",
    test: "tests/prompt-cache-breakpoints.test.ts",
    desc: "路由分支合成模型时不把开关交给分派层（断点逻辑全对，但没有任何调用方能打开它 = 又一次「发货了没人接」）",
    apply: (s) => s.replace("toWorkerModel(routedSpec, this.opts.promptCache === true ? { promptCache: true } : {})", "toWorkerModel(routedSpec)"),
    expectFail: "开 promptCache ⇒ worker 出网的请求体里确有 cache_control（能力真可达，不是纸面开关）",
  },
  // ---- 靶场装配探针（fdc1e7b）----
  {
    id: "probe-all-system-counted-static",
    src: "src/agent/gym/probe.ts",
    test: "tests/gym-probe.test.ts",
    desc: "把全部 system 块都算成可缓存前缀（记忆/地图逐轮变化被当成静态段 → A1 的收益与成本全被高估）",
    apply: (s) => s.replace("if (!seenSystem) { firstSystemBytes = b; seenSystem = true; } else volatileSystemBytes += b;", "firstSystemBytes += b; seenSystem = true;"),
    expectFail: "可缓存 = 首条 system + 工具 schema；易变 system 与历史各归各段",
  },
  {
    id: "probe-tool-schema-not-counted",
    src: "src/agent/gym/probe.ts",
    test: "tests/gym-probe.test.ts",
    desc: "装配账里漏掉工具 schema（实测占短任务 prompt 的九成——漏掉它，探针就专门量不到最贵的那一块）",
    apply: (s) => s.replace('const toolsJson = tools && tools.length > 0 ? JSON.stringify(tools) : "";', 'const toolsJson = "";'),
    expectFail: "没有工具 ⇒ 工具面 0 字节（可缓存段只剩基础提示）",
  },
  {
    id: "probe-delta-sign-reversed",
    src: "src/agent/gym/probe.ts",
    test: "tests/gym-probe.test.ts",
    desc: "A/B 差分前后颠倒（省了报成多花、多花报成省了——这张表就是为这个判断存在的）",
    apply: (s) => s.replace("totalPromptBytes: after.totalPromptBytes - before.totalPromptBytes,", "totalPromptBytes: before.totalPromptBytes - after.totalPromptBytes,"),
    expectFail: "A/B：只读档工具面更小 ⇒ 可缓存前缀变小（差分表能报出这次装载省了多少）",
  },
  {
    id: "probe-script-shape-check-removed",
    src: "src/agent/gym/script.ts", // 2026-09-19 剧本装载随切轮重构搬进 script.ts，锚点同迁
    test: "tests/gym-probe.test.ts",
    desc: "剧本出现非模型产出类型时不报错继续跑（装配账照发，但回放的是残缺剧本 = 假数）",
    apply: (s) => s.replace("else throw new Error(`装配探针剧本只接受", "else void (`装配探针剧本只接受"),
    expectFail: "剧本形状不合（非 assistant/tool_call）⇒ 显式抛错，不静默少装",
  },
  {
    id: "probe-assembly-not-returned",
    src: "src/agent/gym/runner.ts",
    test: "tests/gym-probe.test.ts",
    desc: "runCase 算出装配账却不带回结果（CLI 与基线永远看不到那一行——探针退化成只有单测能碰的死码）",
    apply: (s) => s.replace("return probe ? { ...result, assembly: probe.report() } : result;", "return result;"),
    expectFail: "runCase 的 probe 档把装配账带出来（CLI 走的就是这条路，不是只测纯函数）",
  },
  {
    id: "probe-ranking-drops-separators",
    src: "src/agent/gym/probe.ts",
    test: "tests/gym-probe.test.ts",
    desc: "拆账漏掉数组分隔符（排行相加 ≠ 工具面总字节 → 「砍掉这条省 1710B」算少一截，决策账目不闭合）",
    apply: (s) => s.replace("        + (i < n - 1 ? 1 : 0), // 与下一项之间的 \",\"", "        + 0, // 与下一项之间的 \",\""),
    expectFail: "排行相加恰等于工具 schema 总字节（含括号与逗号，不留结构开销当糊涂账）",
  },
  {
    id: "probe-ranking-sort-reversed",
    src: "src/agent/gym/probe.ts",
    test: "tests/gym-probe.test.ts",
    desc: "排行改成升序（CLI 前三名打成最便宜的三条 → 照着表砍错刀）",
    apply: (s) => s.replace(".sort((a, b) => b.bytes - a.bytes);", ".sort((a, b) => a.bytes - b.bytes);"),
    expectFail: "排行相加恰等于工具 schema 总字节（含括号与逗号，不留结构开销当糊涂账）",
  },
  {
    id: "probe-ranking-not-attached",
    src: "src/agent/gym/probe.ts",
    test: "tests/gym-probe.test.ts",
    desc: "报告不带排行（函数正确但没人拿得到 → CLI 那一行永远不打印）",
    apply: (s) => s.replace("report: () => ({ ...summarizeAssembly(opts.caseId, turns), toolRanking: rankToolSpecs(tools) }),", "report: () => summarizeAssembly(opts.caseId, turns),"),
    expectFail: "probe 报告带排行；工具面字节的和 = 可缓存前缀里的工具部分",
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
    id: "gym-round-boundary-never-matches",
    src: "src/agent/gym/script.ts",
    test: "tests/gym-script.test.ts",
    desc: "轮边界判据永不成立（一次请求吐完整条剧本 = 靶场退回单次请求会话，逐轮机制再次没有样本）",
    apply: (s) => s.replace("    if (script[i].type === \"tool_call\") {\n", "    if (script[i].type === \"never-tool-call\") {\n"),
    expectFail: "一轮 = 文本 + 它那一个 tool_call（tool_call 含在本轮内）",
  },
  {
    id: "gym-round-cursor-stalls",
    src: "src/agent/gym/script.ts",
    test: "tests/gym-script.test.ts",
    desc: "轮边界处游标不前进（同一条 tool_call 每轮重吐：模型反复执行同一次写入，事件流与判卷全被污染）",
    apply: (s) => s.replace("      i += 1; // 这一轮到 tool_call 为止，剩下的下轮再给\n", "      // 游标停在 tool_call 上，不前进\n"),
    expectFail: "切到剧本跑完不丢条、不重复：逐轮串起来恰等于原剧本",
  },
  {
    id: "gym-probe-transport-drains-all",
    src: "src/agent/gym/probe.ts",
    test: "tests/gym-rounds-e2e.test.ts",
    desc: "探针 transport 绕过切源、一次吐完（装配账把 10 轮会话记成 1 次请求，成本面当场少算一个数量级）",
    apply: (s) => s.replace(
      "    const round = takeRound(script, cursor);\n    cursor = round.next;\n    for (const output of round.outputs) yield output;\n",
      "    while (cursor < script.length) yield script[cursor++];\n",
    ),
    expectFail: "probe 档逐轮装配：轮号递增、同一输入下账不变、尾部跑完即空",
  },
  {
    id: "pricing-unpriced-audit-always-empty",
    src: "src/routing/pricing.ts",
    test: "tests/prompt-cache-breakpoints.test.ts",
    desc: "占位价审计清单恒空（GLM 三行官方页没抓到数这件事被抹掉 ⇒ 未标定的数被当成实测喂进 bandit 代价项）",
    apply: (s) => s.replace(
      "  return Object.keys(table).filter((id) => table[id].calibrated !== true).sort();\n",
      "  return [];\n",
    ),
    expectFail: "输入价仍是占位的档位单独可查（GLM 官方页没抓到数 ⇒ 不许当省钱证据）",
  },
  {
    id: "pricing-cache-write-bucket-priced-as-zero",
    src: "src/routing/pricing.ts",
    test: "tests/prompt-cache-breakpoints.test.ts",
    desc: "缓存写入段按 0 计（Anthropic 建缓存那一笔实测是输入的 ×1.25，抹成免费 ⇒ 首次请求的成本被系统性低估，路由会被「看起来便宜」的档吸走）",
    apply: (s) => s.replace("const writeRate = p.cacheWritePerMTok ?? p.inputPerMTok;", "const writeRate = p.cacheWritePerMTok ?? 0;"),
    expectFail: "未标定档位 ⇒ 带缓存分块与不带的成本逐字同值（上界口径，零回归）",
  },
  {
    id: "impact-query-param-whitelist-removed",
    src: "src/tools/impact-query.ts",
    test: "tests/impact-query.test.ts",
    desc: "参数「恰好给一个」的校验摘掉（两个都给时 file 分支先返回、symbol 被静默忽略；都不给时拿 undefined 去查空图 = 假答案）",
    apply: (s) => s.replace("      if ((symbol === \"\") === (fileArg === \"\")) {\n", "      if (false) {\n"),
    expectFail: "参数必须恰好一个：两个都给 / 都不给 / 类型不对都显式报错",
  },
  {
    id: "impact-query-unknown-symbol-silent",
    src: "src/tools/impact-query.ts",
    test: "tests/impact-query.test.ts",
    desc: "图里没有的符号不再说明原因（改名后的符号会被报成「波及半径为 0」——模型据此判定没人用，直接删掉它）",
    apply: (s) => s.replace("      if (defined.length === 0 && refSites.length === 0) {\n", "      if (false) {\n"),
    expectFail: "图里没有的符号：fail-visible 说明原因，不静默返回空",
  },
  {
    id: "impact-query-spec-name-drift",
    src: "src/tools/impact-query.ts",
    test: "tests/impact-query.test.ts",
    desc: "模型可见规格与可执行实例改名分叉（模型调 impact_query、工具表只有 impact ⇒ 「执行面有、模型面没有」的原罪复发）",
    apply: (s) => s.replace("export const impactQuerySpec = {\n  name: \"impact_query\",\n", "export const impactQuerySpec = {\n  name: \"impact\",\n"),
    expectFail: "规格与实例一一对应，且名字一致",
  },
  {
    id: "impact-query-file-mode-lists-local-symbols",
    src: "src/tools/impact-query.ts",
    test: "tests/impact-query.test.ts",
    desc: "file 模式改回照抄 fileImpact.symbols（局部变量 base/boosted 混进摘要：一屏无关名字，token 白花还不给可执行信息）",
    apply: (s) => s.replace("        const refSyms = [...new Set(r.up.map((s) => s.symbol))].sort();\n", "        const refSyms = [...r.symbols].sort();\n"),
    expectFail: "file 模式汇聚该文件全部符号的波及面（只列真被外部引用的符号，不抄局部名）",
  },

  // ── 文档预算门 / 耗时账本 / 可判性闸（spec §7；判据全是纯函数，内存字符串进 findings 出）
  {
    id: "docs-budget-comparison-flipped",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "字节预算比较符翻成 >=（恰好踩线的合规文件被判红——本仓自己定过「预算只准调低」，误伤即逼人放宽常量）",
    apply: (s) => s.replace("if (f.bytes > limit) {", "if (f.bytes >= limit) {"),
    expectFail: "恰好等于预算不判红（钉住「严格大于」——比较符翻成 >= 即红在此）",
  },
  {
    id: "docs-budget-empty-file-blind",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "去掉空壳分支（0 字节的 AGENTS.md 是「门没了」而不是「瘦到位了」，静默放行等于自我关闭）",
    apply: (s) => s.replace("} else if (f.bytes === 0) {", "} else if (false) {"),
    expectFail: "零字节判红（文件缺失不是合规，是空壳）",
  },
  {
    id: "docs-citation-exemption-blind",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "行级豁免标记完全不认（逃生舱失效后人们只会去拆字符串绕判据——theme.ts 的 DARK_QUERY 拆行就是本仓归档过的反面样例）",
    apply: (s) => s.replace('if (reason !== "") continue;', 'if (reason === "__never__") continue;'),
    expectFail: "同行带 docs-check:allow + 理由 → 放行",
  },
  {
    id: "docs-citation-exemption-file-scope",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "豁免标记从「保所在行」扩成「保整个文件」（一个标记即可让全文件的行号引用逃逸，闸变成装饰）",
    apply: (s) => s.replace("ALLOW_MARK.exec(line)", "ALLOW_MARK.exec(s.text)"),
    expectFail: "豁免标记只保所在行，不豁免整个文件",
  },
  {
    id: "docs-citation-exemption-unaudited",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "空理由也算豁免（豁免不可审计 = 与没有豁免等价，只是给了静默放行的口子）",
    apply: (s) => s.replace('if (reason !== "") continue;', "continue;"),
    expectFail: "标记后不写理由 → 不豁免（豁免必须可审计）",
  },
  {
    id: "docs-state-rev-existence-blind",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "不再校验 rev 指向的提交是否真存在（伪 sha 过关 = 这条判据退化成纯格式检查）",
    apply: (s) => s.replace("if (!shaExists(sha))", "if (false)"),
    expectFail: "rev 指向不存在的提交 → 红（防伪引用，且 detail 带那个 sha）",
  },
  {
    id: "docs-waiver-stale-blind",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "不再挑 stale 豁免（水位条目烂在表里没人清 = 违规面只会随时间悄悄变大）",
    apply: (s) => s.replace("if ((byKey.get(k) ?? []).length === 0) stale.push(k);", "if (false) stale.push(k);"),
    expectFail: "水位已不再被命中 → 记 stale（豁免烂掉必须被清，不能静默留着）",
  },
  {
    id: "docs-waiver-empty-file-waived",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "空壳 0B 也被水位豁免（水位豁免的是存量违规的量，不是「任何违规免死」）",
    apply: (s) => s.replace("if (v === 0 || v > wa.upTo)", "if (v > wa.upTo)"),
    expectFail: "实测 0B（空壳）不被水位豁免——水位豁免的是存量违规的量，不是免死金牌",
  },
  {
    id: "docs-waiver-count-offbyone",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "条数水位的边界挪一格（i > upTo：水位 2 却连第 3 处也放掉，棘轮少咬一条）",
    apply: (s) => s.replace("if (i >= wa.upTo) kept.push(", "if (i > wa.upTo) kept.push("),
    expectFail: "D-3：水位是**条数**——3 处命中配水位 3 全放，配水位 2 只放行前 2 处",
  },
  {
    id: "facts-ring-cap-dropped",
    src: "scripts/facts.ts",
    test: "tests/facts.test.ts",
    desc: "去掉环形上限（账本只增不减，第三份 PROGRESS.md 就是这么长出来的）",
    apply: (s) => s.replace("runs: runs.slice(Math.max(0, runs.length - cap))", "runs: runs"),
    expectFail: "超过上限时丢最旧的那次，保留最近的",
  },
  {
    id: "facts-maxms-takes-last-sample",
    src: "scripts/facts.ts",
    test: "tests/facts.test.ts",
    desc: "历史最贵退化成「最近一次的 ms」（最贵那次被最近一次覆盖 → 「砍哪道门省时间」这张表读出来是错的）",
    apply: (s) => s.replace("maxMs: Math.max(prev?.maxMs ?? 0, g.ms),", "maxMs: g.ms,"),
    expectFail: "maxMs 取样本里的最大值——「哪道门最贵」直接可读",
  },
  {
    id: "mutate-gates-judge-file-blind",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "退回「判卷测试文件不在闸内」的旧语义（别人改到一半的 test 会伪装成基线红或变异存活）",
    apply: (s) => s.replace('if (info.testState !== "clean") {', "if (false) {"),
    expectFail: "源文件干净、**判卷测试文件在飞** → unverified（不得冒充变异存活或基线红）",
  },
  {
    id: "edit-file-hint-indent-branch-removed",
    src: "src/tools/edit_file.ts",
    test: "tests/edit-file-hint.test.ts",
    desc: "缩进判据（首行 trim 后逐字相同）拆掉 ⇒ 最典型的「抄丢缩进」退化成词级 100% 相似度，丢掉唯一可执行的原因（改缩进，不是找别处）",
    apply: (s) => s.replace("    if (lines[i].trim() === want) {\n", "    if (false) {\n"),
    expectFail: "缩进抄丢了：直接点出那一行，并说明是缩进问题",
  },
  {
    id: "edit-file-hint-token-scan-blind",
    src: "src/tools/edit_file.ts",
    test: "tests/edit-file-hint.test.ts",
    desc: "词级扫描不再记录最优行（best 永远 line=-1）⇒ 记错变量名这类 0 匹配回到「重读整个文件再猜」的三轮老路",
    apply: (s) => s.replace("    if (score > best.score) best = { line: i + 1, score, text: trimmed };\n", "    if (false) best = { line: i + 1, score, text: trimmed };\n"),
    expectFail: "变量名记错（靶场长 case 的真实形态）：给出行号 + 原文 + 相似度",
  },
  {
    id: "edit-file-hint-threshold-zero",
    src: "src/tools/edit_file.ts",
    test: "tests/edit-file-hint.test.ts",
    desc: "相似度阈值 0.5 放到 0（只重合一个词的无关行也算「像」）⇒ 假定位把模型引去改完全不相干的一行，比不给提示更坏",
    apply: (s) => s.replace("  if (best.score < 0.5 || best.line < 0) return \"\";\n", "  if (best.line < 0) return \"\";\n"),
    expectFail: "只重合四分一不算像（阈值 0.5 是硬闸）：不给提示",
  },
  {
    id: "edit-file-hint-long-line-unbounded",
    src: "src/tools/edit_file.ts",
    test: "tests/edit-file-hint.test.ts",
    desc: "命中行 120 字符截断拆掉（整行原文塞进报错）⇒ 失败路径反而成了最大的 token 泄漏面，与「消耗 token 最少」直接冲突",
    apply: (s) => s.replace("  const shown = best.text.length > 120 ? best.text.slice(0, 120) + \"…\" : best.text;\n", "  const shown = best.text;\n"),
    expectFail: "命中超长行时只抄 120 字符（截断带省略号，整条报错仍有界）",
  },
  {
    id: "loop-repeat-nudge-note-dropped",
    src: "src/agent/loop.ts",
    test: "tests/loop-repeat-nudge.test.ts",
    desc: "检测照跑、提示却没落进 tool_result（模型看到的仍是裸错误 ⇒ 换路压力为零，重复照旧烧到 maxSteps）",
    apply: (s) => s.replace("        output: result.output + postContext + repeatNote,\n", "        output: result.output + postContext,\n"),
    expectFail: "同一调用连败 3 次：提示挂在那条 tool_result 尾部，前两次一字不加",
  },
  {
    id: "loop-repeat-nudge-defaults-on",
    src: "src/agent/loop.ts",
    test: "tests/loop-repeat-nudge.test.ts",
    desc: "退回「不开也提示」：worker 的 tool_result 被追加尾注 ⇒ 看门比较的观察串从 ×4 相同被打散成 ×3+1 ⇒ orchestrator 卡死永不触发（m3c 实测形态），靶场按字节推的用量也被扰动",
    apply: (s) => s.replace("      if (opts.stuckNudge === true) {\n", "      if (true) {\n"),
    expectFail: "缺省不开：worker / 靶场 / sidechat 那三条路径的事件流一字不动",
  },
  {
    id: "loop-repeat-nudge-nags-every-repeat",
    src: "src/agent/loop.ts",
    test: "tests/loop-repeat-nudge.test.ts",
    desc: "提示帽摘掉（每次重复都叠一句）⇒ 第 5、6 次重复各多一份同一句话，提示自己变成 token 泄漏面",
    apply: (s) => s.replace("        if (verdict.stuck && !nudgedActions.has(action)) {\n", "        if (verdict.stuck) {\n"),
    expectFail: "每个 rule+action 只提示一次（第 4、5 次重复不再叠同一句话）",
  },
  {
    id: "loop-repeat-nudge-never-rearms",
    src: "src/agent/loop.ts",
    test: "tests/loop-repeat-nudge.test.ts",
    desc: "换动作时不解除提示帽 ⇒ 一个 run 里第一次被忽略后就永远叫不醒（第二段同样的连败拿不到提示）",
    apply: (s) => s.replace("        if (lastTurn !== undefined && lastTurn.action !== action) nudgedActions.delete(lastTurn.action);\n", "        if (false) nudgedActions.delete(lastTurn.action);\n"),
    expectFail: "换过动作再回到同一调用 ⇒ 重复段重新计，会再提示一次（不是一 run 只提示一次）",
  },
  {
    id: "docs-obs-spec-exempt-blind",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "规格值免检整条摘掉（≤1000ms 这类**契约**被判成手抄观测值 ⇒ 人们只好去改判据，判卷纪律最忌的那一步）",
    apply: (s) => s.replace("if (SPEC_CONTEXT.test(line)) continue;", "if (false) continue;"),
    expectFail: "带比较符的规格阈值放行（≤1000ms 是契约不是观测）",
  },
  {
    id: "docs-obs-scope-widened",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "D-2 适用面从「现行层五页」扩到所有页（archive 与 dated spec 里的历史观测值被追溯判红 ⇒ 门变成不可满足，等价于关掉）",
    apply: (s) => s.replace(
      "if (!LIVE_PAGES.includes(p.path)) continue; // archive/、dated specs/、源码不受这条管",
      "if (false) continue; // archive/、dated specs/、源码不受这条管",
    ),
    expectFail: "只有受管现行页参与判定：archive/ 与 specs/ 与源码都不判",
  },
  {
    id: "docs-appendnote-scope-widened",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "D-4 的档案层放行被摘（archive 就是「当日快照不得改写」这类话的唯一归宿，判红等于禁止留历史）",
    apply: (s) => s.replace(
      "if (!LIVE_PAGES.includes(p.path)) continue; // 档案层就是这类字的归宿",
      "if (false) continue; // 档案层就是这类字的归宿",
    ),
    expectFail: "档案层正是这类字的归宿，不判红",
  },
  {
    id: "docs-appendnote-wordlist-as-any-digit",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "追注词表退化成「含数字即追注」（带日期的正常裁决句被判红，误伤一次就会有人整条关掉 D-4）",
    apply: (s) => s.replace("const APPEND_CORRECTION = /上面那句|", "const APPEND_CORRECTION = /\\d|上面那句|"),
    expectFail: "普通叙述不误伤（带日期不等于追注）",
  },
  {
    id: "docs-shots-count-collapsed",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "图片数退化成恒 1（水位 25 变成永远咬不到的摆设，docs/ 可无限塞二进制）",
    apply: (s) => s.replace("    value: hits.length,", "    value: 1,"),
    expectFail: "聚合成一条 finding，value = 文件数",
  },
  {
    id: "write-delta-steer-removed",
    src: "src/tools/write_file.ts",
    test: "tests/write-line-delta.test.ts",
    desc: "行数照算但「整份重写只动几行」的提示摘掉 ⇒ 模型下一次照样整文件重抄，改动范围最小成了没有回执的口号",
    apply: (s) => s.replace("            ? `｜提示：这是对已有 ${oldCount} 行文件的整份重写，实际只动 ${d.added + d.removed} 行——同类改动用 edit_file 更省 output，也不会漏抄未改的行。`\n", "            ? \"\"\n"),
    expectFail: "整份重写 60 行文件只动 1 行 ⇒ 报数并提示改用 edit_file",
  },
  {
    id: "write-delta-large-file-claims-new",
    src: "src/tools/write_file.ts",
    test: "tests/write-line-delta.test.ts",
    desc: "大到不值得读的既有文件也去读（或统计失败时按 0 行处理）⇒ 把「不知道」报成「新建」，覆盖掉整个旧文件却显示新建",
    apply: (s) => s.replace("      oldText = st.size <= DELTA_READ_LIMIT_BYTES ? await readFile(abs, \"utf8\") : null;\n", "      oldText = await readFile(abs, \"utf8\");\n"),
    expectFail: "既有文件大到不统计时，退回旧口径而不是假装是新建（不拿「不知道」当「新建」）",
  },
  {
    id: "line-delta-trailing-newline-counted",
    src: "src/tools/line-delta.ts",
    test: "tests/line-delta.test.ts",
    desc: "结尾换行不再剥掉 ⇒ 每个正常文件凭空多一行，纯换行符差异也报 +1/−1，行数与编辑器显示不一致",
    apply: (s) => s.replace("  if (arr[arr.length - 1] === \"\") arr.pop();\n", ""),
    expectFail: "空串是 0 行；结尾换行不额外算一行",
  },
  {
    id: "line-delta-set-not-multiset",
    src: "src/tools/line-delta.ts",
    test: "tests/line-delta.test.ts",
    desc: "匹配到就把该行的计数清零（按集合而非多重集）⇒ 重复行删掉两行只报 −0，「丢代码」的信号被吞",
    apply: (s) => s.replace("    if (c > 0) counts.set(l, c - 1);\n", "    if (c > 0) counts.set(l, 0);\n"),
    expectFail: "重复行按多重集算，不按集合（三行相同删掉两行要报 −2）",
  },
  {
    id: "line-delta-near-copy-size-floor-removed",
    src: "src/tools/line-delta.ts",
    test: "tests/line-delta.test.ts",
    desc: "去掉 40 行下界 ⇒ 三五行的文件也被告知「该用 edit_file」，提示密度变噪声",
    apply: (s) => s.replace("  return oldLineCount >= 40 && changedLineCount <= oldLineCount * 0.1;\n", "  return changedLineCount <= oldLineCount * 0.1;\n"),
    expectFail: "39 行的小文件即使只动 1 行也不提示（重写与补丁的成本差可忽略，提示只是噪声）",
  },
  {
    id: "line-delta-near-copy-ratio-never-fires",
    src: "src/tools/line-delta.ts",
    test: "tests/write-line-delta.test.ts",
    desc: "改动占比阈值放到 100% ⇒ 纯改写（60 行动 30 行）也提示「该用 edit_file」，把模型推向更坏的路径",
    apply: (s) => s.replace("  return oldLineCount >= 40 && changedLineCount <= oldLineCount * 0.1;\n", "  return oldLineCount >= 40;\n"),
    expectFail: "整份重写确实动了 30 行 ⇒ 不提示（真改写不该被劝去用补丁）",
  },
  {
    id: "edit-file-delta-hardcoded-zero",
    src: "src/tools/edit_file.ts",
    test: "tests/write-line-delta.test.ts",
    desc: "edit_file 的行增减写死 0（处数留着、行数假报）⇒ 「一个补丁实际改了 8 行」重新变得看不见",
    apply: (s) => s.replace("    const d = lineDelta(content, updated);\n", "    const d = { added: 0, removed: 0 };\n"),
    expectFail: "edit_file 的成功输出带行增减（处数说不了动了多少行）",
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
    id: "base-system-test-first-rule-removed",
    src: "src/main/agent-runner.ts",
    test: "tests/base-system-discipline.test.ts",
    desc: "「先写复现测试跑到红」这条纪律被删（提示词回到「改完就说修好了」，能力 5 最关键那条失去唯一的字面抓手）",
    apply: (s) => s.replace("  \"4) 修 bug 先写一条能复现它的测试并跑到红，再改代码到绿；没有红过的复现就不要宣称已修复；\",\n", ""),
    expectFail: "先红后绿写进纪律：修 bug 必须先有跑到红的复现，没红过不得宣称修好（能力 5 的正面）",
  },
  {
    id: "base-system-patch-first-rule-removed",
    src: "src/main/agent-runner.ts",
    test: "tests/base-system-discipline.test.ts",
    desc: "「改已有文件用 edit_file 打补丁」被删 ⇒ 模型继续整文件重抄（write_file 的行数提示只在事后，事前预防更省一轮）",
    apply: (s) => s.replace("  \"3) 改已有文件用 edit_file 打补丁，write_file 只用于新建文件（整份重抄既费 output 又容易漏抄未改的行）；\",\n", ""),
    expectFail: "补丁优先写进纪律：改已有文件用 edit_file，write_file 只用于新建（能力 2「补丁级 diff」）",
  },
  {
    id: "base-system-judging-file-conflict-restored",
    src: "src/main/agent-runner.ts",
    test: "tests/base-system-discipline.test.ts",
    desc: "去掉「第 4 条是新增用例，不是改判卷面」的消歧 ⇒ 两条纪律互相矛盾，模型只能二选一（要么不写复现，要么去改判卷文件）",
    apply: (s) => s.replace("  \"6) 只改任务需要的文件；既有测试与判卷文件不得改写（第 4 条是**新增**用例，不是改判卷面）。\",\n", "  \"6) 只改任务需要的文件，不改测试与判卷文件。\",\n"),
    expectFail: "两条纪律不互斥：明确「第 4 条是新增用例，不是改判卷文件」",
  },
  {
    id: "impact-query-deps-mode-ignored",
    src: "src/tools/impact-query.ts",
    test: "tests/impact-query.test.ts",
    desc: "deps 分支不进入（参数收了、规格也写了，结果仍只给「谁在调用我」⇒ 反向依赖理解重新变成够不着的能力）",
    apply: (s) => s.replace("        if (wantDeps) {\n", "        if (false) {\n"),
    expectFail: "deps 模式列本文件引用的外部定义（我在调用谁），自身文件内的定义不算",
  },
  {
    id: "impact-query-deps-combination-unguarded",
    src: "src/tools/impact-query.ts",
    test: "tests/impact-query.test.ts",
    desc: "deps 配 symbol 时不再报错（被静默忽略 ⇒ 模型以为拿到了依赖清单，实际拿到的是波及清单）",
    apply: (s) => s.replace("      if (wantDeps && fileArg === \"\") {\n", "      if (false) {\n"),
    expectFail: "deps 只能配 file：配 symbol 或裸给都显式报错（不静默忽略）",
  },
  {
    id: "impact-query-deps-noun-leaks-into-up",
    src: "src/tools/impact-query.ts",
    test: "tests/impact-query.test.ts",
    desc: "up 方向改用语义标签（措辞串门）⇒ 不带 deps 的既有调用输出不再逐字不变，「谁在调用我」被说成「我在调用谁」",
    apply: (s) => s.replace("        return { ok: true, output: sitesNote(head, r.up) };\n", "        return { ok: true, output: sitesNote(head, r.up, DEP_NOUN) };\n"),
    expectFail: "不带 deps 时 file 模式输出逐字不变（新增方向不得改动既有字节）",
  },
  {
    id: "impact-query-deps-ghost-file-silent",
    src: "src/tools/impact-query.ts",
    test: "tests/impact-query.test.ts",
    desc: "deps 分支不查图内成员（路径写错/后缀不支持时报「依赖面为 0」）⇒ 模型把「没扫到」读成「这个文件不依赖任何东西」",
    apply: (s) => s.replace("          if (!graph.files.includes(rel)) return { ok: false, output: await notInGraphNote(ctx.workspace, rel, abs) };\n", ""),
    expectFail: "deps 模式下不在图内的文件仍然 fail-visible",
  },
  {
    id: "shell-tail-transition-remainder-lost",
    src: "src/tools/output-ring.ts",
    test: "tests/shell-tail.test.ts",
    desc: "溢出发生在单个 chunk 内部时不喂尾环（子进程一次吐完 60KB 是常态）⇒ 「保留了结尾」变成假话，尾部结论仍被丢",
    apply: (s) => s.replace("        tail = out.slice(headBytes);\n", "        tail = \"\";\n"),
    expectFail: "超上限时头部与**结尾**都在（旧实现于源头丢掉了 32KB 之后的一切）",
  },
  {
    id: "shell-tail-assembly-drops-tail",
    src: "src/tools/output-ring.ts",
    test: "tests/shell-tail.test.ts",
    desc: "尾环算好了却在拼装时没接上（模型看到的仍是纯头部）",
    apply: (s) => s.replace("    ? head + \"\\n\" + middleTruncationNotice(seen - headBytes - tail.length) + \"\\n\" + tail\n", "    ? head + \"\\n\" + middleTruncationNotice(seen - headBytes - tail.length)\n"),
    expectFail: "超上限时头部与**结尾**都在（旧实现于源头丢掉了 32KB 之后的一切）",
  },
  {
    id: "shell-tail-omitted-count-lies",
    src: "src/tools/output-ring.ts",
    test: "tests/shell-tail.test.ts",
    desc: "省略字节数写死 0（提示说「什么都没省」）⇒ 模型据此认为看到的就是全部输出",
    apply: (s) => s.replace("middleTruncationNotice(seen - headBytes - tail.length)", "middleTruncationNotice(0)"),
    expectFail: "省略字节数如实报出：省略量 + 保留量 = 实际总输出",
  },
  {
    id: "shell-tail-notice-reserve-removed",
    src: "src/tools/output-ring.ts",
    test: "tests/tools.test.ts",
    desc: "取消提示行的预算预留 ⇒ 提示自己把「输出 ≤ 32KB」撑破（中文提示一行就 ~150B）",
    apply: (s) => s.replace("const NOTICE_RESERVE_BYTES = 256;", "const NOTICE_RESERVE_BYTES = 0;"),
    expectFail: "超限：输出超过 32KB 截断并附一行提示",
  },
  {
    id: "grep-context-cap-removed",
    src: "src/tools/grep.ts",
    test: "tests/grep-context.test.ts",
    desc: "取消上下文档位帽 ⇒ 一句 context=99 就能把整份文件灌进上下文（预算先到先得，后面的调用点全看不见）",
    apply: (s) => s.replace("Math.min(CONTEXT_MAX, contextRaw)", "Number(contextRaw)"),
    expectFail: "上下文帽到 5 行：context=99 也只各带 5 行（宽档位不许把预算吃光）",
  },
  {
    id: "grep-context-lines-eat-hit-budget",
    src: "src/tools/grep.ts",
    test: "tests/grep-context.test.ts",
    desc: "命中帽按「行」而非按「命中」计 ⇒ context=5 时可检索命中数被砍到 1/6，模型以为仓库里只有这几处",
    apply: (s) => s.replace("if (!m.ctx) {\n      hits++;", "if (true) {\n      hits++;"),
    expectFail: "邻行不占命中额：130 条命中 + context=1 仍列满 100 条，截断走旧口径而非预算",
  },
  {
    id: "grep-context-marker-collides-hit",
    src: "src/tools/grep.ts",
    test: "tests/grep-context.test.ts",
    desc: "邻行前缀去掉缩进 ⇒ 与命中行难以分辨，模型把邻行抄进 old_string 后 not-found 白跑一轮",
    apply: (s) => s.replace('? "  " + String(m.line) + " | "', '? String(m.line) + " | "'),
    expectFail: "context=1 带回前后各一行，且命中行与邻行前缀可分辨（拼 old_string 不会拿错行）",
  },
  {
    id: "grep-always-emits-context",
    src: "src/tools/grep.ts",
    test: "tests/grep-context.test.ts",
    desc: "缺省就带邻行 ⇒ 既有查询输出全体膨胀（「缺省 = 零行为」这条被破）",
    apply: (s) => s.replace('...(context > 0 ? ["-C", String(context)] : []),', '...(["-C", "1"] as string[]),'),
    expectFail: "缺省不带上下文：输出形态与旧口径逐字一致（零回归）",
  },
  {
    id: "grep-fixed-flag-dropped",
    src: "src/tools/grep.ts",
    test: "tests/grep-context.test.ts",
    desc: "接了参数却不传 -F ⇒ fixed_strings 成为空转，模型以为收窄了其实没收窄",
    apply: (s) => s.replace('...(fixed ? ["-F"] : []),', "...(fixed ? [] : []),"),
    expectFail: "fixed_strings=true 按字面串匹配：正则模式会把 a.b 曲解成多命中（假阳性且不报错）",
  },
  {
    id: "grep-budget-omitted-count-lies",
    src: "src/tools/grep.ts",
    test: "tests/grep-context.test.ts",
    desc: "预算截断时不报未列出条数 ⇒ 模型以为已经看全所有调用点，直接开始改",
    apply: (s) => s.replace("还有 ${String(r.omittedHits)} 条命中未列出", "有命中未列出"),
    expectFail: "上下文预算兜住宽查询：超 8KB 即止并报出未列出条数（不静默半路断）",
  },
  {
    id: "verify-output-cap-removed",
    src: "src/agent/verify.ts",
    test: "tests/verify.test.ts",
    desc: "验证门不接环（无上限）⇒ 一次失败的测试跑把整段日志原样灌进同轮上下文，token 账单按套件规模长",
    apply: (s) => s.replace("const ring = createOutputRing(OUTPUT_LIMIT);", "const ring = createOutputRing(Number.MAX_SAFE_INTEGER);"),
    expectFail: "超 32KB 的失败输出：头尾都在，尾部结论进了 failureDigest",
  },
  {
    id: "ring-always-treats-as-overflow",
    src: "src/tools/output-ring.ts",
    test: "tests/output-ring.test.ts",
    desc: "溢出判定形同恒真 ⇒ 每一条正常输出都被拼上截断提示（「未溢出逐字不变」这条零回归承诺被破）",
    apply: (s) => s.replace("if (out.length > limitBytes) {", "if (out.length >= 0) {"),
    expectFail: "未溢出：逐字全文，一行提示都不加（零回归面）",
  },
  {
    id: "ring-tail-window-unbounded",
    src: "src/tools/output-ring.ts",
    test: "tests/output-ring.test.ts",
    desc: "尾环不设窗口 ⇒ 长输出把预算一路撑大（超限截断等于没截），上下文被一次 shell/verify 灌满",
    apply: (s) => s.replace("    tail += s;\n    if (tail.length > tailBytes) tail = tail.slice(tail.length - tailBytes);", "    tail += s;"),
    expectFail: "总输出含提示行也不超上限（提示自己占位，否则「≤ 32KB」这句承诺被提示撑破）",
  },
  {
    id: "verify-repeat-never-detected",
    src: "src/agent/loop.ts",
    test: "tests/verify.test.ts",
    desc: "去重的相等判定被摘掉 ⇒ 每一拍都重发整段失败日志（省 token 这件事根本没发生）",
    apply: (s) => s.replace("const repeat = digest === lastVerifyDigest;", "const repeat = false;"),
    expectFail: "第 2 拍与第 1 拍逐字相同：改注一行提示，不重发失败正文",
  },
  {
    id: "verify-repeat-note-appends-digest",
    src: "src/agent/loop.ts",
    test: "tests/verify.test.ts",
    desc: "提示行照发、整段摘要还是跟在后面 ⇒ 文案说「不再重复注入」而实现仍然注入（比值断言当场红）",
    apply: (s) => s.replace("repeat ? repeatDigestNote(outcome, attempt) : digest", "repeat ? repeatDigestNote(outcome, attempt) + digest : digest"),
    expectFail: "省下的量可测：32KB 级的相同失败摘要，第二拍注入字节 < 第一拍的 1/10",
  },
  {
    id: "verify-repeat-compares-first-line-only",
    src: "src/agent/loop.ts",
    test: "tests/verify.test.ts",
    desc: "按首行（=命令名）判重 ⇒ 命令没变就被当成「结果没变」，后续真正不同的错误输出被误判为重复而永不注入",
    apply: (s) => s.replace(
      "const repeat = digest === lastVerifyDigest;",
      'const repeat = digest.split("\\n")[0] === (lastVerifyDigest ?? "").split("\\n")[0];',
    ),
    expectFail: "第 3 拍输出变了 ⇒ 全文照常注入（去重不是「只注入一次」）",
  },
  {
    id: "verify-repeat-note-loses-command-list",
    src: "src/agent/verify.ts",
    test: "tests/verify.test.ts",
    desc: "提示里不写是哪些命令没变 ⇒ 「没新信息」变成一句无法据以行动的空话",
    apply: (s) => s.replace('(cmds === "" ? "（无）" : cmds)', '"（略）"'),
    expectFail: "第 2 拍与第 1 拍逐字相同：改注一行提示，不重发失败正文",
  },
  {
    id: "probe-go-branch-removed",
    src: "src/agent/verify.ts",
    test: "tests/verify-probe.test.ts",
    desc: "摘掉 go.mod 一档 ⇒ Go 仓库又回到「未找到 verify 配置」，闭环照旧是死的",
    apply: (s) => s.replace('  if (g !== null) return ["go test ./..."];\n', ""),
    expectFail: "go.mod → go test ./...",
  },
  {
    id: "probe-make-target-not-anchored",
    src: "src/agent/verify.ts",
    test: "tests/verify-probe.test.ts",
    desc: "test: 判定丢掉行首锚 ⇒ Makefile 里一句注释「run test: pytest」就凭空造出验证面（跑不存在的目标）",
    apply: (s) => s.replace("/^test[ \\t]*:/m", "/test[ \\t]*:/m"),
    expectFail: "注释里写着「test:」不算目标（判定锚在行首，否则一句说明就凭空造出验证面）",
  },
  {
    id: "probe-invents-lint-commands",
    src: "src/agent/verify.ts",
    test: "tests/verify-probe.test.ts",
    desc: "把探到的测试命令同时当 lint 用 ⇒ action-fusion 会拿「风格未整理」把干净改动报成失败",
    apply: (s) => s.replace("if (lang.length > 0) return { config: { test: lang, timeoutMs: PROBED_LANG_TIMEOUT_MS }, source: \"probed\" };", "if (lang.length > 0) return { config: { test: lang, lint: lang, timeoutMs: PROBED_LANG_TIMEOUT_MS }, source: \"probed\" };"),
    expectFail: "只补 test 不凭空造 lint（action-fusion 读 config.lint，造出来会把干净改动报成失败）",
  },
  {
    id: "probe-language-outranks-package-json",
    src: "src/agent/verify.ts",
    test: "tests/verify-probe.test.ts",
    desc: "package.json 的 scripts 不再优先 ⇒ 仓库明明配了 `vitest run` 却去跑别的 runner，验证结果与项目自己的口径脱节",
    apply: (s) => s.replace("if (Object.keys(config).length > 0) return { config, source: \"probed\" };", "if (Object.keys(config).length > 99) return { config, source: \"probed\" };"),
    expectFail: "package.json 有 test 脚本时优先，语言探测不参与（零回归）",
  },
  {
    id: "probe-bad-package-json-swallowed",
    src: "src/agent/verify.ts",
    test: "tests/verify-probe.test.ts",
    desc: "坏 package.json 被静默吞掉 ⇒ 项目自己的 test 脚本消失，还装作「没有验证面」",
    apply: (s) => s.replace('    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err; // package.json', '    // package.json'),
    expectFail: "package.json 坏 JSON → fail loud（与 config.json 同口径，不静默降级成「无验证面」）",
  },
  {
    id: "verify-127-label-on-wrong-code",
    src: "src/agent/verify.ts",
    test: "tests/verify-probe.test.ts",
    desc: "工具链缺失的标注挂到别的退出码上 ⇒ 真失败被说成「工具链没装」，而 127 反而什么都不说",
    apply: (s) => s.replace("if (code === 127) output += ", "if (code === 128) output += "),
    expectFail: "命令不存在：红，但明写「不是代码失败」并给出下一步",
  },
  {
    id: "verify-none-message-hides-probes",
    src: "src/agent/verify.ts",
    test: "tests/verify-probe.test.ts",
    desc: "none 文案不提语言探测 ⇒ 模型以为 harness 什么都没试，会去手敲一条本可自动跑的测试命令或干脆放弃验证",
    apply: (s) => s.replace("，也未探到 go/cargo/pytest/make 测试面", ""),
    expectFail: "什么面都没有 → source none，且消息说清查过哪些工具链",
  },
  {
    id: "verify-timeout-not-threaded-to-exec",
    src: "src/agent/verify.ts",
    test: "tests/verify-probe.test.ts",
    desc: "算出了超时却没传给执行器 ⇒ 语言探测档的 300s 只是纸面配置，冷编译照旧被 60s 掐死",
    apply: (s) => s.replace("results.push(await exec(command, repoDir, timeoutMs));", "results.push(await exec(command, repoDir));"),
    expectFail: "语言探测档自带 300s：冷编译 cargo/go 不该被 60s 掐死",
  },
  {
    id: "verify-lang-timeout-same-as-npm",
    src: "src/agent/verify.ts",
    test: "tests/verify-probe.test.ts",
    desc: "探测档沿用 npm 的 60s ⇒ 探出验证面却让它必然超时（比探不出来更坏：给出「已经验过」的错觉）",
    apply: (s) => s.replace("timeoutMs: PROBED_LANG_TIMEOUT_MS }", "timeoutMs: DEFAULT_VERIFY_TIMEOUT_MS }"),
    expectFail: "Cargo.toml → cargo test",
  },
  {
    id: "verify-timeout-validation-removed",
    src: "src/agent/verify.ts",
    test: "tests/verify-probe.test.ts",
    desc: "取消 timeoutMs 校验 ⇒ 单位写错（把秒当毫秒 / 写 0）被静默接受，配置的人以为限制生效了",
    apply: (s) => s.replace("if (typeof t !== \"number\" || !Number.isInteger(t) || t < MIN_VERIFY_TIMEOUT_MS || t > MAX_VERIFY_TIMEOUT_MS) {", "if (false) {"),
    expectFail: "timeoutMs 越界或类型错 → fail loud（静默忽略会让人以为配上了）",
  },
  {
    id: "verify-timeout-message-hardcoded",
    src: "src/agent/verify.ts",
    test: "tests/verify-probe.test.ts",
    desc: "超时消息把秒数写死成 60s ⇒ 配置成别的值时模型读到假限制，会照着「60s 都跑不完」去判断代码",
    apply: (s) => s.replace('"\\n[error: verify 命令超时（" + String(Math.round(timeoutMs / 1000)) + "s），已强制终止', '"\\n[error: verify 命令超时（60s），已强制终止'),
    expectFail: "defaultExec 真按传入上限掐表，消息里的秒数跟着配置走",
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
    src: "src/main/agent-runner.ts",
    test: "tests/verify-exec-sandbox.test.ts",
    desc: "丢掉「沙箱内 pnpm 映射为直连 vitest」（坑三）⇒ 冻结剧本里的 pnpm test 在 Seatbelt 下必然起不来，验证门空转",
    apply: (s) => s.replace("const mapped = command.trim() === \"pnpm test\" || command.trim() === \"pnpm run test\" ? VITEST_DIRECT : command;", "const mapped = command;"),
    expectFail: "pnpm test / pnpm run test 映射为直连 vitest；其它命令逐字不动",
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
    id: "mcp-result-cap-removed",
    src: "src/agent/plugins/mcp.ts",
    test: "tests/mcp-bounds.test.ts",
    desc: "tools/call 结果不设有界（外部 server 一次吐 200KB 直接进上下文）⇒ 成本与「输出上限 + 截断提示」的工具面契约破口",
    apply: (s) => s.replace("return { ok: !isError, output: capMcpResult(parts.join(\"\\n\")) || \"(空结果)\" };", "return { ok: !isError, output: parts.join(\"\\n\") || \"(空结果)\" };"),
    expectFail: "tools/call 的 200KB 结果被收到 32KB 内，尾部结论留住",
  },
  {
    id: "mcp-result-tail-dropped",
    src: "src/agent/plugins/mcp.ts",
    test: "tests/mcp-bounds.test.ts",
    desc: "结果只留头部（提示却写着「首尾已保留」）⇒ server 把结论写在末尾时（错误摘要/统计行）丢的正是最有用的那段",
    apply: (s) => s.replace("    + text.slice(text.length - tail);\n", "    + \"\";\n"),
    expectFail: "超限时长度不越界，且报出的省略数与实现的分段严格相等",
  },
  {
    id: "mcp-omitted-count-lies",
    src: "src/agent/plugins/mcp.ts",
    test: "tests/mcp-bounds.test.ts",
    desc: "省略字符数写死 0 ⇒ 提示说「什么都没省」，模型据此认为手里就是全文（少字节的必要条件是如实报数）",
    apply: (s) => s.replace("String(text.length - head - tail)", "String(0)"),
    expectFail: "超限时长度不越界，且报出的省略数与实现的分段严格相等",
  },
  {
    id: "mcp-cap-note-reserve-removed",
    src: "src/agent/plugins/mcp.ts",
    test: "tests/mcp-bounds.test.ts",
    desc: "取消提示行的预算预留 ⇒ 提示自己把「≤ 上限」这句承诺撑破（中文提示一行就上百字节）",
    apply: (s) => s.replace("const CAP_NOTE_RESERVE = 220;", "const CAP_NOTE_RESERVE = 0;"),
    expectFail: "超限时长度不越界，且报出的省略数与实现的分段严格相等",
  },
  {
    id: "mcp-description-cap-removed",
    src: "src/agent/plugins/mcp.ts",
    test: "tests/mcp-bounds.test.ts",
    desc: "tools/list 的描述不收窄 ⇒ 外部 server 的话痨说明进的是**每轮重送**的工具面（×工具数×轮数），固定成本被抬高一个数量级",
    apply: (s) => s.replace("const desc = typeof t.description === \"string\" ? capMcpDescription(t.description) : \"\";", "const desc = typeof t.description === \"string\" ? t.description : \"\";"),
    expectFail: "tools/list 的 5000 字符描述进注册表时已被收窄（每轮重送的那一份）",
  },
  {
    id: "skill-suffix-not-charged-to-budget",
    src: "src/agent/text-budget.ts",
    test: "tests/skill-body-cap.test.ts",
    desc: "取回提示不计入预算 ⇒ 「总量 ≤ 预算」这句承诺被提示自己撑破（与 run_shell 的 SHELL_NOTICE_RESERVE 同族坑）",
    apply: (s) => s.replace("return cutToWeight(text, Math.max(0, tokenBudget - weightText(notice))) + notice;", "return cutToWeight(text, tokenBudget) + notice;"),
    expectFail: "超限时提示自己不得撑破预算（总量 ≤ 预算，且提示完整保留）",
  },
  {
    id: "skill-primary-budget-abolished",
    src: "src/agent/plugins/index.ts",
    test: "tests/skill-body-cap.test.ts",
    desc: "触发主路径的预算被取消（重挂那头有预算、这头没有）⇒ 200KB 的 SKILL.md 原样进 tool_result，且 skill 免剪 ⇒ 整个会话常驻付费",
    apply: (s) => s.replace("        SKILL_REMOUNT_TOKENS_PER_SKILL,", "        Number.MAX_SAFE_INTEGER,"),
    expectFail: "200KB 正文收到单 skill 预算内，头部留住并给出全文路径",
  },
  {
    id: "skill-primary-hint-lost",
    src: "src/agent/plugins/index.ts",
    test: "tests/skill-body-cap.test.ts",
    desc: "截断后不给全文路径 ⇒ 模型只看到「已截断」却没有任何取回通道，只能凭半份正文动手（或反复重触发同一个 skill）",
    apply: (s) => s.replace("\"\\n[全文见 \" + entry.path + \"]\"),", "\"\"),"),
    expectFail: "200KB 正文收到单 skill 预算内，头部留住并给出全文路径",
  },
  {
    id: "mcp-schema-leaf-cap-removed",
    src: "src/agent/plugins/mcp.ts",
    test: "tests/mcp-bounds.test.ts",
    desc: "取消单叶上限 ⇒ server 把 8KB 散文写进每个参数的 description，40 参数的工具就是 320KB 进**每轮**工具面",
    apply: (s) => s.replace("  if (text.length <= MCP_SCHEMA_LEAF_CHAR_LIMIT) return text;", "  return text;"),
    expectFail: "长 description 叶子被收，但键名/type/required/enum 一个不动",
  },
  {
    id: "mcp-schema-depth-guard-removed",
    src: "src/agent/plugins/mcp.ts",
    test: "tests/mcp-bounds.test.ts",
    desc: "取消深度闸 ⇒ 递归不再是「有界近似」而是「原样透传」，超深嵌套（递归 $ref 展开）照单全收",
    apply: (s) => s.replace("  if (depth >= MCP_SCHEMA_DEPTH_LIMIT) {", "  if (depth >= Number.MAX_SAFE_INTEGER) {"),
    expectFail: "超深子树整体换成占位（仍是一个合法 object，且计入收窄数）",
  },
  {
    id: "mcp-schema-clamped-count-lies",
    src: "src/agent/plugins/mcp.ts",
    test: "tests/mcp-bounds.test.ts",
    desc: "收窄处数不计数 ⇒ 模型看到「结构完整」的工具面，实际参数说明是节选，却没有任何信号（fail-silent）",
    apply: (s) => s.replace("    if (out !== v) tally.clamped++;\n", "    tally.clamped += 0;\n"),
    expectFail: "长 description 叶子被收，但键名/type/required/enum 一个不动",
  },
  {
    id: "mcp-schema-cap-not-wired",
    src: "src/agent/plugins/mcp.ts",
    test: "tests/mcp-bounds.test.ts",
    desc: "函数写了却没接进 tools/list ⇒ 注册表里仍是原文 schema，「有 cap」只是模块里的死代码（本仓第 8 次同族缺陷）",
    apply: (s) => s.replace("          inputSchema: capped.schema,", "          inputSchema: (t.inputSchema ?? {}) as Record<string, unknown>,"),
    expectFail: "tools/list 的长参数说明进注册表前已被收，且描述里如实标注收窄处数",
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
    id: "clamp-marker-label-hardcoded",
    src: "src/agent/text-budget.ts",
    test: "tests/worker-role-budget.test.ts",
    desc: "提示措辞写死成「skill 正文」⇒ 角色块被截时模型看到的是别的面的名字（单位/来源不如实，本仓反复踩过的口径谎言）",
    apply: (s) => s.replace("const marker = \"\\n[\" + label + \"超 \"", "const marker = \"\\n[skill 正文超 \""),
    expectFail: "超限时留头部，总量精确 ≤ 预算，且提示用的是调用方给的 label",
  },
  {
    id: "hook-context-total-budget-removed",
    src: "src/agent/plugins/hooks.ts",
    test: "tests/hooks-context-budget.test.ts",
    desc: "取消聚合预算 ⇒ 逐个 handler 各有 10k 也挡不住 N 个拼成 N×10k，而这串进每条 tool_result 尾部与每轮系统文本",
    apply: (s) => s.replace("if (result.additionalContext.length + text.length > HOOK_CONTEXT_TOTAL_CHAR_LIMIT) {", "if (result.additionalContext.length + text.length > Number.MAX_SAFE_INTEGER) {"),
    expectFail: "四个 9k handler（逐个都在单块上限内）拼不过聚合预算，超出的整块省略并如实报出",
  },
  {
    id: "hook-context-omission-silent",
    src: "src/agent/plugins/hooks.ts",
    test: "tests/hooks-context-budget.test.ts",
    desc: "省了 handler 却不报出 ⇒ 模型以为 hook 说的就这些（fail-silent 比截断更坏：它据此继续动手）",
    apply: (s) => s.replace("if (result.droppedContextHandlers.length > 0) {", "if (false) {"),
    expectFail: "四个 9k handler（逐个都在单块上限内）拼不过聚合预算，超出的整块省略并如实报出",
  },
  {
    id: "hook-deny-reason-uncapped",
    src: "src/agent/plugins/hooks.ts",
    test: "tests/hooks-context-budget.test.ts",
    desc: "JSON deny 的 reason 不收窄 ⇒ 插件用一句「理由」把 50KB 塞进 tool_result 的阻断行（同文件 exit 2 那条早就设界，又一处只在一头生效）",
    apply: (s) => s.replace("result.blockReason = capHookReason(parsed.reason);", "result.blockReason = parsed.reason;"),
    expectFail: "JSON deny 的 reason 不再无界（它进的是 tool_result 里的一行）",
  },
  {
    id: "hook-exit2-reason-follows-output-cap",
    src: "src/agent/plugins/hooks.ts",
    test: "tests/hooks-context-budget.test.ts",
    desc: "退回到「理由跟着 10k 输出上限走」⇒ 一行阻断说明可以是 10k 字符（本轮把它收紧到 2k）",
    apply: (s) => s.replace("const reason = capHookReason(stderr).trim();", "const reason = (stderr.length > HOOK_OUTPUT_CAP ? stderr.slice(0, HOOK_OUTPUT_CAP) : stderr).trim();"),
    expectFail: "exit 2 的 stderr 同样收到理由预算（原先跟着输出上限走，10k 当理由太长）",
  },
  {
    id: "cjk-weight-collapsed-to-quarter",
    src: "src/agent/text-budget.ts",
    test: "tests/text-budget-cjk.test.ts",
    desc: "退回「一律 chars/4」⇒ 中文段被低估四倍，「≤ 2000 token」的角色块实际能到 6k+，且纯英文测试完全测不出",
    apply: (s) => s.replace("return isWideAt(code) ? 1 : 0.25;", "return 0.25;"),
    expectFail: "中文一字计一 token（旧口径会把它记成 1/4，等于预算被低估四倍）",
  },
  {
    id: "cjk-han-range-narrowed",
    src: "src/agent/text-budget.ts",
    test: "tests/text-budget-cjk.test.ts",
    desc: "常用汉字区间被写窄 ⇒ 绝大多数中文正文仍走 1/4 权重（区间表写错比不写更难查：只有生僻字面才露馅）",
    apply: (s) => s.replace("(code >= 0x4e00 && code <= 0x9fff) ||", "(code >= 0x4e00 && code <= 0x4e00) ||"),
    expectFail: "中文一字计一 token（旧口径会把它记成 1/4，等于预算被低估四倍）",
  },
  {
    id: "clamp-cut-by-chars-not-weight",
    src: "src/agent/text-budget.ts",
    test: "tests/text-budget-cjk.test.ts",
    desc: "估算器按类别计数、取点却仍按字符数 ⇒ 中文正文截完仍超预算（估算与执行两套口径，本仓反复踩的同族）",
    apply: (s) => s.replace("return cutToWeight(text, Math.max(0, tokenBudget - weightText(notice))) + notice;", "return text.slice(0, Math.max(0, tokenBudget * 4 - notice.length)) + notice;"),
    expectFail: "中文正文截完仍然 ≤ 预算（旧实现按 chars/4 取点，这里会溢出近四倍）",
  },
  {
    id: "impact-note-symbols-uncapped",
    src: "src/agent/impact/index.ts",
    test: "tests/impact-note-bounds.test.ts",
    desc: "无调用点分支的符号清单取消每文件帽 ⇒ 这条是**最常见**分支，大文件上百个定义（含局部名）整串进每次写入的 tool_result",
    apply: (s) => s.replace("const cap = IMPACT_CONTEXT_SYMBOLS_PER_FILE;", "const cap = Number.MAX_SAFE_INTEGER;"),
    expectFail: "300 个定义只列前 4 个，并如实报出总数与全量位置",
  },
  {
    id: "impact-note-count-lies",
    src: "src/agent/impact/index.ts",
    test: "tests/impact-note-bounds.test.ts",
    desc: "计数尾写死帽值 ⇒ 「等 4 个」与只列 4 个自相矛盾，模型据此以为文件里就这几个定义（少字节的前提是如实报数）",
    apply: (s) => s.replace(" 等 ${String(r.symbols.length)} 个（全量在 impact_report 事件）", " 等 ${String(cap)} 个（全量在 impact_report 事件）"),
    expectFail: "300 个定义只列前 4 个，并如实报出总数与全量位置",
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
  {
    id: "needle-hits-treats-empty-as-ok",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-needles-check.test.ts",
    desc: "空针脚不报负值 ⇒ 一条 replace(空串, x) 的锚点看着「命中很多」其实永远改不动目标代码",
    apply: (s) => s.replace("if (needle === \"\") return -2;", "if (needle === \"\") return 1;"),
    expectFail: "空针脚与源文件读不到用负值区分开（两者后果不同，不能都算 0）",
  },
  {
    id: "needle-severity-flattens-warn",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-needles-check.test.ts",
    desc: "多处命中并入阻断 ⇒ 存量条目当场全红，这条门反而变成没人敢修的债；后果不同的两档必须分开",
    apply: (s) => s.replace("return hits > 1 ? \"warn\" : \"blocking\";", "return \"blocking\";"),
    expectFail: "hits=1 通过；>1 只待复认；0/负值是阻断",
  },
  {
    id: "audit-re-reads-source-per-entry",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-needles-check.test.ts",
    desc: "丢掉源文件缓存 ⇒ 220 条逐条重复读文件，秒级门被拖成分钟级（这条门的意义就是秒级可进门禁）",
    apply: (s) => s.replace("if (!cache.has(e.srcRel)) cache.set(e.srcRel, readSrc(e.srcRel));", "cache.set(e.srcRel, readSrc(e.srcRel));"),
    expectFail: "读取次数 = 不同源文件数（全表 220 条指向约 90 个文件，逐条重复读会把秒级门拖成分钟级）",
  },
  {
    id: "audit-reports-clean-needles",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-needles-check.test.ts",
    desc: "把「命中一次」也算问题 ⇒ 门对正常表恒红，于是下一个人的动作是关掉它（假红与假绿同样贵）",
    apply: (s) => s.replace("if (hits !== 1) problems.push({ id: e.id, srcRel: e.srcRel, hits, needle: e.needle });", "if (true) problems.push({ id: e.id, srcRel: e.srcRel, hits, needle: e.needle });"),
    expectFail: "只报命中次数 ≠ 1 的，并按传入顺序",
  },
  {
    id: "classify-unknown-flag-ignored",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-needles-check.test.ts",
    desc: "未知 flag 不再收集 ⇒ 拼错/未合并的 `--check-needles` 被当成无参数，脚本直接开跑全表：在别人的写作窗里就地改源文件几十分钟" +
      "（2026-09-23 改指：`classifyArgs` 为 `--budget-ms <值>` 加了 consumed 分流，旧针脚整行失效）",
    apply: (s) => s.replace(`const unknown = args.filter((a, i) => !consumed.has(i) && a.startsWith("--") && !(MUTATE_FLAGS as readonly string[]).includes(a));`, "const unknown: string[] = [];"),
    expectFail: "拼错/未实现的 flag 落进 unknown，且不混进 targets",
  },
  {
    id: "classify-flags-counted-as-ids",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-needles-check.test.ts",
    desc: "flag 混进位置参数 ⇒ `--check-needles` 被当成一个条目 id，报「未知 id」而不是执行针脚体检（门从此静默不跑）" +
      "（2026-09-23 改指：同上，分流现在还要跳过被 consumed 吞掉的值位）",
    apply: (s) => s.replace(`const targets = args.filter((a, i) => !consumed.has(i) && !a.startsWith("--"));`, "const targets = [...args];"),
    expectFail: "已知 flag 各归其 mode，位置参数进 targets",
  },
  {
    id: "line-wise-apply-never-recognized",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-needles-check.test.ts",
    desc: "不认逐行式 apply ⇒ 那些「故意改所有匹配行」的锚点长期挂 ⚠️ 假警；假警报攒多了，真警也会被一起忽略",
    apply: (s) => s.replace("return applySource.includes(\".split(\");", "return false;"),
    expectFail: "认得 split/map 式写法，普通单点 replace 不误判",
  },
  {
    id: "line-wise-apply-always-true",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-needles-check.test.ts",
    desc: "一律当成逐行式 ⇒ 普通单点锚点全都不再核针脚，静态检退回「什么都没看」的空门",
    apply: (s) => s.replace("return applySource.includes(\".split(\");", "return true;"),
    expectFail: "认得 split/map 式写法，普通单点 replace 不误判",
  },
  {
    id: "wizard-definers-not-excluded",
    src: "scripts/lib/commercial-reachability.ts",
    test: "tests/commercial-reachability.test.ts",
    desc: "不排除定义层 ⇒ 数据文件自己引用自己的名字就算「产品可达」，这条门退化成自证通过（正是它要防的那种绿）",
    apply: (s) => s.replace("    .filter((f) => !WIZARD_DEFINERS.some((p) => f.path.includes(p)))\n", ""),
    expectFail: "定义层自己写 ONBOARDING_GROUPS / onboarded 不算消费者（否则永远自证通过）",
  },
  {
    id: "wizard-reachability-always-true",
    src: "scripts/lib/commercial-reachability.ts",
    test: "tests/commercial-reachability.test.ts",
    desc: "一律判可达 ⇒ 「首启必弹向导」重新变回假绿，未证计数永远是 0，严格模式也拦不住",
    apply: (s) => s.replace("return { reachable: consumers.length > 0, consumers };", "return { reachable: true, consumers };"),
    expectFail: "只有定义层（当前 HEAD 的真实形态）⇒ 不可达，不得算通过",
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
    src: "src/agent/orchestrator.ts",
    test: "tests/orchestrator-wait.test.ts",
    desc: "未知 id 不先摘 ⇒ 进 terminalWaiters 永不触发：这次等待永挂 + 等待项泄漏（waitForAgentTerminal 的原语行为，所以必须在调用方挡）",
    apply: (s) => s.replace("const known = targets.filter((id) => this.workers.has(id));", "const known = [...targets];"),
    expectFail: "未知 id fail-visible 摘出（喂进 waitForAgentTerminal 会永挂 + 泄漏等待项）",
  },
  {
    id: "wait-returns-before-terminal",
    src: "src/agent/orchestrator.ts",
    test: "tests/orchestrator-wait.test.ts",
    desc: "把「等终态」摘成立即返回 ⇒ 收队永远只报 running，模型读到的是「团队还没干活」而不是「我在等」",
    apply: (s) => s.replace("Promise.all(known.map((id) => this.waitForAgentTerminal(id))).then(() => \"done\" as const),", "Promise.resolve(\"done\" as const),"),
    expectFail: "超时：未收敛的 id 进 timedOut，已收敛的照常带 summary（超时不算失败）",
  },
  {
    id: "wait-timeout-gate-removed",
    src: "src/agent/orchestrator.ts",
    test: "tests/orchestrator-wait.test.ts",
    desc: "取消超时闸 ⇒ 收队变成无界等待：主会话的整轮挂在一次工具调用上（等人门必须有上限，同 UNATTENDED_GATE_WAIT_MS 族）",
    apply: (s) => s.replace("new Promise<\"timeout\">((resolve) => { timer = setTimeout(() => resolve(\"timeout\"), timeoutMs); timer.unref?.(); }),", "new Promise<\"timeout\">(() => {}),"),
    expectFail: "超时：未收敛的 id 进 timedOut，已收敛的照常带 summary（超时不算失败）",
  },
  {
    id: "wait-tool-blind-to-no-orchestrator",
    src: "src/tools/wait_for_agents.ts",
    test: "tests/wait-for-agents-tool.test.ts",
    desc: "编排器未接线时回报「本来就没团队」⇒ 假绿形态：模型读不出「门没接上」与「无 worker」的区别",
    apply: (s) => s.replace("if (!orch) return { ok: false, output: \"wait_for_agents: 编排器未接线（fail-closed）\" };", "if (!orch) return { ok: true, output: \"[join] 本会话没有 worker——无需收队，直接继续。\" };"),
    expectFail: "编排器未接线 ⇒ fail-closed 拒绝（与 spawn_agent 同一措辞族，不静默返回空）",
  },
  {
    id: "gb-parity-face-blind",
    src: "src/agent/tool-surface.ts",
    test: "tests/tool-surface-parity.test.ts",
    desc: "对账函数恒返回空 ⇒ 静态门变成盖章机器；门的分辨力必须被它自己测到，否则后续每条「绿」都是空转",
    apply: (s) => s.replace("return names.filter((n) => !face.has(n));", "return [];"),
    expectFail: "对账本身有分辨力（反向对照：没这条的静态门等于没立）",
  },
  {
    id: "readonly-filter-keeps-wait-tool",
    src: "src/agent/glm-session.ts",
    test: "tests/tool-surface-parity.test.ts",
    desc: "只读档不再显式摘除 wait_for_agents ⇒ 模型面看得见、执行面白名单挡着（本仓第 6 次的那类两头断）",
    apply: (s) => s.replace("!isSideEffectTool(s.function.name) && s.function.name !== \"remember\" && s.function.name !== \"wait_for_agents\",", "!isSideEffectTool(s.function.name) && s.function.name !== \"remember\","),
    expectFail: "只读档的摘除面与声明一致（只查静态表：运行期注入项由各自的开关管）",
  },
  {
    id: "mem-budget-unit-chars",
    src: "src/agent/memory/inject.ts",
    test: "tests/memory-inject-token-budget.test.ts",
    desc: "记忆注入的总预算又按字符帽收（tokenBudget×4）⇒ 中文一字≈一 token，6K 预算实到 14K+，而这块每轮重送",
    apply: (s) => s.replace("if (runningWeight > tokenBudget) {", "if (runningWeight > tokenBudget * CHARS_PER_TOKEN) {"),
    expectFail: "中文语料超预算：整块按字重收进声明预算内，且如实报 truncated",
  },
  {
    id: "mem-weight-ascii-count",
    src: "src/agent/memory/inject.ts",
    test: "tests/memory-inject-token-budget.test.ts",
    desc: "丢掉了「按字符类别登记字重」（totalWeight 退回 length×0.25）⇒ 估算器对中文低估 4 倍，预算形同虚设",
    apply: (s) => s.replace("(n, s) => n + weightText(s.header) + s.lines.reduce((m, l) => m + weightText(l) + 0.25, 0), 0);", "(n, s) => n + s.header.length * 0.25 + s.lines.reduce((m, l) => m + l.length * 0.25 + 0.25, 0), 0);"),
    expectFail: "中文语料超预算：整块按字重收进声明预算内，且如实报 truncated",
  },
  {
    id: "mem-drop-cursor-ascii",
    src: "src/agent/memory/inject.ts",
    test: "tests/memory-inject-token-budget.test.ts",
    desc: "删行游标的扣减口径与 totalWeight 脱钩（按 length×0.25 扣）⇒ 中文段一路多删几倍行，预算没超但信息丢了",
    apply: (s) => s.replace("runningWeight -= weightText(sec.lines[drop]!) + 0.25;", "runningWeight -= sec.lines[drop]!.length * 0.25 + 0.25;"),
    expectFail: "中文语料超预算：整块按字重收进声明预算内，且如实报 truncated",
  },
  {
    id: "mem-metadata-tokens-missing",
    src: "src/agent/memory/inject.ts",
    test: "tests/memory-inject-token-budget.test.ts",
    desc: "元数据行不再报 tokens_current/tokens_limit ⇒ 块里只剩字符帽那把尺，模型自我收敛收敛到错的口径",
    apply: (s) => s.replace("+ \" tokens_current=\" + String(tokensCurrent) + \"/tokens_limit=\" + String(tokenBudget));", ");"),
    expectFail: "元数据行两套口径都报，tokens_limit 就是声明的预算（不拿字符帽冒充预算）",
  },
  {
    id: "mem-tokens-reported-ascii",
    src: "src/agent/memory/inject.ts",
    test: "tests/memory-inject-token-budget.test.ts",
    desc: "自报的 tokens 回到 chars/4 ⇒ 判定按字重、读数按英文口径，同一模块两副口径（本仓「估算与执行两套口径」病）",
    apply: (s) => s.replace("    tokens: tokensCurrent,", "    tokens: Math.ceil(charsCurrent / CHARS_PER_TOKEN),"),
    expectFail: "元数据行两套口径都报，tokens_limit 就是声明的预算（不拿字符帽冒充预算）",
  },
  {
    id: "shape-doc-head-not-charged-to-cap",
    src: "src/agent/shape.ts",
    test: "tests/shape-doc-cap.test.ts",
    desc: "[开头] 又无条件追加 ⇒ 一个长段落就把 maxChars 撑穿，而同族 shapeCode/shapeLog 都严格切帽（调用方按帽记账）",
    apply: (s) => s.replace("  if (shaped.length + head.length <= maxChars) shaped += head;", "  shaped += head;"),
    expectFail: "大纲很短、开头段落很长：合计仍不得越过 maxChars",
  },
  {
    id: "shape-doc-head-always-dropped",
    src: "src/agent/shape.ts",
    test: "tests/shape-doc-cap.test.ts",
    desc: "把「装得下才补」写成永不补 ⇒ 大纲丢掉开头上下文（信息更少并不更安全），零回归侧必须拦住它",
    apply: (s) => s.replace("  if (shaped.length + head.length <= maxChars) shaped += head;", "  if (shaped.length + head.length <= 0) shaped += head;"),
    expectFail: "装得下时照旧补 [开头]（零回归：不加也不少加）",
  },
  {
    id: "arch-outline-cap-ignores-source-size",
    src: "src/agent/memory/inject.ts",
    test: "tests/memory-arch-outline-cap.test.ts",
    desc: "大纲帽回到写死 4096 字符 ⇒ 4KB–16KB 的中文文档命中 shapeDoc 的逐字返回支，「只注大纲」静默不生效",
    apply: (s) => s.replace("Math.min(ARCH_OUTLINE_MAX_CHARS, Math.floor(raw.length / 2))", "ARCH_OUTLINE_MAX_CHARS"),
    expectFail: "中文文档（>4KB 字节、字符数 <4096）注的确实是大纲，不是整份原文",
  },
  {
    id: "arch-outline-cap-loses-abs-ceiling",
    src: "src/agent/memory/inject.ts",
    test: "tests/memory-arch-outline-cap.test.ts",
    desc: "只按原文一半收、丢掉 4096 的绝对帽 ⇒ 大文档的大纲可以比原来大得多，注入预算被单个段落撑爆",
    apply: (s) => s.replace("Math.min(ARCH_OUTLINE_MAX_CHARS, Math.floor(raw.length / 2))", "Math.floor(raw.length / 2)"),
    expectFail: "英文大文档仍按 4096 字符帽（不变小、不变大）",
  },
  {
    id: "prune-protect-window-by-chars",
    src: "src/agent/prune.ts",
    test: "tests/prune-token-weight.test.ts",
    desc: "保护区累计回到 chars/4 ⇒ 中文会话里保护区吞掉 4 倍量事件、候选恒空，修剪这条省 token 的机制根本不触发",
    apply: (s) => s.replace("    acc += estimateTextTokens(text);", "    acc += Math.ceil(text.length / 4);"),
    expectFail: "中文结果剪得动，且 savedTokens 落在字重口径（旧口径下保护区吞掉全部 ⇒ 候选空 ⇒ 永不修剪）",
  },
  {
    id: "prune-min-gate-by-chars",
    src: "src/agent/prune.ts",
    test: "tests/prune-token-weight.test.ts",
    desc: "最小修剪闸把中文候选的预计节省按 chars/4 记 ⇒ 该裁的报「too-small」，中文大块就此常驻上下文每轮重付",
    apply: (s) => s.replace("  for (const i of candidates) wouldSave += estimateTextTokens((events[i] as { output: string }).output);", "  for (const i of candidates) wouldSave += Math.ceil((events[i] as { output: string }).output.length / 4);"),
    expectFail: "最小修剪闸单独一条：窗口由 ASCII 撑住（两口径同界），候选是中文 ⇒ 旧口径误报 too-small 而长期不剪",
  },
  {
    id: "prune-saved-tokens-by-chars",
    src: "src/agent/prune.ts",
    test: "tests/prune-token-weight.test.ts",
    desc: "savedTokens 是给人看的成本读数：按 chars/4 报 ⇒ 中文会话里「省了多少」虚报四倍（判定与读数两副口径）",
    apply: (s) => s.replace("    const savedThisOne = estimateTextTokens(e.output) - estimateTextTokens(stub);", "    const savedThisOne = Math.ceil(e.output.length / 4) - estimateTextTokens(stub);"),
    expectFail: "中文结果剪得动，且 savedTokens 落在字重口径（旧口径下保护区吞掉全部 ⇒ 候选空 ⇒ 永不修剪）",
  },
  {
    id: "prune-placeholder-tokens-by-chars",
    src: "src/agent/prune.ts",
    test: "tests/prune.test.ts",
    desc: "替换文本按裸占位扣（附件路径行不算）⇒「省了多少」被白记一程；改指现实现：savedTokens 只认 PRUNED_PLACEHOLDER，不看 stub",
    apply: (s) => s.replace("    const savedThisOne = estimateTextTokens(e.output) - estimateTextTokens(stub);", "    const savedThisOne = estimateTextTokens(e.output) - estimateTextTokens(PRUNED_PLACEHOLDER);"),
    expectFail: "③savedTokens 按**实际替换文本**计量：路径行不得虚报节省",
  },
  // ---- W3 第一段调度纪律（BASE_SYSTEM 的「编排」段）：三句各一条 + 编号不侵占一条 ----
  {
    id: "orchestration-rule-dropped",
    src: "src/main/agent-runner.ts",
    test: "tests/base-system-discipline.test.ts",
    desc: "整段编排纪律删掉 ⇒ 模型面重新没人教「何时拆 / 怎么派 / 派完收队」，而 W1a 的工具照样在线（能力已发货、指令面缺席）",
    apply: (s) => s.replace("  \"编排（派子代理时）：能各自独立验收才拆，单一改动别拆；任务书必须自包含——目标 / 涉及文件 / 验收口径，worker 看不到本会话历史；派完先调 wait_for_agents 收队，未拿到回执不得转述 worker 的结论。\",\n", ""),
    expectFail: "编排段在：拆的判据 / 任务书自包含 / 派完必须收队，三句各锁一句（W1a 的收队义务此前只在工具描述里）",
  },
  {
    id: "orchestration-collect-duty-removed",
    src: "src/main/agent-runner.ts",
    test: "tests/base-system-discipline.test.ts",
    desc: "只删收队那半句 ⇒ 派完仍会凭想象转述 worker 结论，D1 的失败模式重新敞开（工具在、没人叫它）",
    apply: (s) => s.replace("派完先调 wait_for_agents 收队，未拿到回执不得转述 worker 的结论。", ""),
    expectFail: "编排段在：拆的判据 / 任务书自包含 / 派完必须收队，三句各锁一句（W1a 的收队义务此前只在工具描述里）",
  },
  {
    id: "orchestration-taskbook-removed",
    src: "src/main/agent-runner.ts",
    test: "tests/base-system-discipline.test.ts",
    desc: "删「任务书自包含」半句 ⇒ worker 拿不到验收口径就要返工（它看不到父会话历史，这条是 worker 质量的上游）",
    apply: (s) => s.replace("任务书必须自包含——目标 / 涉及文件 / 验收口径，worker 看不到本会话历史；", ""),
    expectFail: "编排段在：拆的判据 / 任务书自包含 / 派完必须收队，三句各锁一句（W1a 的收队义务此前只在工具描述里）",
  },
  {
    id: "orchestration-rule-renumbered",
    src: "src/main/agent-runner.ts",
    test: "tests/base-system-discipline.test.ts",
    desc: "把编排段改成「7) …」⇒ 条件段混进动作序列编号，纪律 1–6 的连续性断号（模型会以为后面的约束可省）",
    apply: (s) => s.replace("\"编排（派子代理时）：", "\"7) 编排（派子代理时）："),
    expectFail: "六条纪律编号连续（缺号=模型读到断号，会以为后面的约束可省）",
  },
  {
    id: "typecheck-triage-scratches-into-tracked",
    src: "scripts/lib/typecheck-triage.ts",
    test: "tests/typecheck-triage.test.ts",
    desc: "归因把所有报错都算成 HEAD 内 ⇒ 别人未跟踪的草稿又会被当本仓回归，白开一次 worktree 对照（已发生两次）",
    apply: (s) => s.replace("    if (untracked.has(f)) scratch.push(f);", "    if (untracked.has(f) && false) scratch.push(f);"),
    expectFail: "全在未跟踪草稿：tracked 空、scratch 列出该文件，并明说 HEAD 类型干净",
  },
  {
    id: "typecheck-parse-trims-at-whitespace",
    src: "scripts/lib/typecheck-triage.ts",
    test: "tests/typecheck-triage.test.ts",
    desc: "解析报错行改回按非空白切路径 ⇒ 目录名带空格（本仓目录就叫 deepseek harness）时截出半个路径，整列归因作废",
    apply: (s) => s.replace("const TSC_ERROR_LINE = /^(.+?)\\(\\d+,\\d+\\): error TS\\d+/u;", "const TSC_ERROR_LINE = /^(\\S+?)\\(\\d+,\\d+\\): error TS\\d+/u;"),
    expectFail: "路径含空格也能解析（本仓目录名就有空格；按空白切会截出半个路径）",
  },
  {
    id: "typecheck-clean-verdict-unearned",
    src: "scripts/lib/typecheck-triage.ts",
    test: "tests/typecheck-triage.test.ts",
    desc: "「HEAD 态类型干净」改成只要有报错就说 ⇒ 真有 HEAD 缺陷时照样给出一句假绿结论",
    apply: (s) => s.replace("  if (t.tracked.length === 0) out.push(", "  if (t.total > 0) out.push("),
    expectFail: "混合：草稿与 HEAD 缺陷分开列（HEAD 那部分照常是红，不给豁免）",
  },
  {
    id: "mem-eviction-not-named",
    src: "src/agent/memory/inject.ts",
    test: "tests/memory-eviction-notice.test.ts",
    desc: "整段抽干了哪几段不点名 ⇒ 模型看到一目录条目却不知道架构/决策被省了，只能重新 grep 或以为项目没架构",
    apply: (s) => s.replace("    if (evicted.length > 0) lines.push(\"[omitted: \"", "    if (evicted.length > 0 && false) lines.push(\"[omitted: \""),
    expectFail: "成熟记忆集在缺省预算下抽干了 ARCHITECTURE 与 DECISIONS ⇒ 提示点名这两段并给 read_file 通道",
  },
  {
    id: "mem-eviction-had-recorded-after-drop",
    src: "src/agent/memory/inject.ts",
    test: "tests/memory-eviction-notice.test.ts",
    desc: "「原有几行」改记成 0 ⇒ 事后永远判不出谁被抽干（就地 splice 之后再量必然全 0），点名静默失效",
    apply: (s) => s.replace("had: s.lines.length, block: \"project\" as const", "had: 0, block: \"project\" as const"),
    expectFail: "成熟记忆集在缺省预算下抽干了 ARCHITECTURE 与 DECISIONS ⇒ 提示点名这两段并给 read_file 通道",
  },
  // ---- 能力 5 回流通道：自动验证拍的红投进下一轮（tests/context-auto-verify-note.test.ts）----
  {
    id: "avnote-never-projected",
    src: "src/agent/context.ts",
    test: "tests/context-auto-verify-note.test.ts",
    desc: "整条注入分支不落地 ⇒ 收束闸验出的红只有时间线看得见，模型下一轮带着「已经收工」的叙事继续（能力 5 缺修正拍）",
    apply: (s) => s.replace("      if (i === lastAutoIdx) msgs.push(", "      if (false && i === lastAutoIdx) msgs.push("),
    expectFail: "① 有 auto 的 verify_result(ok:false) ⇒ 按事件位置注入一条含失败命令与输出的消息",
  },
  {
    id: "avnote-attribution-lost",
    src: "src/agent/context.ts",
    test: "tests/context-auto-verify-note.test.ts",
    desc: "只按 ok:false 筛、不看 auto 字段 ⇒ 模型自调那一拍的红被投两次（tool_result 一份 + user 一份），同一拍两份事实",
    apply: (s) => s.replace("if (e.type === \"verify_result\" && e.auto === true && !e.ok)", "if (e.type === \"verify_result\" && !e.ok)"),
    expectFail: "② 手动拍（无 auto 字段）零注入：失败原文只走既有的 tool_result 那一条",
  },
  {
    id: "avnote-not-latest-beat",
    src: "src/agent/context.ts",
    test: "tests/context-auto-verify-note.test.ts",
    desc: "取首拍而非最新拍 ⇒ 模型带着早已被后续改动推翻的旧红继续修，而真正卡住它的那条不在上下文里",
    apply: (s) => s.replace("const lastAutoIdx = autoIdx.length > 0 ? (autoIdx[autoIdx.length - 1] as number) : -1;", "const lastAutoIdx = autoIdx.length > 0 ? (autoIdx[0] as number) : -1;"),
    expectFail: "④ 多拍只留最新一份全文，旧的折成计数行（同 compaction「只出现最新一份」的口径）",
  },
  {
    id: "avnote-uncapped",
    src: "src/agent/context.ts",
    test: "tests/context-auto-verify-note.test.ts",
    desc: "帽形同虚设 ⇒ 单条 verify 输出本就环限 32KB，这条每轮重送的注入能把上下文吃掉一半",
    apply: (s) => s.replace("export const AUTO_VERIFY_NOTE_TOKEN_BUDGET = 1200;", "export const AUTO_VERIFY_NOTE_TOKEN_BUDGET = 1200000;"),
    expectFail: "⑤ 帽：超大输出按 token 预算收窄、保住尾部结论行，且失败命令一条不丢",
  },
  {
    id: "avnote-commands-list-tail-only",
    src: "src/agent/context.ts",
    test: "tests/context-auto-verify-note.test.ts",
    desc: "失败命令清单只留最后一条 ⇒ 留尾砍掉前面那段正文后，模型再不知道有哪几条在红，只能把额度烧在猜命令上",
    apply: (s) => s.replace("const cmds = results.filter((r) => !r.ok).map((r) => r.command)", "const cmds = results.filter((r) => !r.ok).slice(-1).map((r) => r.command)"),
    expectFail: "⑤b 多条失败命令：留尾会砍掉前面那段的正文，但命令名必须还在（否则模型不知道去跑哪条）",
  },
  {
    id: "avnote-ignores-exclusion",
    src: "src/agent/context.ts",
    test: "tests/context-auto-verify-note.test.ts",
    desc: "预扫描不看排除集 ⇒ 已摘除的那拍顶掉存活那拍成为「最新」，主循环早退让它也不注入：整条通道静默失效",
    apply: (s) => s.replace("    if (excluded.has(eventIdAt(i)) || hasWorkerAttribution(e)) return;", "    if (hasWorkerAttribution(e)) return;"),
    expectFail: "⑥ 被压缩摘除的自动拍不再注入，且它不得顶掉仍然存活的那拍",
  },
  // ---- 半截会话的孤儿 tool_call：续跑时投影必须仍可发送（tests/context-dangling-tool-call.test.ts）----
  {
    id: "dangling-exit-not-wired",
    src: "src/agent/context.ts",
    test: "tests/context-dangling-tool-call.test.ts",
    desc: "合上孤儿那行没接在投影出口 ⇒ 函数在、判卷在、真路径照旧吃 400：「两头断」那一族的又一格（不写第几次，计数会漂），" +
      "所以判卷必须走 projectContext 而不是只测那个纯函数",
    apply: (s) => s.replace("  return closeDanglingToolCalls(mergeToolResultsById(msgs));", "  return mergeToolResultsById(msgs);"),
    expectFail: "真实现场形状（末笔调用没有结果）⇒ 投影里不许留下未答的 tool_calls",
  },
  {
    id: "dangling-note-claims-success",
    src: "src/agent/context.ts",
    test: "tests/context-dangling-tool-call.test.ts",
    desc: "补位文案改成「已经收到结果了」⇒ 结构合法性还在（400 消失），但模型被喂了一句假事实，" +
      "会当成那笔写盘真发生过（比红更坏的静默幻觉）。钉住这条判据不能只看有没有 tool 消息",
    apply: (s) => s.replace("没有收到结果：上一次运行在这次调用中途结束", "已经收到结果了：那次调用"),
    expectFail: "真实现场形状（末笔调用没有结果）⇒ 投影里不许留下未答的 tool_calls",
  },
  {
    // 钉我自己上一笔的回归（4c18fb7）：缺位原先按"assistant 之后紧邻的 tool 段"算，
    // 而工具执行中途 ctx.emit 一条正文 ⇒ 结果排在 assistant 之后 ⇒ 被判缺位、凭空补一句假事实。
    id: "dangling-answered-set-ignored",
    src: "src/agent/context.ts",
    test: "tests/context-dangling-tool-call.test.ts",
    desc: "补位不看「这条 id 在全列表里有没有人答过」⇒ 已答的调用也被写上「没有收到结果」，" +
      "同一笔两份互相矛盾的事实（真实现场：工具中途 emit 正文把结果推到 assistant 之后）",
    apply: (s) => s.replace("      if (answered.has(tc.id) || injected.has(tc.id)) continue;", "      if (injected.has(tc.id)) continue;"),
    expectFail: "工具执行中途 emit 正文（结果在 assistant 之后才回）⇒ 绝不许说「没有收到结果」",
  },
  // ---- 终端面板两格（#58）：缺席≠运行中、子流≠父会话跑过（tests/renderer-terminal-liveness.test.ts）----
  {
    id: "term-null-always-claims-running",
    src: "src/renderer/projections.ts",
    test: "tests/renderer-terminal-liveness.test.ts",
    desc: "null 分支不看 liveness ⇒ 重放一条早死掉的会话永远显示「执行中」：把结果缺席当运行中，" +
      "是「代理信号当事实」那一族的界面版（真窗口侧由 panels-check B26 同向钉住）",
    apply: (s) => s.replace("    return live\n", "    return true\n"),
    expectFail: "panelLive=false 且无结果 ⇒ 渲染 lost，不渲染「执行中…」",
  },
  {
    id: "term-terminal-no-attribution-filter",
    src: "src/renderer/projections.ts",
    test: "tests/renderer-terminal-liveness.test.ts",
    desc: "terminal 段不过归因 ⇒ worker 执行的命令出现在父会话「本会话命令」里（对话面两处都过了" +
      " entersMainConversation，面板面漏了＝同一份解析只硬化一支）",
    apply: (s) => s.replace("    if (!entersMainConversation(e)) continue;", "    if (false) continue;"),
    expectFail: "父 + worker 混排 ⇒ 只剩父那一行（同一份流既要过对话面也要过面板面）",
  },
  {
    // 共用件 unansweredToolCalls（转录面 + 投影出口都读它）：归因那一半。
    id: "term-unanswered-set-counts-worker-calls",
    src: "src/renderer/projections.ts",
    test: "tests/renderer-terminal-liveness.test.ts",
    desc: "算「哪几笔没结果」时不看归因 ⇒ worker 的调用被算成父会话断掉的那笔，" +
      "转录里子流的任务会在父转录上挂出「无结果」",
    apply: (s) => s.replace("    if (typeof e.agent_id === \"string\" && e.agent_id !== \"\") continue;\n    opened.add(e.id);", "    if (false) continue;\n    opened.add(e.id);"),
    expectFail: "worker 子流不算父会话的账",
  },
  {
    id: "term-write-null-collapses-to-written",
    src: "src/renderer/projections.ts",
    test: "tests/renderer-terminal-liveness.test.ts",
    desc: "未确认的写回退成「已落盘」（label 空 ⇒ 界面什么都不写）⇒ 审阅页与文件树把没结果的写入" +
      "读成成功，能力 7 的可审计面被折叠掉（真窗口侧由 panels-check B27 同向钉住）",
    apply: (s) => s.replace("  if (ok === null) return { kind: \"unconfirmed\", label: \"未确认（没有结果）\" };", "  if (ok === null) return { kind: \"written\", label: \"\" };"),
    expectFail: "ok===null ⇒ kind=unconfirmed 且有文案（缺席必须占位，否则读起来像已落盘）",
  },
  {
    id: "branch-panel-restores-demo-rows",
    src: "src/renderer/app.js",
    test: "tests/renderer-no-demo-data.test.ts",
    desc: "工作树看板退回演示分支行（撤掉空态、重新画 .branch-row）⇒ 屏上又开始谎报 HEAD 在哪，" +
      "而桥接层至今没有任何 git 通道（`grep -ci \"git\\|branch\" src/preload/index.ts` → 0）",
    apply: (s) => s.replace("panelEmptyHTML('分支未接入：这一格要读仓库的 git 状态，而桥接层还没有该通道')",
      "'<button class=\"branch-row\">main</button>'"),
    expectFail: "工作树那一格必须自己说未接入（撤假数据不等于留白）",
  },
  {
    id: "workspace-panel-unwraps-agent-branch",
    src: "src/renderer/app.js",
    test: "tests/renderer-no-demo-data.test.ts",
    desc: "关掉 `workspaceViewHTML` 里真运行时那一条分支 ⇒ 产品态退回原型态的演示列表：" +
      "屏上又列出用户没有的三个文件夹，那句「已切换工作区…」照旧可证伪" +
      "（B29 改前实测 names=[coding-suite, docs-site, edge-gateway]，而芯片写着 运行目录 · proj-ws）",
    apply: (s) => s.replace("  if (window.agent) {\n    const rows = realWorkspaceRows();",
      "  if (false) {\n    const rows = realWorkspaceRows();"),
    expectFail: "agent 态：演示文件夹名与「打开其他文件夹…」都不许出现（那句「已切换」可证伪）",
  },
  /* 切片边界棘轮的两半各钉一条（同一判据由两支共同成立，一条变异只该废掉它负责的那半边）。 */
  {
    id: "slice-boundary-scanner-blind",
    src: "scripts/assertion-health.ts",
    test: "tests/assertion-health-scan.test.ts",
    desc: "尺子变瞎：切片调用里的注释标记不再被认出来 ⇒ 整条棘轮失去分辨力（清单还在，但没人读盘）。" +
      "钉的是「识别」这一半，不是「清单」那一半",
    apply: (s) => s.replace("      if (SLICE_CALLEES.has(name)) {", "      if (false) {"),
    expectFail: "indexOf 的标记是注释文字 ⇒ 报（本闸要抓的那一格）",
  },
  {
    id: "slice-boundary-every-string-is-a-marker",
    src: "scripts/assertion-health.ts",
    test: "tests/assertion-health-scan.test.ts",
    desc: "撤掉「以注释标点开头的才算边界」这道筛 ⇒ 切片调用里的每个字符串（含喂给被测码的 fixture 文本）" +
      "都成标记 ⇒ 快路必然红、且正当用途被逼去写豁免。钉的是「别误伤」那一半",
    apply: (s) => s.replace("&& COMMENT_OPEN.test(a.text)) {", ") {"),
    expectFail: "已跟踪的 tests/ 里不许新增注释文字当边界（边界一律用代码标识）",
  },
  {
    id: "tail-clamp-keeps-head",
    src: "src/agent/text-budget.ts",
    test: "tests/text-budget-cjk.test.ts",
    desc: "留尾一支退化成留头 ⇒ 错误日志的结论行（N failed / stack 末行）整段丢失，注入的正文改无可改",
    apply: (s) => s.replace("  return text.slice(start);\n}", "  return text.slice(0, start);\n}"),
    expectFail: "超限时保留尾部原文，提示行在前且自己计入预算",
  },
  {
    id: "tail-clamp-marker-free",
    src: "src/agent/text-budget.ts",
    test: "tests/text-budget-cjk.test.ts",
    desc: "提示行不计入预算 ⇒「≤ 预算」这句承诺被自己的提示撑破（NOTICE_RESERVE 同族坑，这座帽是跨轮重送的）",
    apply: (s) => s.replace("return marker + cutToWeightTail(text, Math.max(0, tokenBudget - weightText(marker)));", "return marker + cutToWeightTail(text, tokenBudget);"),
    expectFail: "超限时保留尾部原文，提示行在前且自己计入预算",
  },
  {
    id: "verify-bypasses-tool-table",
    src: "src/agent/loop.ts",
    test: "tests/loop.test.ts",
    desc: "verify 系统门越过工具表硬闸（今天不暴露，因为 worker 不传 verify 钩子；W4a 一接上就是「表里没有 verify 却能执行 verify」的权限旁路）",
    apply: (s) => s.replace("      if (opts.allowedTools && !opts.allowedTools.includes(output.name as ToolName)) {", "      if (opts.allowedTools && !opts.allowedTools.includes(output.name as ToolName) && output.name !== \"verify\") {"),
    expectFail: "表内没有 verify ⇒ 钩子一次都不执行，按工具表摘除拒绝",
  },
  // ---- W4a/W4b：worker 收束闸与证据标记（tests/m3b.test.ts + tests/worker-evidence.test.ts）----
  {
    id: "worker-verify-missing-autoverify",
    src: "src/agent/orchestrator.ts",
    test: "tests/m3b.test.ts",
    desc: "给 worker 接了钩子却忘了开 autoVerify ⇒ 收束闸永不落拍，worker 回程仍是纯自述",
    apply: (s) => s.replace("...(workerVerify ? { verify: workerVerify, autoVerify: true } : {}),", "...(workerVerify ? { verify: workerVerify } : {}),"),
    expectFail: "开闸且绿 ⇒ 补一拍（零额外模型请求），证据标 verified",
  },
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
    apply: (s) => s.replace("      if (e.ok && c !== undefined && mayHaveWrittenDisk(c.name, c.args)) lastWrite = i;", "      if (c !== undefined && mayHaveWrittenDisk(c.name, c.args)) lastWrite = i;"),
    expectFail: "被拒的写（ok:false）不构成过期证据",
  },
  {
    id: "evidence-marks-without-writes",
    src: "src/agent/orchestrator.ts",
    test: "tests/m3b.test.ts",
    desc: "不分「有没有改过文件」一律打标记 ⇒ 只读 worker 也背上一个「跑过了」位，父面出现无从谈起的证据",
    apply: (s) => s.replace("      const evidence = filesChanged.length > 0 ? workerVerificationEvidence(w.events) : undefined;", "      const evidence = workerVerificationEvidence(w.events);"),
    expectFail: "read worker（没改过文件）⇒ 根本不打证据标记（无「跑过了」可标）",
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
    id: "glm-default-name-ignores-env",
    src: "src/providers/glm.ts",
    test: "tests/worker-spent-usd.test.ts",
    desc: "glmDefaultModelName 不读 M0_MODEL ⇒ 与实际拨号名各算一份（本仓点名的「与 X 对齐」只是注释）",
    apply: (s) => s.replace("  return process.env.M0_MODEL ?? GLM_DEFAULT_MODEL;", "  return GLM_DEFAULT_MODEL;"),
    expectFail: "glmDefaultModelName 与 streamGlm 真实拨号用的模型名逐字相等（防第四份 env 副本漂移）",
  },
  // ---- 门的执行计划（scripts/gate-manifest.gateCommand，tests/gate-manifest.test.ts）----
  {
    id: "gate-direct-guards-deleted",
    src: "scripts/gate-manifest.ts",
    test: "tests/gate-manifest.test.ts",
    desc: "删掉「脚本查不到」两道守卫 ⇒ 直跑模式对未登记的门 spawn 空命令，退出码 0 = 一道从不运行的门被当成跑过了",
    apply: (s) => s.replace(`  if (typeof body !== "string") {
    return { cmd: "", args: [], missingScript: true };
  }
  if (body.trim() === "") {
    return { cmd: "", args: [], missingScript: true };
  }
`, "  void body;\n"),
    expectFail: "直跑但 scripts 里没有这道门 ⇒ missingScript（调用方必须判红，不得当成无事发生）",
  },
  {
    id: "gate-direct-blank-body-passes",
    src: "scripts/gate-manifest.ts",
    test: "tests/gate-manifest.test.ts",
    desc: "空白正文判据写坏（只认 === \"\"）⇒ \"  \" 这种正文放行，`sh -c \"  \"` 退出码 0 同样是一道静默跳过的门",
    apply: (s) => s.replace('  if (body.trim() === "") {', '  if (body === "") {'),
    expectFail: "直跑但脚本正文是空白 ⇒ 同样判 missingScript（空命令的退出码 0 就是静默跳门）",
  },
  {
    id: "gate-direct-default-executor-drifts",
    src: "scripts/gate-manifest.ts",
    test: "tests/gate-manifest.test.ts",
    desc: "加直跑模式时顺手改了缺省分支（pnpm run → pnpm exec）⇒ 主树那条路语义跟着变，而新增能力只需多一条路、不需要动旧路",
    apply: (s) => s.replace('if (opts.direct !== true) return { cmd: "pnpm", args: ["run", name] };', 'if (opts.direct !== true) return { cmd: "pnpm", args: ["exec", name] };'),
    expectFail: "缺省（非直跑）：门名原样交给 pnpm run，不改写命令",
  },
  {
    id: "gate-direct-path-prepend-dropped",
    src: "scripts/gate-manifest.ts",
    test: "tests/gate-manifest.test.ts",
    desc: "直跑不前置 node_modules/.bin ⇒ 脚本正文里的裸 `vitest`/`electron-vite` 在 sh 下找不到命令，门以 127 假死",
    apply: (s) => s.replace('return { cmd: "/bin/sh", args: ["-c", body], pathPrepend: join(opts.root, "node_modules", ".bin") };', 'return { cmd: "/bin/sh", args: ["-c", body] };'),
    expectFail: "直跑：跑 package.json 的脚本正文，并把该仓 node_modules/.bin 顶到 PATH 前",
  },
  // ---- prune 存盘回取接进生产（tests/prune.test.ts + tests/session-prune-attachments.test.ts）----
  {
    id: "prune-attachment-production-entry",
    src: "src/agent/glm-session.ts",
    test: "tests/session-prune-attachments.test.ts",
    desc: "生产组装退回只传 {events} ⇒ 附件恒空、打桩里那行路径指向空气（§7.4「存盘回取」两头断的正是这一格）",
    apply: (s) => s.replace("const outcome = computePrune({ events, attachmentsDir: pruneAttachmentsDir, sessionId: pruneSessionId });", "const outcome = computePrune({ events });"),
    expectFail: "①打桩文本带着附件路径，模型能照着取回全文",
  },
  {
    id: "prune-stub-hides-attachment-path",
    src: "src/agent/prune.ts",
    test: "tests/prune.test.ts",
    desc: "算了附件路径却不写进打桩文本 ⇒ 回取通道对模型不可见，裁剪变成不可逆的信息销毁",
    apply: (s) => s.replace('      : PRUNED_PLACEHOLDER + "\\n[原文已存附件 " + file + "，需要时 read_file 取回]";', '      : PRUNED_PLACEHOLDER;'),
    expectFail: "①传 attachmentsDir ⇒ 打桩自带路径，且该路径逐字等于实际写出的那个文件",
  },
  {
    id: "prune-attachment-rewrite-every-turn",
    src: "src/agent/prune.ts",
    test: "tests/prune.test.ts",
    desc: "去掉「已存在即跳过」⇒ 每次模型调用都把全部附件重写一遍（白 IO，且 mtime 失去「何时被裁」的含义）",
    apply: (s) => s.replace("      try {\n        await access(file);\n        continue;\n      } catch { /* 不存在（或被清理）→ 重写 */ }", "      try {\n        await Promise.resolve();\n      } catch { /* 不存在（或被清理）→ 重写 */ }"),
    expectFail: "④同一附件重复装配不重写（幂等；每轮组装都跑，重写 = 白 IO 且打断 mtime 语义）",
  },
  {
    id: "prune-saved-tokens-ignores-stub-text",
    src: "src/agent/prune.ts",
    test: "tests/prune.test.ts",
    desc: "节省量按 0 扣 ⇒ 面板上的「省了多少」把新增的打桩文本（含路径行）整个算成白赚",
    apply: (s) => s.replace("    const savedThisOne = estimateTextTokens(e.output) - estimateTextTokens(stub);", "    const savedThisOne = estimateTextTokens(e.output);"),
    expectFail: "③savedTokens 按**实际替换文本**计量：路径行不得虚报节省",
  },
  {
    id: "hook-matcher-star-not-all",
    src: "src/agent/plugins/hooks.ts",
    test: "tests/hooks-input-contract.test.ts",
    desc: "把 `\"*\"` 从全配档摘掉 ⇒ 它落到 RegExp(\"*\")（抛错）再回落精确比较 ⇒ CC hooks.json 里最常见的 matcher 静默永不命中",
    apply: (s) => s.replace("if (matcher === undefined || matcher === \"\" || matcher === \"*\") return true;", "if (matcher === undefined || matcher === \"\") return true;"),
    expectFail: "matcher \"*\" 全配：CC hooks.json 最常见写法，不得因 RegExp(\"*\") 抛错而回落成精确比较",
  },
  {
    id: "hook-matcher-exact-list-degrades-to-substring-regex",
    src: "src/agent/plugins/hooks.ts",
    test: "tests/hooks-input-contract.test.ts",
    desc: "精确名列表算完后仍拿 matcher 去跑非锚定正则 ⇒ \"Edit\" 顺手命中 NotebookEdit/EditFile，钩子在用户没点名的工具上执行",
    apply: (s) => s.replace("  return names.length > 0 && names.includes(value);", "  return new RegExp(matcher).test(value);"),
    expectFail: "纯精确名不做子串：matcher \"Edit\" 不得命中 NotebookEdit",
  },
  {
    id: "hook-matcher-field-ignores-event",
    src: "src/agent/plugins/hooks.ts",
    test: "tests/hooks-input-contract.test.ts",
    desc: "所有事件一律拿 tool_name 去配 ⇒ SessionStart(\"startup\")/PreCompact(\"manual\")/Subagent*(agent type) 的 matcher 恒不命中（§9.5 表逐事件规定匹配字段）",
    apply: (s) => s.replace("    const value = matcherFieldOf(event, payload);", "    const value = payload.tool_name;"),
    expectFail: "非工具事件按各自 matcher 字段配：SessionStart/PreCompact 用 trigger，Subagent 用 agent_type",
  },
  {
    id: "hook-stdin-written-empty",
    src: "src/agent/plugins/hooks.ts",
    test: "tests/hooks-input-contract.test.ts",
    desc: "写一个空串交出去 ⇒ 钩子拿到 EOF 却什么都不知道：为 CC 写的 hook 全盲（拦不到具体文件），但表面\"跑通了\"",
    apply: (s) => s.replace("      handle.child.stdin?.write(stdin);", "      handle.child.stdin?.write(\"\");"),
    expectFail: "command 钩子从 stdin 收到 JSON：hook_event_name / tool_name / tool_input / cwd",
  },
  {
    id: "hook-stdin-never-ended",
    src: "src/agent/plugins/hooks.ts",
    test: "tests/hooks-input-contract.test.ts",
    desc: "写完不 end ⇒ stdin 是永不 EOF 的管道，`cat`/`jq` 类钩子一直挂到缺省 600s 超时被强杀（一次工具调用挂十分钟）",
    apply: (s) => s.replace("      handle.child.stdin?.end();", "      // end() 摘掉：管道不关，读 stdin 的钩子等不到 EOF"),
    expectFail: "command 钩子从 stdin 收到 JSON：hook_event_name / tool_name / tool_input / cwd",
  },
  {
    id: "hook-stdin-keeps-internal-field-name",
    src: "src/agent/plugins/hooks.ts",
    test: "tests/hooks-input-contract.test.ts",
    desc: "把我们内部的 tool_args 原名写进 stdin ⇒ CC 钩子读 tool_input 读到 undefined，字段名翻译正是这条契约的全部内容",
    apply: (s) => s.replace("  if (payload.tool_args !== undefined) json.tool_input = payload.tool_args;", "  if (payload.tool_args !== undefined) json.tool_args = payload.tool_args;"),
    expectFail: "command 钩子从 stdin 收到 JSON：hook_event_name / tool_name / tool_input / cwd",
  },
  {
    id: "hook-stdin-fabricates-empty-agent-id",
    src: "src/agent/plugins/hooks.ts",
    test: "tests/hooks-input-contract.test.ts",
    desc: "缺席字段兜成空串 ⇒ 钩子读到 \"\" 会当成\"有归因但为空\"，与\"主会话无 agent_id\"是两件事（把不可知记成免费）",
    apply: (s) => s.replace("  if (payload.agent_id !== undefined) json.agent_id = payload.agent_id;", "  json.agent_id = payload.agent_id ?? \"\";"),
    expectFail: "stdin 带 tool_use_id 与 agent_id（§4.4 归因；缺席时不折成空串）",
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
    id: "loop-does-not-forward-agent-id",
    src: "src/agent/loop.ts",
    test: "tests/worker-hooks.test.ts",
    desc: "loop 收到了 agentId 却不写进 PreToolUse 载荷 ⇒ 同一格「两头断」的另一头：编排端接了、执行端没传",
    apply: (s) => s.replace("            tool_use_id: output.id,\n            agent_id: opts.agentId,\n          });\n          if (pre.blocked) {", "            tool_use_id: output.id,\n            agent_id: undefined,\n          });\n          if (pre.blocked) {"),
    expectFail: "钩子拿到 agent_id = 该 worker 的 id 与模型实下的参数（§4.4 归因）",
  },
  {
    id: "read-worker-inherits-wide-hook-mode",
    src: "src/agent/plugins/hooks.ts",
    test: "tests/worker-hooks.test.ts",
    desc: "forWorkerMode 原样返回宽档引擎 ⇒ 只读 worker 也能跑有副作用的钩子命令（最小权限半边没接）",
    apply: (s) => s.replace(`    return mode === "read" ? new HookEngine({ ...this.opts, mode: "read-only" }) : this;`, "    return this;"),
    expectFail: "forWorkerMode(\"read\") 把引擎降成只读档：中等风险的钩子命令拒跑；\"write\" 沿用原档",
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
    id: "command-invoke-name-drops-plugin-prefix",
    src: "src/agent/plugins/skills.ts",
    test: "tests/plugin-commands-dispatch.test.ts",
    desc: "调用名去掉插件前缀 ⇒ 两个插件的同名命令撞成一个（scoped 名是 §9.2/§9.6 的消歧面，面板与派发同名）",
    apply: (s) => s.replace("  return c.plugin ? \"/\" + c.plugin + \":\" + c.name : \"/\" + c.name;", "  return \"/\" + c.name;"),
    expectFail: "命中插件命令：整条消息换成渲染结果",
  },
  {
    id: "command-render-keeps-markdown-newline",
    src: "src/agent/plugins/skills.ts",
    test: "tests/plugin-commands-dispatch.test.ts",
    desc: "不剥 markdown 文件自带的首尾换行 ⇒ 每条命令渲染出的用户消息都带一个空白尾巴（事件流与面板多一行空内容）",
    apply: (s) => s.replace("  }).trim();", "  });"),
    expectFail: "/cmd-demo:wave 张三 → 落流的是渲染后的正文，不是那串斜杠",
  },
  {
    id: "skill-routing-drops-when-to-use",
    src: "src/agent/plugins/skills.ts",
    test: "tests/skill-invocation-faces.test.ts",
    desc: "路由清单只留 description ⇒ 模型知道「有这个 skill」却不知道「什么时候该用」，§9.3 的 (+when_to_use) 没落地，触发靠猜",
    apply: (s) => s.replace("  return \"- \" + skillInvokeName(s) + (desc ? \" — \" + desc : \"\") + (when ? \"（适用：\" + when + \"）\" : \"\");", "  return \"- \" + skillInvokeName(s) + (desc ? \" — \" + desc : \"\");"),
    expectFail: "when_to_use 在场时并入同一行：模型据此判断何时触发，而不只是知道有个 skill",
  },
  {
    id: "skill-routing-ignores-disable-model-invocation",
    src: "src/agent/plugins/skills.ts",
    test: "tests/skill-invocation-faces.test.ts",
    desc: "清单不做过滤 ⇒ 声明了「只能用户触发」的 skill 仍每轮占用模型上下文并诱导自动触发（白付 token + 违背插件作者意愿）",
    apply: (s) => s.replace("  const lines = [...skills.filter(modelInvocable).map(skillRoutingLine), ...extraLines];", "  const lines = [...skills.map(skillRoutingLine), ...extraLines];"),
    expectFail: "disable-model-invocation 的 skill 不进清单；不声明的照常进（布尔与字符串两种写法同效）",
  },
  {
    id: "skill-fm-bool-only-accepts-boolean",
    src: "src/agent/plugins/skills.ts",
    test: "tests/skill-invocation-faces.test.ts",
    desc: "布尔位只认 true 不认 \"true\" ⇒ 我们 frontmatter 解析器给的是字符串，CC 插件的这条声明被静默读成「没声明」",
    apply: (s) => s.replace(`  return v === true || v === "true";`, `  return v === true;`),
    expectFail: "disable-model-invocation 的 skill 不进清单；不声明的照常进（布尔与字符串两种写法同效）",
  },
  {
    id: "skill-hidden-in-list-but-still-executable",
    src: "src/agent/plugins/index.ts",
    test: "tests/skill-invocation-faces.test.ts",
    desc: "只把名字从清单里藏掉、执行端不设闸 ⇒ 模型猜中调用名照样拿到全文（「看不见」被当成「挡住了」）",
    apply: (s) => s.replace("    if (!modelInvocable(entry)) {", "    if (false) {"),
    expectFail: "模型硬猜被藏起来的名字 ⇒ triggerSkill 明确拒绝并给出原因（不静默放行全文）",
  },
  {
    id: "hook-if-not-carried-at-load",
    src: "src/agent/plugins/discover.ts",
    test: "tests/plugins-discover.test.ts",
    desc: "装载时不把 `if` 带进 LoadedHookDef ⇒ 执行端再怎么写也拿不到，作者那条「只拦这种」的闸被静默降级成每次都跑",
    apply: (s) => s.replace("          ...(m.if !== undefined ? { if: m.if } : {}),", "          ...(false ? { if: m.if } : {}),"),
    expectFail: "hooks.json 里的 if 带到执行面；读不懂的那条出警告",
  },
  {
    id: "hook-if-filter-not-applied",
    src: "src/agent/plugins/hooks.ts",
    test: "tests/hooks-input-contract.test.ts",
    desc: "handler 选择面不看 `if`（传 undefined）⇒ 解析器与别名全实现了，只是没人拿它筛，等于收下即丢",
    apply: (s) => s.replace("      if (!hookIfMatches(h.if, payload.tool_name, payload.tool_args)) continue;", "      if (!hookIfMatches(undefined, payload.tool_name, payload.tool_args)) continue;"),
    expectFail: "前缀命中才跑：run_shell(git add:*) 挡不住别的命令",
  },
  {
    id: "hook-if-malformed-skips-handler",
    src: "src/agent/plugins/hooks.ts",
    test: "tests/hooks-input-contract.test.ts",
    desc: "读不懂的 `if` 判成「不匹配」⇒ 守卫型钩子（作者想拦东西）因一个拼写错而彻底不跑，且没有任何地方说它被关了",
    apply: (s) => s.replace("  if (parsed === null) return true;", "  if (parsed === null) return false;"),
    expectFail: "读不懂的 if：一律跑 + 当场回执，且 parseHookIf 如实报 null",
  },
  {
    id: "hook-if-exec-receipt-removed",
    src: "src/agent/plugins/hooks.ts",
    test: "tests/hooks-input-contract.test.ts",
    desc: "执行期不留回执 ⇒ 装载期警告被面板刷掉后，这一次到底按什么语义跑的就再也无人知道（不静默改语义这条自身失去凭据）",
    apply: (s) => s.replace("        result.errors.push(\"hook 的 if 语法读不懂（\" + h.if + \"）⇒ 本次按「总是跑」处理\");", "        void 0;"),
    expectFail: "读不懂的 if：一律跑 + 当场回执，且 parseHookIf 如实报 null",
  },
  {
    id: "hook-if-cc-tool-alias-removed",
    src: "src/tools/base.ts",
    test: "tests/hooks-input-contract.test.ts",
    desc: "去掉 CC 工具名别名 ⇒ 为 CC 写的 `Write(...)`/`Edit(...)` 型 if 在我们这里永不匹配，钩子静默不跑（§9.5 照抄语义的另一半）。这张表现在由 hook 的 `if` 与 skill/command 的工具权限联动共用（同一张表在 src/tools/base），故针脚改指它",
    apply: (s) => s.replace(`  bash: "run_shell", write: "write_file", edit: "edit_file", read: "read_file",`, `  bash: "run_shell",`),
    expectFail: "CC 工具名作别名：Write 命中 write_file 的主参数前缀",
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
    id: "session-end-timeout-cap-removed",
    src: "src/agent/plugins/hooks.ts",
    test: "tests/hook-session-end.test.ts",
    desc: "去掉 SessionEnd 的 30s 短帽 ⇒ 收尾回落到缺省 600s，一个挂死的钩子能把「退出」拖住十分钟",
    apply: (s) => s.replace('          : event === "SessionEnd" ? HOOK_TIMEOUT_SESSION_END', '          : false ? HOOK_TIMEOUT_SESSION_END'),
    expectFail: "未声明 timeout 的 SessionEnd handler 取 30s；别的缺省仍是 600s",
  },
  {
    id: "session-end-matcher-field-removed",
    src: "src/agent/plugins/hooks.ts",
    test: "tests/hook-session-end.test.ts",
    desc: "matcher 不看结束原因（SessionEnd 落回 default 的 undefined）⇒ 写了具体原因的钩子静默永不触发，作者以为「只在 compact 时收尾」其实一条都不跑",
    apply: (s) => s.replace('    case "SessionEnd": // §9.5 表：SessionEnd 的 matcher 字段 = 结束原因', '    case "__never__":'),
    expectFail: "matcher 按结束原因配：写 exit 的那条跑，写 compact 的那条不跑",
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
  {
    id: "skill-trigger-skips-substitution",
    src: "src/agent/plugins/index.ts",
    test: "tests/skill-invocation-faces.test.ts",
    desc: "触发 skill 时原样吐正文 ⇒ 为 CC 写的 SKILL.md 里的 $ARGUMENTS 一路裸着进模型上下文（模型以为要自己填，或干脆照抄变量名）",
    apply: (s) => s.replace('        substituteVars(entry.body, { ...this.substitutionFor(entry), args: argsString }),', '        entry.body,'),
    expectFail: "带 args 触发 ⇒ $ARGUMENTS 与 $1 换成实参，缺位的 $9 落成空串（不留裸变量给模型）",
  },
  {
    id: "skill-tool-drops-args-arg",
    src: "src/main/agent-runner.ts",
    test: "tests/plugin-commands-dispatch.test.ts",
    desc: "工具执行面不读 args.args ⇒ 替换器永远收到空串。上面那条锚点杀的是「runtime 不替换」，这条杀的正是最后那一跳：接缝都在、参数没接",
    apply: (s) => s.replace('        return rt.triggerSkill(name, typeof args.args === "string" ? args.args : "");', '        return rt.triggerSkill(name);'),
    expectFail: "模型经 skill 工具下的 args 真的进替换器（tool_result 里是替换后的正文）",
  },
  {
    id: "skill-tool-spec-hides-args",
    src: "src/main/agent-runner.ts",
    test: "tests/plugin-commands-dispatch.test.ts",
    desc: "规格面不声明 args ⇒ 执行面读得到但模型看不见，等于这条参数通道对模型不存在（§4.4 三面同源的老形状）",
    apply: (s) => s.replace('          args: { type: "string", description: "传给 skill 的参数原文（正文里的 $ARGUMENTS / $1 / $name 按此替换；无参数可省略）" },', '          ...(false ? { args: { type: "string", description: "x" } } : {}),'),
    expectFail: "skill 工具的规格面声明了 args（模型看得见才有那条参数通道；与执行面同源）",
  },
  {
    id: "skill-named-arguments-ignored",
    src: "src/agent/plugins/index.ts",
    test: "tests/skill-invocation-faces.test.ts",
    desc: "不把 frontmatter arguments 的声明序交给替换器 ⇒ §9.3 的 $name 一档全灭，作者按 CC 写法声明的参数面静默失效",
    apply: (s) => s.replace('      named: declaredArgumentNames(entry.frontmatter),', '      named: [],'),
    expectFail: "frontmatter arguments 声明过的 $name 按声明序吃位置参数",
  },
  {
    id: "skill-dir-var-missing",
    src: "src/agent/plugins/index.ts",
    test: "tests/skill-invocation-faces.test.ts",
    desc: "不给 SKILL_DIR ⇒ 正文里「配套脚本见 ${SKILL_DIR}/run.py」这类写法永远展不开，模型拿到一个伪路径字符串",
    apply: (s) => s.replace('      skillDir: dirname(entry.path),', '      skillDir: undefined,'),
    expectFail: "五个 ${} 变量展开成这次装载的真实路径与会话 id",
  },
  {
    id: "skill-var-claude-alias-dropped",
    src: "src/agent/plugins/skills.ts",
    test: "tests/plugins-skills.test.ts",
    desc: "只认自家变量名、不认 CC 的 ${CLAUDE_*} ⇒ 生态里现成的 skill 包一半展不开（§9.3 明写「作解析别名，一处 alternation 兼容」）",
    apply: (s) => s.replace('  PLUGIN_ROOT: "pluginRoot", CLAUDE_PLUGIN_ROOT: "pluginRoot",', '  PLUGIN_ROOT: "pluginRoot",'),
    expectFail: "${} 五个变量按上下文展开，${CLAUDE_*} 作别名同值；上下文里没有的整串原样保留",
  },
  {
    id: "skill-unknown-var-forged-empty",
    src: "src/agent/plugins/skills.ts",
    test: "tests/plugins-skills.test.ts",
    desc: "认不出 / 没值的 ${VAR} 一律换成空串 ⇒ 正文里凭空少一段路，而谁都不知道少过（把不可知记成「这里什么都没有」）",
    apply: (s) => s.replace('      return key === undefined ? whole : (ctx[key] ?? whole);', '      return "";'),
    expectFail: "${} 五个变量按上下文展开，${CLAUDE_*} 作别名同值；上下文里没有的整串原样保留",
  },
  {
    id: "skill-remount-does-not-replay-args",
    src: "src/agent/plugins/index.ts",
    test: "tests/skill-invocation-faces.test.ts",
    desc: "压缩后重挂时不重放当年那次调用的参数 ⇒ 同一个 skill 第一次进上下文是替换过的、重挂回来是裸模板，模型看到两份不一样的「权威正文」",
    apply: (s) => s.replace('      return { body: substituteVars(entry.body, { ...this.substitutionFor(entry), args: callArgs }) };', '      return { body: entry.body };'),
    expectFail: "压缩后重挂重放当年那次调用的参数 ⇒ 同一 skill 两次进上下文内容一致",
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
    id: "plugin-lsp-not-merged-into-config",
    src: "src/tools/lsp.ts",
    test: "tests/plugin-lsp-activation.test.ts",
    desc: "注册表有了，但 loadLspConfig 不并入 ⇒ pickServerForFile 永远看不见插件服务器，注册只是把对象塞进一个没人读的 Map",
    apply: (s) => s.replace("  for (const [id, cfg] of Object.entries(pluginServers.get(wsKey(workspace)) ?? {})) {", "  for (const [id, cfg] of Object.entries({})) {"),
    expectFail: "受信插件的服务器按 scoped id 注册；transport:socket 那条不占名额",
  },
  {
    id: "plugin-lsp-trust-gate-open",
    src: "src/agent/plugins/index.ts",
    test: "tests/plugin-lsp-activation.test.ts",
    desc: "注册 LSP 时不看信任态 ⇒ 未批准的插件服务器（command = 任意可执行文件）被会话拉起，绕过 §9.5 信任边界",
    apply: (s) => s.replace('      if (p.trust !== "trusted") continue;\n      const servers: Record<string, LspRuntimeConfig> = {};', '      const servers: Record<string, LspRuntimeConfig> = {};'),
    expectFail: "未过信任门的插件不注册（server.command 是任意可执行文件，信任门与 hook/MCP 同口径）",
  },
  {
    id: "plugin-lsp-root-not-expanded",
    src: "src/agent/plugins/index.ts",
    test: "tests/plugin-lsp-activation.test.ts",
    desc: "不展开 ${PLUGIN_ROOT} ⇒ spawn 的参数是一个字面量占位串，服务器永远起不来（CC 的插件包全靠这条路径写相对资源）",
    apply: (s) => s.replace("          args: (cfg.args ?? []).map(expand),", "          args: [...(cfg.args ?? [])],"),
    expectFail: "真跳：${PLUGIN_ROOT} 展开成真路径，lsp 工具 hover 回显出 initializationOptions",
  },
  {
    id: "plugin-lsp-init-options-dropped",
    src: "src/tools/lsp.ts",
    test: "tests/plugin-lsp-activation.test.ts",
    desc: "initialize 不带 initializationOptions ⇒ 服务器拿不到插件自己声明的配置，字段收下即丢（§9.8 的映射只做半套）",
    apply: (s) => s.replace("        initializationOptions: server.initializationOptions ?? {},", "        initializationOptions: {},"),
    expectFail: "真跳：${PLUGIN_ROOT} 展开成真路径，lsp 工具 hover 回显出 initializationOptions",
  },
  {
    id: "plugin-lsp-diagnostics-switch-ignored",
    src: "src/tools/lsp.ts",
    test: "tests/plugin-lsp-activation.test.ts",
    desc: "diagnostics.enabled=false 照样回流 ⇒ 作者关掉的噪声（或某个乱报诊断的 server）关不掉，配置只是装饰",
    apply: (s) => s.replace("    if (cfg.servers[picked]?.diagnosticsEnabled === false) return \"\";", "    if (false) return \"\";"),
    expectFail: "§9.8 的 diagnostics 开关真兑现：开 ⇒ 插件服务器推的 ERROR 回流；关 ⇒ 一个字都不回",
  },
  {
    id: "plugin-lsp-not-unregistered-on-shutdown",
    src: "src/agent/plugins/index.ts",
    test: "tests/plugin-lsp-activation.test.ts",
    desc: "shutdown 不摘注册表 ⇒ 下一个会话继承上一个插件的服务器；插件目录被卸载后 pickServerForFile 会挑到一个不存在的 command",
    apply: (s) => s.replace("    unregisterPluginLspServers(this.opts.workspace, this.lspServerIds);", "    void 0;"),
    expectFail: "shutdown 摘干净：注册表不留跨会话残留（下一个会话不该继承上一个插件的服务器）",
  },
  {
    id: "plugin-lsp-unhonored-fields-silent",
    src: "src/agent/plugins/discover.ts",
    test: "tests/plugin-lsp-activation.test.ts",
    desc: "运行时还没兑现的字段不吭声 ⇒ 作者以为配了重启策略，实际崩了就崩了（本仓规矩：不静默改语义，也不静默不兑现）",
    apply: (s) => s.replace('        if (unhonored.length > 0) warnings.push(', '        if (false) warnings.push('),
    expectFail: "§9.8 里运行时还没兑现的字段，装载期当场说出来（不静默收下）",
  },
  {
    id: "hook-exec-form-spawns-first-arg",
    src: "src/agent/plugins/hooks.ts",
    test: "tests/plugins-hooks.test.ts",
    desc: "exec form 把 argv[0] 当可执行文件、丢掉声明的 command ⇒ 每条数组形态钩子都在 spawn 它的第一个「参数」（node -e … 变成 spawn 「-e」）→ ENOENT；既有钩子单测全用替身 exec，真实 spawn 面没人跑过",
    apply: (s) => s.replace("      const handle = spawnTracked(command, shell ? [] : argv, {", "      const handle = spawnTracked(shell ? command : (argv[0] ?? \"\"), shell ? [] : argv.slice(1), {"),
    expectFail: "数组形态：spawn 声明的可执行文件本身，其余参数原样交给它",
  },
  {
    id: "hook-spawn-error-reason-dropped",
    src: "src/agent/plugins/hooks.ts",
    test: "tests/plugins-hooks.test.ts",
    desc: "spawn 失败的原因被吞 ⇒ 错误只剩「非零退出 null」，看不出是谁没找到（把不可知记成一个不存在的退出码）",
    apply: (s) => s.replace('      handle.child.on("error", (err: Error) => { spawnError = err.message; done(null); });', '      handle.child.on("error", () => done(null));'),
    expectFail: "起不来的进程：错误里带真实原因（ENOENT），不只报一个不存在的退出码",
  },
  {
    id: "hook-exec-argv-userconfig-not-expanded",
    src: "src/agent/plugins/hooks.ts",
    test: "tests/plugin-user-config.test.ts",
    desc: "exec form 的参数不展开 ${user_config.*} ⇒ 字面占位串一路进子进程 argv，插件拿到的是变量名而不是值",
    apply: (s) => s.replace("      const argv = shell ? [] : (h.handler.command as string[]).slice(1).map((a) => expandUserConfig(a, cfgValues));", "      const argv = shell ? [] : (h.handler.command as string[]).slice(1);"),
    expectFail: "exec form 的 ${user_config.TOKEN} 被展开，且 PLUGIN_OPTION_TOKEN 真的进了子进程 env",
  },
  {
    id: "plugin-option-env-not-passed",
    src: "src/agent/plugins/hooks.ts",
    test: "tests/plugin-user-config.test.ts",
    desc: "不设 PLUGIN_OPTION_* ⇒ §9.5 给 hook 进程取值的那条正门没了（argv 只能带一个键，其余配置项无处可取）",
    apply: (s) => s.replace("        extra: pluginOptionEnv(cfgValues),", "        extra: {},"),
    expectFail: "exec form 的 ${user_config.TOKEN} 被展开，且 PLUGIN_OPTION_TOKEN 真的进了子进程 env",
  },
  {
    id: "userconfig-not-resolved-at-load",
    src: "src/agent/plugins/index.ts",
    test: "tests/plugin-user-config.test.ts",
    desc: "装载时不解析 userConfig ⇒ 三条激活面一律拿到空表（值早就填好了也没用），缺项警告也从不出声",
    apply: (s) => s.replace("    await rt.resolveUserConfigs(); // 装载即解析：缺项要在激活前就出现在警告里", "    void 0;"),
    expectFail: "装载期就把值解析好（生产里没有任何人再调一次 resolveUserConfigs）",
  },
  {
    id: "userconfig-missing-key-warning-deleted",
    src: "src/agent/plugins/index.ts",
    test: "tests/plugin-user-config.test.ts",
    desc: "缺值不点名 ⇒ 插件带着字面占位串去连远端，报回来的错和配置毫无关系，排查的人看不出少的是哪一项",
    apply: (s) => s.replace('          p.warnings.push("userConfig 缺项：" + p.name + " 引用了 ${user_config." + key + "} 但没有值（未填或敏感值解不开）⇒ 原样保留，不填空串");', "          void 0;"),
    expectFail: "没填值 ⇒ 占位串原样留着（不换成空串），且装载期点名是哪个键缺",
  },
  {
    id: "mcp-userconfig-roots-not-threaded",
    src: "src/agent/plugins/index.ts",
    test: "tests/plugin-user-config.test.ts",
    desc: "connectMcp 不把 userConfig 递进 connect（替换器有、没人喂值）⇒ §9.11 两个实仓样本那类 http 插件的 key 永远进不了 headers",
    apply: (s) => s.replace("          userConfig: this.userConfigValuesFor(p.name),", "          userConfig: {},"),
    expectFail: "第二激活面 MCP：connectMcp 真的把 userConfig 递给 connect（远程 key 就写在 headers 里）",
  },
  {
    id: "lsp-userconfig-not-expanded",
    src: "src/agent/plugins/index.ts",
    test: "tests/plugin-user-config.test.ts",
    desc: "第三激活面漏接：注册进 LSP 运行时的 command/args 不展开 ⇒ 面板同源读路径显示一个伪路径，服务器起不来",
    apply: (s) => s.replace("      const cfgValues = this.userConfigValuesFor(p.name);", "      const cfgValues: Record<string, string> = {};"),
    expectFail: "第三激活面 LSP：注册前就展开，面板同源读路径看到的是展开后的",
  },
  {
    id: "userconfig-plugin-name-guard-dropped",
    src: "src/agent/plugins/secrets.ts",
    test: "tests/plugin-user-config.test.ts",
    desc: "读配置文件时不校验 plugin 字段 ⇒ A 插件的值被套到 B 插件上（共用 plugin-data 目录时跨插件串味）",
    apply: (s) => s.replace('  const cfg = file !== null && file.plugin === opts.plugin && file.config && typeof file.config === "object"', "  const cfg = file !== null && file.config && typeof file.config === \"object\""),
    expectFail: "配置文件里的 plugin 与请求不一致 ⇒ 那份值一个都不采用（不把 A 插件的配置套到 B 插件上）",
  },
  {
    id: "userconfig-default-value-dropped",
    src: "src/agent/plugins/secrets.ts",
    test: "tests/plugin-user-config.test.ts",
    desc: "manifest 声明的 default 在读侧不生效 ⇒ 用户没填的可选项直接判缺，插件连不上自己写明的默认端点",
    apply: (s) => s.replace("    if (field?.defaultValue !== undefined) { values[key] = field.defaultValue; continue; }", "    void field;"),
    expectFail: "缺值 / 解不开的敏感值 → 进 missing，值面里**没有这个键**（不拿空串顶位）",
  },
  {
    id: "userconfig-secret-missing-filled-empty",
    src: "src/agent/plugins/secrets.ts",
    test: "tests/plugin-user-config.test.ts",
    desc: "敏感值解不开时填空串 ⇒ 插件拿着「Bearer 」（后面什么都没有）去连远端，错误里看不出是没填还是换机器解不开（把不可知记成空值）",
    apply: (s) => s.replace("      if (v === null) { missing.push(key); continue; } // 无后端 / 换机器解不开 → 出声，不填空串", '      if (v === null) { values[key] = ""; continue; }'),
    expectFail: "缺值 / 解不开的敏感值 → 进 missing，值面里**没有这个键**（不拿空串顶位）",
  },
  {
    id: "userconfig-manifest-default-not-parsed",
    src: "src/agent/plugins/manifest.ts",
    test: "tests/plugin-user-config.test.ts",
    desc: "userConfig 的 default 在装载期就被丢掉（只剩 hasDefault 布尔）⇒ 读侧再正确也没有值可用",
    apply: (s) => s.replace("        ...(o.default !== undefined ? { defaultValue: String(o.default) } : {}),", "        ...(o.default !== undefined ? {} : {}),"),
    expectFail: "第二激活面 MCP：connectMcp 真的把 userConfig 递给 connect（远程 key 就写在 headers 里）",
  },
  {
    id: "mcp-url-not-expanded",
    src: "src/agent/plugins/mcp.ts",
    test: "tests/plugin-user-config.test.ts",
    desc: "expandMcpConfig 只覆盖 command/args/env ⇒ 远程 server 的 url 里那个 ${user_config.PROFILE} 原样发给 DNS",
    apply: (s) => s.replace('  if (typeof out.url === "string") out.url = sub(out.url);', "  void sub;"),
    expectFail: "command/args/env 之外，url 与 headers 同样展开；缺值的键原样留着",
  },
  {
    id: "mcp-headers-not-expanded",
    src: "src/agent/plugins/mcp.ts",
    test: "tests/plugin-user-config.test.ts",
    desc: "headers 不展开 ⇒ 这类插件的 API key 位置恰好就在 headers 里，等于整类连不上（§9.11 两个实仓样本都是这个形态）",
    apply: (s) => s.replace("  out.headers = strMap(out.headers);", "  void strMap(out.headers);"),
    expectFail: "command/args/env 之外，url 与 headers 同样展开；缺值的键原样留着",
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
    id: "user-message-skill-field-dropped-in-loop",
    src: "src/agent/loop.ts",
    test: "tests/skill-user-invocation.test.ts",
    desc: "loop 收到归属却不写进事件 ⇒ 落盘/重放后这一跳的信息就没了（JSONL 是唯一事实源，内存态救不回来）",
    apply: (s) => s.replace("      ...(userMessageSkill ? { skill: userMessageSkill } : {}),", "      ...(false ? { skill: userMessageSkill } : {}),"),
    expectFail: "/sk-demo:say 你好 → 落流的是替换过的正文，且带 skill 归属",
  },
  {
    id: "remount-projection-ignores-user-skill",
    src: "src/agent/plugins/index.ts",
    test: "tests/skill-user-invocation.test.ts",
    desc: "重挂投影只认模型那条 tool_call ⇒ 用户点的 skill 压缩后静默消失、模型点的会重注（两条 face 行为不一致，最难查的那种）",
    apply: (s) => s.replace('    if (e.type === "user_message" && (e as UserMessageEvent).skill) {', '    if (false && (e as UserMessageEvent).skill) {'),
    expectFail: "重挂投影看得见用户侧触发：那条 user_message 被压缩摘除时要重注正文",
  },
  {
    id: "skill-policy-not-granted-on-model-trigger",
    src: "src/agent/plugins/index.ts",
    test: "tests/skill-tool-policy.test.ts",
    desc: "模型触发 skill 时不登记它的工具面申报 ⇒ §9.3 的 allowed/disallowed-tools 又回到「收下即丢」，摘工具形同没写",
    apply: (s) => s.replace("    this.grantSkillScope(skillInvokeName(entry), entry.frontmatter);", "    void 0;"),
    expectFail: "激活之前什么都不生效；激活那一刻登记，且 deny 与 allow 分别可查",
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
    id: "loop-skill-denial-gate-absent",
    src: "src/agent/loop.ts",
    test: "tests/skill-tool-policy.test.ts",
    desc: "活闸不生效 ⇒ disallowed-tools 只剩面板上一个数字，模型照旧能用被摘的工具（工具面申报成装饰）",
    apply: (s) => s.replace("      const sk = opts.skillDenial?.(output.name);", "      const sk: string | null = null;"),
    expectFail: "摘除期间该工具根本不进执行面，拒绝挂回原 callId 且点名申报者",
  },
  {
    id: "loop-skill-denial-exempts-verify",
    src: "src/agent/loop.ts",
    test: "tests/skill-tool-policy.test.ts",
    desc: "把 verify 当「系统门优先」豁免掉 ⇒ 被摘的工具因为沾了系统门就绕过工具面硬闸，正是 §4.4 三重闸各管各的老洞形状",
    apply: (s) => s.replace("      const sk = opts.skillDenial?.(output.name);", '      const sk = output.name === "verify" ? null : opts.skillDenial?.(output.name);'),
    expectFail: "活闸排在 verify 系统门之前：被摘掉的 verify 不能靠「系统门优先」绕过",
  },
  {
    id: "skill-denial-does-not-name-source",
    src: "src/agent/plugins/index.ts",
    test: "tests/skill-tool-policy.test.ts",
    desc: "拒绝理由不点名是谁摘的 ⇒ 模型与用户都看不到「是哪条 skill 收走了这个工具」，只能瞎猜并反复重试",
    apply: (s) => s.replace("      if (p.deny.some((t) => t === tool)) return invoke;", '      if (p.deny.some((t) => t === tool)) return "unknown";'),
    expectFail: "激活之前什么都不生效；激活那一刻登记，且 deny 与 allow 分别可查",
  },
  {
    id: "skill-allow-note-silent",
    src: "src/main/agent-runner.ts",
    test: "tests/skill-tool-policy.test.ts",
    desc: "门卡不解释「申报了但没放行」⇒ 收紧点变成一条只有读源码的人才知道的规则，用户看到的效果是「插件写了 allowed-tools 却还是问我」而无从判断谁对",
    apply: (s) => s.replace("  const invo = currentPluginRuntime()?.skillAllowNote(tool) ?? null;", "  const invo: string | null = null;"),
    expectFail: "门卡的 reason 说清「申报了但没放行」——收紧点要让使用者看得见（能力 8：可解释）",
  },
  {
    id: "unknown-tool-silently-dropped",
    src: "src/agent/plugins/skills.ts",
    test: "tests/skill-tool-policy.test.ts",
    desc: "认不出的工具名直接跳过不出声 ⇒ 作者以为摘掉了某个工具，实际那条申报什么都没做（把不可知记成「这里没有东西」）",
    apply: (s) => s.replace('      if (tool === null) {\n        out.unknown.push(behavior + ":" + item);\n        continue;\n      }', "      if (tool === null) continue;"),
    expectFail: "认不出的名字另列且带方向前缀（不静默当真，也不静默丢掉）",
  },
  {
    id: "skill-scope-not-on-panel",
    src: "src/agent/plugins/index.ts",
    test: "tests/skill-tool-policy.test.ts",
    desc: "这份账不进面板快照 ⇒ 面板说「本 turn 没有工具面改动」而实际有（审计面与真实现不一致，装载即陈列的镜像版）",
    apply: (s) => s.replace("      toolScopes: this.skillScopeSnapshot(),", "      toolScopes: [],"),
    expectFail: "面板快照带这份账（审计读路径与判据同源）",
  },
  {
    id: "skill-policy-cc-alias-lost",
    src: "src/tools/base.ts",
    test: "tests/skill-tool-policy.test.ts",
    desc: "别名表少一项 ⇒ 为 CC 写的 `allowed-tools: Write` 在我们这里变成 unknown，申报方以为预批了、其实什么都没登记",
    apply: (s) => s.replace(`  bash: "run_shell", write: "write_file", edit: "edit_file", read: "read_file",`, `  bash: "run_shell",`),
    expectFail: "逗号/空格混排、数组形态、CC 别名与去重都归一成规范工具名",
  },
  {
    id: "user-skill-hit-drops-args",
    src: "src/agent/plugins/skills.ts",
    test: "tests/skill-user-invocation.test.ts",
    desc: "命中记录不带当年参数 ⇒ 压缩后重挂时按空参重放，同一 skill 两次进上下文内容不同（裸 $ARGUMENTS 回到账面）",
    apply: (s) => s.replace("    hit: { invoke: skillInvokeName(hit), args },", "    hit: { invoke: skillInvokeName(hit), args: \"\" },"),
    expectFail: "/sk-demo:say 你好 → 落流的是替换过的正文，且带 skill 归属",
  },
  {
    id: "user-skill-face-budget-abolished",
    src: "src/agent/plugins/skills.ts",
    test: "tests/skill-user-invocation.test.ts",
    desc: "用户那条 face 不设顶帽 ⇒ 敲一次 /skill 就把 200KB 的 SKILL.md 原样买进上下文，而它整段会话都要付费（模型那条有帽、这头没有）",
    apply: (s) => s.replace('    text: clampSkillBody(\n      renderPromptCommand(hit, args, ctxFor?.(hit) ?? {}),\n      SKILL_REMOUNT_TOKENS_PER_SKILL,\n      "\\n[全文见 " + hit.path + "]"),', "    text: renderPromptCommand(hit, args, ctxFor?.(hit) ?? {}),"),
    expectFail: "超预算的正文按模型侧同一顶帽裁掉，并留全文通道（用户敲一次不能买下整段会话）",
  },
  // ---- §9.5 PreCompact 生产端（任务 #40：手动/阈值自动/超窗三条压缩路径的唯一必经点）----
  {
    id: "precompact-producer-abolished",
    src: "src/agent/compaction.ts",
    test: "tests/hook-precompact-producer.test.ts",
    desc: "压缩不再发 PreCompact ⇒ §9.5 表里这一行整条失效，插件作者以为「压缩前备份」在跑，实际一次也没有（发点在 runCompaction 上，摘掉它三条路一起哑）",
    apply: (s) => s.replace("  if (args.onPreCompact) {", "  if (false && args.onPreCompact) {"),
    expectFail: "manual / auto / overflow 三条都发，且 trigger 按 §9.5 表映射（overflow 归 auto）",
  },
  {
    id: "precompact-trigger-always-manual",
    src: "src/agent/compaction.ts",
    test: "tests/hook-precompact-producer.test.ts",
    desc: "trigger 不区分压缩来源、一律报 manual ⇒ 按 auto 写 matcher 的钩子永不命中、按 manual 写的在自动压缩时误命中（§9.5 表把这一列定为 manual/auto 就是为了分流）",
    apply: (s) => s.replace('      await args.onPreCompact(args.trigger === "manual" ? "manual" : "auto");', '      await args.onPreCompact("manual");'),
    expectFail: "manual / auto / overflow 三条都发，且 trigger 按 §9.5 表映射（overflow 归 auto）",
  },
  {
    id: "precompact-coordinator-forward-dropped",
    src: "src/agent/compaction.ts",
    test: "tests/hook-precompact-producer.test.ts",
    desc: "协调器收了 onPreCompact 却不往 runCompaction 递 ⇒ 会话内自动/溢出压缩永不发钩子（构造面收下即丢，只有手动档看起来是好的）",
    apply: (s) => s.replace("      ...(this.onPreCompact ? { onPreCompact: this.onPreCompact } : {}),", "      ...(false ? { onPreCompact: this.onPreCompact } : {}),"),
    expectFail: "压缩没开始就不发：decision=null 不发；摘要停用后 auto 不发，overflow 截断照发",
  },
  {
    id: "precompact-glm-session-forward-dropped",
    src: "src/agent/glm-session.ts",
    test: "tests/hook-precompact-producer.test.ts",
    desc: "provider 收了 compaction.onPreCompact 却不递给协调器 ⇒ 真实会话里的自动压缩绕过了钩子（纯函数单测全绿也照样断，因为断在这一跳）",
    apply: (s) => s.replace("        ...(opts.compaction.onPreCompact ? { onPreCompact: opts.compaction.onPreCompact } : {}),", "        ...(false ? { onPreCompact: opts.compaction.onPreCompact } : {}),"),
    expectFail: "组装前触发的压缩发出 PreCompact(auto)，且只发一次",
  },
  {
    id: "precompact-manual-producer-dropped",
    src: "src/main/agent-runner.ts",
    test: "tests/hook-precompact-producer.test.ts",
    desc: "手动 /compact 不再把钩子引擎递下去 ⇒ 压缩卡照出、钩子一个不跑（回归到「只有函数有源」的老形态；本条用真实 spawn 的哨兵文件计数钉住）",
    apply: (s) => s.replace('    onPreCompact: (trigger) => firePreCompactHook(hooks, trigger),', '    ...(false ? { onPreCompact: (t: "manual" | "auto") => firePreCompactHook(hooks, t) } : {}),'),
    expectFail: "matcher=manual 的那条恰好跑一次，matcher=auto 的那条不跑",
  },
  // ---- §9.3 disallowed-tools 的规格面（任务 #39/#41：模型可见清单与活闸同源）----
  {
    id: "spec-face-deny-not-applied",
    src: "src/agent/glm-session.ts",
    test: "tests/skill-tool-policy.test.ts",
    desc: "读了 skillDenial 却不摘 ⇒ 规格面回到「看得见、叫得动、被执行面拒」的老形态（worker 侧三重闸只剩两重）",
    apply: (s) => s.replace("    if (by) removed.push({ name: s.function.name, by });", "    if (false && by) removed.push({ name: s.function.name, by });"),
    expectFail: "规格面同步：激活后那把工具从模型可见清单消失，只摘申报的那把、不误伤别个",
  },
  {
    id: "spec-face-drop-unexplained",
    src: "src/agent/glm-session.ts",
    test: "tests/skill-tool-policy.test.ts",
    desc: "摘了工具不给说明 ⇒ 模型的清单静默少几把，只能猜哪把没了（本仓规矩：不静默改语义，也不静默不兑现）",
    apply: (s) => s.replace('    "[skill 工具面] 本 turn 已按 disallowed-tools 从可见工具表摘除：" +\n    removed.map((r) => r.name + "（由 " + r.by + "）").join("、");', '    "";'),
    expectFail: "规格面同步：激活后那把工具从模型可见清单消失，只摘申报的那把、不误伤别个",
  },
  {
    id: "spec-face-predicate-not-wired",
    src: "src/main/agent-runner.ts",
    test: "tests/skill-tool-policy.test.ts",
    desc: "run 起点算面时不把活闸谓词递给规格组装 ⇒ 登记面、执行面、规格面三处只有两处对得上（同源接线断在中间那一跳）",
    apply: (s) => s.replace("    ...(skillDenial ? { skillDenial } : {}),", "    ...(false ? { skillDenial } : {}),"),
    expectFail: "规格面同步：激活后那把工具从模型可见清单消失，只摘申报的那把、不误伤别个",
  },
  {
    id: "plugin-context-note-part-dropped",
    src: "src/agent/glm-session.ts",
    test: "tests/session-provider.test.ts",
    desc: "摘除说明拼不进模型看到的 system 块 ⇒ 说明写好了却没人读到（收下即丢的新变体）",
    apply: (s) => s.replace("opts.plugins.hookContext, liveNote]", "opts.plugins.hookContext]"),
    expectFail: "路由清单 / hook 上下文 / 摘除说明三段都到位，两轮都在（少一段即红）",
  },
  {
    id: "plugin-context-routing-part-dropped",
    src: "src/agent/glm-session.ts",
    test: "tests/session-provider.test.ts",
    desc: "skill 路由清单不注入 ⇒ 模型再也不知道有哪些 skill 可点（M2e 的整条注入面在模型端从来没有判据看过，这条现在有了）",
    apply: (s) => s.replace("const parts = [opts.plugins.skillsRouting, opts.plugins.hookContext", "const parts = [opts.plugins.hookContext"),
    expectFail: "路由清单 / hook 上下文 / 摘除说明三段都到位，两轮都在（少一段即红）",
  },
  {
    id: "request-face-never-recomputed",
    src: "src/agent/glm-session.ts",
    test: "tests/session-provider.test.ts",
    desc: "逐请求工具面收了却从不重算 ⇒ 回到「run 起点冻结一份」的形态：模型中途点起的 skill，下一轮清单里那把还在，只能白叫一次再被执行面拒",
    apply: (s) => s.replace("      const face = opts.requestFace?.();", "      const face = opts.requestFace && false ? opts.requestFace() : undefined;"),
    expectFail: "run 中途激活的 skill：下一轮清单里就没有那把、说明同刻出现（不必再靠 loop 白拒一次）",
  },
  {
    id: "request-face-tools-ignored",
    src: "src/agent/glm-session.ts",
    test: "tests/session-provider.test.ts",
    desc: "重算了面却仍把构造时那份 tools 发出去 ⇒ 说明与清单从此各说各话（模型被告知工具没了、请求里却还带着它）",
    // 2026-09-23 改指：模型面预算接进同一行时把它改成了 `declaredTools`（下游还要过一次降配），
    // 针脚跟着搬——语义一字未动：重算了面却仍发构造时那份。
    apply: (s) => s.replace("      const declaredTools = face ? face.tools : opts.tools;", "      const declaredTools = opts.tools;"),
    expectFail: "run 中途激活的 skill：下一轮清单里就没有那把、说明同刻出现（不必再靠 loop 白拒一次）",
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
  {
    id: "join-credits-worker-verify-to-parent",
    src: "src/agent/tool-choice.ts",
    test: "tests/tool-choice.test.ts",
    desc: "读数侧不再按归因摘 worker 的验证 ⇒ 「写过盘没验」在开了 worker 自动验证的会话上假绿（分子被悄悄清掉）",
    apply: (s) => s.replace("if (!hasWorkerAttribution(e)) mainVerifyPass = true;", "mainVerifyPass = true;"),
    expectFail: "写盘与验证都只算主会话侧：worker 的 verify 通过不替父会话销账",
  },
  // ---- tool_stream 关闭位（第三方中转拒收未知字段）：开关有效性 / 零回归 / 拼错不当关，各一条 ----
  {
    id: "glm-tool-stream-switch-ignored",
    src: "src/providers/glm.ts",
    test: "tests/glm-tool-stream-switch.test.ts",
    desc: "关位被无视、永远发 tool_stream ⇒ 严格代理上 provider:check 与每个 worker spawn 第一跳 400（能力有、路径堵）",
    apply: (s) => s.replace("  return off ? undefined : { tool_stream: true };", "  return { tool_stream: true };"),
    expectFail: "M0_GLM_TOOL_STREAM=0：body 不再带该字段，其余字段逐字不变",
  },
  {
    id: "glm-tool-stream-default-flipped-off",
    src: "src/providers/glm.ts",
    test: "tests/glm-tool-stream-switch.test.ts",
    desc: "缺省翻成「不发」⇒ 官方智谱的工具调用流式静默退化（该开关本意是 opt-out，不是改缺省）",
    apply: (s) => s.replace("  return off ? undefined : { tool_stream: true };", "  return off ? { tool_stream: true } : undefined;"),
    expectFail: "缺省：body 里带 tool_stream:true —— 关掉这断言的变异必须红",
  },
  {
    id: "glm-tool-stream-garbage-turns-it-off",
    src: "src/providers/glm.ts",
    test: "tests/glm-tool-stream-switch.test.ts",
    desc: "任意字符串都当「关」⇒ 把 0 打成 oh/false1 时人以为开关生效、实际还在 400，比直接报错更难查",
    apply: (s) => s.replace("  const off = typeof raw === \"string\" && [\"0\", \"false\", \"off\"].includes(raw.trim().toLowerCase());", "  const off = typeof raw === \"string\";"),
    expectFail: "缺省与垃圾值都照旧开（零回归：官方 GLM 要这个字段）",
  },
  // ---- §11.7.2「MCP 工具」那一行（2026-09-20 补）：注解这条通道的每一跳都要有锚 ----
  //   少任何一跳，这一行都退回原状：MCP 工具体在只读/默认/自主三档全部免批。
  {
    id: "mcp-grade-not-derived-from-name",
    src: "src/permissions/autonomy.ts",
    test: "tests/plugins-mcp.test.ts",
    desc: "MCP 身份不再由工具名派生 ⇒ 调用方漏传注解被读成「这不是 MCP」，洞换个形状原地复现（fail-closed 变成 fail-open）",
    apply: (s) => s.replace("  const grade: McpGrade | undefined = isMcpScopedName(tool) ? (mcp ?? { annotated: false }) : undefined;", "  const grade: McpGrade | undefined = isMcpScopedName(tool) ? mcp : undefined;"),
    expectFail: "§11.7.2 三档矩阵：只读注解放行 / 写注解与无注解逐次 / destructive 连自主档也送审",
  },
  {
    id: "mcp-unannotated-auto-exempted",
    src: "src/permissions/autonomy.ts",
    test: "tests/plugins-mcp.test.ts",
    desc: "自主档不再对无注解工具体逐次 ⇒ 沉默的 server 比自报家门的 server 拿到更少审批，等于奖励不写注解",
    apply: (s) => s.replace("    if (grade !== undefined && !grade.annotated) {", "    if (false && grade !== undefined && !grade.annotated) {"),
    expectFail: "§11.7.2 三档矩阵：只读注解放行 / 写注解与无注解逐次 / destructive 连自主档也送审",
  },
  {
    id: "mcp-destructive-annotation-ignored",
    src: "src/permissions/autonomy.ts",
    test: "tests/plugins-mcp.test.ts",
    desc: "server 自标 destructiveHint 却不进风险通道 ⇒ 它明说「我会破坏远端状态」的那句话在权限层是静音的",
    apply: (s) => s.replace("  return mcp?.destructive === true ? { level: \"high\", reason: \"MCP destructiveHint=true（注解通道）\" } : null;", "  return mcp?.destructive === true && false ? { level: \"high\", reason: \"MCP destructiveHint=true（注解通道）\" } : null;"),
    expectFail: "§11.7.2 三档矩阵：只读注解放行 / 写注解与无注解逐次 / destructive 连自主档也送审",
  },
  {
    id: "mcp-plan-gate-split-standard",
    src: "src/permissions/autonomy.ts",
    test: "tests/plugins-mcp.test.ts",
    desc: "方案门仍只看静态写向表 ⇒ 同一轮里 MCP 写在只读档算写、在未批 plan 时算读，一条 allow 规则就能复活它",
    apply: (s) => s.replace("  if (s.planBlocked() && isWriteCall(tool, grade)) {", "  if (s.planBlocked() && isSideEffectTool(tool)) {"),
    expectFail: "方案门按统一写向口径判：未批 plan 时 allow 规则复活不了 MCP 写调用，只读注解仍可跑",
  },
  {
    id: "mcp-grade-never-read-from-listing",
    src: "src/agent/plugins/mcp.ts",
    test: "tests/plugins-mcp.test.ts",
    desc: "tools/list 的 annotations 不再解析（回到硬编码无注解）⇒ 分级输入从源头就没产生，下游判得再对也是猜的",
    apply: (s) => s.replace("          grade: mcpGradeOf((t as { annotations?: unknown }).annotations),", "          grade: { annotated: false },"),
    expectFail: "tools/list 进注册表且名字为 scoped 形态；tools/call 结果回传",
  },
  {
    id: "mcp-grade-arg-dropped-at-gate",
    src: "src/main/agent-runner.ts",
    test: "tests/mcp-grade-gate.test.ts",
    desc: "执行侧不递 info.grade ⇒ 采集面、注册表都齐了，最后一步没接（本仓点名的「接缝都在、末步未接」形状）",
    apply: (s) => s.replace("      const d = evaluate(name as ToolName, args, s.autonomy, info.grade);", "      const d = evaluate(name as ToolName, args, s.autonomy);"),
    expectFail: "带 readOnlyHint 的工具体在自主档自动执行（注解真抵达了门）",
  },
  {
    id: "mcp-noninteractive-denial-unexplained",
    src: "src/main/agent-runner.ts",
    test: "tests/mcp-grade-gate.test.ts",
    desc: "非交互拒绝时把门给的理由丢掉 ⇒ 模型只看到「非交互模式」，不知道是注解缺失，换路也无从下手（能力 8 可解释）",
    apply: (s) => s.replace("      const d = evaluate(name as ToolName, args, s.autonomy, info.grade); // MCP scoped 名进同一管线（规则/风险/档位全生效）\n      const aMode = s.autonomy.mode;\n      if (d.verdict === \"deny\") return denied(name, aMode, d.reason, { ...gateBase(d, aMode), verdict: \"denied\" });\n      let manualScope: AskScope | undefined;\n      if (d.verdict === \"ask\") {\n        if (!s.askGate) return denied(name, aMode, \"非交互模式（fail-closed）：\" + d.reason, { ...gateBase(d, aMode), verdict: \"unattended\" });", "      const d = evaluate(name as ToolName, args, s.autonomy, info.grade); // MCP scoped 名进同一管线（规则/风险/档位全生效）\n      const aMode = s.autonomy.mode;\n      if (d.verdict === \"deny\") return denied(name, aMode, d.reason, { ...gateBase(d, aMode), verdict: \"denied\" });\n      let manualScope: AskScope | undefined;\n      if (d.verdict === \"ask\") {\n        if (!s.askGate) return denied(name, aMode, \"非交互模式（fail-closed）：\", { ...gateBase(d, aMode), verdict: \"unattended\" });"),
    expectFail: "无注解的工具体在自主档不自动执行，且拒绝原因指明依据（stub 未被调用）",
  },
  {
    id: "mcp-readonly-whitelist-dropped",
    src: "src/permissions/autonomy.ts",
    test: "tests/mcp-grade-gate.test.ts",
    desc: "只读档不再按注解放行 ⇒ 白名单退化成「读档一律禁 MCP」，插件的只读检索工具在读代码时全废",
    apply: (s) => s.replace("  if (s.mode === \"read-only\" && isWriteCall(tool, grade)) {", "  if (s.mode === \"read-only\" && isSideEffectTool(tool)) {"),
    expectFail: "只读档：带 readOnlyHint 的照常放行，无注解的按白名单依据拒",
  },
  {
    id: "mcp-spec-carrier-drops-grade",
    src: "src/main/agent-runner.ts",
    test: "tests/session-tools.test.ts",
    desc: "规格面不带注解出厂 ⇒ 下游的 mode 判定没有输入，只能凭空猜哪把是只读的（摘除面与门面重新分家）",
    apply: (s) => s.replace("    out.push({ name: scoped, description: info.description, parameters: info.inputSchema, grade: info.grade });", "    out.push({ name: scoped, description: info.description, parameters: info.inputSchema });"),
    expectFail: "只读档规格面同步：门必拒的 MCP 工具不再挂给模型，带 readOnlyHint 的照旧在列",
  },
  {
    id: "mcp-spec-face-read-only-filter-two-standards",
    src: "src/agent/glm-session.ts",
    test: "tests/session-tools.test.ts",
    desc: "规格面的只读摘除改用静态写向表 ⇒ 门必拒的 MCP 工具仍挂在模型清单上，白叫一轮再吃一句拒绝",
    apply: (s) => s.replace("    if (opts.mode === \"read-only\" && isWriteCall(tool.name, tool.grade)) continue;", "    if (opts.mode === \"read-only\" && isSideEffectTool(tool.name)) continue;"),
    expectFail: "只读档规格面同步：门必拒的 MCP 工具不再挂给模型，带 readOnlyHint 的照旧在列",
  },
  // ---- 观察账本构造同源 + 会话数据真删盘（2026-09-20 零引用扫描分诊补）----
  {
    id: "observation-ledger-write-side-id-drift",
    src: "src/agent/solpi-runtime.ts",
    test: "tests/solpi-runtime.test.ts",
    desc: "写入侧自己另起一个 sessionId 构造账本 ⇒ 回取侧/撤销侧按同名打开的是另一个空账本，删会话与 obs_recall 都摸不到刚归档的脱敏文本",
    apply: (s) => s.replace("    if (flags.observationPack || flags.evidenceReceipts) this.ledger = createObservationLedger(directory);", "    if (flags.observationPack || flags.evidenceReceipts) this.ledger = new ObservationLedger({ sessionDataDir: directory, sessionId: \"obs-other\", enabled: true });"),
    expectFail: "removePrivateSessionData 撤销的是写入侧那个账本：删除前读得到、删除后目录与对象都没了",
  },
  {
    id: "private-session-data-not-unlinked",
    src: "src/agent/solpi-runtime.ts",
    test: "tests/solpi-runtime.test.ts",
    desc: "撤销了清单却把目录留在盘上 ⇒ 「删会话」删的是引用不是内容，脱敏文本仍在应用数据目录里",
    apply: (s) => s.replace("  await ledger.deleteSession();\n  await rm(directory, { recursive: true });", "  await ledger.deleteSession();"),
    expectFail: "removePrivateSessionData 撤销的是写入侧那个账本：删除前读得到、删除后目录与对象都没了",
  },
  // ---- M5b 级联升级接进产品路径 + 终态收尾窗口（2026-09-20 任务 #45）----
  // 这一簇的动机本身就是「两头断」：runCascade 只有验收脚本用 stub rung 调过，产品里零调用者，
  // 而 docs/m5-acceptance.md B5 标着「已证」。下面 7 条锁的是接上后的**判据面**——
  // 什么算红、什么算绿、往哪些档升、升不动时怎样，以及新发现的收尾窗口竞态。
  {
    id: "cascade-trigger-wider-than-objective-fail",
    src: "src/agent/orchestrator.ts",
    test: "tests/cascade-wiring.test.ts",
    desc: "升级判据放宽成「不是 verified 就算红」⇒ 这一路压根没跑过 verify 的环也被拉去升档，拿猜测换账单",
    apply: (s) => s.replace("evidenceOf(t) === \"failed\" || evidenceOf(t) === \"stale\";", "evidenceOf(t) !== \"verified\";"),
    expectFail: "worker 没跑过 verify（证据 absent）⇒ 不升级：没有客观判据就不拿猜测换账单",
  },
  {
    id: "cascade-rung-accepts-absent-evidence",
    src: "src/agent/orchestrator.ts",
    test: "tests/cascade-wiring.test.ts",
    desc: "升上来的那一档不再要求绿证据 ⇒ 花真钱买回一份比触发时更弱的证据还把环标成 done（假绿形状）",
    apply: (s) => s.replace("t.status === \"done\" && t.result !== null && evidenceOf(t) === \"verified\";", "t.status === \"done\" && t.result !== null;"),
    expectFail: "升上来的那一档没跑过 verify（absent）⇒ 不算收敛：不花真钱买回一份比触发时更弱的证据",
  },
  {
    id: "cascade-ladder-cross-provider",
    src: "src/agent/orchestrator.ts",
    test: "tests/cascade-wiring.test.ts",
    desc: "阶梯不再限定同 provider ⇒ 一次 BYOK 会话在升档时被悄悄换成别家的 key 与模型",
    apply: (s) => s.replace("DEFAULT_MODEL_TABLE.filter((s) => s.provider === picked.provider)", "DEFAULT_MODEL_TABLE.filter((s) => s.provider !== picked.provider)"),
    expectFail: "verify 红 ⇒ 同 provider 升一档重跑，链的终态由最后一档负责，被淘汰那档的 worktree 回收",
  },
  {
    id: "cascade-ready-ignores-routing",
    src: "src/agent/orchestrator.ts",
    test: "tests/cascade-wiring.test.ts",
    desc: "cascadeReady 丢掉 routing 前置 ⇒ 未路由时档位无从知晓，「升档」退化成花两遍钱跑同一个模型",
    apply: (s) => s.replace("    if (this.opts.routing !== true) {\n      if (!this.cascadeWarned) {", "    if (false) {\n      if (!this.cascadeWarned) {"),
    expectFail: "只开 cascadeUpgrade、没开 routing ⇒ 不级联：阶梯起点与升档都靠路由，缺了就等于花两遍钱跑同一模型",
  },
  {
    id: "terminal-sync-reads-finished-not-resolved",
    src: "src/agent/orchestrator.ts",
    test: "tests/terminal-sync-window.test.ts",
    desc: "sequencer 同步点回到只读 finished ⇒ 落在收尾窗口（diff/安全流水/emit 未完）的调用方拿到「done + result 空」",
    apply: (s) => s.replace("if (w && w.terminalResolved) {", "if (w && w.finished) {"),
    expectFail: "join 落在窗口内 ⇒ 回执说 running + timedOut 点名；不说 done + 空报告",
  },
  {
    id: "join-settled-reads-finished",
    src: "src/agent/orchestrator.ts",
    test: "tests/terminal-sync-window.test.ts",
    desc: "收队把「finished 已真」当已收敛 ⇒ 窗口里的 worker 不进 timedOut，报告记空串冒充已知",
    apply: (s) => s.replace("known.filter((id) => this.workers.get(id)?.terminalResolved === true)", "known.filter((id) => this.workers.get(id)?.finished === true)"),
    expectFail: "join 落在窗口内 ⇒ 回执说 running + timedOut 点名；不说 done + 空报告",
  },
  {
    id: "cascade-ladder-includes-start-tier",
    src: "src/routing/cascade.ts",
    test: "tests/cascade.test.ts",
    desc: "阶梯从起始档自己开始 ⇒ 把刚被客观判据判没过的同一档再跑一遍（白烧一次预算，永远升不动）",
    apply: (s) => s.replace("for (const t of TIER_ORDER.slice(idx + 1, idx + 1 + maxUpgrades)) {", "for (const t of TIER_ORDER.slice(idx, idx + maxUpgrades)) {"),
    expectFail: "从上一档起取，起始档自己不进来（重跑已判没过的同一档 = 再花一遍钱得同一结果）",
  },
  {
    id: "cascade-climbs-past-other-class-failure",
    src: "src/agent/orchestrator.ts",
    test: "tests/cascade-wiring.test.ts",
    desc: "升上来的那档终态 failed/cancelled 仍继续往上爬 ⇒ 换一档重跑同一个坏环境，把预算烧在没判据说能修好的失败上",
    apply: (s) => s.replace("if (!ok && term.status !== \"done\") stopClimb =", "if (false) stopClimb ="),
    expectFail: "升上来的那档直接崩（终态 failed）⇒ 立刻停止爬升：同一环境换一档只会再花一遍钱",
  },
  {
    id: "bandit-rewards-self-reported-done",
    src: "src/agent/orchestrator.ts",
    test: "tests/cascade-wiring.test.ts",
    desc: "奖励只看终态 done、不看客观证据 ⇒ 在恰好被判红的那一跑上给便宜档加分，级联越开越学出「便宜但红」",
    apply: (s) => s.replace("const reward = status === \"done\" && evidence !== \"failed\" && evidence !== \"stale\" ? 1 : 0;", "const reward = status === \"done\" ? 1 : 0;"),
    expectFail: "done 但客观证据红 ⇒ bandit 不加分：否则级联越开越学出「便宜但红」的方向",
  },
  {
    id: "bandit-cost-term-zeroed",
    src: "src/agent/orchestrator.ts",
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
  // ---- 静态诊断「没验成」不得折成干净（2026-09-20 零引用扫描分诊，任务 #44 第一条落地）----
  {
    id: "lsp-failure-folded-into-clean",
    src: "src/tools/lsp.ts",
    test: "tests/lsp.test.ts",
    desc: "语言服务器起不来/超时时又回空串 ⇒ 模型把「没验成」读成「没有错误」（写后诊断回流这条能力白装）",
    apply: (s) => s.replace("return lspAbsentNote(root, absPath, serverId === \"\" ? \"unknown\" : serverId, lspFailureReason(err));", "return \"\";"),
    expectFail: "配了 LSP 却没验成 ⇒ 明说「没有静态诊断证据」：沉默会被读成绿灯",
  },
  {
    id: "lsp-internal-protocol-text-leaks-to-model",
    src: "src/tools/lsp.ts",
    test: "tests/lsp.test.ts",
    desc: "缺席原因不再归类 ⇒ 把 jsonrpc 的内部文本（Pending response rejected…/connection got disposed）原样塞进每次写盘的回流，模型读不懂也改不了",
    apply: (s) => s.replace("  if (m.includes(\"connection got disposed\") || m.includes(\"Pending response\")) {", "  if (false) {"),
    expectFail: "配了 LSP 却没验成 ⇒ 明说「没有静态诊断证据」：沉默会被读成绿灯",
  },
  {
    id: "evidence-receipt-reports-known-completeness-as-unknown",
    src: "src/agent/solpi-runtime.ts",
    test: "tests/solpi-receipt-integration.test.ts",
    desc: "收据的完整性回条写死 unknown ⇒ 系统明明把每条引文逐字对过原文却报「不知道」，模型只能白召回一次或重跑同一条命令",
    apply: (s) => s.replace("quotes_verified=${String(receipt.evidence.length)}", "completeness=unknown"),
    expectFail: "restores genuine receipts after two sends and full source on invalidation (observationPack=true)",
  },
  {
    id: "merge-admits-worker-still-in-finish-window",
    src: "src/agent/orchestrator.ts",
    test: "tests/terminal-sync-window.test.ts",
    desc: "合并准入回到只看 finished ⇒ 收尾窗口里 lastFindings 还没填，gate 档被「零条高危」假通过，未扫描的代码被系统代为 commit 并进主树",
    apply: (s) => s.replace("if (!w.terminalResolved) return { ok: false, error: \"worker 尚未收敛（done 后才可合并）\" };", "if (false) return { ok: false, error: \"worker 尚未收敛（done 后才可合并）\" };"),
    expectFail: "收尾窗口里叫合并 ⇒ 拒绝：窗口内 lastFindings 还空着，gate 档会被「无 findings」假通过",
  },
  {
    id: "plan-gate-required-clause-dropped",
    src: "src/permissions/plan-state.ts",
    test: "tests/plan-required.test.ts",
    desc: "摘掉用户武装项 ⇒ 方案门退回「模型自愿交方案才生效」，设置页那个开关成为摆设",
    apply: (s) => s.replace('(state.required || state.proposed) && !state.approved', 'state.proposed && !state.approved'),
    expectFail: "武装即写禁：连 auto 档也拦写向，只读与门工具不受影响",
  },
  {
    id: "plan-gate-required-anded-not-ored",
    src: "src/permissions/plan-state.ts",
    test: "tests/plan-required.test.ts",
    desc: "required 与 proposed 由「或」变「与」⇒ 用户武装但模型还没交方案时不拦，恰好漏掉本功能唯一要拦的那一格",
    apply: (s) => s.replace('state.required || state.proposed', 'state.required && state.proposed'),
    expectFail: "武装即写禁：连 auto 档也拦写向，只读与门工具不受影响",
  },
  {
    id: "plan-run-scope-swallows-required",
    src: "src/permissions/plan-state.ts",
    test: "tests/plan-required.test.ts",
    desc: "run 入口吞掉 required ⇒ 生产路径的武装整条失效（runWithPlanScope 那条只有判卷在用，两条入口必须分别钉住）",
    apply: (s) => s.replace('planScopeALS.enterWith({ state: { required, proposed: false, approved: false } })', 'planScopeALS.enterWith({ state: { required: false, proposed: false, approved: false } })'),
    expectFail: "enterPlanRunScope(true) 武装当前 run；缺省调用回到未武装",
  },
  {
    id: "plan-propose-clears-user-arm",
    src: "src/permissions/plan-state.ts",
    test: "tests/plan-required.test.ts",
    desc: "模型交方案时把 required 一并抹掉 ⇒ 用户的闸能被模型的自愿动作解除",
    apply: (s) => s.replace('setPlanState({ ...currentPlanState(), proposed: true, approved: false });', 'setPlanState({ required: false, proposed: true, approved: false });'),
    expectFail: "模型自己提交方案不得顺手把用户的闸关掉（required 在 markPlanProposed 后保留）",
  },
  {
    id: "plan-live-delegate-default-lost",
    src: "src/permissions/autonomy.ts",
    test: "tests/plan-required.test.ts",
    desc: "构造器缺省从活委托退回常量 false ⇒ worker / 级联那份权限会话又回到「调用方不刷就永不拦」，#52 那条「派生即提权」的旁路复活",
    apply: (s) => s.replace("planBlocked: init.planBlocked ?? planGateLive,", "planBlocked: init.planBlocked ?? (() => false),"),
    expectFail: "worker 用的权限会话默认就带活判据：生产构造器不再需要调用方刷新镜像（#52 旁路的回归闸）",
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
    id: "goal-done-never-fires",
    src: "src/agent/goal.ts",
    test: "tests/goal-stop-decision.test.ts",
    desc: "摘掉「绿证据 ⇒ done」这条唯一放行口 ⇒ 验过也要继续跑到轮次上限（多烧的钱正好是这条能力要省的）",
    apply: (s) => s.replace('if (evidence === "verified") return { kind: "done" };', 'if (false) return { kind: "done" };'),
    expectFail: "evidence=verified ⇒ done，且优先于任何闸（已达成就不该继续花钱，也不该报成超限）",
  },
  {
    id: "goal-turn-cap-removed",
    src: "src/agent/goal.ts",
    test: "tests/goal-stop-decision.test.ts",
    desc: "摘掉轮次上限 ⇒ 自动续跑没有停点（长任务变成无限任务）",
    apply: (s) => s.replace("if (turn >= spec.maxTurns) {", "if (false) {"),
    expectFail: "轮次上限：到点就停，理由带上当前证据态（不许只写「结束」）",
  },
  {
    id: "goal-usd-cap-removed",
    src: "src/agent/goal.ts",
    test: "tests/goal-stop-decision.test.ts",
    desc: "摘掉美元闸 ⇒ 用户设的钱上限只是装饰",
    apply: (s) => s.replace("if (spec.maxUsd > 0 && spentUsd !== null && spentUsd >= spec.maxUsd) {", "if (false) {"),
    expectFail: "美元闸：花到上限即停；**价格不可知时明写闸不生效**，只按轮次闸走",
  },
  {
    id: "goal-price-unknown-silent",
    src: "src/agent/goal.ts",
    test: "tests/goal-stop-decision.test.ts",
    desc: "价格不可知时不再说话 ⇒ 「算不出花了多少」被读成「还没花钱」（把不可知记成免费）",
    apply: (s) => s.replace('if (spentUsd === null) return "花费价格未知 ⇒ 美元闸本次不生效（不把不可知记成免费），只按轮次闸停";', 'if (spentUsd === null) return "";'),
    expectFail: "价格不可知 ⇒ 块里说的是「未知」，不是一个美元数字",
  },
  {
    id: "goal-noop-continue-burns-money",
    src: "src/agent/goal.ts",
    test: "tests/goal-stop-decision.test.ts",
    desc: "摘掉「没写盘也没证据 ⇒ 停」⇒ 读答型目标被自动续跑跑到轮次上限，纯烧钱",
    apply: (s) => s.replace('if (evidence === "absent" && !wrote) {', "if (false) {"),
    expectFail: "无产出可续：既没写过盘也没任何验证证据 ⇒ 停（读答型目标不该被自动续跑烧钱）",
  },
  {
    id: "goal-window-covers-pre-goal-history",
    src: "src/agent/goal.ts",
    test: "tests/goal-continue.test.ts",
    desc: "证据窗口从「本目标之后」放宽成「整段会话」⇒ 上一段工作的绿证据替新目标宣布达成",
    apply: (s) => s.replace("const window = events.slice(trace.at + 1);", "const window = events;"),
    expectFail: "改设目标即重算窗口：绿证据只看最后一条 goal_set 之后（上一段的绿不能替新目标宣布达成）",
  },
  {
    id: "goal-turn-not-counted",
    src: "src/agent/goal-trace.ts",
    test: "tests/goal-continue.test.ts",
    desc: "不数 goal 代发轮 ⇒ turn 恒为 1，轮次闸永不触发（且芯片显示的轮数是假的）",
    apply: (s) => s.replace('if (e.type === "user_message" && e.origin?.kind === "goal") return { ...prev, turn: prev.turn + 1 };', "if (false) return { ...prev, turn: prev.turn + 1 };"),
    expectFail: "轮次 = 1 + goal 代发轮数；人手发的消息不计（那是人在接管）",
  },
  {
    id: "goal-continuation-hook-skipped",
    src: "src/main/agent-runner.ts",
    test: "tests/goal-continue.test.ts",
    desc: "run 尾不再问判据（整条续跑/停止链被旁路）⇒ goal_set 成了只写不读的陈列，理由也从不上屏",
    apply: (s) => s.replace("const next = await goalNextTurn({ logPath, sessionId, unattended: over.unattended === true, aborted: () => over.signal?.aborted === true });", "const next: { message: string; origin: GoalTurnOrigin } | null = null;"),
    expectFail: "设了目标但这一轮没写盘也没验证 ⇒ 立刻停，并落一条写明理由的 goal_stopped（读答型目标不烧钱）",
  },
  {
    id: "goal-continuation-unattended-guard-dropped",
    src: "src/main/agent-runner.ts",
    test: "tests/goal-continue.test.ts",
    desc: "摘掉「无人值守不自动续跑」这道闸 ⇒ 定时任务回到按判据决定续不续：那条路审批全被 fail-closed 拒，写不了盘、验不出绿，却能一路烧到轮次上限",
    apply: (s) => s.replace("  if (args.unattended) {", "  if (false) {"),
    expectFail: "无人值守 run 到点就停且不续跑（#53）：理由点名这条路，且**排在判据之前**",
  },
  {
    id: "goal-usd-gate-price-key-as-model-name",
    src: "src/agent/goal.ts",
    test: "tests/goal-continue.test.ts",
    desc: "美元闸把 settings 里的**模型名**直接当价表键传（价表键是档位 id）⇒ 对产品里可选的每个模型都恒「价格不可知」，闸一次也没触发过；而判据侧单测全绿（它们直接注入 spentUsd）——#54 定名的那处实踩。09-24 反查随美元闸一起从 agent-runner 搬进 goalWindowSpend，针脚跟过去",
    apply: (s) => s.replace("price: priceForModel(sessionPriceModel)", "price: { model: sessionPriceModel }"),
    expectFail: "设 $0.05 上限 × 一轮 200k/20k 用量 ⇒ goal_stopped 点名美元上限（不被轮次/无产出理由顶包）",
  },
  {
    id: "price-for-model-lookup-dropped",
    src: "src/agent/orchestrator-join.ts",
    test: "tests/goal-price.test.ts",
    desc: "反查被摘掉，只认显式传入的档位 id ⇒ 模型名那一态恒不产值表键（worker 未路由时与 goal 续跑两条路一起退回「价格不可知」）",
    apply: (s) => s.replace("const id = pickedId ?? findSpecByNameOrId(table, model)?.id;", "const id = pickedId;"),
    expectFail: "用户在设置里选的那个名字（provider 模型名）逐档都算得出钱",
  },
  {
    id: "goal-usd-window-axis",
    src: "src/agent/goal.ts",
    test: "tests/goal-continue.test.ts",
    desc: "美元闸的计量窗口退回整段会话（证据/写盘看窗口、钱看全量）⇒ 设 $0.5 却因上一段花掉的 $0.6 第一轮就停，用户设的闸成随机数",
    apply: (s) => s.replace("usage: sumWindowUsage(window),", "usage: sumWindowUsage(events),"),
    expectFail: "美元闸的计量窗口 = 本目标之后：设目标之前花掉的钱不许替新目标触发这道闸",
  },
  {
    id: "goal-stopped-flag-ignored",
    src: "src/main/agent-runner.ts",
    test: "tests/goal-continue.test.ts",
    desc: "已停之后还继续判 ⇒ 用户再发一条消息就把自动续跑唤回来，goal_stopped 落第二条（停止不再是终态）",
    apply: (s) => s.replace("if (view === null || view.stopped !== null) return null;", "if (view === null) return null;"),
    expectFail: "停过的目标不会因用户再发一条而自动复活：停止是终态，要再跑得改设目标",
  },
  {
    id: "goal-clear-branch-removed",
    src: "src/main/agent-runner.ts",
    test: "tests/goal-continue.test.ts",
    desc: "清除分支整个摘掉 ⇒ 点「清除」掉进设定分支，报一句 objective 缺失，用户关不掉自动续跑（只能反复按停止）",
    apply: (s) => s.replace("if (req.clear === true) {", "if (false) {"),
    expectFail: "清除目标 = 落一条 goal_stopped（不开新事件、不开新通道）：幂等，且此后不再自动续跑",
  },
  {
    id: "goal-clear-not-idempotent",
    src: "src/main/agent-runner.ts",
    test: "tests/goal-continue.test.ts",
    desc: "已停还补记第二条 goal_stopped ⇒ 审计面上「这个目标停过几次」变成假的（重复点击 = 重复落事实）",
    apply: (s) => s.replace("if (view.stopped !== null) return { ok: true };", "if (false) return { ok: true };"),
    expectFail: "清除目标 = 落一条 goal_stopped（不开新事件、不开新通道）：幂等，且此后不再自动续跑",
  },
  {
    id: "goal-clear-enoesnt-read-as-io-error",
    src: "src/main/agent-runner.ts",
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
    // 这两条补的是「同一句判据的两支」里被漏掉的那一支：panels-check B7 走的是空闲提交
    // （onEvent 在 !real.running 时整段重投，落 showHistory），删掉 live 尾巴那句 syncGoalChip 实测全绿。
    id: "goal-chip-live-tail-not-synced",
    src: "src/renderer/app.js",
    test: "tests/renderer-goal-chip-live.test.ts",
    desc: "renderEvent 那一支只记账不刷芯片 ⇒ 续跑期（real.running 为真，事件全走这支）芯片停在旧读数：goal 模式设完目标看着像没在跑",
    apply: (s) => s.replace("      goalEventsSession = real.id;\n      syncGoalChip();", "      goalEventsSession = real.id;"),
    expectFail: "live 尾巴（续跑期每一轮）：芯片跟着轮次自己变，不等整段重投",
  },
  {
    id: "goal-chip-mirror-counts-replay-events",
    src: "src/renderer/app.js",
    test: "tests/renderer-goal-chip-live.test.ts",
    desc: "丢掉 rc.replay 守卫 ⇒ 重放期每条 goal 事件被镜像二次累加：芯片轮数虚增，而轮数正是轮次闸的读数（显示第 4 轮、判据以为第 2 轮）",
    apply: (s) => s.replace("if (!rc.replay && goalRelevant(e)) {", "if (goalRelevant(e)) {"),
    expectFail: "重放期间不得二次累加镜像（showHistory 已经整段筛过）",
  },
  {
    id: "manual-compact-push-only-never-persisted",
    src: "src/main/agent-runner.ts",
    test: "tests/compact-wiring.test.ts",
    desc: "手动压缩只推不落盘（历史原样）⇒ 压缩卡当场看得见、下一次 run 重放又是全文：花一次摘要的钱换个零效果。演示那条支用会话管线，所以它红着门也绿",
    apply: (s) => s.replace("async (e) => { await log.append(e); hooks.onEvent?.(e); },", "async (e) => { hooks.onEvent?.(e); },"),
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
  {
    id: "memory-panel-delete-keeps-stale-snapshot",
    src: "src/renderer/app.js",
    test: "tests/renderer-memory-panel.test.ts",
    desc: "删完不清不回读 ⇒ 面板留着那一行：告诉用户「它还在」。删除是盘上动作，界面必须以盘上为准",
    apply: (s) => s.replace("    memoryCache = null;\n    await loadMemory(true);", "    void 0;"),
    expectFail: "点删除：按行上的 scope + topic 调桥，成功后清空缓存回读快照并重画",
  },
  {
    id: "memory-panel-rejection-shown-as-success",
    src: "src/renderer/app.js",
    test: "tests/renderer-memory-panel.test.ts",
    desc: "回条 ok:false 也报「已删除」⇒ 用户以为删掉了（记忆是长期态，假成功的代价是下次又读到它）",
    apply: (s) => s.replace("toast(r && r.ok ? '已删除记忆：' + topic : '删除失败：'", "toast('已删除记忆：' + topic || '删除失败：'"),
    expectFail: "主进程拒绝 ⇒ 原话上 toast，并且照样回读（列表以盘上为准）",
  },
  {
    id: "memory-panel-topic-row-loses-scope",
    src: "src/renderer/app.js",
    test: "tests/renderer-memory-panel.test.ts",
    desc: "行上不写 data-scope（写死 project）⇒ 删全局层的条目会去删项目层同名 topic：跨层误删",
    apply: (s) => s.replace("data-scope=\"' + esc(scope)", "data-scope=\"' + \"project\""),
    expectFail: "两层各列自己的 topic：名字 / 类型 / 字节 / 层路径，删除按钮带上 scope 与 topic",
  },
  {
    id: "plugin-panel-cannot-revoke-trust",
    src: "src/renderer/app.js",
    test: "tests/renderer-plugin-panel.test.ts",
    desc: "已信任的插件不再显示「拒绝」⇒ 授权变成一次性门票，用户无法撤回（安全边界上的动作必须可回滚）",
    apply: (s) => s.replace("(trust === 'declined' ? '' : '<button class=\"sched-btn danger\" data-plug-act=\"decline\">拒绝</button>')", "''"),
    expectFail: "授权按钮必须可回滚：待决给两颗，已信任只剩「拒绝」，已拒绝只剩「信任」",
  },
  {
    id: "plugin-panel-decline-reported-as-trust",
    src: "src/renderer/app.js",
    test: "tests/renderer-plugin-panel.test.ts",
    desc: "无论决议结果都报「已信任」⇒ 用户以为拒绝掉的插件没在跑，而它确实不该激活（反向亦然）",
    apply: (s) => s.replace("(trusted ? '已信任：' + name + '（其 skill / 命令 / hook 从此激活）' : '已拒绝：' + name + '（保持不激活）')", "'已信任：' + name + '（其 skill / 命令 / hook 从此激活）'"),
    expectFail: "点「拒绝」不报「已信任」；回条 ok=false 也不报成功，且一律回读",
  },
  {
    id: "plugin-panel-hides-load-errors",
    src: "src/renderer/app.js",
    test: "tests/renderer-plugin-panel.test.ts",
    desc: "不渲染 errors 段 ⇒ 插件装载失败时用户没有任何线索（快照里明明有，界面选择不说）",
    apply: (s) => s.replace("const errs = pluginCache.errors || [];", "const errs = [];"),
    expectFail: "加载错误必须上屏（插件没跑起来时，这是用户唯一的线索）",
  },
  {
    id: "merge-tower-hides-verification-evidence",
    src: "src/renderer/app.js",
    test: "tests/renderer-git-evidence.test.ts",
    desc: "合并控制塔不渲染证据徽标 ⇒ W4b 的四态只活在事件流里，用户看一列 merged 就以为交付验过了（「说验过」与「验过」再一次不分）",
    apply: (s) => s.replace("'<span class=\"tag\" data-ev=\"' + esc(c.verified ?? 'none') + '\">' + esc(workerEvidenceLabel(c.verified)) + '</span>' +", "'' +"),
    expectFail: "每一列都带证据态与花费账，且证据态有机器可查的 data-ev",
  },
  {
    id: "worker-evidence-unknown-said-as-absent",
    src: "src/renderer/projections.ts",
    test: "tests/projections.test.ts",
    desc: "「这一拍没带标记」折成「无验证拍」⇒ 旧会话与机器判出的零验证被说成同一件事（把不可知记成一个已知事实）",
    apply: (s) => s.replace('  return "无回程标记";', '  return "无验证拍";'),
    expectFail: "「没带标记」与「机器判出没有验证拍」是两句话，不许合并",
  },
  {
    id: "worker-price-unknown-rendered-as-zero",
    src: "src/renderer/projections.ts",
    test: "tests/projections.test.ts",
    desc: "价格不可知渲染成 $0.0000 ⇒ 面板上这条 worker 看着没花钱（§4.4.8 的 BYOK 底线：不可知不得记成免费）",
    apply: (s) => s.replace('return spentUsd === null ? "价格未知" : "$" + spentUsd.toFixed(4);', 'return "$" + (spentUsd ?? 0).toFixed(4);'),
    expectFail: "价格不可知说「价格未知」，真话 $0 才写 $0.0000（不可知≠免费）",
  },
  {
    id: "panel-data-drops-agents",
    src: "src/renderer/projections.ts",
    test: "tests/renderer-agents-view.test.ts",
    desc: "projectPanelData 不再返回 agents ⇒ 子智能体页恒空态：投影仍被 agents.test 判绿，产品里却一屏看不见 worker（「能力已发货、产品路径绕过它」的渲染层版本）",
    apply: (s) => s.replace("    agents: projectAgentPanel(events),", "    agents: [],"),
    expectFail: "真实事件流经 projectPanelData 也能长出这一行",
  },
  // ---- 影响面挂到审阅页（#29：能力 1 的可见面；两侧都判——投影一层、行渲染一层）----
  {
    id: "impact-panel-never-attached",
    src: "src/renderer/projections.ts",
    test: "tests/panel-data.test.ts",
    desc: "projectPanelData 算了影响面却不往文件行上挂 ⇒ 单测仍在判那个纯函数绿，面板一屏看不见（本仓第七次「两头断」的渲染层版）",
    apply: (s) => s.replace("...(impacts.has(normRel(d.path)) ? { impact: impacts.get(normRel(d.path)) } : {}),",
      "...(impacts.size < 0 ? { impact: impacts.get(normRel(d.path)) } : {}),"),
    expectFail: "报告汇聚到被改文件：调用点数 + 波及文件数 + 帽标记",
  },
  {
    id: "mount-no-followup-frame",
    src: "src/renderer/history-window.js",
    test: "tests/renderer-history-mount.test.ts",
    desc: "本拍挂了新节点却不续下一拍 ⇒ 新挂的格永远没被测高（测高循环读的是上一拍的节点），changed 恒假、" +
      "窗口停在估算窗。真窗口里表现为偶发「卡片头 8 / 盘上 25 行 / 距底 0px」且不抛异常——" +
      "收敛被押在一个可能不会来的 scroll 事件上（首拍已把 scrollTop 钉到底，app 那句吸底换不来事件）",
    apply: (s) => s.replace("if (changed || mountedNew) schedule();", "if (changed) schedule();"),
    expectFail: "换不来一次 scroll 也必须收敛：挂载自己得续拍（真窗口那条偶发红的机制）",
  },
  {
    id: "null-shell-silent-skip",
    src: "src/renderer/app.js",
    test: "tests/renderer-history-live.test.ts",
    desc: "buildUnit 交不出 .msg 壳时不再 console.error ⇒ 虚拟化只会按 0 高静默跳过那一格，" +
      "事实丢失重新变得无人知晓（崩溃撤掉了，观测者也一起撤了就是另一种回归）",
    apply: (s) => s.replace("console.error('转录单元渲染不出 .msg 壳：'", "void ('转录单元渲染不出 .msg 壳：'"),
    expectFail: "单元渲染不出壳时必须出声：跳过是虚拟化的权利，静默不是",
  },
  {
    id: "per-type-shell-blindspot",
    src: "src/renderer/app.js",
    test: "tests/renderer-run-control.test.ts",
    desc: "通用记录支把某一型提前 break 在卡外 ⇒ 那一型照样落盘、照样成单元，只是永远画不出壳。" +
      "#31 那一族的通用形状（孤儿 tool_result 只是一个实例），逐型样例表是一次覆盖全部注册类型的观测者",
    apply: (s) => s.replace("        finalizePending();\n        appendRecordCard(cardHost(), eventLabel(e), e);",
      "        if (e.type === 'goal_set') break;\n        finalizePending();\n        appendRecordCard(cardHost(), eventLabel(e), e);"),
    expectFail: "每种型单独进流：成了单元就必须有壳，没成单元只许那两型",
  },
  {
    id: "per-type-double-shell",
    src: "src/renderer/app.js",
    test: "tests/renderer-run-control.test.ts",
    desc: "不变量的另一半：孤儿结果那支改成另开一个壳（`openMsg` 顶掉 `cardHost`）⇒ 同一格里长出两个 .msg，" +
      "事实没丢、只是布局被撑高一格——正因它不崩也不少东西，比「零壳」更容易长期无人发现，所以逐格数壳要单独钉",
    apply: (s) => s.replace("appendRecordCard(cardHost(), ok ?",
      "appendRecordCard(openMsg('ai').querySelector('.msg-body'), ok ?"),
    expectFail: "孤儿 tool_result 与重复投递：两份都要有壳，且原文在卡里",
  },
  {
    id: "impact-cause-existence-collapsed",
    src: "src/tools/impact-query.ts",
    test: "tests/impact-query.test.ts",
    desc: "「不在图内」的成因分诊退回一句话：不再分辨「路径下根本没有这个文件」⇒ 模型对一条写错的路径" +
      "收到的是「图外、未知 ≠ 0」，于是它去换查法而不是去 glob，白跑一轮（旧文案就是这个形状）",
    apply: (s) => s.replace("const onDisk = await access(abs).then(() => true, () => false);", "const onDisk = true;"),
    expectFail: "「不在图内」要说清是哪一种：后缀不支持 / 路径没有这个文件，是两条不同的下一步",
  },
  {
    id: "impact-cause-outside-graph-collapsed",
    src: "src/tools/impact-query.ts",
    test: "tests/impact-query.test.ts",
    desc: "第三种成因（文件在盘上、后缀支持、却在图外——实测支配本仓 36 个图外源码文件的那一类）被并回" +
      "「没有文件」那句 ⇒ 真缺席重新变回一句假指引，「未知 ≠ 0」这句也不再出现在模型面前",
    apply: (s) => s.replace("`impact_query: ${rel} 在盘上、后缀受支持，却连候选集都没进 ⇒ 被 .gitignore 规则或噪声目录` +",
      "`impact_query: 该相对路径下没有文件 ⇒ 先 glob 确认（${rel}）` +"),
    expectFail: "文件在盘上、后缀支持、却在图外（噪声目录/帽/忽略规则）⇒ 明说「波及半径未知」而不是「没有调用点」",
  },
  {
    id: "impact-cause-cap-position-collapsed",
    src: "src/tools/impact-query.ts",
    test: "tests/impact-query.test.ts",
    desc: "帽外那一支被并回「快照滞后」那句 ⇒ 模型收到「再问一次即可进图」，而事实是再问一万次它也在帽外" +
      "（本仓实测 36 个文件就是这么消失的）——指错下一步比不说更费轮次",
    apply: (s) => s.replace("  if (pos >= cap) {", "  if (false) {"),
    expectFail: "帽外：报出它在候选集里的位置与本次收录数，并给出两条出路",
  },
  {
    id: "impact-cause-unknown-note-lost",
    src: "src/tools/impact-query.ts",
    test: "tests/impact-query.test.ts",
    desc: "丢掉「分辨不出」那一支 ⇒ 重扫失败也去走「永久排除」/「快照滞后」的具名结论。" +
      "注意这一支的判据在**纯函数**上（把 rg 弄失败又能让文件在盘上的代价不划算）：" +
      "存活的第一版锚点钉的是 .catch 那格，而 .catch 没有任何观测者——换钉法，不撤判据",
    apply: (s) => s.replace("  if (pos === null) {", "  if (false) {"),
    expectFail: "候选集重扫失败 ⇒ 如实说分辨不出，不许假装有结论",
  },
  {
    id: "impact-cause-rescan-failure-claims-permanent",
    src: "src/tools/impact-query.ts",
    test: "tests/impact-query.test.ts",
    desc: "把「扫不动」交回的值从 null 改成 -1 ⇒ 「不确定」在证据上被冒充成「被 .gitignore 永久排除」，" +
      "模型就此放弃等建图、直接换查法。第一版锚点钉在旧的内联 .catch 上当场存活（那格没有观测者），" +
      "所以先把 seam 拆成 graphCandidatePosition 并补正反用例，再回来钉这一格",
    apply: (s) => s.replace("    return null; // 不假装有结论", "    return -1; // 不假装有结论"),
    expectFail: "graphCandidatePosition：扫不动交回 null、扫得到交出候选集下标（正反两面各一次）",
  },
  {
    id: "anchor-duplicate-id-check-lost",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-needles-check.test.ts",
    desc: "锚点 id 唯一性检查被收成恒不命中 ⇒ 表里两条锚点共用一个 id 时门照样报「全部可判定」，" +
      "而 `mutate-verify <id>` 会同时跑两条、报告两行同 id 不同改法（读不出哪条活着）。" +
      "2026-09-23 我往表尾插锚点时真造成过一次，当时秒级门完全没声音",
    apply: (s) => s.replace("return [...seen].filter(([, n]) => n > 1)", "return [...seen].filter(([, n]) => n > 999)"),
    expectFail: "无重复 ⇒ 空数组；成对与三连都各报一次，count 如实",
  },
  {
    id: "mutate-preflight-refusals-dropped",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "整跑前的拒绝名单收成恒空 ⇒ 门又回到「跑到第 k 条才撞上未跟踪源文件」：实测烧掉 19 分钟，" +
      "抛死后账本里连一条读数都不留（pnpm facts 看不见这次跑过）",
    apply: (s) => s.replace('.filter((x) => x.d.kind === "refused")', '.filter((x) => x.d.kind === "never-refused")'),
    expectFail: "未跟踪与在飞的源文件都进名单，并带上是哪一条与为什么",
  },
  {
    id: "mutate-leftover-backup-blind",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "残留备份检查变成恒空 ⇒ 上一次被 kill 的整跑留下的 `.mutbak` 无人报，" +
      "下一次开跑时被 cpSync 直接覆盖——那份「崩溃前的原始内容」是还原正确的唯一凭证",
    apply: (s) => s.replace(".filter((p) => exists(p));", ".filter(() => false);"),
    expectFail: "路径 = 源文件 + .mutbak，且只报盘上真在的那几个",
  },
  {
    id: "facts-run-scope-guessed-as-full",
    src: "scripts/facts.ts",
    test: "tests/facts.test.ts",
    desc: "「旧账本没记范围」被读成整跑 ⇒ 缺字段这种「信息根本没有」的状态冒充出一个结论；" +
      "`--only=` 的调试跑同样会在页头自称整跑（本轮我就是这样把 1 道门读成整跑 0.0 分钟）",
    apply: (s) => s.replace('  if (!s) return "范围未记（旧账本没这个字段）";', '  if (!s) return "整跑 0 道门";'),
    expectFail: "旧账本没有这个字段 ⇒ 如实说没记，不许猜成整跑",
  },
  {
    id: "grep-negative-note-loses-escape-hatch",
    src: "src/tools/grep.ts",
    test: "tests/grep-glob-edit.test.ts",
    desc: "零命中的说明退回一句「本次只扫了未被忽略的文件」——不点名逃生口（显式路径不受忽略规则挡）⇒ " +
      "模型知道扫描面不全，却仍然猜不到下一步该怎么查，只能换 grep 全仓或干脆判定「没有调用方」",
    apply: (s) => s.replace("rgNegativeNote(\"跳过了 .gitignore 里的条目与隐藏文件\")", "\"（本次只扫了未被忽略的文件）\""),
    expectFail: "零命中不许只回三个字：补「这不是仓库里没有」+ 逃生口，且字数有帽",
  },
  {
    id: "glob-negative-note-loses-escape-hatch",
    src: "src/tools/glob.ts",
    test: "tests/grep-glob-edit.test.ts",
    desc: "同一句政策在 glob 那支单独失效（它带 --hidden、另排 .git/node_modules/dist）⇒ 两支共用一个政策句" +
      "不等于两支都在说，只有各钉一条才知道另一支有没有掉队",
    apply: (s) => s.replace("rgNegativeNote(\"跳过了 .gitignore 里的条目与 .git/node_modules/dist\")", "\"（本次跳过 .gitignore 与噪声目录）\""),
    expectFail: "零命中不许只回三个字：补「这不是仓库里没有」+ 逃生口，且字数有帽",
  },
  {
    id: "null-unit-eats-whole-window",
    src: "src/renderer/history-window.js",
    test: "tests/renderer-history-mount.test.ts",
    desc: "某一格 renderUnit 返回 null 时不再跳过而是照旧 node.style.margin ⇒ TypeError 出在 rAF 回调里，" +
      "挂载循环从那一格往前的单元全部不挂（#31 的真根因：贴底却只剩半截转录，且没有一道门报红）",
    apply: (s) => s.replace("        if (!node) { heights[i] = 0; nullUnit = true; continue; }\n", ""),
    expectFail: "某一格渲染不出壳 ⇒ 只许它自己缺席，不许把整窗拖死",
  },
  {
    id: "orphan-tool-result-silent-drop",
    src: "src/renderer/app.js",
    test: "tests/renderer-history-live.test.ts",
    desc: "找不到可并入调用的 tool_result 退回直接 break ⇒ 那条结果从转录里无声消失（重复投递/归因不一致/崩溃少行三种可达），" +
      "并连带让那一格产不出 .msg 壳",
    apply: (s) => s.replace("if (!item) {\n          finalizePending();\n          appendRecordCard(cardHost(), ok ?",
      "if (!item) { break; }\n        if (false) {\n          finalizePending();\n          appendRecordCard(cardHost(), ok ?"),
    expectFail: "孤儿 tool_result 的分支不许静默 break：事实要落成卡，那一格要有壳",
  },
  {
    id: "impact-panel-absent-as-zero",
    src: "src/renderer/projections.ts",
    test: "tests/panel-data.test.ts",
    desc: "没有报告的文件行也写一份 0 ⇒ 设置关着时界面说「这里测过、波及 0 处」，那是假证据不是空态（缺席与 0 必须是两句话）",
    apply: (s) => s.replace("...(impacts.has(normRel(d.path)) ? { impact: impacts.get(normRel(d.path)) } : {}),",
      "...(impacts.has(normRel(d.path)) ? { impact: impacts.get(normRel(d.path)) } : { impact: { sites: 0, files: 0, truncated: false } }),"),
    expectFail: "缺席 ≠ 波及 0：没有 impact_report 时字段必须缺席",
  },
  {
    id: "impact-panel-join-key-not-normalised",
    src: "src/renderer/projections.ts",
    test: "tests/panel-data.test.ts",
    desc: "join 键不归一（三个取料面各留各的原始路径）⇒ `./src/x.ts` 写的文件永远挂不上读数，面板看起来像「从没算过」而事实是键没对上。" +
      "三支一起改：只改一支时另一支仍把数据喂成对得上（第一版就这么存活过——两侧数据同值的经典陷阱）",
    apply: (s) => s
      .replace("...(impacts.has(normRel(d.path)) ? { impact: impacts.get(normRel(d.path)) } : {}),",
        "...(impacts.has(d.path) ? { impact: impacts.get(d.path) } : {}),")
      .replace("files.add(normRel(s.file));", "files.add(s.file);")
      .replace("out.set(normRel(e.file), { sites:", "out.set(e.file, { sites:"),
    expectFail: "join 键归一",
  },
  {
    id: "impact-projection-first-report-wins",
    src: "src/renderer/projections.ts",
    test: "tests/panel-data.test.ts",
    desc: "同一文件多条报告取第一条 ⇒ 面板报的是被推翻的旧读数（改了三轮还给你看第一轮的影响面）",
    apply: (s) => s.replace("    out.set(normRel(e.file), { sites:", "    out.has(normRel(e.file)) || out.set(normRel(e.file), { sites:"),
    expectFail: "同一文件两条报告取最后一条",
  },
  {
    id: "impact-projection-truncated-plus-dropped",
    src: "src/renderer/projections.ts",
    test: "tests/panel-data.test.ts",
    desc: "撞帽标记丢掉 ⇒ 被截到 200 个调用点的符号显示成「波及 200 处」，把下限说成精确数",
    apply: (s) => s.replace('const sites = i.sites + (i.truncated ? "+" : "");', 'const sites = i.sites * 1;'),
    expectFail: "撞限量帽要说成 N+，不能报成精确数",
  },
  {
    id: "impact-projection-sites-counted-as-files",
    src: "src/renderer/projections.ts",
    test: "tests/panel-data.test.ts",
    desc: "调用点数改按去重后的文件数算 ⇒「波及 3 处」被说成 2 处（两个数必须各记各的：同文件多调用点是常见形状）",
    apply: (s) => s.replace("sites: e.up.length, files: files.size", "sites: files.size, files: files.size"),
    expectFail: "报告汇聚到被改文件：调用点数 + 波及文件数 + 帽标记",
  },
  {
    id: "review-row-drops-impact-span",
    src: "src/renderer/app.js",
    test: "tests/renderer-panels-real-data.test.ts",
    desc: "投影算到了但行渲染不挂 ⇒ 审阅页只剩路径与 +行数的老形状，能力 1 那条「这个改动会影响哪里」在界面上又一次隐形",
    apply: (s) => s.replace(`(f.impact ? '<span class="dim" data-impact="'`, `(false ? '<span class="dim" data-impact="'`),
    expectFail: "审阅页那一行真把影响面挂上文件行",
  },
  {
    id: "agents-view-waiting-said-as-running",
    src: "src/renderer/projections.ts",
    test: "tests/renderer-agents-view.test.ts",
    desc: "waiting_approval 投影成「运行中」⇒ 把卡住说成进展：worker 停在审批门等人，用户以为它在干活（长任务的可观测性正损在这一个词上）",
    apply: (s) => s.replace('  if (status === "waiting_approval") return "等人审批";', '  if (status === "waiting_approval") return "运行中";'),
    expectFail: "不与「运行中」混为一谈；未终态时长不写 0.0s",
  },
  {
    id: "agents-view-token-cost-hard-zero",
    src: "src/renderer/app.js",
    test: "tests/renderer-agents-view.test.ts",
    desc: "每 worker 的 token 合计写死成 0 ⇒ 派活的成本在界面上永远是零（能力 9：并行/路由要能在效果和开销之间权衡，前提是每个 worker 的开销可见）",
    apply: (s) => s.replace("String((c.usage ? c.usage.inputTokens + c.usage.outputTokens : 0)) + ' tok · '", "'0' + ' tok · '"),
    expectFail: "状态中文化、token 合计、工具计数、任务与报告",
  },
  {
    id: "worker-approval-raises-card-for-dead-worker",
    src: "src/renderer/projections.ts",
    test: "tests/renderer-worker-approval.test.ts",
    desc: "终态 worker 的未答审批也弹卡 ⇒ 给用户一个必然失败的按钮（§4.4.9 扫成 failed 的那一列早已无处路由）",
    apply: (s) => s.replace('c.status !== "waiting_approval" && c.status !== "waiting_input" && c.status !== "running"', '(c.status as string) === "__never__"'),
    expectFail: "已答的、已死的、主会话的，都不许再弹卡",
  },
  {
    id: "worker-approval-payload-loses-approval-id",
    src: "src/renderer/projections.ts",
    test: "tests/renderer-worker-approval.test.ts",
    desc: "card_action 载荷不写 approval_id ⇒ 主进程退回拿 cardId 当审批 id（「approval:apr-1」查无此审批），用户点了批准而 worker 仍在等",
    apply: (s) => s.replace("payload: { approval_id: ask.askId },", "payload: {},"),
    expectFail: "停在审批门上的 worker 长出一张卡，且载荷指向这条审批本身",
  },
  {
    id: "worker-approval-deny-sends-approve",
    src: "src/renderer/projections.ts",
    test: "tests/renderer-worker-approval.test.ts",
    desc: "拒绝也发 action=approve ⇒ 用户点「拒绝」却把命令放行了（审批门反向 = 权限面上最坏的一种错）",
    apply: (s) => s.replace('action: approved ? "approve" : "reject",', 'action: "approve",'),
    expectFail: "停在审批门上的 worker 长出一张卡，且载荷指向这条审批本身",
  },
  {
    id: "panel-dirty-never-mentions-approval-events",
    src: "src/renderer/projections.ts",
    test: "tests/renderer-worker-approval.test.ts",
    desc: "审批事件不进面板脏集 ⇒ 「写租约相交」那处 approval_requested 不伴随 agent_status，卡要等下一个无关事件才出现（最长等到 120s 自动拒之后）",
    apply: (s) => s.replace('  "approval_requested", "approval_resolved", "diff_comment",\n', ""),
    expectFail: "审批事件在面板脏集里",
  },
  {
    id: "worker-row-offers-cancel-to-every-column",
    src: "src/renderer/projections.ts",
    test: "tests/renderer-agents-view.test.ts",
    desc: "按钮规则退化成「所有列都给取消」⇒ 跑完的、已取消的列上挂一个点了必然失败的按钮（假出口比没有出口更坏：用户以为还能管）",
    apply: (s) => s.replace('col.status === "running" || col.status === "waiting_approval" || col.status === "waiting_input"', 'col.status !== "__never__"'),
    expectFail: "行内按钮只给还能做动作的列",
  },
  {
    id: "worker-respawn-drops-the-write-mode",
    src: "src/agent/recovery.ts",
    test: "tests/renderer-worker-approval.test.ts",
    // 09-24：mode 归一随重派载荷一起从渲染层搬进唯一映射（projections 不再自己造载荷）——
    // 针脚跟着职责搬，不留在原处当恒绿假锚（原针脚 `col.mode === "write"` 已随重构消失）。
    desc: "重派恒按 read 档重起 ⇒ 一个写盘 worker 被重派成只读调研：跑完了什么也写不了，而看着像「按原任务重来了」",
    apply: (s) => s.replace('mode: spawned.mode === "write" ? "write" : "read",', 'mode: "read" as const,'),
    expectFail: "取消发 agent_card/cancel，重派把原 spawn 参数带回 payload.respawn",
  },
  {
    id: "worker-cancel-sends-an-unrouted-action",
    src: "src/renderer/projections.ts",
    test: "tests/renderer-worker-approval.test.ts",
    desc: "取消的 action 名写错 ⇒ card_action 落流后走到 handleCardAction 末尾的 return {ok:true}：用户看到「已请求取消」而 worker 继续跑、继续花钱",
    apply: (s) => s.replace("    targetAgentId: col.agent_id,\n    action,\n  };", "    targetAgentId: col.agent_id,\n    action: action === \"cancel\" ? (\"stop\" as typeof action) : action,\n  };"),
    expectFail: "取消发 agent_card/cancel，重派把原 spawn 参数带回 payload.respawn",
  },
  {
    id: "worker-row-offers-resume-to-any-waiting-input",
    src: "src/renderer/projections.ts",
    test: "tests/renderer-agents-view.test.ts",
    desc: "把「等人回答」一律当成卡死并给「继续」⇒ resumeAgent 对非 stuck 的 worker 返回 false，用户点下去只得到一句「无卡死态」（把两种等待混为一谈＝把没那个状态说成有）",
    apply: (s) => s.replace('col.status === "waiting_input" && col.reason === "stuck"', 'col.status === "waiting_input"'),
    expectFail: "卡死那一列给「继续」并留「取消」",
  },
  {
    id: "worker-resume-sends-an-unrouted-action-name",
    src: "src/renderer/projections.ts",
    test: "tests/renderer-worker-approval.test.ts",
    desc: "继续的 action 名不是 resume ⇒ card_action 落流后落到 handleCardAction 末尾的 return {ok:true}：暂停闸没人解，worker 停在原地而界面报「已请求继续」（花钱不等于在干活）",
    apply: (s) => s.replace("    targetAgentId: col.agent_id,\n    action,\n  };", "    targetAgentId: col.agent_id,\n    action: action === \"resume\" ? (\"continue\" as typeof action) : action,\n  };"),
    expectFail: "重派把原 spawn 参数带回 payload.respawn",
  },
  {
    id: "skip-reason-shown-as-raw-token",
    src: "src/renderer/app.js",
    test: "tests/renderer-skip-reason.test.ts",
    desc: "跳过一行的标题退回原始 token（overlap）⇒ 无人值守任务为什么没跑，用户仍得展开卡片读 JSON（§12.2.6 承诺的中文标签又一次只落在代码里）",
    apply: (s) => s.replace("return base + '：' + nm + skipReasonLabel(e.reason);", "return base + '：' + nm + String(e.reason);"),
    expectFail: "跳过一行的标题说清是哪条任务、为什么跳过",
  },
  {
    id: "empty-panel-shape-missing-a-field",
    src: "src/renderer/projections.ts",
    test: "tests/renderer-skip-reason.test.ts",
    desc: "PanelData 加了字段而 EMPTY_PANEL_DATA 没跟上 ⇒ 空态与投影形状分叉，渲染层按 undefined 索引就整块空掉（历史上加 agents 就得同时改两处）",
    apply: (s) => s.replace("terminal: [], merge: [], agents: [] };", "terminal: [], merge: [] };"),
    expectFail: "空态面板形状 = 投影形状",
  },
  {
    id: "automation-failed-still-titled-completed",
    src: "src/renderer/app.js",
    test: "tests/renderer-skip-reason.test.ts",
    desc: "无人值守的一次运行不看 status 一律写「完成」⇒ 夜里跑砸了的定时任务在时间线上看着像成功（§12.2 完成回写的全部信息量被抹平）",
    apply: (s) => s.replace("const failed = e.status === 'failed';", "const failed = false;"),
    expectFail: "无人值守的一次运行：失败不顶着「完成」",
  },
  {
    id: "automation-run-title-loses-task-name",
    src: "src/renderer/app.js",
    test: "tests/renderer-skip-reason.test.ts",
    desc: "标题不写是哪条任务 ⇒ 多条自动化并存时，用户无法判断哪条没跑、哪条砸了（事件里有 task_name 却不显示，属「只推不落」的读端版）",
    apply: (s) => s.replace("(failed ? '定时任务失败：' : '定时任务完成：') + nm + why;", "(failed ? '定时任务失败：' : '定时任务完成：') + why;"),
    expectFail: "无人值守的一次运行：失败不顶着「完成」",
  },
  {
    id: "tz-note-emitted-for-every-task",
    src: "src/main/scheduler.ts",
    test: "tests/schedule-timezone-note.test.ts",
    desc: "时区注记不再只在两值不同时给 ⇒ 每条任务都挂一句「本机/规则同一个时区」的废话，真需要提示的那条被淹掉（提示的可信度靠稀疏维持）",
    apply: (s) => s.replace("} else if (norm !== sysTz) {", "} else {"),
    expectFail: "只有时区与本机不同（或声明值非法）才给注记",
  },
  {
    id: "tz-note-computed-but-never-rendered",
    src: "src/renderer/app.js",
    test: "tests/schedule-timezone-note.test.ts",
    desc: "快照算好了注记而面板不打印 ⇒ 又一份「main 有字段、界面看不见」（timeZoneOffsetLabel 此前正是这样当了整轮孤儿）",
    apply: (s) => s.replace("esc(scheduleCache.tzNotes[t.id])", "''"),
    expectFail: "注记上屏：面板不会算完就丢",
  },
  // ---- 新建定时任务的表单面（#62）：形状映射、白名单、回条，一条都不能是摆设 ----
  {
    id: "sched-form-bypasses-the-kind-whitelist",
    src: "src/renderer/app.js",
    test: "tests/renderer-schedule-form.test.ts",
    desc: "提交时 form=false ⇒ 界面虽然只列四种 kind，主进程的表单白名单这道闸一次也没判过；表单与工具两条路从此不同闸（§12.2.1「表单只暴露四 kind」只剩下拉框的自觉）",
    apply: (s) => s.replace("api.scheduleUpsert(schedFormPayload(fields), true)", "api.scheduleUpsert(schedFormPayload(fields), false)"),
    expectFail: "提交带 form=true",
  },
  {
    id: "sched-form-rejection-reported-as-success",
    src: "src/renderer/app.js",
    test: "tests/renderer-schedule-form.test.ts",
    desc: "只判 !r 不判 r.ok ⇒ 主进程把拒因写进回条而界面报「已创建」，用户以为任务设好了，其实盘上一条也没有（定时任务的失败天生无人值守，没人会当场发现）",
    apply: (s) => s.replace("if (!r || r.ok !== true) {\n          const msg = (r && r.error) || '未知原因';", "if (!r) {\n          const msg = (r && r.error) || '未知原因';"),
    expectFail: "被拒不报成功",
  },
  {
    id: "sched-form-inserts-its-own-row",
    src: "src/renderer/app.js",
    test: "tests/renderer-schedule-form.test.ts",
    desc: "创建成功后不丢开缓存回读快照 ⇒ 面板那份列表由渲染层自己插一行：main 生成的 id/nextRunAt/时区都不在屏幕上，列表成了第二份事实源",
    apply: (s) => s.replace("scheduleCache = null; // 列表一律回读快照", "void 0; // 列表一律回读快照"),
    expectFail: "创建成功后回读快照重画，本地不插一行",
  },
  {
    id: "sched-empty-state-back-to-todo-copy",
    src: "src/renderer/app.js",
    test: "tests/renderer-schedule-form.test.ts",
    desc: "空态退回「创建入口后续接…」⇒ 入口明明做好了却还告诉用户没有；留位文案一旦过期就是最便宜也最常见的假红源",
    apply: (s) => s.replace("用输入框下方的「定时任务」芯片新建", "创建入口后续接 scheduleUpsert 表单白名单"),
    expectFail: "空态不再写「后续接」",
  },
  {
    id: "sched-daily-row-reads-a-field-main-never-writes",
    src: "src/renderer/app.js",
    test: "tests/renderer-schedule-form.test.ts",
    desc: "daily 行读 sc.at（main 存的是 sc.time）⇒ 面板写「每天 」空尾巴：任务到底几点跑，屏幕上看不出来。这条正是本锚点落地前产品里的真状态",
    apply: (s) => s.replace("if (sc.kind === 'daily') return '每天 ' + hhmm(sc.time);", "if (sc.kind === 'daily') return '每天 ' + hhmm(sc.at);"),
    expectFail: "每天/每周把时刻与日子写在行上",
  },
  {
    id: "sched-weekly-row-drops-days-and-time",
    src: "src/renderer/app.js",
    test: "tests/renderer-schedule-form.test.ts",
    desc: "weekly 行只写「每周」丢掉日子与时刻 ⇒ 用户设的「周一三五 07:30」在列表里塌成「每周」，多条周任务长得一模一样",
    apply: (s) => s.replace("if (sc.kind === 'weekly') return '每周 ' + (sc.weekdays || []).map(d => WEEKDAY_CN[d] ?? '?').join('、') + ' ' + hhmm(sc.time);", "if (sc.kind === 'weekly') return '每周';"),
    expectFail: "每天/每周把时刻与日子写在行上",
  },
  {
    id: "sched-interval-empty-collapses-to-zero",
    src: "src/renderer/projections.ts",
    test: "tests/renderer-schedule-form.test.ts",
    desc: "留空的分钟数直接 Number('') === 0 ⇒ 载荷带着 everyMinutes=0；main 若哪天把下限挪位，就是一条每 0 分钟触发的任务（每次都花真钱）",
    apply: (s) => s.replace("f.everyMinutes.trim() === \"\" ? undefined : Number(f.everyMinutes)", "Number(f.everyMinutes)"),
    expectFail: "留空不等于 0",
  },
  {
    id: "sched-form-kinds-drift-from-mains-whitelist",
    src: "src/renderer/projections.ts",
    test: "tests/renderer-schedule-form.test.ts",
    desc: "渲染层自己往四 kind 里加一种 ⇒ 表单出现 main 拒收的种类，用户每次提交都被打回（两份清单必然漂移，对表就是为了让它漂不了）",
    apply: (s) => s.replace("export const SCHED_FORM_KINDS = [\"once\", \"interval\", \"daily\", \"weekly\"] as const;", "export const SCHED_FORM_KINDS = [\"once\", \"interval\", \"daily\", \"weekly\", \"hourly\"] as const;"),
    expectFail: "种类清单与 main 的 FORM_KINDS 逐字同集",
  },
  {
    id: "sched-default-kind-picked-by-taste-not-by-cost",
    src: "src/renderer/app.js",
    test: "tests/renderer-schedule-form.test.ts",
    desc: "缺省种类从「跑一次的 once」改成会循环的 interval ⇒ 用户没动过下拉框就设下一条反复触发的任务；缺省值该站在最便宜那一侧",
    apply: (s) => s.replace("'<form class=\"goal-form sched-form\" data-kind=\"' + esc(SCHED_FORM_KINDS[0]) + '\">'", "'<form class=\"goal-form sched-form\" data-kind=\"interval\">'"),
    expectFail: "表单只开 main 的四种种类，缺省选中最便宜的 once",
  },
  {
    id: "sched-toggle-revalidated-against-form-kinds",
    src: "src/renderer/app.js",
    test: "tests/renderer-schedule-form.test.ts",
    desc: "只改 enabled 开关也带 form=true ⇒ 已存在的 hourly/monthly/custom 任务（工具面或旧数据）再也关不掉：想停用一条危险任务的人被白名单挡在门外",
    apply: (s) => s.replace("r = await api.scheduleUpsert({ ...task, enabled: !task.enabled }, false);", "r = await api.scheduleUpsert({ ...task, enabled: !task.enabled }, true);"),
    expectFail: "停用/启用不被表单白名单二次审判",
  },
  {
    id: "sched-row-action-swallow-the-reply",
    src: "src/renderer/app.js",
    test: "tests/renderer-schedule-form.test.ts",
    desc: "run/del 的回条不判 ⇒ 点「删除」失败照样弹「已删除」，行在下一轮回读后又长回来；用户以为删掉了，任务继续按天花钱",
    apply: (s) => s.replace("if (r && r.ok === false) toast('未执行：' + (r.error || '未知原因'));", "if (false) toast('未执行：');"),
    expectFail: "立即运行/删除：ok=false 不许报成功",
  },
  // ---- 运行历史六态筛选（§12.2.6）：筛在 main，界面只存「选了哪个状态」这一份 UI 态 ----
  {
    id: "sched-history-filter-is-a-dummy-control",
    src: "src/renderer/app.js",
    test: "tests/renderer-schedule-history.test.ts",
    desc: "要快照时恒传 all ⇒ 下拉能选、选完什么也不变：一个只会自我安慰的控件比没有控件更坏（用户以为已经筛过了）",
    apply: (s) => s.replace("api.scheduleSnapshot(schedHistFilter)", "api.scheduleSnapshot('all')"),
    expectFail: "要快照时把当前筛选值递过去",
  },
  {
    id: "snapshot-ignores-the-history-filter",
    src: "src/main/scheduler.ts",
    test: "tests/schedule.test.ts",
    desc: "收到筛选值却不筛、回全量 ⇒ 段头写着「只看 失败」而列表里躺着成功与跳过：标签与内容相反，用户按错的名单判断哪条任务健康",
    apply: (s) => s.replace("history: Scheduler.filterHistory(history, historyFilter),", "history,"),
    expectFail: "snapshot(状态) 真按状态筛",
  },
  {
    id: "history-row-prints-the-raw-state-token",
    src: "src/renderer/app.js",
    test: "tests/renderer-schedule-history.test.ts",
    desc: "行上退回印 succeeded / skipped ⇒ §12.2.6 承诺的「给人读的运行历史」又回到机器 token（同一族的 skipReasonLabel 已栽过一次）",
    apply: (s) => s.replace("esc(HISTORY_STATE_LABELS[h.state] ?? h.state)", "esc(h.state)"),
    expectFail: "行上写中文状态、段头带筛选下拉且当前值选中",
  },
  {
    id: "sched-filter-refilters-the-stale-window",
    src: "src/renderer/app.js",
    test: "tests/renderer-schedule-history.test.ts",
    desc: "换筛选不清缓存、直接在本地那份上滤 ⇒ 只有最近 12 条参与，某状态整段落在窗口外时显示「没有记录」：假空，而 main 的筛选成了摆设",
    apply: (s) => s.replace("    scheduleCache = null;\n    await loadSchedule(true);", "    await loadSchedule(true);"),
    expectFail: "换筛选 = 丢开缓存 + 重新要快照 + 重画",
  },
  {
    id: "sched-filter-accepts-any-string",
    src: "src/renderer/app.js",
    test: "tests/renderer-schedule-history.test.ts",
    desc: "界面态收下任意字符串 ⇒ 一个认不出的值让段头写「只看 undefined」，筛选器与清单各说各话（筛选值必须落在同一份 HISTORY_STATES 里）",
    apply: (s) => s.replace("if (typeof v !== 'string' || !HISTORY_STATES.includes(v) || v === schedHistFilter) return;", "if (typeof v !== 'string' || v === schedHistFilter) return;"),
    expectFail: "换筛选 = 丢开缓存 + 重新要快照 + 重画",
  },
  {
    id: "unknown-history-filter-becomes-a-real-state",
    src: "src/main/scheduler.ts",
    test: "tests/schedule.test.ts",
    desc: "跨进程来的未知值不归一、直接当筛选值用 ⇒ 拼错或被改的输入筛出一片空记录：假空比填空更坏，用户会以为任务从没跑过",
    apply: (s) => s.replace("(HISTORY_FILTERS as readonly string[]).includes(raw)", "true"),
    expectFail: "snapshot(状态) 真按状态筛",
  },
  {
    id: "sched-filter-lists-drift-from-main",
    src: "src/renderer/projections.ts",
    test: "tests/renderer-schedule-history.test.ts",
    desc: "渲染层往筛选清单里多加一项 ⇒ 下拉出现 main 不认的状态，选中它要么被静默归一要么筛出空（两份清单必然漂移，与 FORM_KINDS 同一条规矩）",
    apply: (s) => s.replace("\"skipped\", \"cancelled\"] as const;", "\"skipped\", \"cancelled\", \"expired\"] as const;"),
    expectFail: "筛选值清单与 main 的 HISTORY_FILTERS 逐字同集",
  },
  // ---- git 面板的评审读端（#25 补齐）：面板那一列 = 合并控制塔的列本身 ----
  {
    id: "merge-panel-trims-the-column-again",
    src: "src/renderer/projections.ts",
    test: "tests/renderer-merge-review.test.ts",
    desc: "把列重新裁成 6 字段 ⇒ 补丁 / 安全发现 / 评论又到不了界面（投影算得出来、屏幕一片空白，正是本仓最贵的那族缺陷）",
    apply: (s) => s.replace(
      "merge: projectMergeTower(events),",
      "merge: projectMergeTower(events).map((c) => ({ agent_id: c.agent_id, task: c.task, status: c.status, outcome: c.outcome, verified: c.verified, spentUsd: c.spentUsd })),",
    ),
    expectFail: "补丁快照给的是最新那份",
  },
  {
    id: "merge-panel-shows-the-overridden-patch",
    src: "src/renderer/app.js",
    test: "tests/renderer-merge-review.test.ts",
    desc: "取 diffs[0] ⇒ 评审闭环 v1→v2 里给用户看的是已被推翻的那版：审的是旧代码，改回来的却是新代码",
    apply: (s) => s.replace("c.diffs[c.diffs.length - 1]", "c.diffs[0]"),
    expectFail: "补丁快照给的是最新那份",
  },
  {
    id: "merge-panel-lists-no-findings",
    src: "src/renderer/app.js",
    test: "tests/renderer-merge-review.test.ts",
    desc: "发现项一律截成 0 条（汇总数字还在）⇒ 用户看到「安全报告 2 项」却一条也点不到，只能自己去翻代码",
    apply: (s) => s.replace("rep.findings.slice(0, 8).map(", "rep.findings.slice(0, 0).map("),
    expectFail: "安全报告：汇总数、逐项 path:line 与「模型未复核」都上屏",
  },
  {
    id: "merge-panel-claims-llm-reviewed",
    src: "src/renderer/app.js",
    test: "tests/renderer-merge-review.test.ts",
    desc: "复核标记不看 rep.llmReviewed 一律写「模型已复核」⇒ 把「只有规则扫过」说成「模型看过」，正是本仓最忌的把不可知记成已知",
    apply: (s) => s.replace("(rep.llmReviewed ? '模型已复核' : '仅规则扫描（模型未复核）')", "'模型已复核'"),
    expectFail: "安全报告：汇总数、逐项 path:line 与「模型未复核」都上屏",
  },
  {
    id: "merge-panel-drops-review-comments",
    src: "src/renderer/app.js",
    test: "tests/renderer-merge-review.test.ts",
    desc: "评论不上屏 ⇒ 用户写完评审不知道有没有送达、diff_comment 事件成了只写不读的账",
    apply: (s) => s.replace("c.comments.slice(0, 20).map(", "c.comments.slice(0, 0).map("),
    expectFail: "行级评论投影上屏",
  },
  {
    id: "merge-panel-bound-count-never-advertised",
    src: "src/renderer/app.js",
    test: "tests/renderer-merge-review.test.ts",
    desc: "截断后不说「另有 N 条」⇒ 界面把「我们只画了 8 条」演成「一共就 8 条」，有界性必须自带诚实说明",
    apply: (s) => s.replace("String(rep.findings.length - 8)", '"0"'),
    expectFail: "长列表有界",
  },
  {
    id: "merge-empty-state-claims-panel-unwired",
    src: "src/renderer/app.js",
    test: "tests/renderer-merge-review.test.ts",
    desc: "空态退回「Git 面板尚未接入」⇒ 读端已通却告诉用户没有面板；过期留位文案是最便宜也最常见的假绿源",
    apply: (s) => s.replace("本会话没有 write worker", "Git 面板尚未接入"),
    expectFail: "空态文案不再谎称「面板尚未接入」",
  },
  // ---- 行级评审写端（#59 第四条动作 comment）----
  {
    id: "patch-segment-path-ignores-plus-side",
    src: "src/renderer/projections.ts",
    test: "tests/renderer-line-comment-write.test.ts",
    desc: "改名时不用 +++ 侧覆盖 path ⇒ 评论挂到旧路径上，main 原样注入 worker（它只判 path 非空）",
    apply: (s) => s.replace("cur.path = plus[1];", "cur.path = cur.path;"),
    expectFail: "两份文件头不一致时以 +++ 为准",
  },
  {
    id: "patch-segment-invents-filename-for-bare-hunk",
    src: "src/renderer/projections.ts",
    test: "tests/renderer-line-comment-write.test.ts",
    desc: "没有文件头的 hunk 被安上一个假文件名 ⇒ 界面给一条无名补丁长出评论入口，坐标是编的",
    apply: (s) => s.replace('cur = open("");', 'cur = open("unknown.ts");'),
    expectFail: "光秃秃的 hunk（没有文件头）成一段空 path",
  },
  {
    id: "comment-action-name-drifts",
    src: "src/renderer/projections.ts",
    test: "tests/renderer-line-comment-write.test.ts",
    desc: "action 名写错一字 ⇒ main 的 comment 分支永不命中，动作静默落成一条无人路由的 card_action",
    apply: (s) => s.replace('action: "comment",', 'action: "review_comment",'),
    expectFail: "cardActionForComment 组出 main 要的四面",
  },
  {
    id: "comment-reply-ok-false-treated-as-delivered",
    src: "src/renderer/app.js",
    test: "tests/renderer-line-comment-write.test.ts",
    desc: "只判 !r 不判 r.ok ⇒ main 的拒绝被当成功，评审意见蒸发而界面一声不响",
    apply: (s) => s.replace("if (!r || r.ok !== true) { cmtFail(", "if (!r) { cmtFail("),
    expectFail: "main 拒（ok:false）⇒ 判因原样回显成未送达",
  },
  {
    id: "comment-injected-false-claims-delivered",
    src: "src/renderer/app.js",
    test: "tests/renderer-line-comment-write.test.ts",
    desc: "injected:false（只落流、worker 已不再读）被说成「已送进子流」⇒ 把没送达说成送达",
    apply: (s) => s.replace("r.injected === false", "r.injected === undefined"),
    expectFail: "injected=false ⇒ 说「只落进事件流、它已不再读」",
  },
  {
    id: "comment-anchor-accepts-line-zero",
    src: "src/renderer/app.js",
    test: "tests/renderer-line-comment-write.test.ts",
    desc: "行号只判整数不判 ≥1 ⇒ 弹出一个必然被 main 拒的框，用户白填一段意见",
    apply: (s) => s.replace("!Number.isInteger(line) || line < 1", "!Number.isInteger(line)"),
    expectFail: "行号不是整数 ⇒ 同样不弹",
  },
  {
    id: "git-panel-drops-anchor-mode",
    src: "src/renderer/app.js",
    test: "tests/renderer-merge-review.test.ts",
    desc: "补丁不再要 anchors 形态 ⇒ 行号与「评」整片消失，而读端看着一切正常（写端入口没了）",
    apply: (s) => s.replace(", { anchors: true, comment: canReview })", ")"),
    expectFail: "补丁按 anchors 形态着色",
  },
  {
    id: "diff-comment-missing-from-panel-dirty-set",
    src: "src/renderer/projections.ts",
    test: "tests/renderer-line-comment-write.test.ts",
    desc: "脏集漏掉 diff_comment ⇒ 送出去的评论要等下一个无关事件才上屏，甚至永远等不到",
    apply: (s) => s.replace('"approval_resolved", "diff_comment",', '"approval_resolved",'),
    expectFail: "diff_comment 在面板脏集里",
  },
  // ---- 面板重绘的用户态保全（4dd11d6）----
  {
    id: "panel-state-reads-attribute-not-live-property",
    src: "src/renderer/app.js",
    test: "tests/renderer-panel-state.test.ts",
    desc: "抓展开态去读 hasAttribute('open') ⇒ 用户手点开的从不改属性，等于什么都没抓到（静默恒空集）",
    apply: (s) => s.replace("if (d.open) opened.push(i)", "if (d.hasAttribute('open')) opened.push(i)"),
    expectFail: "抓到的是用户实时展开的那几项",
  },
  {
    id: "panel-state-restore-crashes-on-shorter-list",
    src: "src/renderer/app.js",
    test: "tests/renderer-panel-state.test.ts",
    desc: "恢复时不判越界 ⇒ 重绘后折叠块变少（worker 列被撤）就在渲染中途抛，整块面板挂",
    apply: (s) => s.replace("const d = list[i]; if (d) d.open = true;", "list[i].open = true;"),
    expectFail: "重绘后折叠块变少",
  },
  {
    id: "render-side-rewrites-without-restoring",
    src: "src/renderer/app.js",
    test: "tests/renderer-panel-state.test.ts",
    desc: "抓了不还原：重写照旧 innerHTML 全写，补丁照样塌回去（这一对里只剩一半 = 装饰性代码）",
    apply: (s) => s.replace("restorePanelState(section, kept);", ";"),
    expectFail: "renderSide 的重写分支成对使用这一对",
  },
  {
    id: "render-side-captures-nothing",
    src: "src/renderer/app.js",
    test: "tests/renderer-panel-state.test.ts",
    desc: "压根没抓（快照恒 null）⇒ restore 走空返回，界面回到默认折叠——与「没做」完全等价",
    apply: (s) => s.replace("const kept = capturePanelState(section);", "const kept = null;"),
    expectFail: "renderSide 的重写分支成对使用这一对",
  },
  // ---- 已收尾那一列不给评论入口（f83abe3）----
  {
    id: "dead-column-rule-forgets-rejected-and-cleaned",
    src: "src/renderer/projections.ts",
    test: "tests/renderer-line-comment-write.test.ts",
    desc: "收尾三态只认出 merged ⇒ rejected / cleaned 那一列仍长出一个必然失败的「送给它」",
    apply: (s) => s.replace('outcome !== "merged" && outcome !== "rejected" && outcome !== "cleaned"', 'outcome !== "merged"'),
    expectFail: "commentReadsBack：只有工作树已收尾的三态读不到",
  },
  {
    id: "git-panel-ignores-dead-column-rule",
    src: "src/renderer/app.js",
    test: "tests/renderer-merge-review.test.ts",
    desc: "规则写好了但界面不查（恒给入口）⇒ 与「没做」一字不差，而投影侧的单测仍是绿的",
    apply: (s) => s.replace("const canReview = commentReadsBack(c.outcome);", "const canReview = true;"),
    expectFail: "合并决策已定（merged / rejected / cleaned）",
  },
  {
    id: "git-panel-drops-comment-option",
    src: "src/renderer/app.js",
    test: "tests/renderer-merge-review.test.ts",
    desc: "不把 canReview 递给着色器 ⇒ 判定算了但没用上，已收尾那一列照旧长按钮",
    apply: (s) => s.replace("{ anchors: true, comment: canReview }", "{ anchors: true }"),
    expectFail: "合并决策已定（merged / rejected / cleaned）",
  },
  {
    id: "dead-column-hint-drops-the-way-out",
    src: "src/renderer/app.js",
    test: "tests/renderer-merge-review.test.ts",
    desc: "只说「读不到」不说出路 ⇒ 用户看见一句判决却没有下一步（撤入口必须同时给路）",
    apply: (s) => s.replace("要改就按原任务重派一列。", "。"),
    expectFail: "合并决策已定（merged / rejected / cleaned）",
  },
  // ---- 已知字段名单由契约导出（606fe7f）----
  {
    id: "manifest-field-list-forgot-notes-again",
    src: "src/main/updater.ts",
    test: "tests/updater.test.ts",
    desc: "名单与 interface 分家的标准下场：notes 没进填满式 Record ⇒ 合法 manifest 被判「未知字段」整条拒收",
    apply: (s) => s.replace("{ version: true, url: true, notes: true };", "{ version: true, url: true };"),
    expectFail: "checkUpdate：有新版 → available",
  },
  {
    id: "lsp-known-fields-forgot-diagnostics",
    src: "src/agent/plugins/types.ts",
    test: "tests/plugins-discover.test.ts",
    desc: "契约导出的名单少一个键 ⇒ 插件里合法配的 diagnostics 被报成未知字段（警告面替用户撒谎）",
    apply: (s) => s.replace("  diagnostics: true,\n", ""),
    expectFail: ".lsp.json 字段名向 CC 对齐",
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
  // ---- 残留工作树从盘上到屏上（39d76bc）----
  {
    id: "orphan-zero-state-drops-its-source-key",
    src: "src/renderer/app.js",
    test: "tests/renderer-orphan-worktrees.test.ts",
    desc: "「确实没有」那一支丢掉 data-wt ⇒ 屏上文案还在，但再也分不开「写没有」与「压根没读」",
    apply: (s) => s.replace("<div class=\"wt-orphan\" data-wt=\"0\">本机没有残留工作树", "<div class=\"wt-orphan\">本机没有残留工作树"),
    expectFail: "没数过就一句都不写",
  },
  {
    id: "orphan-count-failure-silenced-as-none",
    src: "src/renderer/app.js",
    test: "tests/renderer-orphan-worktrees.test.ts",
    desc: "数不出来被并给「没数过」那一支 ⇒ 假空：扫描失败静默长成「本机没有残留工作树」",
    apply: (s) => s.replace("  if (!orphanWorktrees) return '';", "  if (!orphanWorktrees || !orphanWorktrees.orphans) return '';"),
    expectFail: "数不出来就说数不出来",
  },
  {
    id: "orphan-block-gets-a-clean-button",
    src: "src/renderer/app.js",
    test: "tests/renderer-orphan-worktrees.test.ts",
    desc: "给未裁决的清理动作长出一个按钮（清理 = 连 agent/*- 分支一起 branch -D 且不判是否已合并）",
    apply: (s) => s.replace("<p class=\"mc-hint\">界面上不给清理按钮", "<p class=\"mc-hint\"><button data-act=\"wt-clean\">清理</button>界面上不给清理按钮"),
    expectFail: "且一个按钮也不给",
  },
  {
    id: "orphan-block-wired-into-one-path-only",
    src: "src/renderer/app.js",
    test: "tests/renderer-orphan-worktrees.test.ts",
    desc: "只接列表态、空态漏接 ⇒ 会话没派过 write worker 时（恰恰是最需要看见残留的一刻）这一段永远不出现",
    apply: (s) => s.replace("orphanBlockHTML() +\n", "\"\" +\n"),
    expectFail: "gitViewHTML 的两条返回路径都带上这一段",
  },
  // ---- 原子写收口（5ed68bf）：临时名唯一性 = 同进程并发写不撞名 ----
  {
    id: "atomic-tmp-name-not-unique-per-process",
    src: "src/atomic-write.ts",
    test: "tests/bandit-runtime.test.ts",
    desc: "退回「pid + 毫秒」：同进程同一毫秒的两笔写算出同一个临时名，先 rename 的搬走文件、后 rename 的抛 ENOENT（学习面静默丢）",
    apply: (s) => s.replace("  seq += 1;\n", ""),
    expectFail: "同一毫秒 24 笔 saveBanditState",
  },
  {
    id: "atomic-write-leaves-tmp-on-failure",
    src: "src/atomic-write.ts",
    test: "tests/secrets.test.ts",
    desc: "rename 失败不清理临时文件 ⇒ 崩溃残留堆在插件数据目录里，且下一次「写入中断自愈」清的是别人的名字",
    apply: (s) => s.replace("    await unlink(tmp).catch(() => {});\n", ""),
    expectFail: "写失败时 tmp 被清理，且不截断既有密文存储",
  },
  {
    // 分辨力在 HEAD 的隔离 worktree 里实测过（另一会话占着写窗口，本轮不在主树跑本工具）：
    // 去掉 injected 一位后回条变成 {ok:true}，新判据当场红在「未收尾的 worker：评论应真的进子流」。
    id: "card-action-comment-drops-injected",
    src: "src/main/agent-runner.ts",
    test: "tests/m3b.test.ts",
    desc: "IPC 回条把 injected 吞掉（= 曾经的样子）⇒ 界面只剩「已送进子流」可说，把没送达说成送达",
    apply: (s) => s.replace(
      'return { ok: true, injected: r.injected, ...(r.injected || !r.error ? {} : { error: r.error }) };',
      'return { ok: true, ...(r.injected || !r.error ? {} : { error: r.error }) };',
    ),
    expectFail: "IPC 回条带得出 injected（映射行有观测者）",
  },
  /* ── 辅助对话面板（§10.8，10fece3）：形状由 vm 切片判，八条各钉一个「看得见但说谎」的落点 ── */
  {
    id: "sc-promote-anchor-drops-event-id",
    src: "src/renderer/app.js",
    test: "tests/renderer-sidechat-view.test.ts",
    desc: "「提升」按钮不带 data-sc-ev ⇒ 点得动却送不出坐标：提升哪一条旁路消息，界面自己也不知道",
    apply: (s) => s.replace("data-sc-act=\"promote\" data-sc-ev=\"' + String(lastAns) + '\">提升最近一条答", "data-sc-act=\"promote\">提升最近一条答"),
    expectFail: "一行一条问答，带行号出处与提升锚点",
  },
  {
    id: "sc-promote-anchor-points-at-oldest-answer",
    src: "src/renderer/app.js",
    test: "tests/renderer-sidechat-view.test.ts",
    desc: "找「最近一条答案」从头部扫 ⇒ 锚到最早那条：用户刚拿到的结论提升不了，提升出去的是半小时前的旧话",
    apply: (s) => s.replace("for (let i = list.length - 1; i >= 0; i--) {", "for (let i = 0; i < list.length; i++) {"),
    expectFail: "一行一条问答，带行号出处与提升锚点",
  },
  {
    id: "sc-zero-usage-printed-as-measured",
    src: "src/renderer/app.js",
    test: "tests/renderer-sidechat-view.test.ts",
    desc: "去掉「三项全零整段不写」⇒ 一条没问过的旁路显示「用量 0 次 · 进出 0/0 tok」：把没量过说成量过（本仓点名的把不可知记成已知）",
    apply: (s) => s.replace("  if (n === 0 && i === 0 && o === 0) return '';\n", ""),
    expectFail: "一次用量也没有时整段不写",
  },
  {
    id: "sc-session-cap-ignores-limit",
    src: "src/renderer/app.js",
    test: "tests/renderer-sidechat-view.test.ts",
    desc: "会话数折了但列表照全出 ⇒ 同时写着「另有 1 个未列出」：折叠计数与实际渲染不一致，那个数字就成了装饰",
    apply: (s) => s.replace("? sessions.slice(0, SC_SESSION_LIMIT).map(s => scSessionHTML(s, promoted)).join('') +", "? sessions.map(s => scSessionHTML(s, promoted)).join('') +"),
    expectFail: "有界性折得看得见",
  },
  {
    id: "sc-msg-cap-ignores-limit",
    src: "src/renderer/app.js",
    test: "tests/renderer-sidechat-view.test.ts",
    desc: "每会话消息数不折 ⇒ 面板变成转录查看器（一屏几百条），且「另有 N 条未列出」永远不再出现：长会话在界面上静默消失",
    apply: (s) => s.replace("  const shown = all.slice(-SC_MSG_LIMIT);", "  const shown = all;"),
    expectFail: "有界性折得看得见",
  },
  {
    id: "sc-text-trim-drops-ellipsis",
    src: "src/renderer/app.js",
    test: "tests/renderer-sidechat-view.test.ts",
    desc: "单条文本不截断 ⇒ 一条 300 字的旁路回答整段铺进右栏；截断标记「…」一旦不在，用户也无从知道后面还有",
    apply: (s) => s.replace("  return s.length > SC_TEXT_LIMIT ? s.slice(0, SC_TEXT_LIMIT) + '…' : s;", "  return s;"),
    expectFail: "有界性折得看得见",
  },
  {
    id: "sc-error-state-merged-into-empty",
    src: "src/renderer/app.js",
    test: "tests/renderer-sidechat-view.test.ts",
    desc: "读失败那一支并进空态 ⇒ 快照读不到时告诉用户「还没有旁路会话」：把失败说成没有，是最难被发现的一种假空",
    apply: (s) => s.replace("  if (sidechatSnap.error) return '<p class=\"sched-empty\">旁路快照读取失败：' + esc(sidechatSnap.error) + '</p>';\n", ""),
    expectFail: "三态各说各的话",
  },
  {
    id: "sc-promoted-badge-never-shown",
    src: "src/renderer/app.js",
    test: "tests/renderer-sidechat-view.test.ts",
    desc: "徽标不随 origin 反向投影出 ⇒ 提升过的消息与没提升的长得一样，用户只能重复提升同一条",
    apply: (s) => s.replace("(promoted ? '<span class=\"sc-badge\">已提升</span>' : '')", "''"),
    expectFail: "已提升徽标来自 origin 反向投影",
  },
  // ---- 停止原因第一次有读者（§3.3 / outputs/stop-reason-blindspot-2026-09-21.md）----
  {
    id: "stop-reason-keeps-wire-text",
    src: "src/providers/stop-reason.ts",
    test: "tests/turn-truncated.test.ts",
    desc: "存线上原文而不是归一 token ⇒ 网关给 '  max_tokens \\n' 就原样进模型可见上下文",
    apply: (s) => s.replace('stop_reason: raw.trim(),', 'stop_reason: raw,'),
    expectFail: "turnTruncatedEvent：正常收尾返回 null；截断时存归一 token 而非线上原文",
  },
  {
    id: "stop-reason-emits-on-benign-reason",
    src: "src/providers/stop-reason.ts",
    test: "tests/turn-truncated.test.ts",
    desc: "摘掉「只给 outcome 非 null 才落」这道闸 ⇒ 答完的轮也落证据，既有转录被污染",
    apply: (s) => s.replace('if (outcome === null || typeof raw !== "string") return null;', 'if (typeof raw !== "string") return null;'),
    expectFail: "turnTruncatedEvent：正常收尾返回 null；截断时存归一 token 而非线上原文",
  },
  {
    id: "stop-reason-drops-case-fold",
    src: "src/providers/stop-reason.ts",
    test: "tests/turn-truncated.test.ts",
    desc: "去掉 toLowerCase ⇒ Gemini 的 MAX_TOKENS/SAFETY 全落 unknown，这一族静默失明",
    apply: (s) => s.replace('const key = raw.trim().toLowerCase();', 'const key = raw.trim();'),
    expectFail: "三家各自的「篇幅用尽」都归一到 output_budget",
  },
  {
    id: "stop-reason-hides-zero-output-tokens",
    src: "src/providers/stop-reason.ts",
    test: "tests/turn-truncated.test.ts",
    desc: "真值判断代替 != null ⇒ output_tokens=0 被折成「provider 没上报」（0 也是读数）",
    apply: (s) => s.replace('...(tokens !== null ? { output_tokens: tokens } : {}),', '...(tokens ? { output_tokens: tokens } : {}),'),
    expectFail: "output_tokens：0 要如实留（0 也是读数），null/undefined 才不落字段",
  },
  {
    id: "anthropic-never-reads-stop-reason",
    src: "src/providers/anthropic.ts",
    test: "tests/turn-truncated.test.ts",
    desc: "摘掉 message_delta 里那句读取 ⇒ 退回本轮动手前的原状（字段在、零读者）",
    apply: (s) => s.replace('if (typeof event.delta?.stop_reason === "string") stopReason = event.delta.stop_reason;\n', ''),
    expectFail: "anthropic：message_delta 带 max_tokens ⇒ 流尾多出一条 turn_truncated",
  },
  {
    id: "openai-never-reads-finish-reason",
    src: "src/providers/openai.ts",
    test: "tests/turn-truncated.test.ts",
    desc: "摘掉 finish_reason 的记值 ⇒ GLM 跟着失明（它整文件委托本适配器，没有自己的读取点）",
    apply: (s) => s.replace('        if (fr) finishReason = fr;\n', ''),
    expectFail: "openai（glm 即其预设）：finish_reason=length ⇒ turn_truncated",
  },
  {
    id: "gemini-never-reads-finish-reason",
    src: "src/providers/gemini.ts",
    test: "tests/turn-truncated.test.ts",
    desc: "摘掉 candidates[0].finishReason 的记值 ⇒ 这一家单独回到「截断＝成功」",
    apply: (s) => s.replace('        if (cand?.finishReason) finishReason = cand.finishReason;\n', ''),
    expectFail: "gemini：finishReason=MAX_TOKENS ⇒ turn_truncated（大小写不同，表要认）",
  },
  {
    id: "context-never-projects-truncation",
    src: "src/agent/context.ts",
    test: "tests/turn-truncated.test.ts",
    desc: "证据落了盘但投影不注入 ⇒ 模型下一轮仍把半句话当成自己说完的话（感知到了、没修）",
    apply: (s) => s.replace('      msgs.push({ role: "user", content: truncationNote(e) });\n', ''),
    expectFail: "projectContext：说明紧跟在被砍断的那段正文之后（位置本身就是信息）",
  },
  {
    id: "mock-script-cannot-express-truncation",
    src: "src/providers/mock.ts",
    test: "tests/turn-truncated.test.ts",
    desc: "剧本拒收 turn_truncated ⇒ 截断只能在测试里手写 provider 造，端到端那一跳没有观测者",
    apply: (s) => s.replace('e.type === "tool_call" || e.type === "usage" || e.type === "turn_truncated"', 'e.type === "tool_call" || e.type === "usage"'),
    expectFail: "剧本可以带 turn_truncated，并按序原样产出（不折进正文、不丢）",
  },
  {
    id: "compaction-input-drops-truncation",
    src: "src/agent/compaction.ts",
    test: "tests/turn-truncated.test.ts",
    desc: "摘要输入不收这一行 ⇒ 压缩把被排除旧事件里唯一的截断痕迹一起丢掉，半句被摘成完整结论",
    // 用 && false 而不是换掉比较：换掉会让 e 不再被收窄，分支体当场类型报错、测的是编译不是行为
    apply: (s) => s.replace('} else if (e.type === "turn_truncated") {', '} else if (e.type === "turn_truncated" && false) {'),
    expectFail: "截断有自己一行，紧跟被砍断的那段正文，且带上是哪个原因",
  },
  {
    id: "compaction-merges-truncation-causes",
    src: "src/agent/compaction.ts",
    test: "tests/turn-truncated.test.ts",
    desc: "把「篇幅用尽」与「内容策略中止」并成一句 ⇒ 摘要里看不出下一步该续写还是改道",
    apply: (s) => s.replace('(e.outcome === "output_budget" ? "没写完就被收走（篇幅用尽，停止原因 " : "被内容策略中止（停止原因 ")', '"没写完就被收走（篇幅用尽，停止原因 " +'),
    expectFail: "内容策略中止与篇幅用尽各说各的（两种原因的下一步不同）",
  },
  {
    id: "goal-treats-truncation-as-no-output",
    src: "src/agent/goal.ts",
    test: "tests/turn-truncated.test.ts",
    desc: "摘掉 continue 那一支 ⇒ 被 max_tokens 砍断的一轮被擦成「没有可验证的产出，续跑只会白花钱」并停下",
    apply: (s) => s.replace('if (truncated) {', 'if (false) {'),
    expectFail: "被收走的那一轮 ⇒ 继续，而不是宣布「没有可验证的产出」",
  },
  {
    id: "goal-truncation-scan-blind",
    src: "src/agent/goal.ts",
    test: "tests/turn-truncated.test.ts",
    desc: "从流尾回走的判据恒返回 false ⇒ 「被打断」与「说完了」在 goal 层重新变成同一个形状",
    apply: (s) => s.replace('if (e.type === "turn_truncated") return e.agent_id === undefined;', 'if (e.type === "turn_truncated") return false;'),
    expectFail: "读过事件流就能拿到这个判断（projectGoal 算了不许丢——「两头断」防线）",
  },
  {
    id: "goal-view-drops-truncated-field",
    src: "src/agent/goal.ts",
    test: "tests/turn-truncated.test.ts",
    desc: "算了 lastTurnWasTruncated 却不挂进 GoalView ⇒ 生产入口拿不到（纯函数有单测正是漏接的藏身处）",
    apply: (s) => s.replace('    truncated: lastTurnWasTruncated(window),\n', ''),
    expectFail: "读过事件流就能拿到这个判断（projectGoal 算了不许丢——「两头断」防线）",
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
  {
    id: "anthropic-null-frame-clobbers-stop-reason",
    src: "src/providers/anthropic.ts",
    test: "tests/turn-truncated.test.ts",
    desc: "无条件赋值（只看 !== undefined 或干脆不判）⇒ 后到的 stop_reason:null 帧抹掉已拿到的 max_tokens",
    apply: (s) => s.replace('if (typeof event.delta?.stop_reason === "string") stopReason = event.delta.stop_reason;', 'stopReason = event.delta?.stop_reason;'),
    expectFail: "anthropic：后到的 stop_reason:null 帧不得抹掉已拿到的 max_tokens",
  },
  {
    id: "token-count-coercion-lost",
    src: "src/providers/stop-reason.ts",
    test: "tests/turn-truncated.test.ts",
    desc: "去掉 Number.isFinite 这道界 ⇒ NaN/Infinity 当作读数存进来，而它会被拼进滚动摘要的散文行",
    apply: (s) => s.replace('if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return null;', 'if (typeof v !== "number" || v < 0) return null;'),
    expectFail: "output_tokens 只收有限非负数：字符串/NaN/Infinity 一律落缺席，不进散文行",
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
  {
    id: "d7-snapshot-taken-for-new-file",
    src: "src/tools/snapshot.ts",
    test: "tests/snapshot-d7.test.ts",
    desc: "去掉「不存在/非普通文件/空文件」三道不占快照的界 ⇒ 每次新建都往用户仓库塞一份原件（噪音变垃圾）",
    apply: (s) => s.replace("if (st === null || !st.isFile() || st.size === 0) return null;", "if (false) return null;"),
    expectFail: "新建文件不占快照",
  },
  {
    id: "d7-worker-optout-ignored",
    src: "src/tools/write_file.ts",
    test: "tests/snapshot-d7.test.ts",
    desc: "无视 ctx.snapshot === false ⇒ worker 写侧照落快照、worktree 脏文件面被撑大（实测连带 m3b 的 mergeWorker 判红）",
    apply: (s) => s.replace("const snapshotId = ctx.snapshot === false ? null :", "const snapshotId = false ? null :"),
    expectFail: "worker 写侧显式关掉（snapshot:false）",
  },
  {
    id: "d7-snapshot-id-not-in-event",
    src: "src/agent/loop.ts",
    test: "tests/snapshot-d7.test.ts",
    desc: "快照路径只留在 tool 正文、不进 tool_result 事件 ⇒ 事后审计与界面无从取证（§10.4 要的正事件里那一条）",
    apply: (s) => s.replace("        ...(snapshotId !== undefined ? { snapshotId } : {}),\n", ""),
    expectFail: "字段穿过 loop 落进事件流（tool 侧与事件侧不是两套东西）",
  },
  // ---- 事件类型清单三面一致闸（tests/event-type-coverage.test.ts，2026-09-21）----
  // 这张闸本身也是「按类型白名单取料」的东西：没有锚点看着，它一样会静默塌成恒真。
  {
    id: "registry-drops-a-card-type",
    src: "src/events/index.ts",
    test: "tests/event-type-coverage.test.ts",
    desc: "KNOWN_TYPES 少一个联合成员 ⇒ append 当场拒收这条事件（落不了盘，后面三面全看不见它）",
    apply: (s) => s.replace('  "turn_truncated",\n', ""),
    expectFail: "注册表与联合类型同集合（多一个少一个都算漂移）",
  },
  {
    id: "card-type-without-label",
    src: "src/renderer/app.js",
    test: "tests/event-type-coverage.test.ts",
    desc: "删掉一条卡片标签 ⇒ 标题退回原始英文类型名（正是 2026-09-21 turn_truncated 撞的那件事）",
    apply: (s) => s.replace("    turn_truncated: '助手输出被截断',\n", ""),
    expectFail: "每个卡片型事件都有地方接住它：EVENT_LABELS 或卡片 switch 的单独 case",
  },
  {
    id: "label-for-a-non-card-type",
    src: "src/renderer/app.js",
    test: "tests/event-type-coverage.test.ts",
    desc: "给一个不会成卡片的类型留标签 ⇒ 这一条永远读不到，标签表开始攒尸体（反向也判）",
    apply: (s) => s.replace("const EVENT_LABELS = {", "const EVENT_LABELS = {\n  usage: '用量',"),
    expectFail: "EVENT_LABELS 里没有死条目（不为非卡片类型留标签）",
  },
  // ---- 停止原因的另外两支读数：非流式分支与 prompt 级拦截（2026-09-21 第二次实测）----
  {
    id: "openai-nonstream-blind",
    src: "src/providers/openai.ts",
    test: "tests/turn-truncated.test.ts",
    desc: "非流式分支不读 finish_reason ⇒ 压缩摘要被砍断时账面上是「写完了」",
    apply: (s) => s.replace("turnTruncatedEvent(callId, data.choices?.[0]?.finish_reason,", "turnTruncatedEvent(callId, null,"),
    expectFail: "openai 非流式（摘要器走的那一支）：finish_reason=length ⇒ 事件照落",
  },
  {
    id: "gemini-blind-to-prompt-feedback",
    src: "src/providers/gemini.ts",
    test: "tests/turn-truncated.test.ts",
    desc: "只读 candidates[0].finishReason ⇒ prompt 级拦截那一帧根本没有 candidates，SAFETY 永远看不见",
    apply: (s) => s.replace('        if (chunk.promptFeedback?.blockReason) blockReason = chunk.promptFeedback.blockReason;\n', ''),
    expectFail: "gemini：candidates 缺席、只有 promptFeedback.blockReason ⇒ SAFETY 看得见",
  },
  {
    id: "summarizer-hides-truncation",
    src: "src/agent/glm-session.ts",
    test: "tests/turn-truncated.test.ts",
    desc: "摘要器收下 turn_truncated 却不往外传 ⇒ 第四闸永远等不到它（「两头断」的原型形状）",
    apply: (s) => s.replace('      else if (e.type === "turn_truncated") truncated = e.stop_reason;\n', ''),
    expectFail: "穿链：非流式响应 → 摘要器 → out.truncated（收了不声张 = 没收，「两头断」第 10 次防线）",
  },
  {
    id: "compaction-accepts-truncated-summary",
    src: "src/agent/compaction.ts",
    test: "tests/compaction.test.ts",
    desc: "摘掉第四闸 ⇒ 半句摘要落进记录并替掉它替掉的旧事件（不可逆的那一面）",
    apply: (s) => s.replace('      if (out.truncated !== undefined) {', '      if (false) {'),
    expectFail: "没收尾的摘要拒绝：半句话不得替掉它替掉的旧事件",
  },
  // ---- goal 的 hint 通道：判据算出来的那句必须真送到模型面前（2026-09-21）----
  {
    id: "goal-hint-lost-at-callsite",
    src: "src/main/agent-runner.ts",
    test: "tests/goal-stop-decision.test.ts",
    desc: "生产入口不传 decision.hint ⇒ 被收走的那一轮仍收到「针对红字继续」（算了没人读的第 10 次）",
    apply: (s) => s.replace("goalReminder(view.spec, turn, spentUsd, view.evidence, decision.hint, unbookedWorkers)", "goalReminder(view.spec, turn, spentUsd, view.evidence, undefined, unbookedWorkers)"),
    expectFail: "生产入口真的把 decision.hint 传进去（goalNextTurn 未导出 ⇒ 只能钉这一行的形状）",
  },
  {
    id: "goal-reminder-ignores-hint",
    src: "src/agent/goal.ts",
    test: "tests/goal-stop-decision.test.ts",
    desc: "hint 收进参数却不用 ⇒ 块里同时留着「针对红字继续」那句错指令",
    // 针脚随「默认句改成按证据态给」而改指（2026-09-22）：语义逐字不变——仍然只摘掉 hint 那一半。
    apply: (s) => s.replace('"（" + (hint ?? FOLLOW[evidence]) + "）。"', '"（" + FOLLOW[evidence] + "）。"'),
    expectFail: "goalReminder：hint 在场时**替换**证据态那句默认指令（一处只留一个指令，不追加也不双份付费）",
  },
  {
    id: "goal-truncation-branch-forgets-hint",
    src: "src/agent/goal.ts",
    test: "tests/goal-stop-decision.test.ts",
    desc: "continue 判对了但不给 hint ⇒ 续跑照跑，可模型收到的仍是「对着红字改」",
    apply: (s) => s.replace('        hint: "上一轮没写完就被收走（没有红字，也没有验证）⇒ 从断点接着写完它，先别开新方向",\n', ''),
    expectFail: "被收走那一支带 hint；默认那一支不带（每条续跑都多说一句 = 每轮重送的钱）",
  },
  {
    id: "goal-reminder-follow-ignores-evidence",
    src: "src/agent/goal.ts",
    test: "tests/goal-stop-decision.test.ts",
    desc: "下一步那一句不看证据态、恒用 failed 的话 ⇒ 「从没跑过验证」的一轮被教成「去改红字」",
    apply: (s) => s.replace("(hint ?? FOLLOW[evidence])", "(hint ?? FOLLOW.failed)"),
    expectFail: "「对着红字改」只在该说的证据态出现：absent 与 stale 手上根本没有红字",
  },
  // ---- 截断卡的标题面（tests/renderer-truncation-label.test.ts，2026-09-21）----
  {
    id: "renderer-merges-truncation-causes",
    src: "src/renderer/app.js",
    test: "tests/renderer-truncation-label.test.ts",
    desc: "两种原因并成一句 ⇒ 用户看不出该续写同一句还是换个说法绕开",
    apply: (s) => s.replace("e.outcome === 'content_blocked' ? '被内容策略中止' : '没写完就被收走'", "'没写完就被收走'"),
    expectFail: "两种原因各说各的（下一步不同，不许并成一句）",
  },
  {
    id: "renderer-hides-truncation-token-reading",
    src: "src/renderer/app.js",
    test: "tests/renderer-truncation-label.test.ts",
    desc: "不落已用输出 token ⇒ 标题只剩形容词，离帽多远这个唯一可行动的数没了",
    apply: (s) => s.replace("'，已用 ' + String(e.output_tokens) + ' 输出 token'", "''"),
    expectFail: "线上停止原因与已用输出 token 都上屏（离帽多远是唯一可行动的数字）",
  },
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
  {
    id: "compaction-summary-leaks-child-stream",
    src: "src/agent/compaction.ts",
    test: "tests/compaction.test.ts",
    desc: "摘要输入不看归因 ⇒ worker 的内部转录被父会话「做过」的形态写进长期留存的摘要",
    apply: (s) => s.replace("if (hasWorkerAttribution(e)) {", "if (false) {"),
    expectFail: "带归因的四型一个字节都不进摘要输入",
  },
  {
    id: "compaction-child-skip-merges-deltas",
    src: "src/agent/compaction.ts",
    test: "tests/compaction.test.ts",
    desc: "跳过子流时不先收尾正文 ⇒ 子流两侧的两段父正文粘成一段（父说过什么被改写）",
    apply: (s) => s.replace("      flushDelta(); // 主流正文的边界照旧收束,不让两段正文隔着一段子流粘成一段\n", ""),
    expectFail: "两段主流正文中间夹一段子流时不粘连（子流被跳过，父的正文边界照旧收束）",
  },
  // ---- 修剪的账只量父上下文（prune.ts，2026-09-22 第三面）----
  {
    id: "prune-candidates-include-child-stream",
    src: "src/agent/prune.ts",
    test: "tests/prune.test.ts",
    desc: "候选面不再排除子流 ⇒ worker 的 tool_result 被裁：记一次不存在的节省 + 把内部转录抄进附件",
    apply: (s) => s.replace('  if (hasWorkerAttribution(e)) return true;\n', ""),
    expectFail: "子流大块既不进替换表，也不记进 savedTokens",
  },
  {
    id: "prune-protection-window-counts-child-stream",
    src: "src/agent/prune.ts",
    test: "tests/prune.test.ts",
    desc: "保护区预算把子流体量算进去 ⇒ 父会话里真在上下文中的老结果被提前划出保护区去裁",
    apply: (s) => s.replace('    if (hasWorkerAttribution(e)) continue;\n', ""),
    expectFail: "末尾放子流大块：不吃保护区预算，老结果 q 仍受保护",
  },
  // ---- 子流准入的界面那一半（projections + 两条渲染器，2026-09-22）----
  {
    id: "renderer-live-draws-child-detail",
    src: "src/renderer/app.js",
    test: "tests/renderer-history-live.test.ts",
    desc: "live 那支不看归因 ⇒ 跑动中 worker 的正文与工具直接落进父的消息泡（刷新前看得见的那半边）",
    apply: (s) => s.replace("    if (!entersMainConversation(e)) return;\n", ""),
    expectFail: "live：worker 的执行细节不落地",
  },
  {
    id: "renderer-replay-draws-child-detail",
    src: "src/renderer/history-window.js",
    test: "tests/history-window.test.ts",
    desc: "重放那支不看归因 ⇒ 同一份流刷新后凭空长出一排 worker 单元（与上一条正是「两支各漏一边」的形状）",
    apply: (s) => s.replace("    if (!entersMainConversation(e)) return;\n", ""),
    expectFail: "worker 子流的执行细节（正文/工具/错误/截断）根本不进单元集",
  },
  {
    id: "renderer-hides-worker-spend",
    src: "src/renderer/projections.ts",
    test: "tests/renderer-child-admission.test.ts",
    desc: "把 usage 一并藏进子流 ⇒ 底栏少报 worker 花的真钱（隐藏执行细节不许顺手隐藏它的成本）",
    apply: (s) => s.replace('"tool_result", "error", "turn_truncated"]);', '"tool_result", "error", "turn_truncated", "usage"]);'),
    expectFail: "usage 带归因仍进主流",
  },
  {
    id: "admission-hides-unattributed-prose",
    src: "src/renderer/projections.ts",
    test: "tests/renderer-child-admission.test.ts",
    desc: "判据反转成「不带归因就不进主流」⇒ 把父会话自己的正文整块藏掉，主流只剩卡片",
    apply: (s) => s.replace('if (typeof e.agent_id !== "string" || e.agent_id === "") return true;', 'if (typeof e.agent_id !== "string" || e.agent_id === "") return false;'),
    expectFail: "判据永不藏掉不带归因的事件",
  },
  {
    id: "admission-treats-empty-agent-id-as-child",
    src: "src/renderer/projections.ts",
    test: "tests/renderer-child-admission.test.ts",
    desc: "漏掉空串归因 ⇒ legacy 流（agent_id 曾可选、历史盘上是空串）被整段当成子流藏掉",
    apply: (s) => s.replace('if (typeof e.agent_id !== "string" || e.agent_id === "") return true;', 'if (typeof e.agent_id !== "string") return true;'),
    expectFail: "空串归因按「不带」处理",
  },
  // ---- 工具摘要政策的一份实现（projections.toolArgsSummary，2026-09-22）----
  {
    id: "panel-recent-drops-tool-target",
    src: "src/renderer/projections.ts",
    test: "tests/tool-args-summary.test.ts",
    desc: "右栏 recent 退回只写工具名 ⇒ 准入轮把 worker 的 tool_call 摘出主流后，「它碰过哪个文件」无处可读",
    apply: (s) => s.replace('"🔧 " + e.name + " · " + toolArgsSummary(e.args)', '"🔧 " + e.name'),
    expectFail: "右栏 worker 行的 recent 带得上目标",
  },
  {
    id: "app-reinlines-its-own-tool-summary",
    src: "src/renderer/app.js",
    test: "tests/tool-args-summary.test.ts",
    desc: "主转录那行自己抄一份取料 ⇒ 两份政策，一份记得 path、另一份迟早忘（同族各抄一份）",
    apply: (s) => s.replace("esc(toolArgsSummary(e.args))", "esc(String((e.args && e.args.path) || ''))"),
    expectFail: "主转录那行取的是 projections 的同一个实现",
  },
  {
    id: "tool-summary-picks-command-before-file",
    src: "src/renderer/projections.ts",
    test: "tests/tool-args-summary.test.ts",
    desc: "取料顺序倒过来（命令先于文件）⇒ 写文件的一行显示的是别的字段，用户看不出这次动的是谁",
    apply: (s) => s.replace('    pick("path", "file", "filePath", "target", "filename") ||\n    pick("command", "cmd", "script") ||', '    pick("command", "cmd", "script") ||\n    pick("path", "file", "filePath", "target", "filename") ||'),
    expectFail: "文件位优先",
  },
  {
    id: "tool-summary-unbounded-string-leaks",
    src: "src/renderer/projections.ts",
    test: "tests/tool-args-summary.test.ts",
    desc: "只截非串值不截长字符串 ⇒ 一条长参数整段进那一行 DOM，「摘要」变成「全文」",
    apply: (s) => s.replace('return raw === "" ? "—" : raw.slice(0, 120);', 'return raw === "" ? "—" : raw;'),
    expectFail: "有界：三个分支各自都不超过 120 字",
  },
  // ---- 面板重绘触发集的双向闸（projections.PANEL_DIRTY_TYPES，2026-09-22）----
  {
    id: "panel-dirty-misses-review-and-progress-events",
    src: "src/renderer/projections.ts",
    test: "tests/panel-dirty-freshness.test.ts",
    desc: "脏集退回「只认工具与编排」⇒ usage/进展/报告/安全发现四类改了投影却不重绘，右栏停在上一批数据上仍看着像当前结论",
    apply: (s) => s.replace('  "usage", "agent_message", "agent_result", "security_report",\n', ""),
    expectFail: "security_report 实测改投影",
  },
  {
    id: "panel-dirty-refreshes-on-inert-events",
    src: "src/renderer/projections.ts",
    test: "tests/panel-dirty-freshness.test.ts",
    desc: "把不改投影的类型也塞进脏集 ⇒ 每条事件一次 O(全量) 重投影；白刷的成本最终会逼后人把表整个改窄（连正确的漏判一起改掉）",
    apply: (s) => s.replace('"agent_result", "security_report",', '"agent_result", "security_report", "error",'),
    expectFail: "error 实测零影响",
  },
  {
    id: "app-keeps-its-own-panel-dirty-copy",
    src: "src/renderer/app.js",
    test: "tests/panel-dirty-freshness.test.ts",
    desc: "渲染层自己内联一份触发清单 ⇒ 与投影分家，加字段的那一侧再也不会想起这里（同族各抄一份）",
    apply: (s) => s.replace("PANEL_DIRTY_TYPES.has(e.type)", '["tool_call", "tool_result", "agent_spawned", "agent_status", "approval_requested", "approval_resolved", "diff_comment"].includes(e.type)'),
    expectFail: "判据只有一张表",
  },
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
    id: "routing-list-hides-plugin-roles",
    src: "src/agent/plugins/index.ts",
    test: "tests/plugin-role-discoverability.test.ts",
    desc: "清单不收角色 ⇒ stages[].role 能吃的名字没有任何地方可见，「自定义子智能体」退化成猜谜，唯一反馈是 spawn 被拒",
    apply: (s) => s.replace("return buildSkillRoutingList(this.skills(), roleLines);", "return buildSkillRoutingList(this.skills());"),
    expectFail: "受信的 plugin:agent 进清单，且写明这是 stages[].role 能吃的名字",
  },
  // ---- 高熵候选的边界（security/scan.ts，2026-09-22）----
  {
    id: "entropy-candidate-eats-assignment-label",
    src: "src/agent/security/scan.ts",
    test: "tests/redact.test.ts",
    desc: "候选字符集含 `=` ⇒ `SESSION=<高熵>` 整串成为候选，mask() 只留前 4 字符，键名连同值一起吃掉（掩码产物读起来像原文被改坏了）",
    apply: (s) => s.replace("/[A-Za-z0-9+/_-]{16,}={0,2}/g", "/[A-Za-z0-9+/=_-]{16,}/g"),
    expectFail: "赋值式：值掩掉、键名逐字留着",
  },
  {
    id: "entropy-path-veto-removed",
    src: "src/agent/security/scan.ts",
    test: "tests/redact.test.ts",
    desc: "去掉绝对路径否决 ⇒ 字符集含 `/`，一条 tmpdir 整段成为候选（实测 `/var/folders/…` 落成 `/var****`），落流与归档两面的路径全毁",
    apply: (s) => s.replace("    if (looksLikePath(token)) continue;\n", ""),
    expectFail: "绝对路径形状否决：真实 mkdtemp 目录与其下的文件逐字不变",
  },
  {
    id: "modal-dismiss-priority-inverted",
    src: "src/renderer/app.js",
    test: "tests/renderer-modal-dismiss.test.ts",
    desc: "把 settingsOverlay 排到 riskScrim 前面 ⇒ 数组序即优先级这张表反过来：安全确认的浮层被设置页抢走这一次 Escape",
    apply: (s) => s.replace(
      "  { sel: '#riskScrim', close: () => closeRisk() },\n  { sel: '#settingsOverlay', close: () => closeSettings() },\n",
      "  { sel: '#settingsOverlay', close: () => closeSettings() },\n  { sel: '#riskScrim', close: () => closeRisk() },\n",
    ),
    expectFail: "数组序即优先级：两支同时开着 ⇒ 交出去的是安全确认那一支",
  },
  {
    id: "modal-dismiss-register-noop",
    src: "src/renderer/app.js",
    test: "tests/renderer-modal-dismiss.test.ts",
    desc: "登记函数收下参数却不写进表（装载收下、执行端不读的同族形态）⇒ 新浮层静默没有键盘退路，正是 d4a91a6 之前第四支的遭遇",
    apply: (s) => s.replace("  if (!MODAL_DISMISS.some((m) => m.sel === sel)) MODAL_DISMISS.push({ sel, close });\n", ""),
    expectFail: "自己登记的浮层才有键盘退路；登记前表完全不认它（第四支被漏掉的那件事）",
  },
  {
    id: "modal-dismiss-dedup-removed",
    src: "src/renderer/app.js",
    test: "tests/renderer-modal-dismiss.test.ts",
    desc: "去掉「同一选择器只登记一次」的守卫 ⇒ 重复登记加长表并把 close 换成后到的那一份（优先级与回调归属都变了）",
    apply: (s) => s.replace("  if (!MODAL_DISMISS.some((m) => m.sel === sel)) MODAL_DISMISS.push({ sel, close });", "  MODAL_DISMISS.push({ sel, close });"),
    expectFail: "同一选择器重复登记不加长表，也不夺走已有那一行的 close",
  },
  {
    id: "modal-dismiss-ignores-show-state",
    src: "src/renderer/app.js",
    test: "tests/renderer-modal-dismiss.test.ts",
    desc: "查表时不看 `show` ⇒ 只要登记过就永远有「开着的浮层」，Escape 被浮层独占、芯片看板那一支再也拿不到按键",
    apply: (s) => s.replace("    if (el && el.classList.contains('show')) return { el, close: m.close };", "    if (el) return { el, close: m.close };"),
    expectFail: "负控：一支都没开着 ⇒ null（Escape 才落到芯片看板那一支）",
  },
  {
    id: "backdrop-inert-decided-by-dismiss-registry",
    src: "src/renderer/app.js",
    test: "tests/renderer-modal-backdrop.test.ts",
    desc: "inert 判据退回取 `openModal()`（收起表）⇒ 未登记的浮层自动漏在锁外：静态预览里新手引导的登记在 window.agent 桥接段内、整段提前 return，实测该相红 56",
    apply: (s) => s.replace("  if (document.querySelector('[role=\"dialog\"][aria-modal=\"true\"].show') !== null) {", "  if (openModal() !== null) {"),
    expectFail: "判据不取收起表：只查「背景 + 开着的那个选择器」，一次都不按 id 找浮层",
  },
  {
    id: "backdrop-observer-loses-subtree",
    src: "src/renderer/app.js",
    test: "tests/renderer-modal-backdrop.test.ts",
    desc: "观测器去掉 `subtree: true` ⇒ 只盯 body 自己的属性，浮层改 class 一次也不回调（09-22 实踩过：装完 inert 读数纹丝不动）",
    apply: (s) => s.replace("subtree: true });", "subtree: false });"),
    expectFail: "观测必须带 subtree:true 且盯的是 body：只盯 body 自己时子元素改 class 一次也不回调",
  },
  {
    id: "backdrop-never-uninerts-on-close",
    src: "src/renderer/app.js",
    test: "tests/renderer-modal-backdrop.test.ts",
    desc: "关掉浮层时不摘 inert ⇒ 「锁死背景」这一种做法也能一直判绿：设置关掉之后整个主界面再也点不动（门的 5c 成对反例同源）",
    apply: (s) => s.replace("  } else {\n    app.removeAttribute('inert');", "  } else {"),
    expectFail: "开↔关来回都要重刷：关掉的浮层不能把背景留在锁死态",
  },
  {
    id: "backdrop-resyncs-on-any-class-change",
    src: "src/renderer/app.js",
    test: "tests/renderer-modal-backdrop.test.ts",
    desc: "records 谓词写成恒真 ⇒ 任何元素改 class 都重刷背景：真凶是「浮层状态变了才需要重刷」这条筛选，去掉它任何一次列表重绘都会走同步",
    apply: (s) => s.replace("return t instanceof Element && (t.matches('[role=\"dialog\"][aria-modal=\"true\"]') || t === document.body);", "return t instanceof Element;"),
    expectFail: "只有对话框（或 body）的 class 改动才触发重刷，无关元素的不触发",
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
    id: "shape-payload-recursion-disabled",
    src: "src/permissions/command-shape.ts",
    test: "tests/shell-bypass-composition.test.ts",
    desc: "`shell -c` 载荷不再递归 ⇒ `bash -c 'sudo -u root git push --force'` 停在 bash 这一层，worker 静态闸与 deny 规则同时看不见里面的 git 命令",
    apply: (s) => s.replace("if (depth >= MAX_PAYLOAD_DEPTH) continue;", "if (depth >= 0) continue;"),
    expectFail: "非只读一律拦：包装、链段、值选项、`shell -c` 载荷、`command -p` 都不给缝",
  },
  {
    id: "shape-downstream-option-forms-lost",
    src: "src/permissions/command-shape.ts",
    test: "tests/command-shape.test.ts",
    desc: "不再产出「剥掉下游全局选项」的后缀形 ⇒ `git -C /tmp push --force` 那一族在前缀匹配里整个看不见（09-22 探针 ⑤ 段实测五支全漏，修前红 5）。" +
      "**这条原先挂在端到端那条 deny 判据上，09-23 全表跑实测存活**：⑩（同日补的按序面）把同一件事也守住了 ⇒ 单废这一支结论仍对，锚点白挂。" +
      "现改挂在**这一支自己的观测者**上（形态面产不产那一形），端到端那半交给下面那条配对锚点",
    apply: (s) => s.replace("for (const form of [[inv.bin, ...inv.args].join(\" \"), ...suffixForms(inv)]) {", "for (const form of [[inv.bin, ...inv.args].join(\" \")]) {"),
    expectFail: "五类写法都产得出「git push --force」那一形",
  },
  {
    id: "shape-downstream-option-both-faces-lost",
    src: "src/permissions/rules.ts",
    test: "tests/shell-bypass-composition.test.ts",
    desc: "上面那条的端到端半边：⑤ 的下游选项族如今由**两支**共同守住（形态面 `commandForms` 的后缀形 + ⑩ 的 `invocations` token 候选）。" +
      "只废一支必然存活（记忆第 72 条：不变量由 N 支取料面共同成立 ⇒ 变异要一次废 N 支），所以这条在同一个消费点上把两道面一起摘掉，" +
      "剩下裸前缀匹配 ⇒ 五支写法回到 approve@L4-pass，那才是「用户手写的 deny 白写」的形状",
    apply: (s) => s.replace("forms ??= commandForms(segment);", "forms ??= [segment];").replace(
      "[tokenize(segment), ...invocations(segment).map((i) => [i.bin, ...i.args])]",
      "[tokenize(segment)]",
    ),
    expectFail: "五支写法在自主档全由 L1-deny 拦下",
  },
  {
    id: "shape-suffix-forms-also-for-wrappers",
    src: "src/permissions/command-shape.ts",
    test: "tests/command-shape.test.ts",
    desc: "后缀形也对包装器那一支生成 ⇒ 产出 `sudo git status` / `sudo root git status` 这类假候选，deny/ask 过覆盖、审批卡变多（与漏判方向相反的那条界）",
    apply: (s) => s.replace("if (EXEC_WRAPPERS.has(inv.bin)) return out;", "if (false) return out;"),
    expectFail: "负控：包装器那一支不产假形（多余候选 = 审批卡变多，方向与「静默漏过」相反也要守住）",
  },
  {
    id: "shape-eval-script-payload-lost",
    src: "src/permissions/command-shape.ts",
    test: "tests/shell-bypass-composition.test.ts",
    desc: "`eval` 不再被当成「余下参数即脚本」⇒ `eval \"git push --force\"` 停在 eval 这一层，规则层与 worker 闸同时看不见里面的命令（09-22 扫写法时实测漏判）",
    apply: (s) => s.replace("if (SCRIPT_WRAPPERS.has(bin)) return args.join(\" \");", "if (false) return null;"),
    expectFail: "九支写法两支面都拦（含叠套 `sudo time xargs git …` 与引号载荷）",
  },
  {
    id: "shape-exec-wrappers-drop-time-xargs",
    src: "src/permissions/command-shape.ts",
    test: "tests/shell-bypass-composition.test.ts",
    desc: "包装器表里去掉 `time` / `xargs` ⇒ 这两个词自己不动执行、余下的才是真命令，漏判面与 ① 那族同形",
    apply: (s) => s.replace("\"command\", \"env\", \"exec\", \"nice\", \"nohup\", \"sudo\", \"timeout\", \"time\", \"xargs\",", "\"command\", \"env\", \"exec\", \"nice\", \"nohup\", \"sudo\", \"timeout\","),
    expectFail: "九支写法两支面都拦（含叠套 `sudo time xargs git …` 与引号载荷）",
  },
  {
    id: "shape-time-p-misregistered-as-value-opt",
    src: "src/permissions/command-shape.ts",
    test: "tests/shell-bypass-composition.test.ts",
    desc: "把布尔开关 `-p` 登记成带值选项 ⇒ 它会把后面的二进制当值一起吞掉（`time -p git push --force` 实测两支一起放行）。本条钉的就是本轮自己犯过的这个错",
    apply: (s) => s.replace("time: new Set([\"-o\", \"--output\"", "time: new Set([\"-p\", \"-o\", \"--output\""),
    expectFail: "`time -p` 的 `-p` 是布尔开关：登记成带值就会把 git 当值吞掉（实测两支一起放行）",
  },
  {
    id: "risk-shell-family-drops-shell-rw",
    src: "src/permissions/risk.ts",
    test: "tests/shell-bypass-composition.test.ts",
    desc: "shell 能力域互通表里去掉 `shell_rw` ⇒ 用户为 run_shell 写的 deny 不再约束 worker 的 shell 面（「按能力设防」退成「按名字设防」，本仓 C9 的老根因）",
    apply: (s) => s.replace("new Set([\"run_shell\", \"shell_rw\", \"shell_ro\"])", "new Set([\"run_shell\", \"shell_ro\"])"),
    expectFail: "worker 的 shell_rw 与主会话 run_shell 在四道面上逐条同判（SHELL_FAMILY 互通）",
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
    id: "rule-matcher-deny-ignores-wrappers",
    src: "src/permissions/rules.ts",
    test: "tests/permissions.test.ts",
    desc: "deny/ask 退回裸文本前缀（不看有效二进制）⇒ 用户手写的 deny 被 /usr/bin/git、env、nohup、timeout、command、bash -c 六类写法静默击穿。**09-22 起要同时废掉两条面**：形态面（`commandForms`）与 ⑩ 按序面里的 `invocations` 候选——⑩ 之后两条都守得住这件事，只改一条会变异存活（这就是「冗余守护」的代价：锚点得指全）",
    apply: (s) => s.replace("forms ??= commandForms(segment);", "forms ??= [segment];").replace(
      "[tokenize(segment), ...invocations(segment).map((i) => [i.bin, ...i.args])]",
      "[tokenize(segment)]",
    ),
    expectFail: "包装写法躲不过 deny",
  },
  {
    id: "rule-matcher-unknown-head-stays-silent",
    src: "src/permissions/rules.ts",
    test: "tests/shell-bypass-composition.test.ts",
    desc: "⑦ 的降级判据拿掉（按序命中但首词不认识也不再出卡）⇒ setsid / ionice / pkexec 那一族 15 支回到静默放行，用户手写的 deny 白写",
    apply: (s) => s.replace(
      "        beyond = starts.length > 0 && Math.min(...starts) > 0;",
      "        beyond = false;",
    ),
    expectFail: "⑦ 那 15 支：不再静默放行，改由 L2 出卡（deny 命中但首词不认识）",
  },
  {
    id: "rule-matcher-downgrades-known-head-too",
    src: "src/permissions/rules.ts",
    test: "tests/shell-bypass-composition.test.ts",
    desc: "降级不看下标（凡是按序命中一律降 ask）⇒ `git push origin --force` 这类首词就是 git 的真强推被降成「问一句」，用户手写的 deny 不再绝对",
    apply: (s) => s.replace(
      "        beyond = starts.length > 0 && Math.min(...starts) > 0;",
      "        beyond = starts.length > 0;",
    ),
    expectFail: "⑧ 那三支真强推：首词就是 git ⇒ 按序命中也照原样 deny，不降级",
  },
  {
    id: "shape-token-subseq-becomes-contiguous",
    src: "src/permissions/command-shape.ts",
    test: "tests/command-shape.test.ts",
    desc: "按序面退成「必须紧邻」⇒ 中间插了参数的写法（`git push origin --force`）看不见；本仓唯一一份解析，规则层与 worker 闸一起瞎",
    apply: (s) => s.replace(
      "      k = tokens.indexOf(w, k);\n      if (k < 0) break;",
      "      if (tokens[k] !== w) { k = -1; break; }\n      if (k < 0) break;",
    ),
    expectFail: "开头命中记 0（规则照原样生效），中间插词也算",
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
  {
    id: "rule-matcher-token-boundary-dropped",
    src: "src/permissions/rules.ts",
    test: "tests/shell-bypass-composition.test.ts",
    desc: "把 token 边界判据退回整串前缀 ⇒ `deny git push --force` 又顺带禁掉**更安全**的 `--force-with-lease`（09-22 已裁掉的那侧过覆盖复活）",
    apply: (s) => s.replace(
      "  return text.length === pat.length || /\\s/.test(text.charAt(pat.length)) ? pat.length : -1;",
      "  return pat.length;",
    ),
    expectFail: "过覆盖侧已修：`git push --force-with-lease` 不再被这条 deny 命中",
  },
  {
    id: "rule-matcher-allow-ignores-token-boundary",
    src: "src/permissions/rules.ts",
    test: "tests/shell-bypass-composition.test.ts",
    desc: "只给 deny 侧讲边界、allow 侧退回整串前缀 ⇒ 用户点过的「总是允许 git status」覆盖到 `git status-bar`（不对称的是**形态面**，不是边界）",
    apply: (s) => s.replace(
      "      len = prefixLenAtBoundary(segment, pattern);",
      "      len = segment.startsWith(pattern) ? pattern.length : -1;",
    ),
    expectFail: "allow 侧同样讲边界（不对称的是形态面，不是边界）：「allow git status」不覆盖 `git status-bar`",
  },
  {
    id: "rule-matcher-allow-widens-to-wrappers",
    src: "src/permissions/rules.ts",
    test: "tests/permissions.test.ts",
    desc: "把 allow 也接进形态面 ⇒ 用户点过一次「总是允许 echo hi」的同意被顺带扩大到 `env FOO=1 echo hi`、`nohup echo hi`、`/usr/bin/echo hi`（收紧与放宽的不对称是刻意的，丢掉它等于替他扩大同意范围）",
    apply: (s) => s.replace('else if (rule.behavior === "allow") {', 'else if (rule.behavior === "__never__") {'),
    expectFail: "allow 只认原形：点过一次「总是允许」不顺着包装器扩大同意范围",
  },
  {
    id: "rule-allow-consent-gap-removed",
    src: "src/permissions/rules.ts",
    test: "tests/permissions.test.ts",
    desc: "丢掉「命中前缀之后还剩载荷」的同意范围检查 ⇒ `echo hi` 的一次点击重新覆盖 `echo hi > /tmp/pwned`、`echo hi $(rm -rf …)`（09-21 探针 ② 段原缺陷复活）",
    apply: (s) => s.replace("      if (len >= 0) gap = ALLOW_PAYLOAD.test(segment.slice(len));", "      gap = false;"),
    expectFail: "命中前缀后还剩载荷 ⇒ 降为问一次（consentGap 留痕可审计）",
  },
  {
    id: "threat-pipe-into-shell-downgraded",
    src: "src/permissions/risk.ts",
    test: "tests/permissions.test.ts",
    desc: "「管道进 shell」从 high 降成 medium ⇒ 自主档对 `echo hi | sh` 不再出卡（② 段第五支靠的是这条威胁表条目，不是 allow 判据）",
    apply: (s) => s.replace('level: "high", category: "远程代码执行", note: "管道进 shell（把上游当脚本执行）"', 'level: "medium", category: "远程代码执行", note: "管道进 shell（把上游当脚本执行）"'),
    expectFail: "`echo hi | sh` 走的是另一条判据：链上一段无规则 ⇒ 威胁表兜住管道进 shell",
  },
  {
    id: "shape-leading-env-assignment-not-skipped",
    src: "src/permissions/command-shape.ts",
    test: "tests/command-shape.test.ts",
    desc: "不跳前导环境赋值 ⇒ `GIT_PAGER=cat git push --force` 的有效二进制看不见（这条是 09-22 建共用件时**自己踩到并被测出来**的一支）",
    apply: (s) => s.replace("while (i < tokens.length && ASSIGN_RE.test(tokens[i]!)) i++;", "while (false && i < tokens.length && ASSIGN_RE.test(tokens[i]!)) i++;"),
    expectFail: "GIT_PAGER=cat git push --force",
  },
  {
    id: "shape-wrapper-value-opt-not-swallowed",
    src: "src/permissions/command-shape.ts",
    test: "tests/command-shape.test.ts",
    desc: "跳过包装器时不吞带值选项的值 ⇒ `sudo -u root git …` 里的 `root` 冒充二进制，真正那条形再也不出现（worker 支那道半截循环的本体就在这里）",
    apply: (s) => s.replace('        if (!t.includes("=") && vopts.has(flag)) { i++; ateValue = true; }', "        if (false && !t.includes(\"=\") && vopts.has(flag)) { i++; ateValue = true; }"),
    expectFail: "选项值不冒充二进制：root / 30 / -n 都不在 bin 位",
  },
  {
    id: "threat-redirect-system-path-downgraded",
    src: "src/permissions/risk.ts",
    test: "tests/permissions.test.ts",
    desc: "「重定向写入系统路径」从 high 降成 medium ⇒ 自主档 `echo x > /etc/hosts` 不再出卡（④ 段原缺陷以另一种方式复活：条目在，分级不在）",
    apply: (s) => s.replace('level: "high", category: "系统修改", note: "重定向写入系统路径"', 'level: "medium", category: "系统修改", note: "重定向写入系统路径"'),
    expectFail: "写进 shell 启动文件 / 系统路径 / git 钩子 = high（自主档必出卡）",
  },
  {
    id: "threat-redirect-devnull-exclusion-lost",
    src: "src/permissions/risk.ts",
    test: "tests/permissions.test.ts",
    desc: "丢掉 `>&1` 与 `/dev/null` 的负向前瞻 ⇒ 丢弃输出也被当成「往文件里写」，反例那条必须红（这条锚点盯的是判据自己变宽）",
    apply: (s) => s.replace("(?!&|/dev/null)\\\\S", "\\\\S"),
    expectFail: "反例：描述符复制与丢弃到 /dev/null 不是写入",
  },
  {
    id: "threat-redirect-fd-prefix-missed",
    src: "src/permissions/risk.ts",
    test: "tests/permissions.test.ts",
    desc: "重定向正则不吃 fd 数字前缀 ⇒ `build 2>>err.log` 这类真实写面看不见（`2>` 前一个是词字符，前缀类挡住）",
    apply: (s) => s.replace("[^\\\\w>])\\\\d*>>", "[^\\\\w>])>>"),
    expectFail: "工作区普通落盘只到 medium（分级不是一律 high）",
  },
  {
    id: "ms-tail-drop-became-middle-splice",
    src: "src/agent/model-surface.ts",
    test: "tests/model-surface.test.ts",
    desc: "丢工具时从前往后找 ⇒ 变成「中间摘」：可缓存前缀被切断，且丢的次序不再等于数组尾序",
    apply: (s) => s.replace("for (let i = working.length - 1; i >= 0; i--) {", "for (let i = 0; i < working.length; i++) {"),
    expectFail: "尾丢 ⇒ 保留表是原表的位置前缀（中间摘会把可缓存前缀切断）",
  },
  {
    id: "ms-core-tier-ignored",
    src: "src/agent/model-surface.ts",
    test: "tests/model-surface.test.ts",
    desc: "core 身份判定失效 ⇒ 降配梯开始砍基础工具（便宜的废会话），帽越紧越危险",
    apply: (s) => s.replace("if (coreNames.has(name)) return \"core\";", "if (false) return \"core\";"),
    expectFail: "core 永不被自动砍：帽紧到装不下时报 unresolvable 交人裁决",
  },
  {
    // 本条曾是「去掉未超预算原样返回支」——实测**变异存活**，因为那一支是快路径而非语义分支：
    // 梯级对未超帽输入本来就是 no-op（丢不动、压不着、note 为空）。留着它图的是每轮少两次全量序列化，
    // 别为它再造针脚。这里换成真正有分辨力的两条：梯级次序、以及基础提示是否计进账。
    id: "ms-ladder-order-inverted",
    src: "src/agent/model-surface.ts",
    test: "tests/model-surface.test.ts",
    desc: "梯级 A 整个跳过（不压描述）⇒ 明明「压一压就装得下」的场景被白丢几把工具（降配序是本模块的主张，不是实现细节）",
    apply: (s) => s.replace("  const tightened = input.specs.map((s) => {\n    const name = s.function.name;\n    if (surfaceTierOf(name, input.coreNames) === \"core\") return s as T;", "  const tightened = input.specs.map((s) => {\n    const name = s.function.name;\n    if (true) return s as T;"),
    expectFail: "梯级 A（压描述）在 B（丢工具）之前：刚好超一点时一把都不丢",
  },
  {
    id: "ms-fixed-face-forgets-system",
    src: "src/agent/model-surface.ts",
    test: "tests/model-surface.test.ts",
    desc: "固定面只算工具规格、漏掉基础提示 ⇒ 账与逐件排行对不上，帽按虚低的面判",
    apply: (s) => s.replace("  const fixedChars = input.systemChars + toolSpecChars;", "  const fixedChars = toolSpecChars;"),
    expectFail: "逐件排行相加恰等于总账（对不上账的排行表不能拿去决定砍谁）",
  },
  {
    id: "ms-surface-note-not-emitted",
    src: "src/agent/glm-session.ts",
    test: "tests/model-surface.test.ts",
    desc: "降配说明生产者有、消费者没接（composeTurnMessages 收了字段却不落块）⇒ 模型看到的是一份静默变小的工具表",
    apply: (s) => s.replace("if (opts.surfaceNote) msgs.push({ role: \"system\", content: opts.surfaceNote });", "if (false) msgs.push({ role: \"system\", content: opts.surfaceNote ?? \"\" });"),
    expectFail: "provider 发出去的那份工具表已被降配，且 note 真的进了某个 system 消息",
  },
  {
    id: "ms-enforcement-wiring-bypassed",
    src: "src/agent/glm-session.ts",
    test: "tests/model-surface.test.ts",
    desc: "装配链算了账却没采用降配结果（`tools` 仍指向未降配那份）⇒ 门绿而线上不生效",
    apply: (s) => s.replace("const tools = surface ? surface.specs : declaredTools;", "const tools = declaredTools;"),
    expectFail: "provider 发出去的那份工具表已被降配，且 note 真的进了某个 system 消息",
  },
  {
    id: "silent-green-not-charged",
    src: "scripts/assertion-health.ts",
    test: "tests/gates-scan.test.ts",
    desc: "判据在、组合面没接：一门绿而零输出被算成「没有未证」⇒ 汇总与账本重新对上「全绿」，" +
      "沉默那格退回无人观测（本仓第 10 次「两头断」的形状：机器齐全、调用方断）",
    apply: (s) => s.replace("  return countUnverified(output) + (silentGreenGate(code, output) ? 1 : 0);",
      "  return countUnverified(output);"),
    expectFail: "绿而零输出 ⇒ 计 1（自报数为 0，只有静默格贡献）",
  },
  {
    id: "silent-green-predicate-dead",
    src: "scripts/assertion-health.ts",
    test: "tests/gates-scan.test.ts",
    desc: "恒假判据：机制被换成一句永远说「不静默」的常量 ⇒ 三条正例全绿而真实表现回到旧行为" +
      "（恒假判据永远红，这里是恒假的那一面对红着的用例负责）",
    apply: (s) => s.replace("  return code === 0 && output.trim() === \"\";", "  return false;"),
    expectFail: "绿 + 空输出 ⇒ 判为静默（正例）",
  },
  {
    id: "silent-green-overreach-onto-red",
    src: "scripts/assertion-health.ts",
    test: "tests/gates-scan.test.ts",
    desc: "判据丢掉输出面只看退出码 ⇒ 红门也被计一次未证，「未证」总数被红门污染，" +
      "严格模式下同一件事既算红又算未证（两个口径互相吞）",
    apply: (s) => s.replace("  return code === 0 && output.trim() === \"\";", "  return code === 0;"),
    expectFail: "红 + 空输出 ⇒ 不判为静默（红门已经判红，不再重复计未证）",
  },
  {
    id: "empty-assert-tail-arg-treated-as-condition",
    src: "scripts/assertion-health.ts",
    test: "tests/assertion-health-scan.test.ts",
    desc: "把条件位判回「最后一个实参是不是 true」（旧正则的形状）⇒ 三参等值签名 check(name, actual, expected) " +
      "那族真断言又被整批判成空断言，而体检命中是判红的：判据越界会把「解释怎么写」变成「门表怎么红」",
    apply: (s) => s.replace("|| (args.length >= 2 && isTrueLit(args[1]!));", "|| isTrueLit(args[args.length - 1]!);"),
    expectFail: "三参等值签名 check(name, actual, true) ⇒ 不报（旧正则把这一族整批判成空断言）",
  },
  {
    id: "empty-assert-detail-form-lost",
    src: "scripts/assertion-health.ts",
    test: "tests/assertion-health-scan.test.ts",
    desc: "条件位收成「只有两参时才算」⇒ label-first 带 detail 的 `check(标签, true, detail)` 回到网外。" +
      "上一版锚点存活就是因为用例挑了三参等值那侧：两条规则只在「true 第二位 + 还有后续实参」这一格分歧",
    apply: (s) => s.replace("|| (args.length >= 2 && isTrueLit(args[1]!));", "|| (args.length === 2 && isTrueLit(args[1]!));"),
    expectFail: "label-first 带 detail 的 check(label, true, detail) ⇒ 报（旧正则要求 true 在尾部，这支原本在网外）",
  },
  {
    id: "empty-assert-label-first-lost",
    src: "scripts/assertion-health.ts",
    test: "tests/assertion-health-scan.test.ts",
    desc: "收窄判定面时把该留的那一半也收掉了 ⇒ label-first 的 check(\"x\", true) 不再报，空断言重新无声通过",
    apply: (s) => s.replace("|| (args.length >= 2 && isTrueLit(args[1]!));", "|| false;"),
    expectFail: "label-first 两参 check(label, true) ⇒ 报（收窄判定面后必须留着的那一半）",
  },
  {
    id: "tautology-left-branch-lost",
    src: "scripts/assertion-health.ts",
    test: "tests/assertion-health-scan.test.ts",
    desc: "恒真式只认右支字面 true（旧正则的形状）⇒ `true || x` 这一支回到网外。加宽判定面必须有用例钉住新那一支，" +
      "否则加宽是无声的",
    apply: (s) => s.replace("&& (b.left.kind === ts.SyntaxKind.TrueKeyword || b.right.kind === ts.SyntaxKind.TrueKeyword);",
      "&& b.right.kind === ts.SyntaxKind.TrueKeyword;"),
    expectFail: "代码里的恒真式仍报：右支字面 true 与新加的左支字面 true",
  },
  {
    id: "scan-scope-empty-list-silent",
    src: "scripts/lib/scan-scope.ts",
    test: "tests/assertion-health-scan.test.ts",
    desc: "「没拿到清单」与「没有要扫的东西」同形 ⇒ 体检在 git 异常/空清单时静默扫 0 个文件并报零命中（假绿）",
    apply: (s) => s.replace("return files.length === 0 ? null : files;", "return files;"),
    expectFail: "已跟踪清单为空 ⇒ 返回 null（调用方退回磁盘遍历，不静默少判）",
  },
  {
    id: "verdict-takes-last-line-not-conclusion",
    src: "scripts/lib/gate-verdict.ts",
    test: "tests/gates-scan.test.ts",
    desc: "结论行退回「就取最后一行」⇒ vitest 的收尾是 Duration / Start at，计数在它前面，" +
      "汇总页于是显示一句没用的话——取错一行比不取更坏，因为它看起来像结论",
    apply: (s) => s.replace("    if (VERDICT_MARK.test(l)) return clip(l);", "    if (false) return clip(l);"),
    expectFail: "vitest 形态取计数那一行，而不是收尾的 Duration",
  },
  {
    id: "verdict-not-stripping-ansi",
    src: "scripts/lib/gate-verdict.ts",
    test: "tests/gates-scan.test.ts",
    desc: "剥色没吃共用件（各门自己判一次）⇒ 调用者 TERM 带色时结论行里嵌着 \\x1b，" +
      "汇总页打出一串脏码——同一族在 vitest-summary 里已修过一次，这里不能重抄一份漏掉",
    apply: (s) => s.replace("  const lines = stripAnsi(output).split(\"\\n\")", "  const lines = output.split(\"\\n\")"),
    expectFail: "带 ANSI 颜色的输出仍取到干净的结论行（剥色吃共用件）",
  },
  {
    id: "tags-version-map-face-dead",
    src: "src/agent/map/build.ts",
    test: "tests/tags-extract-version.test.ts",
    desc: "map 侧不再比对抽取版本 ⇒ 改了 .scm pattern 后，未变更的文件仍从盘上读回旧判据抽出的 tags，" +
      "新判据看起来「改了没反应」——这个假象会把一次正确的修法骗人回滚掉",
    apply: (s) => s.replace("if (e.v !== TAGS_EXTRACT_VERSION) return null; // 抽取判据换过", "if (false) return null; // 抽取判据换过"),
    expectFail: "map 侧：版本不符 ⇒ 该文件重解析（同一条缓存改回正确版本又能命中）",
  },
  {
    id: "tags-version-impact-face-dead",
    src: "src/agent/impact/index.ts",
    test: "tests/tags-extract-version.test.ts",
    desc: "impact 这张图独立于 map 抄了一份缓存读取面 ⇒ 只修 map 那一支时，影响面照旧吃旧 tags。" +
      "两支同值才成立的不变量，变异必须各自废一次（上一支锚点测不到这一支）",
    apply: (s) => s.replace("if (e.v !== TAGS_EXTRACT_VERSION) return null; // 判据换过", "if (false) return null; // 判据换过"),
    expectFail: "impact 侧：版本不符 ⇒ 重解析并计数（两份缓存不共用读取代码，各判一次）",
  },
  {
    id: "tags-version-ignores-patterns",
    src: "src/agent/map/parse.ts",
    test: "tests/tags-extract-version.test.ts",
    desc: "版本号不再把 pattern 文本算进去（只留手写 REV）⇒ 改判据而版本不动，" +
      "缓存作废链整条失效，且没有任何一处会红——手写常量当版本就是下一处漂移磁铁",
    apply: (s) => s.replace("return createHash(\"sha1\").update(EXTRACT_LOGIC_REV + \"\\n\" + patterns.join(\"\\n\"))", "return createHash(\"sha1\").update(String(EXTRACT_LOGIC_REV))"),
    expectFail: "改一条 pattern ⇒ 版本必须变；同一组 pattern ⇒ 版本稳定",
  },
  {
    id: "tags-version-hardcoded-literal",
    src: "src/agent/map/parse.ts",
    test: "tests/tags-extract-version.test.ts",
    desc: "导出的版本被写成字面量 ⇒ 派生函数还在、测试①还绿，但真机上那张图用的已不是它算出来的值。" +
      "这一格只有「常量 === 按现网 pattern 算出来的值」这条断言能看见",
    apply: (s) => s.replace("export const TAGS_EXTRACT_VERSION = tagsExtractVersion(PATTERNS);", "export const TAGS_EXTRACT_VERSION = \"000000000000\";"),
    expectFail: "导出的常量确实等于按现网 pattern 算出来的值（不是抄下的字面量）",
  },
  {
    id: "impact-local-var-gate-dropped",
    src: "src/agent/map/parse.ts",
    test: "tests/map-parse.test.ts",
    desc: "局部变量又算跨文件符号 ⇒ 函数体里的 `const target = …` 会与另一个文件里同名变量的调用连一条边" +
      "（实测 14,312 个定义里 10,184 个是这种；`i` 有 187 个「定义」、`p` 有 119 个），" +
      "于是「改它会波及谁」的回答里掺进一堆凭名字撞上的假边",
    apply: (s) => s.replace("if (c.name === \"def\" && isLocalVariableBinding(c.node)) continue;", "if (false && c.name === \"def\") continue;"),
    expectFail: "函数体里的变量声明不算定义，模块作用域的同名变量照算",
  },
  {
    id: "impact-local-var-gate-dropped-graph-face",
    src: "src/agent/map/parse.ts",
    test: "tests/impact.test.ts",
    desc: "同一条判据的**消费面**：抽取漏了闸，最终坏在「两个同名局部变量的文件之间出现一条边」这件事上。" +
      "一支锚点只认一支判卷 ⇒ 图侧那组断言若哪天只看图不看 tags，就得有这条替它盯着",
    apply: (s) => s.replace("if (c.name === \"def\" && isLocalVariableBinding(c.node)) continue;", "if (false && c.name === \"def\") continue;"),
    expectFail: "两个文件各有一个同名局部变量 ⇒ 零条边（旧判据会连一条出去，因为局部变量也进了符号表）",
  },
  {
    id: "impact-module-scope-climb-accepts-nested",
    src: "src/agent/map/parse.ts",
    test: "tests/map-parse.test.ts",
    desc: "作用域上溯不再认「嵌套执行作用域的容器」⇒ 每个节点都能走到 program，" +
      "于是所有声明都被判成模块级，那道闸变成空操作（第一次量这个数时就是这样：1,666/1,666 全判模块级）",
    apply: (s) => s.replace("if (NESTED_SCOPES.has(n.type)) return false;", "if (false) return false;"),
    expectFail: "函数体里的变量声明不算定义，模块作用域的同名变量照算",
  },
  {
    id: "impact-node-identity-compare-in-gate",
    src: "src/agent/map/parse.ts",
    test: "tests/map-parse.test.ts",
    desc: "字段比对退回**节点对象身份**：tree-sitter 每次取节点都新建外壳，`childForFieldName(...) === c.node` 恒 false" +
      " ⇒ 闸静默地永不放行，读数只少 16 个定义（本次真踩过，是复测边数 96,990 不等于预期 49,049 才暴露的）",
    apply: (s) => s.replace("if (!nm || nm.startIndex !== nameNode.startIndex || nm.endIndex !== nameNode.endIndex) return false;", "if (nm !== nameNode) return false;"),
    expectFail: "函数体里的变量声明不算定义，模块作用域的同名变量照算",
  },
  {
    id: "impact-local-gate-over-applied",
    src: "src/agent/map/parse.ts",
    test: "tests/map-parse.test.ts",
    desc: "闸从「只管 variable_declarator」扩到所有定义 ⇒ 类里的方法、嵌套的函数声明一起被抹掉。" +
      "本仓的取证只支持前者（87% 的变量定义是局部的），超出证据的收窄会把还有价值的那半边一起赔进去",
    apply: (s) => s.replace("if (!p || p.type !== \"variable_declarator\") return false;", "if (!p) return false;"),
    expectFail: "已知代价钉住：方法定义照进表，但 obj.m() 不产生引用 ⇒ 方法调用连不上定义文件",
  },
  {
    id: "impact-property-ref-patterns-restored",
    src: "src/agent/map/parse.ts",
    test: "tests/map-parse.test.ts",
    desc: "三条属性式 ref pattern 被「顺手补回来」（它们看起来像漏抽）⇒ `console.log` 又与某个文件的 " +
      "`const log = …` 相连，单个 `log` 就产 45,160 条假边。删它们是有读数的取舍，不是遗漏",
    apply: (s) => s.replace("  \"(call_expression function: (identifier) @ref)\",", "  \"(call_expression function: (identifier) @ref)\",\n  \"(call_expression function: (member_expression property: (property_identifier) @ref))\","),
    expectFail: "属性式调用不抽引用：console.log / obj.m() / new NS.Ctor() 都不算引用",
  },
  {
    id: "impact-query-defless-claims-impact",
    src: "src/tools/impact-query.ts",
    test: "tests/impact-query.test.ts",
    desc: "「图里没有它的定义」这一格被删 ⇒ `upward` 把全部同名引用点原样吐出，于是外部/全局符号" +
      "（`describe`、`expect`）得到「波及 179 个文件」——把「谁提到这个名字」冒充「改它会波及谁」，" +
      "比回答不了更坏",
    apply: (s) => s.replace("      if (defined.length === 0) {", "      if (false) {"),
    expectFail: "图里没有它的定义 ⇒ 不许报「波及 N 个文件」，要明说这一问不适用（外部/全局符号）",
  },
  {
    id: "mutate-preflight-refusal-empties-runnable",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "预检退回「有条目被拒 ⇒ 一条都不跑」⇒ 别人一个未跟踪的源文件让整张变异表停摆，" +
      "而红门只报一句『拒绝 1 条』：其余 695 条与在飞改动毫无关系的锚点没人判，读起来像保护还在",
    apply: (s) => s.replace("    runnable: entries.filter((e) => !refusedIds.has(e.id)).map((e) => e.id),", "    runnable: refusedIds.size > 0 ? [] : entries.map((e) => e.id),"),
    expectFail: "一条在飞 ⇒ 只它被跳过，**其余条目必须在 runnable 里**（旧写法这里给空表）",
  },
  {
    id: "mutate-preflight-safety-dropped",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "反过来：为了让表「跑满」而不安全照跑 ⇒ 源文件不在 HEAD 里时崩溃没有回滚兜底，" +
      "别人的在飞改动会被变异中途的写盘永久盖掉。停摆是损失，越权是损坏",
    apply: (s) => s.replace("    runnable: entries.filter((e) => !refusedIds.has(e.id)).map((e) => e.id),", "    runnable: entries.map((e) => e.id),"),
    expectFail: "不安全的一条都不许进 runnable（跳过要真跳过，别只看名单照样跑）",
  },
  {
    id: "gym-draft-failed-write-counted-as-change",
    src: "src/agent/gym/draft.ts",
    test: "tests/gym-draft.test.ts",
    desc: "写失败的笔次也算进「候选必改集」⇒ 一条半途而废的会话会被固化成『这些文件必须改』，" +
      "而那份尺子的判据来自一次没做完的尝试（草稿面最容易犯的错：把「发生过」读成「应该发生」）",
    apply: (s) => s.replace("        if (e.ok) written.add(p);\n        else failedWrites++;", "        written.add(p);"),
    expectFail: "写失败的那笔不进候选集，且点名「先确认这条轨迹值不值得固化」",
  },
  {
    id: "gym-draft-worker-writes-as-parent",
    src: "src/agent/gym/draft.ts",
    test: "tests/gym-draft.test.ts",
    desc: "worker 子流的写盘算进 parent 的候选集 ⇒ case 的「必改文件」里出现一批 parent 从没碰过的路径" +
      "（#8 那族归因缺陷的第四面：事件带 agent_id 却不看它的消费方）",
    apply: (s) => s.replace("if (e.agent_id !== undefined) { workerWrites++; break; }", "if (false) { workerWrites++; break; }"),
    expectFail: "worker 子流的写盘与验证都不算 parent 的（agent_id 在场即排除，并出声）",
  },
  {
    id: "gym-draft-worker-verify-as-parent",
    src: "src/agent/gym/draft.ts",
    test: "tests/gym-draft.test.ts",
    desc: "同上一条的另一格：**验证**证据的归因。worker 验绿会被写成 parent 的 mustPassVerify=true ⇒ " +
      "一条 parent 从未验证过的轨迹拿到一份「必须验绿」的判据",
    apply: (s) => s.replace("        if (e.agent_id !== undefined) break;\n        verifyAttempts++;", "        verifyAttempts++;"),
    expectFail: "worker 子流的写盘与验证都不算 parent 的（agent_id 在场即排除，并出声）",
  },
  {
    id: "gym-draft-worker-result-as-parent-failure",
    src: "src/agent/gym/draft.ts",
    test: "tests/gym-draft.test.ts",
    desc: "同一条不变量的**第三面**：agent_id 只在 tool_call 与 verify_result 上挡，tool_result 不挡。" +
      "provider 缺省 callId 是**流内序号**（openai 两处 `c.id ?? \`call-${index}\``、gemini `gemini-call-${seq++}`）⇒ " +
      "BYOK 的端点不给 id 时，parent 与每个 worker 都从 call-0 开始，worker 的失败结果会命中 parent 的 callPath，" +
      "凭空给这条轨迹加上「写盘失败 ⇒ 不值得固化」（真流量样本 0 撞号：那条 GLM 自带 id，所以这是取料面补全，不是现状修复）。" +
      "2026-09-23 改指：半截轨迹那三行插在了闸与 `callPath` 之间，旧的两行针脚不再相邻",
    apply: (s) => s.replace("        if (e.agent_id !== undefined) break;\n        const left = (pending.get(e.callId) ?? 0) - 1;", "        const left = (pending.get(e.callId) ?? 0) - 1;"),
    expectFail: "callId 撞名（provider 缺省 id 是流内序号）：worker 的失败结果不算 parent 写坏，parent 自己的仍算",
  },
  {
    id: "gym-draft-emits-expect-despite-unknown-verify",
    src: "src/agent/gym/draft.ts",
    test: "tests/gym-draft.test.ts",
    desc: "会话没验过时也产 expect ⇒ mustPassVerify 落成一个猜的值（null/false）。" +
      "「不知道」写成「不通过」与写成「通过」同样是伪造判据，差别只在方向",
    apply: (s) => s.replace("  if (d.verifyOk !== null) {", "  if (true) {"),
    expectFail: "verify 未知 ⇒ 不产 expect.candidate.json；验过 ⇒ 产，且文件名带 candidate",
  },
  {
    id: "gym-case-path-guard-dropped",
    src: "src/agent/gym/case.ts",
    test: "tests/gym-draft.test.ts",
    desc: "索引条目「必须落在 cases/ 内」这道守卫被删 ⇒ 一条指向 ../drafts/x 的条目会以判据身份被跑，" +
      "而 A3 的 sha256 冻结只 walk cases ⇒ 改它没人发现（未跟踪的草稿伪装成已冻结的尺子）",
    apply: (s) => s.replace("    if (bad !== null) throw new Error(", "    if (false) throw new Error("),
    expectFail: "loadGymIndex 遇到逃逸条目直接抛（fail-loud，不静默跳过）",
  },
  {
    id: "gym-draft-repo-prefix-by-substring",
    src: "src/agent/gym/draft.ts",
    test: "tests/gym-draft.test.ts",
    desc: "「有靶子」按子串配而不是按路径段配 ⇒ 一份叫 `repo-notes.md` 的散文件就把整条核对判成齐件，" +
      "人照着提示去 promote 一条没有靶子的 case（消费端最容易犯的错：把「看着像」读成「是」）",
    apply: (s) => s.replace('if (!relPaths.some((p) => p.startsWith("repo/")))', 'if (!relPaths.some((p) => p.startsWith("repo")))'),
    expectFail: "`repo-notes.md` 不算靶子：前缀按路径段配，不按子串（漏了斜杠会把同名散文件读成已齐件）",
  },
  {
    id: "gym-draft-candidate-wording-collapsed",
    src: "src/agent/gym/draft.ts",
    test: "tests/gym-draft.test.ts",
    desc: "「只有自动候选、还没人核」与「连候选都没有」共用一句 ⇒ 人分不清这条是**等我核**还是**上游没跑过**，" +
      "两种下一步动作完全相反（前者去比对 expect.candidate.json，后者回去生成草稿）",
    apply: (s) => s.replace('      ? "expect.json：只有自动出的候选集，还没人把它核成判据"', '      ? "expect.json：既没有判据也没有候选集"'),
    expectFail: "只有自动候选时点名「还没人把它核成判据」，而不是与「什么都没有」共用一句",
  },
  {
    id: "gym-draft-negative-exempt",
    src: "src/agent/gym/draft.ts",
    test: "tests/gym-draft.test.ts",
    desc: "A2 反例控制从核对表里免检 ⇒ 「尺子能判失败」这件事重新变回没人查；一条只有正例的 case 可以一路 promote 进冻结面",
    apply: (s) => s.replace('  if (!set.has("negative.json")) out.push(', '  if (false) out.push('),
    expectFail: "negative.json 缺席必须点名——没有反例的尺子证不了自己能量到失败",
  },
  {
    id: "gym-draft-ready-ignores-expect",
    src: "src/agent/gym/draft.ts",
    test: "tests/gym-draft.test.ts",
    desc: "expect 面整个不查 ⇒ 只有 task.md + repo/ 的目录被判成「可 promote」，而判卷文件还在候选状态" +
      "（放行侧那条「四件齐 ⇒ 零 blocker」的用例保证这里不是靠「凡目录都报缺」蒙绿）",
    apply: (s) => s.replace('  if (!set.has("expect.json")) {', '  if (false) {'),
    expectFail: "只有自动候选时点名「还没人把它核成判据」，而不是与「什么都没有」共用一句",
  },
  {
    id: "map-haserror-drops-whole-file",
    src: "src/agent/map/parse.ts",
    test: "tests/map-parse.test.ts",
    desc: "退回「hasError ⇒ 整文件一票否决」⇒ 合法 TS 只要有一处 grammar 误报（类型位置里的 " +
      "`import(\"pkg\").T`、`vi.mock` 里 `importOriginal<typeof import(...)>()`、含双斜杠的正则字面量）" +
      "就在符号图里**完全不存在**：实测本仓 4 个合法文件如此（含 parse.ts 自己），召回从 0.9991 掉回 0.9863，" +
      "而读端只会说「这张图里没有这个符号」",
    apply: (s) => s.replace("    const query = await queryFor(lang, loaded);", "    if (tree.rootNode.hasError) return [];\n    const query = await queryFor(lang, loaded);"),
    expectFail: "真仓库里那四个曾被一票否决的文件，如今每个都有定义入图（回归现场比合成夹具更硬）",
  },
  // ---- 自愈这条手段自己的判卷（2026-09-23）：`leftoverActionOf` / `budgetMsOf` 决定的是
  // 「要不要拿备份盖掉盘上的源文件」，判错一分支就是**不可逆地覆盖别人的改动** ⇒ 每支都要有反面对手。
  {
    id: "leftover-heal-ignores-is-our-mutant",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "去掉 `isOurMutant` 这道闸 ⇒ 只要「备份 == HEAD 且当前 != HEAD」就自动覆盖，" +
      "而这两条对「备份落盘后别人自己改了同一个文件」同样成立：一次自愈就能把别人的在飞改动抹掉",
    apply: (s) => s.replace("if (current === null || !isOurMutant)", "if (current === null)"),
    expectFail: "反面对手：同样三份内容，但当前那份对不上任何锚点 ⇒ 绝不自动盖（可能是别人的在飞改动）",
  },
  {
    id: "leftover-heal-trusts-non-head-backup",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "去掉「备份必须 == HEAD」这道闸 ⇒ 拿一份对不上 HEAD 的备份去盖源文件。" +
      "备份内容不等于 HEAD 时它可能是别人未提交的原件，这时候连「只删备份」都不该自动做",
    apply: (s) => s.replace("if (backup !== head) return", "if (false && backup !== head) return"),
    expectFail: "备份 != HEAD ⇒ manual（备份里可能是别人未提交的原件，即便当前内容对得上锚点也不许盖）",
  },
  {
    id: "budget-missing-value-silent",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "`--budget-ms` 后面没给值时退化成「不限」且不出声 ⇒ 写的人以为自己给了预算，" +
      "实际在跑全表，正是被外层超时杀在突变那一拍的形状（未知 flag 同族：看不懂不能当缺省）",
    apply: (s) => s.replace("if (i >= 0 && flag === undefined) return { ms: 0,", "if (false && flag === undefined) return { ms: 0,"),
    expectFail: "非法预算不许静默退化成「没设」（写的人以为给了预算）",
  },
  {
    id: "budget-value-slot-treated-as-anchor-id",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "分流不吞带值 flag 的下一个 token ⇒ `--budget-ms 600000` 里的 600000 被当成锚点 id 报「未知 id」，" +
      "于是没人能给这张表设预算（而预算正是别被掐死在突变那一拍的手段）",
    apply: (s) => s.replace("consumed.add(i + 1);", "consumed.add(-1); // 值位没被吞"),
    expectFail: "`--budget-ms 600000` 的值不是锚点 id（旧分流会报「未知 id 600000」，等于没人能设预算）",
  },
  // ---- HEAD 归属两面判据（2026-09-23，追加九–十二）：判据自己也得有分辨力。
  //      接线那两格怎么钉：`.mjs` 不过 tsc（tsconfig 的 include 有 scripts/ 但没开 allowJs），
  //      少喂一支面、少算一支数都不会有编译期信号 ⇒ 把两件事搬进 lib 并让求和处**当场崩**
  //      （`anchorFaces` / `blockingTotalOf`，下面三根针钉它们的失效方式）。
  //      仍然没钉、也不假装已覆盖的一格：接线**不去调用**这两个函数（改回内联手搓）——那要 vm-slice 真跑
  //      `reportNeedles` 才量得到，本仓不用"源码形状断言"充数 ⇒ 留名在任务 #63。
  {
    id: "untracked-face-filter-always-empty",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "把「未被 git 跟踪的锚点面」判成恒空 ⇒ 整条 HEAD 归属判据退化成装饰：主树照旧全绿，" +
      "而锚点守护的代码从未入库（追加九实测：主树阻断 0 / 同 HEAD 隔离树阻断 6）",
    apply: (s) => s.replace("return items.filter((p) => !isTracked(p.path));", "return [];"),
    expectFail: "盘上有、HEAD 里没有 ⇒ 点出来（含 id、路径与是哪一面，能直接照着补提交）",
  },
  {
    id: "untracked-line-judge-face-uses-src-wording",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "判卷面套用被测面的文案 ⇒ 报告说「源文件读不到」，而真因是判卷文件从未入库（干净 HEAD 上连基线都跑不出来，" +
      "却被伪装成「基线不是全绿」）；两面的修法指不同文件，串了就误导",
    apply: (s) => s.replace('const symptom = p.what === "判卷"', 'const symptom = false && p.what === "判卷"'),
    expectFail: "判卷面缺文件说「连基线都跑不出来」并指向判卷文件，不写「源文件读不到」（两面修法指不同文件）",
  },
  {
    id: "untracked-line-judge-fix-points-at-src-file",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "判卷面的修法一句写死成「把那份源文件提交」⇒ 照着做会去提交一份本来就入库了的源文件，" +
      "而缺的那份判卷文件仍然没有进 HEAD（门继续红，且没人知道要提交什么）",
    apply: (s) => s.replace('const target = p.what === "判卷" ? "判卷文件" : "源文件";', 'const target = "源文件";'),
    expectFail: "判卷面缺文件说「连基线都跑不出来」并指向判卷文件，不写「源文件读不到」（两面修法指不同文件）",
  },
  {
    id: "drift-double-reports-disk-problems",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "去掉「盘上已报过就不重复报」⇒ 同一条锚点同时进「针脚失效」与「钉在飞文本」两栏，" +
      "汇总的阻断数被同一件事抬高两次（读的人按数去找缺陷，会多算一半）",
    apply: (s) => s.replace("return head.filter((p) => !reported.has(p.id) && !pathsNotInHead.has(p.srcRel));",
      "return head.filter((p) => !pathsNotInHead.has(p.srcRel));"),
    expectFail: "盘上已经报过的同一条不重复报（一行红只有一个成因，读的人不必对两行）",
  },
  {
    id: "drift-double-counts-untracked-path",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "去掉「路径未入库的归上一条管」⇒ 一个从未入库的文件既进「未入库面」又进「钉在飞文本」，" +
      "两栏各说一种成因、指向两种修法，而它只有一个",
    apply: (s) => s.replace("return head.filter((p) => !reported.has(p.id) && !pathsNotInHead.has(p.srcRel));",
      "return head.filter((p) => !reported.has(p.id));"),
    expectFail: "HEAD 里读不到、且该路径已由「未入库」判据报过 ⇒ 不重复报（同一件事两栏都记 = 数被抬高）",
  },
  {
    id: "anchor-faces-drops-judge-face",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "取料入口少 push 判卷那一支 ⇒ 接线只剩一面在查，未入库的判卷文件从此无人点名" +
      "（干净 HEAD 上那些锚点仍会伪装成「基线不是全绿」，而 lib 单测看不见——它拿到的是手搓 items）",
    apply: (s) => s.replace('    out.push({ id: e.id, path: e.test, what: "判卷" });', "    // 判卷那一支没喂"),
    expectFail: "每条锚点产出两支面（被测面 + 判卷），且两面各一次（少喂一支 = 那一面静默失效）",
  },
  {
    id: "blocking-total-drops-drift-from-sum",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "求和写死成漏掉 drift ⇒ 「钉在飞文本」照旧印在汇总里、却不再决定 exit：" +
      "门报红而全量门禁照样绿（有读数、无后果，正是本仓最忌的形状）",
    apply: (s) => s.replace("return BLOCKING_KEYS.reduce((n, k) => n + parts[k], 0);",
      "return parts.needle + parts.duplicateIds + parts.untracked;"),
    expectFail: "四支数都给 ⇒ 求和（0 也算数，不许被当成缺项丢掉）",
  },
  {
    id: "blocking-total-swallows-missing-part",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "去掉「缺一支就当场崩」这道闸 ⇒ 接线漏计一支时照样吐出一个数（NaN 也会被 `+` 吞成读数），" +
      "而 `.mjs` 不经 tsc，没有任何东西会替这道门发现它少看了一维",
    apply: (s) => s.replace("if (missing.length > 0) {", "if (false && missing.length > 0) {"),
    expectFail: "缺一支 ⇒ 抛并点名缺哪支（门报红却少算一维 = 这条门唯一的产出被废）",
  },
  // ---- 半截轨迹（2026-09-23，在唯一一条真·持久化会话上量到：`run_shell` 那一笔没有结果，
  //      而草稿当时的清单对这一格一字未提）。同一条 agent_id 闸现在**同时**守着两支消费：
  //      callPath 归因与 pending 配对 ⇒ 按规则 69，改这一行必须两条锚点各点一个名，
  //      否则将来谁删了其中一支用例，另一支会静默失去守门人。
  {
    id: "gym-draft-half-open-pairing-ignores-agent-id",
    src: "src/agent/gym/draft.ts",
    test: "tests/gym-draft.test.ts",
    desc: "结果侧那道 agent_id 闸被摘 ⇒ worker 的结果去销 parent 的账。缺省 callId 是流内序号，" +
      "两边都有 `call-0`：一条被切断的 parent 轨迹会被子流「答」成完整，那条「半截」永远不报",
    apply: (s) => s.replace("        if (e.agent_id !== undefined) break;\n        const left = (pending.get(e.callId) ?? 0) - 1;", "        const left = (pending.get(e.callId) ?? 0) - 1;"),
    expectFail: "撞号时 worker 的结果不许把 parent 的调用**假答**掉（配对面的 agent_id 闸）",
  },
  {
    id: "gym-draft-half-open-counts-worker-calls",
    src: "src/agent/gym/draft.ts",
    test: "tests/gym-draft.test.ts",
    desc: "调用侧不再区分父子流 ⇒ worker 没结果的那几笔被算成 parent 的半截。" +
      "后果是把「worker 还在跑」读成「这条轨迹断在半路」，而 parent 其实一行不差地走完了",
    apply: (s) => s.replace("        if (e.agent_id === undefined) pending.set(e.id, (pending.get(e.id) ?? 0) + 1);", "        pending.set(e.id, (pending.get(e.id) ?? 0) + 1);"),
    expectFail: "worker 子流自成一对 ⇒ 不算 parent 的半截（同一支闸的另一侧）",
  },
  {
    id: "gym-draft-half-open-blocker-dropped",
    src: "src/agent/gym/draft.ts",
    test: "tests/gym-draft.test.ts",
    desc: "「有 N 次工具调用没有结果」这条不出现在「还缺」清单里 ⇒ 半截轨迹与完整轨迹在草稿面上同形，" +
      "而被冻结成 case 之后每次回放都在学一个不存在的终局",
    apply: (s) => s.replace("if (unansweredCalls > 0) missing.push(", "if (false) missing.push("),
    expectFail: "末笔调用没有结果 ⇒ 点名「半截」并带笔数（真实形状：run_shell 无结果）",
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
    expectFail: "旧机器（JSON 里压根没这个键）读回来必须是 true",
  },
  {
    id: "settings-auto-verify-default-reverted",
    src: "src/main/settings.ts",
    test: "tests/settings.test.ts",
    desc: "缺省被悄悄改回关 ⇒ §483 的「桌面产品默认开」失效，能力 5 的收束闸退回零真流量" +
      "（09-19 设计稿 D7 记的就是这串默认关造成的『永远未证』）",
    apply: (s) => s.replace("  autoVerify: true,", "  autoVerify: false,"),
    expectFail: "DEFAULT_SETTINGS 与读盘回退同向（翻一处忘另一处 = 老用户永远拿不到新默认）",
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
  {
    id: "pc-serialize-layer-keeps-closing-bracket",
    src: "src/agent/prefix-churn.ts",
    test: "tests/prefix-churn.test.ts",
    desc: "序列化留着数组尾那个右方括号 ⇒ 纯追加永远差一个括号，PC1 整条判据失灵",
    apply: (s) => s.replace("  return JSON.stringify(items).slice(0, -1);", "  return JSON.stringify(items);"),
    expectFail: "serializeLayer 去掉数组尾 ⇒ 纯追加时上一轮整串就是本轮的前缀",
  },
  {
    id: "pc-pure-append-always-true",
    src: "src/agent/prefix-churn.ts",
    test: "tests/prefix-churn.test.ts",
    desc: "纯追加判定恒真 ⇒ 中段重写（prune 改写历史中段那一族）再也判不出红",
    apply: (s) => s.replace("    pureAppend: stableChars === prevLayer.length,", "    pureAppend: stableChars >= 0,"),
    expectFail: "PC1 纯追加真、中间摘假、无相邻对时判红（无分辨力不许当通过）",
  },
  {
    id: "pc-volatile-changed-conjunct-dropped",
    src: "src/agent/prefix-churn.ts",
    test: "tests/prefix-churn.test.ts",
    desc: "只看「可缓存面没变」不看「易变块真的变了」⇒ 什么都不动的样本也能报通过（本仓最忌的真空通过）",
    apply: (s) => s.replace("    ok: faces.size === 1 && volatileChanged,", "    ok: faces.size === 1,"),
    expectFail: "PC2 的「无分辨力」本身判红：易变块整轮不变时不许报通过",
  },
  {
    id: "pc-face-change-named-shortcut",
    src: "src/agent/prefix-churn.ts",
    test: "tests/prefix-churn.test.ts",
    desc: "「有没有出声」直接当真 ⇒ 工具面静默变化这一族从判据里消失",
    apply: (s) => s.replace("    const named = (now.faceNote ?? \"\").length > 0 || (before.faceNote ?? \"\").length > 0;", "    const named = true;"),
    expectFail: "PC3 变了且点名 = 过；变了不点名 = 红；一次都没变 = 红（无分辨力）",
  },
  {
    id: "pc-determinism-count-hardcoded",
    src: "src/agent/prefix-churn.ts",
    test: "tests/prefix-churn.test.ts",
    desc: "降配抖动计数写死成 1 ⇒ 每轮重写一遍前缀的代价再也量不出来",
    apply: (s) => s.replace("  const distinct = new Set(faces).size;", "  const distinct = 1;"),
    expectFail: "PC4 同一份超限面装配多次必须逐字同一；遍历顺序一抖就红",
  },
  {
    id: "pc-attribution-ignores-evidence",
    src: "src/agent/prefix-churn.ts",
    test: "tests/prefix-churn.test.ts",
    desc: "「抖了但没有认账来源」不再算静默重写 ⇒ 压缩/裁剪只要发生就一律放过，证据链失去意义",
    apply: (s) => s.replace("    silentRewrite: !reading.pureAppend && fired.length === 0,", "    silentRewrite: false,"),
    expectFail: "churnIsAttributed 四个象限：要求抖/不抖 × 有证据/无证据",
  },
  {
    id: "pc-first-rewrite-index-flattened",
    src: "src/agent/prefix-churn.ts",
    test: "tests/prefix-churn.test.ts",
    desc: "重写点一律报第 0 条 ⇒ 读数再也指不出「是哪一条被改」，而这条判据的全部价值就是定位",
    apply: (s) => s.replace("    firstRewriteIndex: reading.pureAppend ? -1 : indexOfOffset(offsets, reading.stableChars),", "    firstRewriteIndex: reading.pureAppend ? -1 : 0,"),
    expectFail: "attributeChurn：纯追加时不报重写点；中段改写时指到**被改的那一条**",
  },
  {
    id: "pc-silent-check-dropped-from-expect-rewrite",
    src: "src/agent/prefix-churn.ts",
    test: "tests/prefix-churn.test.ts",
    desc: "要求抖的那一支只看「抖没抖」不看证据 ⇒ PC5/PC6 退化成一条存在性断言",
    apply: (s) => s.replace("  const ok = expectRewrite ? rewrote.length > 0 && silent.length === 0 : rewrote.length === 0;", "  const ok = expectRewrite ? rewrote.length > 0 : rewrote.length === 0;"),
    expectFail: "churnIsAttributed 四个象限：要求抖/不抖 × 有证据/无证据",
  },
  {
    id: "cc-off-path-still-amortizes",
    src: "src/agent/compaction-cost.ts",
    test: "tests/compaction-cost.test.ts",
    desc: "去掉「未启用即原样」支 ⇒ 一条没被打开的策略开始改生产装配（缺省零行为是这类能力的底线）",
    apply: (s) => s.replace("  if (!opts.enabled) return undefined;", "  if (false) return undefined;"),
    expectFail: "缺省关 ⇒ 返回 undefined（调用方原样用旧配置，逐字节零回归）",
  },
  {
    id: "cc-overflow-guard-dropped",
    src: "src/agent/compaction-cost.ts",
    test: "tests/compaction-cost.test.ts",
    desc: "overflow 也摊销 ⇒ 已经装不下时少压一点，下一轮立刻再撞硬闸（fail-safe 被反向拆掉）",
    apply: (s) => s.replace("  if (opts.trigger === \"overflow\") return undefined;", "  if (false) return undefined;"),
    expectFail: "overflow 不摊销：已经装不下了，少压只会立刻再撞一次硬闸",
  },
  {
    id: "cc-only-one-tail-knob-tightened",
    src: "src/agent/compaction-cost.ts",
    test: "tests/compaction-cost.test.ts",
    desc: "只钉一个边界 ⇒ clamp 的另一只求值顺序会把它顶回原值（策略看着在跑其实什么都没做）",
    apply: (s) => s.replace("  return { tailMinTokens: next, tailMaxTokens: next };", "  return { tailMinTokens: next };"),
    // 2026-09-23 改指：测例改名成「上下限钉到同一个值」后，expectFail 还写着旧标题 ⇒ 表现为「变异存活」
    // （runner 判的是「红在期望那条用例上」，按子串比对）。语义未变，只是名字要跟住。
    expectFail: "tail 上下限被钉到同一个值 ⇒ clamp 两种求值顺序都得 next（不靠求值顺序赌）",
  },
  {
    id: "cc-floor-lets-working-set-shrink",
    src: "src/agent/compaction-cost.ts",
    test: "tests/compaction-cost.test.ts",
    desc: "去掉工作集下限 ⇒ 小 tail 预算被继续砍，策略从「省缓存」变成「忘事」",
    apply: (s) => s.replace("  return Math.max(Math.min(scaled, tailBudget), Math.min(floor, tailBudget));", "  return Math.min(scaled, tailBudget);"),
    expectFail: "已在下限就不动——不返回「等效但不同」的配置（守住逐字零回归的语义）",
  },
  {
    id: "cc-head-survival-never-recorded",
    src: "src/agent/glm-session.ts",
    test: "tests/compaction-cost.test.ts",
    desc: "每轮把上一轮装配清空 ⇒ 头部存活比永远量不出来，策略只在关那一支生效（A/B 读成「策略无效」）",
    apply: (s) => s.replace("        prevRequestLayer = requestLayer;", "        prevRequestLayer = \"\";"),
    expectFail: "开着 ⇒ 同一会话里压缩次数不更多、累计重写字符严格更少",
  },
  {
    id: "cc-coordinator-ignores-config-override",
    src: "src/agent/compaction.ts",
    test: "tests/compaction-cost.test.ts",
    desc: "逐次 config 覆盖被忽略 ⇒ 上游算了摊销也用不上（本仓点名的「两头断」形状）",
    apply: (s) => s.replace("      config: options.config ? { ...this.config, ...options.config } : this.config,", "      config: this.config,"),
    expectFail: "开着 ⇒ 同一会话里压缩次数不更多、累计重写字符严格更少",
  },
  {
    id: "lr-growth-invented-not-from-script",
    src: "src/agent/gym/probe.ts",
    test: "tests/gym-long-replay.test.ts",
    desc: "增长内容退回我编的字数 ⇒ 所有 case 量出同一张表，读数却写着 case 名（第一版真的这样跑通过）",
    apply: (s) => s.replace("  const growth = await scriptGrowthText(opts.scriptPath);", "  const growth = \"的\".repeat(2048);"),
    expectFail: "仪器读的是 case，不是我塞的字数：两条 case 的账单必须不同",
  },
  {
    id: "lr-empty-script-silently-accepted",
    src: "src/agent/gym/probe.ts",
    test: "tests/gym-long-replay.test.ts",
    desc: "剧本没正文时静默拼空串 ⇒ 长时程读数变成「只长了我塞的分隔符」",
    apply: (s) => s.replace("  if (joined === \"\") {", "  if (false) {"),
    expectFail: "剧本里没有可用正文时**拒绝跑**（宁可不量，也不拿编造内容当某条 case 的读数）",
  },
  {
    id: "lr-head-survival-claims-perfect-append",
    src: "src/agent/gym/probe.ts",
    test: "tests/gym-long-replay.test.ts",
    desc: "头部存活比恒报 1 ⇒ 「一次压缩作废 42 万字符」这类读数从此消失，摊销也就无从判有无效果",
    apply: (s) => s.replace("      headSurvival: reading ? reading.share : null,", "      headSurvival: reading ? 1 : null,"),
    expectFail: "续长的会话真的会被反复装配：requests = longTurns、历史在涨、且至少压一次（否则样本无分辨力）",
  },
  {
    id: "lr-compaction-count-ignores-evidence",
    src: "src/agent/gym/probe.ts",
    test: "tests/gym-long-replay.test.ts",
    desc: "压缩次数拿「抖了几次」冒充而不是数事件流 ⇒ 与 PC5/PC6 的认账口径分家，两个数从此互相矛盾",
    apply: (s) => s.replace("    compactions: compactionEvents,", "    compactions: 0,"),
    expectFail: "续长的会话真的会被反复装配：requests = longTurns、历史在涨、且至少压一次（否则样本无分辨力）",
  },
  {
    // 本条原盯 `differsOnlyByWallClock` 的开头那句提前返回——实测**变异存活**，因为那句是**冗余**：
    // 去掉后靠「替换毫秒后比对字符串」仍给出同值。那是快路径不是语义分支（与 ms-zero-regression 同族），
    // 别为它造针脚。这里改盯真正会被做错的判定：「条目没被用到」永远报成没问题 ⇒ 白名单只增不减。
    id: "rp-stale-debt-check-always-silent",
    src: "src/agent/reproducibility.ts",
    test: "tests/reproducibility.test.ts",
    desc: "登记债永远不算过期 ⇒ 白名单只增不减，清偿了也没人来删，下一条泄漏会顺手继承一个能吸收它的条目",
    apply: (s) => s.replace("    staleDebts: debts.filter((x) => !hitDebts.has(x.id)).map((x) => x.id),", "    staleDebts: [],"),
    expectFail: "requireDebtHit 只对「复查登记表」那条开——干净状态不该因为没踩到债而红",
  },
  {
    id: "rp-strip-observation-keeps-ts",
    src: "src/agent/reproducibility.ts",
    test: "tests/reproducibility.test.ts",
    desc: "观测字段没被剥掉 ⇒ 两次跑必然因 ts 不同而判红，门自己变成假红源",
    apply: (s) => s.replace("  return rest as T;", "  return event as T;"),
    expectFail: "stripObservation 只剥观测字段，判卷字段一个不动",
  },
  {
    id: "rp-debt-prefix-not-checked",
    src: "src/agent/reproducibility.ts",
    test: "tests/reproducibility.test.ts",
    desc: "债条目不看路径前缀 ⇒ 任何字段上的毫秒都被某条登记债吸收，「白名单只管登记过的位置」失效",
    apply: (s) => s.replace("    const debt = debts.find((x) => d.path.startsWith(x.pathPrefix) && differsOnlyByWallClock(d.left, d.right));", "    const debt = debts.find(() => differsOnlyByWallClock(d.left, d.right));"),
    expectFail: "白名单只管登记过的前缀；别处的毫秒一律算泄漏",
  },
  {
    id: "rp-clean-state-reads-red",
    src: "src/agent/reproducibility.ts",
    test: "tests/reproducibility.test.ts",
    desc: "「条目没被用到」的复查对所有判据开 ⇒ 干净的 HEAD（没有快照代码）被读成红——会冤枉好状态的判据比没有更糟",
    apply: (s) => s.replace("  const staleProblem = opts.requireDebtHit === true && finding.staleDebts.length > 0;", "  const staleProblem = finding.staleDebts.length > 0;"),
    expectFail: "requireDebtHit 只对「复查登记表」那条开——干净状态不该因为没踩到债而红",
  },
  {
    id: "pb-pressure-escape-removed",
    src: "src/agent/prune-batching.ts",
    test: "tests/prune-batching.test.ts",
    desc: "去掉「头寸紧就照剪」的逃生舱 ⇒ 为了少断前缀而把会话推到撞最终硬闸（fail-closed 变成会话失败）",
    apply: (s) => s.replace("  if (opts.estimatedTokens >= available * pressure) {", "  if (false) {"),
    expectFail: "头寸紧就必须照剪 —— 绝不因为攒批去撞最终硬闸",
  },
  {
    id: "pb-threshold-always-apply",
    src: "src/agent/prune-batching.ts",
    test: "tests/prune-batching.test.ts",
    desc: "门槛判定恒真 ⇒ 分批退化成旧行为，而门里 PC8 的对照还在报「策略有效」",
    apply: (s) => s.replace("  if (opts.savedTokens >= minSaved) {", "  if (true) {"),
    expectFail: "没攒够且头寸不紧 ⇒ 推迟（不断前缀）",
  },
  {
    id: "pb-disabled-path-still-defers",
    src: "src/agent/prune-batching.ts",
    test: "tests/prune-batching.test.ts",
    desc: "去掉「未启用即照旧」支 ⇒ 一条没人打开的策略改了生产装配（缺省零行为是底线）",
    apply: (s) => s.replace("  if (!opts.enabled) {", "  if (false) {"),
    expectFail: "未启用 ⇒ 恒照旧（零回归支），且理由写清",
  },
  {
    id: "pb-fresh-savings-counts-everything",
    src: "src/agent/prune-batching.ts",
    test: "tests/prune-batching.test.ts",
    desc: "增量把已发出去的几条也算进来 ⇒ 「永远已经攒够」，分批静默退化成逐轮剪（PC8 会红，但要先知道是这里）",
    apply: (s) => s.replace("  for (const [id, v] of savedByIdTokens) if (!alreadySent.has(id)) n += v;", "  for (const [, v] of savedByIdTokens) n += v;"),
    expectFail: "增量口径：已发出去的那几条不再算「攒到的量」（否则分批永远以为已经攒够）",
  },
  {
    id: "pb-wiring-passes-cumulative-not-fresh",
    src: "src/agent/glm-session.ts",
    test: "tests/prune-batching.test.ts",
    desc: "装配链把累计值递给策略（而不是增量）⇒ 策略算对了、判据照样无效果：本仓点名的「两头断」形状",
    apply: (s) => s.replace("              savedTokens: freshSavings(outcome.savedByIdTokens, prunedIdsSent),", "              savedTokens: outcome.savedTokens,"),
    expectFail: "PC8 那条 A/B 判据真能跑通（= pruneBatching 这个选项确实接到了装配链上）",
  },
  {
    id: "pb-free-ride-branch-removed",
    src: "src/agent/prune-batching.ts",
    test: "tests/prune-batching.test.ts",
    desc: "删掉「本轮已断过头就别攒」那条支路 ⇒ 压缩刚重写完整前缀，下一轮又为省未来的断再断一次（付两次钱只省了零次）",
    apply: (s) => s.replace("  if (opts.freeRide === true) {", "  if (false) {"),
    expectFail: "同一份输入：旗标 true 就剪、缺省就推迟（差别只允许出在旗标上）",
  },
  {
    id: "pb-free-ride-flag-sticky",
    src: "src/agent/glm-session.ts",
    test: "tests/prune-batching.test.ts",
    desc: "旗标取用后不清零 ⇒ 蹭的那一次断变成之后每轮都免检：分批策略整条失效（PC9 判的是集合相等，正是为这一形而生的）",
    apply: (s) => s.replace("      const freeRideNow = pruneFreeRide;\n      pruneFreeRide = false;", "      const freeRideNow = pruneFreeRide;"),
    expectFail: "PC9 那条集合相等判据真能跑通",
  },
  {
    id: "pb-free-ride-flag-never-set",
    src: "src/agent/glm-session.ts",
    test: "tests/prune-batching.test.ts",
    desc: "压缩成功后不置旗标 ⇒ 白断一次头却仍然攒着，下一轮再断一次（同一原理的另一头断）",
    apply: (s) => s.replace("          pruneFreeRide = true; //", "          pruneFreeRide = false; //"),
    expectFail: "PC9 那条集合相等判据真能跑通",
  },
  {
    id: "pb-object-threshold-ignored",
    src: "src/agent/glm-session.ts",
    test: "tests/prune-batching.test.ts",
    desc: "只认 `pruneBatching: true`、把对象形式丢掉 ⇒ 门的对照臂（门槛=1）实际跑的是生产 40k 门槛，于是「只有压缩轮落盘」可能只是别的轮没活——主判据的对照变空",
    apply: (s) => s.replace('          typeof opts.pruneBatching === "object" && opts.pruneBatching !== null ? opts.pruneBatching : {};', "          false ? opts.pruneBatching : {};"),
    expectFail: "PC9 那条集合相等判据真能跑通",
  },
  /* ---------- 能力 14：无进展检测（stagnation）的判据锚点 ---------- */
  /* ---------- 能力 15：成本 ÷ 前进（cost-per-progress）---------- */
  {
    id: "cpp-worker-into-numerator",
    src: "src/agent/cost-per-progress.ts",
    test: "tests/cost-per-progress.test.ts",
    desc: "归属拆分把 worker 的 usage 也算进主面 ⇒ 分母（只算主面的前进边界）不变、分子变大，fanout 那种形状上比值直接翻 4 倍（本轮实测就是这么抓出来的）",
    apply: (s) => s.replace("      workerTokens += t;", "      mainTokens += t;"),
    expectFail: "worker 的 usage 一律落在 workerTokens/byAgent，绝不进 mainTokens",
  },
  {
    id: "cpp-zero-boundary-ratio-zero",
    src: "src/agent/cost-per-progress.ts",
    test: "tests/cost-per-progress.test.ts",
    desc: "零前进被写成「每边界 0 token」⇒ 读起来像「没花钱」，而真实红跑花了 68,535",
    apply: (s) => s.replace("      excludedWorkerTokens: split.workerTokens, tokensPerBoundary: null,", "      excludedWorkerTokens: split.workerTokens, tokensPerBoundary: 0,"),
    expectFail: "真实红跑：零 verified ⇒ 不可测（不是 0 也不是 Infinity），整笔主面就是死跑成本",
  },
  {
    id: "cpp-dead-spend-hidden",
    src: "src/agent/cost-per-progress.ts",
    test: "tests/cost-per-progress.test.ts",
    desc: "零前进时死跑成本归 0 ⇒ stop-policy 最想切的那一段（最后一次前进之后还在花）恰恰读不到",
    apply: (s) => s.replace("      spendAfterLastBoundary: split.mainTokens, lastBoundaryEventId: null,", "      spendAfterLastBoundary: 0, lastBoundaryEventId: null,"),
    expectFail: "真实红跑：零 verified ⇒ 不可测（不是 0 也不是 Infinity），整笔主面就是死跑成本",
  },
  {
    id: "cpp-skipped-not-named",
    src: "src/agent/cost-per-progress.ts",
    test: "tests/cost-per-progress.test.ts",
    desc: "均值把不可测样本静默丢掉而不点名 ⇒ 「每前进一份花多少」成了编的（读者无从知道分母是谁）",
    apply: (s) => s.replace("  const skipped = rows.filter((r) => !r.cost.measurable).map((r) => r.id + \":\" + String(r.cost.reason));", "  const skipped: string[] = [];"),
    expectFail: "跳过项点名且 used 只数可测的",
  },
  {
    id: "cpp-coverage-toothless",
    src: "src/agent/cost-per-progress.ts",
    test: "tests/cost-per-progress.test.ts",
    desc: "分母体检只看「有没有成功跑」，不看「取不取得到边界」⇒ 全空的分面会被读成健康",
    apply: (s) => s.replace("  const ok = green.length >= 2 && withBoundary.length >= 1 && redWithout.length >= 1;", "  const ok = green.length >= 2;"),
    expectFail: "分母体检要有分辨力：成功跑全取不到边界、或没有零前进的失败样本，都判红",
  },
  {
    id: "np-green-verify-filtered-away",
    src: "src/agent/no-progress.ts",
    test: "tests/no-progress.test.ts",
    desc: "先把绿的那次 verify filter 掉再走序列 ⇒ 「红-绿-红」被读成连续两次红：中间曾经成功过一次这件事被抹掉（本仓测例当场抓住的真 bug）",
    apply: (s) => s.replace("    if (cur.ok) { run = 0; lastRed = null; continue; }", "    if (cur.ok) { continue; }"),
    expectFail: "绿一次再红 ⇒ 序列被截断",
  },
  {
    id: "np-write-suppression-ignored",
    src: "src/agent/no-progress.ts",
    test: "tests/no-progress.test.ts",
    desc: "不许抑制条件失效：两次红之间只要落过盘，那就是「换个路子再试」，归既有 verify 上限管——把它读成停滞就是误伤",
    apply: (s) => s.replace("    run = sameKey && !cur.wroteSinceLast ? run + 1 : 1;", "    run = sameKey ? run + 1 : 1;"),
    expectFail: "中间有成功的写 ⇒ 不报",
  },
  {
    id: "np-signature-drops-failing-line",
    src: "src/agent/no-progress.ts",
    test: "tests/no-progress.test.ts",
    desc: "签名只剩命令名（把归一化后的失败行丢掉）⇒ 「修好 a.test.ts 又撞上 b.test.ts」成了同一条结论连红：归一化抹太狠的那一侧",
    apply: (s) => s.replace("    keys.push(command + \"#\" + normalizeFailureLine(bad));", "    keys.push(command);"),
    expectFail: "六条规则全绿（复用门里同一只判据，测例不另搭一套）",
  },
  {
    id: "np-unmeasured-rule-escalated",
    src: "src/agent/no-progress.ts",
    test: "tests/no-progress.test.ts",
    desc: "把真实语料上零触发（既没证明有用也没证明无害）的往返规则提到 escalate ⇒ 分级不再由测量决定，外部那种「重 grep 被判环直接 exit 1」的错法就回来了",
    apply: (s) => s.replace('    promote("note", "alternating_thrash", signals.thrash.evidence);', '    promote("escalate", "alternating_thrash", signals.thrash.evidence);'),
    expectFail: "本模块绝不主动终止：action-shaped 再多次也只到 directive",
  },
  {
    id: "np-evidence-not-named",
    src: "src/agent/no-progress.ts",
    test: "tests/no-progress.test.ts",
    desc: "报警不指名（只说「卡住了」不说卡在哪一件）⇒ 模型无从换路，检测器等于装饰",
    apply: (s) => s.replace("cur.named.join(\"；\").slice(0, 400)", "String(run)"),
    expectFail: "真实红录制：报，且证据里点名了那条 pnpm 命令与错误码",
  },
  {
    // 这条针脚第一次钉在**门里那条规则的 ok** 上，实测存活（`ok: true` 在冻结表与语料一致时
    // 与正确实现逐字同结果）⇒ 换钉到那只纯函数的两个分支上：不判「不在表上」与不判「哈希不符」。
    // 留下这条记录：判"某条规则有没有分辨力"，喂进针脚的必须是**能被观测到的那只函数**。
    id: "np-freeze-missing-entry-ignored",
    src: "scripts/no-progress-check.ts",
    test: "tests/no-progress.test.ts",
    desc: "冻结对账不查「语料文件不在表上」⇒ 悄悄撤掉一条登记（或换一份文件）不会留下任何读数",
    apply: (s) => s.replace("  const drift = rels.filter((rel) => frozen[rel] === undefined || (actuals[rel] !== undefined && frozen[rel] !== actuals[rel]));", "  const drift = rels.filter((rel) => actuals[rel] !== undefined && frozen[rel] !== actuals[rel]);"),
    expectFail: "NP5：不在表上的语料文件必须红（翻标签的门路之一）",
  },
  {
    id: "np-freeze-hash-mismatch-ignored",
    src: "scripts/no-progress-check.ts",
    test: "tests/no-progress.test.ts",
    desc: "冻结对账只查「在不在表上」不查哈希 ⇒ 改一份事件文件（比如把红跑的失败结论改掉）照样全绿",
    apply: (s) => s.replace("  const drift = rels.filter((rel) => frozen[rel] === undefined || (actuals[rel] !== undefined && frozen[rel] !== actuals[rel]));", "  const drift = rels.filter((rel) => frozen[rel] === undefined);"),
    expectFail: "NP5：不在表上的语料文件必须红（翻标签的门路之一）",
  },
  {
    id: "pb-control-arm-always-wired",
    src: "src/agent/prune-batching.ts",
    test: "tests/prune-batching.test.ts",
    desc: "对照臂恒判「旋钮接得上」⇒ PC9 那半边成了装饰，主判据退化成「反正没别的能放行」的恒真式",
    apply: (s) => s.replace("    ok: stray >= 1,", "    ok: true,"),
    expectFail: "对照臂判据：门槛旋钮接得上",
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
    desc: "未登记 env 名的 provider 不崩、静默借用 glm 的变量名 ⇒ 白名单加一家而忘了登记映射时，用户以为「存了 key 就生效」，实际拿 M0_API_KEY 去拨别家",
    apply: (s) => s.replace("    const envName = envKeyOf(provider);", '    const envName = envKeyOf(provider) ?? "M0_API_KEY";'),
    expectFail: "未登记 env 名映射的 provider：崩，不许静默跳过那一家",
  },
  {
    id: "byok-offered-checked-against-wrong-face",
    src: "src/providers/byok.ts",
    test: "tests/providers.test.ts",
    desc: "设置面越界那格拿 env 表当对照面（env 表四家全含）⇒「UI 给了个存不进 key 的选项」这条永不成立，正是本仓点名的「只在一面对账」",
    apply: (s) => s.replace("offeredNotStorable: setDiff(f.offered.filter((p) => p !== DEMO_PROVIDER), f.storable),", "offeredNotStorable: setDiff(f.offered.filter((p) => p !== DEMO_PROVIDER), f.envKeyed),"),
    expectFail: "逐格破坏：每支取料面失效只点亮它自己那一格",
  },
  {
    id: "byok-storable-injection-checked-against-table",
    src: "src/providers/byok.ts",
    test: "tests/providers.test.ts",
    desc: "「可存 key ⇒ 被注入」那格改成查 env 表而不是看注入面的实际结果 ⇒ 判据退化成自己跟自己比（表里有就算覆盖），跑真函数那一半失去观测者",
    apply: (s) => s.replace("storableNotInjected: setDiff(f.storable, f.injected),", "storableNotInjected: setDiff(f.storable, f.envKeyed),"),
    expectFail: "逐格破坏：每支取料面失效只点亮它自己那一格",
  },
  // ── D-8 复跑面登记表（两张格各钉一半：引用无源 / 陈旧登记——缺任一侧，登记表就会静默烂掉）
  {
    id: "replay-unregistered-refs-blinded",
    src: "scripts/replay-readings.ts",
    test: "tests/docs-check.test.ts",
    desc: "「引用无源」那格恒空 ⇒ 文档写 replay:<id> 而登记表没这项时门全绿——而这正是本判据要拦的第一种腐（那句话本来就是死的）",
    apply: (s) => s.replace("unregisteredRefs: [...new Set(referenced.filter((id) => !ids.has(id)))],", "unregisteredRefs: [],"),
    expectFail: "引用了未登记的 id ⇒ 红，且 detail 点名那个 id",
  },
  {
    id: "replay-unreferenced-ids-blinded",
    src: "scripts/replay-readings.ts",
    test: "tests/docs-check.test.ts",
    desc: "反向一侧恒空 ⇒ 登记表只进不出：脚本改名/删掉后表项烂在那儿，等下一个人引用它才发现（清单缺反向就等于装饰）",
    apply: (s) => s.replace("unreferencedIds: [...ids].filter((id) => !referencedSet.has(id)),", "unreferencedIds: [],"),
    expectFail: "登记了却没人引用 ⇒ 红（陈旧登记，与上一条反向）",
  },

  // ── D-8 复跑面的零语料体检（两格各钉一半：没扫到 / 扫到却认不出）
  {
    id: "replay-corpus-empty-blinded",
    src: "scripts/replay/corpus.ts",
    test: "tests/replay-corpus.test.ts",
    desc: "「一个文件都没扫到」这格恒假 ⇒ 干净 checkout（会话流不在 git 里）上复跑命令照样退出 0，「没有尺」之身冒充真读数；另一格的文案不算覆盖，因为那句说的是「形状漂了」而真相是根本没料",
    apply: (s) => s.replace("  if (scan.files.length === 0) {", "  if (false) { // BLINDED"),
    expectFail: "一个 .jsonl 也没扫到 ⇒ 报，且那句话点名扫描根与不存在的那一支",
  },
  {
    id: "replay-corpus-nocalls-blinded",
    src: "scripts/replay/corpus.ts",
    test: "tests/replay-corpus.test.ts",
    desc: "「有文件却零 tool_call」这格恒假 ⇒ 事件名/字段一漂，那片零（受管=0 ask=0）照样被当成读数念出去（2026-09-21 的 join 键事故就是这个形状）",
    apply: (s) => s.replace("  if (toolCalls === 0) {", "  if (false) { // BLINDED"),
    expectFail: "扫到了文件却一条 tool_call 也没有 ⇒ 报（认不出不等于没有，正是 09-21 那片零的形状）",
  },

  // ── verify 归因的三处出口（每处一条，各指自己的用例；合取由"缺一即红"保证）
  {
    id: "verify-exit-attempt-env-blind",
    src: "src/agent/loop.ts",
    test: "tests/verify-attribution-exits.test.ts",
    desc: "loop「这一拍是环境拍」那格恒假 ⇒ 工具链没装/超时/pnpm 拒执行照样吃掉 maxVerify 一格，模型收到的是「连续失败已达上限」：harness 的问题花用户的钱，还教它去改本来正确的代码",
    apply: (s) => s.replace("const envBeat = isEnvVerifyCause(cause);", "const envBeat = false;"),
    expectFail: "出口①：环境拍不占 maxVerify 修复额度，走自己的上限并说明停因",
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
    id: "verify-exit-distill-env-blind",
    src: "src/agent/memory/distill.ts",
    test: "tests/verify-attribution-exits.test.ts",
    desc: "沉淀那格恒假 ⇒ 环境红进「N 次验证失败」（并顺带被同拍的 tool_result 记成工具失败），下一次会话的模型会读到「我在这个靶子上会失败」这种假经验",
    apply: (s) => s.replace("      if (isEnvVerifyCause(e.cause)) {", "      if (false) {"),
    expectFail: "出口③：环境拍不进失败轨迹，改成 harness 侧的一笔（两个取料面都挡）",
  },

  // ── 权限档位唯一事实源（两格：表外值不许拿宽权限 / 抄本漂移必须被对账抓住）
  {
    id: "permission-mode-unknown-fallthrough-blind",
    src: "src/permissions/index.ts",
    test: "tests/permission-mode-single-source.test.ts",
    desc: "去掉表外档位的 ask 兜底 ⇒ 未知 mode 拿到 undefined/宽松路径（旧写法是以 return allow 收尾：加一档或持久化冒出陌生值时静默全放行，正是本仓最忌的「少一档没人被编译器叫住」）",
    apply: (s) => s.replace('SIDE_EFFECT_DECISION[mode] ?? "ask"', "(SIDE_EFFECT_DECISION[mode] as Decision)"),
    expectFail: "表外档位 ⇒ ask（不是 allow）；非交互时 gate() 再把它收成 deny（fail-closed）",
  },
  {
    id: "permission-mode-events-copy-drift-blind",
    src: "src/events/index.ts",
    test: "tests/permission-mode-single-source.test.ts",
    desc: "events 那份抄本少一档 ⇒ 对账判卷若测不出来，「唯一事实源」就是假的：permissions 加了档、events/IPC/worker 侧仍按旧集走，且没人报错",
    apply: (s) => s.replace('export const AGENT_PERMISSION_MODES = ["read-only", "default", "guided", "auto"] as const;', 'export const AGENT_PERMISSION_MODES = ["read-only", "default", "auto"] as const;'),
    expectFail: "events 的抄本与 permissions 的事实源逐位相同（顺序=松紧序，clampTier 依赖它）",
  },

  // ── 第 4 档 guided（judgment-layer §7 第 1 步）：政策表的每一格都要有「废掉它必须有名字红」的锚
  {
    id: "guided-risk-line-collapsed-to-auto",
    src: "src/permissions/autonomy.ts",
    test: "tests/permission-mode-guided.test.ts",
    desc: "把 guided 的风险线抬回 high ⇒ 它与 auto 成为同一档（中间档名存实亡：默认档 89 次出卡只降了 0 次，读数上谁也发现不了）",
    apply: (s) => s.replace('guided: { writeAsk: false, scopeMemory: true, riskAskAt: "medium"', 'guided: { writeAsk: false, scopeMemory: true, riskAskAt: "high"'),
    expectFail: "medium 风险写向（edit_file）：auto 放行，guided 出卡 L4-risk，default 出卡 L3-mode",
  },
  {
    id: "guided-scope-memory-dropped",
    src: "src/permissions/autonomy.ts",
    test: "tests/permission-mode-guided.test.ts",
    desc: "guided 不吃「本会话允许这类」⇒ 审批卡在新档成了一次静默无效的点击（点完仍每笔照问，用户无从察觉）",
    apply: (s) => s.replace('guided: { writeAsk: false, scopeMemory: true, riskAskAt: "medium"', 'guided: { writeAsk: false, scopeMemory: false, riskAskAt: "medium"'),
    expectFail: "本会话已记此类 ⇒ guided 放行 L3-scope；网络类命令不吃这条快捷",
  },
  {
    id: "default-write-ask-flag-flipped",
    src: "src/permissions/autonomy.ts",
    test: "tests/permission-mode-guided.test.ts",
    desc: "默认档的 writeAsk 翻成 false ⇒ 「本笔不动 default 语义」这句承诺失去观测者（低危写向从此静默放行，读数只在 ask-density 里看得见）",
    apply: (s) => s.replace('default: { writeAsk: true, scopeMemory: true', 'default: { writeAsk: false, scopeMemory: true'),
    expectFail: "低风险写向：default 出卡 L3-mode，guided 放行 L4-pass，auto 亦放行",
  },
  {
    id: "mode-policy-unknown-fallback-loosest",
    src: "src/permissions/autonomy.ts",
    test: "tests/permission-mode-guided.test.ts",
    desc: "表外档位的兜底从「按默认档」改成「按自主档」⇒ 未升级的持久化值静默拿到最松一档（本仓修过一次的那族，换个字段复现）",
    apply: (s) => s.replace("return MODE_POLICY[mode] ?? MODE_POLICY.default;", "return MODE_POLICY[mode] ?? MODE_POLICY.auto;"),
    expectFail: "未知 mode 走默认档政策：写向逐次审批，不是静默放行",
  },
  {
    id: "tier-order-second-copy-back",
    src: "src/agent/worker-report.ts",
    test: "tests/permission-mode-guided.test.ts",
    desc: "clampTier 回到本地数字表 ⇒ 新档插在中间时名次仍按旧表算（「子档不宽于父档」这条单调序的第二份事实源）",
    apply: (s) => s.replace("if (permissionModeRank(requested) <= permissionModeRank(parent)) return { mode: requested, clamped: false };", "if (true) return { mode: requested, clamped: false };"),
    expectFail: "父档 default 拒住 guided 子档；父档 guided 拒住 auto 子档",
  },
  {
    id: "ask-density-arm-missing",
    src: "scripts/replay/ask-density.ts",
    test: "tests/permission-mode-guided.test.ts",
    desc: "复跑面少一臂 ⇒ 那一档的出卡密度没人量（尺不会报错，只会读成没有这一行）",
    apply: (s) => s.replace('  { mode: "guided", sandbox: null },\n', ""),
    expectFail: "ask-density 的臂覆盖每一档",
  },
  {
    id: "renderer-perm-alias-copy-missing-mode",
    src: "src/renderer/projections.ts",
    test: "tests/renderer-perm-default-mode.test.ts",
    // 别名表搬到 projections 之后才有这一格：它一旦留在 app.js 的字面量里，加一档只有 tsc 那侧叫得醒，
    // 而"设置里存得下这一档、产品面上却选不出来"在运行时是全绿的。
    // （不钉 index.html 那个按钮：改法语法探针用 `ts.transpileModule`，整份 HTML 在它眼里就是语法错。）
    desc: "档位↔看板行 id 的别名表少一档 ⇒ 反向派生表缺一行：设置能存、界面选不出",
    apply: (s) => s.replace("  guided: 'guided',\n", ""),
    expectFail: "反向表与正向表互逆，且值集合 = 档位集合（新档在产品面可达的判据）",
  },
  {
    id: "renderer-perm-map-second-copy-back",
    src: "src/renderer/app.js",
    test: "tests/renderer-perm-default-mode.test.ts",
    desc: "PERM_MAP 退回在渲染层再抄一份字面量 ⇒ 别名表变成两处（去名字化是幻觉，表只是挪位置；挪回去就得有人判）",
    apply: (s) => s.replace("const PERM_MAP = permModeMapByRow();", "const PERM_MAP = { strict: 'read-only', standard: 'default', yolo: 'auto' };"),
    expectFail: "app.js 的 PERM_MAP 由这只表派生，不再自己写一遍档名字面量",
  },
  {
    id: "perm-seed-clobbers-user-choice",
    src: "src/renderer/projections.ts",
    test: "tests/renderer-perm-default-mode.test.ts",
    desc: "回灌不看「用户刚点过」⇒ 异步到达的设置盖掉人手选的档（点一下被撤销，且界面不会说）",
    apply: (s) => s.replace("  if (opts.userChose) return null;", "  if (false) return null;"),
    expectFail: "用户已经手动选过 ⇒ 不动（异步加载的设置不得盖掉刚点的那一下）",
  },
  {
    id: "perm-seed-guesses-default-row",
    src: "src/renderer/projections.ts",
    test: "tests/renderer-perm-default-mode.test.ts",
    desc: "认不出的档位回落到默认行 ⇒ 「不猜」这条没了：陌生设置值会把用户的现场换掉。判据必须带一格「当前不是默认行」，否则这条突变全绿（用例里那两行 yolo/strict 现值就是为此而在）",
    // 第一版钉的是 `permRowIdForMode` 尾部那句 `typeof row === 'string' ? row : null`——**实测变异存活**：
    // 上一行已经过了 hasOwnProperty 闸，表又由 tsc 保证每档都是字符串，那条回落分支根本到不了
    // ⇒ 形似的改法 = 自己写了条恒真锚点（抓到的不是"不猜"这条丢了，而是靶子选错）。
    // 真正的失效面在取到 row 之后：`?? PERM_DEFAULT_ROW` 才是"认不出就换档"的写法。
    apply: (s) => s.replace("  const row = permRowIdForMode(opts.storedMode);", "  const row = permRowIdForMode(opts.storedMode) ?? PERM_DEFAULT_ROW;"),
    expectFail: "设置认不出 / 与当前行相同 ⇒ 不动（认不出时不降级到默认档，保持现场）",
  },
  {
    id: "cdp-port-timeout-reads-free",
    src: "scripts/lib/cdp-port.ts",
    test: "tests/scripts-cdp-port.test.ts",
    desc: "等端口超时 ⇒ 报「空」（把「没等到」读成「没问题」：起窗照旧、连上的是旧浏览器，产出的是假读数）",
    apply: (s) => s.replace("    if (now() - start >= opts.budgetMs) return { free: false, probes, waitedMs: now() - start };", "    if (now() - start >= opts.budgetMs) return { free: true, probes, waitedMs: now() - start };"),
    expectFail: "预算用尽仍有人听 ⇒ free=false（把「等不到」读成「空」就等于放行旧窗）",
  },
  {
    id: "cdp-port-probe-error-reads-free",
    src: "scripts/lib/cdp-port.ts",
    test: "tests/scripts-cdp-port.test.ts",
    desc: "探针自己抛 ⇒ 当成「空」放行（坏仪器冒充读数）；顺带丢掉 error，等不到与探不到就再也分不开",
    apply: (s) => s.replace("      return { free: false, probes, waitedMs: now() - start, error: err instanceof Error ? err.message : String(err) };", "      return { free: true, probes, waitedMs: now() - start };"),
    expectFail: "探针抛错 ⇒ 按「没空出来」处理并停止（坏仪器不许冒充读数）",
  },
  {
    id: "cdp-port-spawn-guard-fakes-the-wait",
    src: "scripts/panels-check.ts",
    test: "tests/scripts-cdp-port.test.ts",
    // 三态判卷全绿也允许某一相「假装等过了」：这里把真探测换成一个写死的 free:true，
    // 于是旧窗又被当成本轮现场。锚点钉在**接线**那一行，不是钉在纯函数上。
    desc: "起窗前的等待被换成写死的「已空」⇒ 旧窗照样能连，而门报出来的是绿",
    apply: (s) => s.replace("  const wait = await waitForPortFree(PORT, { budgetMs: 12_000 });", "  const wait: PortWait = { free: true, probes: 1, waitedMs: 0 };"),
    expectFail: "spawnElectron 内先等端口、等不到就中止（不 spawn 进旧窗）",
  },
  {
    id: "distill-gate-whitelist-unlabeled",
    src: "src/agent/memory/distill.ts",
    test: "tests/distill.test.ts",
    desc: "沉淀轮的白名单拒绝不带留痕 ⇒ §7 的可标分母少一格（受管调用发生了、判定也发生了，只是没人记）",
    apply: (s) => s.replace(', gate: DISTILL_GATE.whitelist }', ' }'),
    expectFail: "白名单挡下非 remember 工具 ⇒ gate = X-distill / denied（没问过人，不是人的答复）",
  },
  {
    id: "distill-gate-merged-verdict-collapse",
    src: "src/agent/memory/distill.ts",
    test: "tests/distill.test.ts",
    desc: "把「人说不」记成「门拦的」（rejected → denied）⇒ 最稀缺的正例静默消失，而读数看起来总条数没变",
    apply: (s) => s.replace('unapproved: { layer: "X-distill", verdict: "rejected" },', 'unapproved: { layer: "X-distill", verdict: "denied" },'),
    expectFail: "合并审批被拒 ⇒ gate = X-distill / rejected（问过人才算正例，不许记成门自己拦的）",
  },
  {
    id: "gatebase-mode-dropped",
    src: "src/permissions/autonomy.ts",
    test: "tests/gate-audit.test.ts",
    // `mode` 为容纳 `X-distill` 从必填放宽成可选 ⇒ 编译期不再拦"evaluate 侧漏填档位"，
    // 这一格换由判卷守着：构造口少 mode = 全部出口的档位一起没了，按档算的免批率/ECE 会静默失真。
    desc: "gateBase 少写 mode ⇒ 放宽成可选之后没人知道档位丢了（按档算的读数会整体失真而不报错）",
    apply: (s) => s.replace("    layer: d.layer,\n    mode,", "    layer: d.layer,"),
    expectFail: "gateBase 的产物必带 mode（`X-` 面才允许缺）",
  },
  {
    id: "llm-confidence-fabricated-default",
    src: "src/agent/security/llm-review.ts",
    test: "tests/m3b.test.ts",
    desc: "模型没自报把握度就编一个 medium ⇒ 审计面上「模型没说」被说成「模型说了个中等把握」",
    apply: (s) => s.replace("      ...(isSecurityConfidence(r.confidence) ? { confidence: r.confidence } : {}),", "      confidence: r.confidence ?? \"medium\","),
    expectFail: "自报 confidence 既不编造，也不决定一条发现是否成立",
  },
  {
    id: "llm-confidence-gates-finding",
    src: "src/agent/security/scan.ts",
    test: "tests/m3b.test.ts",
    // 这一根守的是**漏报**：自报值一旦回到结构校验里，模型把 confidence 拼错 = 一条真安全发现静默消失。
    // 与上一根同族但不同面：上一根管"别说假话"，这一根管"别因为别人说错话而漏报"。
    desc: "confidence 回到 validateFinding 的门槛位 ⇒ 模型拼错自报值，那条发现整条被丢（安全审查漏报）",
    apply: (s) => s.replace("    (r.confidence === undefined || isSecurityConfidence(r.confidence))", "    isSecurityConfidence(r.confidence)"),
    expectFail: "自报 confidence 既不编造，也不决定一条发现是否成立",
  },
  {
    id: "security-confidence-guard-always-true",
    src: "src/agent/security/scan.ts",
    test: "tests/m3b.test.ts",
    desc: "isSecurityConfidence 恒真 ⇒ 非法/缺席的自报值被原样塞进 finding，「字段缺席 = 没自报」这条口径作废",
    apply: (s) => s.replace("  return typeof value === \"string\" && CONFIDENCES.includes(value);", "  return true;"),
    expectFail: "自报 confidence 既不编造，也不决定一条发现是否成立",
  },
  {
    id: "remember-gate-if-chain-back",
    src: "src/main/agent-runner.ts",
    test: "tests/remember.test.ts",
    desc: "remember 门退回按档位字面量的 if 链 ⇒ 表外档位一路掉到底、直接落盘（粗档表在这条路上没人读）",
    apply: (s) => s.replace('const decision = sideEffectDecisionTable()[mode] ?? "ask";', 'const decision = mode === "read-only" ? "deny" : mode === "default" ? "ask" : "allow";'),
    expectFail: "表外档位不落盘：走 ask，无审批口即 fail-closed（旧 if 链在这里静默放行）",
  },

  // ── 复跑面 gate-outcomes（读数面自己的三态纪律：漏计比红更坏）
  {
    id: "gate-outcomes-unmatched-swallowed",
    src: "scripts/replay/gate-outcomes.ts",
    test: "tests/replay-gate-outcomes.test.ts",
    desc: "join 不上 tool_call 的受管结果被静默跳过 ⇒ 分母少一块而读数看起来完整（「读数取不到」老族：差值就是尺，别把差值丢掉）",
    apply: (s) => s.replace("    if (tool === undefined) {", "    if (false && tool === undefined) {"),
    expectFail: "只有受管工具进分母；join 不上 tool_call 的记 unmatched，不当没有",
  },
  {
    id: "gate-outcomes-unknown-dropped",
    src: "scripts/replay/gate-outcomes.ts",
    test: "tests/replay-gate-outcomes.test.ts",
    desc: "表外 layer/verdict 不记账 ⇒ 新加一层/一种结果时它整列消失，而不是矩阵多出一格空行",
    apply: (s) => s.replace("    if (!layerOk) bump(t.unknownLayer, g.layer);", "    if (false) bump(t.unknownLayer, g.layer);"),
    expectFail: "表外 layer / verdict 单独记账：既不混进矩阵，也不静默丢掉",
  },
  {
    id: "gate-outcomes-skeleton-per-side-only",
    src: "scripts/replay/gate-outcomes.ts",
    test: "tests/replay-gate-outcomes.test.ts",
    desc: "骨架只按层铺、不按结果铺 ⇒ 少一列没人知道（格数必须等于两层数之积，这条断言就是它的守门人）",
    apply: (s) => s.replace("  for (const l of GATE_LAYERS) for (const v of GATE_VERDICTS) m.set(l + CELL_SEP + v, 0);", "  for (const l of GATE_LAYERS) m.set(l + CELL_SEP + String(GATE_VERDICTS[0]), 0);"),
    expectFail: "骨架格子数 = 层数 × 结果数（任一侧加值，格数自动跟上，不靠人记得补）",
  },

  // ── 复跑面 join-lapse（这条读数给 W1b 定默认值：读数偏 0 = 安静地决定不花钱，所以四格各钉一条）
  {
    id: "join-lapse-denominator-diluted",
    src: "scripts/replay/join-lapse.ts",
    test: "tests/replay-join-lapse.test.ts",
    desc: "分母把无 worker 的普通会话也算进去 ⇒ 占比被大量不相关 run 稀释成好看的 0，W1b 就此「有据」不做",
    apply: (s) => s.replace("  const worker = rows.filter((r) => r.spawns > 0);", "  const worker = rows;"),
    expectFail: "分母只数真派过活的 run：掺进无 worker 的会话不会把占比稀释成 0",
  },
  {
    id: "join-lapse-terminal-list-recopied",
    src: "scripts/replay/join-lapse.ts",
    test: "tests/replay-join-lapse.test.ts",
    desc: "「在途」另抄一份判定而不复用 interruptedWorkers ⇒ 恢复面加一种终态时这里读成在途，两处分叉（第六族）",
    apply: (s) => s.replace(
      "    inFlight: interruptedWorkers(raws as readonly AgentEvent[]).length,",
      "    inFlight: raws.filter((r) => (r as { type?: string }).type === \"agent_spawned\").length,",
    ),
    expectFail: "failed / cancelled 同样算收队——终态名单挂产品的 `interruptedWorkers`，不在此另抄一份",
  },
  {
    id: "join-lapse-unmeasurable-as-zero",
    src: "scripts/replay/join-lapse.ts",
    test: "tests/replay-join-lapse.test.ts",
    desc: "零 worker 时不走「不可测」分支 ⇒ 0/0 与「占比是 0」长成同一句话，读的人据此判定不用建闸（未证读成通过）",
    apply: (s) => s.replace("  if (s.totalSpawns === 0) {", "  if (false) {"),
    expectFail: "零 worker 语料 ⇒ 红着退出并说「不可测」，不许报 0/0 让人读成「占比是 0」",
  },
  {
    id: "join-lapse-families-counted-all-runs",
    src: "scripts/replay/join-lapse.ts",
    test: "tests/replay-join-lapse.test.ts",
    desc: "样本宽度按全语料数目录 ⇒ 无 worker 的文件把「样本只来自一次实验」这句警告自己稀释掉（本面施工时真踩过）",
    apply: (s) => s.replace("families: new Set(worker.map(", "families: new Set(rows.map("),
    expectFail: "样本宽度只数派过活的 run：掺进来的无 worker 目录不许把「样本很窄」这句稀释掉",
  },

  // ── 落盘时钟戳 + 复跑面 latency（延迟第一次可测；两半各自的失效方式不同）
  {
    id: "event-stamp-dropped",
    src: "src/events/index.ts",
    test: "tests/events.test.ts",
    desc: "append 不再盖 ts ⇒ 每条事件的 `ts` 又变成「生产者记得才有」，工具耗时整个面消失（而测试面之外无人知）",
    apply: (s) => s.replace(
      "      const stamped = { ...event, ts: (event as { ts?: number }).ts ?? Date.now() };",
      "      const stamped = { ...event };",
    ),
    expectFail: "producer 没写 ts 也要有：每条落盘事件都带数字 ts",
  },
  {
    id: "event-stamp-overwrites-producer-ts",
    src: "src/events/index.ts",
    test: "tests/events.test.ts",
    desc: "无条件盖 now() ⇒ 把 automation 那批自己定的时间洗成本机时间（它们语义是「计划/发生时刻」，不是「落盘时刻」）",
    apply: (s) => s.replace(
      "ts: (event as { ts?: number }).ts ?? Date.now()",
      "ts: Date.now()",
    ),
    expectFail: "producer 自带的 ts 不被改写（automation 那批本来就自己盖，覆盖会把它们的语义洗掉）",
  },
  {
    id: "latency-d8-rule-all-or-nothing",
    src: "scripts/replay/latency.ts",
    test: "tests/replay-latency.test.ts",
    desc: "可并发判据退回「整轮全是只读工具」⇒ 真语料那个 25 调用的轮（23 读 + 2 别的）被整轮判 0，读数与结论一起翻向",
    apply: (s) => s.replace(
      "      const safe = turnNames.reduce((n, x) => n + (D8_SAFE_TOOLS.has(x) ? 1 : 0), 0);",
      "      const safe = turnNames.every((x) => D8_SAFE_TOOLS.has(x)) ? turnNames.length : 0;",
    ),
    expectFail: "D8 可折次数按「该轮只读调用数 − 1」算，不按「整轮是否全只读」（真语料有个 25 调用的轮，23 个是 read_file）",
  },
  {
    id: "latency-streams-flattened",
    src: "scripts/replay/latency.ts",
    test: "tests/replay-latency.test.ts",
    desc: "把多个会话拼成一条数组再 tally ⇒ 一条流末尾未闭合的调用吞掉下一条流的「轮」（实测 189 轮读成 19 轮）",
    apply: (s) => s.replace(
      "  return foldLatency(streams.map((raws) => tallyLatency(raws)));",
      "  return foldLatency([tallyLatency(streams.flat())]);",
    ),
    expectFail: "一条流末尾未闭合的调用会把下一条流的「轮」吞掉 ⇒ 必须逐条成流再合并",
  },
  {
    id: "latency-unmeasurable-as-zero",
    src: "scripts/replay/latency.ts",
    test: "tests/replay-latency.test.ts",
    desc: "无戳不再单独判「不可测」⇒ 旧语料上印出「工具耗时 0ms / 占比 0%」，D8 就据此被判定不值得做",
    apply: (s) => s.replace("  if (!t.hasTimestamps) {", "  if (false) {"),
    expectFail: "有调用但全无戳 ⇒ 触发面照常报，时间面单独说「旧语料无戳」并红着退出",
  },
  {
    id: "latency-picker-swallows-empty-path",
    src: "scripts/replay/latency.ts",
    test: "tests/replay-latency.test.ts",
    desc: "指到的路径里没有 .jsonl 却不被记下 ⇒ 读数为空却像「本次跑过了」，与全语料那批混成一谈",
    apply: (s) => s.replace("    if (found.length === 0) empty.push(a);", "    if (false) empty.push(a);"),
    expectFail: "路径下一条 .jsonl 也没有 ⇒ 红着点名该路径，绝不退回全语料",
  },
  {
    id: "latency-picker-always-uses-corpus",
    src: "scripts/replay/latency.ts",
    test: "tests/replay-latency.test.ts",
    desc: "无视命令行路径、永远扫登记表语料 ⇒ 「这一批的数」里混进别处的会话（e2e 读数就此失去归因）",
    apply: (s) => s.replace(
      "  if (args.length === 0) return { files: [...corpus], problem: null };",
      "  return { files: [...corpus], problem: null };",
    ),
    expectFail: "给了路径就只用那些路径，不掺登记表语料（否则「这一批的数」会混进别的批）",
  },

  // ── 同一 callId 的 tool_result 合并（spawn 回执 + worker 回传是两个生产者）
  {
    id: "tool-result-merge-skipped",
    src: "src/agent/context.ts",
    test: "tests/worker-result-wire.test.ts",
    desc: "投影出口不再合并 ⇒ 一个 tool_call_id 发出两条 tool 消息（Anthropic 线格式里就是两个 tool_result 块同一个 tool_use_id）",
    apply: (s) => s.replace(
      "  return closeDanglingToolCalls(mergeToolResultsById(msgs));",
      "  return closeDanglingToolCalls(msgs);",
    ),
    expectFail: "spawn 的回执与 worker 回传合成一条：id 只出现一次，两份正文都在（不丢信息）",
  },
  {
    id: "tool-result-merge-drops-later-content",
    src: "src/agent/context.ts",
    test: "tests/worker-result-wire.test.ts",
    desc: "合并时只留第一条 ⇒ 形状合法了，但 worker 的正文被丢掉：注入通道还在而报告不再进上下文（修形状修出静默丢数据）",
    apply: (s) => s.replace("    out[at] = { ...prev, content: `${String(prev.content ?? \"\")}\\n\\n${String(m.content ?? \"\")}` };", "    out[at] = prev; // 变异：只留第一条"),
    expectFail: "spawn 的回执与 worker 回传合成一条：id 只出现一次，两份正文都在（不丢信息）",
  },
  {
    id: "tool-result-merge-ignores-id",
    src: "src/agent/context.ts",
    test: "tests/worker-result-wire.test.ts",
    desc: "合并键写成固定串 ⇒ 全历史所有工具结果并成一条：位次与逐调用归因一起没了（反面对手那格就是量这个的）",
    apply: (s) => s.replace(
      "    const id = m.role === \"tool\" ? m.tool_call_id : undefined;",
      "    const id = m.role === \"tool\" ? \"any\" : undefined;",
    ),
    expectFail: "反面对手：不同 callId 的两条 result 绝不合并（各自一条，位次不变）",
  },

  // ── 复跑面 corpus-inventory（这张表的最后一行是「要不要给主循环加换路压力」的决策依据，
  //    偏小 = 安静地不下判断，所以五格各自钉一条：窗口、规范化、断链、决策线两半）
  {
    id: "corpus-inventory-retry-window-adjacent-only",
    src: "scripts/replay/corpus-inventory.ts",
    test: "tests/replay-corpus-inventory.test.ts",
    // 向后看到序列尾 ⇒ 退回旧写法只看紧邻一格。这一格偏小不会报错，只会让人读成「没重复」。
    desc: "重试只认紧邻的下一个 tool_call ⇒ 中间隔一次别的调用就漏计，「无卡死证据」是数出来的假读数",
    apply: (s) => s.replace("      for (let j = i + 1; j < tc.length; j++) {", "      for (let j = i + 1; j < i + 2; j++) {"),
    expectFail: "中间隔了一次别的调用 ⇒ 仍算原样重试（旧写法只看紧邻，这里会读成 0）",
  },
  {
    id: "corpus-inventory-canonical-args-dropped",
    src: "scripts/replay/corpus-inventory.ts",
    test: "tests/replay-corpus-inventory.test.ts",
    desc: "参数退回原始 JSON.stringify 比对 ⇒ 同一调用换个键序就被读成「改过参数」，「一字不变」偏低",
    apply: (s) => s.replace("    const args = canonicalArgs(c.args);", "    const args = JSON.stringify(c.args);"),
    expectFail: "参数键序不同、内容相同 ⇒ 仍算「一字不变」（旧写法用原始 JSON.stringify，这里会读成 0）",
  },
  {
    id: "corpus-inventory-result-joinkey-guard-off",
    src: "scripts/replay/corpus-inventory.ts",
    test: "tests/replay-corpus-inventory.test.ts",
    // 09-21 实踩：按 callId 查 tool_call 得到 has(undefined) 恒 false ⇒ 一片零假读数。
    // 现在断链是崩而不是数 0，这一格守的就是"崩"这半边。
    desc: "tool_result 缺 callId 不再抛而被静默跳过 ⇒ 「失败=0」这类零读数重新可能（join 键断链要当场崩）",
    apply: (s) => s.replace('    if (typeof key !== "string") {', "    if (false) {"),
    expectFail: "join 键断链必须抛，而不是把「失败」读成 0（09-21 实踩过的形状）",
  },
  {
    id: "corpus-inventory-repeat-verdict-always-act",
    src: "scripts/replay/corpus-inventory.ts",
    test: "tests/replay-corpus-inventory.test.ts",
    desc: "换路压力裁决恒「该动」⇒ 印出来的那行不再是读数，而是口号（决策线两半都得有反例）",
    apply: (s) => s.replace("  if (deepRun && hasExactRepeat) {", "  if (true) {"),
    expectFail: "零原样重试 ⇒ 不给主 loop 加压（今天的真语料形状）",
  },
  {
    id: "corpus-inventory-run-threshold-loosened",
    src: "scripts/replay/corpus-inventory.ts",
    test: "tests/replay-corpus-inventory.test.ts",
    desc: "run 深度阈值 3 放宽到 2 ⇒ 一次普通重试即被判成卡死（偏大的代价是白加主 loop 闸门）",
    apply: (s) => s.replace("  const deepRun = t.maxSameFailedRun >= 3;", "  const deepRun = t.maxSameFailedRun >= 2;"),
    expectFail: "只有原样重试、run 未到 3 ⇒ 仍不动（阈值这一半的分歧格）",
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
    apply: (s) => s.replace("    return await this.spawn({ ...args }, ctx);", "    return await this.spawn({ task: args.task, mode: args.mode }, ctx);"),
    expectFail: "真链：落流的角色 → respawnArgsFrom → respawn() 的新 agent_spawned 仍带同一角色（全新 agent_id）",
  },
  {
    id: "panel-respawn-payload-lossy",
    src: "src/renderer/projections.ts",
    test: "tests/renderer-worker-approval.test.ts",
    desc: "面板「重派」载荷回到自造 {mode, task} ⇒ 用户点的那一跳与恢复卡两份参数（max_turns/档位/模型/角色全丢）",
    apply: (s) => s.replace("        respawn: respawnArgsFrom(e),", "        respawn: { mode: e.mode, task: e.task },"),
    expectFail: "取消发 agent_card/cancel，重派把原 spawn 参数带回 payload.respawn",
  },
  {
    id: "panel-invents-respawn-payload-for-orphan",
    src: "src/renderer/projections.ts",
    test: "tests/renderer-worker-approval.test.ts",
    desc: "没有 spawn 参数也照发载荷 ⇒ 给一个从未见过的 worker 编一份重派参数（main 侧的出声拒永远走不到）",
    apply: (s) => s.replace("    ...(col.respawn ? { payload: { respawn: col.respawn } } : {}),", '    payload: { respawn: col.respawn ?? { mode: "read", task: "" } },'),
    expectFail: "取消发 agent_card/cancel，重派把原 spawn 参数带回 payload.respawn",
  },
  // ---- 判卷面硬闸（L0）：一条闸有四格装配，每格都得有人守 ----
  // 立闸时只留了一句「变异锚点候选 judge-frozen-wiring-dropped」在注释里（`agent-runner.ts:1150`），
  // 四天没人补 ⇒ 本轮补五条：判定本体 / 会话工厂 / 主会话装配 / worker 两面装配。
  {
    id: "judge-deny-bypassed",
    src: "src/permissions/autonomy.ts",
    test: "tests/judge-frozen-gate.test.ts",
    desc: "摘掉 L0 那段 ⇒ 判卷文件回到「靠提示词自觉」（真模型评测实测 8 格里 3 格改写了 tests/todo.test.ts）",
    apply: (s) => s.replace("  if (s.frozenJudgePaths.size > 0 && isWriteCall(tool, grade)) {", "  if (false) {"),
    expectFail: "① 写向工具命中冻结表 ⇒ deny，理由指明「写 BLOCKED.md 换判据」而不是改文件",
  },
  {
    id: "judge-factory-ignores-injected-set",
    src: "src/permissions/autonomy.ts",
    test: "tests/judge-frozen-gate.test.ts",
    desc: "会话工厂恒用空集（收了实参不用）⇒ 所有装配点看起来都「传了」，实际整套 L0 判据只在单测里活过",
    apply: (s) => s.replace("    frozenJudgePaths: init.frozenJudgePaths ?? NO_JUDGE_SURFACE,", "    frozenJudgePaths: NO_JUDGE_SURFACE,"),
    expectFail: "② 闸在 L0：一条 allow 规则 / 自主档都不能复活被冻住的写",
  },
  {
    id: "judge-frozen-wiring-dropped",
    src: "src/main/agent-runner.ts",
    test: "tests/judge-frozen-gate.test.ts",
    desc: "主会话不装冻结集 ⇒ 端到端那条 ⑨ 立刻空转：写判卷文件被放行、文件真被改写",
    apply: (s) => s.replace("      frozenJudgePaths: frozenJudgePathSet(opts.workspace),\n", ""),
    expectFail: "⑨ 写判卷路径 ⇒ tool_result 出「判卷文件冻结」且文件逐字未变；同一 run 里写非判卷路径照常放行",
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
    src: "src/agent/orchestrator.ts",
    test: "tests/supervise-evidence.test.ts",
    desc: "caller 不读 `artifacts.verified`（判据退回纯散文）⇒ implement 角色永远取不到判据，supervise 恒 escalate 并删掉改对的成果",
    apply: (s) => s.replace("        evidence: term.result.artifacts.verified,", "        evidence: undefined,"),
    expectFail: "绿凭据 + 报告没有 verdict 行 ⇒ accept 并合并落盘（判据来自 caller 读到的凭据，不是散文）",
  },
  {
    id: "supervise-escalate-destroys-scene",
    src: "src/agent/orchestrator.ts",
    test: "tests/supervise-evidence.test.ts",
    desc: "escalate 出口把最终环一起 reject ⇒ 先删 worktree 再回去问人，裁决发生时证据已不在",
    apply: (s) => s.replace("        await rejectRings(ringAgentIds.filter((id) => id !== agentId));\n        return { ok: false, output: \"spawn_agent(supervise): 已升级人工裁决：", "        await rejectRings(ringAgentIds);\n        return { ok: false, output: \"spawn_agent(supervise): 已升级人工裁决："),
    expectFail: "改了盘但取不到凭据、报告也无契约行 ⇒ escalate，且回执点名保留的 worktree 仍在盘上",
  },
  {
    id: "supervise-ring-credential-dropped",
    src: "src/agent/supervisor.ts",
    test: "tests/supervise-ring-verdict.test.ts",
    desc: "决策输入里去掉绿凭据那一支 ⇒ 无 verdict 行的环仍被判无判据（散文优先复活）",
    apply: (s) => s.replace("  if (ctx.evidence === \"verified\") return \"pass\";", "  if (false) return \"pass\";"),
    expectFail: "写过盘且凭据绿（verified）⇒ pass，报告里没有 verdict 行也成立——今日实现在这一格必然 escalate",
  },
  {
    id: "supervise-ring-stale-trusted",
    src: "src/agent/supervisor.ts",
    test: "tests/supervise-ring-verdict.test.ts",
    desc: "过期证据不再短路 ⇒ 绿拍之后又写了盘，那份绿被当成有效凭据（或直接回落到散文自述）",
    apply: (s) => s.replace("  if (ctx.evidence === \"stale\") return null;", "  if (false) return null;"),
    expectFail: "凭据过期（stale）⇒ null：绿拍之后又写了盘，那份证据已失效，不静默猜",
  },
  {
    id: "supervise-ring-forbidden-overridden",
    src: "src/agent/supervisor.ts",
    test: "tests/supervise-ring-verdict.test.ts",
    desc: "禁改面违反不再先于凭据 ⇒ 触碰 forbidden 的环只要verify绿就被 accept（契约让位于测试颜色）",
    apply: (s) => s.replace("  if (ctx.forbiddenViolated) return \"fail\";", "  if (false) return \"fail\";"),
    expectFail: "禁改面被触碰：即使凭据是 verified 也判 fail（forbidden 硬闸不被凭据顶掉）",
  },
  // ---- 09-24 写向判据收成一份（`src/agent/write-face.ts`）：四处清单漂移里最贵的两格 ----
  // shell 命令形状这一支决定「经 shell 落盘算不算写过盘」；两个显式名单各是一个**刻意不做的动作**，
  // 按 rule 57 它们必须有名字与锚点，否则下一轮重构会把它们当冗余守卫删掉。
  {
    id: "writeface-shell-blind-as-before",
    src: "src/agent/write-face.ts",
    test: "tests/write-face.test.ts",
    desc: "shell 一律算写向（不收窄命令形状）⇒ 任何 `ls` 都要补一拍目标仓全量测试，收束闸变成免费的性能税",
    apply: (s) => s.replace("    return !isReadOnlyShellCommand(command).ok;", "    return true;"),
    expectFail: "反向一侧（不这么钉，看一次目录就要跑一遍全量测试）：`run_shell` 跑 `ls -la` 与 `git status` ⇒ false",
  },
  {
    id: "writeface-shell-never-writes",
    src: "src/agent/write-face.ts",
    test: "tests/write-face.test.ts",
    desc: "shell 一律不算写向（回到旧的两名字清单）⇒ 经 shell 落盘既不触发收束闸、也不使绿拍过期（假绿复活）",
    apply: (s) => s.replace("    return !isReadOnlyShellCommand(command).ok;", "    return false;"),
    expectFail: "shell 落盘算改盘：`shell_rw` 跑 `printf … >> note.txt` ⇒ true（旧的两名字清单在这一格判 false ⇒ 收束闸与 stale 双双漏）",
  },
  {
    id: "writeface-spawn-agent-counted-as-disk-write",
    src: "src/agent/write-face.ts",
    test: "tests/write-face.test.ts",
    desc: "把 spawn_agent 也当成本工作区的写盘 ⇒ 派一次活就补一拍主仓验证（它写的是自己那块 worktree，改动另走合并控制塔）",
    apply: (s) => s.replace('const NOT_THIS_WORKSPACE: ReadonlySet<string> = new Set(["spawn_agent"]);', "const NOT_THIS_WORKSPACE: ReadonlySet<string> = new Set<string>();"),
    expectFail: "派生 worker 本身不改盘（它写的是自己那块 worktree）⇒ false",
  },
  {
    id: "writeface-shellro-reads-command-shape",
    src: "src/agent/write-face.ts",
    test: "tests/write-face.test.ts",
    desc: "去掉 shell_ro 的静态只读豁免 ⇒ 它的白名单命令也被判成写向，而它按契约永远写不了盘",
    apply: (s) => s.replace("    if (STATICALLY_READONLY_SHELL.has(tool)) return false;", "    if (false) return false;"),
    expectFail: "`shell_ro` 恒 false，且这不是命名照顾而是执行面事实：写到一半的命令会被同一份静态过滤拒掉（ok:false ⇒ 根本没执行）",
  },
  {
    id: "writeface-everything-is-write",
    src: "src/agent/write-face.ts",
    test: "tests/write-face.test.ts",
    desc: "非 shell 一律算写向（绕开门的写向集）⇒ 「只读名单」与真实判据分叉，覆盖性棘轮的反向一侧必须抓到现场",
    apply: (s) => s.replace("  return isWriteCall(tool) && !NOT_THIS_WORKSPACE.has(tool);", "  return !NOT_THIS_WORKSPACE.has(tool);"),
    expectFail: "覆盖性棘轮：工具表里每个名字都必须被显式归类（算改盘 或 在只读名单里）⇒ 新增工具没登记就红",
  },
  // ---- 09-24 run-scorecard：y 轴读数的三条口径纪律各钉一针（面自己承诺过的，就得有人抓着）----
  {
    id: "scorecard-env-beats-billed-to-model",
    src: "scripts/replay/run-scorecard.ts",
    test: "tests/replay-run-scorecard.test.ts",
    desc: "不再识别环境拍 ⇒ 装不上工具链的机器把 run 判成「模型没修好」，成功率与返工数一起说谎（P1-3 归因白做）",
    apply: (s) => s.replace("      const env = !e.ok && isEnvVerifyCause(e.cause);", "      const env = false;"),
    expectFail: "环境红不记在模型账上：只有一拍环境红 ⇒ env-blocked，既不 ended-red 也不算返工",
  },
  {
    id: "scorecard-private-write-list",
    src: "scripts/replay/run-scorecard.ts",
    test: "tests/replay-run-scorecard.test.ts",
    desc: "面里另抄一份两名字写向清单（不用 mayHaveWrittenDisk）⇒ shell 改盘的 run 被判 no-write，分母反过来骗人",
    apply: (s) => s.replace("      if (e.ok && c !== undefined && mayHaveWrittenDisk(c.name, c.args)) writeAt.push(i);", "      if (e.ok && c !== undefined && (c.name === \"write_file\" || c.name === \"edit_file\")) writeAt.push(i);"),
    expectFail: "只经 shell 改盘也算写过盘（复用 mayHaveWrittenDisk；旧的两名字清单会把这一格判成 no-write，分母就此骗人）",
  },
  {
    id: "scorecard-denominator-includes-unproven",
    src: "scripts/replay/run-scorecard.ts",
    test: "tests/replay-run-scorecard.test.ts",
    desc: "成功率分母把「证据缺席」的流也算进去 ⇒ 一个没人验过的 run 直接压低分数，读数不再可比",
    apply: (s) => s.replace("  const judgedRows = closedLoop.filter((r) => r.decisive !== \"none\");", "  const judgedRows = closedLoop;"),
    expectFail: "汇总给分档计数，no-write 单独列出（不进分母也不被丢弃）",
  },
  // ---- 09-24 能力 5 返修那一环（`autoVerifyRepair`）：三针各钉一个上界 ----
  // 钉的不是"有没有返修"，是它的三条界：不开即零行为、环境红不重算、没改盘就不重验。
  // 少任何一条，这一环就从"补闭环"变成"多烧钱"或"把机器的账记回模型"。
  {
    id: "repair-branch-never-fires",
    src: "src/agent/loop.ts",
    test: "tests/auto-verify-repair.test.ts",
    desc: "红拍后那一支永不触发 ⇒ 开关形同虚设，「执行-验证-修正」仍停在验证",
    apply: (s) => s.replace("          if (beat === \"auto-red\" && opts.autoVerifyRepair === true && autoBeats < 2) {", "          if (false) {"),
    expectFail: "开：红拍之后恰好多要一轮模型，且那一轮的上下文里真有那条红字（返修不是靠提示词自觉）",
  },
  {
    id: "repair-driven-by-env-red",
    src: "src/agent/loop.ts",
    test: "tests/auto-verify-repair.test.ts",
    desc: "自动拍的返回值不再区分环境红 ⇒ 装不上工具链的机器多要一轮去重跑同一件必失败的事，P1-3 归因白做",
    apply: (s) => s.replace("    if (auto) return outcome.ok || envBeat ? \"stop\" : \"auto-red\";", "    if (auto) return outcome.ok ? \"stop\" : \"auto-red\";"),
    expectFail: "环境红不驱动返修：装不上工具链的机器上重跑一遍还是 127，那等于把 P1-3 的归因白做",
  },
  {
    id: "repair-reverifies-unchanged-code",
    src: "src/agent/loop.ts",
    test: "tests/auto-verify-repair.test.ts",
    desc: "第二拍不再要求「这一轮真的又改过盘」⇒ 模型只回一句「知道了」也把同一份代码再验一遍（纯烧一遍全量测试）",
    apply: (s) => s.replace("      const repairBeat = repairPending && wroteSinceAutoBeat && autoBeats < 2;", "      const repairBeat = repairPending && autoBeats < 2;"),
    expectFail: "开了返修但模型第二轮不再改（只回一句「知道了」）⇒ 不再补第三拍，请求数停在 3",
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
];

/** 从 apply 闭包里取回针脚原文（函数源码里的第一个字符串字面量；replace/replaceAll、
 *  单双引号与反引号三种写法都认）。取不到不判红：含插值的模板字面量无法静态求值，
 *  这类如实报「未覆盖」——不假装自己全看见了。 */
function extractNeedle(apply) {
  const m = /\.replace(?:All)?\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/u.exec(String(apply));
  if (!m) return null;
  try { return new Function("return " + m[1])(); } catch { return null; }
}

/** 针脚体检：blocking = 这条变异是空操作（它在假装守护）；warn = 针脚命中多处，
 *  replace 只改第一处，需人工复认改到的是哪一处。 */
function reportNeedles(entries, { showUnparsed = true } = {}) {
  const checkable = [];
  const unparsed = [];
  const lineWise = [];
  for (const e of entries) {
    if (isLineWiseApply(String(e.apply))) { lineWise.push(e.id); continue; }
    const needle = extractNeedle(e.apply);
    if (needle === null) unparsed.push(e.id);
    else checkable.push({ id: e.id, srcRel: e.src, needle });
  }
  const problems = auditNeedles(checkable, (rel) => {
    try { return readFileSync(join(ROOT, rel), "utf8"); } catch { return null; }
  });
  const blocking = problems.filter((p) => needleSeverity(p.hits) === "blocking");
  const warn = problems.filter((p) => needleSeverity(p.hits) === "warn");
  for (const p of blocking) console.log("❌ " + needleProblemLine(p));
  for (const p of warn) console.log("⚠️ " + needleProblemLine(p));
  if (showUnparsed && unparsed.length > 0) {
    console.log(`ℹ️ 静态检未覆盖 ${String(unparsed.length)} 条（apply 非通行写法）：${unparsed.join("、")}`);
  }
  if (showUnparsed && lineWise.length > 0) {
    console.log(`ℹ️ 逐行式 apply ${String(lineWise.length)} 条（多处命中即设计，不核针脚）：${lineWise.join("、")}`);
  }
  const dup = duplicateIds(entries.map((e) => e.id));
  for (const d of dup) {
    console.log("❌ 锚点 id 重复：" + d.id + " ×" + String(d.count) + "（`mutate-verify <id>` 会同时跑两条，报告里两行同 id 不同改法＝读不出哪条活着）");
  }
  /* 锚点的两个文件面（被测源码 + 判卷测试）不在 HEAD 的树里 ⇒ 这类缺陷**主树永远看不见**（本门读的是盘），
     而干净 HEAD 的隔离树里前者必然「源文件读不到」、后者连基线都跑不出来（被写成「基线不是全绿」）。
     一次 `git ls-tree HEAD` 拿全量，判据本体在 lib 里（可单测）。
     git 不可用时报「未查」，不静默当已查——未证 ≠ 通过。 */
  const untracked = [];
  let inHead = null;
  let headUnchecked = 0;
  try {
    inHead = new Set(execFileSync("git", ["ls-tree", "-r", "--name-only", "HEAD"],
      { cwd: ROOT, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 }).split("\n").filter(Boolean));
    untracked.push(...untrackedAnchorPaths(anchorFaces(entries), (rel) => inHead.has(rel)));
  } catch (err) {
    headUnchecked = 1;
    console.log("⚠️ 锚点文件面的 HEAD 归属未查（git ls-tree 失败：" + (err instanceof Error ? err.message : String(err)) + "）");
  }
  for (const g of untracked) console.log("❌ " + untrackedAnchorLine(g));
  /* 上一条只答得出「文件在不在 HEAD」，答不出「被锚定的那段文字在不在 HEAD」。这里把同一份 `auditNeedles`
     再喂一遍 HEAD 那份内容取差集 ⇒ 锚点钉在**在飞文本**上（锚点行已入库、实现改动还没）从此在主树也出声。
     blob 按不同 src 缓存（一个文件一次 `git show`），门保持秒级。 */
  const drift = [];
  if (inHead !== null) {
    try {
      const blobs = new Map();
      const readHeadBlob = (rel) => {
        if (!blobs.has(rel)) {
          try {
            blobs.set(rel, execFileSync("git", ["show", "HEAD:" + rel],
              { cwd: ROOT, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 }));
          } catch { blobs.set(rel, null); }
        }
        return blobs.get(rel);
      };
      const missingSrc = new Set(untracked.filter((u) => u.what === "被测面").map((u) => u.path));
      drift.push(...headOnlyNeedleProblems(problems, auditNeedles(checkable, readHeadBlob), missingSrc));
    } catch (err) {
      headUnchecked = 1;
      console.log("⚠️ 针脚的 HEAD 侧比对未查（git show 失败：" + (err instanceof Error ? err.message : String(err)) + "）");
    }
  } else {
    headUnchecked = 1;
  }
  for (const d of drift) console.log("❌ " + headOnlyNeedleLine(d));
  // 一次求和、两处使用（汇总里印出来的数与 exit 码用的是同一个值；分开算就可能各说各话）。
  const blockingTotal = blockingTotalOf({
    needle: blocking.length, duplicateIds: dup.length, untracked: untracked.length, drift: drift.length,
  });
  console.log(`针脚体检：${String(entries.length)} 条 —— 阻断 ${String(blockingTotal)}，待复认 ${String(warn.length)}，未覆盖 ${String(unparsed.length)}，逐行式 ${String(lineWise.length)}，未入库面 ${String(untracked.length)}（被测面 + 判卷两面），钉在飞文本 ${String(drift.length)}${headUnchecked === 0 ? "" : "（HEAD 归属未查）"}`);
  return blockingTotal;
}

function runTest(testRel) {
  try {
    const out = execFileSync(process.execPath, [
      VITEST, "run", "--pool=threads", "--config", "tests/vitest.config.ts", testRel,
    ], { cwd: ROOT, env: { ...process.env, TERM: "dumb" }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout ?? "") + (e.stderr ?? "") };
  }
}

/** 某文件相对 HEAD 的状态（判据本体在 scripts/lib/mutate-gates.ts，那边可单测）。 */
function headStateOf(rel) {
  const tracked = execFileSync("git", ["ls-files", "--", rel], { cwd: ROOT, encoding: "utf8" }).trim();
  if (!tracked) return "untracked";
  try {
    execFileSync("git", ["diff", "HEAD", "--quiet", "--", rel], { cwd: ROOT });
  } catch {
    return "dirty";
  }
  return "clean";
}

/** 改法必须产出**语法合法**的源文件。把对象字面量里的一行 spread 顶替成 `void x;` 这类写法
 *  会让整个文件不再是合法 TS ⇒ 测试红在 vite 装载阶段而不是红在判据上，而 runner 只会说
 *  「没红在期望用例上——可能误伤无关用例」，把人的注意力引向「expectFail 写错了」这个假因。
 *  本会话内实踩两次，故就地判出来。transpileModule 只报语法诊断（不做类型检查）——
 *  突变体本来就允许类型层面的取巧（`if (false)` 之类）。 */
function mutantSyntaxProblem(mutated) {
  const diags = ts.transpileModule(mutated, {
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, allowJs: true },
  }).diagnostics ?? [];
  const errs = diags.filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (errs.length === 0) return null;
  return "改法致语法错（测试会红在装载阶段，不算分辨力证据）：" + ts.flattenDiagnosticMessageText(errs[0].messageText, " ");
}

/** 在飞突变：这一刻盘上的源文件是**改过**的内容。
 *  ⚠️ 实测边界（09-23）：这条**不是**超时保险。`runTest` 走 `execFileSync`，同步阻塞整个事件循环，
 *  JS 层的信号处理器要等子进程结束才可能跑；而外层超时（`pnpm gates` 对本门约 20 分钟）在 SIGTERM
 *  之后不会等这么久——实测 SIGTERM 打到 node 后 1.5s 内什么都没发生，盘上仍是突变体 + `.mutbak`。
 *  真正可靠的口子是**下一次开跑时按证据自愈**（见下面 `leftoverActionOf` 那段）：那时三份内容都在盘上。
 *  这个处理器只兜住「子进程刚好结束、回到 JS 的那一刻被杀」这种次要窗口，成本 3 行，留着。 */
let inFlight = null; // { srcAbs, original, backup, mutated } | null
function restoreInFlight() {
  const f = inFlight;
  if (f === null) return "无在飞条目";
  inFlight = null;
  try {
    // `.mutbak` 从 `cpSync` 那一刻就存在（比突变早一拍：基线跑期间被杀时源文件还是干净的，
    // 但备份已经落了盘）。只还原内容不删备份，会让下次开跑被残留备份的 fail-closed 预检挡住。
    if (f.mutated) writeFileSync(f.srcAbs, f.original);
    rmSync(f.backup, { force: true });
    return `${f.mutated ? "已还原源文件" : "源文件未被改过"}，已清掉 ${f.backup}`;
  } catch { return "还原时抛错（收尾校验会抓到残留）"; }
}
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => {
    console.error(`[mutate-verify] 收到 ${sig}：${restoreInFlight()}，剩下的条目按未证记账并判红（不拿「没跑完」当「都杀了」）`);
    process.exit(1);
  });
}

function verifyEntry(m) {
  const disp = entryDisposition({
    srcRel: m.src,
    srcState: headStateOf(m.src),
    testRel: m.test,
    testState: headStateOf(m.test),
  });
  // refused 仍 fail-closed 抛死：源文件无 HEAD 兜底，崩了就回不来。
  if (disp.kind === "refused") throw new Error(disp.why);
  // unverified 只跳过本条——判卷文件只读不写，没有回滚风险，但也不能拿它当分辨力证据。
  if (disp.kind === "unverified") return { m, ok: null, why: disp.why };

  const srcAbs = join(ROOT, m.src);
  const backup = `${srcAbs}.mutbak`;
  const original = readFileSync(srcAbs, "utf8");
  cpSync(srcAbs, backup);
  inFlight = { srcAbs, original, backup, mutated: false }; // 备份一落盘就要能被收尾
  let restored = false;
  try {
    // ① 基线：突变前该测试必须绿
    const base = runTest(m.test);
    if (base.code !== 0) return { m, ok: false, why: `基线就不是全绿（不应发生）:\n${base.out.slice(-800)}` };

    // ② 注入突变
    const mutated = m.apply(original);
    if (mutated === original) return { m, ok: false, why: "突变未生效（锚点可能已失效）" };
    const syntax = mutantSyntaxProblem(mutated);
    if (syntax !== null) return { m, ok: false, why: syntax };
    inFlight.mutated = true; // 从这一行起，盘上的源文件是**改过**的内容
    writeFileSync(srcAbs, mutated);

    // ③ 突变后必须红，且红在期望的那条用例上
    const hit = runTest(m.test);
    writeFileSync(srcAbs, original); // 尽早还原
    inFlight = null;
    restored = true;
    if (hit.code === 0) return { m, ok: false, why: "变异存活：测试全绿 = 对该逻辑无分辨力（恒真等价）" };
    if (!hit.out.includes(m.expectFail)) {
      return { m, ok: false, why: `测试红了但没红在期望用例「${m.expectFail}」上——可能误伤无关用例:\n${hit.out.slice(-800)}` };
    }
    // ④ 还原后必须恢复全绿
    const back = runTest(m.test);
    if (back.code !== 0) return { m, ok: false, why: `还原后未恢复全绿:\n${back.out.slice(-800)}` };
    return { m, ok: true };
  } finally {
    inFlight = null; // 早退路径（基线不绿 / 突变未生效 / 语法错）也要清，别留一个指向已还原文件的空档
    if (!restored) writeFileSync(srcAbs, original);
    rmSync(backup, { force: true });
  }
}

const plan = classifyArgs(process.argv.slice(2));
/* 本文件在**顶层**跑表，所以 `import("scripts/mutate-verify.mjs")` 就等于发起一次整表变异
 * （实测：一次"只想数一下条目数"的 `node -e` 探针就在主树跑了起来，SIGKILL 后留下一枚 mutant，
 *  靠 `.mutbak` + 三条证据前提还原）。条目数请走 `--list`；被 import 时一个字节都不许动。 */
if (process.argv[1] === undefined || resolve(process.argv[1]) !== fileURLToPath(import.meta.url)) {
  console.error("mutate-verify 会就地改源文件：只能经命令行执行（数条目用 `--list`），被 import 时拒绝运行。");
  process.exit(2);
}
// 认不出的 flag 一律拒跑：本脚本「无参数」的缺省语义是跑全表，那会就地改源文件几十分钟。
if (plan.unknown.length > 0) {
  console.error(`未知参数：${plan.unknown.join(" ")} —— 无参数即「跑全表」（就地改源文件），不把拼错的 flag 静默当缺省`);
  process.exit(2);
}
if (plan.mode === "list") {
  for (const m of MUTATIONS) console.log(`${m.id}\t${m.src}\t${m.desc}`);
  process.exit(0);
}
/** 只核针脚、不跑测试（秒级）——因此它能进 pnpm gates，而整张变异表要跑几十分钟、
 *  常被并发堵着：那段时间里失效的锚点在「假装守护」。 */
if (plan.mode === "check-needles") {
  /** 盘上有 `.mutbak` ⇒ 同名源文件可能是上次没还原的**突变体**，而针脚正是从这份内容算的。
   *  不这么报的后果实测过（2026-09-23）：一条 gemini.ts 的尸体让 needles-check 报出「针脚失效」，
   *  读的人去改一条本来好好的锚点。这一支**只读**（体检不许改盘），所以只点名、不自愈，并判红。 */
  const corpses = leftoverBackupPaths([...new Set(MUTATIONS.map((m) => m.src))], (rel) => existsSync(join(ROOT, rel)));
  if (corpses.length > 0) {
    for (const p of corpses) console.log(`  ❌ 残留 ${p} —— 同名的源文件可能是未还原的突变体，下面的针脚是从它算的，不可信`);
    console.log("[mutate-needles-check] 先跑一次 mutate-verify（开跑前会按证据自愈），再核针脚");
    process.exit(1);
  }
  const bad = reportNeedles(MUTATIONS);
  // 顺带核每条**改法**产出的还是不是合法源文件：整张变异表要跑几十分钟且常被并发堵着，
  // 而这类错在变异跑里只会伪装成「误伤无关用例」。秒级能查出来的事不留到几十分钟后。
  const syntaxBad = [];
  for (const m of MUTATIONS) {
    let src;
    try {
      src = readFileSync(join(ROOT, m.src), "utf8");
    } catch {
      continue; // 源文件不存在另有针脚体检报
    }
    let out;
    try {
      out = m.apply(src);
    } catch (err) {
      syntaxBad.push([m.id, "apply 抛错：" + (err instanceof Error ? err.message : String(err))]);
      continue;
    }
    if (out === src) continue; // 未生效 = 针脚失效，上面已报
    const p = mutantSyntaxProblem(out);
    if (p !== null) syntaxBad.push([m.id, p]);
  }
  for (const [id, why] of syntaxBad) console.log(`  ❌ ${id} — ${why}`);
  if (syntaxBad.length > 0) console.log(`改法语法体检：${String(syntaxBad.length)} 条改法把源文件改坏 ❌`);
  else console.log(`改法语法体检：${String(MUTATIONS.length)} 条改法全部产出合法源文件 ✅`);
  console.log(bad === 0 && syntaxBad.length === 0
    ? "[mutate-needles-check] 全部锚点针脚可判定 ✅"
    : `[mutate-needles-check] ${String(bad + syntaxBad.length)} 条锚点针脚/改法失效 ❌`);
  process.exit(bad === 0 && syntaxBad.length === 0 ? 0 : 1);
}

const targets = plan.targets;
const requested = targets.length ? MUTATIONS.filter((m) => targets.includes(m.id)) : MUTATIONS;
if (targets.length && requested.length !== targets.length) {
  console.error(`未知 id: ${targets.filter((t) => !MUTATIONS.some((m) => m.id === t)).join(", ")}`);
  process.exit(2);
}

console.log(`变异验证：${requested.length} 条`);
// 预检（动因：HEAD 整跑实测烧掉 19 分钟才在第 k 条撞上"源文件未跟踪"，抛死后账本无痕）。
// 状态按路径缓存——696 条只对应几十个不同文件，逐条 git 会白跑上千次子进程。
const headStateCache = new Map();
const stateOf = (rel) => {
  let v = headStateCache.get(rel);
  if (v === undefined) { v = headStateOf(rel); headStateCache.set(rel, v); }
  return v;
};
/** 先自愈、再分流（2026-09-23 实测的次序缺陷）。处置块原先写在分流**之后**，于是「重跑被打污文件自己那条锚点」
 *  这条最自然的恢复动作会在 `entries.length === 0` 处提前退出，污染永远自愈不了。当场读数：
 *  `node scripts/mutate-verify.mjs gym-draft-worker-writes-as-parent` 只报「预检拒 1 条 ⇒ 判红退出」，
 *  盘上 `src/agent/gym/draft.ts.mutbak` 与原样留着的突变体一根手指都没碰——而它下一道门会把图读歪。
 *  判据只要 HEAD/备份/当前三份内容，与「本次跑哪几条」无关 ⇒ 提到分流前。
 *  顺带收益：`stateOf` 的缓存此刻还是空的，自愈之后分流读到的是还原后的干净态，那些锚点本轮就能照判。 */
healLeftoverBackups();
/** 预检**逐条**跳过不安全的那些，其余照跑（2026-09-23 改，此前是「有条目被拒 ⇒ 一条都不跑」）。
 *  旧写法的后果实测过：别人一个未跟踪的 `src/tools/snapshot.ts` 让 696 条锚点全部停摆，
 *  而红门只报「拒绝 1 条」——其余 695 条本可以判的文件没人判，读的人还以为保护在。
 *  让掉的只有安全性本身：被跳过的正是「崩溃后无 HEAD 可回滚」的 src，一条也不会被写；
 *  退出码照旧红（AGENTS 记的「主动拒变在飞文件＝属正确红」不变），只是这一回先把能跑的跑完。 */
const split = splitRunnable(requested.map((m) => ({
  id: m.id, srcRel: m.src, srcState: stateOf(m.src), testRel: m.test, testState: stateOf(m.test),
})));
const refusedIds = new Set(split.refused.map((r) => r.id));
const entries = requested.filter((m) => !refusedIds.has(m.id));
const refusedCount = split.refused.length;
if (refusedCount > 0) {
  for (const r of split.refused) console.error(`⚠️ 跳过 ${r.id} — ${r.why}`);
  console.error(`[mutate-verify] 预检拒 ${String(refusedCount)} 条（不安全，按未证记账），其余 ${String(entries.length)} 条照跑。` +
    "判卷文件在飞只让那一条不可判，源文件在飞只让那几条不跑——都不该停摆整张表。");
  if (entries.length === 0) {
    console.error("[mutate-verify] 一条都不安全 ⇒ 判红退出（这张表今天什么都没判，别让『没跑』读成『都杀了』）");
    process.exit(1);
  }
}
// 上一次没收尾干净就别硬跑：`.mutbak` 会在本次被 cpSync 覆盖，而它是"崩溃前原始内容"的唯一凭证。
// 但"别硬跑"不等于"一律交给人"——三份内容同一时刻都在盘上，能按证据自愈（判据在 `leftoverActionOf`）：
// 处置本体：备份 == HEAD、当前 != HEAD、且当前这份正好等于本表某条锚点
// 作用在备份上产出的突变体 ⇒ 是我们自己的残留，用备份盖回去无损；`isOurMutant` 不能省——
// 省了就会把「备份之后别人改了同一文件」一笔盖掉。**调用点在分流之前**，理由见那里的注释。
function healLeftoverBackups() {
  const allSrcs = [...new Set(MUTATIONS.map((m) => m.src))];
  const leftovers = leftoverBackupPaths(allSrcs, (rel) => existsSync(join(ROOT, rel)));
  if (leftovers.length === 0) return;
  const gitHeadText = (rel) => {
    try { return execFileSync("git", ["show", "HEAD:" + rel], { cwd: ROOT, encoding: "utf8" }); } catch { return null; }
  };
  const readOr = (abs) => { try { return readFileSync(abs, "utf8"); } catch { return null; } };
  const healed = [];
  const manual = [];
  for (const p of leftovers) {
    const srcRel = p.replace(/\.mutbak$/, "");
    const srcAbs = join(ROOT, srcRel);
    const bakText = readOr(join(ROOT, p));
    const curText = existsSync(srcAbs) ? readOr(srcAbs) : null;
    const isOurMutant = curText !== null && bakText !== null && MUTATIONS.some((m) => {
      if (m.src !== srcRel) return false;
      try { return m.apply(bakText) === curText; } catch { return false; }
    });
    const act = leftoverActionOf(gitHeadText(srcRel), bakText, curText, isOurMutant);
    if (act === "restore") {
      writeFileSync(join(ROOT, srcRel), bakText);
      rmSync(join(ROOT, p), { force: true });
      healed.push(`还原 ${srcRel}（备份 == HEAD，盘上那份是本表某条锚点留下的突变体）`);
    } else if (act === "drop-backup") {
      rmSync(join(ROOT, p), { force: true });
      healed.push(`删掉过期备份 ${p}（源文件已与 HEAD 一致）`);
    } else {
      manual.push(p);
    }
  }
  for (const h of healed) console.error("⚠️ 自愈：" + h);
  if (manual.length > 0) {
    for (const p of manual) console.error(`❌ 残留备份：${p} —— 备份与 HEAD 不一致，或当前内容对不上任何锚点的改法，不敢自动覆盖`);
    console.error("[mutate-verify] 这类残留说明中间还夹着别人的在飞改动，按两步人工处理：");
    for (const p of manual) console.error(`  1) git diff HEAD -- "${p.replace(/\.mutbak$/, "")}"   # 看清两边各是什么`);
    console.error("  2) 确认无误后删掉这些 .mutbak 再重跑");
    process.exit(1);
  }
  if (healed.length > 0) console.error("[mutate-verify] 自愈完成，继续本次判定（这些还原本身仍会过一遍收尾校验）");
}
// 自我预算：外层（`pnpm gates`）对本门有每道约 20 分钟的硬超时，而整张表实测要 20+ 分钟——
// 被掐死的位置若正好在「源文件是突变体」那一拍，就会留下污染（见 `restoreInFlight` 上面那段）。
// 给了预算就**自己**在条目边界收尾：还原完全、报「未判 N 条」、判红退出，绝不把「没跑完」读成「都杀了」。
const budget = budgetMsOf(process.argv.slice(2), process.env.DSH_MUTATE_BUDGET_MS);
if (budget.warning !== null) console.error(`⚠️ ${budget.warning}`);
const startedAt = Date.now();
let stoppedEarly = 0;
const results = [];
for (let i = 0; i < entries.length; i++) {
  const m = entries[i];
  if (budget.ms > 0 && Date.now() - startedAt >= budget.ms) {
    stoppedEarly = entries.length - i;
    for (const rest of entries.slice(i)) results.push({ m: rest, ok: null, why: "预算用尽，没跑到（不等于已杀死）" });
    console.error(`[mutate-verify] ⏳ 预算 ${String(budget.ms)}ms 用尽：已跑 ${String(i)}/${String(entries.length)}，未判 ${String(stoppedEarly)} 条。` +
      "在条目边界主动收尾（源文件已全部还原），剩下的按未证记账并判红。");
    break;
  }
  const r = verifyEntry(m);
  const mark = r.ok === null ? "⏭️" : r.ok ? "✅" : "❌";
  console.log(`${mark} ${m.id} — ${m.desc}`);
  if (r.ok !== true) console.log(`   ${r.why}`);
  results.push(r);
}

// 强制收尾校验：所有被测源文件必须零 diff（还原失败 = 判红）
const srcs = [...new Set(entries.map((m) => m.src))];
// 收尾校验：git diff HEAD 看不见未跟踪文件，必须用 git status --porcelain 才能抓住
// 「未跟踪文件被改动」和「已跟踪文件相对 HEAD 漂移」两种残留。
const statusOut = execFileSync("git", ["status", "--porcelain", "--", ...srcs, ...srcs.map(backupPathOf)], {
  cwd: ROOT, encoding: "utf8",
}).trim();
if (statusOut) {
  console.error(`⚠️ 还原失败，以下源文件残留改动（必须人工检查）：\n${statusOut}`);
  process.exit(1);
}
const failed = results.filter((r) => r.ok === false);
const unverified = results.filter((r) => r.ok === null);
// 未证有三类，分开数但同一处出口——每类的下一步动作不同，混成一句就会把人指错方向：
// ① 预检跳过（源文件在飞/未跟踪，根本没跑）② 判卷文件在飞（跑到了但量不出分辨力）③ 预算用尽（还没轮到）
const unverifiedTotal = unverified.length + refusedCount;
if (unverifiedTotal > 0) {
  const parts = [];
  if (refusedCount > 0) parts.push(`${String(refusedCount)} 条源文件在飞/未跟踪 ⇒ 根本没跑`);
  if (unverified.length - stoppedEarly > 0) parts.push(`${String(unverified.length - stoppedEarly)} 条判卷文件在飞 ⇒ 量不出分辨力`);
  if (stoppedEarly > 0) parts.push(`${String(stoppedEarly)} 条预算用尽没跑到`);
  console.log(`  ⚠️  未证 ${String(unverifiedTotal)} 条（${parts.join("；")}）——都不等于已杀死`);
  console.log("UNVERIFIED=" + String(unverifiedTotal));
}
const killed = results.length - failed.length - unverified.length;
console.log(`\n${failed.length === 0
  ? (unverifiedTotal === 0
      ? "全部变异被正确杀死（断言非恒真）"
      : `${String(killed)} 条被正确杀死，另 ${String(unverifiedTotal)} 条未证`)
  : `${String(failed.length)} 条变异存活或误伤`}`);
// 耗时与「跑了几条」要自己报出来：外层对本门的超时是猜的（实测 1200s 掐死于表中途），
// 而这张表到底要跑多久此前没人打印过——没有读数，下一个人只能继续猜。
const secs = (Date.now() - startedAt) / 1000;
console.log(`[mutate-verify] 本次耗时 ${secs.toFixed(1)}s · 跑了 ${String(results.length - stoppedEarly)}/${String(entries.length)} 条` +
  (budget.ms > 0 ? ` · 预算 ${String(Math.round(budget.ms / 1000))}s` : " · 未设预算（外层超时会在中途杀我，见 --budget-ms）"));
// 有未证就红：这张表没判完不等于判完了（AGENTS：「主动拒变在飞文件」属正确红，不是回归）。
// 预算中途停下同样红：`stoppedEarly > 0` 时 failed 可以全空，但那只是「还没轮到」。
process.exit(failed.length === 0 && refusedCount === 0 && stoppedEarly === 0 ? 0 : 1);
