// 桌面端沙箱自检判卷（2026-10-16）。
//
// 缺陷形状（本轮实测定性）：`src/main/agent-runner.ts:788` 的模块级缺省值是
// `{ available:false, reason:"尚未自检" }`，而 `src/permissions/risk.ts:258` 的 `sandboxRisk`
// 只区分两种输入——`null`（未接线，不触发）与 `false`（**自检过但降级**）。桌面壳从开机起
// 没调过 `initSandbox()` ⇒ 恒为 `false` ⇒ 每一次写向工具被抬成 risk=high ⇒ auto 档
// （`riskAskAt` 就是 high）永远送审。用户看到的是：切到「自动」档，写文件照样等审批卡。
//
// 这一份判卷钉三格，缺一格都能被"改个措辞"绕过去：
//   ① 纯函数格：`sandboxRisk` 对 `false` 抬 high、对 `null` 不抬（口径本身不许变）；
//   ② 装配格：`createKernelHost` 真的调了 `initSandbox`（源码针脚 + 运行时调用计数）；
//   ③ 端到端格：装配后 `handleAgentRun` 读到的 sandboxState 不再恒 false
//      （这一格才防得住"调是调了，但调用点排在某个 await 之后被抢先"）。
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { evaluate, newAutonomySession } from "../../../src/permissions";
import * as agentRunner from "../../../src/main/agent-runner";
import * as sandbox from "../../../src/main/sandbox";
import { handleAgentState } from "../../../src/main/state-handlers";
import { createKernelHost } from "../src/main/kernel-host";

const dir = mkdtempSync(join(tmpdir(), "cairn-sbx-"));
const workspace = join(dir, "ws");
const userData = join(dir, "userData");
mkdirSync(workspace, { recursive: true });
mkdirSync(userData, { recursive: true });
writeFileSync(join(userData, "settings.json"), JSON.stringify({ provider: "demo", model: "" }));

const ambientKeys = ["M3A_MAIN_SCRIPT", "M0A_PROVIDER", "CAIRN_MODEL", "M0B_WORKSPACE"] as const;
const ambientBackup = ambientKeys.map((k) => [k, process.env[k]] as const);
for (const k of ambientKeys) delete process.env[k];
process.env.M3A_AGENTS_DEMO = "1";

afterAll(() => {
  delete process.env.M3A_AGENTS_DEMO;
  for (const [k, v] of ambientBackup) {
    if (v !== undefined) process.env[k] = v;
  }
  vi.restoreAllMocks();
});

/** `EvaluateDecision` 是联合型：`deny` 分支没有 `risk` 字段。本格断言问的是「风险被抬到几」，
 *  真出现 deny 时返回字面量 "deny" 让断言当场红，而不是静默读成 undefined 假绿。 */
function riskOf(d: ReturnType<typeof evaluate>): string {
  return d.verdict === "deny" ? "deny" : d.risk;
}

describe("沙箱自检：auto 档免批的前提（2026-10-16 桌面端缺陷）", () => {
  it("① 口径：sandboxAvailable=false 抬 high（降级送审），null 不抬（未接线不触发）", () => {
    // 这一格钉的是 risk.ts 的语义本身。若将来有人把 false 也改成"不触发"，
    // 降级宿主上 auto 档会重新静默放行写向——那是把 fail-closed 方向反过来，必须先过这一格。
    for (const tool of ["write_file", "run_shell"] as const) {
      const args = tool === "run_shell" ? { command: "echo hi" } : { path: "a.txt", content: "x" };
      const degraded = newAutonomySession("auto", { rules: [], sandboxAvailable: false, sessionScopes: new Set() });
      const unwired = newAutonomySession("auto", { rules: [], sandboxAvailable: null, sessionScopes: new Set() });
      expect(riskOf(evaluate(tool, args, degraded)), tool).toBe("high");
      expect(riskOf(evaluate(tool, args, unwired)), tool).toBe("none");
    }
  });

  it("② 装配：createKernelHost 调用了 initSandbox（唯一能翻 sandboxState 的入口）", () => {
    // 源码针脚：判据不是"文件里有 initSandbox 这个词"，而是 createKernelHost 函数体内调了它
    // （import 了不调 = 缺陷原样）。取函数体而不是全文：别处出现这个词不算。
    const hostSrc = readFileSync(new URL("../src/main/kernel-host.ts", import.meta.url), "utf8");
    const body = hostSrc.slice(hostSrc.indexOf("export function createKernelHost"));
    expect(body, "createKernelHost 必须调 initSandbox()").toContain("initSandbox()");

    // 运行时计数格：spy 掉真自检（它 spawn sandbox-exec，判卷不该依赖宿主 Seatbelt 状态），
    // 断言"建一次 host ⇒ 自检被请求一次"。这一格才抓得住"针脚在但被 await 抢先/条件短路掉"。
    const spy = vi.spyOn(agentRunner, "initSandbox").mockResolvedValue({ available: true });
    try {
      createKernelHost({
        workspaces: [workspace],
        activeWorkspace: workspace,
        userDataDir: userData,
        outbox: () => undefined,
      });
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("③ 端到端：自检结果真的进了 handleAgentRun 读的那一份 sandboxState", async () => {
    // 前两格都可能绿而缺陷仍在（调了一个同名但没写模块态的函数；或写了但写在 run 之后）。
    // 这一格直接问生产读的那个值：spy 返回 available:true 后建 host，再走
    // `handleAgentState()` 的 sandbox 段——它经 `setStateHandlerDeps` 读的正是
    // `handleAgentRun` 喂给 `runAgent` 的那一份模块态。
    //
    // 为什么 spy 打在 `sandbox.checkSandbox` 而不是 `initSandbox`：`initSandbox` 的本体就是
    // 「await checkSandbox() 后写模块态」——把它整个 mock 掉，被断言的那个模块态恰恰没人写了
    // （第一版就这么写的，③当场红）。打在底层才保留真实的写入路径，只换掉"本机有没有 Seatbelt"。
    const spy = vi.spyOn(sandbox, "checkSandbox").mockResolvedValue({ available: true });
    try {
      createKernelHost({
        workspaces: [workspace],
        activeWorkspace: workspace,
        userDataDir: userData,
        outbox: () => undefined,
      });
      // initSandbox 内部是 await checkSandbox()，等一个微任务队列排空即写毕
      await vi.waitFor(async () => {
        const state = await handleAgentState();
        expect(state.sandbox.available, "自检后 sandboxState.available 必须是 true").toBe(true);
      });
    } finally {
      spy.mockRestore();
    }
  });
});
