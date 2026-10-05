// 判卷 · 定时五件的「按需挂载」（纯成本改动）
//
// 实测读数（`pnpm prompt-cost` 口径）：`automation_*` 五件的规格合计 **2,482 字符/轮**，
// 占每轮固定面约 21.6%，而固定面是**每一轮**都重送的静态段。摘它不损失可达能力：HEAD 上没有
// "模型建成任务"的活路——`scheduler.upsert` 只有 UI 侧与模型侧两类调用者，桌面 `wired` 表缺那四行
// （模型在桌面里发不出这条），`--serve` 下 unattended 门即刻拒，唯一还有回执的是 `automation_list`。
//
// 这三支钉**挂载判据**这一格，与 tests/automation-tool-surface.test.ts（那支钉"摘时两面同摘"
// 与面成本帽）互补而不重叠：
//   ① 判据为假 ⇒ 五件**一个都不在**规格面（数名字，不数总字节：字节帽看不出少的究竟是哪一把）；
//   ② 判据为真 ⇒ 五件齐全，顺序与内容与既有面**逐字一致**（零回归证人，防止顺手改格式）；
//   ③ 单调证人 ⇒ 同一进程里先一场"假"再一场"真"，规格面与执行面必须**同源**
//      （本仓点名的两种失败形状：`看得见调不到` / `能调看不见`），且不得抛；
//   ④ 读盘判据的边界 ⇒ 不存在／空文件／空清单／坏 JSON／全条目无效／清单写在别的工作区。
// 判据读的是**盘上事实**（`<workspace>/.agent/schedules/automations.json`——调度器装载任务用的
// 同一份文件、同一个 loader），不是"用户想不想用"：配了就自动回来，也不需要新发明一个设置项。
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AUTOMATION_TOOLS, AUTOMATION_TOOL_NAMES, automationToolSpecs } from "../src/agent/automation-surface";
import { sessionToolFace } from "../src/main/agent-runner";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = process.env.PI_SCRATCH_DIR ?? tmpdir();

/** 一条**校验器认得**的任务（形状取自 tests/schedule.test.ts 的 `base()`）。 */
const VALID_TASK = { name: "每日报表", prompt: "汇总今日变更并输出报告", schedule: { kind: "daily", time: "09:30" } };
/** 一条校验器**怎么都不认**的任务（空 prompt + 非法 time；刻意不用 `hourly`——
 *  非表单路的 loadAutomationsFile 是接受它的，用错了这条就是白给的红）。 */
const INVALID_TASK = { name: "坏条目", prompt: "   ", schedule: { kind: "daily", time: "25:99" } };

type Runner = Record<string, unknown>;
type Install = (o: { automation?: boolean }) => void;

const madeDirs: string[] = [];
afterEach(async () => {
  while (madeDirs.length > 0) await rm(madeDirs.pop()!, { recursive: true, force: true });
});

/** 造一个真实工作区。`automations === undefined` ⇒ 什么都不建（连 `.agent` 都没有）。 */
async function workspaceWith(automations: unknown[] | string | undefined): Promise<string> {
  const ws = await mkdtemp(join(scratch, "automation-mount-"));
  madeDirs.push(ws);
  if (automations === undefined) return ws;
  await mkdir(join(ws, ".agent", "schedules"), { recursive: true });
  const text = typeof automations === "string"
    ? automations
    : JSON.stringify({ version: 1, tasks: automations }, null, 2);
  await writeFile(join(ws, ".agent", "schedules", "automations.json"), text, "utf8");
  return ws;
}

/** 每次都从干净的模块注册表起步：`installed` 与单调真值都是模块级状态，测完一条就作废。 */
async function freshRunner(): Promise<{ runner: Runner; install: Install; execFace: () => string[] }> {
  vi.resetModules();
  const runner = (await import("../src/main/agent-runner")) as unknown as Runner;
  const { TOOLS } = (await import("../src/tools")) as { TOOLS: Record<string, unknown> };
  return {
    runner,
    install: runner.installAppTools as Install,
    /** 执行面读数：五件里真挂在 TOOLS 上的名字（保持声明序）。 */
    execFace: () => AUTOMATION_TOOL_NAMES.filter((n) => n in TOOLS),
  };
}

/** 进程级判据。导出缺失时点名缺的是哪一个，而不是丢一句 TypeError。 */
async function decide(runner: Runner, ws: string, explicit?: boolean): Promise<boolean> {
  const fn = runner.installTimeAutomationFace;
  expect(fn, "agent-runner 必须导出进程级定时五件判据 installTimeAutomationFace").toBeTypeOf("function");
  return await (fn as (w: string, e?: boolean) => Promise<boolean>)(ws, explicit);
}

/** 盘上事实读端（同上一条纪律）。 */
async function scheduled(runner: Runner, ws: string): Promise<boolean> {
  const fn = runner.automationsScheduled;
  expect(fn, "agent-runner 必须导出盘上判据读端 automationsScheduled（与 lspConfigured 同形）").toBeTypeOf("function");
  return await (fn as (w: string) => Promise<boolean>)(ws);
}

/** 规格面里 automation 那一族的名字（保持面上顺序）。 */
function automationSlice(tools: { function: { name: string } }[]): string[] {
  return tools.map((t) => t.function.name).filter((n) => AUTOMATION_TOOL_NAMES.includes(n));
}
const specFace = (on: boolean): { function: { name: string } }[] =>
  sessionToolFace(null, { mode: "auto", automationTools: on }).tools;

/* ------------------------------------------------------------------ ① 假 ⇒ 全摘 */
describe("① 判据为假 ⇒ 定时五件一个都不在规格面（数名字）", () => {
  it("盘上没有任务清单：判据假，且五个名字一个都不剩", async () => {
    const { runner } = await freshRunner();
    const on = await decide(runner, await workspaceWith(undefined));
    expect(on, "没有 automations.json 的工作区必须判为假（否则下面全是空转）").toBe(false);
    expect(automationSlice(specFace(on)), "规格面里不该剩任何一把 automation_*").toEqual([]);
  });

  it("摘掉的是且只是这五个：其余工具面逐字不动（多摘一把就是顺手改了产品）", async () => {
    const { runner } = await freshRunner();
    const off = await decide(runner, await workspaceWith(undefined));
    const lean = specFace(off).map((t) => t.function.name);
    const full = specFace(true).map((t) => t.function.name);
    expect(lean).toEqual(full.filter((n) => !AUTOMATION_TOOL_NAMES.includes(n)));
    expect(full.length - lean.length).toBe(AUTOMATION_TOOL_NAMES.length);
  });

  it("同进同退：不存在「留着 update/delete/run_now 而摘掉 create」的半张脸", async () => {
    const { runner } = await freshRunner();
    const off = await decide(runner, await workspaceWith(undefined));
    const seen = new Set(automationSlice(specFace(off)));
    // 那三把的文档把 `id` 指向 create 的回执 ⇒ 留着它们 = 让模型去引用一个它根本拿不到的 id
    for (const n of AUTOMATION_TOOL_NAMES) expect(seen.has(n), n + " 独自留在面上").toBe(false);
    // 反向对照：判据为真时五把**全**在（否则"一个都没有"可以靠恒假蒙过去）
    expect(new Set(automationSlice(specFace(true)))).toEqual(new Set(AUTOMATION_TOOL_NAMES));
  });
});

/* ------------------------------------------------------------------ ② 真 ⇒ 零回归 */
describe("② 判据为真 ⇒ 五件齐全，顺序与内容与既有面逐字一致（零回归证人）", () => {
  it("盘上有任务：判据真 ⇒ 面上五件按 AUTOMATION_TOOLS 声明序齐全", async () => {
    const { runner } = await freshRunner();
    const on = await decide(runner, await workspaceWith([VALID_TASK]));
    expect(on, "盘上有一条真任务时必须判为真（否则这是恒摘，不是按需）").toBe(true);
    expect(automationSlice(specFace(on))).toEqual([...AUTOMATION_TOOLS.map((t) => t.name)]);
  });

  it("内容逐字未动：面上的五份与 automationToolSpecs() 同字节（防止顺手改描述/格式）", async () => {
    const { runner } = await freshRunner();
    const on = await decide(runner, await workspaceWith([VALID_TASK]));
    const face = specFace(on);
    const mounted = automationSlice(face).map((n) => face.find((t) => t.function.name === n)!);
    expect(JSON.stringify(mounted)).toBe(JSON.stringify(automationToolSpecs()));
    // 这把尺自己要有分辨力：动一个字符就不相等
    expect(JSON.stringify(mounted).replace("按 id 删除定时任务", "删掉")).not.toBe(JSON.stringify(automationToolSpecs()));
  });

  it("两面同源为真：判据真 ⇒ 执行面五件全在（看得见且调得到）", async () => {
    const { runner, install, execFace } = await freshRunner();
    const on = await decide(runner, await workspaceWith([VALID_TASK]));
    install({ automation: on });
    expect(execFace()).toEqual([...AUTOMATION_TOOL_NAMES]);
    expect(new Set(automationSlice(specFace(on)))).toEqual(new Set(execFace()));
  });
});

/* ------------------------------------------------------------------ ③ 单调证人 */
describe("③ 单调证人：同一进程内先后两场，规格面与执行面必须同源", () => {
  it("第一场假 ⇒ 执行面定终身：第二场盘上有了任务也不许翻（不抛、不「看得见调不到」）", async () => {
    const { runner, install, execFace } = await freshRunner();
    const hasTasks = await workspaceWith([VALID_TASK]);
    const first = await decide(runner, await workspaceWith(undefined));
    install({ automation: first });
    expect(execFace(), "第一场判假 ⇒ 执行面就没挂五件").toEqual([]);
    // 分母证人：这一场的盘上事实确实是真，翻面冲动来自盘而不是来自守卫
    expect(await scheduled(runner, hasTasks)).toBe(true);
    const second = await decide(runner, hasTasks);
    expect(second, "第二场不许给出 true——那正是「模型看得见五件、只吃得到 unknown tool」那一步").toBe(false);
    expect(() => install({ automation: second })).not.toThrow("同源的值喂给执行面必须空转，不能炸掉这一场 run");
    expect(new Set(automationSlice(specFace(second)))).toEqual(new Set(execFace()));
  });

  it("第一场真 ⇒ 第二场盘上没任务也留着（不出现「能调看不见」）", async () => {
    const { runner, install, execFace } = await freshRunner();
    const empty = await workspaceWith(undefined);
    const first = await decide(runner, await workspaceWith([VALID_TASK]));
    install({ automation: first });
    expect(execFace()).toEqual([...AUTOMATION_TOOL_NAMES]);
    expect(await scheduled(runner, empty), "分母证人：第二场的盘上事实确实是假").toBe(false);
    const second = await decide(runner, empty);
    expect(second, "执行面已装了五件 ⇒ 规格面不许把说明书摘掉（那就是「调得到却看不见」）").toBe(true);
    expect(() => install({ automation: second })).not.toThrow();
    expect(new Set(automationSlice(specFace(second)))).toEqual(new Set(execFace()));
  });

  it("一次性进程的显式摘除照样赢（CLI 的 automationTools:false 没被新判据顶翻）", async () => {
    const { runner } = await freshRunner();
    const hasTasks = await workspaceWith([VALID_TASK]);
    // 盘上有清单，但调用方明说"这是一次性进程"⇒ 显式 false 优先（tests/cli-surface.test.ts 钉的那格）
    expect(await decide(runner, hasTasks, false), "显式 false 必须赢过盘上事实").toBe(false);
    // 反向对照：同一个工作区不给显式值 ⇒ 盘上事实说话
    const { runner: fresh } = await freshRunner();
    expect(await decide(fresh, await workspaceWith([VALID_TASK]))).toBe(true);
  });

  it("接线证人：runAgent 把判据写回两面**共用**的那一个字段，而不是新起第三把开关", () => {
    const src = readFileSync(join(ROOT, "src", "main", "agent-runner.ts"), "utf8");
    const writeBack = "opts.automationTools = await installTimeAutomationFace(opts.workspace, opts.automationTools);";
    expect(src.split(writeBack).length - 1, "写回只能有一处（两处就是两把尺各自漂）").toBe(1);
    const at = src.indexOf(writeBack);
    const install = src.indexOf("installAppTools({ automation: opts.automationTools,");
    const faceArgs = src.indexOf("automationTools: opts.automationTools,");
    expect(install, "执行面那一行必须还在（tests/automation-tool-surface.test.ts 钉的就是它）").toBeGreaterThan(-1);
    expect(faceArgs, "规格面 faceArgs 那一行必须还在").toBeGreaterThan(-1);
    expect(at, "判据必须在喂给两面之前就算好并写回").toBeGreaterThan(-1);
    expect(at).toBeLessThan(install);
    expect(at).toBeLessThan(faceArgs);
  });
});

/* ------------------------------------------------------------------ ④ 读盘边界 */
describe("④ 读盘判据的边界（不存在／空／坏／非目标工作区）", () => {
  it("文件不存在 ⇒ 假；合法一条 ⇒ 真；合法两条 ⇒ 真", async () => {
    const { runner } = await freshRunner();
    expect(await scheduled(runner, await workspaceWith(undefined)), "没有文件必须判假").toBe(false);
    expect(await scheduled(runner, await workspaceWith([VALID_TASK]))).toBe(true);
    expect(await scheduled(runner, await workspaceWith([VALID_TASK, { ...VALID_TASK, name: "周报" }])),
      "多条任务不改变读数").toBe(true);
  });

  it("空文件／只有空白／空清单 ⇒ 假（0 字节不等于「有任务」）", async () => {
    const { runner } = await freshRunner();
    expect(await scheduled(runner, await workspaceWith("")), "0 字节文件不是「有任务」").toBe(false);
    expect(await scheduled(runner, await workspaceWith("   ")), "只有空白也不是").toBe(false);
    expect(await scheduled(runner, await workspaceWith([])), "tasks 为空数组 = 没有任务").toBe(false);
  });

  it("坏 JSON 与全条目无效 ⇒ 假；有效与无效混排 ⇒ 真（口径同 loadAutomationsFile：跳过坏条目）", async () => {
    const { runner } = await freshRunner();
    expect(await scheduled(runner, await workspaceWith("{ not json")), "坏 JSON 按「没有」处理").toBe(false);
    expect(await scheduled(runner, await workspaceWith([INVALID_TASK])), "全被 loader 跳过 = 没有任务").toBe(false);
    expect(await scheduled(runner, await workspaceWith([INVALID_TASK, VALID_TASK]))).toBe(true);
    // 判别力证人：INVALID 确实进不了 loader（否则上面那条 false 是白给的）
    expect(await scheduled(runner, await workspaceWith([VALID_TASK]))).toBe(true);
  });

  it("非目标工作区：清单写在 A 不算 B 的（判据按本场 workspace 取料，不串门）", async () => {
    const { runner } = await freshRunner();
    const a = await workspaceWith([VALID_TASK]);
    const b = await workspaceWith(undefined);
    expect(await scheduled(runner, a)).toBe(true);
    expect(await scheduled(runner, b), "B 的盘上没有清单，必须判假").toBe(false);
    // 再读一次 B：A 的清单不会因为在同进程里被读过就把 B 点亮（读端本身不带粘性）
    expect(await scheduled(runner, b)).toBe(false);
  });

  it("本进程起过调度器 ⇒ 判据真，且 stopScheduler 之后不回退（单调真值，不是 getScheduler() 的后出现）", async () => {
    const { runner, install, execFace } = await freshRunner();
    const ws = await workspaceWith(undefined);
    expect(await decide(runner, ws), "初始化之前盘上没有清单 ⇒ 假").toBe(false);
    (runner.initScheduler as (o: { dataDir: string; sessionsDir: string; workspace: string }) => void)({
      dataDir: join(ws, ".agent", "schedules"), sessionsDir: join(ws, ".agent", "sessions"), workspace: ws,
    });
    expect(await decide(runner, ws), "调度器已初始化 = 本进程用得上五件").toBe(true);
    (runner.stopScheduler as () => void)();
    expect(await decide(runner, ws), "stop 之后不许回退成假——执行面已按真装好，翻面就是两面分家").toBe(true);
    install({ automation: await decide(runner, ws) });
    expect(execFace()).toEqual([...AUTOMATION_TOOL_NAMES]);
  });

  it("serve 常驻入口就是「用得上」那条：跑过 serveScheduler 的进程里两面都齐全", async () => {
    const { runner, execFace } = await freshRunner();
    const ws = await workspaceWith(undefined); // 盘上此刻还没有任务
    expect(await decide(runner, ws), "入口之前：判据假（这条是给下面那条当分母的）").toBe(false);
    const handle = await (runner.serveScheduler as (o: { workspace: string }) => Promise<{ stop: () => void }>)({ workspace: ws });
    try {
      expect(execFace(), "常驻入口必须把五件装上执行面").toEqual([...AUTOMATION_TOOL_NAMES]);
      const on = await decide(runner, ws);
      expect(on, "起了调度器 ⇒ 判据必须跟着真，规格面与执行面同源").toBe(true);
      expect(new Set(automationSlice(specFace(on)))).toEqual(new Set(execFace()));
    } finally {
      handle.stop();
    }
  });
});
