// §9.5 SessionEnd 的事件源。会话终止这一跳不进任何模型上下文（没有人再读这一轮），
// 所以「钩子到底跑没跑、跑了几次」只能靠真跑一次 runAgent 来看。
// 哨兵一律**追加**写：写文件成功与否是个布尔，看不出跑了 1 次还是 2 次——而"跑两遍收尾钩子"
// 正是这条路径上最容易犯的错（try 尾与 finally 各挂一个生产者时就是这个症状）。
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HookEngine } from "../src/agent/plugins";
import { runAgent } from "../src/main/agent-runner";
import type { LoadedHookDef } from "../src/agent/plugins/types";

/** 往哨兵文件追加一个 'x' 的钩子脚本。 */
async function appendScript(dir: string, name: string): Promise<string> {
  const p = join(dir, name);
  await writeFile(p, "require('fs').appendFileSync(process.argv[2], 'x');\n", "utf8");
  return 'node "' + p + '"';
}

/** 退出码 2 = 阻断（本用例用来把 runAgent 打成"提前 return"，验收尾不只在正常出口跑）。 */
async function blockScript(dir: string, name: string): Promise<string> {
  const p = join(dir, name);
  await writeFile(p, "process.exit(2);\n", "utf8");
  return 'node "' + p + '"';
}

async function writeUserPlugin(root: string, plugin: string, hooks: unknown): Promise<void> {
  const dir = join(root, plugin);
  await mkdir(join(dir, ".claude-plugin"), { recursive: true });
  await mkdir(join(dir, "hooks"), { recursive: true });
  await writeFile(join(dir, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: plugin, description: "SessionEnd 判据", version: "0.1.0" }), "utf8");
  await writeFile(join(dir, "hooks", "hooks.json"), JSON.stringify(hooks), "utf8");
}

describe("SessionEnd 有生产者（runAgent 真入口）", () => {
  let dir: string;
  const saved = { user: process.env.M2E_USER_PLUGINS, data: process.env.M2E_PLUGIN_DATA };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dsh-session-end-"));
    await writeFile(join(dir, "README.md"), "line1\n", "utf8");
  });

  afterEach(async () => {
    if (saved.user === undefined) delete process.env.M2E_USER_PLUGINS;
    else process.env.M2E_USER_PLUGINS = saved.user;
    if (saved.data === undefined) delete process.env.M2E_PLUGIN_DATA;
    else process.env.M2E_PLUGIN_DATA = saved.data;
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  /** 装一份自定义 hooks.json 的插件，然后真跑一轮 runAgent。 */
  async function runWith(plugin: string, hooks: unknown): Promise<void> {
    await writeUserPlugin(join(dir, "plugins"), plugin, hooks);
    process.env.M2E_USER_PLUGINS = join(dir, "plugins");
    process.env.M2E_PLUGIN_DATA = join(dir, "plugin-data");
    await runAgent({
      workspace: dir,
      message: "念一遍 README 的第一行",
      mode: "read-only",
      logPath: join(dir, "events-" + plugin + ".jsonl"),
      sandbox: null,
      unattended: true,
    });
  }

  const endHooks = (script: string, sentinel: string, matcher?: string) => ({
    hooks: {
      SessionEnd: [{ ...(matcher === undefined ? {} : { matcher }), hooks: [{ type: "command", command: script + " " + JSON.stringify(sentinel) }] }],
    },
  });

  it("会话终止真的跑 SessionEnd 钩子，且只跑一次", async () => {
    const sentinel = join(dir, "ended");
    await runWith("end-plain", endHooks(await appendScript(dir, "touch.cjs"), sentinel));
    expect(await readFile(sentinel, "utf8")).toBe("x");
  }, 120_000);

  it("提示词被钩子阻断的早退路径也收尾（生产者在 finally，不在 try 尾）", async () => {
    const sentinel = join(dir, "ended-after-block");
    await writeUserPlugin(join(dir, "plugins"), "end-blocked", {
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: "command", command: await blockScript(dir, "block.cjs") }] }],
        SessionEnd: [{ hooks: [{ type: "command", command: await appendScript(dir, "touch.cjs") + " " + JSON.stringify(sentinel) }] }],
      },
    });
    process.env.M2E_USER_PLUGINS = join(dir, "plugins");
    process.env.M2E_PLUGIN_DATA = join(dir, "plugin-data");
    await runAgent({
      workspace: dir, message: "念一遍 README 的第一行", mode: "read-only",
      logPath: join(dir, "events-blocked.jsonl"), sandbox: null, unattended: true,
    });
    expect(await readFile(sentinel, "utf8")).toBe("x");
  }, 120_000);

  it("matcher 按结束原因配：写 exit 的那条跑，写 compact 的那条不跑", async () => {
    const skip = join(dir, "ended-compact");
    const hit = join(dir, "ended-exit");
    await writeUserPlugin(join(dir, "plugins"), "end-matcher-skip",
      endHooks(await appendScript(dir, "touch2.cjs"), skip, "compact"));
    await writeUserPlugin(join(dir, "plugins"), "end-matcher-hit",
      endHooks(await appendScript(dir, "touch3.cjs"), hit, "exit"));
    process.env.M2E_USER_PLUGINS = join(dir, "plugins");
    process.env.M2E_PLUGIN_DATA = join(dir, "plugin-data");
    await runAgent({
      workspace: dir, message: "念一遍 README 的第一行", mode: "read-only",
      logPath: join(dir, "events-matcher.jsonl"), sandbox: null, unattended: true,
    });
    expect(await readFile(hit, "utf8")).toBe("x");
    await expect(readFile(skip, "utf8")).rejects.toBeTruthy();
  }, 120_000);
});

describe("SessionEnd 的超时帽（会话终止不能被一个挂死的钩子拖 600s）", () => {
  it("未声明 timeout 的 SessionEnd handler 取 30s；别的缺省仍是 600s", async () => {
    const seen: Record<string, number> = {};
    const mk = (event: "SessionEnd" | "PostToolUse"): LoadedHookDef => ({
      plugin: "p-" + event, pluginRoot: process.cwd(), event,
      handler: { type: "command", command: "echo x" }, loaded: true,
    });
    const capture = (event: string) => async (_c: string, _a: string[], _s: boolean, _e: Record<string, string>,
      _w: string, timeoutSec: number): Promise<{ code: number; stdout: string; stderr: string; killed: boolean }> => {
      seen[event] = timeoutSec;
      return { code: 0, stdout: "", stderr: "", killed: false };
    };
    const end = new HookEngine({ hooks: [mk("SessionEnd")], workspace: process.cwd(), pluginDataRoot: process.cwd(), exec: capture("SessionEnd") });
    await end.run("SessionEnd", { event: "SessionEnd", trigger: "exit" });
    expect(seen.SessionEnd).toBe(30);
    const post = new HookEngine({ hooks: [mk("PostToolUse")], workspace: process.cwd(), pluginDataRoot: process.cwd(), exec: capture("PostToolUse") });
    await post.run("PostToolUse", { event: "PostToolUse", tool_name: "read_file", tool_args: {} });
    expect(seen.PostToolUse).toBe(600);
  });
});
