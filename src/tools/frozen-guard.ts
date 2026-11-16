// 判卷面在 **shell 执行层** 的兜底（2026-11-15，F1）。
//
// 为什么需要两条腿：
//  · 权限层 `evaluate()` 只能在命令文本里认写目标；认不全（`python3 -c`、`node -e`、变量间接、
//    base64 解码后再落盘……）。词法闸再长也只是 blocklist。
//  · macOS 上真正的强制在 Seatbelt：`buildSandboxProfile` 为每个冻结文件写 literal 拒绝，
//    软链/硬链/rename/rm 都挡住。无沙箱宿主（Linux/Windows/沙箱自检失败）没有这层。
//  ⇒ 本模块给无沙箱那条路补一条**对任何形状都生效**的兜底：命令跑前按字节记下所有冻结文件，
//    跑后逐字节复查；变了就按跑前内容复原，并把这次调用判失败（输出不可作为判据）。
//
// 口径写清（不许把它读成「预防」）：它只能「跑完复原」，挡不住同一条命令里先改判卷再跑测试、
// 拿到一次假绿。所以有沙箱时仍以 Seatbelt 为承重；本模块是沙箱缺席时的地板与两层的交叉校验。
import { dirname, isAbsolute, join, resolve } from "node:path";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { frozenJudgePathSet } from "../frozen";
import { assertNotFrozenReal } from "./base";
import { SNAPSHOT_ROOT, snapshotDigestOf, snapshotIdOf } from "./snapshot";

/** 守卫回执的两个固定片段：判卷与调用方都从这里取（照抄字面量会被 prose-needle 记成顶包候选）。 */
export const FROZEN_GUARD_TAG = "[判卷面守卫]";
export const FROZEN_GUARD_TAINT = "不可作为判据";
import { shellWriteTargetsOf } from "../permissions/shell-write-targets";

/** 留档上限：超过它的被改动内容只记「变了」，不再读进内存。 */
const QUARANTINE_CAP = 8 * 1024 * 1024;

export interface FrozenBaselineEntry {
  /** 工作区相对 posix 路径（冻结表键）。 */
  rel: string;
  /** 跑前字节；`missing` 为真时是空缓冲。 */
  bytes: Buffer;
  /** 跑前权限位（复原时保留；判卷文件通常 0644）。 */
  mode: number;
  /** 跑前就不存在（表陈旧）：没有可复原的原件，只能点名。 */
  missing: boolean;
}

export interface FrozenBaseline {
  entries: FrozenBaselineEntry[];
}

/** 跑前取基线。工作区没有冻结表 ⇒ null（零行为，用户自己的仓库不受这条约束）。 */
export async function captureFrozenBaseline(workspace: string): Promise<FrozenBaseline | null> {
  const set = frozenJudgePathSet(workspace);
  if (set.size === 0) return null;
  const entries: FrozenBaselineEntry[] = [];
  for (const rel of set) {
    const abs = join(workspace, rel);
    const st = await lstat(abs).catch(() => null);
    if (st === null) {
      entries.push({ rel, bytes: Buffer.alloc(0), mode: 0o644, missing: true });
      continue;
    }
    const bytes = await readFile(abs).catch(() => null);
    if (bytes === null) {
      entries.push({ rel, bytes: Buffer.alloc(0), mode: 0o644, missing: true });
      continue;
    }
    entries.push({ rel, bytes, mode: st.mode & 0o777, missing: false });
  }
  return { entries };
}

export interface FrozenGuardResult {
  /** 本条命令期间有冻结文件被改动/删除。 */
  tampered: boolean;
  /** 给模型看的回执（tampered=false 时为空串）。 */
  note: string;
}

/** 跑后复查 + 复原。tampered=false 时不写盘、不产生输出。 */
export async function enforceFrozenBaseline(
  workspace: string,
  baseline: FrozenBaseline | null,
): Promise<FrozenGuardResult> {
  if (baseline === null) return { tampered: false, note: "" };
  const changed: string[] = [];
  const failed: string[] = [];
  for (const entry of baseline.entries) {
    if (entry.missing) continue;
    const abs = join(workspace, entry.rel);
    // 先看大小：被写成超大文件时不把整份读进内存（判定「变了」不需要内容，复原也不需要它；
    // 留档那一份按帽截断——证据面不值得为一次越界再吃一个 GB 级内存尖峰）。
    const st = await lstat(abs).catch(() => null);
    const now = st !== null && st.isFile() && st.size <= QUARANTINE_CAP
      ? await readFile(abs).catch(() => null)
      : null;
    if (now !== null && st !== null && st.size === entry.bytes.length && now.equals(entry.bytes)) continue;
    changed.push(entry.rel);
    if (now !== null) await quarantine(workspace, entry.rel, now);
    try {
      await restore(workspace, entry.rel, entry.bytes, entry.mode);
    } catch (err) {
      failed.push(entry.rel + "（" + (err instanceof Error ? err.message : String(err)) + "）");
    }
  }
  if (changed.length === 0) return { tampered: false, note: "" };
  const named = changed.slice(0, 5).join("、") + (changed.length > 5 ? ` 等 ${String(changed.length)} 个` : "");
  if (failed.length > 0) {
    return {
      tampered: true,
      note:
        FROZEN_GUARD_TAG + " 本条命令改动了冻结判卷文件：" + named + "。复原失败：" + failed.join("；") +
        "。判卷面已损坏，本次输出不可作为判据，必须人工恢复（sha256 基线在 scripts/frozen-sha256.json）。",
    };
  }
  return {
    tampered: true,
    note:
      FROZEN_GUARD_TAG + " 本条命令改动了冻结判卷文件：" + named +
      "。已按调用前内容逐字节复原（改动前的字节留档在 " + SNAPSHOT_ROOT + "/frozen-guard--<原件摘要>/<原相对路径>）。" +
      FROZEN_GUARD_TAINT + "——判卷面在命令执行期间已被改写；要改判据请写 BLOCKED.md 换判据，不许改文件。",
  };
}

/** 改动前的字节留档：不静默丢证据（与 `snapshotBeforeOverwrite` 的「覆盖前原件」同向，但这一格
 *  留的是**被改动后的内容**——它是这次越界的证据）。留档失败不影响复原。 */
async function quarantine(workspace: string, rel: string, bytes: Buffer): Promise<void> {
  try {
    const id = snapshotIdOf(rel, "frozen-guard", snapshotDigestOf(bytes));
    const dest = join(workspace, id);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, bytes);
  } catch {
    /* 留档是审计面，不是复原的前置 */
  }
}

/** 原子复原：先写临时文件再 rename（与 atomic-write 同向）。若落点被改成目录/软链，先摘掉再写——
 *  否则 `rename` 会写到软链目标上（越界写）或直接失败。 */
async function restore(workspace: string, rel: string, bytes: Buffer, mode: number): Promise<void> {
  const abs = join(workspace, rel);
  await mkdir(dirname(abs), { recursive: true });
  const st = await lstat(abs).catch(() => null);
  if (st !== null && !st.isFile()) await rm(abs, { recursive: true, force: true });
  const tmp = abs + ".frozen-restore-" + String(process.pid) + "-" + String(Date.now());
  await writeFile(tmp, bytes, { mode });
  await rename(tmp, abs);
}

/** spawn 前的软链落点复查（工具层那道，与权限层词法闸互补）。
 *  `run_shell` 直接调用本函数：即使调用绕过了 `evaluate`（测试直调工具、未来新增入口），
 *  `alias.ts -> fixtures/mock/todo-bug.ts` 这种「词法看不见、落点看得见」的写也会被拒。 */
export async function assertShellWriteTargetsNotFrozen(
  workspace: string,
  command: string,
  label: string,
): Promise<void> {
  if (frozenJudgePathSet(workspace).size === 0) return;
  for (const target of shellWriteTargetsOf(command)) {
    const abs = isAbsolute(target) ? target : resolve(workspace, target);
    await assertNotFrozenReal(workspace, abs, label);
  }
}
