// 覆盖前快照（agent-plan §10.4 评审拍板 D7）：主会话覆盖一个**已存在**的文件之前，把原件按字节
// 抄进 `.agent/snapshots/`，并把快照路径随 tool_result 落进事件流（snapshot_id）。
//
// 只堵一条路径：「agent 把用户未提交的工作覆盖掉了」。不做全量影子 git（§10.10 定稿），
// write worker 另有 worktree 天然可回滚；本模块服务的是**直写用户真实工作区**的主会话。
// 位置是方案书定稿的 `.agent/snapshots/`——代价是它会出现在用户仓库的 git status 里（已记档）。
import { copyFile, mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

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
  try {
    const st = await stat(abs).catch(() => null);
    if (st === null || !st.isFile() || st.size === 0) return null;
    const id = snapshotIdOf(rel, callId);
    const target = join(workspace, id);
    await mkdir(dirname(target), { recursive: true });
    // copyFile 保留 mtime ⇒ 原件的时间信息也在，不用另存一份元数据。
    await copyFile(abs, target);
    return id;
  } catch (err) {
    console.warn("[snapshot] 覆盖前快照失败（写入照常进行）:", err instanceof Error ? err.message : String(err));
    return null;
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
