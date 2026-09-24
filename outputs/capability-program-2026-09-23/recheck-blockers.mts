/** 能力研究合册 · 撞面/现态断言复跑器
 *  用途：把七页文档里所有「绑在仓库现态上的断言」（某文件在飞 / 某符号存在 / 某 BLOCKED 条未裁）
 *  写成**可复跑的谓词**，一次打印每条断言的**当前真值**，并在"文档说的 ≠ 现在的"时 exit 1。
 *  立这条的直接动因：本页集初稿写着「snapshot.ts 在飞、未提交」「base.ts 带未提交 diff」，
 *  当天晚些时候 D7 落库（3391a65），那句话自己变成了假话——而这正是本仓最忌的"读起来像现态的错字"。
 *  跑法：TERM=dumb node --import tsx outputs/capability-program-2026-09-23/recheck-blockers.mts
 *  只读（git + 文件系统），不写任何东西。 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sh = (cmd: string): string => {
  try { return execSync(cmd, { cwd: ROOT, encoding: "utf8" }); } catch { return ""; }
};
const read = (rel: string): string => {
  const p = join(ROOT, rel);
  return existsSync(p) ? readFileSync(p, "utf8") : "";
};

/** 谓词族：每条都返回一个"当前真值"，不返回意见。 */
const isClean = (rel: string): boolean => sh(`git status --short --untracked-files=no -- ${rel}`).trim() === "";
const isTracked = (rel: string): boolean => sh(`git ls-files --error-unmatch ${rel}`).trim() !== "";
const hasSymbol = (rel: string, re: RegExp): boolean => {
  const p = join(ROOT, rel);
  return existsSync(p) && re.test(readFileSync(p, "utf8"));
};
const blockedOpen = (needle: string): boolean => {
  const p = join(ROOT, "BLOCKED.md");
  return existsSync(p) && readFileSync(p, "utf8").includes(needle);
};
const commitExists = (sha: string): boolean => sh(`git cat-file -e ${sha}^{commit} 2>/dev/null && echo ok`).trim() === "ok";

interface Claim { page: string; claim: string; said: "阻塞中" | "已具备" | "已落库" | "未裁"; now: boolean; why: string }

const CLAIMS: Claim[] = [
  // —— 能力 16 读过的账
  { page: "16 stale-view", claim: "snapshot.ts 当时未提交（在飞）", said: "阻塞中", now: !isTracked("src/tools/snapshot.ts"), why: "git ls-files" },
  { page: "16 stale-view", claim: "base.ts 带未提交 diff ⇒ 开 ToolContext.seen 必撞", said: "阻塞中", now: !isClean("src/tools/base.ts"), why: "git status" },
  { page: "16 stale-view", claim: "edit_file.ts 带未提交 diff", said: "阻塞中", now: !isClean("src/tools/edit_file.ts"), why: "git status" },
  { page: "16 stale-view", claim: "write_file.ts 带未提交 diff", said: "阻塞中", now: !isClean("src/tools/write_file.ts"), why: "git status" },
  { page: "16 stale-view", claim: "D7 快照已落库（恢复面发货）", said: "已落库", now: isTracked("src/tools/snapshot.ts") && commitExists("3391a65"), why: "ls-files + cat-file" },
  { page: "16 stale-view", claim: "写工具能读 snapshotId 当已发生凭据（17 页借用于此）", said: "已具备", now: hasSymbol("src/tools/base.ts", /snapshotId\?:\s*string/), why: "base.ts 里 ToolResult.snapshotId" },
  { page: "16 stale-view", claim: "BLOCKED #56 未裁（快照路径污染 changedFiles + id 带毫秒）", said: "未裁", now: blockedOpen("待办 #56"), why: "BLOCKED.md 扫" },
  // —— 能力 17 结果未知三态
  { page: "17 side-effect", claim: "ToolContext 里已有一条「runner 构造→loop 透传」先例", said: "已具备", now: hasSymbol("src/agent/loop.ts", /opts\.impact\s*\?\s*\{\s*impact/), why: "loop.ts 的 ctx 构造" },
  { page: "17 side-effect", claim: "副作用名单仍是多份（L0 归一的前提）", said: "已具备", now: ["src/permissions/autonomy.ts", "src/agent/worker-report.ts", "src/agent/tool-surface.ts"].filter((f) => hasSymbol(f, /isSideEffectTool|WRITE_TOOLS|mainSessionSideEffect/)).length >= 3, why: "三文件各自持名" },
  // —— 能力 18 判卷面变薄
  { page: "18 grading-surface", claim: "frozenJudgePathSet 存在（表的判定优先这条的前提）", said: "已具备", now: hasSymbol("src/frozen.ts", /export function frozenJudgePathSet/), why: "frozen.ts 导出" },
  { page: "18 grading-surface", claim: "judge-frozen-gate 测试存在（C3 回归面）", said: "已具备", now: existsSync(join(ROOT, "tests/judge-frozen-gate.test.ts")), why: "文件存在" },
  { page: "18 grading-surface", claim: "GATE_LAYERS 穷尽断言存在（行为不变的看守）", said: "已具备", now: hasSymbol("tests/gate-audit.test.ts", /GATE_LAYERS/), why: "gate-audit.test.ts" },
  // —— 能力 19 指令来源账
  { page: "19 provenance", claim: "escapeControlTags 存在且被 ≥2 条通道用（免费车前提）", said: "已具备", now: hasSymbol("src/agent/control-tags.ts", /export function escapeControlTags/) && hasSymbol("src/agent/worker-report.ts", /escapeControlTags\(/), why: "定义 09-24 搬到 control-tags.ts（投影层不该依赖记忆子系统）" },
  { page: "19 provenance", claim: "施工后转正：context.ts 的 role:tool 正文带着中和调用", said: "已具备", now: hasSymbol("src/agent/context.ts", /role:\s*"tool"[^\n]*escapeControlTags\(/), why: "原判据「缺陷面在」已随 L0 落地转正；完备性看 tests/instruction-provenance.test.ts" },
  // —— 能力 20 投影出口闸
  { page: "20 projection-invariant", claim: "orchestrator.ts 干净（本页可先行）", said: "已具备", now: isClean("src/agent/orchestrator.ts"), why: "git status" },
  { page: "20 projection-invariant", claim: "两处派生 callId 仍在（-sup / -s）", said: "已具备", now: hasSymbol("src/agent/orchestrator.ts", /callId \+ "-sup"/) && hasSymbol("src/agent/orchestrator.ts", /chain\.callId \+ "-s"/), why: "orchestrator.ts" },
  { page: "20 projection-invariant", claim: "atomicUnits 仍只在 compaction 内被调用", said: "已具备", now: !hasSymbol("src/agent/context.ts", /\batomicUnits\s*\(/), why: "context.ts 不调它" },
  // —— 能力 21 F2P
  { page: "21 F2P", claim: "FAIL_RE 仍会把 `# fail 0` 判成失败（D1 未修）", said: "已具备", now: hasSymbol("src/agent/evidence.ts", /\\bfail\\b/), why: "evidence.ts 的 FAIL_RE" },
  { page: "21 F2P", claim: "uncertain 仍无生产者（D2 未裁）", said: "未裁", now: hasSymbol("src/agent/evidence.ts", /uncertain:\s*false/), why: "恒 false 的赋值仍在" },
  // 结构性取法（第一版用字面量正则，漏了 `interface` 关键字 → 误报漂移；判据要按形状取，不按抄来的字符串取）
  { page: "21 F2P", claim: "VerifyCommandResult 仍是 command/ok/output 三字段（G1 未修）", said: "已具备",
    now: (() => {
      const m = /interface VerifyCommandResult \{([^}]*)\}/.exec(readFileSync(join(ROOT, "src/events/index.ts"), "utf8"));
      if (m === null) return false;
      const fields = (m[1].match(/(\w+)\s*:/g) ?? []).map((s) => s.replace(/\s*:$/, "")).sort().join(",");
      return fields === "command,ok,output";
    })(), why: "解析 interface 成员集，非字面量匹配" },
  // —— 能力 22 运行中转向
  { page: "22 steering", claim: "发送处仍是 running 直接 return（G1 未修）", said: "已具备", now: hasSymbol("src/renderer/app.js", /正在运行，请先等待完成/), why: "app.js 守卫" },
  { page: "22 steering", claim: "R1 的抑制信号仍只有 wroteSinceLast（C1 前置未做）", said: "已具备", now: hasSymbol("src/agent/no-progress.ts", /wroteSinceLast/) && !hasSymbol("src/agent/no-progress.ts", /userSpoke/), why: "no-progress.ts" },
  { page: "22 steering", claim: "轮界检查已存在（转向可挂现成界）", said: "已具备", now: hasSymbol("src/agent/loop.ts", /于轮界收束/), why: "loop.ts 取消信号" },
  // —— 能力 23 观测者覆盖棘轮
  { page: "23 observers", claim: "IPC 轴已有门（本页只补另两轴的前提）", said: "已具备",
    now: hasSymbol("scripts/gate-manifest.ts", /ipc-reachability-check/), why: "gate-manifest 里那条门名" },
  { page: "23 observers", claim: "telemetry「V1 无上报 = 零数据出门」是已裁留位（G5 的引文）", said: "已具备",
    now: /遥测开关/.test(read("docs/m4-acceptance.md")), why: "m4-acceptance 那行仍在" },
  { page: "23 observers", claim: "事件轴枚举不全（窄取法 < 宽取法）⇒ C1 是本页第一条判据", said: "已具备",
    now: (() => {
      const body = read("src/events/index.ts");
      const narrow = new Set([...body.matchAll(/^\s{2}type:\s*"([a-z0-9_]+)"/gm)].map((m) => m[1])).size;
      const wide = new Set([...body.matchAll(/\btype:\s*"([a-z0-9_]+)"/g)].map((m) => m[1])).size;
      return narrow < wide;
    })(), why: "两种取法成员数比较，不写死 21/30" },
  // —— 能力 24 改动集原子性
  { page: "24 change-set", claim: "collectChangeSet 仍按 op+path 分组（G2/C3 未做）", said: "已具备",
    now: hasSymbol("src/agent/security/scan.ts", /"(write|edit)::"/), why: "scan.ts 里那两个分组键前缀" },
  { page: "24 change-set", claim: "快照键仍是 <毫秒>--<callId>（无组键，且毫秒仍在＝#56 未裁）", said: "已具备",
    now: hasSymbol("src/tools/snapshot.ts", /String\(at\) \+ "--"/), why: "snapshotIdOf 的拼接形状" },
  // —— 能力 25 验面绿不绿
  { page: "25 verify-align", claim: "全仓仍未设 pipefail（G1/头条缺陷未修）", said: "已具备",
    now: !["src/tools/run_shell.ts", "src/agent/verify.ts", "src/tools/process.ts"].some((f) => /pipefail/.test(read(f))),
    why: "三文件扫 pipefail" },
  { page: "25 verify-align", claim: "run_shell 的 ok 仍只取末段退出码（code === 0）", said: "已具备",
    now: hasSymbol("src/tools/run_shell.ts", /code === 0/) && !hasSymbol("src/tools/run_shell.ts", /pipeMasked/),
    why: "run_shell 的收束式" },
  { page: "25 verify-align", claim: "globIntersects 只被 forbidden 一侧用（对齐配对待建）", said: "已具备",
    now: !hasSymbol("src/agent/verify.ts", /globIntersects/), why: "verify.ts 不引它" },
  // —— 能力 26 声明面对齐
  { page: "26 surface", claim: "loop.ts / base.ts 正带未提交改动 ⇒ L1 须等在飞簇落地", said: "阻塞中",
    now: !isClean("src/agent/loop.ts") || !isClean("src/tools/base.ts"), why: "两文件 git status 取或" },
  { page: "26 surface", claim: "PROVIDER_IDS 仍是两份不同值（G1 未收）", said: "已具备",
    now: (() => {
      const a = /PROVIDER_IDS\s*=\s*\[([^\]]*)\]/.exec(read("src/providers/registry.ts"))?.[1] ?? "";
      const b = /PROVIDER_IDS\s*=\s*\[([^\]]*)\]/.exec(read("src/main/provider-keys.ts"))?.[1] ?? "";
      return a !== b && a !== "" && b !== "";
    })(), why: "两处成员串比较" },
  { page: "26 surface", claim: "注册表检查仍在权限判定之后（G3 次序未修）", said: "已具备",
    now: (() => {
      const b = read("src/agent/loop.ts");
      const gate = b.indexOf('decision === "deny"');
      const reg = b.indexOf("unknown tool");
      return gate !== -1 && reg !== -1 && gate < reg;
    })(), why: "两处出现的先后次序" },
  // —— 能力 27 批准后越界
  { page: "27 scope-drift", claim: "planCovered 仍是单向 every（越界侧无人算，G1 未修）", said: "已具备",
    now: hasSymbol("src/agent/economics.ts", /const planCovered = \(\) =>[\s\S]{0,120}\.every\(/)
      && !hasSymbol("src/agent/economics.ts", /unsanctioned/), why: "economics.ts 判据形状" },
  { page: "27 scope-drift", claim: "covered.add(path) 仍不问批没批准（G4 未修）", said: "已具备",
    now: hasSymbol("src/agent/economics.ts", /covered\.add\(path\)/), why: "add 那一句" },
  // —— 跨页公共前提
  { page: "全部", claim: "docs/DOCS-MAP.md 在飞 ⇒ 登记推迟这条仍成立", said: "阻塞中", now: !isClean("docs/DOCS-MAP.md"), why: "git status" },
  // 19/20/31 三页的锚点（共 14 条）**已在独立脚本里逐条验过能杀**，但登记进 mutate-verify 整表被这张表自己
  // 那条「拒变在飞文件」的规矩挡住。挂在这个文件是否干净上，别挂 SHA、也别挂"某个会话会来登记"。
  { page: "全部", claim: "mutate-verify.mjs 在飞 ⇒ 三页已验锚点未登记进整表", said: "阻塞中", now: !isClean("scripts/mutate-verify.mjs"), why: "git status 该文件（干净了就该去登记：19 六针 / 20 四针 / 31 四针）" },
  // 第一版写成 `!body.includes("outputs/")`，结果被一句**提示文案**（"证据图落 outputs/"）判成"在扫"——
  // 假漂移。取法改成只认「fs 调用里把 outputs 当目录参数」，且这条本身有边界（见下 why）。
  { page: "全部", claim: "docs-check 不枚举 outputs/ ⇒ 推迟登记不把门跑红", said: "已具备",
    now: (() => {
      const body = readFileSync(join(ROOT, "scripts/docs-check.ts"), "utf8");
      return !/(readdirSync|existsSync|readFileSync|statSync|isDirectory)\s*\((?:[^()]|\([^()]*\))*["']outputs["']/.test(body);
    })(), why: "认 fs 调用的目录参数，不认文案字符串" },
];

const PAGE_FILE: Record<string, string> = {
  "16 stale-view": "outputs/stale-view-guard-2026-09-23/00-主张与判据.md",
  "17 side-effect": "outputs/side-effect-outcome-2026-09-23/00-主张与判据.md",
  "18 grading-surface": "outputs/grading-surface-guard-2026-09-23/00-主张与判据.md",
  "19 provenance": "outputs/instruction-provenance-2026-09-23/00-主张与判据.md",
  "20 projection-invariant": "outputs/projection-invariant-2026-09-23/00-主张与判据.md",
  "21 F2P": "outputs/hollow-implementation-2026-09-23/00-主张与判据.md",
  "22 steering": "outputs/midrun-steering-2026-09-23/00-主张与判据.md",
  "23 observers": "outputs/observer-coverage-2026-09-23/00-主张与判据.md",
  "24 change-set": "outputs/change-set-atomicity-2026-09-23/00-主张与判据.md",
  "25 verify-align": "outputs/verify-alignment-2026-09-23/00-主张与判据.md",
  "26 surface": "outputs/declared-surface-alignment-2026-09-23/00-主张与判据.md",
  "27 scope-drift": "outputs/approved-scope-drift-2026-09-23/00-主张与判据.md",
  "全部": "outputs/capability-program-2026-09-23/00-合册与落地顺序.md",
};
/** 一条断言「与现态不符」只有在**该页没留订正块**时才算漂移：
 *  本仓规矩是「不回改历史原句，追加一条二次复核」，所以判据 = 原句过期 ∧ 页内无订正 → 红。 */
const corrected = (page: string): boolean => {
  const rel = PAGE_FILE[page];
  if (rel === undefined) return false;
  const p = join(ROOT, rel);
  return existsSync(p) && /二次复核/.test(readFileSync(p, "utf8"));
};

/** 「在飞 / 已干净」这类断言是**会翻的**：别的会话一次提交就把"阻塞中"变成"不成立"
 *  （2026-09-23 实踩：`base.ts` 在同一分钟内先脏后净，导致本页退出码跟着抖）。
 *  ⇒ 它们照打读数、照标"已订正/未订正"，但**不参与退出码判定**；
 *  能管退出码的只有稳定断言（符号是否存在、成员是否同值、次序、已落库的 SHA）。 */
const flakyClaim = (c: Claim): boolean =>
  c.said === "阻塞中" || /在飞|未提交|干净/.test(c.claim);

let drift = 0, stale = 0, flakyDrift = 0;
console.log("页 / 断言 / 页面当初说 / 现在真值 / 取法");
for (const c of CLAIMS) {
  const holds = c.now;
  const staleNow = (c.said === "阻塞中" && !holds) || (c.said !== "阻塞中" && !holds);
  if (staleNow) stale++;
  const isFlaky = flakyClaim(c);
  const drifted = staleNow && !corrected(c.page);
  if (drifted && !isFlaky) drift++;
  if (drifted && isFlaky) flakyDrift++;
  const tail = staleNow ? (corrected(c.page) ? "已订正" : isFlaky ? "**未订正(易翻,不管退出码)**" : "**未订正**") : "";
  console.log(
    `${drifted ? (isFlaky ? "△ 现态 " : "⚠️ 漂移") : "  ok  "}  ${c.page.padEnd(22)} ${c.claim.padEnd(52)} 当初=${c.said}  现在=${holds ? "成立" : "不成立"}${tail ? "  " + tail : ""}  (${c.why})`
  );
}
console.log(`\n合计 ${CLAIMS.length} 条现态断言：与仓库现态不符 ${stale} 条；` +
  `其中**稳定断言**未订正 ${drift} 条（管退出码）、**易翻断言**未订正 ${flakyDrift} 条（只报不拦）。`);
console.log(drift === 0
  ? "⇒ 稳定断言都与仓库现态一致（或已留二次复核块）；易翻项以 `git status` 当下读数为准。"
  : "⇒ 有稳定句已变成假话且没人标注：请在该页 §六 追加「同日二次复核」块（不回改原文），别直接涂改。");
process.exit(drift === 0 ? 0 : 1);
