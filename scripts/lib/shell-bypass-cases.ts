/** shell/权限绕过用例表：**一份清单、两个观测者**。
 *
 *  09-21 的复现报告（`outputs/shell-permission-bypass-2026-09-21.md`）留下四段红，09-22 全部收口。
 *  当时唯一判这四段的是 `scripts/probe-shell-bypass.ts`——它是给人读的复现器，不是门禁、
 *  也不是变异锚点的消费者（`mutate-verify` 只吃 vitest 文件）。清单因此只有"一个观测者 + 一种读法"，
 *  而四段里最裸的一支（worker 的 git 静态闸 `interceptDestructiveGit`）在全表 26 条权限锚点里**零覆盖**。
 *
 *  所以清单搬到这里，由两边共同 import：
 *  ⑴ 探针 `scripts/probe-shell-bypass.ts` —— 打印「期望 vs 实测」并给非零退出码；
 *  ⑵ 测 `tests/shell-bypass-composition.test.ts` —— 进 `pnpm test` 与变异锚点，钉住四道面**合起来**的落点。
 *  两边各自直调真实判据函数（`judgeChain` / `evaluate` / `interceptDestructiveGit`），不复制实现。
 *
 *  ⚠️ 加用例往这里加，别在任一观测者里另起一份——两份清单一旦分叉，绿的那份会替红的那份背书。 */

/** 固定规则库：一条用户手写的 deny，加一条「用户点过一次总是允许 echo hi」。 */
export const PROBE_RULES_JSON = JSON.stringify({
  rules: [
    { behavior: "deny", tool: "run_shell", pattern: "git push --force", scope: "always" },
    { behavior: "allow", tool: "run_shell", pattern: "echo hi", scope: "always" },
  ],
});

/** ① 用户的 deny 意图：11 种包装写法，全部必须由 `L1-deny` 拦下（别的层「顺便问一句」不算命中）。 */
export const DENY_VARIANTS: string[] = [
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

/** ② 「总是允许」的同意范围：`[命令, 是否裸命令]`。裸的才该 approve；带载荷的一律不得 approve。 */
export const ALLOW_CASES: Array<[string, boolean]> = [
  ["echo hi", true],
  ["echo hi > /tmp/pwned", false],
  ["echo hi >> ~/.zshrc", false],
  ["echo hi $(rm -rf /tmp/x)", false],
  ["echo hi `rm -rf /tmp/y`", false],
  ["echo hi | sh", false],
];

/** ③ worker 的 git 静态闸：`[命令, 是否只读]`。非只读一律拦（含包装与链段）。 */
export const WORKER_CASES: Array<[string, boolean]> = [
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

/** ④ 重定向写向：空规则库下也必须由静态威胁表出卡（ask），不能靠用户手写规则。 */
export const REDIRECT_CASES: string[] = [
  "echo hi >> ~/.zshrc",
  "echo alias\\ ll=rm > ~/.bashrc",
  "cat > .git/hooks/pre-commit",
  "echo x > /etc/hosts",
];

/** ④ 的对照组：管道进 shell（把上游当脚本执行）。 */
export const PIPE_INTO_SHELL = "echo 'rm -rf /tmp/z' | sh";
