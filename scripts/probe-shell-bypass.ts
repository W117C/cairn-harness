// 复现探针（非门禁，不进 gate-manifest）：权限规则层与 worker git 闸的「包装器/载荷」绕过。
// 结论与逐条读数见 outputs/shell-permission-bypass-2026-09-21.md。
// 用法：pnpm exec tsx scripts/probe-shell-bypass.ts    # 缺陷未修期间**必红**（退出码 1）
// 四段直调真实判据函数，不复制实现：judgeChain / evaluate / interceptDestructiveGit。
import { judgeChain, parsePermissionsFile } from "../src/permissions/rules";
import { evaluate, newAutonomySession } from "../src/permissions/autonomy";
import { interceptDestructiveGit } from "../src/agent/worker-shell-tools";
import type { PermissionMode } from "../src/permissions";
import {
  ALLOW_CASES,
  BOUNDARY_MUST_STAY_DENY,
  DENY_VARIANTS,
  FLAG_BOUNDARY_OVERHIT,
  FLAG_UNDERHIT,
  GLOBAL_OPT_MUST_STAY_CLEAN,
  GLOBAL_OPT_VARIANTS,
  INSERTED_ARG_UNDERHIT,
  PIPE_INTO_SHELL,
  PREFIX_WORD_MUST_STAY_CLEAN,
  PREFIX_WORD_VARIANTS,
  PROBE_RULES_JSON,
  REDIRECT_CASES,
  STRUCTURE_ALREADY_COVERS,
  UNBOUNDED_PREFIX_WORDS,
  WORKER_CASES,
} from "./lib/shell-bypass-cases";

/** 固定规则库（定义在 `scripts/lib/shell-bypass-cases.ts`，与 vitest 侧共用一份清单）。 */
const RULES = parsePermissionsFile(PROBE_RULES_JSON, "probe");

function session(mode: PermissionMode, rules = RULES) {
  return newAutonomySession(mode, { rules, sandboxAvailable: true, planBlocked: () => false });
}

let red = 0;
let green = 0;

/** 期望与实测并列打印；任一不合期望即计入 red，并决定退出码——退出码恒 0 的探针不是绿。 */
function check(title: string, cmd: string, want: string, got: string): void {
  const ok = want === got;
  if (ok) green += 1;
  else red += 1;
  console.log(
    (ok ? "  绿 " : "  红 ") +
      title.padEnd(28) +
      JSON.stringify(cmd).padEnd(44) +
      "期望 " + want.padEnd(22) +
      "实测 " + got,
  );
}

/** 「不得是 X」必须由代码表达"非"。09-21 版把 `非 approve` 当期望字面量交给 `check` 比字符串
 *  ⇒ 该断言**恒不成立**：产品修好了它也永远红，红到没人再分辨它红的是缺陷还是判据自己写坏。
 *  门禁体检查恒真式与析取式，查不出这种恒假式——只有"修好后必须能绿"这条能试出来。 */
function checkNot(title: string, cmd: string, forbid: string, got: string): void {
  const ok = !got.startsWith(forbid);
  if (ok) green += 1;
  else red += 1;
  console.log(
    (ok ? "  绿 " : "  红 ") +
      title.padEnd(28) +
      JSON.stringify(cmd).padEnd(44) +
      "期望 非 " + forbid.padEnd(20) +
      "实测 " + got,
  );
}

/* ---------------- ① 用户手写的 deny 规则能否被绕过 ---------------- */

console.log("\n【①】deny 规则「git push --force」——自主档完整 evaluate，看由哪层决定");
for (const cmd of DENY_VARIANTS) {
  const d = evaluate("run_shell", { command: cmd }, session("auto"));
  // 期望 = 用户的 deny 意图被执行（L1-deny 拦截）；别的层「顺便问一句」不算命中
  check("deny 意图生效", cmd, "deny@L1-deny", `${d.verdict}@${d.layer}`);
}

console.log("\n【①′】纯规则层（judgeChain，剔除档位与风险层噪声）");
for (const cmd of ["git push --force", "sudo git push --force", "/usr/bin/git push --force"]) {
  console.log("     " + JSON.stringify(cmd).padEnd(44) + judgeChain(RULES, "run_shell", cmd).verdict);
}

/* ---------------- ② 「总是允许」携带载荷 ---------------- */

console.log("\n【②】点过「总是允许 echo hi」之后——自主档");
for (const [cmd, bare] of ALLOW_CASES) {
  const d = evaluate("run_shell", { command: cmd }, session("auto"));
  const got = d.verdict === "approve" ? `approve@${d.layer}` : `${d.verdict}@${d.layer}`;
  if (bare) check("裸命令应放行", cmd, "approve@L3-rule", got);
  else checkNot("带载荷不得放行", cmd, "approve", got);
}

/* ---------------- ③ worker 的 git 破坏命令静态闸 ---------------- */

console.log("\n【③】worker shell_rw 的 git 静态拦截（纯函数直调；ok:true = 放行）");
for (const [cmd, readOnly] of WORKER_CASES) {
  const r = interceptDestructiveGit(cmd);
  check("非只读 git 必拦", cmd, readOnly ? "ok:true" : "ok:false", `ok:${String(r.ok)}`);
}

/* ---------------- ④ 重定向写面的分类归属 ---------------- */

console.log("\n【④】空规则库、自主档：重定向写向是否被静态威胁表归类");
for (const cmd of REDIRECT_CASES) {
  const d = evaluate("run_shell", { command: cmd }, session("auto", []));
  check("写向须出卡", cmd, "ask", d.verdict);
}
const PIPE = evaluate("run_shell", { command: PIPE_INTO_SHELL }, session("auto", []));
check("管道内嵌删除（对照）", PIPE_INTO_SHELL, "ask", PIPE.verdict);

/* ---------------- ⑤ 全局选项插在二进制与子命令之间 ---------------- */

console.log("\n【⑤】deny「git push --force」——选项插在二进制与子命令之间（`git -C /tmp push --force` 一类）");
for (const cmd of GLOBAL_OPT_VARIANTS) {
  const d = evaluate("run_shell", { command: cmd }, session("auto"));
  check("deny 意图生效", cmd, "deny@L1-deny", `${d.verdict}@${d.layer}`);
}
console.log("\n【⑤′】负控：只读命令不得因为剥下游选项而被 deny 命中");
for (const cmd of GLOBAL_OPT_MUST_STAY_CLEAN) {
  const d = evaluate("run_shell", { command: cmd }, session("auto"));
  check("只读不受牵连", cmd, "非 deny", d.verdict === "deny" ? "deny" : "非 deny");
}
console.log("\n【⑨】选项的 token 边界（09-22 已裁：过覆盖那一侧修掉，漏判那一侧仍记着）");
for (const cmd of FLAG_BOUNDARY_OVERHIT) {
  const d = evaluate("run_shell", { command: cmd }, session("auto"));
  check("更安全的那个不被牵连", cmd, "非 deny", d.verdict === "deny" ? "deny" : "非 deny");
}
for (const cmd of BOUNDARY_MUST_STAY_DENY) {
  const d = evaluate("run_shell", { command: cmd }, session("auto"));
  check("边界收紧不许顺手放宽", cmd, "deny@L1-deny", `${d.verdict}@${d.layer}`);
}
const card = evaluate("run_shell", { command: "sudo git push --force" }, session("auto"));
const cardReason = card.verdict === "deny" ? card.reason : "verdict:" + card.verdict;
check("卡面说得出禁的是哪一段、按什么匹配", "reason", "含 ruleId + 边界说明",
  cardReason.includes("deny:run_shell:git push --force") && cardReason.includes("匹配按完整 token 为界")
    ? "含 ruleId + 边界说明" : JSON.stringify(cardReason));
console.log("     仍漏判的那一侧（要收它得建按二进制的标志别名表，另账）：");
for (const c of FLAG_UNDERHIT) {
  const v = evaluate("run_shell", { command: c }, session("auto"));
  console.log("     " + JSON.stringify(c).padEnd(44) + v.verdict + "@" + v.layer);
}

/* ---------------- ⑥ 前缀词族（eval / xargs / time） ---------------- */

console.log("\n【⑥】前缀词后面才是真命令——规则层与 worker 闸两支都要拦");
for (const cmd of PREFIX_WORD_VARIANTS) {
  const d = evaluate("run_shell", { command: cmd }, session("auto"));
  check("规则层拦", cmd, "deny@L1-deny", `${d.verdict}@${d.layer}`);
  check("worker 闸同判", cmd, "ok:false", `ok:${String(interceptDestructiveGit(cmd).ok)}`);
}
console.log("\n【⑥′】负控：这些词当参数、或命令本身跑不成时不许被牵连");
for (const cmd of PREFIX_WORD_MUST_STAY_CLEAN) {
  const d = evaluate("run_shell", { command: cmd }, session("auto"));
  check("不牵连", cmd, "非 deny", d.verdict === "deny" ? "deny" : "非 deny");
}

/* ---------------- ⑦ 未知前缀词（09-22 已裁 ⇒ 从"只印"升为真断言） ---------------- */

console.log("\n【⑦】未知前缀词——按序命中，但首词不认识 ⇒ 出卡，不再静默放行（见 dated 文档 ⑩ 段）");
for (const cmd of UNBOUNDED_PREFIX_WORDS) {
  const v = evaluate("run_shell", { command: cmd }, session("auto"));
  check("降为必问", cmd, "ask@L2-ask-rule", `${v.verdict}@${v.layer}`);
}
console.log("     对照：结构性面（载荷递归 / 链式段）本来就按 deny 生效，本裁不动它——");
for (const cmd of STRUCTURE_ALREADY_COVERS) {
  const v = evaluate("run_shell", { command: cmd }, session("auto"));
  check("仍绝对 deny", cmd, "deny@L1-deny", `${v.verdict}@${v.layer}`);
}

/* ---------------- ⑧ 中间插参数（首词就是 git ⇒ 按序命中也不降级） ---------------- */
console.log("\n【⑧】子命令与危险选项**中间**插了参数——首词是 git 自己 ⇒ 照原样 deny");
for (const cmd of INSERTED_ARG_UNDERHIT) {
  const v = evaluate("run_shell", { command: cmd }, session("auto"));
  check("规则层 deny", cmd, "deny@L1-deny", `${v.verdict}@${v.layer}`);
  check("worker 闸同判", cmd, "ok:false", `ok:${String(interceptDestructiveGit(cmd).ok)}`);
}

console.log(`\n合计：红 ${String(red)} / 绿 ${String(green)}`);
if (red > 0) {
  console.log("→ 本文不是门禁：红 = 缺陷仍在（详见 outputs/shell-permission-bypass-2026-09-21.md）。");
  process.exitCode = 1;
}
