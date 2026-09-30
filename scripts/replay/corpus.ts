// 复跑面的取料层（`scripts/replay/*` 共用）——把"从哪里读、读什么算受管、读不到怎么办"收成一份。
//
// 立这只模块的理由有两条，都是本仓点过名的缺陷族：
// ⑴ **同族出口副本**：`ask-density` 与 `corpus-inventory` 原先各抄一份 roots / walk / 受管集，
//    任何一处改动（比如加一个会话目录）只会让一支的读数悄悄换口径，而两支都还自称"同一把尺"。
// ⑵ **"读到 0 即绿"**：语料（历史会话 `.jsonl`）**不在 git 里**（实测 `git ls-files outputs | grep jsonl`
//    = 0），所以干净 checkout 上两条复跑命令都能跑出 `受管=0 ask=0`——那不是"ask 密度是 0%"，
//    那是**没有尺**。原先脚本对此一声不吭，读数与真读数长得一模一样（2026-09-23 在 worktree 实踩）。
//    ⇒ `corpusProblem` 把"零语料"从一条可读的读数变成一个必须红着退出的状态。
import fs from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { SHELL_FAMILY } from "../../src/permissions/risk";

/** 扫描根：仓库 `outputs/` + 本 app 的会话目录。**相对路径按当前工作目录解析**（复跑命令在仓库根执行）。 */
export function corpusRoots(): string[] {
  // `Application Support` 是**一个**目录名：写成两个段会拼出 `Application/Support`，
  // 那个目录永不存在 ⇒ 真会话那支静默恒为 missingRoots，所有 replay 读数只剩合成语料。
  return ["outputs", join(homedir(), "Library", "Application Support", "m0-agent-loop", "sessions")];
}

/**
 * 受管面 = 产品的 shell 能力域 ∪ 两个写盘工具 ∪ `mcp__*`。
 * 派生自 `SHELL_FAMILY` 而不是另抄一份字面名：**挂现状不挂手抄表**——产品给 shell 族加一个成员时，
 * 复跑面自动跟上，不需要有人记得来这里补第 6 个名字。
 */
export const GATED_TOOLS: ReadonlySet<string> = new Set([...SHELL_FAMILY, "write_file", "edit_file"]);

export function isGatedTool(name: string): boolean {
  return GATED_TOOLS.has(name) || name.startsWith("mcp__");
}

export interface CorpusScan {
  files: string[];
  /** 扫了但不存在的根（换机器 / 从没跑过 app ⇒ 该支零语料，不是错误，但必须能被说出来）。 */
  missingRoots: string[];
}

/** 递归找 `.jsonl`（深度上限 4，与原 heredoc 同口径）。目录不存在 ⇒ 记进 `missingRoots`，不静默。 */
export function scanCorpus(roots: readonly string[] = corpusRoots(), maxDepth = 4): CorpusScan {
  const files: string[] = [];
  const missingRoots: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.isFile() && e.name.endsWith(".jsonl")) files.push(p);
    }
  };
  for (const r of roots) {
    const before = files.length;
    walk(r, 0);
    if (files.length === before && !existsDir(r)) missingRoots.push(r);
  }
  return { files, missingRoots };
}

const existsDir = (p: string): boolean => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** 逐行 JSON，脏行跳过（两个复跑脚本同一条口径，收成一份）。 */
export function readJsonl(file: string): unknown[] {
  const out: unknown[] = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      /* 脏行跳过 */
    }
  }
  return out;
}

/**
 * `callId → tool_call.name` 的 join 索引：`tool_result` 上**没有工具名**，凡按工具划面的读数都得先 join。
 * 收进取料层的理由与 roots 那一条相同——各处自写一遍 join，就会各自漂出「join 不上算什么」的口径
 * （2026-09-21 那片零假读数正是这里丢的）。**join 不上必须由调用方自己计数并印出来**，不许当没有。
 */
export function callNameIndex(raws: readonly unknown[]): Map<string, string> {
  const byCall = new Map<string, string>();
  for (const raw of raws) {
    const e = raw as { type?: string; id?: string; name?: string };
    if (e.type === "tool_call" && typeof e.id === "string") byCall.set(e.id, String(e.name ?? ""));
  }
  return byCall;
}

/**
 * 环境红的**人眼线索**只有这一处定义，且**全部行首锚定**：这几句都由 harness 自己拼在换行之后，
 * 被跑的那条命令再怎么说同样的话（它的正文里出现「[exit code: 127]」）也不算它发生过
 * ——规则 264：被度量者自己的正文是第二个注入面。
 *
 * 折进取料层的理由与 `callNameIndex` 一条：同一判据从前在两个读数脚本里各抄一份、**宽度还不同**
 * （`verify-cause-mix` 的 `textualKind` 与 `cascade-traffic` 的 `ENV_TEXTUAL` 都用无锚 `includes`，
 * 而同一尺的 exec 面 09-29 起已改行首锚定）＝本仓点过名的第十三族。
 * `(none)` 不在这里：那是 `runVerifyOutcome` 的**哨兵命令名**，按 `command` 字段判（见 `NO_SURFACE_COMMAND`），
 * 拿它去 `includes(output)` 会把任何打印过 `(none)` 的正常输出读成「没有可验面」。
 * **一条要说明的缺席**：`hook-error` 那一格今天两个消费者都走不到——钩子抛错那拍 `results` 是空的，
 * 而那句话（`[verify] 钩子异常…`）由 `loop.ts` 拼进**给模型的 digest**，不在 `results[].output` 里。
 * 留着它是因为这栏的口径本来就是"人眼在正文里能看到什么"，digest 也是正文的一种；
 * 但它**不是被证过的判据**（`钩子异常拍` 那一格由 beat 级计数说话），别把"表里有这一类"读成"有人在按它归类"。
 */
export const ENV_TEXT_CUES: readonly { kind: string; re: RegExp }[] = [
  // 一支通吃三个出口：`[error: verify 命令超时（Ns）…`、`[error: run_shell 超时（Ns）…`、`[error: glob: rg 超时…`
  // ——中间那段是工具名＋各自的说法，所以只锚「行首 + `[error: ` 起头 + 同一行里出现"超时"」。
  // 写成 `^\[error: \S+ 超时` 会当场漏掉 verify 那一支（它的 `\S+` 后面还有一个词），这条就是被下面那组用例钉住的教训。
  { kind: "timeout", re: /^\[error: [^\n]*超时/mu },
  { kind: "toolchain-missing", re: /^\[exit code: 127\]/mu },
  { kind: "hook-error", re: /^\[verify\] 钩子异常/mu },
];

/** 同一行首线索在**别的栏**里也要用（exec 面的文案栏就是它的超集），所以取这一份而不是再写一遍正则。
 *  认不出那个 kind 就抛——静默给一条新写的正则，正是本函数要消灭的东西。 */
export function envTextRe(kind: string): RegExp {
  const cue = ENV_TEXT_CUES.find((c) => c.kind === kind);
  if (cue === undefined) throw new Error("ENV_TEXT_CUES 里没有这一类：" + kind);
  return cue.re;
}

/** 「根本没有可验面」那一格的落盘形状：命令名是哨兵串，不是正文里的一个字。 */
export const NO_SURFACE_COMMAND = "(none)";

/** 命中的第一个线索类别（顺序即表序：超时最具体先认）；都不在 ⇒ `null`，调用方自己决定叫什么。 */
export function firstEnvTextCue(output: string): string | null {
  for (const cue of ENV_TEXT_CUES) if (cue.re.test(output)) return cue.kind;
  return null;
}

/** 第一格：一个 `.jsonl` 也没扫到。单独可调用——有的读数只关心"有没有料"，不关心料里认不认得事件。 */
export function zeroCorpusProblem(scan: CorpusScan): string | null {
  if (scan.files.length === 0) {
    const miss = scan.missingRoots.length > 0 ? `（其中不存在：${scan.missingRoots.join(", ")}）` : "";
    return `零语料：扫了 ${corpusRoots().join(", ")}${miss}，一个 .jsonl 也没有。`
      + " 会话流不在 git 里 ⇒ 这是「没有尺」，不是「读数为 0」——换到有历史会话的树上再跑。";
  }
  return null;
}

/**
 * 零语料体检：返回 null = 这次读数有料；返回一句话 = 这次读数**没有意义**，调用方必须红着退出。
 * 两格分开判，因为它们的成因不同：① 一个文件都没扫到 = 取料面空（换机器/干净 checkout）；
 * ② 有文件却一条 `tool_call` 都没有 = 读得到、认不出（字段名/形状漂移，正是 09-21 那片零假读数的形状）。
 */
export function corpusProblem(scan: CorpusScan, toolCalls: number): string | null {
  const empty = zeroCorpusProblem(scan);
  if (empty !== null) return empty;
  if (toolCalls === 0) {
    return `扫到 ${String(scan.files.length)} 个 .jsonl 却一条 tool_call 也没有：`
      + "事件名或形状漂了（认不出不等于没有），先核对取料面再读任何数。";
  }
  return null;
}
