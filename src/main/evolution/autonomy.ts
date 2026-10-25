// 自治分级（SEMA Phase 4 · 批次 C1）：进化平面从「全量人工档」放开到「低风险自动档」的裁决层。
//
// 定级（docs/sema-proposal.md §7 Phase 4「按风险等级放开自动安装」）：
//  · `manual`（缺省）：一切安装都要 approvedBy——Phase 2 落地的 v1 行为，零变化；
//  · `gated-auto`：**零权限 content-pack** 可免人工装（门全绿 + canary 观察期照开）；
//    tool / desktop-panel / 任何带 permissions 的包**仍全量人工**——能执行代码、能碰盘、
//    能上桌面的面，自动化的收益抵不过一次错装的代价。
//
// 纪律：
//  · **fail-closed 缺省**：文件缺失 / 坏 JSON / 未知档 ⇒ manual。自治是显式开出来的，不是默认的；
//  · **TCB 不自改**：这份档位文件住 `modules/autonomy.json`（控制平面自管的家当，与 grants.json
//    同居），模型产出的提案**不经手它**——放开自治的开关本身不在自治面里（§4 L0 的字面要求）；
//  · **装完即观察**：gated-auto 装上的每一版都立刻开 canary 观察期（assess.ts 的动作里接线）——
//    自动化的安全网是退化回滚，不是「装之前多想想」。

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { BundleManifest } from "./manifest";

export type AutonomyTier = "manual" | "gated-auto";

export const AUTONOMY_FILE = "autonomy.json";

/** 档位文件路径：<root>/modules/autonomy.json（与 grants.json / registry.jsonl 同居）。 */
export function autonomyPathFor(rootDir: string): string {
  return join(rootDir, "modules", AUTONOMY_FILE);
}

export interface AutonomyConfig {
  tier: AutonomyTier;
}

function isAutonomyConfig(value: unknown): value is AutonomyConfig {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && ((value as { tier?: unknown }).tier === "manual" || (value as { tier?: unknown }).tier === "gated-auto");
}

/** 读档位。文件缺失 = manual（首启正常静默）；坏 JSON / 形状不对 = manual 且经 onCorrupt 出声
 *  （fail-closed：读不动不许折成「维持原档」——那会把「档位文件坏了」静默成「还开着自动档」
 *  或反过来，两个方向都不许）。 */
export async function loadAutonomy(
  rootDir: string,
  onCorrupt: (reason: string) => void = (reason) => console.warn("[autonomy] " + reason),
): Promise<AutonomyConfig> {
  try {
    const raw = JSON.parse(await readFile(autonomyPathFor(rootDir), "utf8")) as unknown;
    if (!isAutonomyConfig(raw)) {
      throw new Error("tier 不在取值域（manual / gated-auto）");
    }
    return raw;
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
      onCorrupt("自治档位文件读不动，已按 manual 继续（fail-closed）：" + autonomyPathFor(rootDir) + "：" + (err instanceof Error ? err.message : String(err)));
    }
    return { tier: "manual" };
  }
}

export interface AutoInstallEligibility {
  eligible: boolean;
  reason: string;
}

/** 一个 staged 包在当前档位下可否免人工安装（纯函数；裁决的单一出口，assess 与未来的
 *  安装入口共用这一份，不各抄一遍）。eligible = 档位开 + content-pack + 零权限。 */
export function autoInstallEligible(manifest: Pick<BundleManifest, "kind" | "permissions">, tier: AutonomyTier): AutoInstallEligibility {
  if (tier === "manual") {
    return { eligible: false, reason: "档位 manual：一切安装都要 approvedBy（Phase 2 的 v1 行为）" };
  }
  if (manifest.kind !== "content-pack") {
    return { eligible: false, reason: "gated-auto 只放零权限 content-pack（" + manifest.kind + " 仍全量人工）" };
  }
  if (manifest.permissions.length > 0) {
    return { eligible: false, reason: "带权限声明的包不进自动档（" + manifest.permissions.join("、") + "）" };
  }
  return { eligible: true, reason: "gated-auto + 零权限 content-pack：门全绿即可自动安装并开观察期" };
}
