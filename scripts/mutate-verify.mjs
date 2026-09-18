// 变异验证器：证明单元测试不是恒真的（make-neg-controls.mjs 的逻辑层泛化）。
//
// 理念：门禁体检只能静态查出「恒真式/空断言」；一条断言即便非空，也可能根本不针对
// 被测逻辑。唯一可靠的经验证法是**注入一处行为突变，看测试是否真的红**：
//   存活（mutation survived）= 测试对该逻辑无分辨力 = 恒真式等价物。
// 这把「我觉得代码能跑」变成「我证明了换掉这段逻辑，验收会抓住」。
//
// 用法：
//   node scripts/mutate-verify.mjs                 # 跑配置表里全部条目
//   node scripts/mutate-verify.mjs <id>            # 只跑一条
//   node scripts/mutate-verify.mjs --list          # 列出条目
//
// 安全：被测源文件先备份，finally 原样还原；进程退出前强制再校验一次
// `git diff HEAD --quiet`——还原失败即判红，绝不把突变留在工作树里。
// （与 M7 在飞集零相交：只动自己登记的源文件，且进出都校验零 diff。）

import { cpSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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
    id: "secrets-atomic-rename",
    src: "src/agent/plugins/secrets.ts",
    test: "tests/secrets.test.ts",
    desc: "去掉 rename：tmp 写完不落定（崩溃即丢密文）",
    apply: (s) => s.replace('    await writeFile(tmp, JSON.stringify(store, null, 2) + "\\n", "utf8");\n    await rename(tmp, p);',
                            '    await writeFile(tmp, JSON.stringify(store, null, 2) + "\\n", "utf8");'),
    expectFail: "原子写：经 tmp→rename 落盘，成功后无 .tmp 残留",
  },
  {
    id: "secrets-atomic-direct-write",
    src: "src/agent/plugins/secrets.ts",
    test: "tests/secrets.test.ts",
    desc: "tmp+rename 退回裸 writeFile（写中途崩溃截断密文存储）",
    apply: (s) => s.replace(
      '  const tmp = p + ".tmp-" + String(process.pid) + "-" + String(Date.now());\n' +
      '  try {\n' +
      '    await writeFile(tmp, JSON.stringify(store, null, 2) + "\\n", "utf8");\n' +
      '    await rename(tmp, p);\n' +
      '  } catch (err) {\n' +
      '    await unlink(tmp).catch(() => {});\n' +
      '    throw err;\n' +
      '  }',
      '  await writeFile(p, JSON.stringify(store, null, 2) + "\\n", "utf8");'),
    expectFail: "原子写：经 tmp→rename 落盘，成功后无 .tmp 残留",
  },
  {
    id: "secrets-tmp-cleanup",
    src: "src/agent/plugins/secrets.ts",
    test: "tests/secrets.test.ts",
    desc: "写失败分支不清理 tmp（残留临时文件堆积）",
    apply: (s) => s.replace("    await unlink(tmp).catch(() => {});\n", ""),
    expectFail: "写失败时 tmp 被清理，且不截断既有密文存储",
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
    apply: (s) => s.replace('if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;', "if (false) throw err;"),
    expectFail: "config.json 坏 JSON → fail loud（ENOENT 才可降级到探测）",
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
    apply: (s) => s.replace("out.replacements.set(i + 1, PRUNED_PLACEHOLDER);", "out.replacements.set(i, PRUNED_PLACEHOLDER);"),
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
    apply: (s) => s.replace("if (oldContent === content) {", "if (false) {"),
    expectFail: "空变更：空白 content 与 old_content===content 都报 empty_change（无内容可沉淀）",
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
    apply: (s) => s.replace("return out.sort((a, b) => b.mtimeMs - a.mtimeMs);", "return out.sort((a, b) => a.mtimeMs - b.mtimeMs);"),
    expectFail: "mtime 降序（最近在上）——当前会话回退取列表首个的数据面",
  },
  {
    id: "sessions-collision-suffix",
    src: "src/main/sessions.ts",
    test: "tests/sessions.test.ts",
    desc: "撞名序号从 2 起（① 冲突覆盖：同名会话被新建空文件覆盖）",
    apply: (s) => s.replace("for (let i = 2; ; i++) {", "for (let i = 1; ; i++) {"),
    expectFail: "新建撞名自动加序号；空目录列表为空",
  },
  {
    id: "sessions-lines-nonempty",
    src: "src/main/sessions.ts",
    test: "tests/sessions.test.ts",
    desc: "行数口径把空行计入（投影事件数虚高 +1，验收口径破裂）",
    apply: (s) => s.replace(".filter((l) => l.trim().length > 0)", ".filter(() => true)"),
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
    apply: (s) => s.replace("if (!isValidSessionName(id)) throw new Error(", "if (false) throw new Error("),
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
    desc: "首行 session_meta 严格校验被拆（任意首行都投影 scheduled 徽标，自动化徽标错配）",
    apply: (s) => s.replace("if (meta.type !== \"session_meta\" || meta.origin !== \"scheduled\") return null;", "if (false) return null;"),
    expectFail: "交互会话不投影 scheduled 徽标（只有首行 session_meta origin=scheduled 才投影）",
  },
  {
    id: "semantic-admission-never-reports",
    src: "src/agent/orchestrator.ts",
    test: "tests/impact-admission.test.ts",
    desc: "语义波及相交不再上报（B1 退化回「只看 glob」：两个 worker 各改各文件却波及同一批调用点，合并时才打架）",
    apply: (x) => x.replace('if (shared.length > 0) out.push({ agentId: w.agentId, resource: "波及 " + shared.join("、") });', 'if (false) out.push({ agentId: w.agentId, resource: "波及 " + shared.join("、") });'),
    expectFail: "utils.js × math.js：glob 不相交，波及集相交 ⇒ 语义闸报冲突",
  },
  {
    id: "semantic-admission-guard-removed",
    src: "src/agent/orchestrator.ts",
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
];

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

/** 被测源文件必须已跟踪且相对 HEAD 零 diff。
 *  未跟踪文件（M7 在飞等）不进变异表：还原只能靠内存备份，一旦中途崩溃
 *  无 HEAD 可回滚 —— 违反零相交纪律。这里 fail-closed 拒绝，而不是赌不会崩。 */
function assertCommittedToHead(srcAbs, rel) {
  const tracked = execFileSync("git", ["ls-files", "--", rel], { cwd: ROOT, encoding: "utf8" }).trim();
  if (!tracked) throw new Error(`${rel} 未跟踪（不在 HEAD 里）—— 变异中途崩溃无回滚兜底，拒绝`);
  try {
    execFileSync("git", ["diff", "HEAD", "--quiet", "--", rel], { cwd: ROOT });
  } catch {
    throw new Error(`${rel} 相对 HEAD 有工作树改动——属在飞改动集，拒绝变异`);
  }
}

function verifyEntry(m) {
  const srcAbs = join(ROOT, m.src);
  assertCommittedToHead(srcAbs, m.src);
  const backup = `${srcAbs}.mutbak`;
  const original = readFileSync(srcAbs, "utf8");
  cpSync(srcAbs, backup);
  let restored = false;
  try {
    // ① 基线：突变前该测试必须绿
    const base = runTest(m.test);
    if (base.code !== 0) return { m, ok: false, why: `基线就不是全绿（不应发生）:\n${base.out.slice(-800)}` };

    // ② 注入突变
    const mutated = m.apply(original);
    if (mutated === original) return { m, ok: false, why: "突变未生效（锚点可能已失效）" };
    writeFileSync(srcAbs, mutated);

    // ③ 突变后必须红，且红在期望的那条用例上
    const hit = runTest(m.test);
    writeFileSync(srcAbs, original); // 尽早还原
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
    if (!restored) writeFileSync(srcAbs, original);
    rmSync(backup, { force: true });
  }
}

const args = process.argv.slice(2);
if (args.includes("--list")) {
  for (const m of MUTATIONS) console.log(`${m.id}\t${m.src}\t${m.desc}`);
  process.exit(0);
}

const targets = args.filter((a) => !a.startsWith("--"));
const entries = targets.length ? MUTATIONS.filter((m) => targets.includes(m.id)) : MUTATIONS;
if (targets.length && entries.length !== targets.length) {
  console.error(`未知 id: ${targets.filter((t) => !MUTATIONS.some((m) => m.id === t)).join(", ")}`);
  process.exit(2);
}

console.log(`变异验证：${entries.length} 条`);
const results = entries.map((m) => {
  const r = verifyEntry(m);
  console.log(`${r.ok ? "✅" : "❌"} ${m.id} — ${m.desc}`);
  if (!r.ok) console.log(`   ${r.why}`);
  return r;
});

// 强制收尾校验：所有被测源文件必须零 diff（还原失败 = 判红）
const srcs = [...new Set(entries.map((m) => m.src))];
// 收尾校验：git diff HEAD 看不见未跟踪文件，必须用 git status --porcelain 才能抓住
// 「未跟踪文件被改动」和「已跟踪文件相对 HEAD 漂移」两种残留。
const statusOut = execFileSync("git", ["status", "--porcelain", "--", ...srcs], {
  cwd: ROOT, encoding: "utf8",
}).trim();
if (statusOut) {
  console.error(`⚠️ 还原失败，以下源文件残留改动（必须人工检查）：\n${statusOut}`);
  process.exit(1);
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? "全部变异被正确杀死（断言非恒真）" : `${failed.length} 条变异存活或误伤`}`);
process.exit(failed.length === 0 ? 0 : 1);
