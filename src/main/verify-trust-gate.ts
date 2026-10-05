// verify 命令的信任门接线（S3 那一环缺的那一半，2026-10-05 业主批准的形状）。
//
// 形状：**一把现成的信任表 + 一条现成的审批卡通道**，不新写第二份信任事实源。
//  · 表 = `src/agent/plugins/trust.ts` 的 `TrustStore`（插件 hook/MCP 用的同一个类、同一份持久化文件），
//    条目形状 `abs@内容指纹` 与「换内容就换一个键」的绑定关系全部复用，这里只把第一维换成
//    `verifyTrustKey(repoDir)`（域标签见 verify-trust.ts 那段注释）。
//  · 卡 = `src/main/ask-gate.ts` 的 `AskGate`（`gatedTool` 走的那条审批通道；UI 侧 `agent:decide`
//    与 `handleAgentDecide` 原样够用，不新增 IPC 通道、不新增事件类型）。
//
// 三条边界（逐条住在实现里，判卷 tests/verify-trust-fingerprint.test.ts 逐格钉行为）：
//  ⑴ 只有**人明确批准**才写表。拒／超时／取消／无人值守都不写——那几种都不是人的决议，
//     记成永久拒绝会把「用户后来想批」这条路一起堵死（下次还会问，问法与第一次一样）。
//  ⑵ 非交互／无人值守**不发卡**。AskGate 的 unattended 门自己就是立即拒绝（§12.2.4），
//     这里再挡一道：门被配错也不该在没人看的通道上悬一张 60s 的卡。拿不到门（null）同样直接拒，
//     口径与 `gatedTool` 那句「工具门未接线（fail-closed）」一致。
//  ⑶ 批准了但**写不进表**：这一拍照跑（人确实说了可以），并出声说下次还会再问——
//     不许静默把「没落盘的批准」当成永久免问的依据。
import type { TrustStore } from "../agent/plugins/trust";
import { verifyTrustKey, type VerifyTrustRequest, type VerifyTrustResolver } from "../agent/verify-trust";
import type { AskGate } from "./ask-gate";

/** 审批卡的工具名位（`AskRequest.tool` 允许运行时注入的展示串，见 ask-gate.ts:9 那条注释）：
 *  它不是 `ToolName` 键域里的工具，也不走权限管线，只是这张卡的归属标识。 */
export const VERIFY_TRUST_CARD = "verify_trust";

export interface VerifyTrustGateDeps {
  /** 现成那份信任表（与插件信任同一个实例口径：同一个 `TrustStore` 类、同一份文件）。 */
  trustStore: TrustStore;
  /** 本场 run 的审批门；null = 非交互 ⇒ 不发卡，直接 fail-closed 拒。 */
  askGate: AskGate | null;
  /** M4a 无人值守（§12.2.4）：连问都不问——不许在没人接的通道上悬一张卡。 */
  unattended?: boolean;
}

/** 把「(repoDir, verify 面内容) 查表 → 查不到就问人 → 批准才登记」组成钩子认得的那个口。 */
export function createVerifyTrustGate(deps: VerifyTrustGateDeps): VerifyTrustResolver {
  const keyOf = (req: VerifyTrustRequest): string => verifyTrustKey(req.repoDir);
  return {
    async isTrusted(req) {
      // 只认「这条 (目录, 内容) 被批准过」。declined 在本门不产生（见文件头 ⑴），
      // 因此不问自答的那条路只有 trusted 一种，不必在这里再判一遍「什么算拒绝」。
      return (await deps.trustStore.status(keyOf(req), req.fingerprint)) === "trusted";
    },
    async requestTrust(req) {
      if (deps.askGate === null || deps.unattended === true) return false; // fail-closed，且不发卡
      const r = await deps.askGate.request(
        VERIFY_TRUST_CARD,
        { repoDir: req.repoDir, fingerprint: req.fingerprint, commands: [...req.commands] },
        {
          reason:
            "自动验证拍要执行**仓库自带**的验证命令（来自 " +
            (req.provenance === "repo-config" ? ".agent/config.json" : "package.json / Makefile 等探测面") +
            "）。批准 = 这批命令可以在这个仓里被自动执行（同一份内容以后再问一次都不用；" +
            "命令面一改就会重新出这张卡）。不批 = 这一拍不验，你自己用 run_shell 跑。",
          risk: "high",
          riskReasons: ["执行仓库自带内容里的任意命令", "不经过 shell 威胁表与网络审批通道"],
          signal: req.signal,
        },
      );
      if (r.outcome !== "approved") return false;
      try {
        // 批准才记账：条目 = `repoDir#verify@面内容指纹`（内容绑定由 TrustStore 那一维兑现）。
        await deps.trustStore.decide(keyOf(req), true, req.fingerprint);
      } catch (err) {
        // 这一拍照跑（人说了可以），但下次还得问：内存不冒充已落盘的决议。
        console.warn(
          "[verify] 信任决议没能写进信任表，下一次仍然会问:",
          err instanceof Error ? err.message : String(err),
        );
      }
      return true;
    },
  };
}
