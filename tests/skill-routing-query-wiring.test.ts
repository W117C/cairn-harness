// #73 第二半（A 类）的证人：路由清单的**相关性排序在装配面与生产接线两处都真的通**。
//
// 分两层是刻意的（本仓记过多次「两头断」）：
//  ① 纯函数 `buildSkillRoutingList(skills, extra, query)` 的排序已由 `tests/skill-routing-tiering.test.ts` 钉；
//     本文件钉**装配面** `PluginRuntime.routingList(query)` 有没有把 `query` 递下去——
//     那正是最容易"实现写好了但没人传"的一格（第 370 页只落了纯函数侧，生产调用点当时仍不传）。
//  ② 生产调用点（`src/main/agent-runner.ts`）必须把**本轮任务文本**递进去；这一格只能钉形状，
//     所以同时钉"旧形状不许回来"（不带参数调、以及同一份清单调两遍）。
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PluginRuntime } from "../src/agent/plugins";
import { SKILL_ROUTING_CHAR_LIMIT } from "../src/agent/plugins/skills";

const cleanups: string[] = [];
afterAll(async () => {
  for (const d of cleanups) await rm(d, { recursive: true, force: true });
});

/** 三条 skill：描述都长到任意两条就破 1536 ⇒ 「谁被完整列出」只能由相关性决定。 */
async function loadTrustedRuntime(): Promise<PluginRuntime> {
  const dir = await mkdtemp(join(tmpdir(), "dsh-routing-query-"));
  cleanups.push(dir);
  const opts = {
    userPluginsDir: join(dir, "user-plugins"),
    workspace: dir,
    pluginDataRoot: join(dir, "plugin-data"),
    trustFile: join(dir, "trust.json"),
    home: dir,
  };
  const pluginDir = join(dir, "user-plugins", "crew");
  // 插件要有清单才被发现（`discoverPlugins` 读 `.claude-plugin/plugin.json`）；
  // 少了这一份就是"目录在、插件不算"，三条 skill 一条也不会进清单。
  await mkdir(join(pluginDir, ".claude-plugin"), { recursive: true });
  await writeFile(join(pluginDir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "crew" }), "utf8");
  const entries: Array<[string, string]> = [
    ["csv-import", "把外部 CSV 表格导入成仓储内的记录，处理字段映射、编码与去重，并给出导入后的一致性校验报告。"],
    ["weekly-report", "汇总一周内的改动生成周报草稿，按人、按主题分组，并把没有证据支撑的句子标成待确认。"],
    ["db-migrate", "生成数据库 schema 迁移脚本，处理 postgres 与 sqlite 的方言差异、回滚顺序与锁表窗口。"],
  ];
  for (const [name, desc] of entries) {
    await mkdir(join(pluginDir, "skills", name), { recursive: true });
    // 描述垫长：任一完整行都接近半份预算 ⇒ 预算只装得下一条完整行。
    const padded = desc + " 细节与边界说明。".repeat(60);
    await writeFile(
      join(pluginDir, "skills", name, "SKILL.md"),
      "---\nname: " + name + "\ndescription: " + padded + "\n---\n\n正文。\n",
      "utf8",
    );
  }
  const first = await PluginRuntime.load(opts);
  await first.trustDecide("crew", true);
  // 信任状态是装载期读的 ⇒ 授完信再装一次，拿到的才是"可信且可模型触发"的那份清单。
  return await PluginRuntime.load(opts);
}

describe("装配面：routingList(query) 把相关性递到清单里", () => {
  let rt: PluginRuntime;
  beforeAll(async () => {
    rt = await loadTrustedRuntime();
  });

  it("分母非零：三条都进了清单，但完整行装不下三条（否则这条判卷是空载）", () => {
    expect(rt.skills().length).toBe(3);
    const plain = rt.routingList();
    expect(plain.truncated, "三条长描述必然超预算").toBe(true);
    expect(plain.text.length).toBeLessThanOrEqual(SKILL_ROUTING_CHAR_LIMIT);
    expect(plain.dropped + plain.nameOnly).toBeGreaterThan(0);
  });

  it("问迁移 ⇒ db-migrate 排到最前；问周报 ⇒ 换它排到最前（同一份预算，谁在前由 query 决定）", () => {
    const byMigration = rt.routingList("帮我把数据库 schema 迁移到 postgres，注意回滚顺序");
    const byReport = rt.routingList("生成本周周报草稿，按人分组");
    const fullLineCount = (text: string): number => text.split("\n").filter((l) => /^- \/crew:[\w-]+ — /u.test(l)).length;
    // 分母形状：三条都在（完整行 or 只列名字），且完整行数不超预算给的量
    for (const r of [byMigration, byReport]) {
      expect(r.text.length).toBeLessThanOrEqual(SKILL_ROUTING_CHAR_LIMIT);
      expect(r.dropped + r.nameOnly + fullLineCount(r.text)).toBe(3);
    }
    // 断言"排序"而不是"缺席"：预算装得下两条完整行，被问到的那条必须在另一条之前
    //（另一条也可能只降到"只列名字"那一档 ⇒ 缺席同样算排得靠后，用 === -1 收进同一个判据）。
    const migPos = byMigration.text.indexOf("/crew:db-migrate — ");
    const repPos = byReport.text.indexOf("/crew:weekly-report — ");
    expect(migPos, "问迁移时 db-migrate 得有完整行").toBeGreaterThanOrEqual(0);
    expect(repPos, "问周报时 weekly-report 得有完整行").toBeGreaterThanOrEqual(0);
    const otherInMig = byMigration.text.indexOf("/crew:weekly-report — ");
    const otherInRep = byReport.text.indexOf("/crew:db-migrate — ");
    expect(otherInMig === -1 || migPos < otherInMig).toBe(true);
    expect(otherInRep === -1 || repPos < otherInRep).toBe(true);
    // 两条 query 给出的清单必须**不同**（相同就等于 query 没被递下去——装配面那一格正是本文件要盯的）
    expect(byMigration.text).not.toBe(byReport.text);
  });

  it("query 缺省与不命中 ⇒ 逐字等于从前（零回归面：不许把无关的跑也 reorder）", () => {
    expect(rt.routingList("").text).toBe(rt.routingList().text);
    expect(rt.routingList("xyzzy 完全不相关的词").text).toBe(rt.routingList().text);
  });
});

describe("生产接线：agent-runner 把本轮任务文本递进去", () => {
  it("调的是 routingList(promptText)，且同一份清单只算一次（旧形状不许回来）", async () => {
    const src = await readFile("src/main/agent-runner.ts", "utf8");
    expect(src, "生产调用点必须把任务文本递进去（相关性排序不接上＝纯函数白写）").toContain("rt.routingList(promptText)");
    expect(src, "同一份清单调两遍是白付钱，且那个形状一回来就代表 query 又没人传了").not.toContain("rt.routingList().text");
  });
});
