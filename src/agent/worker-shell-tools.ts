import type { GlmToolSpec } from "../providers/glm";
import type { Tool, ToolContext, ToolResult } from "../tools/base";
import { invocations, tokenize } from "../permissions/command-shape";
import { impactQuerySpec } from "../tools/impact-query";
import { run_shell } from "../tools/run_shell";
import { gateToolSpecs } from "./glm-session";

// ---- 只读 bash 静态过滤（§4.4.6：显式白名单命令集，其余拒绝） ----
/** 纯读命令集（首词精确匹配）。 */
export const READONLY_SHELL_COMMANDS: readonly string[] = [
  "ls", "cat", "head", "tail", "wc", "pwd", "echo", "grep", "rg", "file", "stat", "which",
];
/** git 只读子命令（第二词精确匹配）。 */
export const READONLY_GIT_SUBCOMMANDS: readonly string[] = [
  "status", "log", "diff", "show", "branch", "rev-parse", "ls-files", "blame", "describe", "shortlog",
];
/** 结构性拒绝：重定向 / 命令替换 / heredoc / 进程替换（写面与逃逸面，一票否决）。 */
const SHELL_WRITE_META = /[<>`]|\$\(|\$\{|\+\+|<<<|\(\(/;

// P0-6（审查根因 9）：只读白名单必须校验参数面——「命令名只读」不等于「命令只读」。
// rg --pre=<脚本> = 任意命令执行；git log --output=<路径> = 任意文件写（含工作区外）；
// --ext-diff = 外部 diff 驱动执行面。一律拒绝长 flag 赋值形式（--xxx=yyy）+ 危险 flag 黑名单。
// 治本方向（原生只读工具 / Seatbelt 只读沙箱）留位：白名单字符串过滤的每次失败都靠本层收口。
const GIT_DANGEROUS_FLAGS: ReadonlySet<string> = new Set(["--output", "--ext-diff", "--exec-path"]);
const RG_DANGEROUS_FLAGS: ReadonlySet<string> = new Set(["--pre", "--pre-glob", "--hostname-bin"]);
const DANGEROUS_FLAGS_BY_HEAD: Readonly<Record<string, ReadonlySet<string>>> = { git: GIT_DANGEROUS_FLAGS, rg: RG_DANGEROUS_FLAGS };

function flagViolation(head: string, words: string[]): string | null {
  const rest = head === "git" ? words.slice(2) : words.slice(1);
  const deny = DANGEROUS_FLAGS_BY_HEAD[head];
  // 审查 S3 / 4.11：git 配置注入面必须显式拒绝，且不能只扫 rest——rest 从 words[2] 起，
  // 把紧跟 git 的第一个 token 当子命令跳过了：`git -ccore.fsmonitor=/tmp/x log`（合并写法、
  // 无空格）整串落在 words[1] 上，正好从缝里漏过去。core.fsmonitor / askPass / pager /
  // sequence.editor 全是「配置指向可执行文件」= 任意执行面，结论钉在代码里，不赌 git 语义。
  // 代价：`git log -c`（combined diff，只读）一并拒绝——只读白名单不需要它。
  const gitCfg = head === "git" ? words.slice(1).find((w) => w === "-c" || w.startsWith("-c") || w.startsWith("--config")) : undefined;
  if (gitCfg !== undefined) {
    return "git 配置面 flag（" + gitCfg + "）一律拒绝（core.fsmonitor/askPass/pager 皆为执行面，P0-6）";
  }
  for (const w of rest) {
    if (w.startsWith("-") && w.includes("=")) {
      return `长 flag 赋值形式（${w}）一律拒绝（只读面不需要，P0-6）`;
    }
    if (deny?.has(w)) {
      return `危险 flag ${w} 被拒绝（只读白名单不允许：执行面/写面参数）`;
    }
  }
  return null;
}

function checkShellSegment(segment: string): string | null {
  const words = segment.trim().split(/\s+/).filter((w) => w !== "");
  if (words.length === 0) return "空命令段";
  const head = words[0]!;
  if (head === "git") {
    const sub = words[1] ?? "";
    if (!READONLY_GIT_SUBCOMMANDS.includes(sub)) {
      return `git ${sub} 不在只读白名单（允许：${READONLY_GIT_SUBCOMMANDS.join(" ")}）`;
    }
    return flagViolation(head, words);
  }
  if (!READONLY_SHELL_COMMANDS.includes(head)) {
    return `${head} 不在只读白名单（允许：${READONLY_SHELL_COMMANDS.join(" ")} 与 git 只读子命令）`;
  }
  return flagViolation(head, words);
}

/** 只读 bash 静态过滤（纯函数）：白名单命令集 + 链段全查 + 写面元字符一票否决；其余拒绝。
 *  P0-1（审查根因 1）：换行与单与号也是 bash 命令分隔符——先归一化再切段，
 *  否则 `cat x\ngit push` / `cat x & git push` 整段首词是 cat 而放行第二条命令。 */
export function isReadOnlyShellCommand(command: string): { ok: boolean; why?: string } {
  if (typeof command !== "string" || command.trim() === "") return { ok: false, why: "空命令" };
  if (SHELL_WRITE_META.test(command)) {
    return { ok: false, why: "含重定向/命令替换/heredoc 等写面元字符（只读 bash 一票否决）" };
  }
  // 链段切分：; && || | & 换行 —— 每段都必须落在白名单内（cat x | wc -l 允许；cat x | tee out 拒绝）
  const segments = command.replace(/\r\n?|\n/g, ";").split(/&&|\|\||;|\||&/);
  for (const seg of segments) {
    const why = checkShellSegment(seg);
    if (why) return { ok: false, why };
  }
  return { ok: true };
}

/** worker shell 的执行出口。缺省 = 裸 `run_shell`（不进沙箱）。
 *
 *  为什么是注入而不是 `src/agent` 直接 import `src/main/sandbox`：`src/agent` 不许反向依赖
 *  `src/main`（AGENTS.md 的核心层禁令），而沙箱实现在 main 侧。注入还顺带让接线可测——
 *  结构测试能钉住「worker shell 走注入的出口」这件事本身，摘掉即红。
 *  宿主（agent-runner）有沙箱时注入沙箱版，判据与主会话 run_shell 那道门同一口径。 */
export type WorkerShellRunner = (command: string, ctx: ToolContext) => Promise<ToolResult>;

/** 缺省出口：裸 run_shell（不过沙箱）。宿主没注入时用它，与本模块迁移前的行为逐字一致。 */
const bareShell: WorkerShellRunner = async (command, ctx) => await run_shell.run({ command }, ctx);

/** worker 只读 bash 工具：静态过滤（fail-closed 拒绝）→ 执行出口。 */
export function makeShellRo(run: WorkerShellRunner = bareShell): Tool {
  return {
    name: "shell_ro",
    async run(args, ctx: ToolContext): Promise<ToolResult> {
      const command = typeof args.command === "string" ? args.command : "";
      const gate = isReadOnlyShellCommand(command);
      if (!gate.ok) {
        return { ok: false, output: "[read-only] 只读 bash 静态过滤拒绝：" + (gate.why ?? "未知原因") };
      }
      return await run(command, ctx);
    },
  };
}
export const shell_ro: Tool = makeShellRo();

// ---- M3b write mode：shell_rw（git 破坏命令静态拦截层，§4.4.5 / 任务书裁决 3/4）----
// worker 自己不 commit、不 merge（合并唯一出口 = git 面板，§4.3）；shell_rw 内 git 子命令
// 只放行只读集（status/log/diff/show/branch/rev-parse/ls-files/blame/describe/shortlog），
// 其余（worktree/checkout/switch/merge/rebase/push/reset/clean/commit/…）一律拒绝并给出
// reason（命中规则显式落流可审计——安全资产纪律 §16.8）。非 git 命令不受本层限制，
// 仍走 gatedWorkerTool 的 evaluate 管线（critical 静态风险任何档强制审批）。

// H2（审查 B-1）：拦截按「有效二进制」判定，不再只认段首字面 `git`——
// 绝对路径（/usr/bin/git）、exec 包装（command/env/…）、换行分隔、shell -c 内嵌都要拦。
// 09-22 收口（探针 ③ 段六支红）：这一支**不再自带一份解析**，改吃全仓唯一一份
// `src/permissions/command-shape.ts`（权限规则层 `matchSegment` 也是它的消费者）。
// 旧的本地副本只 `has(word)`、不吞**带值选项的值**，于是 `sudo -u root git push --force`、
// `timeout 30 git worktree add x`、`nice -n 5 git reset --hard`、`env -i git push --force`、
// `command -p git push --force`、嵌套 `bash -c '…'` 六种全放行（裸 sudo/nohup 反而拦得住）——
// 「同一条解析只硬化一支」的教科书形状。载荷那支也并进来了：不再另发一条「内嵌」文案，
// 一种判定一份实现一条 reason。

/** **藏在未知首词后面的** git 调用，只按破坏动词表拦（09-22 ⑩ 的第二版）。
 *  为什么不能沿用「非只读即拦」：那一刀的取料是「整段里出现独立的 `git` 词」，
 *  于是 `grep -rn git src`、`echo no git here` 这类「git 只是个搜索词/文本」的惯用写法会被一起打死
 *  ——那是我第一次报代价时报小了的一条（我自己量 ⑦ 候选时还拿 `grep -e git -e push` 当假阳例子）。
 *  失败方向要说清：表**之外**的动词（`git bundle` 一类）在 worker 侧维持与修前相同的放行，
 *  不是新增的漏；表**之内**的是修前静默放行、现在拦得住。只读面另有一条独立通道（下面的白名单）。 */
export const DESTRUCTIVE_GIT_SUBCOMMANDS: readonly string[] = [
  "push", "commit", "merge", "rebase", "reset", "clean", "checkout", "switch", "restore",
  "worktree", "cherry-pick", "am", "apply", "rm", "mv", "tag", "stash", "gc",
  "filter-branch", "update-ref", "symbolic-ref", "remote",
];

/** 一段命令文本里所有 git 调用的子命令：包装器与环境赋值已跳过，`shell -c` 载荷已展开。
 *
 *  ⑩（09-22）补掉的那一半：`git` 出现在**不认识的首词之后**（`setsid git push --force`、
 *  `flock /tmp/l git push --force`）也算一次 git 调用。旧实现只认 `inv.bin === "git"`，
 *  于是 worker 这一支对整族未知前缀词**静默放行**——它并不是 fail-closed，只是恰好
 *  `args[0]` 落在只读白名单外时才拦（`git -C /tmp push` 那一族就是这么侥幸拦住的）。
 *  代价按方向说清：`echo no git here` 这类「git 只是文本」现在也会被认成 git 调用，
 *  子命令取 "here" ⇒ 非只读 ⇒ 拦。worker 没有出卡这条通道（拦截就是给模型一句 reason，
 *  它可以换写法重试），所以这里取「宁可多拦一句」而不是「静默放过强推」。 */
function gitSubcommands(command: string): string[] {
  const subs: string[] = [];
  // 换行也是命令分隔符（bash 语义）：先归一化为 `;` 再切段，否则 `echo hi\ngit push` 整段首词是 echo 而漏判。
  for (const seg of command.replace(/\r?\n/g, ";").split(/&&|\|\||;|\|/)) {
    for (const inv of invocations(seg)) if (inv.bin === "git") subs.push(inv.args[0] ?? "");
    // ⑩ 补的另一半：`invocations` 只把「有效二进制是 git」的那些交出来，未知首词
    // （setsid / ionice -c3 / flock /tmp/l …）会把 git 藏在参数里，整段就不算 git 调用了。
    // 所以再扫一遍**本段自己的 token**：出现独立的 `git` 词且**其后跟着表内的破坏动词**才记一次账。
    // 为什么不记「所有非只读动词」：`grep -rn git src` 会跟着 "src"、`echo no git here` 跟着 "here"，
    // 那都是文本不是调用（09-22 第一版就把它按"非只读即拦"报过代价，实测太贵）。
    // 引号在这里也救场：`bash -c 'echo git push --force'` 的载荷是一个 token，切不出独立的 git。
    const tokens = tokenize(seg);
    for (let i = tokens.indexOf("git"); i >= 0; i = tokens.indexOf("git", i + 1)) {
      const sub = tokens[i + 1];
      if (sub !== undefined && DESTRUCTIVE_GIT_SUBCOMMANDS.includes(sub)) subs.push(sub);
    }
  }
  return subs;
}

/** git 破坏命令静态拦截（纯函数）：链段全查，两条面——
 *  ⑴ 有效二进制是 git（含绝对路径、包装器、`shell -c` 载荷）：子命令不在只读白名单即拒；
 *  ⑵ 09-22 ⑩ 补的那一半：git 藏在**不认识的首词**后面（`setsid git push --force`、
 *     `flock /tmp/l git reset …`）。旧口径整段不算 git 调用 ⇒ 静默放行，那不是 fail-closed；
 *     现在按破坏动词表拦——表外的动词维持与修前同样的放行（不是新增的漏），
 *     这么窄是为了留住 `grep -rn git src` 这类「git 只是个搜索词」的惯用写法。
 *  带引号的文本（`echo 'git push --force'`、`bash -c 'echo git …'`）切不出独立的 `git`，一律不受牵连。 */
export function interceptDestructiveGit(command: string): { ok: boolean; why?: string } {
  if (typeof command !== "string" || command.trim() === "") return { ok: false, why: "空命令" };
  for (const sub of gitSubcommands(command)) {
    if (!READONLY_GIT_SUBCOMMANDS.includes(sub)) {
      return {
        ok: false,
        why: `git ${sub} 被拦截（worker 无合并/提交/分支权：合并唯一出口是 git 面板 §4.3；放行：${READONLY_GIT_SUBCOMMANDS.join(" ")}）`,
      };
    }
  }
  return { ok: true };
}

/** write worker shell 工具：git 破坏命令静态拦截（fail-closed + reason 落流）→ run_shell（cwd 由 loop 锁定 worktree）。 */
export function makeShellRw(run: WorkerShellRunner = bareShell): Tool {
  return {
    name: "shell_rw",
    async run(args, ctx: ToolContext): Promise<ToolResult> {
      const command = typeof args.command === "string" ? args.command : "";
      const gate = interceptDestructiveGit(command);
      if (!gate.ok) {
        return { ok: false, output: "[git-guard] git 破坏命令静态拦截：" + (gate.why ?? "未知原因") };
      }
      return await run(command, ctx);
    },
  };
}
export const shell_rw: Tool = makeShellRw();

// ---- worker 工具规格（模型可见面）：从 gateToolSpecs 过滤 + shell_ro 规格 ----

/** worker 模型可见工具规格：白名单过滤（写工具与 spawn_agent 根本不在表内，§4.4.1 深度恒 1）。
 *  P-1 补漏后 gateToolSpecs 已含 lsp（与可执行面同源），此处不再另行补齐重复规格；shell 家族
 *  是 worker 专属面（`shell_ro`/`shell_rw` 不进主会话），仍在此处追加。
 *  M3b：mode=write 时补写面规格（write_file/edit_file/shell_rw/remember）——spawn_agent 与
 *  run_shell/merge/commit 依旧根本不在表内（合并权只在 git 面板）。 */
export function workerToolSpecs(mode: "read" | "write" = "read", opts: { impactAnalysis?: boolean } = {}): GlmToolSpec[] {
  const allow = mode === "write"
    ? new Set<string>(["read_file", "grep", "glob", "lsp", "write_file", "edit_file", "remember"])
    : new Set<string>(["read_file", "grep", "glob", "lsp"]);
  const specs = gateToolSpecs().filter((s) => allow.has(s.function.name)).map((spec) =>
    spec.function.name === "remember"
      ? { ...spec, function: { ...spec.function, description: REMEMBER_SPEC_DESCRIPTION } }
      : spec,
  );
  // 防御：追加前按名字去重（同名规格出现两次会让「每个可执行工具恰好一次」的验收假红/假绿都不可信）
  const seen = new Set(specs.map((s) => s.function.name));
  const shells: GlmToolSpec[] = [
    {
      type: "function",
      function: {
        name: mode === "write" ? "shell_rw" : "shell_ro",
        description:
          mode === "write"
            ? "worktree 内 shell：git 子命令仅放行只读集（status/log/diff/show/branch/rev-parse/ls-files/blame/describe/shortlog）；git commit/merge/push/checkout/reset 等一律静态拦截（合并唯一出口是 git 面板）；非 git 命令照常执行"
            : "只读 shell（静态白名单硬闸）：允许 ls/cat/head/tail/wc/pwd/echo/grep/rg/file/stat/which 与 " +
              "git status|log|diff|show|branch|rev-parse|ls-files|blame|describe|shortlog；" +
              "重定向、命令替换、非白名单命令一律拒绝",
        parameters: { type: "object", properties: { command: { type: "string", description: mode === "write" ? "worktree 内 shell 命令" : "只读 shell 命令" } }, required: ["command"] },
      },
    },
  ];
  // 影响面读端（与主会话同一个规格与同一份实现，开关同源 impactAnalysis）：worker 在 worktree
  // 里改代码时同样需要「改前先问谁在调用」—— ctx.workspace 在运行时才取，所以实例天然指向 worktree。
  const extras: GlmToolSpec[] = opts.impactAnalysis === true
    ? [{
        type: "function",
        function: {
          name: impactQuerySpec.name,
          description: impactQuerySpec.description,
          parameters: impactQuerySpec.parameters,
        },
      }]
    : [];
  for (const spec of [...shells, ...extras]) {
    if (seen.has(spec.function.name)) continue;
    seen.add(spec.function.name);
    specs.push(spec);
  }
  return specs;
}

const REMEMBER_SPEC_DESCRIPTION =
  "写入跨会话记忆（唯一写入口；项目层恒指主 checkout .agent/，不属于 worktree）。" +
  "scope: project|global；kind: architecture|decision|preference|memory；操作 append/replace（replace 必带 old_content 精确命中）。" +
  "纪律：能从代码推导的不写入；禁止把密钥写入记忆。";
