// M2f 明卷验收：pnpm security-check（白名单内脚本，仿 memory-check / plugins-check 体例）。
// 断言面（任务书任务 6/7 明确要求落在本脚本的条目）：
//   A 变更集：从事件流写动作重建（write_file 的 content / edit_file 的 old+new），不引入快照、不用 git diff
//   B 密钥扫描：已知模式（sk- 等）+ 高熵串（Shannon 熵）命中；干净代码零误报
//   C 危险 API 六类：eval / 反序列化 / 弱随机 / 命令拼接 / SQL 拼接 / 路径穿越 各命中一条
//   D findings 严格 schema：字段/枚举合法；行号落在变更集内
//   E 注入防线：被审内容里的「忽略以上指令」不影响 findings 生成（数据不是指令）
//   F 触发与呈现：验证门收敛后 hook 触发；默认 report、off 不跑；不阻断主流程；报告复用现有 report 卡类型
//   G 输出扫描：报告进事件流前脱敏（findings 描述里无完整密钥）
// 全程不依赖沙箱（显式 sandbox: null；报告是静态快筛，零 token）。
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentEvent, SecurityFinding, SecuritySeverity } from "../src/events";
import { createEventLog, replay } from "../src/events";
import { runAgent, initSettingsStore, shouldRunSecurityReport } from "../src/main/agent-runner";
import { DEFAULT_SETTINGS } from "../src/main/settings";
// H 段（合并准入闸，2026-10-02 增补）：判据与卡面全在纯模块里，生产与本门共用同一份。
import { parseLlmFindings } from "../src/agent/security/llm-review";
import { MERGE_BLOCKING_SEVERITIES, mergeGateVerdict } from "../src/agent/security/merge-gate";
import {
  DANGER_CATEGORIES,
  buildSecurityReport,
  changeSetRefs,
  collectChangeSet,
  findHighEntropyTokens,
  redactSecrets,
  scanChangeSet,
  validateFinding,
  SEVERITY_ORDER,
  type ChangeSetEntry,
} from "../src/agent/security/scan";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FX = join(ROOT, "fixtures", "security");

let pass = 0;
let fail = 0;
function ok(name: string): void {
  pass++;
  console.log("  ✅ " + name);
}
function bad(name: string, detail?: string): void {
  fail++;
  console.log("  ❌ " + name + (detail ? "（" + detail + "）" : ""));
}
function assert(cond: boolean, name: string, detail?: string): void {
  if (cond) ok(name);
  else bad(name, detail);
}

const work = await mkdtemp(join(tmpdir(), "m2f-security-check-"));

/** 临时工作区：package.json + .agent/config.json（verify = 零依赖直通命令，不依赖沙箱/网络）。 */
async function makeWorkspace(tag: string): Promise<string> {
  const ws = join(work, tag);
  await mkdir(join(ws, ".agent"), { recursive: true });
  await writeFile(join(ws, "package.json"), JSON.stringify({ name: "m2f-sec-" + tag, private: true }), "utf8");
  await writeFile(
    join(ws, ".agent", "config.json"),
    JSON.stringify({ verify: { test: ['node -e "process.exit(0)"'] } }),
    "utf8",
  );
  return ws;
}

/** 明卷剧本：写两个文件 + 调 verify（收敛后即触发 report hook）。 */
async function makeScript(ws: string, tag: string): Promise<string> {
  const vuln = await readFile(join(FX, "audit-demo.ts"), "utf8");
  const clean = await readFile(join(FX, "clean-demo.ts"), "utf8");
  const script = [
    { type: "assistant_message", content: "写入审计样例文件。" },
    { type: "tool_call", id: tag + "-c1", name: "write_file", args: { path: "src/clean-demo.ts", content: clean } },
    { type: "tool_call", id: tag + "-c2", name: "write_file", args: { path: "src/audit-demo.ts", content: vuln } },
    { type: "assistant_message", content: "跑验证。" },
    { type: "tool_call", id: tag + "-v", name: "verify", args: {} },
    { type: "assistant_message", content: "完成。" },
  ];
  const p = join(ws, "script.jsonl");
  await writeFile(p, script.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
  return p;
}

async function runWithMode(tag: string, safeMode: "off" | "report"): Promise<AgentEvent[]> {
  const ws = await makeWorkspace(tag);
  const scriptPath = await makeScript(ws, tag);
  const settingsPath = join(work, "settings-" + tag + ".json");
  await writeFile(settingsPath, JSON.stringify({ safeMode, autoMemory: false }), "utf8");
  initSettingsStore(settingsPath);
  const logPath = join(ws, "events.jsonl");
  const prev = process.env.M1C_AUTONOMY_SCRIPT;
  process.env.M1C_AUTONOMY_SCRIPT = scriptPath;
  try {
    await runAgent({ workspace: ws, message: "写入样例并验证", mode: "auto", logPath, sandbox: null, trustedRepo: true });
  } finally {
    if (prev === undefined) delete process.env.M1C_AUTONOMY_SCRIPT;
    else process.env.M1C_AUTONOMY_SCRIPT = prev;
  }
  return await replay(logPath);
}

try {
  console.log("[security-check] 默认档 = report");
  assert(DEFAULT_SETTINGS.safeMode === "report", "DEFAULT_SETTINGS.safeMode = report（默认 report）");

  console.log("[security-check] A 变更集从事件流写动作重建");
  const vulnContent = await readFile(join(FX, "audit-demo.ts"), "utf8");
  const cleanContent = await readFile(join(FX, "clean-demo.ts"), "utf8");
  const synthetic: AgentEvent[] = [
    { type: "user_message", content: "改代码" },
    { type: "tool_call", id: "a1", name: "write_file", args: { path: "src/audit-demo.ts", content: vulnContent } },
    { type: "tool_call", id: "a2", name: "edit_file", args: { path: "src/other.ts", old_string: "old", new_string: "const x = eval(inp);" } },
    { type: "tool_result", callId: "a1", ok: true, output: "已写入" },
  ];
  const entries = collectChangeSet(synthetic);
  assert(entries.length === 2, "重建出 2 条变更（write_file + edit_file）", "实际 " + String(entries.length));
  const writeEntry = entries.find((e) => e.op === "write");
  const editEntry = entries.find((e) => e.op === "edit");
  assert(writeEntry?.path === "src/audit-demo.ts" && writeEntry.lines.length > 0, "write_file 的 content 进了变更集");
  assert(
    editEntry?.path === "src/other.ts" && editEntry.lines.join("\n").includes("eval"),
    "edit_file 的 new_string 进了变更集（old/new 来自 tool_call）",
  );
  assert(changeSetRefs(entries).every((r) => r.lines > 0), "changeSet refs 行数在场（报告可审计）");

  console.log("[security-check] C 危险 API 六类各命中一条");
  const findings = scanChangeSet(entries);
  const byCat = new Map<string, number>();
  for (const f of findings) byCat.set(f.category, (byCat.get(f.category) ?? 0) + 1);
  for (const c of DANGER_CATEGORIES) {
    assert((byCat.get(c) ?? 0) >= 1, "六类命中：" + c + " × " + String(byCat.get(c) ?? 0));
  }

  console.log("[security-check] B 密钥扫描（已知模式 + 高熵）");
  assert(
    findings.some((f) => f.ruleId === "secret.openai"),
    "已知模式命中：sk- 密钥",
  );
  const entropyHits = findings.filter((f) => f.ruleId === "secret.high_entropy");
  assert(entropyHits.length >= 1, "高熵密钥串被命中（" + String(entropyHits.length) + " 条）");
  assert(
    entropyHits.length >= 1 && entropyHits.every((f) => f.path === "src/audit-demo.ts"),
    "高熵命中落在被审文件（src/audit-demo.ts）",
  );
  // 熵探测自身单测：高熵串命中、低熵长标识符不命中
  assert(findHighEntropyTokens('const k = "Zx9Q2mLp7Rk4Tv8Nw3Yb6Hc1Jd5Fs0Ga";').length === 1, "熵探测：高熵串命中");
  assert(
    findHighEntropyTokens("export const SIDECHAT_PROJECTION_ROUNDS = 20;").length === 0,
    "熵探测：低熵长标识符不误报",
  );
  // 干净代码零 findings
  const cleanEntries: ChangeSetEntry[] = [{ path: "src/clean-demo.ts", op: "write", lines: cleanContent.split("\n") }];
  assert(scanChangeSet(cleanEntries).length === 0, "干净代码零误报（clean-demo.ts）");

  console.log("[security-check] D findings 严格 schema + 行号落在变更集内");
  assert(findings.length > 0 && findings.every((f) => validateFinding(f)), "全部 findings 通过严格 schema");
  const linesOf = new Map<string, number[]>();
  for (const e of entries) linesOf.set(e.path, [...(linesOf.get(e.path) ?? []), e.lines.length]);
  assert(
    findings.every((f) => (linesOf.get(f.path) ?? []).some((n) => f.line >= 1 && f.line <= n)),
    "findings 行号落在变更集内",
  );
  // schema 拒绝坏条目
  assert(!validateFinding({ ruleId: "x", category: "eval" }), "schema 拒绝缺字段条目");
  assert(!validateFinding({ ...findings[0], line: 0 }), "schema 拒绝 line < 1");

  console.log("[security-check] E 注入防线（被审内容是数据不是指令）");
  const withoutInjection = vulnContent
    .split("\n")
    .filter((l) => !l.includes("忽略以上指令"))
    .join("\n");
  const variant: ChangeSetEntry[] = [{ path: "src/audit-demo.ts", op: "write", lines: withoutInjection.split("\n") }];
  const variantFindings = scanChangeSet(variant);
  assert(
    variantFindings.length === findings.filter((f) => f.path === "src/audit-demo.ts").length,
    "被审内容里的「忽略以上指令」不影响 findings 生成（数量一致：" + String(variantFindings.length) + "）",
  );
  assert(
    variantFindings.some((f) => f.category === "eval") && variantFindings.some((f) => f.ruleId === "secret.high_entropy"),
    "注入文本未压制任何类别（eval / 高熵密钥仍命中）",
  );

  console.log("[security-check] G 输出扫描（报告进事件流前脱敏）");
  const red = redactSecrets("token sk-abcdefghijklmnopqrstuvwxyz012345 与 Zx9Q2mLp7Rk4Tv8Nw3Yb6Hc1Jd5Fs0Ga 都要换");
  assert(!red.text.includes("sk-abcdefghijklmnopqrstuvwxyz012345"), "输出扫描脱敏 sk- 密钥");
  assert(!red.text.includes("Zx9Q2mLp7Rk4Tv8Nw3Yb6Hc1Jd5Fs0Ga"), "输出扫描脱敏高熵串");
  assert(red.findings.length >= 2, "输出扫描产出命中清单（可审计）");
  assert(!red.blocked, "普通高熵/模式密钥 = 脱敏不阻断");
  assert(redactSecrets("-----BEGIN RSA PRIVATE KEY-----\nMIIE...").blocked, "私钥块 = 阻断（critical）");

  console.log("[security-check] F 触发与呈现（验证门收敛后 hook；off 不跑；不阻断主流程）");
  assert(shouldRunSecurityReport("report", [{ type: "verify_result", callId: "v", ok: true, attempt: 1, maxAttempts: 3, results: [] }]), "report + verify 收敛 → 触发");
  assert(!shouldRunSecurityReport("off", [{ type: "verify_result", callId: "v", ok: true, attempt: 1, maxAttempts: 3, results: [] }]), "off → 不跑");
  assert(!shouldRunSecurityReport("report", [{ type: "user_message", content: "x" }]), "report 但无 verify 收敛 → 不跑");

  const offEvents = await runWithMode("off", "off");
  const reportEvents = await runWithMode("report", "report");
  const shape = (evs: AgentEvent[]): string =>
    JSON.stringify(
      evs.map((e) => (e.type === "tool_call" ? "call:" + e.name : e.type === "verify_result" ? "verify:" + String(e.ok) : e.type)),
    );
  assert(shape(offEvents) === shape(reportEvents.filter((e) => e.type !== "security_report")), "不改动主流程结果（工具/验证序列逐字一致）");
  assert(!offEvents.some((e) => e.type === "security_report"), "off：无 security_report 事件");
  assert(
    reportEvents.filter((e) => e.type === "security_report").length === 1,
    "report：恰 +1 条 security_report 事件",
  );
  assert(reportEvents[reportEvents.length - 1]?.type === "security_report", "报告在验证门收敛后追加（末尾，不阻断）");
  const report = reportEvents.find((e) => e.type === "security_report");
  assert(report?.type === "security_report" && report.summary.total > 0, "报告含 findings 汇总");
  if (report?.type === "security_report") {
    // 此前这里断的是 securityReportCardPayload 拼出来的卡片文案——那份文案产品在 src/ 里
    // 零调用者（面板排版走 projections.ts 的结构化 findings），等于验一个不发货的面。
    // 改成锁**上屏的那份数据**：面板直接取三元组排版，缺一个就渲染成空白行；
    // 汇总数字与逐条列表不许各说各话（同一份事件的两个口径）。
    assert(
      report.findings.every((f) => f.path !== "" && f.title !== "" && f.description !== "" && Number.isInteger(f.line) && f.line >= 0),
      "每条 finding 都带 path/title/description/line（面板按这些字段排版，缺一格就空一行）",
    );
    assert(
      SEVERITY_ORDER.reduce((n, s) => n + (report.summary.bySeverity[s] ?? 0), 0) === report.findings.length,
      "summary.bySeverity 分级计数与 findings 条数一致（「共 N 条」与列表同源）",
    );
    assert(
      report.findings.every((f) => (report.summary.byCategory[f.category] ?? 0) > 0),
      "每条 finding 的分类都进了 byCategory（分类汇总不漏项）",
    );
    assert(
      !JSON.stringify(report.findings).includes("sk-abcdefghijklmnopqrstuvwxyz012345"),
      "报告进事件流前过输出扫描（findings 描述无完整密钥）",
    );
    assert(report.changeSet.some((c) => c.path === "src/audit-demo.ts"), "报告携带变更集（可审计）");
  }
  // 纯函数面：无写动作 → 不产报告
  assert(buildSecurityReport([{ type: "user_message", content: "只聊天" }]) === null, "无写动作 → 不产报告（零行为）");

  console.log("[security-check] 报告事件可重放（事件流契约）");
  const ws = await makeWorkspace("replay");
  const logPath = join(ws, "replay.jsonl");
  const log = createEventLog(logPath);
  if (report) await log.append(report);
  const back = await replay(logPath);
  assert(back.length === 1 && back[0]?.type === "security_report", "security_report 事件 append/replay 往返无损");
} finally {
  await rm(work, { recursive: true, force: true }).catch(() => {});
}

// ── H · 合并准入闸（2026-10-02 增补）────────────────────────────────────────────
// 立项动因：普查实测 `llmReviewDiff` 是「静态扫描漏了、LLM 补上」这条**唯一**兜底路径，
// 而本门此前 `llm` / `gate` / `merge` / `blocking` 各出现 0 次 ⇒ 43 条安全断言**不覆盖**合入门。
// 后果具体到一句话：把 `high` 从闸的过滤器里删掉，全仓一条断言都不会红。
//
// 零花费、零凭据：`llmReviewDiff` 的**输出解析段**（`parseLlmFindings`）是纯函数，
// 不拨号；`llmReviewDiff` 本体要 CAIRN_API_KEY，但本门只验「解析出来的 severity 能不能挡住合并」，
// 那正是无凭据也能钉死的一格。真拨号那一段仍按 BYOK 缺席显式 skipped（不在本门范围）。
console.log("[security-check] H · 合并准入闸：LLM 补出的高危能不能真的挡住合并");
{
  const llmRaw = (severity: string): string =>
    JSON.stringify([{ severity, path: "src/risky.ts", line: 12, title: "硬编码密钥", description: "d" }]);

  // H1 链路：LLM 说 high ⇒ parse 保住 severity ⇒ 闸拒。
  const highParsed = parseLlmFindings(llmRaw("high"), 0);
  assert(highParsed.length === 1 && highParsed[0]?.severity === "high", "H1 LLM 报 high ⇒ 解析后仍是 high（severity 没被悄悄降级）");
  assert(!mergeGateVerdict(highParsed).allow, "H2 闸：high 挡住合并（合并权永远在人）");

  // H3 两档都要挡——只钉 high 会让 critical 那档成为未检格。
  assert(!mergeGateVerdict(parseLlmFindings(llmRaw("critical"), 0)).allow, "H3 闸：critical 同样挡住合并");

  // H4 低档不挡：gate 不是「零告警才能合并」，否则实践中等于关掉。
  assert(mergeGateVerdict(parseLlmFindings(llmRaw("medium"), 0)).allow, "H4 medium 不挡（闸只拦 high|critical）");

  // H5 force 是逐次的人确认，且必须留下痕迹（三态，不是两态）。
  const forced = mergeGateVerdict(parseLlmFindings(llmRaw("high"), 0), { force: true });
  assert(forced.allow && forced.forced === true, "H5 force=true ⇒ 放行但留 forced 痕迹（人确认这条路有证人）");
  assert(!mergeGateVerdict(parseLlmFindings(llmRaw("high"), 0)).allow, "H5b force 只对当次生效（另一次调用仍然拒）");

  // H6 漏报那一侧：非法 severity 不许被「宽容地」归一成 low 去绕过闸。
  for (const bad of ["HIGH", "blocker", ""]) {
    assert(parseLlmFindings(llmRaw(bad), 0).length === 0, "H6 severity=" + JSON.stringify(bad) + " ⇒ 整条丢弃，不归一成 low 绕过闸");
  }

  // H7 反向验证（本格的分辨力自证）：造一份「去掉 high 的闸」，
  // 证明 H2 那条断言对「high 挡不挡」这件事**真的敏感**——判不出红的判据是摆设。
  // 两半都要断： crippled 闸**放行**（说明缺口真实存在），而真闸**不放行**（说明 H2 不是恒真）。
  {
    const crippled = MERGE_BLOCKING_SEVERITIES.filter((s) => s !== "high");
    // 注：`crippled` 的元素类型被 TS 收窄成 `"low"|"medium"|"critical"`（因为 filter 的回调
    // 做了 `s !== "high"` 的字面量收窄），拿它去 `includes(f.severity)` 会报类型不兼容。
    // 这里显式放宽回 SecuritySeverity——反向验证要量的正是「**去掉 high 之后会怎样**」，
    // 收窄掉的恰恰是我们要检验的那一档。
    const crippledSevs: readonly SecuritySeverity[] = crippled;
    const crippledAllows = (fs: readonly SecurityFinding[]): boolean =>
      fs.filter((f) => crippledSevs.includes(f.severity)).length === 0;
    assert(crippledAllows(highParsed), "H7 反向验证：去掉 high 的闸会放行 ⇒ H2 确实在测这一格（缺口真实）");
    // H7b：把上面那句注释里的**另一半**真正断出来——「真闸不放行」。
    // 原写法 `!crippledAllows(highParsed) === false` 只是把 H7 再断言一遍（等价于 assert(true)）⇒
    // **恒真**：注释说它验"真闸不放行"，实际一次都没碰真闸（2026-10-02 审查当场指出）。
    // 恒真式在本仓算红（"让门说的话等于门测的事"）；修法是真调 `mergeGateVerdict`，
    // 并且与 H7 合成**一对**：两边只有同时成立（crippled 放行 ∧ 真闸拒）才说明判据有分辨力。
    assert(crippledAllows(highParsed) && !mergeGateVerdict(highParsed).allow,
      "H7b 真闸不放行、而『去掉 high』会放行 ⇒ 两面互为对照，H2 不是恒真（判据有分辨力）");
  }
}

console.log(
  "[security-check] " + (fail === 0 ? "全部断言通过 ✅" : String(fail) + " 项失败 ❌") + "（" + String(pass) + " ✅ / " + String(fail) + " ❌）",
);
process.exit(fail === 0 ? 0 : 1);
