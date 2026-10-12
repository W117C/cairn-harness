// RunRequest is an IPC trust boundary. This validator is shared by ipcMain and handleAgentRun so a
// direct/headless caller cannot bypass checks that renderer traffic receives.
import { PERMISSION_MODES, type PermissionMode } from "../permissions";
import { THINKING_EFFORTS } from "../providers/capabilities";
import { effectiveModelTable, lookupModel } from "../providers/registry";
import { parseRunAttachment, type RunAttachmentReference } from "./run-attachments";
import { isValidSessionName } from "./sessions";
import type { RunRequest } from "./ipc-protocol";

const ALLOWED_FIELDS = new Set<keyof RunRequest>([
  "message",
  "mode",
  "sessionId",
  "workspace",
  "model",
  "thinking",
  "attachments",
]);

export type RunRequestValidation =
  | { ok: true; value: RunRequest }
  | { ok: false; error: string };

export function validateRunRequestEnvelope(raw: unknown): RunRequestValidation {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, error: "RunRequest 必须是对象" };
  const value = raw as Record<string, unknown>;
  const unknownFields = Object.keys(value).filter((key) => !ALLOWED_FIELDS.has(key as keyof RunRequest));
  if (unknownFields.length > 0) return { ok: false, error: `RunRequest 未知字段: ${unknownFields.join(", ")}` };
  if (typeof value.message !== "string" || value.message.trim() === "" || value.message.length > 100_000) {
    return { ok: false, error: "RunRequest.message 必须是非空字符串（≤100KB）" };
  }
  if (typeof value.mode !== "string" || !(PERMISSION_MODES as readonly string[]).includes(value.mode)) {
    return { ok: false, error: `RunRequest.mode 非法: ${JSON.stringify(value.mode)}` };
  }
  if (value.sessionId !== undefined && (typeof value.sessionId !== "string" || !isValidSessionName(value.sessionId))) {
    return { ok: false, error: "RunRequest.sessionId 非法" };
  }
  if (
    value.workspace !== undefined &&
    (typeof value.workspace !== "string" || value.workspace.trim() === "" || value.workspace.length > 4096 || value.workspace.includes("\0"))
  ) {
    return { ok: false, error: "RunRequest.workspace 非法（须为非空字符串，≤4096）" };
  }
  if (value.model !== undefined) {
    if (typeof value.model !== "string" || value.model.trim() === "" || value.model.length > 128) {
      return { ok: false, error: "RunRequest.model 必须是非空稳定 registry id（≤128 字符）" };
    }
    // 同样改走有效表：否则「用自定义模型跑一轮」会在请求校验这一关卡住（用户刚踩到的下一站）
    if (!lookupModel(effectiveModelTable(), value.model)) {
      return { ok: false, error: `RunRequest.model 未登记: ${JSON.stringify(value.model)}` };
    }
  }
  if (value.thinking !== undefined && !THINKING_EFFORTS.includes(value.thinking as (typeof THINKING_EFFORTS)[number])) {
    return { ok: false, error: `RunRequest.thinking 非法: ${JSON.stringify(value.thinking)}` };
  }

  let attachments: RunAttachmentReference[] | undefined;
  if (value.attachments !== undefined) {
    if (!Array.isArray(value.attachments)) return { ok: false, error: "RunRequest.attachments 必须是数组" };
    attachments = [];
    for (const rawAttachment of value.attachments) {
      const parsed = parseRunAttachment(rawAttachment);
      if (!parsed.ok) return { ok: false, error: `RunRequest.attachments: ${parsed.error}` };
      attachments.push(parsed.value);
    }
  }

  return {
    ok: true,
    value: {
      message: value.message,
      mode: value.mode as PermissionMode,
      ...(value.sessionId !== undefined ? { sessionId: value.sessionId } : {}),
      ...(value.workspace !== undefined ? { workspace: value.workspace } : {}),
      ...(value.model !== undefined ? { model: value.model } : {}),
      ...(value.thinking !== undefined ? { thinking: value.thinking as (typeof THINKING_EFFORTS)[number] } : {}),
      ...(attachments !== undefined ? { attachments } : {}),
    },
  };
}
