// M2e 任务 3/4 单测：frontmatter 全量字段解析 / 渐进披露 1536 截断 / 触发全文 /
// $ARGUMENTS·$1 替换（含缺省行为）/ 压缩后重挂预算（单 5000 / 合 25000）/ 激活的事件流投影。
import { describe, expect, it } from "vitest";
import { cp, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseFrontmatter, buildSkillRoutingList, substituteVars, renderPromptCommand,
  skillRemount, clampSkillBody, estimateTokens, activationsFromEvents,
  SKILL_ROUTING_CHAR_LIMIT, SKILL_REMOUNT_TOKENS_PER_SKILL, SKILL_REMOUNT_TOKENS_TOTAL,
  PluginRuntime,
} from "../src/agent/plugins";
import type { AgentEvent } from "../src/events";

function fx(...parts: string[]): string {
  return join(process.cwd(), "fixtures", "plugins", ...parts);
}

describe("M2e skill：frontmatter 与路由清单（任务 3）", () => {
  it("frontmatter 全量字段解析（标量/数组/嵌套/正文分离）", () => {
    const text = [
      "---",
      "name: greet",
      'description: 用固定句式打招呼。',
      "argument-hint: [名字]",
      "allowed-tools: read_file, glob",
      "metadata:",
      "  author: m2e",
      "  level: 3",
      "---",
      "",
      "# 正文",
    ].join("\n");
    const { frontmatter, body } = parseFrontmatter(text);
    expect(frontmatter["name"]).toBe("greet");
    expect(frontmatter["description"]).toBe("用固定句式打招呼。");
    expect(frontmatter["argument-hint"]).toEqual(["名字"]); // YAML 行内数组语义
    expect(frontmatter["allowed-tools"]).toBe("read_file, glob");
    expect(frontmatter["metadata"]).toEqual({ author: "m2e", level: 3 });
    expect(body).toContain("# 正文");
  });

  it("无 frontmatter 的 markdown 原样返回", () => {
    const { frontmatter, body } = parseFrontmatter("# 只有正文\n第二行");
    expect(frontmatter).toEqual({});
    expect(body).toContain("第二行");
  });

  it("路由清单 = /plugin:name — description；超 1536 字符截断且不出半个条目", () => {
    const skills = [
      { plugin: "a", name: "one", description: "短描述" },
      { plugin: "a", name: "two", description: "x".repeat(2000) },
      { plugin: "b", name: "three", description: "y".repeat(2000) },
      { plugin: null, name: "loose", description: "散装" },
    ];
    const r = buildSkillRoutingList(skills);
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBeLessThanOrEqual(SKILL_ROUTING_CHAR_LIMIT);
    expect(r.text).toContain("/a:one — 短描述");
    expect(r.text).toContain("已截断");
    expect(r.text.endsWith("— 短描述") || r.text.split("\n").every((l) => l.startsWith("- ") || l.startsWith("[") || l === "")).toBe(true);
    // 散装 skill 无插件前缀
    expect(skillListHas(r.text, "/loose — 散装")).toBe(false); // 截断后可能被裁掉——单独验证非截断路径
    const small = buildSkillRoutingList([{ plugin: null, name: "loose", description: "散装" }]);
    expect(small.truncated).toBe(false);
    expect(small.text).toBe("- /loose — 散装");
  });
});

function skillListHas(text: string, line: string): boolean {
  return text.split("\n").includes("- " + line.replace(/^- /, ""));
}

describe("M2e skill/prompt：参数替换（任务 4 + §9.3 变量集）", () => {
  it("$ARGUMENTS 全文 / $1..$9 位置 / 缺位空串 / 未知变量原样", () => {
    expect(substituteVars("对 $ARGUMENTS 问好", { args: "张三 李四" })).toBe("对 张三 李四 问好");
    expect(substituteVars("把 $1 部署到 $2", { args: "dev us" })).toBe("把 dev 部署到 us");
    expect(substituteVars("缺位：[$9] 结束", { args: "only-one" })).toBe("缺位：[] 结束");
    expect(substituteVars("未知 $HOME 不展开", { args: "x" })).toBe("未知 $HOME 不展开");
    expect(substituteVars("无参数调用 $1", { args: "" })).toBe("无参数调用 ");
  });

  it("$name 只认 frontmatter arguments 声明过的名字（按声明序吃位置参数），未声明的原样留着", () => {
    const named = { args: "dev 9", named: ["env", "port"] };
    expect(substituteVars("部署 $env 到端口 $port", named)).toBe("部署 dev 到端口 9");
    expect(substituteVars("$env 与 $nope", named)).toBe("dev 与 $nope");
  });

  it("${} 五个变量按上下文展开，${CLAUDE_*} 作别名同值；上下文里没有的整串原样保留", () => {
    const out = substituteVars(
      "s=${SKILL_DIR} p=${PLUGIN_ROOT} d=${PLUGIN_DATA} w=${PROJECT_DIR} i=${SESSION_ID} x=${CLAUDE_PLUGIN_ROOT}",
      { skillDir: "/sd", pluginRoot: "/pr", pluginData: "/pd", projectDir: "/ws", sessionId: "s-1" },
    );
    expect(out).toBe("s=/sd p=/pr d=/pd w=/ws i=s-1 x=/pr"); // 别名与正名同一张表，值必相等
    expect(substituteVars("散装没有根：${PLUGIN_ROOT}", { skillDir: "/sd" })).toBe("散装没有根：${PLUGIN_ROOT}");
    expect(substituteVars("不认识的 ${FOO} 不动", { projectDir: "/ws" })).toBe("不认识的 ${FOO} 不动");
  });

  it("prompt command 渲染成用户消息（复用同一替换器）", () => {
    const out = renderPromptCommand(
      { plugin: "echo-suite", name: "deploy", description: "", path: "", frontmatter: {}, body: "把 $1 环境部署到 $2。" },
      "staging us-east",
    );
    expect(out).toBe("把 staging 环境部署到 us-east。");
  });
});

describe("M2e skill：渐进披露与触发全文（任务 3）", () => {
  it("触发返回全文（tool_result 携带全文进上下文）；未注册报错", async () => {
    const rt = await PluginRuntime.load({
      projectPluginsDir: fx("project"),
      looseRoots: [fx("loose")],
      workspace: process.cwd(),
      pluginDataRoot: join(tmpdir(), "m2e-skills-data"),
      trustFile: join(tmpdir(), "m2e-skills-data", "trust-skills.json"),
    });
    await rt.trustDecide("echo-suite", true); // 项目级插件首次加载 = pending，触发前先信任
    const hit = rt.triggerSkill("/echo-suite:greet");
    expect(hit.ok).toBe(true);
    expect(hit.output).toContain("# Greet Skill");
    // 无参数触发 ⇒ 变量按 CC 语义换成空串，正文里**不该再有裸 $ARGUMENTS**（夹具末行自己写着
    // 「本行验证缺位参数替换为空串」——以前这条判据反着钉：断言 $ARGUMENTS 还在，等于把缺陷冻成期望值）。
    expect(hit.output).toContain("对  说三声你好：");
    expect(hit.output).toContain("（本行验证缺位参数替换为空串： -> 结束）");
    expect(hit.output).not.toContain("$ARGUMENTS");
    const withArgs = rt.triggerSkill("/echo-suite:greet", "张三 李四");
    expect(withArgs.output).toContain("- 你好，张三！");
    const loose = rt.triggerSkill("/standalone-skill");
    expect(loose.ok).toBe(true);
    expect(loose.output).toContain("无需容器");
    const miss = rt.triggerSkill("/nope");
    expect(miss.ok).toBe(false);
    await rt.shutdown();
  });
});

describe("M2e skill：压缩后重挂预算（任务 3）", () => {
  it("未被压缩的激活不重挂；被压缩的重挂全文", () => {
    const activated = [
      { invoke: "/echo-suite:greet", body: "GREET-BODY", triggerEventId: 5, seq: 0 },
    ];
    const r = skillRemount(activated, (id) => id === 5);
    expect(r.text).not.toBeNull();
    expect(r.mounted).toEqual(["/echo-suite:greet"]);
    expect(r.text).toContain("GREET-BODY");
    const r2 = skillRemount(activated, () => false);
    expect(r2.text).toBeNull();
    expect(r2.mounted).toEqual([]);
  });

  it("单 skill 前 5000 token 截断；合计 25000 token 封顶", () => {
    const bigBody = "x".repeat(6000 * 4); // 6000 token
    const one = clampSkillBody(bigBody, SKILL_REMOUNT_TOKENS_PER_SKILL);
    expect(estimateTokens(one)).toBeLessThanOrEqual(SKILL_REMOUNT_TOKENS_PER_SKILL + 1); // chars/4 ceil 口径
    expect(one).toContain("已截断");
    // 6 个 5k skill → 合计帽 25000，只有 5 个能挂上
    const activated = Array.from({ length: 6 }, (_, i) => ({
      invoke: "/p:s" + String(i),
      body: "y".repeat(4900 * 4),
      triggerEventId: i + 1,
      seq: i,
    }));
    const r = skillRemount(activated, () => true);
    // 合计帽 25000：前 5 个各花 4900，第 6 个只剩 500 预算（最近激活优先，预算从最近的开始花）
    expect(r.tokens).toBeLessThanOrEqual(SKILL_REMOUNT_TOKENS_TOTAL);
    expect(r.mounted).toHaveLength(6);
    // 余量 = 头行 + 每块 "[invoke 压缩后重挂]" 标记。这些几乎全是中文，按「一字一 token」
    // 如实计（原 +50 是 chars/4 低估中文得出的估算器产物，见 src/agent/text-budget.ts）。
    expect(estimateTokens(r.text!)).toBeLessThanOrEqual(SKILL_REMOUNT_TOKENS_TOTAL + 200);
    // 最近激活优先（seq 大的先占预算）
    expect(r.mounted[0]).toBe("/p:s5");
  });
});

describe("M2e skill 激活的事件流投影（无隐藏状态）", () => {
  it("tool_call(skill) → 同 callId tool_result 的 1-based 行号 = 触发事件 id", () => {
    const events: AgentEvent[] = [
      { type: "user_message", content: "hi" },
      { type: "tool_call", id: "c1", name: "skill", args: { name: "/echo-suite:greet" } },
      { type: "tool_result", callId: "c1", ok: true, output: "GREET-BODY" },
      { type: "tool_call", id: "c2", name: "read_file", args: { path: "x" } },
      { type: "tool_result", callId: "c2", ok: true, output: "file" },
    ];
    const act = activationsFromEvents(events, (invoke) =>
      invoke === "/echo-suite:greet" ? { body: "GREET-BODY" } : null,
    );
    expect(act).toHaveLength(1);
    expect(act[0]!.invoke).toBe("/echo-suite:greet");
    expect(act[0]!.triggerEventId).toBe(3); // 第 3 行 = tool_result
    expect(act[0]!.body).toBe("GREET-BODY");
  });
});

// M0 复盘 P0-3：frontmatter 是外部不可信输入（未信任插件在**发现期**即被解析）。
// 旧实现用普通对象承载 + `fm[lastTop]` 直取，`__proto__:` 会取到 Object.prototype
// 并把后续嵌套行写到它上面 —— 一个恶意 SKILL.md 即可污染整个进程的对象原型。
describe("frontmatter 原型污染防护（P0-3 回归）", () => {
  it("__proto__ 行不污染 Object.prototype，也不成为 frontmatter 键", () => {
    const text = ["---", "__proto__:", "  polluted_by_dsh: yes", "---", "body"].join("\n");
    const { frontmatter } = parseFrontmatter(text);
    expect(({} as Record<string, unknown>)["polluted_by_dsh"]).toBeUndefined();
    expect(Object.keys(frontmatter)).toEqual([]);
  });

  it("constructor / prototype 等危险键一并忽略，合法键照常解析", () => {
    const text = [
      "---",
      "constructor:",
      "  x: 1",
      "prototype:",
      "  y: 2",
      "name: ok",
      "metadata:",
      "  author: m2e",
      "---",
      "body",
    ].join("\n");
    const { frontmatter } = parseFrontmatter(text);
    expect(Object.keys(frontmatter)).toEqual(["name", "metadata"]);
    expect(frontmatter["name"]).toBe("ok");
    expect(frontmatter["metadata"]).toEqual({ author: "m2e" });
  });
});

// 审查 S2-12（任务 4.6）：项目作用域散装 skill（无 manifest、只有 SKILL.md）与插件同走
// 信任门（E3：frontmatter description 直进 system prompt = 注入面），却**没有任何决议出口**：
// trustDecide 只在 manifest.plugins 里找名字 => loose 样本永远查不到；面板快照连 trust 字段
// 都没有 => 用户只看到「这个 skill 不在路由清单里」，无从批准也无从拒绝。
describe("项目作用域散装 skill 的信任出口（S2-12 回归）", () => {
  it("pending loose skill：快照带 trust，批准一次后进路由清单且决议持久化", async () => {
    const ws = await mkdtemp(join(tmpdir(), "m2e-loose-"));
    const pluginsDir = join(ws, "plugins");
    await cp(fx("project"), pluginsDir, { recursive: true });
    await mkdir(join(pluginsDir, "solo-skill"), { recursive: true });
    await writeFile(
      join(pluginsDir, "solo-skill", "SKILL.md"),
      ["---", "name: solo", "description: 只用于回归的散装 skill。", "---", "", "正文"].join("\n"),
      "utf8",
    );
    const load = (): Promise<PluginRuntime> => PluginRuntime.load({
      projectPluginsDir: pluginsDir,
      workspace: ws,
      pluginDataRoot: join(ws, "data"),
      trustFile: join(ws, "trust.json"),
    });
    const rt = await load();
    const solo = rt.snapshot().looseSkills.find((l) => l.name === "solo-skill");
    expect(solo).toBeDefined();
    expect(solo?.trust).toBe("pending"); // 旧实现：快照无 trust 字段 => undefined
    expect(rt.skills()).toHaveLength(0); // 未信任不进路由
    expect(await rt.trustDecide("solo-skill", true)).toBe(true); // 旧实现：false（只在 plugins 里找）
    expect(rt.snapshot().looseSkills.find((l) => l.name === "solo-skill")?.trust).toBe("trusted");
    expect(rt.skills().map((s) => s.name)).toContain("solo"); // 批准即进清单
    const rt2 = await load();
    expect(rt2.snapshot().looseSkills.find((l) => l.name === "solo-skill")?.trust).toBe("trusted"); // 持久化
    await rt.shutdown();
    await rt2.shutdown();
    await rm(ws, { recursive: true, force: true });
  }, 30_000);
});
