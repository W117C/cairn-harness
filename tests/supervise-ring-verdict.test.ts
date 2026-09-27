// supervise 环的**判据来源**：写过的环只认机器凭据，没写过的环才认它的 verdict 契约行。
//
// 现场（真语料 outputs/ga-strategy-2026-09-20{,-rep2,-rep3}/supervise.events.jsonl，2026-09-24 逐笔读到）：
// 三次复跑**全部**死在同一句 `[supervisor] 环 1/6（done，verdict=unspecified）→ escalate：report 畸形（verdict 不可解析）`，
// 而 worker-4 的 `agent_result` 是 `status=done` + `files_changed=[src/cart.js, src/shipping.js, src/totals.js]`
// ——三处计价 bug 都真改对了。紧接着 `wt-cleanup-worker-4 … 已清理（rejected）` 把 worktree 和分支删了，
// 然后才回去问人。裁决发生在证据已被销毁之后。
// 为什么必然发生（不是模型不听话）：`verdict:` 行只写进了 **review/test** 两个角色的任务书
// （`sequencer.ts` 的内置角色面），而 supervise 的 `nextRole` 恒为 `"implement"`，implement 的任务书
// 只要求「改了什么 / 为什么 / 验证方式 / 风险」——**没有 verdict 行可解析**。所以 `parseVerdict` 在这一条路上
// 恒返回 `unspecified`，`decideSupervisor` 的畸形分支 100% 触发。
// 还有一条更贵的：同一个畸形分支的反面是 `verdict === "pass" → accept`，而 pass 今天**只来自散文**——
// 模型在报告里写一行 `verdict: pass` 就能让 harness 把它的 worktree 合并进用户真实工作区。
// 本仓自己的注释已经判过这件事：`orchestrator.ts` 的 sequencer 段写着「模型自报的 verdict 不算判据
// （自己给自己打分）」；supervise 审批卡的风险理由里写的也是「实现→**客观判据**→失败重试/升级/中止」。
// ⇒ 这轮把判据来源换成机器凭据（`artifacts.verified`，W4b 四态，纯投影自 worker 自己的子流），
//   散文契约行只在「这个环根本没写过盘」（read 角色，不会有验证拍）时才采信。
import { describe, expect, it } from "vitest";
import { decideSupervisor, ringVerdict } from "../src/agent/supervisor";

describe("supervise 环判据来源：机器凭据优先，散文只在无写盘时算数", () => {
  it(
    "写过盘且凭据绿（verified）⇒ pass，报告里没有 verdict 行也成立——今日实现在这一格必然 escalate",
    () => {
      expect(ringVerdict({ evidence: "verified", prose: "unspecified", forbiddenViolated: false })).toBe("pass");
    },
  );

  it(
    "凭据红（failed）⇒ fail，哪怕报告自报 verdict: pass——散文不得顶机器",
    () => {
      expect(ringVerdict({ evidence: "failed", prose: "pass", forbiddenViolated: false })).toBe("fail");
    },
  );

  it(
    "凭据过期（stale）⇒ null：绿拍之后又写了盘，那份证据已失效，不静默猜",
    () => {
      expect(ringVerdict({ evidence: "stale", prose: "pass", forbiddenViolated: false })).toBeNull();
    },
  );

  it(
    "凭据缺席（absent）⇒ 回落到散文契约行：无 verify 面的仓库里散文是唯一读物（本轮明写未闭的一半）",
    () => {
      expect(ringVerdict({ evidence: "absent", prose: "pass", forbiddenViolated: false })).toBe("pass");
      expect(ringVerdict({ evidence: "absent", prose: "fail", forbiddenViolated: false })).toBe("fail");
    },
  );

  it(
    "没写过盘的环（read 角色，evidence 缺席）⇒ 仍认它的 verdict 契约行，review/test 一路不变",
    () => {
      expect(ringVerdict({ evidence: undefined, prose: "pass", forbiddenViolated: false })).toBe("pass");
      expect(ringVerdict({ evidence: undefined, prose: "fail", forbiddenViolated: false })).toBe("fail");
    },
  );

  it(
    "禁改面被触碰：即使凭据是 verified 也判 fail（forbidden 硬闸不被凭据顶掉）",
    () => {
      expect(ringVerdict({ evidence: "verified", prose: "pass", forbiddenViolated: true })).toBe("fail");
      expect(ringVerdict({ evidence: undefined, prose: "pass", forbiddenViolated: true })).toBe("fail");
    },
  );

  it(
    "负控：既没凭据又没契约行 ⇒ null（escalate 这条路保留，不是把闸门焊死）",
    () => {
      expect(ringVerdict({ evidence: undefined, prose: "unspecified", forbiddenViolated: false })).toBeNull();
    },
  );

  it(
    "null 判据仍走 escalate（决策机不变），升级理由说的是「没有判据」而不是「报告畸形」",
    () => {
      const a = decideSupervisor({ verdict: null, stageCount: 1 });
      expect(a.kind).toBe("escalate");
      if (a.kind !== "escalate") return;
      expect(a.why).toContain("无判据");
      expect(a.why, "implement 角色本就没有 verdict 契约行，把它说成「畸形」是把缺陷记在模型账上").not.toContain("畸形");
    },
  );

  it(
    "越界判据（已删的「error」那一支，全仓无生产者）⇒ escalate，不再与 fail 同路烧一次重试",
    () => {
      // 旧实现把 "error" 写进取值域并让它走 retry，而 `ringVerdict` 与 `parseVerdict` 都产不出这个值
      // ⇒ 那一支永不可达，读起来却像「错误有专门通道」。删除后越界值落进畸形桶：交给人判，而不是
      // 花一次环去重试一个没人能造出来的判据。
      const retired = "error" as unknown as Parameters<typeof decideSupervisor>[0]["verdict"];
      const a = decideSupervisor({ verdict: retired, stageCount: 2, lastAgentId: "w1" });
      expect(a.kind).toBe("escalate");
    },
  );
});
