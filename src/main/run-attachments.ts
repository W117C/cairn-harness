import { realpathSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

export type RunAttachmentKind = "file" | "directory";

export interface RunAttachmentReference {
  path: string;
  kind: RunAttachmentKind;
  explicit: boolean;
}

export interface ValidatedRunAttachment extends RunAttachmentReference {
  /** canonical path; never the renderer-provided spelling */
  realPath: string;
  withinWorkspace: boolean;
  /** The caller must pass this through the existing external-reference approval path. */
  requiresExternalApproval: boolean;
}

export type AttachmentParseResult =
  | { ok: true; value: RunAttachmentReference }
  | { ok: false; error: string };

export type AttachmentValidationResult =
  | { ok: true; value: ValidatedRunAttachment }
  | { ok: false; error: string };

const MAX_ATTACHMENTS = 32;
const MAX_PATH_LENGTH = 4096;
/** 限的是**路径总字符**（不是渲染后的块）。渲染产物每行还要加「- kind: path=」包装与头尾两行，
 *  正常满额约 17.4k 字符 ⇒ provider 侧那顶块级帽 `ATTACHMENT_CONTEXT_CHAR_LIMIT`（32,768，
 *  `src/agent/session-provider.ts`）留了约 1.9 倍余量。两处是**两个量纲**（路径字符 vs 块字符），
 *  不要互相顶替：入口闸用户输入，provider 闸绕过入口的调用方。 */
const MAX_TOTAL_PATH_CHARS = 16_384;

/** Parse the renderer boundary before touching the filesystem. */
export function parseRunAttachment(raw: unknown): AttachmentParseResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "附件必须是对象" };
  }
  const value = raw as Record<string, unknown>;
  const unknown = Object.keys(value).filter((key) => key !== "path" && key !== "kind" && key !== "explicit");
  if (unknown.length > 0) return { ok: false, error: `附件未知字段: ${unknown.join(", ")}` };
  if (typeof value.path !== "string" || value.path.trim() === "") {
    return { ok: false, error: "附件 path 必须是非空字符串" };
  }
  if (value.path.length > MAX_PATH_LENGTH || value.path.includes("\0")) {
    return { ok: false, error: "附件 path 过长或包含 NUL" };
  }
  if (value.kind !== "file" && value.kind !== "directory") {
    return { ok: false, error: "附件 kind 必须是 file 或 directory" };
  }
  if (typeof value.explicit !== "boolean") {
    return { ok: false, error: "附件 explicit 必须是 boolean" };
  }
  return {
    ok: true,
    value: {
      path: value.path,
      kind: value.kind,
      explicit: value.explicit,
    },
  };
}

function pathIsWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && rel !== ".." && !isAbsolute(rel));
}

/**
 * Validate a reference without reading its contents. The Agent later reads it through
 * the normal tool/permission path; this function only establishes location and type.
 */
export async function validateRunAttachment(
  reference: RunAttachmentReference,
  workspace: string,
): Promise<AttachmentValidationResult> {
  if (workspace.trim() === "" || workspace.includes("\0")) {
    return { ok: false, error: "附件校验缺少合法 workspace" };
  }

  let workspaceReal: string;
  try {
    workspaceReal = await realpath(resolve(workspace));
    const workspaceStat = await stat(workspaceReal);
    if (!workspaceStat.isDirectory()) return { ok: false, error: "workspace 不是目录" };
  } catch {
    return { ok: false, error: "workspace 不存在或无法解析" };
  }

  let target: string;
  try {
    target = await realpath(resolve(workspace, reference.path));
    const targetStat = await stat(target);
    if (reference.kind === "file" && !targetStat.isFile()) {
      return { ok: false, error: `附件不是文件: ${reference.path}` };
    }
    if (reference.kind === "directory" && !targetStat.isDirectory()) {
      return { ok: false, error: `附件不是目录: ${reference.path}` };
    }
  } catch {
    return { ok: false, error: `附件不存在或无法解析: ${reference.path}` };
  }

  const withinWorkspace = pathIsWithin(workspaceReal, target);
  return {
    ok: true,
    value: {
      ...reference,
      realPath: target,
      withinWorkspace,
      requiresExternalApproval: !withinWorkspace,
    },
  };
}

export async function validateRunAttachments(
  raw: unknown,
  workspace: string,
): Promise<{ ok: true; value: ValidatedRunAttachment[] } | { ok: false; error: string }> {
  if (!Array.isArray(raw)) return { ok: false, error: "attachments 必须是数组" };
  if (raw.length > MAX_ATTACHMENTS) return { ok: false, error: `附件数量不能超过 ${MAX_ATTACHMENTS}` };

  const parsed: RunAttachmentReference[] = [];
  for (const item of raw) {
    const result = parseRunAttachment(item);
    if (!result.ok) return result;
    parsed.push(result.value);
  }

  const totalPathChars = parsed.reduce((sum, reference) => sum + reference.path.length, 0);
  if (totalPathChars > MAX_TOTAL_PATH_CHARS) {
    return { ok: false, error: `附件路径总长度不能超过 ${MAX_TOTAL_PATH_CHARS} 字符` };
  }

  const validated: ValidatedRunAttachment[] = [];
  const seen = new Set<string>();
  for (const reference of parsed) {
    const result = await validateRunAttachment(reference, workspace);
    if (!result.ok) return result;
    if (seen.has(result.value.realPath)) continue;
    seen.add(result.value.realPath);
    validated.push(result.value);
  }
  return { ok: true, value: validated };
}

/** Path-only prompt context. No file bytes are read here; the Agent must use normal guarded tools. */
export function formatAttachmentContext(
  attachments: readonly ValidatedRunAttachment[],
  workspace: string,
): string | undefined {
  if (attachments.length === 0) return undefined;
  let workspaceReal: string;
  try {
    workspaceReal = realpathSync(resolve(workspace));
  } catch {
    return undefined;
  }
  const lines = attachments.map((attachment) => {
    const rel = relative(workspaceReal, attachment.realPath);
    const workspaceRelative = pathIsWithin(workspaceReal, attachment.realPath) ? rel || "." : undefined;
    // 不把 renderer 原文或绝对 canonical path 送进模型；外部引用在 handler 已先行拒绝。
    const displayPath = workspaceRelative ?? "[已验证的本地引用]";
    return `- ${attachment.kind}: path=${JSON.stringify(displayPath)}`;
  });
  return [
    "[附件引用（仅路径，尚未读取内容）]",
    ...lines,
    "需要内容时使用 read_file；目录使用 glob。附件内容仍受工作区与权限门约束。",
  ].join("\n");
}
