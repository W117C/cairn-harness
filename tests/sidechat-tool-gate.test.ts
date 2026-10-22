// sidechat 的读工具**必须有一张自己的门**。
//
// 旧形状的两种错法（2026-10-21 独立评审）：
//   ① 首场主 run 之前：sidechat 用的还是全局 `TOOLS` 的裸实现 ⇒ 敏感路径判据一次也没跑，
//      `read_file .env` 会把凭据直接送进旁路模型上下文（外泄面）。
//   ② 首场主 run 之后：`installAppTools` 已把 `TOOLS.read_file` 换成 `gatedTool` 闭包，
//      而 sidechat 没有 run scope ⇒ 每次读都撞「工具门未接线（fail-closed）」。
// 生产入口现在显式给一张只读门会话的工具表（`sidechatToolTable`）：两种时序下都过同一套
// 只读判据，且不借主会话的档位。本文件量这两个时序外加敏感路径的负向。
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  handleSidechatAsk, handleSidechatCreate, initSessionsDir, initSettingsStore, installAppTools, setSettings,
} from "../src/main/agent-runner";
import { scriptedSidechatModel } from "../src/agent/sidechat";
import { createEventLog, type AgentEvent } from "../src/events";

let dir: string;
let seq = 0;

const readScript = (path: string) => scriptedSidechatModel([
  { type: "tool_call", id: `read-${String(seq++)}`, name: "read_file", args: { path } },
  { type: "assistant_message", content: "读完了" },
]);

async function ask(path: string): Promise<AgentEvent[]> {
  const { id } = await handleSidechatCreate("parent");
  const res = await handleSidechatAsk(id, "看看这个文件", { parentSessionId: "parent", model: readScript(path) });
  expect(res.ok, res.error).toBe(true);
  return res.events ?? [];
}
const resultOf = (events: AgentEvent[]) => events.find((e) => e.type === "tool_result");

beforeEach(async () => {
  dir = await mkdtemp(join(process.env.PI_SCRATCH_DIR ?? tmpdir(), "sidechat-gate-"));
  await mkdir(join(dir, ".agent"), { recursive: true });
  vi.stubEnv("M1E_SAFE_MODE", "off");
  vi.stubEnv("M2E_USER_PLUGINS", join(dir, "plugins"));
  vi.stubEnv("M2E_LOOSE_SKILLS", join(dir, "skills"));
  vi.stubEnv("M2E_PLUGIN_DATA", join(dir, "plugin-data"));
  vi.stubEnv("M2E_TRUST_FILE", join(dir, "trust.json"));
  initSettingsStore(join(dir, "settings.json"));
  // 生产形态：会话根 = <ws>/.agent/sessions（父会话工作区由这一形态反推）。
  initSessionsDir(join(dir, ".agent", "sessions"));
  await mkdir(join(dir, ".agent", "sessions"), { recursive: true });
  await createEventLog(join(dir, ".agent", "sessions", "parent.jsonl")).append({
    type: "user_message", content: "父会话",
  });
  await setSettings({ provider: "demo", safeMode: "off", autoMemory: false, workspace: dir });
  await writeFile(join(dir, "note.txt"), "NOTE-CONTENT", "utf8");
  await writeFile(join(dir, ".env"), "SECRET=sk-should-never-reach-sidechat", "utf8");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true }).catch(() => {});
});

describe("sidechat 只读执行面（独立门会话）", () => {
  it("首场主 run 之前：正常文件读得到，敏感路径不外泄", async () => {
    const normal = resultOf(await ask("note.txt"));
    expect(normal?.type === "tool_result" && normal.ok, JSON.stringify(normal)).toBe(true);
    expect(normal?.type === "tool_result" ? normal.output : "").toContain("NOTE-CONTENT");

    const secret = resultOf(await ask(".env"));
    expect(secret?.type === "tool_result" && secret.ok).toBe(false);
    const text = secret?.type === "tool_result" ? secret.output : "";
    expect(text).not.toContain("sk-should-never-reach-sidechat");
    expect(text, "敏感路径必须被只读门拒绝，而不是静默执行").toContain("[permission denied]");
  });

  it("主会话工具门装好之后：旁路仍可读，不再被『工具门未接线』误杀", async () => {
    // 模拟首场 run 之后：installAppTools 把全局 TOOLS 就地换成 gatedTool 闭包。
    // 旁路的显式工具表不读这张全局表，因此不受安装时序影响。
    installAppTools({ automation: false });
    const normal = resultOf(await ask("note.txt"));
    expect(normal?.type === "tool_result" && normal.ok, JSON.stringify(normal)).toBe(true);
    const text = normal?.type === "tool_result" ? normal.output : "";
    expect(text).toContain("NOTE-CONTENT");
    expect(text).not.toContain("工具门未接线");
  });
});
