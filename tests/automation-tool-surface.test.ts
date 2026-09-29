// 判卷 · 定时任务五件的模型面（能力 3 工具面 × 能力 4 长任务 × 能力 9 成本）
//
// 实测缺口（第 42 页）：`installAutomationTools()` 一直只装实现
// （`table["automation_create"] = { name, run }`），`gateToolSpecs("auto")` 里**一个都没有**
// ⇒ 模型看不见 = 发不出去；而 G-B 三面判卷的实例面解析器只认
// `(TOOLS as …).x =` 那一形，所以这道门从头到尾没看过它们。本文件钉补上的那一半：
// 规格在场、字段名与校验器同源、只读档摘除，外加**面成本自己有帽**（新增规格是每次请求都付的字节）。
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AUTOMATION_MODEL_FIELDS, AUTOMATION_SCHEDULE_KINDS, AUTOMATION_TOOLS, AUTOMATION_TOOL_NAMES, automationToolSpecs } from "../src/agent/automation-surface";
import { gateToolSpecs } from "../src/agent/glm-session";
import { KNOWN_TOP_FIELDS, FORM_KINDS } from "../src/main/automations";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const names = (mode?: "auto" | "read-only") => new Set(gateToolSpecs(mode ?? "auto").map((s) => s.function.name));
const specOf = (name: string) => automationToolSpecs().find((s) => s.function.name === name);
const propsOf = (name: string): string[] =>
  Object.keys((specOf(name)!.function.parameters as { properties: Record<string, unknown> }).properties);
/** 规格里出现、校验器不认的字段（= 模型照规格写会被拒成「未知字段」）。也供反向对照复用。 */
function undeclared(fields: readonly string[]): string[] {
  return fields.filter((f) => !KNOWN_TOP_FIELDS.has(f));
}

describe("定时五件在模型面上", () => {
  it("五个名字全部出现在 auto 档（以前是 0 个 = 能力发了但模型发不出去）", () => {
    const auto = names("auto");
    expect(AUTOMATION_TOOL_NAMES.filter((n) => !auto.has(n))).toEqual([]);
    expect(AUTOMATION_TOOL_NAMES.length).toBe(5);
  });

  it("只读档整族摘除（只读会话不该能排一次无人值守的写盘）", () => {
    const ro = names("read-only");
    for (const n of AUTOMATION_TOOL_NAMES) expect(ro.has(n), n + " 不该出现在只读档").toBe(false);
  });

  it("worker 两面都不给（与 WORKER_FORBIDDEN_TOOLS 的声明一致，不靠人记）", async () => {
    const { WORKER_FORBIDDEN_TOOLS } = await import("../src/agent/orchestrator-config");
    for (const n of AUTOMATION_TOOL_NAMES) expect(WORKER_FORBIDDEN_TOOLS, n + " 没在 worker 禁入名单里").toContain(n);
  });
});

describe("规格与校验器同源（规格不许发明字段）", () => {
  it("每个工具申报的字段都在 KNOWN_TOP_FIELDS 里", () => {
    for (const t of AUTOMATION_TOOLS) {
      expect(undeclared(t.fields), t.name + " 有校验器不认的字段").toEqual([]);
    }
  });

  it("反向对照：发明一个字段时上面那条判据真会抓（不然它是恒真式）", () => {
    expect(undeclared(["name", "bogus_field"])).toEqual(["bogus_field"]);
  });

  it("required 与实现真读的关键字段一致（create 三件、改/删/触发要 id、list 无参）", () => {
    const req = (n: string) => (specOf(n)!.function.parameters as { required: string[] }).required;
    expect(req("automation_create")).toEqual(["name", "prompt", "schedule"]);
    expect(req("automation_update")).toEqual(["id"]);
    expect(req("automation_delete")).toEqual(["id"]);
    expect(req("automation_run_now")).toEqual(["id"]);
    expect(req("automation_list")).toEqual([]);
  });

  it("schedule 描述点名的 kind 全在校验器表单路接受的集合内（不承诺发不出去的形状）", () => {
    const doc = (specOf("automation_create")!.function.parameters as { properties: Record<string, { description?: string }> })
      .properties.schedule.description ?? "";
    // kind 清单与描述同源（描述由 AUTOMATION_SCHEDULE_KINDS 拼出来，两边不可能各写一份）
    expect(AUTOMATION_SCHEDULE_KINDS.length).toBeGreaterThan(0);
    for (const k of AUTOMATION_SCHEDULE_KINDS) {
      expect(FORM_KINDS, k + " 不在表单接受的 kind 里（模型写了必被拒）").toContain(k);
      expect(doc, "描述里没写出 " + k + " 这个 kind").toContain(k);
    }
  });

  it("五件不算 core 面（固定面每次请求都付字节，低频族要能被降配梯砍掉）", async () => {
    const { isCoreSurfaceTool } = await import("../src/agent/glm-session");
    for (const n of AUTOMATION_TOOL_NAMES) expect(isCoreSurfaceTool(n), n + " 被当成 core ⇒ 永远砍不掉").toBe(false);
    // 反向那一半：常用原语仍必须是 core，否则这条判据只是在为"全都可砍"背书
    for (const n of ["read_file", "edit_file", "spawn_agent"]) expect(isCoreSurfaceTool(n), n + " 不该被砍").toBe(true);
  });

  it("每个申报字段都得有描述（只给名字 = 让模型猜语义）", () => {
    for (const t of AUTOMATION_TOOLS) {
      const props = (specOf(t.name)!.function.parameters as { properties: Record<string, { description?: string; type?: string }> }).properties;
      for (const [k, v] of Object.entries(props)) {
        expect(v.description, t.name + "." + k + " 缺描述").toBeTruthy();
        expect(v.type, t.name + "." + k + " 缺类型").toBeTruthy();
      }
    }
    // 表里的字段与 create 的 properties 同集合（两边漂移=一份事实源被抄第二遍）
    expect(propsOf("automation_create").sort()).toEqual([...AUTOMATION_MODEL_FIELDS].sort());
  });

  it("面成本自己有帽：五件规格合计字符数 ≤ 2600（固定面每次请求都进前缀，涨没涨要有人报数）", () => {
    const chars = JSON.stringify(automationToolSpecs()).length;
    // 实测 2026-09-24：2482。帽给 2600 —— 超了说明有人往描述里加散文，而不是加字段。
    expect(chars, "五件规格 " + String(chars) + " 字符，超帽").toBeLessThanOrEqual(2600);
  });
});

/* 一次性进程（CLI）摘掉定时五件 —— 摘的时候**两面必须同时摘**，这是本仓反复栽的同一个形状。
   规格面在 `gateToolSpecs`（glm-session.ts:360 无条件 `push(...automationToolSpecs())`），
   执行面在 `installAppTools`（agent-runner）。只摘一头都会比现状更糟：
     只摘实现 ⇒ 模型看得见、只吃得到 `unknown tool: automation_create`（比现状那句
                  「调度器未初始化（fail-closed）」更难懂，还白烧一轮）；
     只摘规格 ⇒ 模型看得见工具却永远建不成，那正是「存在 ≠ 接线」本身。
   判据只有一个：**两面吃的是同一个 `automationTools` 字段**。 */
describe("automationTools:false —— 规格面与执行面一起摘（同一个字段喂两处）", () => {
  it("模型面：false 时五个全没，缺省时五个全在", async () => {
    const { sessionToolFace } = await import("../src/main/agent-runner");
    const on = new Set(sessionToolFace(null, { mode: "auto" }).tools.map((t) => t.function.name));
    const off = new Set(sessionToolFace(null, { mode: "auto", automationTools: false }).tools.map((t) => t.function.name));
    expect(AUTOMATION_TOOL_NAMES.filter((n) => !on.has(n))).toEqual([]);
    expect(AUTOMATION_TOOL_NAMES.filter((n) => off.has(n))).toEqual([]);
  });

  it("**只**摘这五个：其余工具面逐字不动（多摘一个就是无理由改产品）", async () => {
    const { sessionToolFace } = await import("../src/main/agent-runner");
    const on = sessionToolFace(null, { mode: "auto" }).tools.map((t) => t.function.name);
    const off = sessionToolFace(null, { mode: "auto", automationTools: false }).tools.map((t) => t.function.name);
    const dropped = on.filter((n) => !off.includes(n));
    // 顺序也照旧：摘掉之后剩下的是同一张表的前后两段，不许重排
    expect([...dropped].sort()).toEqual([...AUTOMATION_TOOL_NAMES].sort());
    expect(off).toEqual(on.filter((n) => !AUTOMATION_TOOL_NAMES.includes(n)));
  });

  it("执行面读的是同一个字段（改一面忘另一面 = 本文件开头那条失败形状）", () => {
    const runner = readFileSync(join(ROOT, "src", "main", "agent-runner.ts"), "utf8");
    // 执行面：installAppTools 的 opt-out 吃 opts.automationTools
    expect(runner).toContain("installAppTools({ automation: opts.automationTools })");
    // 规格面：同一个字段经 faceArgs 进 sessionToolFace
    expect(runner).toContain("automationTools: opts.automationTools,");
    // 两面在同一个函数里汇到一处：漏了任一条拼接，下面那条 specFace 摘除就没人喂
    expect(runner).toMatch(/automationTools === false[\s\S]{0,120}AUTOMATION_TOOL_NAMES\.includes/);
  });

  it("反向对照：这张面确实随参数变（否则上面两条可能全在空转）", async () => {
    const { sessionToolFace } = await import("../src/main/agent-runner");
    const namesOf = (o: { mode: "auto" | "read-only"; automationTools?: boolean }): string[] =>
      sessionToolFace(null, o).tools.map((t) => t.function.name);
    // 缺省 = 装（长驻服务语义），显式 true 必须与之逐字相同：默认与显式反着来就是另一个静默不一致
    expect(namesOf({ mode: "auto", automationTools: true })).toEqual(namesOf({ mode: "auto" }));
    // 只读档摘得比 automationTools 更多 ⇒ 两个摘除开关各自在动，不是同一条路
    expect(namesOf({ mode: "read-only" }).length).toBeLessThan(namesOf({ mode: "auto", automationTools: false }).length);
  });
});

/* 执行面是**进程级**的：TOOLS 是全局表，`installAppTools` 的守卫只让第一个调用赢。
   `automationTools` 却是**每场 run** 的槽（规格面 faceArgs 每场重算，见上一块）。粒度对不上时
   ——第二场给出与第一场不同的值——规格面照新值重算、执行面不照做 ⇒ 模型看得见五件、只吃得到
   `unknown tool`。同值重复（goal 续跑一轮轮传同一个值）必须照旧空转。
   这块直接执行 `installAppTools` 并读 `TOOLS`：**装/摘是纯注册**（`installAutomationTools` 只挂
   闭包，不碰 `initScheduler`），所以起主进程那句话对这一格不成立。 */
describe("执行面的进程级守卫：同值空转、异值当场拒（M-2）", () => {
  /** 每次都从干净的模块注册表起步：`installed` 是模块级状态，测完一条就作废。 */
  async function freshInstall() {
    vi.resetModules();
    const { installAppTools } = await import("../src/main/agent-runner");
    const { TOOLS } = await import("../src/tools");
    const present = () => AUTOMATION_TOOL_NAMES.filter((n) => n in TOOLS);
    return { install: installAppTools, present };
  }

  it("第一场说 false ⇒ 五件一个都不在 TOOLS 上（这才是执行面被摘掉的样子）", async () => {
    const { install, present } = await freshInstall();
    install({ automation: false });
    expect(present()).toEqual([]);
  });

  it("第一场说装 ⇒ 五件全在（缺省与显式 true 同义，反着来就是另一个静默不一致）", async () => {
    const { install, present } = await freshInstall();
    install();
    expect(present()).toEqual([...AUTOMATION_TOOL_NAMES]);
  });

  it("同值重复照旧空转：goal 续跑一轮轮传同一个值，不能第二轮就炸", async () => {
    const { install, present } = await freshInstall();
    install({ automation: false });
    for (let turn = 0; turn < 27; turn++) install({ automation: false });
    expect(present()).toEqual([]);
  });

  it("异值当场拒：先 false 后装 ⇒ 抛，且点名两面（否则模型看得见却调不到）", async () => {
    const { install, present } = await freshInstall();
    install({ automation: false });
    expect(() => install()).toThrow(/automationTools 与第一场不一致/);
    expect(present(), "抛了也不许偷偷补装——那正是让两面分家的那一步").toEqual([]);
  });

  it("反方向同样拒：先装后 false ⇒ 抛（只堵一个方向等于把另一半留给下一个人）", async () => {
    const { install, present } = await freshInstall();
    install();
    expect(() => install({ automation: false })).toThrow(/automationTools 与第一场不一致/);
    expect(present()).toEqual([...AUTOMATION_TOOL_NAMES]);
  });
});
