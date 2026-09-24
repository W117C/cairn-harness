// spawn_agent 的**逐型参数面**：每一档真读哪些顶层参数，收成一张表。
//
// 为什么要有这个文件（2026-09-24 真轨迹取证，见 outputs/spawn-arg-surface-2026-09-24/）：
// 模型发过一次 `{mode:"supervise", task, resources:[…], stages:[实现→验证→修复循环]}`，
// 而 `spawnSupervise` 只读 `task` + `supervise` ⇒ 那份三阶段计划**整支静默丢弃**：worker 照派、
// 钱照花、回执里一个字没提"你的 stages 没了"。同一件事的内层早就严格了
// （`parseSuperviseContract` 拒未知键、`resolvePluginRole` 对笔误键出声），外层宽松 ⇒
// 模型只要把键写在顶层就绕过全部严格性。这是本仓点名的「申报了却不生效」缺陷族在**参数面**的那一格。
//
// 编译期只能钉一半：`Record<SpawnMode, …>` 逼我给的每个档都有键集（往联合类型里加一档而不给读集＝崩），
// 但**往 `SPAWN_MODES` 加一档**这里看不见 ⇒ 由 tests/spawn-arg-surface.test.ts 的
// 「表的 mode 集与 SPAWN_MODES 逐个一致」补另外一半。同理「谁都不读的新参数」由「每个键至少被一档读」钉。
import type { SpawnArgs } from "./orchestrator-types";

/** spawn_agent 的全部顶层参数（与 `SpawnArgs` 同集；`SpawnArgs` 是类型，运行期擦除，故此处必须是值）。 */
export const SPAWN_ARG_KEYS = [
  "task", "mode", "resources", "context", "stages", "depends_on", "model", "max_turns", "tier", "supervise", "role",
] as const;
export type SpawnArgKey = (typeof SPAWN_ARG_KEYS)[number];

export type SpawnMode = "read" | "write" | "pipeline" | "supervise";

/** 各档**实际读**的顶层参数。加参数不往这里落一笔 = 「谁都不读」（测试立刻红）。
 *  每一格的可核读点（别照抄本注释，改动后回代码核对）：
 *   · read/write → `Orchestrator.spawn`（role）+ `spawnInternal`（resources/context/model/max_turns/tier）
 *   · pipeline   → `spawnPipeline`（stages；resources 只进审批卡的租约相交警告）
 *   · supervise  → `spawnSupervise`（supervise 契约；goal 取 task；resources 逐环登记成租约）
 *   · 四档共有   → `spawn` 在 mode 校验后统一读的 task / depends_on
 *  ⚠️ 本表**过报**（说某档读、其实代码已不读）比漏报更危险：那样会把该拒的调用放过去。
 *  那一格由「自有键一律不误伤」+ 各档既有判卷共同兜，改读集时两侧都要动。 */
export const SPAWN_MODE_ARG_READS: Readonly<Record<SpawnMode, readonly SpawnArgKey[]>> = Object.freeze({
  read: Object.freeze<readonly SpawnArgKey[]>(["mode", "task", "depends_on", "resources", "context", "model", "max_turns", "tier", "role"]),
  write: Object.freeze<readonly SpawnArgKey[]>(["mode", "task", "depends_on", "resources", "context", "model", "max_turns", "tier", "role"]),
  pipeline: Object.freeze<readonly SpawnArgKey[]>(["mode", "task", "depends_on", "resources", "stages"]),
  supervise: Object.freeze<readonly SpawnArgKey[]>(["mode", "task", "depends_on", "resources", "supervise"]),
});

/** 按 `SPAWN_MODES` 的字面顺序排（不是字母序）：拒绝语里点名的档序要跟模型在规格里看到的序一致。 */
const MODE_ORDER: readonly SpawnMode[] = ["read", "write", "pipeline", "supervise"];

export interface SpawnArgSurface {
  /** 申报了、但这一档压根不读的键（升序）。 */
  dropped: string[];
  /** 连 `SpawnArgs` 里都没有的键（模型笔误或发明，如 `agent_type`）。 */
  unknown: string[];
  /** 本档读的键（模型可见提示用）。 */
  reads: readonly SpawnArgKey[];
  /** 合法顶层键清单（顺序 = 实现里声明的序）。 */
  legalKeys: readonly SpawnArgKey[];
  /** 读某个键的那几档（按 MODE_ORDER；空 = 谁都不读）。 */
  readers(key: string): SpawnMode[];
  /** 给模型看的那一句；两侧都干净 ⇒ null。 */
  message(): string | null;
}

/** 只数**申报出来**的键：值为 undefined 不算申报
 *  （`{...respawnArgs, depends_on: undefined}` 这类展开很常见，把它当申报就是凭空拒一次合法调用）。 */
function declaredKeys(args: Record<string, unknown>): string[] {
  return Object.keys(args).filter((k) => args[k] !== undefined);
}

export function unconsumedSpawnArgs(mode: string, args: SpawnArgs | Record<string, unknown>): SpawnArgSurface {
  const m = (MODE_ORDER as readonly string[]).includes(mode) ? (mode as SpawnMode) : null;
  const reads: readonly SpawnArgKey[] = m === null ? [] : SPAWN_MODE_ARG_READS[m];
  const readSet = new Set<string>(reads);
  const known = new Set<string>(SPAWN_ARG_KEYS);
  const declared = declaredKeys(args as Record<string, unknown>);
  const dropped = declared.filter((k) => known.has(k) && !readSet.has(k)).sort();
  const unknown = declared.filter((k) => !known.has(k)).sort();
  const readers = (key: string): SpawnMode[] =>
    MODE_ORDER.filter((mm) => (SPAWN_MODE_ARG_READS[mm] as readonly string[]).includes(key));
  const message = (): string | null => {
    if (m === null || (dropped.length === 0 && unknown.length === 0)) return null;
    const bits = dropped.map((k) => {
      const who = readers(k);
      return who.length === 1 ? k + "（改用它：mode=" + who[0] + "）" : k + "（这几档才读：" + who.join("|") + "）";
    });
    if (unknown.length > 0) bits.push("未知参数 " + unknown.join("、") + "（合法：" + SPAWN_ARG_KEYS.join("/") + "）");
    return (
      "spawn_agent: mode=" + m + " 不读这些参数，申报了会被整支丢弃 ⇒ 已拒绝：" + bits.join("；") +
      "。本档读：" + reads.join("|") + "。"
    );
  };
  return { dropped, unknown, reads, legalKeys: SPAWN_ARG_KEYS, readers, message };
}
