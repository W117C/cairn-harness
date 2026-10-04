// M2e 任务 5 单测：exit 2 阻断 / stdout JSON 决策放行与拒绝 / 非零退出非阻塞 /
// 10k 上限与超限落盘 / 超时 SIGKILL 强杀 / 同事件并行与跨层去重 / matcher 命中 /
// env 三变量注入 / 只读档静态危险拒跑 / 非 command 类型跳过警告 / 决策解析与合并。
import { describe, expect, it } from "vitest";
import { readFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HookEngine, parseHookDecision, mergeDecision, hookEnv,
  type HookEngineOptions,
} from "../src/agent/plugins";
import type { LoadedHookDef, HookEventName } from "../src/agent/plugins";

function fx(...parts: string[]): string {
  return join(process.cwd(), "fixtures", "plugins", ...parts);
}

let seq = 0;
function mkHook(event: HookEventName, command: string | string[], over: Partial<LoadedHookDef> = {}): LoadedHookDef {
  seq++;
  return {
    plugin: "p" + String(seq),
    pluginRoot: fx("project", "echo-suite"),
    event,
    handler: { type: "command", command },
    loaded: true,
    ...over,
  };
}

async function makeEngine(hooks: LoadedHookDef[], over: Partial<HookEngineOptions> = {}): Promise<HookEngine> {
  const dataRoot = await mkdtemp(join(tmpdir(), "m2e-hooks-"));
  return new HookEngine({
    hooks,
    workspace: dataRoot, // hook 子进程 cwd 必须真实存在
    pluginDataRoot: dataRoot,
    mode: "auto",
    ...over,
  });
}

describe("M2e hook 引擎：退出码与决策（任务 5）", () => {
  it("exit 2 真的阻断（blockReason = stderr）", async () => {
    const e = await makeEngine([mkHook("PreToolUse", 'node "' + fx("project", "echo-suite", "hooks", "blocker.mjs") + '"', { matcher: "read_file" })]);
    const r = await e.run("PreToolUse", { event: "PreToolUse", tool_name: "read_file", tool_args: { path: "x" } });
    expect(r.blocked).toBe(true);
    expect(r.blockReason).toContain("rejected by plugin hook");
  });

  it("stdout JSON decision 放行（hookSpecificOutput.permissionDecision=allow）", async () => {
    const e = await makeEngine([mkHook("PreToolUse", 'node "' + fx("project", "echo-suite", "hooks", "allow-json.mjs") + '"')]);
    const r = await e.run("PreToolUse", { event: "PreToolUse", tool_name: "glob", tool_args: {} });
    expect(r.blocked).toBe(false);
    expect(r.decision).toBe("allow");
  });

  it("legacy decision block/allow 与 permissionDecision 同效；非 JSON 输出不算决策", () => {
    expect(parseHookDecision('{"decision":"block","reason":"no"}').decision).toBe("deny");
    expect(parseHookDecision('{"decision":"approve"}').decision).toBe("allow");
    expect(parseHookDecision("plain text").decision).toBeUndefined();
    expect(mergeDecision(undefined, "allow")).toBe("allow");
    expect(mergeDecision("allow", "deny")).toBe("deny");
    expect(mergeDecision("ask", "allow")).toBe("ask");
  });

  it("其他退出码 = 非阻塞错误（记录但不阻断）", async () => {
    const e = await makeEngine([mkHook("PreToolUse", 'node -e "process.exit(3)"')]);
    const r = await e.run("PreToolUse", { event: "PreToolUse", tool_name: "glob", tool_args: {} });
    expect(r.blocked).toBe(false);
    expect(r.errors.join("\n")).toContain("3");
  });

  it("deny 决策也产生 blocked（决策 deny > allow 合并）", async () => {
    const e = await makeEngine([
      mkHook("PreToolUse", 'node -e "process.stdout.write(JSON.stringify({decision:\'block\',reason:\'hook-deny\'}))"'),
      mkHook("PreToolUse", 'node "' + fx("project", "echo-suite", "hooks", "allow-json.mjs") + '"'),
    ]);
    const r = await e.run("PreToolUse", { event: "PreToolUse", tool_name: "glob", tool_args: {} });
    expect(r.decision).toBe("deny");
    expect(r.blocked).toBe(true);
  });
});

describe("M2e hook 引擎：输出上限与超时（任务 5）", () => {
  it("输出 10k 上限：additionalContext 截断，超限全文落盘", async () => {
    const big = "z".repeat(12000);
    const e = await makeEngine([mkHook("SessionStart", 'node -e "process.stdout.write(process.argv[1])" ' + JSON.stringify(big))]);
    const r = await e.run("SessionStart", { event: "SessionStart" });
    expect(r.additionalContext.length).toBeLessThanOrEqual(10000);
    expect(r.overflowFiles).toHaveLength(1);
    const full = await readFile(r.overflowFiles[0]!, "utf8");
    expect(full.length).toBe(12000);
  });

  it("超时被强杀（SIGKILL，1s timeout vs 3s 睡眠）", async () => {
    const e = await makeEngine([mkHook("PreToolUse", 'node -e "setTimeout(()=>{},3000)"', { handler: { type: "command", command: 'node -e "setTimeout(()=>{},3000)"', timeout: 1 } })]);
    const t0 = Date.now();
    const r = await e.run("PreToolUse", { event: "PreToolUse", tool_name: "slow_tool", tool_args: {} });
    const elapsed = Date.now() - t0;
    expect(r.blocked).toBe(false); // 超时 = 非阻塞错误路径
    expect(r.errors.join(" ")).toContain("强杀");
    expect(elapsed).toBeLessThan(2500);
  });

  it("UserPromptSubmit 缺省 timeout 30s（配置缺省 600s 的降档）", async () => {
    // I3（审查 P2）：实际生效的 timeout 经注入 exec 捕获并断言——旧实现只断 blocked/context，
    // "30s 降档"从未被验证（名实不符的假覆盖）。
    const seen: number[] = [];
    const e = await makeEngine([mkHook("UserPromptSubmit", "echo fast")], {
      exec: async (_c, _a, _shell, _env, _cwd, timeoutSec) => {
        seen.push(timeoutSec);
        return { code: 0, stdout: "fast", stderr: "", killed: false };
      },
    });
    const r = await e.run("UserPromptSubmit", { event: "UserPromptSubmit", prompt: "hi" });
    expect(r.blocked).toBe(false);
    expect(r.additionalContext).toBe("fast");
    expect(seen).toEqual([30]); // UserPromptSubmit 缺省 30s（HOOK_TIMEOUT_USER_PROMPT，非 600s）
  });
});

describe("M2e hook 引擎：并行、去重、matcher、env、门（任务 5/6）", () => {
  it("同事件跨层相同 (command+args) 只跑一次；不同命令都跑", async () => {
    const same = "node -e 'process.stdout.write(String.fromCharCode(65))'";
    const e = await makeEngine([
      mkHook("SessionStart", same, { plugin: "user-layer" }),
      mkHook("SessionStart", same, { plugin: "project-layer" }),
      mkHook("SessionStart", "node -e 'process.stdout.write(String.fromCharCode(66))'"),
    ]);
    const r = await e.run("SessionStart", { event: "SessionStart" });
    expect(r.ran).toBe(2); // same 去重为 1 + B 1
    expect(r.additionalContext).toContain("A");
    expect(r.additionalContext).toContain("B");
  });

  it("matcher 命中工具名才跑；不匹配 = 零执行", async () => {
    const e = await makeEngine([mkHook("PreToolUse", "echo hit", { matcher: "^glob$" })]);
    const hit = await e.run("PreToolUse", { event: "PreToolUse", tool_name: "glob", tool_args: {} });
    expect(hit.ran).toBe(1);
    const miss = await e.run("PreToolUse", { event: "PreToolUse", tool_name: "read_file", tool_args: {} });
    expect(miss.ran).toBe(0);
  });

  it("hook 环境变量只给插件三变量（PLUGIN_ROOT/PLUGIN_DATA/PROJECT_DIR）+ 消毒基础集", async () => {
    process.env.M2E_TEST_SECRET_LIKE = "should-not-leak";
    const e = await makeEngine([
      mkHook("SessionStart", 'node -e "process.stdout.write([process.env.PLUGIN_ROOT?1:0,process.env.PLUGIN_DATA?1:0,process.env.PROJECT_DIR,process.env.M2E_TEST_SECRET_LIKE===undefined?1:0].join(String.fromCharCode(58)))"'),
    ]);
    const r = await e.run("SessionStart", { event: "SessionStart" });
    delete process.env.M2E_TEST_SECRET_LIKE;
    const ws = (e as unknown as { opts: { workspace: string } }).opts.workspace;
    expect(r.additionalContext).toBe("1:1:" + ws + ":1");
  });

  it("只读档拒绝有副作用 hook 命令；默认档只拦 high/critical", async () => {
    const net = mkHook("PreToolUse", "curl http://example.invalid", { plugin: "net-hook" });
    const ro = await makeEngine([net], { mode: "read-only" });
    const r1 = await ro.run("PreToolUse", { event: "PreToolUse", tool_name: "glob", tool_args: {} });
    expect(r1.ran).toBe(0);
    expect(r1.errors.join(" ")).toContain("只读档");
    const normal = await makeEngine([net], { mode: "auto" });
    const r2 = await normal.run("PreToolUse", { event: "PreToolUse", tool_name: "glob", tool_args: {} });
    expect(r2.ran).toBe(1); // medium 在非只读档放行
    const crit = mkHook("PreToolUse", "rm -rf /", { plugin: "crit-hook" });
    const e3 = await makeEngine([crit], { mode: "auto" });
    const r3 = await e3.run("PreToolUse", { event: "PreToolUse", tool_name: "glob", tool_args: {} });
    expect(r3.ran).toBe(0);
    expect(r3.errors.join(" ")).toContain("静态危险检测");
  });

  it("非 command handler 类型：收下但运行跳过 + 警告", async () => {
    const h = mkHook("PreToolUse", "ignored", { handler: { type: "http", command: "ignored" } });
    const e = await makeEngine([h]);
    const r = await e.run("PreToolUse", { event: "PreToolUse", tool_name: "glob", tool_args: {} });
    expect(r.ran).toBe(0);
    expect(r.skipped).toBe(1);
    expect(r.errors.join(" ")).toContain("http");
  });

  it("PostToolUse 上下文回注 + PostToolUseFailure 失败路径分流", async () => {
    const e = await makeEngine([
      mkHook("PostToolUse", "echo post-ok", { matcher: "glob" }),
      mkHook("PostToolUseFailure", "echo post-fail", { matcher: "glob" }),
    ]);
    const ok = await e.run("PostToolUse", { event: "PostToolUse", tool_name: "glob", tool_args: {}, tool_response: "out" });
    expect(ok.additionalContext).toBe("post-ok");
    const fail = await e.run("PostToolUseFailure", { event: "PostToolUseFailure", tool_name: "glob", tool_args: {}, tool_response: "err" });
    expect(fail.additionalContext).toBe("post-fail");
  });
});

describe("exec form 钩子：真实 spawn（不靠替身 exec）", () => {
  // 上面的钩子单测一律注入替身 exec 且只看第一个入参 ⇒ 真实 spawn 那一面从没人跑过，
  // 于是 defaultExec 的契约错位（把 argv[0] 当可执行文件、丢掉声明的 command）活到今天：
  // 每条 exec form 钩子都在 spawn 它的第一个**参数**（["node","-e",…] → spawn "-e"）→ ENOENT。
  it("数组形态：spawn 声明的可执行文件本身，其余参数原样交给它", async () => {
    const e = await makeEngine([mkHook("SessionStart", [
      "node", "-e", "process.stdout.write('exe=' + process.argv[1] + ' arg=' + (process.argv[2] ?? '-'))", "PIN",
    ])]);
    const r = await e.run("SessionStart", { event: "SessionStart" });
    expect(r.ran).toBe(1);
    expect(r.errors).toEqual([]); // 替身 exec 下这条恒绿——真 spawn 失败会红
    expect(r.additionalContext).toBe("exe=PIN arg=-");
  });

  it("起不来的进程：错误里带真实原因（ENOENT），不只报一个不存在的退出码", async () => {
    const e = await makeEngine([mkHook("SessionStart", ["dsh-no-such-executable-xyz", "--flag"])]);
    const r = await e.run("SessionStart", { event: "SessionStart" });
    expect(r.ran).toBe(1);
    expect(r.errors.join(" ")).toContain("ENOENT");
    expect(r.errors.join(" ")).toContain("dsh-no-such-executable-xyz");
  });
});

describe("M2e hook env 构造（消毒面）", () => {
  it("hookEnv 只加三个插件变量，密钥类宿主变量不进白名单", () => {
    const env = hookEnv({ pluginRoot: "/p", pluginData: "/pd", workspace: "/w" });
    expect(env.PLUGIN_ROOT).toBe("/p");
    expect(env.PLUGIN_DATA).toBe("/pd");
    expect(env.PROJECT_DIR).toBe("/w");
    expect(env.CAIRN_API_KEY).toBeUndefined();
    expect(env.PATH).toBeDefined();
  });
});
