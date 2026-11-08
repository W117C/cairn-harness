import { realpathSync } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { sniffImageMime } from "../tools/read_image";

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
  /** The caller must pass this through the external-reference approval path. */
  requiresExternalApproval: boolean;
  /** Set only after the user approved this external reference for the current run.
   *  It grants `read_file`/`read_image` access to exactly this path (or subtree for a
   *  directory) while the run is alive; it is never persisted. */
  externalApproved?: boolean;
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

/** 外置**图片**自动放行：用户把图拖进来/粘贴进来本身就是明确动作，再点一次「允许」
 *  只是噪音（实测：截图走剪贴板落在系统 temp，100% 在 workspace 外 ⇒ 每张都弹卡）。
 *  判据用 magic number（后缀名不参与，与 read_image 同源），只放行这一条路径、只活本轮；
 *  非图片附件仍走审批卡。读取时仍按 realpath 复核，批准后换软链也不会被跟随。 */
export async function isImageRunAttachment(attachment: ValidatedRunAttachment): Promise<boolean> {
  if (attachment.kind !== "file") return false;
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(attachment.realPath, "r");
    const prefix = Buffer.alloc(16);
    const { bytesRead } = await handle.read(prefix, 0, prefix.length, 0);
    return sniffImageMime(prefix.subarray(0, bytesRead)) !== null;
  } catch {
    return false;
  } finally {
    await handle?.close().catch(() => undefined);
  }
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
  let hasApprovedExternal = false;
  const lines = attachments.map((attachment) => {
    const rel = relative(workspaceReal, attachment.realPath);
    const workspaceRelative = pathIsWithin(workspaceReal, attachment.realPath) ? rel || "." : undefined;
    // 工作区内给相对路径（与工具入参同形）。项目外只有在本轮获得批准后才交出 canonical
    // path（非图片点「允许」；图片的拖入/粘贴本身就是授权）；批准过的路径同时进
    // `externalReadGrants`，read_file/read_image 才认它。
    const approvedExternal = workspaceRelative === undefined && attachment.externalApproved === true;
    if (approvedExternal) hasApprovedExternal = true;
    const displayPath = workspaceRelative ?? (approvedExternal ? attachment.realPath : "[未批准的本地引用]");
    return `- ${attachment.kind}: path=${JSON.stringify(displayPath)}`;
  });
  return [
    "[附件引用（仅路径，尚未读取内容）]",
    ...lines,
    "需要内容时使用 read_file；目录可先用 read_file 列条目。附件内容仍受工作区与权限门约束。",
    ...(hasApprovedExternal
      ? ["项目外附件已获本轮一次性读取批准；只有上面列出的路径可用，未列出的项目外路径仍会被拒绝。"]
      : []),
  ].join("\n");
}
