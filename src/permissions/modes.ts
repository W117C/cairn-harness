// 权限档位的**唯一事实源**（dep-free：main 的 settings、编排的 clampTier、renderer 的对账判卷都能廉价导入）。
//
// 立这只文件的理由是本仓点过名的一类腐：同一个字面集合抄了五份
// （permissions 的 `PermissionMode`、events 的 `AgentPermissionMode`、settings 的同名 union、
// `TriggerMode`、`tierToMode` 的返回类型），于是"加一档"这件事从来不会叫住任何人——
// 最坏的一处是 `checkPermission` 以 `return "allow"` 收尾：**任何未列出的档位值都静默拿到"全放行"**。
// 现在集合只在这儿一份，档位→裁决是 `Record<PermissionMode, Decision>` 表（少一行编译不过，见 index.ts）。
export const PERMISSION_MODES = ["read-only", "default", "guided", "auto", "full-access"] as const;

/** 顺序即松紧序（worker 的 `clampTier` 依赖"子档不宽于父档"这个单调序），**别重排**。
 *  `guided` 是 §7 第 1 步落的中间档（2026-09-23）：只拆「每一笔写向都要问」这一条，
 *  风险线反而比 auto 严（medium vs high）——插入位置即语义。
 *  `full-access`（2026-10-24 业主）：最松档——不再有任何审批卡（L2 ask 规则/断路器/风险线/
 *  critical 全部放行）；硬边界保留（L0 方案门/判卷面冻结闸、L1 deny 规则）。
 *  出网例外：§11.4 红线（网络放行永不免批）⇒ 网络命令仍走一次性批准。 */
export type PermissionMode = (typeof PERMISSION_MODES)[number];

/** 运行时判别（IPC/设置文件/模型自报 tier 三条入口共用一只，别各写一份 `||` 链）。 */
export function isPermissionMode(v: unknown): v is PermissionMode {
  return typeof v === "string" && (PERMISSION_MODES as readonly string[]).includes(v);
}

/** 档位在松紧序里的名次（未知值排最松侧之外 = -1，调用方须自己处理，不许当作 0）。 */
export function permissionModeRank(mode: PermissionMode): number {
  return PERMISSION_MODES.indexOf(mode);
}
