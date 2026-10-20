// 安全扫描面不许静默空转（2026-10-19 独立评审追出的 HIGH）。
//
// 缺陷形状：脱敏藏在 loop 的 `events.append` 里 ⇒ 消费者拿到的是**已脱敏**的事件 ⇒
// `collectChangeSet` 从事件里取 `args.content` / `args.new_string` / `args.patch` 去扫密钥时，
// 那些串早就被掩成了 `AKIA****` ⇒ **`secret.*` 规则一条都不命中** ⇒
// 写进 `src/creds.ts` 的 `AKIA…` 在 security_report 里报 total=0，merge 闸因此放行，
// 凭据落进用户的主干。一道**静默空转**的安全闸：它每次都"跑过了"，只是什么也没看见。
//
// 修法（也是"薄"的那一版）：脱敏归**落盘边界**管（`src/events/log.ts` 自己擦），
// 内存流留**原件**——扫描面要真内容。
//
// 本组钉三件事（全部走**生产路径** `runAgent`，不自己搭景）：
// ① 盘上仍是脱敏的（"密钥不进主转录 JSONL"没破）；
// ② 报告里真的有这条发现，而不是 total=0；
// ③ 闸真的挡得住（merge 裁决从"放行"翻成"挡住"）。
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type AgentEvent, replay } from "../src/events";
import { runAgent, initSettingsStore } from "../src/main/agent-runner";
import { collectChangeSet, scanChangeSet } from "../src/agent/security/scan";
import { mergeGateVerdict } from "../src/agent/security/merge-gate";

const AWS_KEY = "AKIAIOSFODNN7EXAMPLE"; // secret.aws
const GH_KEY = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345"; // secret.github

const dirs: string[] = [];
afterEach(async () => {
  while (dirs.length > 0) await rm(dirs.pop()!, { recursive: true, force: true });
});

/** 走**生产路径**跑一场：脚本化模型写一个带凭据的文件 + 调 verify（收敛后触发 report hook）。 */
async function runWithCredential(tag: string, content: string): Promise<{ events: AgentEvent[]; logText: string }> {
  const ws = await mkdtemp(join(tmpdir(), "cairn-secscan-"));
  dirs.push(ws);
  await mkdir(join(ws, "src"), { recursive: true });
  await writeFile(join(ws, "package.json"), JSON.stringify({ name: "secscan-fixture", version: "0.0.0" }), "utf8");
  // verify 面（零依赖直通命令，不依赖沙箱/网络）：没有它 verify 那一拍是 no-surface ⇒
  // 报告 hook 的触发条件（verify 收敛且 ok）不成立 ⇒ 这组用例就测不到报告面。
  await mkdir(join(ws, ".agent"), { recursive: true });
  await writeFile(
    join(ws, ".agent", "config.json"),
    JSON.stringify({ verify: { test: ['node -e "process.exit(0)"'] } }),
    "utf8",
  );
  const script = [
    { type: "assistant_message", content: "写入样例并验证" },
    { type: "tool_call", id: tag + "-c1", name: "write_file", args: { path: "src/creds.ts", content } },
    { type: "tool_call", id: tag + "-v", name: "verify", args: {} },
    { type: "assistant_message", content: "完成" },
  ];
  const scriptPath = join(ws, "script.jsonl");
  await writeFile(scriptPath, script.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
  const settingsPath = join(ws, "settings.json");
  await writeFile(settingsPath, JSON.stringify({ provider: "demo", model: "", safeMode: "report", autoMemory: false }), "utf8");
  initSettingsStore(settingsPath);
  const logPath = join(ws, "events.jsonl");
  const prev = process.env.M1C_AUTONOMY_SCRIPT;
  process.env.M1C_AUTONOMY_SCRIPT = scriptPath;
  try {
    await runAgent({ workspace: ws, message: "写入样例并验证", mode: "auto", logPath, sandbox: null, trustedRepo: true });
  } finally {
    if (prev === undefined) delete process.env.M1C_AUTONOMY_SCRIPT;
    else process.env.M1C_AUTONOMY_SCRIPT = prev;
  }
  return { events: await replay(logPath), logText: await readFile(logPath, "utf8") };
}

describe("安全扫描面：脱敏归落盘边界，扫描面拿得到真内容", () => {
  it("盘上仍是脱敏的（'密钥不进主转录 JSONL'没破）", async () => {
    const { logText } = await runWithCredential("sec1", `const AWS = "${AWS_KEY}";\n`);
    expect(logText).toContain("write_file");
    expect(logText).not.toContain(AWS_KEY);
    expect(logText).toContain("AKIA****"); // 掩码是留痕，不是"什么都没记"
  });

  it("★报告里真的有这条发现，而不是 total=0（生产路径：runAgent → report hook）", async () => {
    const { events } = await runWithCredential("sec2", `const AWS = "${AWS_KEY}";\nconst GH = "${GH_KEY}";\n`);
    const report = events.find((e) => e.type === "security_report") as Extract<AgentEvent, { type: "security_report" }> | undefined;
    expect(report, "没产出 security_report").toBeDefined();
    expect(report!.summary.total, "报告说 total=0 ⇒ 凭据没被看见（这道闸在静默空转）").toBeGreaterThan(0);
    const ruleIds = report!.findings.map((f) => f.ruleId);
    expect(ruleIds).toContain("secret.aws");
    expect(ruleIds).toContain("secret.github");
  });

  it("★闸真的挡得住：同一条凭据，merge 裁决从「放行」翻成「挡住」", async () => {
    const { events } = await runWithCredential("sec3", `const AWS = "${AWS_KEY}";\n`);
    const report = events.find((e) => e.type === "security_report") as Extract<AgentEvent, { type: "security_report" }> | undefined;
    expect(report).toBeDefined();
    expect(mergeGateVerdict(report!.findings).allow, "凭据在场却放行合并").toBe(false);
  });

  it("对照：干净内容不产出密钥发现（闸不是'一律报警'）", async () => {
    const { events } = await runWithCredential("sec4", "export const x = 1;\n");
    const report = events.find((e) => e.type === "security_report") as Extract<AgentEvent, { type: "security_report" }> | undefined;
    if (report !== undefined) {
      expect(report!.findings.filter((f) => f.category === "secret")).toHaveLength(0);
      expect(mergeGateVerdict(report!.findings).allow).toBe(true);
    }
  });

  it("反向对照：脱敏后的同一份内容扫不出密钥（这正是旧实现的病根）", () => {
    const redacted = [{
      type: "tool_call", id: "t1", name: "write_file",
      args: { path: "src/creds.ts", content: `const AWS = "AKIA****";\n` },
    }] as unknown as AgentEvent[];
    expect(scanChangeSet(collectChangeSet(redacted))).toHaveLength(0);
  });
});
