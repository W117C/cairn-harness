// M7 · 未登记工具名 fail-closed 的判卷。
//
// 分三段，**按重要性倒序**：
//   B 零回归矩阵——26 个既有工具名 × 4 档，逐格钉死改前实测读数。这一段是本笔的护栏：
//     改动的全部风险都在「正常读操作被误拒」（尤其只读 worker：orchestrator 以 read-only +
//     非交互跑，漏一个名字就罢工）。金标准取自改前实测（zcode@5e0c859），逐格点名期望值，
//     不是恒真式。
//   C/D 新守卫确实开火，且只对真正未知的名字开火（含原型污染与 MCP 豁免）。
//   E 规则优先级——显式 allow/deny/ask 规则不被这条守卫吃掉。
import { describe, expect, it } from "vitest";
import { TOOL_NAMES } from "../src/tools/base";
import { INJECTED_TOOLS } from "../src/agent/tool-surface";
import {
  WORKER_IMPACT_TOOL,
  WORKER_TOOL_TABLE,
  WRITE_WORKER_TOOL_TABLE,
} from "../src/agent/orchestrator-config";
import {
  checkPermission,
  denyReason,
  gate,
  KNOWN_TOOL_NAMES,
  isKnownToolName,
  isMcpScopedName,
  PERMISSION_MODES,
  type Decision,
  type PermissionMode,
} from "../src/permissions";
import { evaluate, newAutonomySession } from "../src/permissions/autonomy";
import type { ToolName } from "../src/tools/base";

// worker 工具名（shell_rw / shell_ro）按设计不在主会话静态键域内，与 permissions.test.ts 同一惯例。
const asTool = (s: string): ToolName => s as ToolName;

/** 本仓认得的全部名字（四个来源的并集，不硬编码条数）。 */
const ALL_NAMES: readonly string[] = [
  ...new Set([
    ...TOOL_NAMES,
    ...INJECTED_TOOLS.map((t) => t.name),
    ...WORKER_TOOL_TABLE,
    ...WRITE_WORKER_TOOL_TABLE,
    WORKER_IMPACT_TOOL,
  ]),
].sort();

const session = (mode: PermissionMode) => newAutonomySession(mode, { sandboxAvailable: true });

/** 改前实测的逐格金标准：`evaluate(name, {}, session(mode))` 的 `verdict/layer`，**26 × 4 全表逐格写死**。
 *  值取自 zcode@5e0c659 实跑（读数已落 outputs/m7-permission-allowlist-2026-10-01/）。
 *  为什么不按档位「归纳」成几条通则：归纳出的通则本身就是这个模块的**被改对象**——
 *  一旦行为变了，通则会跟着一起漂，于是判卷跟着被测物一起变绿。这里宁可啰嗦。
 *  读法：RO=只读档、DF=默认档、GD=引导档、AU=自主档。 */
type Golden = readonly [ro: string, df: string, gd: string, au: string];
const GOLDEN: Readonly<Record<string, Golden>> = {
  // 只读面：四档全部照常放行。**worker 只读档全靠这一段**（read_file/grep/glob/shell_ro/impact_query）。
  read_file: ["approve/L4-pass", "approve/L4-pass", "approve/L4-pass", "approve/L4-pass"],
  // read_image（2026-10-15 识图）：与 read_file 同族——只读界内图片进上下文，不改盘、不出网
  // （图片是工作区内文件读出来的 data URL，不是 http(s) 拉取）⇒ 四档全放行，不出卡。
  read_image: ["approve/L4-pass", "approve/L4-pass", "approve/L4-pass", "approve/L4-pass"],
  grep: ["approve/L4-pass", "approve/L4-pass", "approve/L4-pass", "approve/L4-pass"],
  glob: ["approve/L4-pass", "approve/L4-pass", "approve/L4-pass", "approve/L4-pass"],
  // **2026-10-05 显式改判（#58）**：lsp 从「四档照常放行」移出，四档一律走风险线送审。
  //  理由：`lsp` 会 spawn **工作区配置里写的命令**（`.agent/lsp.json` 的 `command`），
  //  那是仓库自带的外部输入——与 verify 的 S3 同一条形状。写那份配置已被 S2 的路径通道
  //  抬到 high，但**克隆即携带**那条路与写盘无关：模型根本不用动手，配置跟着 clone 一起到。
  //  它**不算改盘**（`tests/write-face.test.ts` 那条裁决照旧，本笔没动 SIDE_EFFECT_TOOLS），
  //  但"要不要问人"这一层不能缺席 ⇒ 风险表给 high，四档都出卡。
  //  未值守（worker）侧因此会 fail-closed 拒绝——那正是想要的：无人可问时，
  //  不许按一份仓库带来的配置起进程。
  //  这条金标准的用途正是**逼着改的人显式写下来**——它当初红的时候，红的就是这一格。
  lsp: ["ask/L4-risk", "ask/L4-risk", "ask/L4-risk", "ask/L4-risk"],
  // render_image（2026-10-16）：spawn 真实浏览器渲染工作区内的 HTML/SVG ⇒ 与 lsp 同族
  // （执行外部进程、外部输入、不改盘）⇒ 四档一律走风险线送审，逐字同形于 lsp。
  // 未值守（worker）侧因此 fail-closed 拒绝——无人可问时不许起浏览器。
  render_image: ["ask/L4-risk", "ask/L4-risk", "ask/L4-risk", "ask/L4-risk"],
  shell_ro: ["approve/L4-pass", "approve/L4-pass", "approve/L4-pass", "approve/L4-pass"],
  impact_query: ["approve/L4-pass", "approve/L4-pass", "approve/L4-pass", "approve/L4-pass"],
  clarify: ["approve/L4-pass", "approve/L4-pass", "approve/L4-pass", "approve/L4-pass"],
  propose_plan: ["approve/L4-pass", "approve/L4-pass", "approve/L4-pass", "approve/L4-pass"],
  verify: ["approve/L4-pass", "approve/L4-pass", "approve/L4-pass", "approve/L4-pass"],
  wait_for_agents: ["approve/L4-pass", "approve/L4-pass", "approve/L4-pass", "approve/L4-pass"],
  cancel_agents: ["approve/L4-pass", "approve/L4-pass", "approve/L4-pass", "approve/L4-pass"],
  refine_goal: ["approve/L4-pass", "approve/L4-pass", "approve/L4-pass", "approve/L4-pass"],
  remember: ["approve/L4-pass", "approve/L4-pass", "approve/L4-pass", "approve/L4-pass"],
  obs_recall: ["approve/L4-pass", "approve/L4-pass", "approve/L4-pass", "approve/L4-pass"],
  skill: ["approve/L4-pass", "approve/L4-pass", "approve/L4-pass", "approve/L4-pass"],
  // MCP 服务器级懒加载元工具：只改 active 集，不执行外部工具 ⇒ 四档均按无副作用工具放行。
  mcp_list: ["approve/L4-pass", "approve/L4-pass", "approve/L4-pass", "approve/L4-pass"],
  mcp_activate: ["approve/L4-pass", "approve/L4-pass", "approve/L4-pass", "approve/L4-pass"],
  mcp_release: ["approve/L4-pass", "approve/L4-pass", "approve/L4-pass", "approve/L4-pass"],
  automation_create: ["approve/L4-pass", "approve/L4-pass", "approve/L4-pass", "approve/L4-pass"],
  automation_update: ["approve/L4-pass", "approve/L4-pass", "approve/L4-pass", "approve/L4-pass"],
  automation_delete: ["approve/L4-pass", "approve/L4-pass", "approve/L4-pass", "approve/L4-pass"],
  automation_run_now: ["approve/L4-pass", "approve/L4-pass", "approve/L4-pass", "approve/L4-pass"],
  automation_list: ["approve/L4-pass", "approve/L4-pass", "approve/L4-pass", "approve/L4-pass"],
  // 写向：只读档 L0 摘除 / 默认档逐次审批 / 自主档放行。shell_ro 刻意不在此列
  // （autonomy.ts 注释：它靠执行期静态白名单，计入写向会把只读 shell 一并摘掉）。
  write_file: ["deny/L0-hard", "ask/L3-mode", "approve/L4-pass", "approve/L4-pass"],
  run_shell: ["deny/L0-hard", "ask/L3-mode", "approve/L4-pass", "approve/L4-pass"],
  shell_rw: ["deny/L0-hard", "ask/L3-mode", "approve/L4-pass", "approve/L4-pass"],
  spawn_agent: ["deny/L0-hard", "ask/L3-mode", "approve/L4-pass", "approve/L4-pass"],
  // edit_file 在引导档走**风险线**（编辑是 medium，guided 的线是 medium）⇒ 与上面四个不同行。
  // 这格是本段存在的理由：归纳成「写向 ⇒ 其余档全放行」会正好写错它。
  edit_file: ["deny/L0-hard", "ask/L3-mode", "ask/L4-risk", "approve/L4-pass"],
  // apply_patch 是**合并期**点名的（zcode 的 M2 补丁工具 `8d267bb` 在本表写死之后才进来）。
  // 值是合并后现跑出来的，不是推的：只读档 L0 摘除 / 默认档逐次审批 / 引导与自主档放行
  // —— 与上面四个写向逐字同形，正是 autonomy.ts 把它登记进 `SIDE_EFFECT_TOOLS` 的结果。
  // 这条点名本身就是本表存在的理由：不点名它，B1 会红并把「新增工具必须点名」这条规矩变成摆设。
  apply_patch: ["deny/L0-hard", "ask/L3-mode", "approve/L4-pass", "approve/L4-pass"],
  // diagnose 同属合并期（zcode 的 M3 诊断工具 `0b37ad2`）：执行进程、写入缓存/产物 ⇒ 计写向，
  // 逐字同形于上面四个。与 web_search 一并补，是因为「缺口一次列全」比一次撞一个便宜。
  diagnose: ["deny/L0-hard", "ask/L3-mode", "approve/L4-pass", "approve/L4-pass"],
  // web_search：出网 ⇒ 四档一律走风险线送审，逐字同形于 web_fetch。非交互四档全放行。
  web_search: ["ask/L4-risk", "ask/L4-risk", "ask/L4-risk", "ask/L4-risk"],
  // 出网：四档一律走风险线送审（web_fetch 的既有判定，与本笔无关但一并钉住防漂移）。
  web_fetch: ["ask/L4-risk", "ask/L4-risk", "ask/L4-risk", "ask/L4-risk"],
};

describe("M7 · 工具名登记册", () => {
  it("A · 登记册是**派生**的：四个来源每个名字都被认，且没有多余条目", () => {
    for (const n of TOOL_NAMES) expect(isKnownToolName(n)).toBe(true);
    for (const t of INJECTED_TOOLS) expect(isKnownToolName(t.name)).toBe(true);
    for (const n of WORKER_TOOL_TABLE) expect(isKnownToolName(n)).toBe(true);
    for (const n of WRITE_WORKER_TOOL_TABLE) expect(isKnownToolName(n)).toBe(true);
    expect(isKnownToolName(WORKER_IMPACT_TOOL)).toBe(true);
    // 条数 = 四个来源去重并集的条数：登记册里不许出现任何**手抄**进来的额外名字。
    expect(KNOWN_TOOL_NAMES.size).toBe(ALL_NAMES.length);
    for (const n of KNOWN_TOOL_NAMES) expect(ALL_NAMES).toContain(n);
  });

  it("B1 · 零回归：26 个既有工具名在四档下的 evaluate 裁决逐格不变（改前实测金标准）", () => {
    for (const name of ALL_NAMES) {
      const expected = GOLDEN[name];
      expect(expected, `金标准缺 ${name}——新增工具必须在这里点名，否则本段会跟着行为一起漂`).toBeDefined();
      PERMISSION_MODES.forEach((mode, i) => {
        const d = evaluate(asTool(name), {}, session(mode));
        expect(`${d.verdict}/${d.layer}`, `${name} @ ${mode}`).toBe(expected![i]);
      });
    }
  });

  it("B2 · 零回归：gate() 对既有工具名的裁决逐格不变（含只读 worker 的工具面）", () => {
    const EXPECT: Readonly<Record<string, Partial<Record<PermissionMode, Decision>>>> = {
      write_file: { "read-only": "deny", default: "deny", guided: "allow", auto: "allow" },
      edit_file: { "read-only": "deny", default: "deny", guided: "allow", auto: "allow" },
      run_shell: { "read-only": "deny", default: "deny", guided: "allow", auto: "allow" },
      shell_rw: { "read-only": "deny", default: "deny", guided: "allow", auto: "allow" },
      spawn_agent: { "read-only": "deny", default: "deny", guided: "allow", auto: "allow" },
      // 同 B1：合并期点名的 zcode M2 工具，缺了这一格会被 `?? "allow"` 兜成放行。
      apply_patch: { "read-only": "deny", default: "deny", guided: "allow", auto: "allow" },
      diagnose: { "read-only": "deny", default: "deny", guided: "allow", auto: "allow" },
    };
    for (const name of ALL_NAMES) {
      for (const mode of PERMISSION_MODES) {
        // 非交互是生产实况（loop 的 opts.interactive ?? false，5 个 runLoop 调用点无一传它）。
        const expected = EXPECT[name]?.[mode] ?? "allow";
        expect(gate(mode, asTool(name), false), `${name} @ ${mode} 非交互`).toBe(expected);
      }
    }
  });

  it("C · 新守卫确实开火：未登记工具名在四档下都要审批（改前是四档全 approve）", () => {
    for (const name of ["brand_new_write_tool", "ghost_tool", "totally_made_up"]) {
      for (const mode of PERMISSION_MODES) {
        const d = evaluate(asTool(name), { path: "src/x.ts" }, session(mode));
        expect(d.verdict, `${name} @ ${mode} 改前是 approve`).toBe("ask");
        expect(d.layer).toBe("L4-mcp-unannotated");
      }
    }
  });

  it("C3 · checkPermission 侧**刻意**没有这道守卫（撤回记录，钉住它别被加回来）", () => {
    // 这里断言的是「没有」，不是「有」。第一次实现把守卫也放进了 checkPermission，
    // 全量套件因此红了 4 条：它把 loop.ts:423 那道会话闸（blockedBy:"unknown-tool"）顶掉了，
    // 并且违反了 registry-rung.test.ts 的硬约束「注册表判定只看 opts.tools ?? TOOLS」
    // （checkPermission 收不到会话工具表）。两处都实测红过，故留此钉。
    const name = asTool("brand_new_write_tool");
    expect(checkPermission("read-only", name)).toBe("allow");
    expect(checkPermission("auto", name)).toBe("allow");
    // 同理 denyReason 也不该提「未登记」：它在 checkPermission 之后才被问，
    // 走到那里的调用已经被会话闸拦下并带上了自己的 blockedBy。
    expect(denyReason(name)).toBeNull();
  });

  it("C2 · 原型链上的名字不算「认得」（Set.has 不走原型链，这钉住它）", () => {
    for (const name of ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"]) {
      expect(isKnownToolName(name), name).toBe(false);
      // 守卫本身仍开火（evaluate 侧）；不在 checkPermission 侧断言——见 C3。
      expect(evaluate(asTool(name), {}, session("auto")).layer).toBe("L4-mcp-unannotated");
    }
  });

  it("D1 · MCP scoped 名豁免未知名规则：注解路径仍是唯一判据", () => {
    expect(isMcpScopedName("mcp__srv__do")).toBe(true);
    expect(isKnownToolName("mcp__srv__do")).toBe(true);
    // 带 readOnlyHint 的只读 MCP：只读档照常放行（白名单不许被这条守卫吃掉）。
    expect(evaluate("mcp__srv__peek" as ToolName, {}, session("read-only"), { annotated: true, readOnly: true }).layer)
      .toBe("L4-pass");
    // 无注解：任何档都按写处理并送审（既有 fail-closed 不变）。
    expect(evaluate("mcp__srv__x" as ToolName, {}, session("read-only")).verdict).toBe("deny");
    expect(evaluate("mcp__srv__x" as ToolName, {}, session("auto"), { annotated: false }).layer)
      .toBe("L4-mcp-unannotated");
  });

  it("D2 · 负对照：登记册里的名字一个都不许被新守卫误伤", () => {
    for (const name of ALL_NAMES) {
      // 写向工具在只读档是 L0 摘除（deny），其余档放行/送审——无论哪条，都**不是**未知名那层。
      const layers = PERMISSION_MODES.map((m) => evaluate(asTool(name), {}, session(m)).layer);
      expect(layers, name).not.toContain("L4-mcp-unannotated");
    }
  });

  it("E · 规则优先级：显式 allow / deny / ask 规则不被未知名守卫吃掉", () => {
    // 规则按**命令**匹配，工具级规则用空 pattern（`pattern: "*"` 匹配不到任何命令——实测 miss）。
    const rule = (behavior: "allow" | "deny" | "ask", tool: string) =>
      ({ behavior, tool, pattern: "", scope: "always", id: "r1" }) as const;
    const name = "mcp__srv__x";
    const withRule = (behavior: "allow" | "deny" | "ask") =>
      evaluate(name as ToolName, {}, newAutonomySession("auto", {
        sandboxAvailable: true, rules: [rule(behavior, name)],
      }));
    expect(withRule("allow")).toMatchObject({ verdict: "approve", layer: "L3-rule" });
    expect(withRule("deny")).toMatchObject({ verdict: "deny", layer: "L1-deny" });
    expect(withRule("ask")).toMatchObject({ verdict: "ask", layer: "L2-ask-rule" });
  });
});
