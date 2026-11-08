// 权限档位的**唯一事实源**（dep-free：main 的 settings、编排的 clampTier、renderer 的对账判卷都能廉价导入）。
//
// 立这只文件的理由是本仓点过名的一类腐：同一个字面集合抄了五份
// （permissions 的 `PermissionMode`、events 的 `AgentPermissionMode`、settings 的同名 union、
// `TriggerMode`、`tierToMode` 的返回类型），于是"加一档"这件事从来不会叫住任何人——
// 最坏的一处是 `checkPermission` 以 `return "allow"` 收尾：**任何未列出的档位值都静默拿到"全放行"**。
// 现在集合只在这儿一份，档位→裁决是 `Record<PermissionMode, Decision>` 表（少一行编译不过，见 index.ts）。
export const PERMISSION_MODES = ["read-only", "default", "guided", "auto", "full-access"] as const;

/** 用户在设置页/权限菜单里能选到的四档（2026-11-03 业主：引导与自动两档文案重叠，
 *  合并成一个「智能审批」入口）。`guided` 仍留在 PERMISSION_MODES 里只为**兼容旧配置与
 *  旧事件**（clampTier / 回放要认得历史值）；它不再出现在任何选择面，也不再是「下一档」
 *  循环的一站。合并后的智能审批用 `auto` 这个持久化 id——选它不会把旧档案的档位悄悄改写。 */
export const SELECTABLE_PERMISSION_MODES = ["read-only", "default", "auto", "full-access"] as const;

/** 顺序即松紧序（worker 的 `clampTier` 依赖"子档不宽于父档"这个单调序），**别重排**。
 *  `guided` 是 §7 第 1 步落的中间档（2026-09-23）：只拆「每一笔写向都要问」这一条，
 *  风险线反而比 auto 严（medium vs high）——插入位置即语义。2026-11-03 起只作旧值保留。
 *  `full-access`（2026-11-03 业主裁决）：真正的最松档——除**判卷面冻结闸**外不再有任何
 *  拦截：方案门、deny/ask 规则、断路器、风险线、critical、未登记工具、出网全部放行。
 *  保留判卷面冻结闸的唯一理由：它护的是评测文件完整性，不是「这次操作要不要人点头」，
 *  放开它等于让 agent 改自己的考卷（`tests/full-access-autonomy.test.ts` 钉住这一格）。 */
export type PermissionMode = (typeof PERMISSION_MODES)[number];

/** 选择面用的四档（旧 `guided` 归到「智能审批」那一格显示，不新增一枚入口）。 */
export function selectablePermissionMode(mode: PermissionMode): (typeof SELECTABLE_PERMISSION_MODES)[number] {
  return mode === "guided" ? "auto" : mode;
}

/** 运行时判别（IPC/设置文件/模型自报 tier 三条入口共用一只，别各写一份 `||` 链）。 */
export function isPermissionMode(v: unknown): v is PermissionMode {
  return typeof v === "string" && (PERMISSION_MODES as readonly string[]).includes(v);
}

/** 档位在松紧序里的名次（未知值排最松侧之外 = -1，调用方须自己处理，不许当作 0）。 */
export function permissionModeRank(mode: PermissionMode): number {
  return PERMISSION_MODES.indexOf(mode);
}

/** 「下一档」循环（命令面板 / 快捷键用）：在选择面的四档里循环；未知值从第一档开始。
 *  这是「加一档」时唯一会叫住这些入口的地方——UI 里再抄一份顺序，第五档就会像 2026-10-30
 *  实测那样永远轮不到（命令面板只抄了四档）。
 *  2026-11-03 起 `guided` 已不是选择档：从旧配置的 guided 起跳先落到「智能审批」（auto），
 *  不把用户带回一个界面上看不见的档位。 */
export function nextPermissionMode(current: PermissionMode): PermissionMode {
  if (current === "guided") return "auto";
  const i = SELECTABLE_PERMISSION_MODES.indexOf(current as (typeof SELECTABLE_PERMISSION_MODES)[number]);
  return SELECTABLE_PERMISSION_MODES[(i + 1) % SELECTABLE_PERMISSION_MODES.length]!;
}
