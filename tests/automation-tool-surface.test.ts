// 判卷 · 定时任务五件的模型面（能力 3 工具面 × 能力 4 长任务 × 能力 9 成本）
//
// 实测缺口（第 42 页）：`installAutomationTools()` 一直只装实现
// （`table["automation_create"] = { name, run }`），`gateToolSpecs("auto")` 里**一个都没有**
// ⇒ 模型看不见 = 发不出去；而 G-B 三面判卷的实例面解析器只认
// `(TOOLS as …).x =` 那一形，所以这道门从头到尾没看过它们。本文件钉补上的那一半：
// 规格在场、字段名与校验器同源、只读档摘除，外加**面成本自己有帽**（新增规格是每次请求都付的字节）。
import { describe, expect, it } from "vitest";
import { AUTOMATION_MODEL_FIELDS, AUTOMATION_SCHEDULE_KINDS, AUTOMATION_TOOLS, AUTOMATION_TOOL_NAMES, automationToolSpecs } from "../src/agent/automation-surface";
import { gateToolSpecs } from "../src/agent/glm-session";
import { KNOWN_TOP_FIELDS, FORM_KINDS } from "../src/main/automations";

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
