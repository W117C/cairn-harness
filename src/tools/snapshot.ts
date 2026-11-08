// 覆盖前快照（agent-plan §10.4 评审拍板 D7）：主会话覆盖一个**已存在**的文件之前，把原件按字节
// 抄进 `.agent/snapshots/`，并把快照路径随 tool_result 落进事件流（snapshot_id）。
//
// 只堵一条路径：「agent 把用户未提交的工作覆盖掉了」。不做全量影子 git（§10.10 定稿），
// write worker 另有 worktree 天然可回滚；本模块服务的是**直写用户真实工作区**的主会话。
// 位置是方案书定稿的 `.agent/snapshots/`。原先记档的代价是「它会出现在用户仓库的 git status 里」——
// #100（2026-10-05 业主拍板 C2）把它加进了 .gitignore：按字节抄的原件可能带着被覆盖文件里的凭据，
// 而外泄通道是 commit 不是 copy。**仍在的代价**说清楚：明文第二副本留在本地盘上，没有帽也没有 TTL
// （那一半留给 #56 与帽/TTL，别把「已忽略」读成「已管住」）。判卷 tests/snapshot-dir-not-distributed.test.ts。
import { constants } from "node:fs";
import { mkdir, open, rename, unlink, type FileHandle } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { tmpPathFor } from "../atomic-write";
import { invocations } from "../permissions/command-shape";
import { splitCommandChain } from "../permissions/rules";
import {
  assertNotAgentArea,
  assertNotAgentAreaReal,
  assertRealContainment,
  assertContainedPathIdentity,
  captureContainedPath,
  openContainedFile,
  resolveInWorkspace,
} from "./base.js";

/** 快照根目录（workspace 相对）。 */
export const SNAPSHOT_ROOT = ".agent/snapshots";

/** callId 进路径段前先做文件名安全化（它来自 provider，字符集不受我们控制）。 */
function safeCallPart(callId: string | undefined): string {
  const s = (callId ?? "run").replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 48);
  return s === "" ? "run" : s;
}

/** 快照 id：`.agent/snapshots/<毫秒>--<callId>/<原相对路径>`——保留原相对路径，
 *  一次覆盖一个目录，事后「这一轮把哪些文件覆盖成了什么」是列目录就能读出来的事实。 */
export function snapshotIdOf(rel: string, callId: string | undefined, at = Date.now()): string {
  return join(SNAPSHOT_ROOT, String(at) + "--" + safeCallPart(callId), rel);
}

/** 覆盖前抄一份原件。**best-effort**：任何失败都不得改写盘结果——写入是用户要的动作，
 *  护栏缺位不能把已成功变成失败（与 `appendImpact` 同一条纪律）。
 *  返回 null = 没落快照（文件不存在=新建、空文件不值得占、或快照自身失败）。 */
export async function snapshotBeforeOverwrite(
  workspace: string,
  abs: string,
  rel: string,
  callId?: string,
): Promise<string | null> {
  let source: FileHandle | null = null;
  let dest: FileHandle | null = null;
  let tmp: string | null = null;
  try {
    const opened = await openContainedFile(workspace, abs, "snapshot-before-overwrite");
    source = opened.fh;
    if (!opened.stat.isFile() || opened.stat.size === 0) return null;
    const size = opened.stat.size;
    const id = snapshotIdOf(rel, callId);
    const target = join(workspace, id);
    await mkdir(dirname(target), { recursive: true });
    const parentAbs = dirname(target);
    const parentIdentity = await captureContainedPath(workspace, parentAbs, "snapshot-before-overwrite");
    const guard = (): Promise<void> => assertContainedPathIdentity(
      workspace,
      parentAbs,
      "snapshot-before-overwrite",
      parentIdentity,
    );
    await guard();

    tmp = tmpPathFor(target);
    dest = await open(
      tmp,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o666,
    );
    const chunk = Buffer.allocUnsafe(Math.min(1024 * 1024, size));
    let copied = 0;
    while (copied < size) {
      const want = Math.min(chunk.length, size - copied);
      const read = await opened.fh.read(chunk, 0, want, copied);
      if (read.bytesRead === 0) {
        throw new Error(`source ended after ${String(copied)} of ${String(size)} bytes`);
      }
      let written = 0;
      while (written < read.bytesRead) {
        const write = await dest.write(chunk, written, read.bytesRead - written, copied + written);
        if (write.bytesWritten === 0) throw new Error("snapshot destination accepted zero bytes");
        written += write.bytesWritten;
      }
      copied += read.bytesRead;
    }

    const after = await opened.fh.stat();
    if (
      after.dev !== opened.stat.dev ||
      after.ino !== opened.stat.ino ||
      after.size !== opened.stat.size ||
      after.mtimeMs !== opened.stat.mtimeMs ||
      after.ctimeMs !== opened.stat.ctimeMs
    ) {
      throw new Error("source changed while the snapshot was being copied");
    }
    await dest.close();
    dest = null;
    await guard();
    await rename(tmp, target);
    tmp = null;
    return id;
  } catch (err) {
    console.warn("[snapshot] 覆盖前快照失败（写入照常进行）:", err instanceof Error ? err.message : String(err));
    return null;
  } finally {
    await dest?.close().catch(() => undefined);
    await source?.close().catch(() => undefined);
    if (tmp !== null) await unlink(tmp).catch(() => undefined);
  }
}

/** 写给模型看的那一句：路径要出现在 tool_result 正文里，模型才知道自己有这份原件可取。
 *  2026-10-04 实测补上"怎么取才不丢"：`read_file` 的交付是**按行**拼的，末行换行不保留、
 *  单行超 2000 字符会被切、超 50 KiB 会被切、二进制直接拒读——拿它读完再 `write_file` 写回，
 *  在最简单的文本文件上都会差一个字节（而 git diff 会显示整行变了）。所以这里说的是"复制"，
 *  不是"读出来再写回去"；快照本身是按字节抄的（`copyFile`），丢只丢在读回来这一刀。 */
export function snapshotNote(snapshotId: string): string {
  return "｜覆盖前原件已存 " + snapshotId
    + "（按字节抄的；要逐字节取回请复制该文件——read_file 的交付不保留末行换行、并有行/字节帽，别用它转写复原）";
}

// ---- #99：`run_shell` 的重定向覆写也走「覆盖前留一份原件」这一格 ----
//
// 缺口形状（台账 #99）：write_file / edit_file / apply_patch 三处覆盖前都拍快照，而一条
// `> file`（或 `>>`、`bash -c '… > file'`）经 run_shell 就把盘上的东西改了——审计面上只留下
// 一条 shell 回执，事后**没有任何原件可取回**，即不可回滚。
//
// 本波只做这一格，不动任何审批语义：风险层（`src/permissions/risk.ts`）此刻在别人手里，
// 认不出／够不着的目标一律**出声 + 命令照跑**，唯一的「拒」是 `.agent/` 那条既有地板
// （`assertNotAgentArea`，内容工具一直有、重定向这一面以前根本不问它）。
//
// 取料禁止第二份事实源：写目标只从**已有的两条命令形状判据**交出来的 token 里认——
// 链式切段吃权限层的 `splitCommandChain`，每段再交 `invocations`（command-shape.ts，权限规则层
// 与 worker 的 git 闸吃的是同一份：跳过 exec 包装器与环境赋值、把 `bash -c` 载荷与 `$(…)` 替换
// 载荷递归展开）。风险层那条 `redirectOnto(...)` 是对**原始命令文本**扫正则，用来「评级」够用
// （只问有没有写到敏感面），拿来做快照会两头错：`echo 'x > f'`（引号里的文本）被误认成写目标、
// `> "a b.txt"` 这类带引号的目标取不干净。

/** `>` / `>>` / `>|`，可带 fd 前缀（`2>`）或 bash 的合流写法（`&>`）；捕获组是同一 token 里
 *  紧跟其后的操作数（`>out` 这种合并写法）；操作数在下一个 token 时捕获组为空串。 */
const REDIRECT_OP = /^(?:\d+)?(?:&>>|&>|>>|>\||>)(.*)$/;
/** 描述符复制（`2>&1`／`>&2`／`>&-`）不落进任何文件；`>(…)`／`=(…)` 是进程替换（管道/FIFO），
 *  也不是命名文件的覆写——两种都不该冒充写目标。 */
const NOT_A_FILE_TARGET = /^&[-=\d]|^[>(=]/;
/** 落点要 bash 展开之后才知道的写法：变量／命令替换／通配／花括号展开。这些拍不了「覆盖前」那份
 *  原件 ⇒ 只能点名。方向要说清：文件名里**真带**这些字符（`v$2.txt`、`a{b}.txt`）会被一并判成
 *  认不出 ⇒ 代价是少拍一份快照 + 一行噪音，而不是静默丢掉回滚。圆括号不在表里：未加引号的 `(`
 *  在 bash 里是语法不是文件名，能活着进到 token 里的都是字面名（`(1)`）。 */
const UNEXPANDED_TARGET = /[`${*?}]/;
/** `/dev/**`：丢弃位与块设备，没有「文件原件」这个概念（风险层那条 `(?!&|/dev/null)` 同口径）。 */
const DISCARD_TARGET = /^\/dev\//;

/** 一条命令里所有「被重定向写到」的操作数（按出现顺序、去重；纯函数，判卷直接喂）。
 *
 *  两遍取料、用的还是那一份解析，因为两遍各瞎一半：
 *  ⑴ 按 `splitCommandChain` 切段（权限层那一份链式切分：`&&`/`||`/`;`/`|`/`&`/换行）再逐段
 *     `invocations` —— 少了这一遍，`echo A > f1; echo B > f2` 的第一个目标会以 `f1;` 的形状
 *     交回来（command-shape 的分工注释写明「链式分隔由调用方先切段」），stat 不到就静默漏拍；
 *  ⑵ 整串直接 `invocations` —— 少了这一遍，`echo x > "a;b.txt"` 这种**引号里带分隔符**的目标
 *     会被 ⑴ 的字符级切刀从中间劈开而整个丢掉。两遍取并集，多出来的那一支（`f1;`）落在
 *     「目标不存在 ⇒ 按新建口径不拍也不出声」，不造假噪音。
 *  已知还认不出来的形状：操作数本身带被 tokenize 折开的空白。方向与上面一致——认不出就少拍
 *  一份原件，绝不把「看不见」说成「能回滚」。 */
export function redirectWriteTargets(command: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const collect = (tokens: string[]): void => {
    for (let i = 0; i < tokens.length; i++) {
      const m = tokens[i]!.match(REDIRECT_OP);
      if (m === null) continue;
      const operand = m[1] === "" ? tokens[i + 1] ?? "" : m[1]!;
      if (operand === "" || NOT_A_FILE_TARGET.test(operand)) continue;
      if (!seen.has(operand)) { seen.add(operand); out.push(operand); }
    }
  };
  for (const segment of splitCommandChain(command)) {
    for (const inv of invocations(segment)) collect([inv.bin, ...inv.args]);
  }
  for (const inv of invocations(command)) collect([inv.bin, ...inv.args]);
  return out;
}

export interface ShellRedirectPlan {
  /** 拍到的原件（workspace 相对路径）：进 tool_result 的 snapshotId 与回执正文。 */
  ids: string[];
  /** 没拍到、但**必须点名**的写面：认不出／够不着／快照层自己失败。 */
  unsnapped: string[];
}

/** 命令真跑之前对重定向目标拍快照。返回的 ids/unsnapped 都只读盘、不改命令结果。
 *  抛错只可能是 `.agent/` 那条既有地板（调用方在 spawn 之前 await ⇒ 命令根本没跑）。 */
export async function snapshotShellRedirects(
  workspace: string,
  command: string,
  opts: { callId?: string; enabled?: boolean } = {},
): Promise<ShellRedirectPlan> {
  const ids: string[] = [];
  const unsnapped: string[] = [];
  for (const raw of redirectWriteTargets(command)) {
    assertNotAgentArea(raw, "run_shell"); // 地板排在一切之前（含 enabled=false 的那一支）
    if (opts.enabled === false) continue; // worker 显式关掉：worktree 天然可回滚，三个内容写工具同口径
    if (UNEXPANDED_TARGET.test(raw) || raw.startsWith("~")) {
      unsnapped.push(`"${raw}"：这条重定向没拍快照（目标带变量／通配／家目录简写，落点要 bash 展开才知道）——改完拿不回来`);
      continue;
    }
    if (DISCARD_TARGET.test(raw)) continue;
    let abs: string;
    try {
      abs = resolveInWorkspace(workspace, raw, "run_shell");
    } catch {
      unsnapped.push(`"${raw}"：这条重定向没拍快照（目标在工作区外，快照根 ${SNAPSHOT_ROOT}/** 是工作区相对路径，够不着）`);
      continue;
    }
    try {
      await assertRealContainment(workspace, abs, "run_shell");
    } catch {
      unsnapped.push(`"${raw}"：这条重定向没拍快照（软链解析后落点在区外，同上够不着）`);
      continue;
    }
    // 区外那两条已经 continue 出去了；剩下的是「工作区内的软链落进 .agent/」——同一道地板，照旧拒。
    await assertNotAgentAreaReal(workspace, abs, "run_shell");
    const inspected = await captureContainedPath(workspace, abs, "run_shell").catch(() => null);
    if (inspected === null) continue; // 新建 ⇒ 与 write_file 同口径：没有原件可保，不拍也不出声
    const st = inspected.stat;
    if (st.isDirectory()) continue;   // 目标是目录 ⇒ bash 自己会失败，不存在「覆写原件」这一格
    if (!st.isFile()) {               // 设备／FIFO／socket：写它不是「改一个可回滚的文件」，但得说清
      unsnapped.push(`"${raw}"：这条重定向没拍快照（目标不是普通文件，没有「覆盖前原件」这个概念）`);
      continue;
    }
    if (st.size === 0) continue;      // 空文件不值得占（snapshotBeforeOverwrite 的既有口径）
    // 名字用归一后的工作区相对路径：raw 里的 `./x` 与 `a/../b` 该归成同一个名，否则同一个文件
    // 会因为写法不同落进两份快照（`snapshotIdOf` 的同名复写是「一次覆盖一个目录」的前提）。
    const id = await snapshotBeforeOverwrite(workspace, abs, relative(workspace, abs), opts.callId);
    if (id === null) {
      unsnapped.push(`"${raw}"：这条重定向没拍快照（快照层自己失败）——写照常进行，但这次覆写不可回滚`);
      continue;
    }
    ids.push(id);
  }
  return { ids, unsnapped };
}

/** run_shell 的回执那一段：拍到的复用 `snapshotNote` 的既有措辞（不抄第二份文案），
 *  没拍到的逐条点名——只剩一条 shell 回执的覆写看起来「什么事都没发生」，那正是本仓最忌的假象。 */
export function shellRedirectReceipt(plan: ShellRedirectPlan): string {
  const lines: string[] = [];
  if (plan.ids.length > 0) {
    lines.push("[覆盖前快照] " + plan.ids.map((id) => snapshotNote(id).replace(/^｜/u, "")).join("；"));
  }
  if (plan.unsnapped.length > 0) lines.push("[未快照] " + plan.unsnapped.join("；"));
  return lines.length === 0 ? "" : "\n" + lines.join("\n");
}
