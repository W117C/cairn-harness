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

import { cpSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
// 判据本体在 TS 侧（可被 tests/ 直接断言）；本脚本经 tsx 运行，见 package.json 的 mutate-verify。
import { entryDisposition } from "./lib/mutate-gates.ts";

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
    apply: (s) => s.replace("      if (defined.length === 0 && (graph.refs.get(symbol) ?? []).length === 0) {\n", "      if (false) {\n"),
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
    apply: (s) => s.replace("          if (!graph.files.includes(rel)) return { ok: false, output: NOT_IN_GRAPH };\n", ""),
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
    apply: (s) => s.replace("return { command, ok: res.ok, output: res.output };", "return { command: mapped, ok: res.ok, output: res.output };"),
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
    apply: (s) => s.replace("description: typeof t.description === \"string\" ? capMcpDescription(t.description) : \"\",", "description: typeof t.description === \"string\" ? t.description : \"\","),
    expectFail: "tools/list 的 5000 字符描述进注册表时已被收窄（每轮重送的那一份）",
  },
  {
    id: "skill-suffix-not-charged-to-budget",
    src: "src/agent/text-budget.ts",
    test: "tests/skill-body-cap.test.ts",
    desc: "取回提示不计入预算 ⇒ 「总量 ≤ 预算」这句承诺被提示自己撑破（与 run_shell 的 SHELL_NOTICE_RESERVE 同族坑）",
    apply: (s) => s.replace("return cutToWeight(text, Math.max(0, tokenBudget - weightOf(notice))) + notice;", "return cutToWeight(text, tokenBudget) + notice;"),
    expectFail: "超限时提示自己不得撑破预算（总量 ≤ 预算，且提示完整保留）",
  },
  {
    id: "skill-primary-budget-abolished",
    src: "src/agent/plugins/index.ts",
    test: "tests/skill-body-cap.test.ts",
    desc: "触发主路径的预算被取消（重挂那头有预算、这头没有）⇒ 200KB 的 SKILL.md 原样进 tool_result，且 skill 免剪 ⇒ 整个会话常驻付费",
    apply: (s) => s.replace("clampSkillBody(entry.body, SKILL_REMOUNT_TOKENS_PER_SKILL,", "clampSkillBody(entry.body, Number.MAX_SAFE_INTEGER,"),
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
    apply: (s) => s.replace("return cutToWeight(text, Math.max(0, allowed)) + marker + suffix;", "return text.slice(0, Math.max(0, tokenBudget * 4 - marker.length - suffix.length)) + marker + suffix;"),
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
  const mark = r.ok === null ? "⏭️" : r.ok ? "✅" : "❌";
  console.log(`${mark} ${m.id} — ${m.desc}`);
  if (r.ok !== true) console.log(`   ${r.why}`);
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
const failed = results.filter((r) => r.ok === false);
const unverified = results.filter((r) => r.ok === null);
if (unverified.length > 0) {
  console.log(`  ⚠️  未证 ${String(unverified.length)} 条（判卷文件在飞 ⇒ 该条根本没跑到——不等于已杀死）`);
  console.log("UNVERIFIED=" + String(unverified.length));
}
const killed = results.length - failed.length - unverified.length;
console.log(`\n${failed.length === 0
  ? (unverified.length === 0
      ? "全部变异被正确杀死（断言非恒真）"
      : `${String(killed)} 条被正确杀死，另 ${String(unverified.length)} 条未证`)
  : `${String(failed.length)} 条变异存活或误伤`}`);
process.exit(failed.length === 0 ? 0 : 1);
