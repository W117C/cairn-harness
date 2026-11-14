// shell 写/毁原语 → 目标路径的**唯一一份**取料（判卷面冻结闸与 run_shell 执行层闸共用）。
//
// 为什么单独成模块（2026-11-15）：这张取料面原先只住在权限层的 `evaluate()` 里，而
// `run_shell` 本体不调它——于是同一张冻结表下，权限层判 deny 的形状与工具层实际能写的形状
// 是两份真相（F1 普查：12 条写命令 2 deny / 9 approve）。搬出来一处实现，两层同吃。
//
// **这不是完整解析器，也不假装是**：shell 里能写文件的原语是开放的（`python3 -c`、`node -e`、
// 变量间接、base64 解码后再落盘……）。本模块只覆盖「命令文本里认得出的写/毁形状」，用于①权限层
// 提前给出可读的拒绝理由；②工具层在 spawn 前复查软链落点。**真正的强制在 OS 层**：
// `buildSandboxProfile` 为每个冻结文件写 `(deny file-write* (literal …))`，Seatbelt 按 vnode
// 判定（软链、硬链、rename 覆盖一并挡住）；无沙箱宿主的兜底是 run_shell 的跑后字节校验（见
// `tools/frozen-guard.ts`）——那条对任何形状都生效，但只能「跑完复原」，挡不住同一条命令内的读取。
import { invocations } from "./command-shape";
import { splitCommandChain } from "./rules";

/** `>` / `>>` / `>|` / `&>` / `&>>`，可带 fd 前缀（`2>`）；捕获组是同一 token 里紧跟的操作数
 *  （`>out` 这种合并写法）。操作数在下一个 token 时捕获组为空串。`2>&1` 的捕获组是 `&1`——
 *  它不是文件名，由 `push` 的 `&` 前缀过滤掉（与 snapshot.ts 的 NOT_A_FILE_TARGET 同向）。 */
const REDIRECT_OP = /^(?:[0-9*&]?)(?:&>>|&>|>>|>\||>)(.*)$/;

/** 一条命令里所有「被写到/被删掉」的操作数（按出现顺序、去重）。
 *  取料走 `splitCommandChain` 切段 + `invocations`：后者跳过 exec 包装器与环境赋值，并把
 *  `bash -c '…'` 与 `$(…)` 载荷递归展开——`bash -c 'echo x > judge'` 里的 `>` 与 `judge`
 *  因此在**内层**那次调用上被看见，而不是当成外层 bash 的普通参数。 */
export function shellWriteTargetsOf(command: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (t: string | null | undefined): void => {
    if (t === null || t === undefined) return;
    if (t === "" || t.startsWith("-") || t.startsWith("&")) return;
    if (seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };
  const scanRedirects = (args: readonly string[]): void => {
    for (let i = 0; i < args.length; i++) {
      const m = args[i]!.match(REDIRECT_OP);
      if (m === null) continue;
      push(m[1] !== "" ? m[1] : args[i + 1]);
    }
  };
  const scan = (bin: string, args: readonly string[]): void => {
    scanRedirects(args);
    switch (bin) {
      // 写/删原语：全部非选项实参（rm/mv 的源同样是被写面——删源也是改盘）。
      case "tee":
      case "rm":
      case "mv":
      case "unlink":
      case "shred":
      case "rmdir":
      case "touch":
      case "truncate":
        for (const a of args) push(a);
        break;
      // 单目标写：末位实参是落点（源只是被读）。
      case "cp":
      case "install":
      case "ln": {
        const rest = args.filter((a) => !a.startsWith("-"));
        push(rest.at(-1));
        break;
      }
      // 原地编辑器：-i 在时才动盘；第一个位置实参是脚本/表达式，其后才是文件。
      case "sed":
      case "perl": {
        const inPlace = args.some((a) => a === "-i" || /^-[A-Za-z]*i[A-Za-z]*$/.test(a));
        if (!inPlace) break;
        const positional = args.filter((a) => !a.startsWith("-"));
        for (const f of positional.slice(1)) push(f);
        break;
      }
      case "dd":
        for (const a of args) if (a.startsWith("of=")) push(a.slice(3));
        break;
      // git 的写子命令：checkout/restore 只看 `--` 之后（`checkout main` 的 main 是分支名，
      // 不是文件）；rm/mv 的路径实参全算。`git apply` 的目标在补丁正文里，这层认不出——
      // 交给 OS 层与跑后校验，不在这里编一个假的完整覆盖。
      case "git": {
        const sub = args.find((a) => ["checkout", "restore", "rm", "mv"].includes(a)) ?? "";
        if (sub === "") break;
        const at = args.indexOf("--");
        if (sub === "checkout" || sub === "restore") {
          const from = at >= 0 ? at + 1 : args.indexOf(sub) + 1;
          for (const a of args.slice(from)) push(a);
        } else {
          for (const a of args.slice(args.indexOf(sub) + 1)) push(a);
        }
        break;
      }
    }
  };
  for (const segment of splitCommandChain(command)) {
    for (const inv of invocations(segment)) scan(inv.bin, inv.args);
  }
  // 第二遍只扫重定向、且不切段：引号里带 `;`/`|` 的目标（`> "a;b.txt"`）会被上面那把
  // 字符级切刀劈开而整个丢掉；整串 tokenize 能把操作数原样交回来。与 `snapshot.ts` 的
  // 两遍取料同因，只是这里只取「写目标」这一面，不把非重定向原语在整串上重扫一遍
  //（整串没有真实分段信息，重扫会把 `rm a && cat judge` 的 judge 误记成 rm 的目标）。
  for (const inv of invocations(command)) scanRedirects(inv.args);
  return out;
}
