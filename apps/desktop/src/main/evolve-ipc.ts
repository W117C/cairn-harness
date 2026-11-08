import { buildEvolveReport } from "../../../../src/main/evolve/report";
import { activatePlaybookEntry, dormantPlaybookEntry } from "../../../../src/main/evolve/activation";
import { reactivateGlobalExperience, revokeGlobalExperience } from "../../../../src/main/evolve/globalize";
import { setGlobalEvolveFrozen } from "../../../../src/main/evolve/global-playbook-store";
import { setEvolveFrozen } from "../../../../src/main/evolve/governance";

export function createEvolveIpcHandlers(resolveWorkspace: () => string) {
  return {
    evolveReport: () => buildEvolveReport(resolveWorkspace()),
    evolveSetFrozen: async (frozen: unknown) => {
      const workspace = resolveWorkspace();
      await setEvolveFrozen(workspace, frozen === true);
      return buildEvolveReport(workspace);
    },
    evolveActivate: async (id: unknown) => {
      const workspace = resolveWorkspace();
      if (typeof id !== "string" || id.trim().length === 0) {
        return { ok: false, reason: "经验 id 必填", report: await buildEvolveReport(workspace) };
      }
      const result = await activatePlaybookEntry(workspace, id, { apply: true });
      const report = await buildEvolveReport(workspace);
      if (result.outcome === "activated" || result.outcome === "already-active") {
        return { ok: true, report };
      }
      if (result.outcome === "refused") {
        return {
          ok: false,
          reason: result.blockers.map((blocker) => blocker.code + "：" + blocker.detail).join("；"),
          report,
        };
      }
      return {
        ok: false,
        reason: result.outcome === "frozen" ? "STOP 冻结中：不激活" : "未应用",
        report,
      };
    },
    evolveDormant: async (id: unknown) => {
      const workspace = resolveWorkspace();
      if (typeof id !== "string" || id.trim().length === 0) {
        return { ok: false, reason: "经验 id 必填", report: await buildEvolveReport(workspace) };
      }
      const result = await dormantPlaybookEntry(workspace, id, { apply: true });
      const report = await buildEvolveReport(workspace);
      if (result.outcome === "dormant") return { ok: true, report };
      if (result.outcome === "refused") return { ok: false, reason: result.reason, report };
      return {
        ok: false,
        reason: result.outcome === "frozen" ? "STOP 冻结中：不转休眠" : "未应用",
        report,
      };
    },
    evolveGlobalRevoke: async (id: unknown) => {
      const workspace = resolveWorkspace();
      if (typeof id !== "string" || id.trim().length === 0) {
        return { ok: false, reason: "全局经验 id 必填", report: await buildEvolveReport(workspace) };
      }
      const result = await revokeGlobalExperience(id, { apply: true }).catch((err: unknown) => ({
        outcome: "refused" as const,
        reason: err instanceof Error ? err.message : String(err),
      }));
      const report = await buildEvolveReport(workspace);
      if (result.outcome === "revoked") return { ok: true, report };
      if (result.outcome === "refused") return { ok: false, reason: result.reason, report };
      return {
        ok: false,
        reason: result.outcome === "frozen" ? "全局 STOP 冻结中：不撤销" : "未应用",
        report,
      };
    },
    evolveGlobalSetFrozen: async (frozen: unknown) => {
      await setGlobalEvolveFrozen(frozen === true);
      return buildEvolveReport(resolveWorkspace());
    },
    evolveGlobalActivate: async (id: unknown) => {
      const workspace = resolveWorkspace();
      if (typeof id !== "string" || id.trim().length === 0) {
        return { ok: false, reason: "全局经验 id 必填", report: await buildEvolveReport(workspace) };
      }
      const result = await reactivateGlobalExperience(id, { apply: true }).catch((err: unknown) => ({
        outcome: "refused" as const,
        reason: err instanceof Error ? err.message : String(err),
      }));
      const report = await buildEvolveReport(workspace);
      if (result.outcome === "reactivated") return { ok: true, report };
      if (result.outcome === "refused") return { ok: false, reason: result.reason, report };
      return {
        ok: false,
        reason: result.outcome === "frozen" ? "全局 STOP 冻结中：不恢复" : "未应用",
        report,
      };
    },
  };
}
