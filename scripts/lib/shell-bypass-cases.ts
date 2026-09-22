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

/** ⑤ 全局选项插在「二进制与子命令之间」：09-22 量出五支全漏（`judgeChain` = miss ⇒ 自主档 approve）。
 *  根因与 ① 不同：① 是二进制**上游**的包装器，`commandForms` 会剥；这一族的选项在二进制**下游**，
 *  前缀匹配看不见子命令。worker 静态闸因「args[0] 不在只读白名单」fail-closed 而侥幸拦得住，
 *  主会话这条路径没有任何一道兜它。 */
export const GLOBAL_OPT_VARIANTS: string[] = [
  "git -C /tmp push --force",
  "git --no-pager push --force",
  "git -c advice.pushUpdateRejected=false push --force",
  "git --git-dir=/x push --force",
  "git -C/x push --force",
];

/** ⑤″ **未裁的两侧**（只记录、不计红绿，见 outputs/deny-downstream-option-bypass-2026-09-22.md）：
 *  规则匹配是「整串前缀」，于是一件事同时产生两个方向相反的错——
 *  漏判：`-f` 是 `--force` 的短标志（同一个破坏性操作）；
 *  过覆盖：`--force-with-lease` 是**更安全**的操作，却被「deny git push --force」顺带禁掉。
 *  收紧一头必放宽另一头 ⇒ 需要先定语义（这条 deny 到底禁的是"某个标志"还是"强推这一族"），
 *  不该由实现单方面改。两侧读数以 `tests/shell-bypass-composition.test.ts` 的「已知边界」钉住。 */
export const FLAG_UNDERHIT: string[] = ["git push -f", "git push --f"];
export const FLAG_BOUNDARY_OVERHIT: string[] = [
  "git push --force-with-lease",
  "git push --force-with-lease origin main",
];

/** ⑥ 前缀词族（09-22 按位置扫写法扫出来的）：这些词自己不动执行，但**余下的 token 才是真命令**。
 *  修前实测 `eval …` / `xargs …` / `time …`（连 `time -p`）三支全漏，且 worker 闸与规则层一起漏
 *  （同一份解析的两个消费者 ⇒ 一处误登记两处放行）。 */
export const PREFIX_WORD_VARIANTS: string[] = [
  "eval git push --force",
  "eval \"git push --force\"",
  "eval \"git push --force; echo done\"",
  "xargs git push --force",
  "xargs -n1 git push --force",
  "time git push --force",
  "time -p git push --force",
  "sudo time xargs git push --force",
  "nohup time git push --force",
];

/** ⑥′ 负控：这些**不该**被 deny 牵连。
 *  `cat time xargs` / `echo xargs …` 里那几个词是**参数**不是前缀词；
 *  `--fo=rcx` 看着像缩写漏判，但 git 自己会报「选项不认/歧义」，命令根本执行不了强推。 */
export const PREFIX_WORD_MUST_STAY_CLEAN: string[] = [
  "git status",
  "cat time xargs",
  "echo xargs git push --force",
  "git push --fo=rcx",
];
/** ⑤ 的负控：剥下游选项**不得**把只读命令也变成命中 deny 的样子。 */
export const GLOBAL_OPT_MUST_STAY_CLEAN: string[] = [
  "git status",
  "git -C /tmp status",
  "git log --oneline -20",
  "git -c core.pager=cat diff",
];
