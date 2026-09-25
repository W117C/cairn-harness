// §9.3 的**用户侧** skill 触发。此前 skill 只有模型侧一条入口（skill 工具），而
// `disable-model-invocation` 这个位的含义正是「只能由用户点」——产品里没有用户触发面，
// 于是它唯一兑现出来的效果变成「这个 skill 永远不可用」（工具还会回一句「只能由用户触发」，
// 而那扇门根本不存在）。判据走 runAgent 真入口 + 事件流：纯函数的派发单测藏不住「没人调用」。
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PluginRuntime, expandSkillInvocation } from "../src/agent/plugins";
import type { AgentEvent, CompactionEvent, UserMessageEvent } from "../src/events";
import { runAgent } from "../src/main/agent-runner";

/** 一个插件：say（模型与用户都可）/ hidden（只有用户可）/ dual（与同名命令撞车）。 */
async function seedPlugin(root: string): Promise<void> {
  const p = join(root, "user-plugins", "sk-demo");
  await mkdir(join(p, ".claude-plugin"), { recursive: true });
  await mkdir(join(p, "commands"), { recursive: true });
  await writeFile(join(p, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "sk-demo", description: "用户侧 skill 触发判据", version: "0.1.0" }), "utf8");
  const skill = async (name: string, body: string, fm: string): Promise<void> => {
    await mkdir(join(p, "skills", name), { recursive: true });
    await writeFile(join(p, "skills", name, "SKILL.md"), "---\nname: " + name + "\n" + fm + "---\n" + body + "\n", "utf8");
  };
  await skill("say", "说一句：$ARGUMENTS", "description: 回声 skill。\n");
  await skill("hidden", "只有用户能点的正文", "description: 模型不可点。\ndisable-model-invocation: true\n");
  await skill("dual", "skill 版正文", "description: 与命令同名。\n");
  await skill("vars", "正文里的目录：${SKILL_DIR}", "description: 变量面样本。\n");
  await writeFile(join(p, "commands", "dual.md"),
    "---\ndescription: 与 skill 同名的命令。\n---\n命令版正文\n", "utf8");
}

describe("expandSkillInvocation（§9.3 用户侧派发）", () => {
  const sk = (name: string, body: string, fm: Record<string, unknown> = {}) => ({
    plugin: "sk-demo", name, description: "", path: "/dev/null", frontmatter: fm, body,
  });

  it("命中：正文换成渲染结果，并记下是哪个 skill、当时给了什么参数", () => {
    const r = expandSkillInvocation([sk("say", "说一句：$ARGUMENTS")], "/sk-demo:say 你好 世界");
    expect(r.text).toBe("说一句：你好 世界");
    expect(r.hit).toEqual({ invoke: "/sk-demo:say", args: "你好 世界" });
  });

  it("disable-model-invocation 在用户侧放行（那个位拒的是模型，不是用户）", () => {
    const r = expandSkillInvocation([sk("hidden", "只有用户能点", { "disable-model-invocation": true })], "/sk-demo:hidden");
    expect(r.text).toBe("只有用户能点");
    expect(r.hit?.invoke).toBe("/sk-demo:hidden");
  });

  it("超预算的正文按模型侧同一顶帽裁掉；取回那句按落位给，没登记工作区就不递地址（#47）", () => {
    const big = "x".repeat(40_000); // ≈10000 token > SKILL_REMOUNT_TOKENS_PER_SKILL
    const r = expandSkillInvocation([sk("big", big)], "/sk-demo:big");
    expect(r.text.length).toBeLessThan(big.length);
    // 旧断言是 `toContain("[全文见 ")`——那把「递一个模型读不到的绝对路径」冻成了期望值。
    // /dev/null 在这里只是占位：没传 workspace ⇒ 不许承诺取回（两案与真 read_file 见 tests/skill-recall-address.test.ts）。
    expect(r.text).toContain("读不到");
    expect(r.text).not.toMatch(/全文见\s+\//);
    expect(r.text).not.toContain("/dev/null");
  });

  it("不以 / 开头、名字没登记 ⇒ 逐字原样且不带 hit（既有路径字节不变）", () => {
    const skills = [sk("say", "说一句：$ARGUMENTS")];
    expect(expandSkillInvocation(skills, "修个 bug").text).toBe("修个 bug");
    expect(expandSkillInvocation(skills, "/nope 1").text).toBe("/nope 1");
    expect(expandSkillInvocation(skills, "/nope 1").hit).toBeNull();
    // 不做模糊回退：`say`（无插件前缀）不是这个插件 skill 的调用名
    expect(expandSkillInvocation(skills, "/say 甲").hit).toBeNull();
  });
});

describe("两条 face 的门不同：模型侧拒、用户侧放行", () => {
  let dir: string;
  let rt: PluginRuntime | null = null;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dsh-skill-user-"));
    await seedPlugin(dir);
    rt = await PluginRuntime.load({
      userPluginsDir: join(dir, "user-plugins"),
      workspace: dir,
      pluginDataRoot: join(dir, "plugin-data"),
      trustFile: join(dir, "trust.json"),
    });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it("模型侧：hidden 被拒且理由点名那个位；普通 skill 放行", async () => {
    const e = rt!;
    const denied = e.triggerSkill("/sk-demo:hidden", "");
    expect(denied.ok).toBe(false);
    expect(denied.output).toContain("disable-model-invocation");
    expect(e.triggerSkill("/sk-demo:say", "甲").output).toContain("说一句：甲");
    // 路由面同样不含 hidden（清单里就没有 ⇒ 模型无从点起）
    const routing = e.routingList().text;
    expect(routing).toContain("/sk-demo:say");
    expect(routing).not.toContain("/sk-demo:hidden");
  });

  it("重挂投影看得见用户侧触发：那条 user_message 被压缩摘除时要重注正文", () => {
    const e = rt!;
    const userMsg: UserMessageEvent = {
      type: "user_message", content: "说一句：你好", skill: { invoke: "/sk-demo:say", args: "你好" },
    };
    const compact: CompactionEvent = {
      type: "compaction", trigger: "auto", reason: "threshold",
      compressed_event_ids: [1], summary: "（摘要）", summary_offset: 1,
      tokens_before: 100, tokens_after: 10,
    };
    const withMeta = e.remountFromEvents([userMsg, compact] as AgentEvent[]);
    expect(withMeta.mounted).toContain("/sk-demo:say");
    expect(withMeta.text ?? "").toContain("说一句：你好");
    // 同一行没有 skill 字段 ⇒ 它不是任何一次激活（不凭空重挂）
    const plain: UserMessageEvent = { type: "user_message", content: "说一句：你好" };
    expect(e.remountFromEvents([plain, compact] as AgentEvent[]).text).toBeNull();
  });
});

describe("runAgent 真入口：用户敲 /skill 之后事件流里到底有什么", () => {
  let dir: string;
  const savedUser = process.env.M2E_USER_PLUGINS;
  const savedData = process.env.M2E_PLUGIN_DATA;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dsh-skill-live-"));
    await writeFile(join(dir, "README.md"), "靶子占位\n", "utf8");
    await seedPlugin(dir);
    process.env.M2E_USER_PLUGINS = join(dir, "user-plugins");
    process.env.M2E_PLUGIN_DATA = join(dir, "plugin-data");
  });
  afterEach(async () => {
    if (savedUser === undefined) delete process.env.M2E_USER_PLUGINS;
    else process.env.M2E_USER_PLUGINS = savedUser;
    if (savedData === undefined) delete process.env.M2E_PLUGIN_DATA;
    else process.env.M2E_PLUGIN_DATA = savedData;
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  const firstUser = (events: AgentEvent[]): UserMessageEvent | undefined => {
    for (const e of events) if (e.type === "user_message") return e as UserMessageEvent;
    return undefined;
  };

  it("/sk-demo:say 你好 → 落流的是替换过的正文，且带 skill 归属", async () => {
    const events = await runAgent({
      workspace: dir, message: "/sk-demo:say 你好", mode: "read-only",
      logPath: join(dir, "say.jsonl"), sandbox: null, unattended: true,
    });
    const u = firstUser(events);
    expect(u?.content).toBe("说一句：你好");
    expect(u?.skill).toEqual({ invoke: "/sk-demo:say", args: "你好" });
  }, 120_000);

  it("disable-model-invocation 的 skill 由用户点 → 真的进流（模型侧不可调用不等于不存在）", async () => {
    const events = await runAgent({
      workspace: dir, message: "/sk-demo:hidden", mode: "read-only",
      logPath: join(dir, "hidden.jsonl"), sandbox: null, unattended: true,
    });
    const u = firstUser(events);
    expect(u?.content).toBe("只有用户能点的正文");
    expect(u?.skill?.invoke).toBe("/sk-demo:hidden");
  }, 120_000);

  it("与命令同名时命令优先（派发顺序确定，不靠猜），且不误标 skill 归属", async () => {
    const events = await runAgent({
      workspace: dir, message: "/sk-demo:dual", mode: "read-only",
      logPath: join(dir, "dual.jsonl"), sandbox: null, unattended: true,
    });
    const u = firstUser(events);
    expect(u?.content).toBe("命令版正文");
    expect(u?.skill).toBeUndefined();
  }, 120_000);

  it("用户侧触发同样吃 §9.3 的变量面（${SKILL_DIR} 不是只给模型的那条才展开）", async () => {
    const events = await runAgent({
      workspace: dir, message: "/sk-demo:vars", mode: "read-only",
      logPath: join(dir, "vars.jsonl"), sandbox: null, unattended: true,
    });
    const content = firstUser(events)?.content ?? "";
    expect(content.startsWith("正文里的目录：")).toBe(true);
    expect(content).toContain(join("user-plugins", "sk-demo", "skills", "vars"));
    expect(content).not.toContain("${");
  }, 120_000);

  it("未命中的斜杠消息逐字进流（零回归）", async () => {
    const events = await runAgent({
      workspace: dir, message: "/nope 随便", mode: "read-only",
      logPath: join(dir, "miss.jsonl"), sandbox: null, unattended: true,
    });
    const u = firstUser(events);
    expect(u?.content).toBe("/nope 随便");
    expect(u?.skill).toBeUndefined();
  }, 120_000);
});
