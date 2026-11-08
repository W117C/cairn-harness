// 思考档位的「本机可选面」（2026-10-31 · 业主：档位有多少种、用户可以自己定义，
// 但默认应当来自上游声明）。
//
// 边界（诚实第一）：本模块**只决定选择器里露哪几档**，不伪造能力。
// 「能不能发」仍由 core 的 ProviderCapability.thinking.values 决定（上游 /models 自述、
// 内置 registry 声明或 .agent/providers.json 的 reasoningEfforts）；这里永远只做减法：
// 用户可以把不想看到的档收起来，不能把上游没声明的档变出来。要加档，去供应商配置里声明。
//
// 持久化是渲染层偏好（localStorage，与侧栏密度同一档）：不跨窗口同步、不改事件日志。
// 存「隐藏了哪些」而不是「启用了哪些」——上游将来多声明一档时，默认仍然露出来。
const KEY = "cairn.thinking.hidden.v1";

/** modelId → 被用户收起的档位 id。 */
export type ThinkingHiddenMap = Readonly<Record<string, readonly string[]>>;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim() !== "");
}

/** 坏档回空：解析失败不当成「全部隐藏」，否则一次坏 localStorage 会让所有模型只剩「关」。 */
export function parseThinkingHidden(raw: string | null): ThinkingHiddenMap {
  if (raw === null || raw.trim() === "") return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const out: Record<string, readonly string[]> = {};
    for (const [modelId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!isStringArray(value)) continue;
      const unique = [...new Set(value.map((v) => v.trim()))];
      if (unique.length > 0) out[modelId] = unique;
    }
    return out;
  } catch {
    return {};
  }
}

export function serializeThinkingHidden(map: ThinkingHiddenMap): string {
  return JSON.stringify(map);
}

/** 某一档能不能被用户收起。「off」永远保留——关掉思考是保底动作，不能被配置藏掉。 */
export function canHideThinkingLevel(id: string): boolean {
  return id !== "off";
}

/** 选择器里真正露出的档位：声明顺序不变，去掉用户收起的；off 恒在首位（若上游/内置给了）。 */
export function visibleThinkingLevels(declared: readonly string[], hidden: readonly string[] | undefined): string[] {
  const hiddenSet = new Set(hidden ?? []);
  const out: string[] = [];
  for (const id of declared) {
    if (id === "off") out.push(id);
    else if (!hiddenSet.has(id)) out.push(id);
  }
  // 上游只声明了 off（或空表）时仍给 off：选择器不能出现空段。
  if (!out.includes("off")) out.unshift("off");
  return out;
}

/** 收起/恢复一档。非法 id（off 或不在声明表里）原样返回——不猜、不夹紧。 */
export function toggleThinkingHidden(hidden: readonly string[], id: string, declared: readonly string[]): string[] {
  if (!canHideThinkingLevel(id) || !declared.includes(id)) return [...hidden];
  const set = new Set(hidden);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  return declared.filter((level) => level !== "off" && set.has(level));
}

/** 收起后当前档位若被藏起来，落到哪一档：优先模型缺省，其次第一个可见的非 off，最后 off。 */
export function reconcileVisibleLevel(
  current: string,
  visible: readonly string[],
  modelDefault: string | undefined,
): string {
  if (visible.includes(current)) return current;
  if (modelDefault !== undefined && visible.includes(modelDefault)) return modelDefault;
  return visible.find((id) => id !== "off") ?? "off";
}

/** 读当前档案（浏览器外/坏档一律回空）。 */
export function readThinkingHidden(): ThinkingHiddenMap {
  if (typeof localStorage === "undefined") return {};
  return parseThinkingHidden(localStorage.getItem(KEY));
}

export function writeThinkingHidden(map: ThinkingHiddenMap): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(KEY, serializeThinkingHidden(map));
}

export const THINKING_HIDDEN_KEY = KEY;
