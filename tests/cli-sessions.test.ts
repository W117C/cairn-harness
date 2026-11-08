// `cairn --sessions`（2026-10-30）：CLI 的会话发现面。
// 动机：`--replay/--session/--fork/--compact` 全按会话 id 寻址，而 CLI 用户此前没有任何地方能查 id
// （只能自己去 ls .agent/sessions）。只读、无凭据也跑；坏元数据照列文件事实。
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionMetadataRepository } from "../src/main/session-metadata";
import { createSession } from "../src/main/sessions";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const BIN = join(ROOT, "bin", "cairn.mjs");

function run(args: string[]): { status: number | null; out: string } {
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: "1" };
  for (const k of ["CAIRN_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "DEEPSEEK_API_KEY", "M0A_PROVIDER"]) delete env[k];
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd: ROOT, encoding: "utf8", env, input: "" });
  return { status: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

let ws = "";
beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), "cairn-cli-sessions-"));
  mkdirSync(join(ws, ".agent", "sessions"), { recursive: true });
});
afterEach(() => { rmSync(ws, { recursive: true, force: true }); });

describe("cairn --sessions", () => {
  it("--help 列出这个旗标（没进 help 的选项等于不存在）", () => {
    expect(run(["--help"]).out).toContain("--sessions");
  });

  it("空工作区：exit 0 + 明说还没有会话；没有 provider key 也照跑", () => {
    const r = run(["--sessions", "--workspace", ws]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("还没有会话");
  });

  it("列出 id / 标题 / 行数 / 会话级模型；sidecar 文件不混进列表", async () => {
    const dir = join(ws, ".agent", "sessions");
    const a = await createSession(dir, "会话A");
    await createSession(dir, "会话B");
    const repo = new SessionMetadataRepository(join(dir, "session-metadata.json"));
    await repo.setPrefs(a, { model: "glm-5.3-flash", thinking: "high" });
    writeFileSync(join(dir, "pins.jsonl"), JSON.stringify({ sessionId: a, eventId: 1, pinned: true, at: "2026-10-30T00:00:00.000Z" }) + "\n", "utf8");

    const r = run(["--sessions", "--workspace", ws]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("会话（2 条");
    expect(r.out).toContain("会话A");
    expect(r.out).toContain("会话B");
    expect(r.out).toContain("模型 glm-5.3-flash");
    expect(r.out).toContain("思考 high");
    expect(r.out).not.toContain("pins.jsonl");
  });

  it("元数据坏了：不冒充零会话——警告上屏，文件事实照列", async () => {
    const dir = join(ws, ".agent", "sessions");
    await createSession(dir, "坏档里的会话");
    writeFileSync(join(dir, "session-metadata.json"), "{ 不是 JSON", "utf8");
    const r = run(["--sessions", "--workspace", ws]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("会话元数据读不了");
    expect(r.out).toContain("坏档里的会话");
  });

  it("是只读列举：带任务描述 / 与其他模式同用一律拒（不让它悄悄吃掉任务）", () => {
    const withTask = run(["--sessions", "做点事"]);
    expect(withTask.status).toBe(2);
    expect(withTask.out).toContain("--sessions 不接受任务描述");
    const withServe = run(["--sessions", "--serve"]);
    expect(withServe.status).toBe(2);
    expect(withServe.out).toContain("不能与 --serve 同用");
  });
});
