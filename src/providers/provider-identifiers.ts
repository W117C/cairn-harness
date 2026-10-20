// 渲染层和配置校验共用的标识符规则；保持零平台依赖，避免表单把 node:net 带进浏览器。
export const RESERVED_PROVIDER_IDS = ["demo", "glm", "openai", "anthropic", "gemini"] as const;
export const MODEL_ID_RE = /^[A-Za-z0-9._:/-]{1,128}$/;

export function isValidModelId(id: unknown): id is string {
  return typeof id === "string" && MODEL_ID_RE.test(id);
}
