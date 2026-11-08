// `buildSkillRoutingList` 的"同一预算多装一档"改动（台账第 368/370 页）。
// 为什么单开一支：这条改动只有一个可观测目标——**超预算时别让条目整条消失**，
// 所以判据全在"清单文本与预算"这一层，不去碰 skill 的加载/信任（那些有 `plugins-check` 与既有测例）。
import { describe, expect, it } from "vitest";
import {
  SKILL_ROUTING_CHAR_LIMIT,
  SKILL_ROUTING_DESC_CHAR_LIMIT,
  buildSkillRoutingList,
  capRoutingText,
  routingQueryTokens,
  routingRelevance,
  skillRoutingLine,
  type RoutingSkillInput,
} from "../src/agent/plugins/skills";

const mk = (n: number, desc: string): RoutingSkillInput[] =>
  Array.from({ length: n }, (_, i) => ({ plugin: "p" + String(i), name: "s" + String(i), description: desc }));

describe("零回归面（装得下就一字不改）", () => {
  it("小清单：输出与从前逐字相同，且没有降级标记", () => {
    const skills: RoutingSkillInput[] = [
      { plugin: null, name: "alpha", description: "做 A" },
      { plugin: "demo", name: "beta", description: "做 B", frontmatter: { when_to_use: "要 B 时" } },
    ];
    const r = buildSkillRoutingList(skills, ["- crew:scout — 侦察（可用作 pipeline stages[].role）"]);
    expect(r.text).toBe(
      "- /alpha — 做 A\n- /demo:beta — 做 B（适用：要 B 时）\n- crew:scout — 侦察（可用作 pipeline stages[].role）",
    );
    expect(r).toMatchObject({ truncated: false, dropped: 0, nameOnly: 0 });
    expect(r.text).not.toContain("只列了名字");
  });

  it("缺省 query（调用方还没接线的今天）⇒ skill 之间顺序与从前一致，不重排", () => {
    const r = buildSkillRoutingList(mk(40, "d".repeat(200)));
    const firstKept = r.text.split("\n")[0]!;
    expect(firstKept.startsWith("- /p0:")).toBe(true); // 发现序第一行仍是第一条
  });
});

describe("超预算那一档", () => {
  it("40 条长描述：不整条丢——降级成只列名字继续填，且预算不变量成立", () => {
    const skills = mk(40, "d".repeat(200));
    const r = buildSkillRoutingList(skills);
    expect(r.text.length).toBeLessThanOrEqual(SKILL_ROUTING_CHAR_LIMIT);
    expect(r.truncated).toBe(true);
    expect(r.nameOnly).toBeGreaterThan(0);
    const lines = r.text.split("\n");
    const listed = lines.filter((l) => l.startsWith("- ")).length;
    expect(r.dropped).toBe(Math.max(0, 40 + 0 - listed));
    expect(r.text).toContain("只列了名字");
    // 降级的行只有名字：不带 " — " 分隔符
    expect(lines.some((l) => l.startsWith("- /p") && !l.includes(" — "))).toBe(true);
  });

  it("标记行里两个数都出声（少 1 条与少 40 条不能让模型读成同一句）", () => {
    const r = buildSkillRoutingList(mk(40, "d".repeat(200)));
    const marker = r.text.split("\n").find((l) => l.startsWith("[清单超")) ?? "";
    expect(marker).toContain(String(r.nameOnly) + " 条只列了名字");
    expect(marker).toContain("另有 " + String(r.dropped) + " 条未列出");
  });

  it("极端输入不外抛：单条超长描述／空描述／500 条", () => {
    expect(() => buildSkillRoutingList([{ plugin: null, name: "big", description: "z".repeat(9000) }])).not.toThrow();
    const empty = buildSkillRoutingList(mk(600, ""));
    expect(empty.text.length).toBeLessThanOrEqual(SKILL_ROUTING_CHAR_LIMIT);
  });

  it("反向守卫：disable-model-invocation 的条目连名字都不该出现", () => {
    const skills: RoutingSkillInput[] = [
      ...mk(30, "d".repeat(120)),
      { plugin: "secret", name: "hidden", description: "d".repeat(120), frontmatter: { "disable-model-invocation": true } },
    ];
    const r = buildSkillRoutingList(skills);
    expect(r.text).not.toContain("/secret:hidden");
  });

  it("合并语义没被降级档破坏：角色行与 skill 同一份预算、同一个 dropped 口径", () => {
    const role = "- crew:scout — 侦察（可用作 pipeline stages[].role）";
    const r = buildSkillRoutingList(mk(40, "d".repeat(200)), [role]);
    const listed = r.text.split("\n").filter((l) => l.startsWith("- ")).length;
    expect(r.dropped + listed).toBe(41); // 40 条 skill + 1 条角色行，一个数
  });
});

describe("单条描述帽（300 字符）", () => {
  it("长描述只占一条 300 帽，短条目仍保留完整行（不整条吃光总预算）", () => {
    const r = buildSkillRoutingList([
      { plugin: "big", name: "verbose", description: "长".repeat(2000) },
      { plugin: "small", name: "tiny", description: "短描述" },
    ]);
    const line = r.text.split("\n").find((l) => l.startsWith("- /big:verbose"))!;
    const desc = line.slice("- /big:verbose — ".length);
    expect(desc.length).toBeLessThanOrEqual(SKILL_ROUTING_DESC_CHAR_LIMIT);
    expect(desc.endsWith("…")).toBe(true);
    expect(r.text).toContain("- /small:tiny — 短描述");
    expect(r.truncated).toBe(false); // 两条都在总帽内，单条帽不是总帽的替代
  });

  it("description + when_to_use 合并后仍只占一条 300 帽", () => {
    const line = skillRoutingLine({
      plugin: null,
      name: "x",
      description: "d".repeat(200),
      frontmatter: { when_to_use: "w".repeat(200) },
    });
    const desc = line.slice("- /x — ".length);
    expect(desc.length).toBeLessThanOrEqual(SKILL_ROUTING_DESC_CHAR_LIMIT);
    expect(desc).toContain("…");
  });

  it("短文本逐字不变（零回归），角色行同一份归一口径", () => {
    expect(capRoutingText("短 描述")).toBe("短 描述");
    expect(capRoutingText("x".repeat(1000))).toHaveLength(SKILL_ROUTING_DESC_CHAR_LIMIT);
  });
});

describe("相关性排序（检索式的这一半，query 由调用方给）", () => {
  it("命中查询词的那条拿完整行——哪怕它在发现序里排最后", () => {
    const skills: RoutingSkillInput[] = [
      ...mk(25, "通用描述".repeat(12)),
      { plugin: "svg", name: "render", description: "把图表渲染成 svg 并校验 viewBox" },
    ];
    const r = buildSkillRoutingList(skills, [], "帮我把图表渲染成 svg");
    const first = r.text.split("\n")[0]!;
    expect(first).toContain("/svg:render");
    expect(first).toContain("viewBox"); // 完整行，不是降级
  });

  it("中文查询召得回（分词走二元组，不是整段比对）", () => {
    const q = routingQueryTokens("帮我把图表渲染成 svg 文件");
    expect(q.has("渲染")).toBe(true);
    expect(q.has("svg")).toBe(true);
    const hit = routingRelevance(q, { plugin: "svg", name: "render", description: "把图表渲染成 svg" });
    const miss = routingRelevance(q, { plugin: "other", name: "pdf", description: "导出 pdf 报表" });
    expect(hit).toBeGreaterThan(miss);
    expect(miss).toBe(0);
  });

  it("名字命中比描述命中更重（同名不同描述时别把不相关的那条顶上来）", () => {
    const q = routingQueryTokens("pdf");
    const byName = routingRelevance(q, { plugin: null, name: "pdf-export", description: "无关说明" });
    const byDesc = routingRelevance(q, { plugin: null, name: "misc", description: "偶尔提到 pdf 一次" });
    expect(byName).toBeGreaterThan(byDesc);
  });
});
