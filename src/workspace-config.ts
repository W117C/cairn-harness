// 工作区配置（`.agent/config.json`）的唯一读写口（roadmap「工作区层统一」，2026-11-10）。
//
// 此前这一层只有「各自为政的消费者」：search-settings 自带 readDocument/save、web-search 在
// 工具侧 sync 读、diagnose/verify 各读各的。三处对「损坏 JSON」的措辞与越界闸的口径迟早漂
// （本仓判死过多次的「同一事实抄两份」形状）。本模块只收拢**读-改-写**那一面（读端是纯读，
// 不需要门；写端必须过 containment + 原子写 + 回读校验三件套），语义与 search-settings 逐字一致：
//   · 损坏 JSON = fail-loud（报错且**不覆盖原文件**——写端先 read 校验再动笔）；
//   · 越界/软链落点 = 与内容工具同一组闸（assertRealContainment / resolveWriteTarget）；
//   · 原子写（writeFileAtomic）。
// 工具侧的 sync 读（web-search）与配置消费面（diagnose/verify 读 verify 段）不强制迁移：
// 它们是纯读，不经过本模块的写闸也不损失什么；强制迁移会把 src/tools 反向 import src/。
import { readFile } from "node:fs/promises";
import { projectAgentPath } from "./app-data";
import { writeFileAtomic } from "./atomic-write";
import { assertRealContainment, resolveWriteTarget } from "./tools/base";
import { isRecord } from "./is-record";

export interface WorkspaceConfigRead {
  root: Record<string, unknown>;
  /** 非 null = 读失败（损坏/越界），root 为空对象。写端见此必须拒绝动笔。 */
  error: string | null;
  path: string;
}

/** 读工作区配置（越界 = fail-loud，损坏 = 显式 error 不猜）。 */
export async function readWorkspaceConfig(workspace: string, label = "workspace config"): Promise<WorkspaceConfigRead> {
  const path = projectAgentPath(workspace, "config.json");
  await assertRealContainment(workspace, path, label);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { root: {}, error: null, path };
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { root: {}, error: `${label} JSON 损坏，请先修复 .agent/config.json；原文件未覆盖`, path };
  }
  if (!isRecord(value)) return { root: {}, error: `${label} 须是 JSON 对象；原文件未覆盖`, path };
  return { root: value, error: null, path };
}

/** 读-改-写：mutate 拿到已解析的 root，返回要写的 root（可原样返回 = 只读通过）。
 *  写前重读（防密钥存取这类长跳期间别人改了文件），写闸与读闸同一组。 */
export async function writeWorkspaceConfig(
  workspace: string,
  mutate: (root: Record<string, unknown>) => Record<string, unknown>,
  label = "workspace config",
): Promise<{ ok: true; root: Record<string, unknown> } | { ok: false; error: string }> {
  const first = await readWorkspaceConfig(workspace, label);
  if (first.error !== null) return { ok: false, error: first.error };
  const next = mutate(first.root);
  // 写前重读：mutate 里可能有 await（密钥存取等），期间文件可能被改——重读校验，损坏即拒笔。
  const fresh = await readWorkspaceConfig(workspace, label);
  if (fresh.error !== null) return { ok: false, error: fresh.error };
  const path = await resolveWriteTarget(workspace, projectAgentPath(workspace, "config.json"), label);
  await writeFileAtomic(path, JSON.stringify(next, null, 2) + "\n");
  return { ok: true, root: next };
}
