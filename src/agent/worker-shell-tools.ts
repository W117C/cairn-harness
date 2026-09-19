import type { GlmToolSpec } from "../providers/glm";
import type { Tool, ToolContext, ToolResult } from "../tools/base";
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

/** worker 只读 bash 工具：静态过滤（fail-closed 拒绝）→ 直连 run_shell 原始实现（不过主会话工具门）。 */
export const shell_ro: Tool = {
  name: "shell_ro",
  async run(args, ctx: ToolContext): Promise<ToolResult> {
    const command = typeof args.command === "string" ? args.command : "";
    const gate = isReadOnlyShellCommand(command);
    if (!gate.ok) {
      return { ok: false, output: "[read-only] 只读 bash 静态过滤拒绝：" + (gate.why ?? "未知原因") };
    }
    return await run_shell.run({ command }, ctx);
  },
};

// ---- M3b write mode：shell_rw（git 破坏命令静态拦截层，§4.4.5 / 任务书裁决 3/4）----
// worker 自己不 commit、不 merge（合并唯一出口 = git 面板，§4.3）；shell_rw 内 git 子命令
// 只放行只读集（status/log/diff/show/branch/rev-parse/ls-files/blame/describe/shortlog），
// 其余（worktree/checkout/switch/merge/rebase/push/reset/clean/commit/…）一律拒绝并给出
// reason（命中规则显式落流可审计——安全资产纪律 §16.8）。非 git 命令不受本层限制，
// 仍走 gatedWorkerTool 的 evaluate 管线（critical 静态风险任何档强制审批）。

// H2（审查 B-1）：拦截按「有效二进制」判定，不再只认段首字面 `git`——
// 绝对路径（/usr/bin/git）、exec 包装（command/env/…）、换行分隔、shell -c 内嵌都要拦。
const EXEC_WRAPPERS: ReadonlySet<string> = new Set(["command", "env", "exec", "nice", "nohup", "sudo", "timeout"]);
const SHELL_INVOKERS: ReadonlySet<string> = new Set(["bash", "sh", "zsh", "dash", "ksh"]);

/** 一段命令文本的 git 调用判定：跳过环境赋值与 exec 包装后，有效二进制是否为 git 及其子命令。 */
function gitInvocation(segText: string): { invoked: boolean; sub: string } {
  const words = segText.trim().split(/\s+/).filter((w) => w !== "");
  let i = 0;
  while (i < words.length && (EXEC_WRAPPERS.has(words[i]!) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]!))) i++;
  const bin = words[i] ?? "";
  if (!/(?:^|\/)git$/.test(bin)) return { invoked: false, sub: "" };
  return { invoked: true, sub: words[i + 1] ?? "" };
}

/** git 破坏命令静态拦截（纯函数）：链段全查，任何一段有效二进制为 git 且子命令非只读即拒绝。 */
export function interceptDestructiveGit(command: string): { ok: boolean; why?: string } {
  if (typeof command !== "string" || command.trim() === "") return { ok: false, why: "空命令" };
  // 换行也是命令分隔符（bash 语义）：先归一化为 `;` 再切段，否则 `echo hi\ngit push` 整段首词是 echo 而漏判。
  const segments = command.replace(/\r?\n/g, ";").split(/&&|\|\||;|\|/);
  for (const seg of segments) {
    const g = gitInvocation(seg);
    const words = seg.trim().split(/\s+/).filter((w) => w !== "");
    // shell -c '<payload>'：payload 剥引号后按同一套分隔符切段、同一套有效二进制规则判定——
    // 只拦「payload 里真以 git 为命令」的段；`echo no git here` 这类 git 作参数的合法命令照常放行。
    if (!g.invoked && SHELL_INVOKERS.has(words[0] ?? "") && words.includes("-c")) {
      const cAt = seg.indexOf("-c");
      const payload = cAt >= 0 ? seg.slice(cAt + 2).replace(/^[\s'"]+|[\s'"]+$/g, "") : "";
      for (const sub of payload.split(/&&|\|\||;|\|/)) {
        const pg = gitInvocation(sub);
        if (pg.invoked && !READONLY_GIT_SUBCOMMANDS.includes(pg.sub)) {
          return {
            ok: false,
            why: `shell -c 内嵌 git ${pg.sub} 被拦截（worker 无合并/提交/分支权：合并唯一出口是 git 面板 §4.3）`,
          };
        }
      }
      continue;
    }
    if (!g.invoked) continue;
    const sub = g.sub;
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
export const shell_rw: Tool = {
  name: "shell_rw",
  async run(args, ctx: ToolContext): Promise<ToolResult> {
    const command = typeof args.command === "string" ? args.command : "";
    const gate = interceptDestructiveGit(command);
    if (!gate.ok) {
      return { ok: false, output: "[git-guard] git 破坏命令静态拦截：" + (gate.why ?? "未知原因") };
    }
    return await run_shell.run({ command }, ctx);
  },
};

// ---- worker 工具规格（模型可见面）：从 gateToolSpecs 过滤 + shell_ro 规格 ----

/** worker 模型可见工具规格：白名单过滤（写工具与 spawn_agent 根本不在表内，§4.4.1 深度恒 1）。
 *  P-1 补漏后 gateToolSpecs 已含 lsp（与可执行面同源），此处不再另行补齐重复规格；shell 家族
 *  是 worker 专属面（`shell_ro`/`shell_rw` 不进主会话），仍在此处追加。
 *  M3b：mode=write 时补写面规格（write_file/edit_file/shell_rw/remember）——spawn_agent 与
 *  run_shell/merge/commit 依旧根本不在表内（合并权只在 git 面板）。 */
export function workerToolSpecs(mode: "read" | "write" = "read"): GlmToolSpec[] {
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
  for (const spec of shells) {
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
