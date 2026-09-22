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
  DENY_VARIANTS,
  FLAG_BOUNDARY_OVERHIT,
  FLAG_UNDERHIT,
  GLOBAL_OPT_MUST_STAY_CLEAN,
  GLOBAL_OPT_VARIANTS,
  PIPE_INTO_SHELL,
  PREFIX_WORD_MUST_STAY_CLEAN,
  PREFIX_WORD_VARIANTS,
  PROBE_RULES_JSON,
  REDIRECT_CASES,
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
console.log("\n【⑤″】本轮不修的账（只记录，不计入红绿）：选项边界的两面");
for (const c of [...FLAG_UNDERHIT, ...FLAG_BOUNDARY_OVERHIT]) {
  const v = evaluate("run_shell", { command: c }, session("auto"));
  console.log("     " + JSON.stringify(c).padEnd(44) + v.verdict + "@" + v.layer);
}
console.log("     ↑ 漏判（`-f` 与 `--f` 是同一个破坏性操作）与过覆盖（`--force-with-lease` 是**更安全**的那个）同根：");
console.log("       规则匹配是整串前缀。收紧一头必然放宽另一头 ⇒ 需要一次语义裁决，不单向改。");

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

console.log(`\n合计：红 ${String(red)} / 绿 ${String(green)}`);
if (red > 0) {
  console.log("→ 本文不是门禁：红 = 缺陷仍在（详见 outputs/shell-permission-bypass-2026-09-21.md）。");
  process.exitCode = 1;
}
