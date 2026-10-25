// 渲染层和配置校验共用的标识符规则；保持零平台依赖，避免表单把 node:net 带进浏览器。
// 保留名单必须跟 registry 的 PROVIDER_IDS 同步：同名自定义家会让 registry 的 switch 先命中
// 内置分支、自定义配置被静默忽略——所以校验在这里拒收，而不是运行时静默让位。
export const RESERVED_PROVIDER_IDS = ["demo", "glm", "openai", "anthropic", "gemini", "deepseek"] as const;
export const MODEL_ID_RE = /^[A-Za-z0-9._:/-]{1,128}$/;

export function isValidModelId(id: unknown): id is string {
  return typeof id === "string" && MODEL_ID_RE.test(id);
}
