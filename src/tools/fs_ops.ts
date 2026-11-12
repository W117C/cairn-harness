// fs_ops：文件生命周期四动作（mkdir / move / rename / delete），一把结构化工具。
//
// 为什么它值得存在：这三类操作此前只有 run_shell 一条路（rm/mv/mkdir），而 shell 那条路
// 绕开三样东西——D7 覆盖前快照（原件拿不回来）、结构化回执（changedPaths/snapshotId 落事件流）、
// 内容工具的那组真实落点闸（软链复查 / 敏感面 / 判卷冻结）。一条 `rm` 的审计面上只剩一句回执，
// 事后没有任何原件可取——与 #99（重定向覆写没有原件）是同族缺口，本工具是文件面的那一格。
//
// 边界（V1 的刻意收窄）：
//   · 只在工作区内操作（resolveInWorkspace + assertRealContainment，与内容工具同一口）；
//   · delete 只删普通文件与**空**目录——整棵树的批量删除留给 run_shell 的审批卡（system prompt
//     那条「mass deletion 先确认」在 shell 面有人看着）；删文件前先拍快照（同覆盖写）；
//   · move/rename 目标已存在时拒绝，要覆盖必须显式 allow_overwrite:true（覆盖前对目标拍快照）；
//   · mkdir 递归建（等同 mkdir -p），已存在直接成功（幂等，同 mkdir -p 语义）。
// 写向归类：SIDE_EFFECT_TOOLS 计入（只读档摘除、方案门挡）；delete 的静态风险 medium
// （risk.ts：快照可回滚但仍是破坏向操作），mkdir/move/rename 走路径通道判敏感面。
import { mkdir, readdir, rename, rmdir, lstat, readlink, stat, unlink } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import {
  appendImpact,
  assertNotAgentArea,
  assertNotAgentAreaReal,
  assertNotFrozenReal,
  assertNotSensitivePathReal,
  assertRealContainment,
  resolveInWorkspace,
  resolveWriteTarget,
  ToolError,
  type Tool,
  type ToolContext,
  type ToolResult,
} from "./base.js";
import { snapshotBeforeOverwrite, snapshotNote } from "./snapshot.js";

const ACTIONS = ["mkdir", "move", "rename", "delete"] as const;
type Action = (typeof ACTIONS)[number];

/** 三道真实落点闸（.agent 禁区 / 判卷冻结 / 敏感面）对 path 与 target 各跑一遍。
 *  词法 rel 与真实落点都要查——软链把落点搬进禁区那族缺口（C3/P0-6 的教训）词法看不见。 */
async function checkTarget(workspace: string, abs: string, rel: string, label: string): Promise<void> {
  assertNotAgentArea(rel, label);
  await assertRealContainment(workspace, abs, label);
  await assertNotAgentAreaReal(workspace, abs, label);
  await assertNotFrozenReal(workspace, abs, label);
  await assertNotSensitivePathReal(workspace, abs, label);
}

export const fs_ops: Tool = {
  name: "fs_ops",
  async run(args, ctx): Promise<ToolResult> {
    const action = args.action;
    if (typeof action !== "string" || !(ACTIONS as readonly string[]).includes(action)) {
      throw new ToolError(`fs_ops: action 必须是 ${ACTIONS.join(" / ")} 之一`);
    }
    const rel = typeof args.path === "string" ? args.path : "";
    if (rel.trim() === "") throw new ToolError(`fs_ops: path 参数必须是非空字符串（${action} 的作用对象，workspace 相对路径）`);
    const abs = resolveInWorkspace(ctx.workspace, rel, "fs_ops");
    await checkTarget(ctx.workspace, abs, rel, "fs_ops");
    const label = `fs_ops.${action}`;

    if (action === "mkdir") {
      // 幂等：已存在的目录直接成功（mkdir -p 语义）；已存在但**是文件**要拒绝——静默成功会
      // 让模型以为建好了目录，而后续写入会砸在一个同名文件上。
      const st = await stat(abs).catch(() => null);
      if (st !== null) {
        if (st.isDirectory()) return { ok: true, output: `已确认目录存在：${rel}` };
        throw new ToolError(`${label}: 路径已存在且是文件，不能当作目录使用: ${rel}`);
      }
      await mkdir(abs, { recursive: true });
      return { ok: true, output: `已创建目录（递归）：${rel}`, changedPaths: [rel] };
    }

    if (action === "delete") {
      // lstat 而非 stat：删的是**这个名字**本身——软链删链（unlink 不跟随），不把链外目标的
      // 内容抄进快照、也不给「删了个文件」的假象。
      const st = await lstat(abs).catch(() => null);
      if (st === null) throw new ToolError(`${label}: 目标不存在: ${rel}`);
      if (st.isSymbolicLink()) {
        const to = await readlink(abs).catch(() => "?");
        await unlink(abs);
        return { ok: true, output: `已删除软链：${rel}（原指向 ${to}；目标文件未动）`, changedPaths: [rel] };
      }
      if (st.isDirectory()) {
        const inside = await readdir(abs).catch(() => null);
        if (inside === null) throw new ToolError(`${label}: 目录不可读: ${rel}`);
        if (inside.length > 0) {
          throw new ToolError(`${label}: 目录非空（${String(inside.length)} 项）——批量删除留给 run_shell 的审批卡；先逐文件 delete 或清空后再删目录`);
        }
        await rmdir(abs);
        return { ok: true, output: `已删除空目录：${rel}/`, changedPaths: [rel] };
      }
      if (!st.isFile()) throw new ToolError(`${label}: 只支持普通文件、软链与空目录（${rel} 是其它类型）`);
      // D7 同一笔账：删除也是「从此拿不到原件」的动作，先按字节抄一份再 unlink。
      // 快照失败不改删除结果（best-effort，与覆盖写同一条纪律），但要在回执里点名。
      const snapshotId = ctx.snapshot === false ? null : await snapshotBeforeOverwrite(ctx.workspace, abs, rel, ctx.callId);
      await unlink(abs);
      let summary = `已删除文件：${rel}`;
      if (snapshotId !== null) summary += snapshotNote(snapshotId);
      else summary += "｜本次删除没有快照原件（快照层失败或 worker worktree）";
      return { ok: true, output: await appendImpact(ctx, rel, summary), ...(snapshotId !== null ? { snapshotId } : {}), changedPaths: [rel] };
    }

    // ---- move / rename：同一套语义（rename 是 move 的别名），目标可以没有 ----
    const targetRel = typeof args.target === "string" ? args.target : "";
    if (targetRel.trim() === "") throw new ToolError(`${label}: target 参数必须是非空字符串（移动到的目标路径，workspace 相对）`);
    if (targetRel === rel) throw new ToolError(`${label}: 目标与源相同: ${rel}`);
    const targetAbs = resolveInWorkspace(ctx.workspace, targetRel, "fs_ops");
    // 落点若是软链，写到它指向的真实路径（与 write_file 的 resolveWriteTarget 同一内核语义）。
    const landed = await resolveWriteTarget(ctx.workspace, targetAbs, "fs_ops");
    // 软链落点可能搬进禁区/判卷面/敏感面：对**真实落点**把三道闸再跑一遍。
    await checkTarget(ctx.workspace, landed, relative(resolve(ctx.workspace), landed) || targetRel, "fs_ops");
    // lstat 而非 stat：rename(2) 动的是**这个名字**（软链整条搬走，不跟随）——stat 会把
    // 「悬空软链」判成「源不存在」（名字明明在，rename 本可成功），也会把「软链→目录」
    // 误报成「已移动目录」。与 delete 的「删的是名字本身」同一格纪律（C3/P0-6 软链族教训）。
    const srcSt = await lstat(abs).catch(() => null);
    if (srcSt === null) throw new ToolError(`${label}: 源不存在: ${rel}`);
    // 软链源的回执要点名原指向：rename 之后 readlink(abs) 就拿不到了（名字已搬走）。
    const srcLinkTarget = srcSt.isSymbolicLink() ? await readlink(abs).catch(() => "?") : null;
    const targetSt = await stat(landed).catch(() => null);
    let snapshotId: string | null = null;
    if (targetSt !== null && targetSt.isDirectory()) {
      // rename(2) 不是 coreutils 的 move-into 语义：目标目录存在时不会「放进」它。
      // 把这一格显式拒掉并给可行动出口，比让模型吃一句 EISDIR/ENOTEMPTY 自己猜强。
      throw new ToolError(`${label}: 目标是已存在的目录——要把源放进它，target 请写到「${targetRel}/<条目名>」（本工具是 rename 语义，不是 mv 的 move-into）`);
    }
    if (targetSt !== null) {
      if (args.allow_overwrite !== true) {
        throw new ToolError(`${label}: 目标已存在: ${targetRel}——要覆盖请显式带 allow_overwrite:true（覆盖前会先拍快照）`);
      }
      if (targetSt.isFile() || targetSt.isSymbolicLink()) {
        // 覆盖目标文件 = 覆盖写那一格：先拍快照（worker worktree 同样关掉）。
        snapshotId = ctx.snapshot === false
          ? null
          : await snapshotBeforeOverwrite(ctx.workspace, landed, relative(ctx.workspace, landed), ctx.callId);
      }
    }
    await mkdir(dirname(landed), { recursive: true });
    try {
      await rename(abs, landed);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOTEMPTY" || code === "EEXIST") {
        throw new ToolError(`${label}: 目标位置非空，rename 被拒（${targetRel}）——先清理或逐条移动`);
      }
      // EXDEV（跨设备）在工作区内不该发生；其它的（把目录移进自身子树等）原样交出错因。
      throw new ToolError(`${label}: 移动失败（${code ?? "未知错误"}）: ${rel} → ${targetRel}`);
    }
    let summary = srcSt.isSymbolicLink()
      ? `已移动软链：${rel} → ${targetRel}（原指向 ${srcLinkTarget ?? "?"}；链外目标未动）`
      : srcSt.isDirectory()
        ? `已移动目录：${rel} → ${targetRel}`
        : `已移动文件：${rel} → ${targetRel}`;
    if (snapshotId !== null) summary += snapshotNote(snapshotId);
    return { ok: true, output: await appendImpact(ctx, targetRel, summary), ...(snapshotId !== null ? { snapshotId } : {}), changedPaths: [rel, targetRel] };
  },
};
