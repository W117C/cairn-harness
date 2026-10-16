/**
 * 模型面总预算门（每请求固定成本）。
 *
 * 存在的理由：这一族的其他成员各有自己的帽（记忆 / skill 重挂 / hook 上下文 / 单条 MCP 描述），
 * 唯独**模型面**（基础系统提示 + 工具规格 JSON）没有总闸——MCP 工具在 `sessionToolSpecs` 里是一条
 * 裸 `specs.push`。缺它的后果不是「贵一点」，是「没有任何一处会红」：装三个话痨 server 就能把每轮
 * 固定成本抬高一个数量级（本仓实测：缺省装配 7.1k 字符 → 三 server 各 20 工具 43k → 单个话痨
 * server 20 工具 55k），而工具数一多还会直接掉行为分（外部读数见
 * outputs/model-surface-budget-2026-09-23/00-调研综述.md）。
 *
 * 口径：
 * - 只在 **JS 侧**匹配与判定（本仓定稿：判据不落 shell grep，BSD grep 的 \\b \\s \\| 静默返回空）。
 * - fail-visible：逐条打印 ✅/❌ + 实测读数；装配数为 0 直接红（真空通过是本仓最忌的假绿）。
 * - 单位一律**字符**（帽以字符登记，见 docs/superpowers/specs/2026-09-19-orchestration-design.md
 *   那条「中文按 chars/4 会被低估 3–4 倍」的裁决）。
 * - **一条判据一只函数**，门与 `--self-test` 共用同一只：否则自检证明的是另一件事。
 *
 * 用法：`pnpm model-surface-check`｜反向对照 `pnpm model-surface-check -- --self-test`
 */
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  MODEL_SURFACE_TIGHT_DESC_CHAR_CAP,
  MODEL_SURFACE_TOTAL_CHAR_LIMIT,
  accountModelSurface,
  planSurfaceBudget,
  surfaceNote,
  surfaceSpecChars,
  type ModelSurfaceAccount,
  type SurfacePlan,
} from "../src/agent/model-surface";
import { gateToolSpecs, sessionToolSpecs } from "../src/agent/session-provider";
import type { GlmToolSpec } from "../src/providers/glm";

const CORE_NAMES: ReadonlySet<string> = new Set(gateToolSpecs().map((s) => s.function.name));
const n = (v: number): string => String(v);

/** 话痨 MCP server 的反向对照用料（形状 = `SessionPluginTool`，即 `sessionToolSpecs` 的注入口）。
 *  描述按**字符**计且刻意用 CJK：ASCII 的 chars/4 折算会把读数算轻，帽要按最坏口径判。 */
export function pluginFixture(n: number, descChars: number) {
  return Array.from({ length: n }, (_, i) => ({
    name: "mcp__chatty__tool_" + String(i),
    description: "描".repeat(descChars),
    parameters: { type: "object", properties: { input: { type: "string" } } },
  }));
}
export function faceWith(mode: "default" | "auto" | "read-only" = "default", tools = 0, descChars = 0): GlmToolSpec[] {
  return sessionToolSpecs({ mode, ...(tools > 0 ? { pluginTools: pluginFixture(tools, descChars) } : {}) }).specs;
}

/** 降配后的保留表是否为原表的**位置前缀**（尾丢与否的判据；中间摘必红）。 */
export function isPositionalPrefix(before: readonly GlmToolSpec[], after: readonly GlmToolSpec[]): boolean {
  return after.every((s, i) => s.function.name === before[i]?.function.name);
}
/** core 段是否整体在前（尾丢之所以等于「丢插件」全靠这条）。 */
export function coreRunsFirst(specs: readonly GlmToolSpec[]): boolean {
  let firstNonCore = -1;
  let lastCore = -1;
  specs.forEach((s, i) => {
    if (CORE_NAMES.has(s.function.name)) lastCore = i;
    else if (firstNonCore < 0) firstNonCore = i;
  });
  return firstNonCore < 0 || lastCore < firstNonCore;
}

/* ---- 六只判据：门按它们判红，自检按它们造红。同一只函数，两处出口。 ---- */

export const ms1Holds = (acct: ModelSurfaceAccount) => acct.fixedChars <= acct.limitChars;

export const ms2Holds = (specs: readonly GlmToolSpec[]) => coreRunsFirst(specs);

export const ms3Holds = (before: readonly GlmToolSpec[], plan: Pick<SurfacePlan, "specs" | "dropped">) =>
  plan.specs.length < before.length && plan.dropped.length > 0 && isPositionalPrefix(before, plan.specs);

export const ms4Holds = (before: readonly GlmToolSpec[], plan: SurfacePlan) =>
  plan.account.totalChars <= plan.account.limitChars &&
  JSON.stringify(plan.specs) === JSON.stringify(before) &&
  plan.note === "" &&
  plan.dropped.length === 0 &&
  plan.shortened.length === 0;

export const ms5Holds = (plan: Pick<SurfacePlan, "note" | "dropped" | "account">) =>
  plan.note !== "" &&
  plan.note.includes(String(plan.account.limitChars)) &&
  plan.dropped.every((name) => plan.note.includes(name));

export const ms6Holds = (plan: SurfacePlan) =>
  plan.unresolvable && [...CORE_NAMES].every((name) => plan.specs.some((s) => s.function.name === name));

export interface SurfaceRule {
  id: string;
  why: string;
  run: () => { ok: boolean; detail: string };
}

/** 生产固定面里 BASE_SYSTEM 那一段：main() 从真模块取；单测 import 时走 `setSystemChars`，
 *  免得为了一个读数把 electron 依赖拉进测试进程。 */
let systemChars = 0;
export function setSystemChars(chars: number): void {
  systemChars = chars;
}
export function getSystemChars(): number {
  return systemChars;
}

export const SURFACE_RULES: readonly SurfaceRule[] = [
  {
    id: "MS1-固定面在帽内",
    why: "这条门的存在本身：生产缺省装配（真实 BASE_SYSTEM + 缺省工具表）必须在池子里，且给一个中等 MCP server 留出余量",
    run: () => {
      const specs = faceWith();
      const acct = accountModelSurface({ systemChars, specs, coreNames: CORE_NAMES });
      return {
        ok: ms1Holds(acct),
        detail: `固定面 ${n(acct.fixedChars)} / 帽 ${n(acct.limitChars)} 字符（system ${n(acct.systemChars)} + 工具 ${n(acct.toolSpecChars)}，${n(specs.length)} 条）`,
      };
    },
  },
  {
    id: "MS2-core 段在前",
    why: "降配梯靠「只从尾部丢」同时保住可缓存前缀与「丢的是插件」；非 core 一旦排到 core 前面，尾丢就变成在砍基础工具",
    run: () => {
      const specs = faceWith("default", 6, 300);
      return { ok: ms2Holds(specs), detail: `装配 ${n(specs.length)} 条，core 整体在前=${coreRunsFirst(specs)}` };
    },
  },
  {
    id: "MS3-降配只做尾丢（前缀不变量）",
    why: "缓存按前缀命中（tools → system → messages，上游变化会把它之后全部重写）；中间摘一把就把它之后所有条目的缓存打掉",
    run: () => {
      const specs = faceWith("default", 40, 1_200);
      const plan = planSurfaceBudget({ specs, systemChars, coreNames: CORE_NAMES });
      return {
        ok: ms3Holds(specs, plan),
        detail: `降配前 ${n(specs.length)} 条 → 后 ${n(plan.specs.length)} 条（丢 ${n(plan.dropped.length)} 把），前缀稳定 ${n(plan.prefixStableChars)} 字符`,
      };
    },
  },
  {
    id: "MS4-未超预算逐字不变",
    why: "零回归支：帽没碰到时不得改动装配一个字节，否则这条能力自己就成了前缀抖动源",
    run: () => {
      const specs = faceWith();
      const plan = planSurfaceBudget({ specs, systemChars, coreNames: CORE_NAMES });
      return {
        ok: ms4Holds(specs, plan),
        detail: `缺省装配 total=${n(plan.account.totalChars)} ≤ ${n(plan.account.limitChars)}，逐字一致=${JSON.stringify(plan.specs) === JSON.stringify(specs)}`,
      };
    },
  },
  {
    id: "MS5-省了谁必须说出去",
    why: "静默少几把工具 = 让模型自己猜哪把没了（下一跳才吃一句「不可用」）。与 skill 摘除、hook 预算同一族纪律",
    run: () => {
      const specs = faceWith("default", 40, 1_200);
      const plan = planSurfaceBudget({ specs, systemChars, coreNames: CORE_NAMES });
      const named = plan.dropped.filter((x) => plan.note.includes(x)).length;
      return { ok: ms5Holds(plan), detail: `note ${n(plan.note.length)} 字符，点名 ${n(named)}/${n(plan.dropped.length)} 把丢弃工具` };
    },
  },
  {
    id: "MS6-core 不得被自动砍",
    why: "砍掉 edit_file / verify 换来的是「便宜的废会话」，比贵更坏。装不下时报 unresolvable 交人裁决",
    run: () => {
      const specs = faceWith("default", 30, 1_200);
      const plan = planSurfaceBudget({ specs, systemChars, coreNames: CORE_NAMES, limitChars: 1_000 });
      const coreIntact = [...CORE_NAMES].every((x) => plan.specs.some((s) => s.function.name === x));
      return {
        ok: ms6Holds(plan),
        detail: `unresolvable=${plan.unresolvable}，core 全在=${coreIntact}（丢 ${n(plan.dropped.length)} 把，仍超 ${n(plan.account.overChars)} 字符）`,
      };
    },
  },
];

/** 反向对照：给每只判据喂一件**故意做错**的工件，要求它判假。
 *  造不出红的规则等于摆设（自检必红）。 */
export function runSurfaceSelfTest(): { caught: string[]; missed: string[] } {
  const caught: string[] = [];
  const missed: string[] = [];
  const overSpecs = faceWith("default", 40, 1_200);
  const plan = planSurfaceBudget({ specs: overSpecs, systemChars, coreNames: CORE_NAMES });
  const probes: { id: string; predicateSaysRed: () => boolean }[] = [
    {
      id: "MS1-固定面在帽内",
      predicateSaysRed: () =>
        !ms1Holds(accountModelSurface({ systemChars, specs: overSpecs, coreNames: CORE_NAMES, limitChars: 1 })),
    },
    {
      // 把 core 段整体搬到数组尾部 ⇒ 尾丢就会开始砍基础工具
      id: "MS2-core 段在前",
      predicateSaysRed: () => !ms2Holds([...overSpecs.slice(CORE_NAMES.size), ...overSpecs.slice(0, CORE_NAMES.size)]),
    },
    {
      // 真正的「中间摘」：挪掉保留段中间一条
      id: "MS3-降配只做尾丢（前缀不变量）",
      predicateSaysRed: () =>
        !ms3Holds(overSpecs, { specs: [...plan.specs.slice(0, 3), ...plan.specs.slice(4)], dropped: plan.dropped }),
    },
    {
      // 未超预算却动了装配一个字
      id: "MS4-未超预算逐字不变",
      predicateSaysRed: () => {
        const base = faceWith();
        const quiet = planSurfaceBudget({ specs: base, systemChars, coreNames: CORE_NAMES });
        const tampered: SurfacePlan = {
          ...quiet,
          specs: quiet.specs.map((s, i) =>
            i === 0 ? { ...s, function: { ...s.function, description: (s.function.description ?? "") + "动了尾巴" } } : s,
          ),
        };
        return !ms4Holds(base, tampered);
      },
    },
    {
      // 一句不点名的散文提示
      id: "MS5-省了谁必须说出去",
      predicateSaysRed: () =>
        !ms5Holds({
          note: surfaceNote({
            limitChars: 1_234,
            shortened: [],
            dropped: ["mcp__a", "mcp__b"],
            unresolvable: false,
            tightCap: MODEL_SURFACE_TIGHT_DESC_CHAR_CAP,
            overChars: 5,
          }).replace(/mcp__\w+/g, "若干"),
          dropped: ["mcp__a", "mcp__b"],
          account: plan.account,
        }),
    },
    {
      // 一把「顺手砍了 core」的假降配
      id: "MS6-core 不得被自动砍",
      predicateSaysRed: () => !ms6Holds({ ...plan, unresolvable: true, specs: plan.specs.filter((s) => s.function.name !== "verify") }),
    },
  ];
  for (const probe of probes) {
    let red = false;
    try {
      red = probe.predicateSaysRed();
    } catch {
      red = false;
    }
    if (red) caught.push(probe.id);
    else missed.push(probe.id);
  }
  return { caught, missed };
}

async function loadRealSystemChars(): Promise<{ chars: number; note: string }> {
  try {
    const mod = await import("../src/main/agent-runner");
    return { chars: (mod.BASE_SYSTEM ?? "").length, note: "真实 BASE_SYSTEM" };
  } catch (err) {
    // fail-visible：拿不到真实提示就明说，绝不退回「估一个」——帽的判定依赖这个数。
    return { chars: 0, note: "取不到 BASE_SYSTEM（" + (err instanceof Error ? err.message : String(err)) + "）" };
  }
}

async function main(): Promise<void> {
  const selfTest = process.argv.slice(2).includes("--self-test");
  if (selfTest) {
    setSystemChars(670); // 自检判的是形状，不是真值
    const r = runSurfaceSelfTest();
    console.log(`[model-surface-check] --self-test：造得红 ${n(r.caught.length)}/${n(r.caught.length + r.missed.length)}`);
    for (const id of r.caught) console.log(`  ✅ 造得红 ${id}`);
    for (const id of r.missed) console.log(`  ❌ 造不红 ${id} —— 这条判据是摆设`);
    process.exit(r.missed.length === 0 ? 0 : 1);
  }

  const sys = await loadRealSystemChars();
  setSystemChars(sys.chars);
  const declared = faceWith();
  console.log(
    `[model-surface-check] ${sys.note}：${n(sys.chars)} 字符｜装配面 ${n(surfaceSpecChars(declared))} 字符 / ${n(declared.length)} 条｜帽 ${n(MODEL_SURFACE_TOTAL_CHAR_LIMIT)} 字符`,
  );
  if (declared.length === 0) {
    console.log("  ❌ 装配数为 0 —— 门本身失效（不报「无违规」）");
    process.exit(1);
  }
  if (sys.chars === 0) {
    console.log("  ❌ 固定面少了基础提示这一段，判定不可信（不降级为「通过」）");
    process.exit(1);
  }

  let failed = 0;
  for (const rule of SURFACE_RULES) {
    let verdict: { ok: boolean; detail: string };
    try {
      verdict = rule.run();
    } catch (err) {
      verdict = { ok: false, detail: "抛异常：" + (err instanceof Error ? err.message : String(err)) };
    }
    if (!verdict.ok) failed++;
    console.log(`  ${verdict.ok ? "✅" : "❌"} ${rule.id} — ${verdict.detail}`);
    if (!verdict.ok) console.log(`     为什么要有这条：${rule.why}`);
  }
  const acct = accountModelSurface({ systemChars, specs: declared, coreNames: CORE_NAMES });
  console.log("  装配账（字符，降序，前 5）：");
  for (const p of acct.pieces.slice(0, 5)) console.log(`    ${p.name.padEnd(20)} ${String(p.chars).padStart(6)}  ${p.tier}`);
  console.log(`  合计 固定面 ${n(acct.fixedChars)}｜帽 ${n(acct.limitChars)}｜占用 ${((acct.fixedChars / acct.limitChars) * 100).toFixed(1)}%`);
  console.log(failed === 0 ? `[model-surface-check] ${n(SURFACE_RULES.length)}/${n(SURFACE_RULES.length)} 通过` : `[model-surface-check] ❌ ${n(failed)} 条不过`);
  process.exit(failed === 0 ? 0 : 1);
}

// 入口判定：单测 import 本模块不得把门跑起来（同款写法见 scripts/no-progress-check.ts）。
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  void main();
}
