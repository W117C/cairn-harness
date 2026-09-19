// 插件 prompt 命令的派发面（§9.4：commands/*.md → 渲染成用户消息进事件流）。
// ⚠️ 本文件的 e2e 那条不是冗余：`renderPromptCommand` / `substituteArgs` / `commandInvokeName`
// 三个纯函数早有单测（plugins-skills.test.ts），却正因为"纯函数有测"而让**没人调用它们**这件事
// 在绿色里藏了很久——同一次审查里 hook 的 stdin 契约是同一个形状翻车的。所以这里必须有
// 一条从 runAgent 真入口进去、看事件流里那条 user_message 的用例。
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { expandPromptCommand } from "../src/agent/plugins";
import type { PromptCommandEntry } from "../src/agent/plugins";
import { runAgent } from "../src/main/agent-runner";
import type { AgentEvent } from "../src/events";

const cmd = (plugin: string | null, name: string, body: string, frontmatter: Record<string, unknown> = {}): PromptCommandEntry =>
  ({ plugin, name, description: "", path: "/dev/null", frontmatter, body });

describe("expandPromptCommand（§9.4 派发）", () => {
  const cmds = [
    cmd("hello-plugin", "wave", "挥挥手，对象：$ARGUMENTS"),
    cmd("hello-plugin", "quiet", "不该被用户调起", { "user-invocable": false }),
    cmd(null, "loose", "松散的 $1 与 $2"),
  ];

  it("命中插件命令：整条消息换成渲染结果", () => {
    const r = expandPromptCommand(cmds, "/hello-plugin:wave 张三 李四");
    expect(r.text).toBe("挥挥手，对象：张三 李四");
    expect(r.invoked).toBe("/hello-plugin:wave");
    expect(r.refused).toBeNull();
  });

  it("命中松散命令（无插件前缀）：位置参数照常替换", () => {
    const r = expandPromptCommand(cmds, "/loose 甲 乙");
    expect(r.text).toBe("松散的 甲 与 乙");
  });

  it("非斜杠开头 / 未登记命令：逐字原样，零行为（既有路径字节不变）", () => {
    expect(expandPromptCommand(cmds, "修个 bug").text).toBe("修个 bug");
    expect(expandPromptCommand(cmds, "/nope:x 1").text).toBe("/nope:x 1");
    expect(expandPromptCommand(cmds, "/nope:x 1").invoked).toBeNull();
    expect(expandPromptCommand(cmds, "https://a/b").text).toBe("https://a/b");
  });

  it("命令名后无参数也能命中（$ARGUMENTS 换成空串）", () => {
    expect(expandPromptCommand(cmds, "/hello-plugin:wave").text).toBe("挥挥手，对象：");
  });

  it("user-invocable:false ⇒ 不展开、不出声地丢给模型不行：refused 带命令名", () => {
    const r = expandPromptCommand(cmds, "/hello-plugin:quiet");
    expect(r.invoked).toBeNull();
    expect(r.refused).toBe("/hello-plugin:quiet");
  });
});

describe("runAgent 真入口的派发（事件流里那条 user_message）", () => {
  let dir: string;
  let plugins: string;
  const savedUser = process.env.M2E_USER_PLUGINS;
  const savedData = process.env.M2E_PLUGIN_DATA;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dsh-cmd-dispatch-"));
    await writeFile(join(dir, "README.md"), "靶子占位\n", "utf8");
    // 自建用户级插件目录（不借 fixtures/plugins/user：那里加文件会动到别的判卷面）
    plugins = join(dir, "user-plugins", "cmd-demo");
    await mkdir(join(plugins, ".claude-plugin"), { recursive: true });
    await mkdir(join(plugins, "commands"), { recursive: true });
    await writeFile(join(plugins, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "cmd-demo", description: "派发判据样本", version: "0.1.0" }), "utf8");
    await writeFile(join(plugins, "commands", "wave.md"),
      "---\ndescription: 挥手。\n---\n挥挥手，对象：$ARGUMENTS\n", "utf8");
    await writeFile(join(plugins, "commands", "quiet.md"),
      "---\ndescription: 只给模型路由。\nuser-invocable: false\n---\n用户不该调到我\n", "utf8");
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

  const firstUserMessage = (events: AgentEvent[]): string | undefined => {
    const e = events.find((x) => x.type === "user_message");
    return e && e.type === "user_message" ? e.content : undefined;
  };
  const lastAssistant = (events: AgentEvent[]): string => {
    const all = events.filter((x) => x.type === "assistant_message") as Extract<AgentEvent, { type: "assistant_message" }>[];
    return all.length > 0 ? all[all.length - 1].content : "";
  };

  it("/cmd-demo:wave 张三 → 落流的是渲染后的正文，不是那串斜杠", async () => {
    const events = await runAgent({
      workspace: dir,
      message: "/cmd-demo:wave 张三",
      mode: "read-only",
      logPath: join(dir, "events.jsonl"),
      sandbox: null,
      unattended: true,
    });
    expect(firstUserMessage(events)).toBe("挥挥手，对象：张三");
  }, 120_000);

  it("user-invocable:false 的命令：不出正文也不静默丢给模型，出声说明被拒", async () => {
    const events = await runAgent({
      workspace: dir,
      message: "/cmd-demo:quiet",
      mode: "read-only",
      logPath: join(dir, "refused.jsonl"),
      sandbox: null,
      unattended: true,
    });
    expect(firstUserMessage(events)).toBeUndefined();
    expect(lastAssistant(events)).toContain("不可用户调用");
    expect(lastAssistant(events)).toContain("/cmd-demo:quiet");
  }, 120_000);

  it("普通消息不受影响（零回归：未命中即逐字进流）", async () => {
    const events = await runAgent({
      workspace: dir,
      message: "念一遍 README 的第一行",
      mode: "read-only",
      logPath: join(dir, "plain.jsonl"),
      sandbox: null,
      unattended: true,
    });
    expect(firstUserMessage(events)).toBe("念一遍 README 的第一行");
  }, 120_000);

  // §9.3 参数通道的**最后一跳**：模型在 tool_call 里下的 args，要真的走到替换器。
  // 上面那组只证明 PluginRuntime.triggerSkill(name, args) 会替换；工具面（规格 + 实例 + loop 白名单）
  // 若把 args 丢掉，替换器就永远收到空串——这一跳正是本仓点名的「接缝都在，最后一步没接」。
  it("模型经 skill 工具下的 args 真的进替换器（tool_result 里是替换后的正文）", async () => {
    const skillDir = join(plugins, "skills", "greet");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"),
      "---\nname: greet\ndescription: 打招呼。\n---\n你好，$1；全部参数：$ARGUMENTS\n", "utf8");
    const scriptPath = join(dir, "skill-args.jsonl");
    await writeFile(scriptPath, JSON.stringify({ type: "tool_call", id: "k1", name: "skill", args: { name: "/cmd-demo:greet", args: "张三 李四" } }) + "\n"
      + JSON.stringify({ type: "assistant_message", content: "参数场景完成" }) + "\n", "utf8");
    const prevScript = process.env.M1C_AUTONOMY_SCRIPT;
    process.env.M1C_AUTONOMY_SCRIPT = scriptPath;
    try {
      const events = await runAgent({
        workspace: dir,
        message: "用 greet skill 打招呼",
        mode: "read-only",
        logPath: join(dir, "skill-args-events.jsonl"),
        sandbox: null,
        unattended: true,
      });
      const res = events.find((x) => x.type === "tool_result" && x.callId === "k1") as Extract<AgentEvent, { type: "tool_result" }> | undefined;
      expect(res?.ok).toBe(true);
      expect(res?.output).toContain("你好，张三；全部参数：张三 李四");
      expect(res?.output).not.toContain("$ARGUMENTS");
    } finally {
      if (prevScript === undefined) delete process.env.M1C_AUTONOMY_SCRIPT;
      else process.env.M1C_AUTONOMY_SCRIPT = prevScript;
    }
  }, 120_000);

  it("skill 工具的规格面声明了 args（模型看得见才有那条参数通道；与执行面同源）", async () => {
    // 每条用例各自建 skill：beforeEach 会换新目录，别依赖上一条留下的文件。
    const skillDir = join(plugins, "skills", "spec-only");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"),
      "---\nname: spec-only\ndescription: 只看规格面。\n---\n正文\n", "utf8");
    const { pluginToolSpecsFromRuntime } = await import("../src/main/agent-runner");
    const { PluginRuntime } = await import("../src/agent/plugins");
    const rt = await PluginRuntime.load({
      userPluginsDir: join(dir, "user-plugins"),
      workspace: dir,
      pluginDataRoot: join(dir, "plugin-data-spec"),
    });
    try {
      const spec = pluginToolSpecsFromRuntime(rt).find((t) => t.name === "skill");
      const props = (spec?.parameters as { properties?: Record<string, unknown> }).properties ?? {};
      expect(Object.keys(props)).toContain("args");
    } finally {
      await rt.shutdown();
    }
  });
});
