// 任务文本 → 进化检索的路径线索（纯函数，零 IO）。
//
// 为什么需要它：`prepareEvolutionInjection` 的 on-path / pathGlobs 匹配吃的是**结构化路径**，
// 而装配点此前只递任务原文。于是 on-path 经验在生产注入里永远不命中（context.paths 为空），
// on-tool 只剩关键词兜底——「经验写了作用域却从不生效」。
//
// 尺只有一把：切词与形状都复用 `context-signals` 的 PATHISH（与 session-provider 的
// 上下文文件面同一个来源），不在这里另写一条「什么是路径」的正则。

import { isAbsolute, relative } from "node:path";
import { makePathishRe } from "../context-signals";

/** 一次任务最多带几条路径线索（与 session-provider 的上下文文件面上限一致）。 */
export const TASK_PATHS_MAX = 8;

/** URL 整段先抹掉：否则 `https://example.com/a.ts` 的尾巴会被 PATHISH 当成 workspace 路径。 */
const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/\S+/giu;

function normalizeOne(raw: string, workspace: string | undefined): string | null {
  let token = raw.replace(/\\/gu, "/");
  if (token === "" || token === "/") return null;
  if (workspace !== undefined && isAbsolute(token)) {
    const rel = relative(workspace, token).replace(/\\/gu, "/");
    // 工作区外绝对不能靠「相对化」变成一串 ../：那不是本工作区的路径线索。
    if (rel === "" || rel.startsWith("../") || rel === "..") return null;
    token = rel;
  }
  while (token.startsWith("./")) token = token.slice(2);
  if (token.startsWith("/")) return null; // workspace 未知时，绝对路径对 scope 相对 glob 没有意义
  return token === "" ? null : token;
}

/** 从任务原文提取 workspace 相对路径（去重、保持出现序、封顶）。workspace 给定时，
 *  其下的绝对路径会归一成相对路径，工作区外的绝对路径丢弃。 */
export function extractTaskPaths(
  text: string,
  opts: { workspace?: string; max?: number } = {},
): string[] {
  const max = opts.max ?? TASK_PATHS_MAX;
  if (max <= 0 || text.length === 0) return [];
  const workspace = opts.workspace === undefined ? undefined : opts.workspace.replace(/\\/gu, "/").replace(/\/+$/u, "");
  const out = new Set<string>();
  for (const raw of text.replace(URL_RE, " ").match(makePathishRe()) ?? []) {
    const token = normalizeOne(raw, workspace);
    if (token === null) continue;
    out.add(token);
    if (out.size >= max) break;
  }
  return [...out];
}
