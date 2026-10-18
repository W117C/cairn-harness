// §A4：事件日志是**可重放**的，一份 JSONL 里存着每条 tool_call 的 args 与每条 tool_result
// 的 output 原文。`run_shell` 的 `cat ~/.aws/credentials` 于是把凭据永久留在盘上。
// `sanitizedEnv` 挡的是 process.env，挡不住工具读出来的文件内容。
//
// `redactSecrets` 本仓早就有（remember / worker 报告 / 评审都过它），唯独主会话这条落盘面漏着。
// 这组钉的是「落盘面脱敏、执行面不脱敏」两半——只钉一半会写出把模型命令改成掩码的假修复。
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runLoop } from "../src/agent/loop";
import { createEventLog, type AgentEvent, type EventLog } from "../src/events";
import type { ModelOutput, Provider } from "../src/providers";

/** 形状足以被 SECRET_PATTERNS 命中的假凭据（不是真密钥，只是一串该被掩掉的长随机串）。 */
const FAKE_KEY = "sk-ant-api03-Xk9mQ2vB7nR4tY6uL8wZ1cD3fG5hJ0kM2pQ4sN6vU8xA"; // secret.openai
const FAKE_AWS = "AKIAIOSFODNN7EXAMPLE"; // secret.aws

const dirs: string[] = [];
afterEach(async () => {
  while (dirs.length > 0) await rm(dirs.pop()!, { recursive: true, force: true });
});

/** 假 provider：第一轮发一个 tool_call，之后不再有任何输出——空流即 loop 的终止条件
 *  （与 tests/loop.test.ts 同款；否则会一路要轮次到 maxSteps 上限）。 */
function providerEmitting(call: { id: string; name: string; args: Record<string, unknown> }): Provider {
  let turn = 0;
  return {
    async *stream(): AsyncGenerator<ModelOutput> {
      if (turn++ > 0) return;
      yield { type: "tool_call", ...call } as unknown as ModelOutput;
    },
  };
}

/** 跑一轮，把落盘的 JSONL 原文读回来。 */
async function runAndReadLog(o: {
  call: { id: string; name: string; args: Record<string, unknown> };
  toolName: string;
  toolOutput: string;
  onArgs?: (args: Record<string, unknown>) => void;
}): Promise<string> {
  const ws = await mkdtemp(join(tmpdir(), "a4-redact-"));
  dirs.push(ws);
  const logPath = join(ws, "events.jsonl");
  const events: EventLog = createEventLog(logPath);
  await runLoop({
    workspace: ws,
    provider: providerEmitting(o.call),
    tools: {
      [o.toolName]: {
        name: o.toolName,
        async run(args: Record<string, unknown>) {
          o.onArgs?.(args);
          return { ok: true, output: o.toolOutput };
        },
      },
    } as never,
    // default 档非交互 = 一切工具 deny（fail-closed 本身在拦，与本组无关）⇒ 显式 auto 档放工具过闸
    mode: "auto",
    events,
  });
  await events.close?.();
  return await readFile(logPath, "utf8");
}

const SHELL_CALL = { id: "c1", name: "run_shell", args: { command: "cat ~/.aws/credentials" } };

describe("事件日志落盘前脱敏（凭据不留盘）", () => {
  it("tool_result 的 output：run_shell 读出的凭据在盘上没有明文", async () => {
    const log = await runAndReadLog({
      call: SHELL_CALL,
      toolName: "run_shell",
      toolOutput: `AKIA:${FAKE_AWS}\nkey=${FAKE_KEY}\n`,
    });
    expect(log).toContain("tool_result"); // 这条用例本身跑到了
    expect(log).not.toContain(FAKE_KEY);
    expect(log).not.toContain(FAKE_AWS);
    // 掩码是**留痕**而不是「什么都没记」——读者要能看出这里原本有过凭据
    expect(log).toContain("AKIA****");
  });

  it("tool_call 的 args：模型写在参数里的凭据同样不留明文", async () => {
    const log = await runAndReadLog({
      call: { id: "c1", name: "write_file", args: { path: "notes.txt", content: `token=${FAKE_KEY}` } },
      toolName: "write_file",
      toolOutput: "written",
    });
    expect(log).toContain("tool_call");
    expect(log).not.toContain(FAKE_KEY);
  });

  it("执行面不脱敏：模型发什么原样执行（脱敏只发生在落盘面，不是把命令改掉）", async () => {
    const seen: Array<Record<string, unknown>> = [];
    await runAndReadLog({
      call: { id: "c1", name: "write_file", args: { path: "a.txt", content: `t=${FAKE_KEY}` } },
      toolName: "write_file",
      toolOutput: "written",
      onArgs: (args) => seen.push(args),
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.content).toBe(`t=${FAKE_KEY}`); // 执行面拿到的是原值
  });

  it("无凭据的正常输出逐字不变（脱敏不得改写没有秘密的字节）", async () => {
    const out = "compilation succeeded\n0 errors\n";
    const log = await runAndReadLog({ call: SHELL_CALL, toolName: "run_shell", toolOutput: out });
    expect(log).toContain(JSON.stringify(out).slice(1, -1)); // 转义后的原文逐字在场
    expect(log).not.toContain("****");
  });
});

/* 同一族的第二个落盘面：**verify**。`verify_result.results[].output` 是测试输出——子流早就有
   这个洞（worker-projection.ts:92 的 `verify_result: [["results"]]` 就是它），主会话这条却漏着。
   判卷是**对比支**：两支只差 verify 输出里有没有凭据，结论从「盘上逐字不变」换成「盘上没有明文
   但有掩码留痕」。只钉一支的话，把 redactVerifyResults 整个删掉，另一支照样绿。 */
describe("verify 面落盘前脱敏（同一族的第二个落盘面）", () => {
  /** 走 verify 系统门那条真实路径：模型发一个 tool_call{name:"verify"}，loop 短路去调 opts.verify。 */
  async function runVerifyAndReadLog(o: { command: string; output: string }): Promise<string> {
    const ws = await mkdtemp(join(tmpdir(), "a4-redact-verify-"));
    dirs.push(ws);
    const logPath = join(ws, "events.jsonl");
    const events: EventLog = createEventLog(logPath);
    await runLoop({
      workspace: ws,
      provider: providerEmitting({ id: "v1", name: "verify", args: {} }),
      tools: {} as never,
      mode: "auto",
      events,
      verify: {
        async run() {
          return { ok: false, results: [{ command: o.command, output: o.output, ok: false }] };
        },
      },
    });
    await events.close?.();
    return await readFile(logPath, "utf8");
  }

  it("支一：verify 输出里的凭据在盘上没有明文，且掩码留痕（不是「什么都没记」）", async () => {
    const log = await runVerifyAndReadLog({
      // 命令行里就带着 key（`AWS_SECRET_ACCESS_KEY=… pnpm test` 是常见写法）⇒ 与输出同一族，都要净。
      // 别拿 `cat .env` 当这条的判据：那条命令本身没有秘密，脱敏原样放过才是对的（正是支二）。
      command: `AWS_SECRET_ACCESS_KEY=${FAKE_AWS} pnpm test`,
      output: `tests failed\nAKIA:${FAKE_AWS}\nOPENAI_API_KEY=${FAKE_KEY}\n`,
    });
    expect(log, "verify 这一拍根本没跑 ⇒ 这条判卷没有分辨力").toContain("verify_result");
    // 两份原文都要净：verify_result.results[].output，以及 loop 为同一拍补的那条 tool_result
    // （failureDigest 把 results 整段拼进去）。只净前一份 = 掩码在门里、钥匙在门口。
    expect(log).not.toContain(FAKE_AWS);
    expect(log).not.toContain(FAKE_KEY);
    expect(log).toContain("AKIA****");
  });

  it("支二：输出干净的同一拍逐字不变（脱敏不得改写没有秘密的字节）", async () => {
    const out = "FAIL src/a.test.ts\n  Expected 1 to be 2\nTests 1 failed\n";
    const log = await runVerifyAndReadLog({ command: "pnpm test", output: out });
    expect(log).toContain("verify_result");
    expect(log).toContain(JSON.stringify(out).slice(1, -1)); // 转义后的原文逐字在场
    expect(log).not.toContain("****");
  });
});

// ---- 2026-10-19：脱敏面自己的两条边界（都是实测出来的）----
// ① 循环引用：`redactValue` 无 visited-set ⇒ `RangeError` 从 `events.append` 里窜出
//    `runLoop`，**整轮任务死在那一次 emit**。工具是可能造出自引结构的（带 parent 指针的图）。
// ② 结构不变只对普通对象成立：`Object.entries` 把 Map/Set/Date 重建成 `{}`，
//    与"非字符串值原样返回"的承诺相反。事件形状是重放契约，不许被脱敏顺手拍平。
describe("脱敏面自身的边界：循环引用不炸、非普通对象不拍平", () => {
  /** 一条 emit 出自引 args 的 tool_call：跑得过 + 日志读得回 + 密钥仍被掩。 */
  async function runWith(args: Record<string, unknown>): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "redact-edge-"));
    dirs.push(dir);
    const logPath = join(dir, "events.jsonl");
    await runLoop({
      provider: providerEmitting({ id: "c1", name: "read_file", args }),
      events: createEventLog(logPath),
      workspace: dir,
      mode: "auto",
      userMessage: "跑一轮就停",
    });
    return readFile(logPath, "utf8");
  }

  it("循环引用的 args：不炸（整轮跑完）、日志读得回、密钥仍被掩、重逢处有显式占位", async () => {
    const cyclic: Record<string, unknown> = { path: "a.ts", key: FAKE_KEY };
    cyclic.self = cyclic;
    const log = await runWith(cyclic);
    expect(log).toContain("read_file");
    expect(log, "密钥仍要掩").not.toContain(FAKE_KEY);
    expect(log).toContain("循环引用");
  });

  it("自引用数组同样不炸（另一条递归路径）", async () => {
    const arr: unknown[] = ["a.ts", FAKE_KEY];
    arr.push(arr);
    const log = await runWith({ paths: arr });
    expect(log).not.toContain(FAKE_KEY);
    expect(log).toContain("循环引用");
  });

  it("非普通对象原样返回：Date 不被拍成 {}（结构是重放契约）", async () => {
    // 判据走 runLoop：args 里放一个 Date，日志里必须还是完整 ISO 串而不是 {}
    const log = await runWith({ path: "a.ts", scannedAt: new Date("2026-01-02T03:04:05.000Z"), key: FAKE_KEY });
    expect(log).not.toContain(FAKE_KEY);
    expect(log).toContain("2026-01-02T03:04:05.000Z");
    expect(log, "不许被拍平成空对象").not.toContain('"scannedAt":{}');
  });

  it("普通嵌套结构照旧逐键递归（这条修复没把原来的面改窄）", async () => {
    const log = await runWith({ path: "a.ts", nested: { deep: [FAKE_KEY, "plain"] } });
    expect(log).not.toContain(FAKE_KEY);
    expect(log).toContain("plain");
  });
});
