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
import { isSideEffectTool } from "../src/permissions";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RUNNER = readFileSync(join(ROOT, "src/main/agent-runner.ts"), "utf8");

/** 全局注入：installAppTools 往 TOOLS 上直接挂名。 */
function globalInjected(): string[] {
  return [...RUNNER.matchAll(/TOOLS as unknown as Record<string, Tool>\)\.([a-z_][a-z0-9_]*)\s*=/g)].map((m) => m[1]!);
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
  return new Set([...globalInjected(), ...runLoopInjected()]);
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
    const injected = [...new Set([...globalInjected(), ...runLoopInjected()])];
    expect(injected.filter((n) => !declared.has(n))).toEqual([]);
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
