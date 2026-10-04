// 子进程 env 消毒的两格「同族出口」缺口（能力 7 密钥卫生 / §11.2 env 白名单制）。
//  ① 白名单被抄了两份且**已经漂了**：`src/tools/process.ts` 的 ENV_ALLOW 有 TERM，
//     `src/agent/plugins/hooks.ts` 那份没有 ⇒ 插件 hook 起的子进程天生少一个规格点名要传的变量。
//  ② `spawnTracked` 的 `env` 是**可选参数**，缺省 = `spawn(..., {env: undefined})` = 继承 process.env
//     ——而主进程把 BYOK key 解密后正写在 process.env.CAIRN_API_KEY 里。今天四个调用点都记得传，
//     但"记得传"正是本仓点名的"规矩只有生产者守、出口无观测者"那一类：第 5 个点一忘就漏。
import { describe, expect, it } from "vitest";
import { killGroup, sanitizedEnv, spawnTracked } from "../src/tools/process";
import { hookEnv } from "../src/agent/plugins/hooks";

/** 子进程里读自己的 env（不经 shell，避开宿主差异）。 */
function childEnv(opts: { env?: NodeJS.ProcessEnv }): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    const handle = spawnTracked(
      process.execPath,
      ["-e", "process.stdout.write(JSON.stringify(process.env))"],
      {
        cwd: process.cwd(),
        ...(opts.env === undefined ? {} : { env: opts.env }), // 刻意"不传"来复现缺省路径
        timeoutMs: 10_000,
        onTimeout: () => reject(new Error("子进程超时")),
      },
    );
    let buf = "";
    handle.child.stdout?.on("data", (b: Buffer) => { buf += b.toString("utf8"); });
    handle.child.once("exit", () => { handle.dispose(); try { resolve(JSON.parse(buf) as Record<string, string>); } catch { reject(new Error("子进程输出不是 JSON: " + buf.slice(0, 80))); } });
    handle.child.once("error", reject);
  });
}

describe("env 白名单只允许有一份事实源（§11.2 子进程白名单制）", () => {
  it("hookEnv 的宿主基础键集与 sanitizedEnv 逐键相等（今天红：hooks 少 TERM）", () => {
    // 当场造真值，不依赖宿主环境里 TERM 是否存在（否则这条判据在 TERM 被清的宿主上假绿）
    process.env.TERM = "dsh-probe-term";
    const shared = sanitizedEnv();
    const viaHook = hookEnv({ pluginRoot: "/p", pluginData: "/pd", workspace: "/w" });
    const hostKeys = Object.keys(shared).sort();
    const hookHostKeys = Object.keys(viaHook)
      .filter((k) => !(k === "PLUGIN_ROOT" || k === "PLUGIN_DATA" || k === "PROJECT_DIR"))
      .sort();
    const missing = hostKeys.filter((k) => !hookHostKeys.includes(k));
    const extra = hookHostKeys.filter((k) => !hostKeys.includes(k));
    expect({ missing, extra, termShared: shared.TERM, termHook: viaHook.TERM }).toEqual({
      missing: [], extra: [], termShared: "dsh-probe-term", termHook: "dsh-probe-term",
    });
  });

  it("两侧都必须挡住密钥类变量（这一半今天已绿，属反向钉）", () => {
    process.env.DSH_PROBE_TOKEN = "sk-should-never-be-inherited-0123456789";
    try {
      const shared = sanitizedEnv();
      const viaHook = hookEnv({ pluginRoot: "/p", pluginData: "/pd", workspace: "/w" });
      expect(shared.DSH_PROBE_TOKEN).toBeUndefined();
      expect(viaHook.DSH_PROBE_TOKEN).toBeUndefined();
    } finally {
      delete process.env.DSH_PROBE_TOKEN;
    }
  });
});

describe("spawnTracked 的 env 缺省必须 fail-closed（不传 ≠ 继承主进程）", () => {
  it("省略 env 时，子进程看不到主进程里的 BYOK 明文键", async () => {
    // 产品真实形态：agent-runner 把 BYOK key 解密后放进 process.env.CAIRN_API_KEY
    process.env.CAIRN_API_KEY = "sk-DshProbeByokShouldNotReachChild0123456";
    try {
      const env = await childEnv({});
      expect(env.CAIRN_API_KEY).toBeUndefined();
      expect(Object.keys(env)).not.toContain("CAIRN_API_KEY");
    } finally {
      delete process.env.CAIRN_API_KEY;
    }
  });

  it("显式传 sanitizedEnv() 的既有路径逐字不变（反向钉：白名单仍在、密钥仍不在）", async () => {
    process.env.CAIRN_API_KEY = "sk-DshProbeByokShouldNotReachChild654321";
    try {
      const env = await childEnv({ env: sanitizedEnv() });
      expect(env.CAIRN_API_KEY).toBeUndefined();
      expect(env.PATH).toBeDefined();
      expect(env.HOME).toBeDefined();
    } finally {
      delete process.env.CAIRN_API_KEY;
    }
  });
});

describe("killGroup 仍收得到不传 env 那条路径的进程（改动不得破回收）", () => {
  it("sleep 子进程被组杀后退出码非 0", async () => {
    const handle = spawnTracked("/bin/sh", ["-c", "sleep 30"], {
      cwd: process.cwd(), timeoutMs: 60_000, onTimeout: () => undefined,
    });
    const code = await new Promise<number | null>((resolve) => {
      handle.child.once("exit", (c) => resolve(c));
      setTimeout(() => { killGroup(handle.child, "SIGKILL"); }, 50);
    });
    handle.dispose();
    expect(code).not.toBe(0);
  });
});
