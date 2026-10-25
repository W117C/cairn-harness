import type { PermissionMode } from "../../../../src/main/ipc-protocol";
import { STR } from "./strings";
export const MODE_LABEL: Record<PermissionMode, { label: string; desc: string; warn?: boolean }> = {
  "read-only": { label: STR.permissionModes.readOnly, desc: STR.permissionModes.readOnlyDesc },
  default: { label: STR.permissionModes.default, desc: STR.permissionModes.defaultDesc },
  guided: { label: STR.permissionModes.guided, desc: STR.permissionModes.guidedDesc },
  // 「全部放行」是**名不副实**的旧文案：MODE_POLICY 里 auto 是 `writeAsk:false` 而
  // `riskAskAt:"high"`（permissions/autonomy.ts:154）——它免的是"逐笔问写"这一层，
  // 风险 ≥ high 的动作（沙箱降级时的写向、出网、critical）照样送审。
  // 业主实测 2026-10-16 因此以为切换失效。文案改成它真的做的事。
  auto: { label: STR.permissionModes.auto, desc: STR.permissionModes.autoDesc, warn: true },
  // 完全允许（2026-10-24 业主）：连风险线/critical 的审批卡都没有——本仓真正的最松档。
  "full-access": { label: STR.permissionModes.fullAccess, desc: STR.permissionModes.fullAccessDesc, warn: true },
};
