// G-B：运行时注入工具的「三面」对账（spec §2 不变量 1 / §7 G-B）。
// 本仓已反复栽在同一形态上（spawn_agent、lsp、impact_query 的 worker 三处、worker 写端回注、
// join 原语只有验收脚本在调），靠变异锚点守太贵——每条能力都要人记得加。这里换成静态对账：
// 一张生产与测试共读的声明表 + 三面实测。
// 实例面为什么走源文本而不是执行 installAppTools()：那函数会拉起 AskGate / 调度器 / electron 依赖，
// 单测里调它等于起半个主进程。文本对账的失效方向是**假绿**，所以最后一条测是它自己的反向对照。
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { INJECTED_TOOLS, missingFromFace, type InjectedToolSurface } from "../src/agent/tool-surface";
import { gateToolSpecs } from "../src/agent/glm-session";
import { workerToolSpecs } from "../src/agent/worker-shell-tools";
import { workerToolTable } from "../src/agent/orchestrator-config";
import { isKnownToolName, isSideEffectTool } from "../src/permissions";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** M4a 拆分（2026-10-11）：`table["automation_*"] =` 那一形搬去 ./scheduler-runtime，
 *  文本对账跟着读两处（实现搬走、对账跟着走；同 verify-exec-sandbox 的双文件读法）。
 *  同日后半：`table["skill"] =` 那一形随工具门搬去 ./tool-gates ⇒ 加入第三处。 */
const RUNNER = ["src/main/agent-runner.ts", "src/main/scheduler-runtime.ts", "src/main/tool-gates.ts"]
  .map((rel) => readFileSync(join(ROOT, rel), "utf8"))
  .join("\n");

/** 全局注入：installAppTools 往 TOOLS 上直接挂名。 */
function globalInjected(): string[] {
  return [...RUNNER.matchAll(/TOOLS as unknown as Record<string, Tool>\)\.([a-z_][a-z0-9_]*)\s*=/g)].map((m) => m[1]!);
}
/** 第二种注入形状：`const table = TOOLS as …; table["automation_create"] = {...}`。
 *  老只认上面那一形 ⇒ M4a 的定时五件（就是这一形）从头到尾没进过对账分母，
 *  而分母漏的那支恰是"实现装了、模型面上没有"那一支。
 *  只认字符串字面量下标：`table[scoped] = gatedMcpTool(...)` 是 MCP 动态名，由 plugins-check 判。 */
function tableInjectedNames(): string[] {
  return [...RUNNER.matchAll(/^\s*table\["([a-z_][a-z0-9_]*)"\]\s*=/gm)].map((m) => m[1]!);
}
/** 运行期注入：runLoop 的 `tools: { ...TOOLS, x: inst }` 覆盖对象里的键。
 *  只取**那一行**并在行内找键——按字符数切一段会把后续行的 `workspace:` / `mode:` 当成注入面，
 *  判据里混进噪声键，读者就得先怀疑这条门是不是在测别的东西。 */
function runLoopInjected(): string[] {
  const line = RUNNER.split("\n").find((l) => l.includes("tools: { ...TOOLS,"));
  if (line === undefined) return [];
  return [...line.matchAll(/([a-z_][a-z0-9_]*)\s*:\s/g)].map((m) => m[1]!).filter((k) => k !== "TOOLS" && k !== "tools");
}
function instanceNames(): Set<string> {
  return new Set([...globalInjected(), ...tableInjectedNames(), ...runLoopInjected()]);
}
/** 分母本身也要有读数：解析器扩了一支却静默 0 命中，比不扩更坏（看起来在管，其实在扫空气）。 */
function allInjectedNames(): string[] {
  return [...new Set([...globalInjected(), ...tableInjectedNames(), ...runLoopInjected()])];
}

/** 两面返回形状不同（主会话与 worker 都是 {function:{name}}，声明侧按名字收）。 */
const namesOf = (specs: readonly { function?: { name: string }; name?: string }[]): Set<string> =>
  new Set(specs.map((s) => s.function?.name ?? s.name ?? ""));

const mainSpecs = (): Set<string> => namesOf(gateToolSpecs("auto"));
const workerSpecs = (mode: "read" | "write"): Set<string> => namesOf(workerToolSpecs(mode, { impactAnalysis: true }));

function report(surface: InjectedToolSurface): string[] {
  const problems: string[] = [];
  const instances = instanceNames();
  if (surface.specFace === "static" && !mainSpecs().has(surface.name)) {
    problems.push(`规格面缺 ${surface.name}（模型看不见 = 发不出去）`);
  }
  if (!instances.has(surface.name)) problems.push(`实例面缺 ${surface.name}（模型发得出，但没人执行）`);
  const modes: ("read" | "write")[] =
    surface.workerReachable === "both" ? ["read", "write"]
      : surface.workerReachable === false ? []
        : [surface.workerReachable];
  for (const mode of modes) {
    if (!workerSpecs(mode).has(surface.name)) problems.push(`worker(${mode}) 规格面缺 ${surface.name}`);
    if (!workerToolTable(mode, true).includes(surface.name)) problems.push(`worker(${mode}) 白名单缺 ${surface.name}`);
  }
  if (surface.workerReachable === false) {
    for (const mode of ["read", "write"] as const) {
      // 反向：标了不可达却进了白名单 ⇒ 「worker 权限 ≤ 父会话」那三道硬闸形同虚设
      if (workerToolTable(mode, true).includes(surface.name)) problems.push(`${surface.name} 标了 worker 不可达，却在 worker(${mode}) 白名单里`);
    }
  }
  // 写向判定与 permissions 的真值对账：漏登 SIDE_EFFECT_TOOLS 会让只读档/方案门静默失效
  if (isSideEffectTool(surface.name) !== surface.mainSessionSideEffect) {
    problems.push(`${surface.name} 的写向判定漂移（表 ${String(surface.mainSessionSideEffect)} vs permissions ${String(isSideEffectTool(surface.name))}）`);
  }
  // 第四面（M7）：未登记工具名按写处理并逐次审批（fail-closed）。漏登不会静默放行，
  // 但会让一个正常工具每次调用都多出一张审批卡——「安全但没法用」同样是缺陷，所以照样钉住。
  if (!isKnownToolName(surface.name)) {
    problems.push(`${surface.name} 未登记进 KNOWN_TOOL_NAMES（会被未知名守卫逐次审批）`);
  }
  return problems;
}

describe("G-B 注入工具三面对账", () => {
  it("每个声明项在应有的一面全部在场（缺哪面报哪面，不整体红）", () => {
    const bad = INJECTED_TOOLS.flatMap((s) => report(s).map((p) => s.name + " :: " + p));
    expect(bad).toEqual([]);
  });

  it("只读档的摘除面与声明一致（只查静态表：运行期注入项由各自的开关管）", () => {
    for (const s of INJECTED_TOOLS.filter((x) => x.specFace === "static")) {
      expect(gateToolSpecs("read-only").some((t) => t.function.name === s.name)).toBe(s.reachableWhenReadOnly);
    }
  });

  it("声明表本身不可漏项：源文本里出现的注入名必须登记（不登记 = 新工具绕过这道门）", () => {
    const declared = new Set(INJECTED_TOOLS.map((s) => s.name));
    const injected = allInjectedNames();
    expect(injected.filter((n) => !declared.has(n))).toEqual([]);
  });

  it("第四面（M7）：每个声明项都登记进了 KNOWN_TOOL_NAMES，漏登会被逐次审批", () => {
    const unregistered = INJECTED_TOOLS.map((s) => s.name).filter((n) => !isKnownToolName(n));
    expect(unregistered).toEqual([]);
    // 反向对照：这张面对「未登记」有分辨力（否则上面前三面全绿时它是道空门）。
    expect(isKnownToolName("ghost_tool")).toBe(false);
  });

  it("扩形后的分母自证：table[\"name\"] = 那一形确实被算进来了（解析器静默 0 命中比不扩更坏）", () => {    const tableForm = tableInjectedNames();
    for (const n of ["automation_create", "automation_update", "automation_delete", "automation_run_now", "automation_list", "skill"]) {
      expect(tableForm, n + " 走的是 table[\"…\"] = 这一形，解析器退回旧形状就会漏它").toContain(n);
    }
    // MCP 的动态下标不许被当成名字收进分母（收了就是把 `scoped` 当工具名，判据里混进噪声键）
    expect(tableForm, "table[scoped] 不是字符串字面量，不该匹配").not.toContain("scoped");
  });

  it("对账本身有分辨力（反向对照：没这条的静态门等于没立）", () => {
    expect(missingFromFace(["real_tool", "ghost_tool"], new Set(["real_tool"]))).toEqual(["ghost_tool"]);
    const fake: InjectedToolSurface = {
      name: "ghost_tool", specFace: "static", workerReachable: "both", reachableWhenReadOnly: false, mainSessionSideEffect: false,
    };
    // 主规格面 + 实例面 + worker 两面 = 四处该全报出来，一处不漏
    expect(report(fake).length).toBeGreaterThanOrEqual(4);
    // 反向的另一半：把已登记的工具假装 worker 不可达，必须抓到它其实在白名单里
    const lie: InjectedToolSurface = {
      name: "impact_query", specFace: "runtime", workerReachable: false, reachableWhenReadOnly: true, mainSessionSideEffect: false,
    };
    expect(report(lie).some((p) => p.includes("却在 worker(read) 白名单里"))).toBe(true);
  });
});
