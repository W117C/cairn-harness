// 复现探针（非门禁，不进 gate-manifest）：权限规则层与 worker git 闸的「包装器/载荷」绕过。
// 结论与逐条读数见 outputs/shell-permission-bypass-2026-09-21.md。
// 用法：pnpm exec tsx scripts/probe-shell-bypass.ts    # 缺陷未修期间**必红**（退出码 1）
// 四段直调真实判据函数，不复制实现：judgeChain / evaluate / interceptDestructiveGit。
import { judgeChain, parsePermissionsFile } from "../src/permissions/rules";
import { evaluate, newAutonomySession } from "../src/permissions/autonomy";
import { interceptDestructiveGit } from "../src/agent/worker-shell-tools";
import type { PermissionMode } from "../src/permissions";

/** 固定规则库：一条用户手写的 deny，加一条「用户点过一次总是允许 echo hi」。 */
const RULES = parsePermissionsFile(
  JSON.stringify({
    rules: [
      { behavior: "deny", tool: "run_shell", pattern: "git push --force", scope: "always" },
      { behavior: "allow", tool: "run_shell", pattern: "echo hi", scope: "always" },
    ],
  }),
  "probe",
);

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

/* ---------------- ① 用户手写的 deny 规则能否被绕过 ---------------- */

console.log("\n【①】deny 规则「git push --force」——自主档完整 evaluate，看由哪层决定");
const DENY_VARIANTS = [
  "git push --force",
  "git  push  --force",
  "sudo git push --force",
  "sudo -u root git push --force",
  "env FOO=1 git push --force",
  "nohup git push --force",
  "timeout 30 git push --force",
  "command git push --force",
  "/usr/bin/git push --force",
  "bash -c 'git push --force'",
  "GIT_PAGER=cat git push --force",
];
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
const ALLOW_CASES: Array<[string, boolean]> = [
  ["echo hi", true],
  ["echo hi > /tmp/pwned", false],
  ["echo hi >> ~/.zshrc", false],
  ["echo hi $(rm -rf /tmp/x)", false],
  ["echo hi `rm -rf /tmp/y`", false],
  ["echo hi | sh", false],
];
for (const [cmd, bare] of ALLOW_CASES) {
  const d = evaluate("run_shell", { command: cmd }, session("auto"));
  const got = d.verdict === "approve" ? `approve@${d.layer}` : `${d.verdict}@${d.layer}`;
  check(bare ? "裸命令应放行" : "带载荷不得放行", cmd, bare ? "approve@L3-rule" : "非 approve", got);
}

/* ---------------- ③ worker 的 git 破坏命令静态闸 ---------------- */

console.log("\n【③】worker shell_rw 的 git 静态拦截（纯函数直调；ok:true = 放行）");
const WORKER_CASES: Array<[string, boolean]> = [
  ["git push --force", false],
  ["git worktree add x", false],
  ["git reset --hard", false],
  ["nohup git commit -m x", false],
  ["git status", true],
  ["sudo -u root git push --force", false],
  ["timeout 30 git worktree add x", false],
  ["nice -n 5 git reset --hard", false],
  ["env -i git push --force", false],
  ["command -p git push --force", false],
  ["bash -c 'sudo -u root git push --force'", false],
];
for (const [cmd, readOnly] of WORKER_CASES) {
  const r = interceptDestructiveGit(cmd);
  check("非只读 git 必拦", cmd, readOnly ? "ok:true" : "ok:false", `ok:${String(r.ok)}`);
}

/* ---------------- ④ 重定向写面的分类归属 ---------------- */

console.log("\n【④】空规则库、自主档：重定向写向是否被静态威胁表归类");
const REDIRECT_CASES = [
  "echo hi >> ~/.zshrc",
  "echo alias\\ ll=rm > ~/.bashrc",
  "cat > .git/hooks/pre-commit",
  "echo x > /etc/hosts",
];
for (const cmd of REDIRECT_CASES) {
  const d = evaluate("run_shell", { command: cmd }, session("auto", []));
  check("写向须出卡", cmd, "ask", d.verdict);
}
const PIPE = evaluate("run_shell", { command: "echo 'rm -rf /tmp/z' | sh" }, session("auto", []));
check("管道内嵌删除（对照）", "echo 'rm -rf /tmp/z' | sh", "ask", PIPE.verdict);

console.log(`\n合计：红 ${String(red)} / 绿 ${String(green)}`);
if (red > 0) {
  console.log("→ 本文不是门禁：红 = 缺陷仍在（详见 outputs/shell-permission-bypass-2026-09-21.md）。");
  process.exitCode = 1;
}
