// 第 4 档 `guided`（judgment-layer §7 第 1 步 / gap-fix P1-4）。
//
// 裁决口径（用户拍「造中间档，默认档不动」）：guided 只拆掉「每一笔写向都要问」这一条，
// 风险线从 auto 的 high 抬到 medium——于是三档对同一格的答案必须各不相同，
// 本文件的判据就钉在那些分歧格上（同答的输入证明不了任何事）。
//
// 一句话政策：写向不逐笔问；medium 及以上风险问；critical / L0 三条硬边界 / deny·ask 规则 /
// MCP 未注解 fail-closed 全部照旧；「本会话允许这类」仍生效，断路器触发后退回逐次审批。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AGENT_PERMISSION_MODES, type AgentPermissionMode } from "../src/events";
import {
  checkPermission,
  evaluate,
  modePolicyTable,
  newAutonomySession,
  scopeKey,
  sideEffectDecisionTable,
  toolTableFor,
  type AutonomySession,
  type PermissionMode,
  type PermissionRule,
} from "../src/permissions";
import { PERMISSION_MODES, permissionModeRank } from "../src/permissions/modes";
import { clampTier } from "../src/agent/worker-report";
import { createGatedRemember } from "../src/main/agent-runner";
import { ARMS } from "../scripts/replay/ask-density";

function session(init: Partial<AutonomySession> = {}): AutonomySession {
  const s = newAutonomySession(init.mode ?? "guided", {
    rules: init.rules ?? [],
    sandboxAvailable: init.sandboxAvailable ?? null,
    sessionScopes: (init.sessionScopes as Set<string>) ?? new Set<string>(),
    frozenJudgePaths: (init.frozenJudgePaths as Set<string>) ?? new Set<string>(),
  });
  s.planBlocked = init.planBlocked ?? (() => false);
  return s;
}

const JUDGE = "tests/todo.test.ts";
/** risk=none 的写向（staticRisk 对 write_file 无条目）。 */
const WRITE = { tool: "write_file" as const, args: { path: "src/a.ts", content: "x" } };
/** risk=medium 的写向（威胁表之外的「写向操作」底线）。 */
const EDIT = { tool: "edit_file" as const, args: { path: "src/a.ts", oldText: "a", newText: "b" } };

describe("档位集合：guided 插在 default 与 auto 之间（松紧序单调）", () => {
  it("四档按松紧序 = read-only < default < guided < auto，名次连续无空洞", () => {
    expect(PERMISSION_MODES).toEqual(["read-only", "default", "guided", "auto"]);
    expect(PERMISSION_MODES.map(permissionModeRank)).toEqual([0, 1, 2, 3]);
  });

  it("events 的抄本跟着涨（漏改即类型层崩，这条是运行时对账）", () => {
    expect(AGENT_PERMISSION_MODES).toEqual(PERMISSION_MODES);
  });

  it("粗档裁决表有 guided 一行，且它不等于 default 那一行（否则新档是第二份默认档）", () => {
    const table = sideEffectDecisionTable();
    expect(Object.keys(table).sort()).toEqual([...PERMISSION_MODES].sort());
    expect(table.guided).toBe("allow");
    expect(table.guided).not.toBe(table.default);
    expect(checkPermission("guided", "write_file")).toBe("allow");
    expect(checkPermission("guided", "read_file")).toBe("allow");
  });
});

describe("modePolicyTable：档位政策只此一份表，缺档编译不过", () => {
  it("每档三字段齐全，且 guided 的风险线严格介于 default 与 auto 之间", () => {
    const t = modePolicyTable();
    expect(Object.keys(t).sort()).toEqual([...PERMISSION_MODES].sort());
    for (const m of PERMISSION_MODES) {
      expect(typeof t[m].writeAsk).toBe("boolean");
      expect(typeof t[m].scopeMemory).toBe("boolean");
      expect(["none", "low", "medium", "high", "critical"]).toContain(t[m].riskAskAt);
    }
    expect(t.default.writeAsk).toBe(true);
    expect(t.guided.writeAsk).toBe(false);
    expect(t.auto.writeAsk).toBe(false);
    expect(t.guided.scopeMemory).toBe(true);
    expect(t.auto.scopeMemory).toBe(false);
    expect(t.guided.riskAskAt).toBe("medium");
    expect(t.auto.riskAskAt).toBe("high");
  });
});

describe("evaluate 在 guided：与 default / auto 的分歧格", () => {
  it("低风险写向：default 出卡 L3-mode，guided 放行 L4-pass，auto 亦放行", () => {
    expect(evaluate(WRITE.tool, WRITE.args, session({ mode: "default" }))).toMatchObject({ verdict: "ask", layer: "L3-mode" });
    expect(evaluate(WRITE.tool, WRITE.args, session({ mode: "guided" }))).toMatchObject({ verdict: "approve", layer: "L4-pass" });
    expect(evaluate(WRITE.tool, WRITE.args, session({ mode: "auto" }))).toMatchObject({ verdict: "approve", layer: "L4-pass" });
  });

  it("medium 风险写向（edit_file）：auto 放行，guided 出卡 L4-risk，default 出卡 L3-mode", () => {
    expect(evaluate(EDIT.tool, EDIT.args, session({ mode: "auto" }))).toMatchObject({ verdict: "approve", layer: "L4-pass" });
    expect(evaluate(EDIT.tool, EDIT.args, session({ mode: "guided" }))).toMatchObject({ verdict: "ask", layer: "L4-risk", risk: "medium" });
    expect(evaluate(EDIT.tool, EDIT.args, session({ mode: "default" }))).toMatchObject({ verdict: "ask", layer: "L3-mode" });
  });

  it("guided 的出卡理由说得出风险线，且不写死成「自主档」", () => {
    const d = evaluate(EDIT.tool, EDIT.args, session({ mode: "guided" }));
    expect(d.verdict).toBe("ask");
    if (d.verdict !== "ask") return;
    expect(d.reason).toContain("medium");
    expect(d.reason).not.toContain("默认档");
  });

  it("critical / 网络 medium / MCP 未注解：guided 一处都不比 auto 松", () => {
    expect(evaluate("run_shell", { command: "rm -rf ~" }, session({ mode: "guided" }))).toMatchObject({ verdict: "ask", layer: "L4-critical" });
    expect(evaluate("run_shell", { command: "curl http://api.example.com" }, session({ mode: "guided" }))).toMatchObject({ verdict: "ask" });
    expect(evaluate("mcp__srv__do" as never, {}, session({ mode: "guided" }))).toMatchObject({ verdict: "ask", layer: "L4-mcp-unannotated" });
  });

  it("L0/L1/L2 与 allow 规则在 guided 全部照旧（新档不复活被硬闸摘掉的动作）", () => {
    const denyRule: PermissionRule[] = [{ behavior: "deny", tool: "run_shell", pattern: "rm", scope: "always", id: "deny:run_shell:rm#1" }];
    const askRule: PermissionRule[] = [{ behavior: "ask", tool: "run_shell", pattern: "git push", scope: "always", id: "ask:run_shell:git push#1" }];
    expect(evaluate("write_file", { path: "a.ts" }, session({ mode: "guided", planBlocked: () => true }))).toMatchObject({ verdict: "deny", layer: "L0-hard" });
    expect(evaluate("write_file", { path: JUDGE }, session({ mode: "guided", frozenJudgePaths: new Set([JUDGE]) }))).toMatchObject({ verdict: "deny", layer: "L0-hard" });
    expect(evaluate("run_shell", { command: "rm x.txt" }, session({ mode: "guided", rules: denyRule }))).toMatchObject({ verdict: "deny", layer: "L1-deny" });
    expect(evaluate("run_shell", { command: "git push origin" }, session({ mode: "guided", rules: askRule }))).toMatchObject({ verdict: "ask", layer: "L2-ask-rule" });
  });

  it("allow 规则批不掉 critical：guided 与 auto 同层同判", () => {
    const mk = (mode: AgentPermissionMode) =>
      evaluate("run_shell", { command: "rm -rf /" }, session({
        mode,
        rules: [{ behavior: "allow", tool: "run_shell", pattern: "rm", scope: "always", id: "allow:run_shell:rm#1" }],
      }));
    expect(mk("guided")).toMatchObject({ verdict: "ask", layer: "L4-critical" });
    expect(mk("auto")).toMatchObject({ verdict: "ask", layer: "L4-critical" });
  });
});

describe("guided 的会话记忆与断路器（卡在 guided 不是静默无效的第二份形状）", () => {
  it("本会话已记此类 ⇒ guided 放行 L3-scope；网络类命令不吃这条快捷", () => {
    const s = session({ mode: "guided", sessionScopes: new Set([scopeKey("edit_file", EDIT.args)]) });
    expect(evaluate(EDIT.tool, EDIT.args, s)).toMatchObject({ verdict: "approve", layer: "L3-scope" });
    const key = scopeKey("run_shell", { command: "curl http://api.example.com" });
    const net = session({ mode: "guided", sessionScopes: new Set([key]) });
    expect(evaluate("run_shell", { command: "curl http://api.example.com" }, net)).toMatchObject({ verdict: "ask" });
  });

  it("断路器触发后 guided 退回逐次审批（默认档同一条出口，自主档不受影响）", () => {
    const mk = (mode: PermissionMode): AutonomySession => {
      const s = session({ mode, sessionScopes: new Set([scopeKey("write_file", WRITE.args)]) });
      s.breakerTripped = true;
      return s;
    };
    const g = evaluate("write_file", WRITE.args, mk("guided"));
    expect(g).toMatchObject({ verdict: "ask", layer: "L3-mode" });
    if (g.verdict === "ask") expect(g.reason).toContain("断路器");
    expect(evaluate("write_file", WRITE.args, mk("auto"))).toMatchObject({ verdict: "approve", layer: "L4-pass" });
    expect(evaluate("write_file", WRITE.args, mk("default"))).toMatchObject({ verdict: "ask", layer: "L3-mode" });
  });

  it("只读档不受新档影响：写向仍 L0-hard deny", () => {
    expect(evaluate(WRITE.tool, WRITE.args, session({ mode: "read-only" }))).toMatchObject({ verdict: "deny", layer: "L0-hard" });
  });

  it("guided 的工具表不摘写向工具（只有只读档摘）", () => {
    expect(toolTableFor("guided")).toEqual(toolTableFor("default"));
    expect(toolTableFor("guided").length).toBeGreaterThan(toolTableFor("read-only").length);
  });
});

describe("表外档位仍然 fail-closed（新档不能把「缺行即放行」带回来）", () => {
  it("未知 mode 走默认档政策：写向逐次审批，不是静默放行", () => {
    const ghost = session({ mode: "default" });
    ghost.mode = "yolo-ish" as PermissionMode;
    expect(evaluate(WRITE.tool, WRITE.args, ghost)).toMatchObject({ verdict: "ask", layer: "L3-mode" });
    expect(checkPermission("yolo-ish" as PermissionMode, "write_file")).toBe("ask");
  });
});

describe("clampTier 与档位名次（worker 不可提权，新档占中间格）", () => {
  it("父档 default 拒住 guided 子档；父档 guided 拒住 auto 子档", () => {
    expect(clampTier("guided", "default")).toEqual({ mode: "default", clamped: true, warning: expect.stringContaining("guided") });
    expect(clampTier("auto", "guided")).toEqual({ mode: "guided", clamped: true, warning: expect.stringContaining("guided") });
    expect(clampTier("default", "guided")).toEqual({ mode: "default", clamped: false });
    expect(clampTier("guided", "guided").warning).toBeUndefined();
  });

  it("名次只有一份：clampTier 读的序就是 PERMISSION_MODES 的序（不再有第二张数字表）", () => {
    const src = readFileSync(new URL("../src/agent/worker-report.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/TIER_ORDER\s*:\s*Record<AgentPermissionMode,\s*number>\s*=\s*\{/);
    expect(src).toContain("permissionModeRank");
  });
});

describe("复跑面与设置面对账（新档没人量、没人选 = 造了个不存在的档）", () => {
  it("ask-density 的臂覆盖每一档", () => {
    expect(new Set(ARMS.map((a) => a.mode))).toEqual(new Set(PERMISSION_MODES));
  });

  it("渲染层两处档位入口（权限看板 + 设置页）与档位集合同集合", () => {
    const appSrc = readFileSync(new URL("../src/renderer/app.js", import.meta.url), "utf8");
    const htmlSrc = readFileSync(new URL("../src/renderer/index.html", import.meta.url), "utf8");

    const mapStart = appSrc.indexOf("const PERM_MAP = {");
    expect(mapStart).toBeGreaterThanOrEqual(0);
    const mapBody = appSrc.slice(mapStart, appSrc.indexOf("};", mapStart));
    const mapped = [...mapBody.matchAll(/:\s*'([^']+)'/g)].map((m) => m[1]).sort();
    expect(mapped).toEqual([...PERMISSION_MODES].sort());

    const rowStart = htmlSrc.indexOf('<div class="set-choice" data-setting="mode">');
    expect(rowStart).toBeGreaterThanOrEqual(0);
    const row = htmlSrc.slice(rowStart, htmlSrc.indexOf("</div></div>", rowStart));
    const vals = [...row.matchAll(/data-val="([^"]+)"/g)].map((m) => m[1]).sort();
    expect(vals).toEqual([...PERMISSION_MODES].sort());
  });
});
