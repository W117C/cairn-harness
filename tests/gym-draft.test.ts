// 靶场草稿（待办 #47）判卷：一条真会话里，哪一半能自动得出、哪一半必须由人来给。
// 这组测试守的不是「算得对不对」这一件，而是**别把没核过的观察伪装成判据**：
//  ① 写失败的那笔不进候选必改集；② worker 子流的写盘/验证不算 parent 的（同 #8 那族归因缺陷）；
//  ③ 会话没验过 ⇒ 不产 expect.candidate.json（不拿 false 冒充判据）；④ 草稿路径逃不出 cases 守卫。
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../src/events";
import { draftFromEvents, renderDraft, draftDirFor } from "../src/agent/gym/draft";
import { casePathProblem, loadGymIndex } from "../src/agent/gym/case";

const user = (content: string): AgentEvent => ({ type: "user_message", content });
const call = (id: string, path: string, agentId?: string): AgentEvent =>
  ({ type: "tool_call", id, name: "write_file", args: { path }, ...(agentId ? { agent_id: agentId } : {}) });
const result = (callId: string, ok: boolean, agentId?: string): AgentEvent =>
  ({ type: "tool_result", callId, ok, output: "", ...(agentId ? { agent_id: agentId } : {}) });
const verify = (ok: boolean, agentId?: string): AgentEvent =>
  ({ type: "verify_result", callId: "v", ok, attempt: 1, maxAttempts: 1, results: [], ...(agentId ? { agent_id: agentId } : {}) });

describe("draftFromEvents（会话 → 草稿）", () => {
  it("一条改完并验绿的会话：题面、候选集、verify 都取到，且仍列「人要给」那三条", () => {
    const d = draftFromEvents([user("把 sum 夹紧到 0..100\n"), call("c1", "src/a.ts"), result("c1", true), verify(true)]);
    expect(d.task).toBe("把 sum 夹紧到 0..100\n");
    expect(d.candidateChanges).toEqual(["src/a.ts"]);
    expect(d.verifyOk).toBe(true);
    expect(d.missing.filter((m) => m.startsWith("repo/")).length).toBe(1);
    expect(d.missing.some((m) => m.includes("negative.json"))).toBe(true);
    expect(d.missing.some((m) => m.includes("改过"))).toBe(true);
  });

  it("写失败的那笔不进候选集，且点名「先确认这条轨迹值不值得固化」", () => {
    const d = draftFromEvents([user("t"), call("c1", "src/bad.ts"), result("c1", false), call("c2", "src/good.ts"), result("c2", true), verify(true)]);
    expect(d.candidateChanges).toEqual(["src/good.ts"]);
    expect(d.failedWrites).toBe(1);
    expect(d.missing.some((m) => m.includes("写盘失败 1 次"))).toBe(true);
  });

  it("worker 子流的写盘与验证都不算 parent 的（agent_id 在场即排除，并出声）", () => {
    const d = draftFromEvents([user("t"), call("c1", "src/w.ts", "agent-7"), result("c1", true), verify(true, "agent-7")]);
    expect(d.candidateChanges).toEqual([]);
    expect(d.workerWrites).toBe(1);
    expect(d.verifyOk).toBeNull();
    expect(d.verifyAttempts).toBe(0);
    expect(d.missing.some((m) => m.includes("worker 子流"))).toBe(true);
    expect(d.missing.some((m) => m.includes("不产 expect.json"))).toBe(true);
  });

  it("callId 撞名（provider 缺省 id 是流内序号）：worker 的失败结果不算 parent 写坏，parent 自己的仍算", () => {
    // 缺省 id 形如 `call-0`（openai）/`gemini-call-0`：parent 与 worker 各有一条流 ⇒ 同号是常态。
    // 只在 tool_call 面挡 agent_id 时，worker 那条 `call-0` 的失败结果会命中 parent 的 callPath，
    // 于是草稿冒出「写盘失败 1 次 ⇒ 先确认这条轨迹值不值得固化」——一个凭空的废弃理由。
    const fromWorker = draftFromEvents([user("t"), call("call-0", "src/a.ts"), result("call-0", false, "agent-7"), verify(true)]);
    expect(fromWorker.failedWrites).toBe(0);
    expect(fromWorker.missing.some((m) => m.includes("写盘失败"))).toBe(false);
    // 反向半边（否则「凡 tool_result 一律跳过」也能过）：不带 agent_id 的同一条必须照计。
    const fromParent = draftFromEvents([user("t"), call("call-0", "src/a.ts"), result("call-0", false), verify(true)]);
    expect(fromParent.failedWrites).toBe(1);
  });

  it("同一路径既成又败：按成功计入一次，不因次数重复", () => {
    const d = draftFromEvents([user("t"), call("c1", "src/x.ts"), result("c1", false), call("c2", "src/x.ts"), result("c2", true), verify(true)]);
    expect(d.candidateChanges).toEqual(["src/x.ts"]);
    expect(d.failedWrites).toBe(1);
  });

  it("多次 verify 取最后一次；题面之外的 user_message 单独计数", () => {
    const d = draftFromEvents([user("第一问"), verify(true), user("补一句"), call("c1", "a.ts"), result("c1", true), verify(false)]);
    expect(d.task).toBe("第一问");
    expect(d.extraUserMessages).toBe(1);
    expect(d.verifyOk).toBe(false);
    expect(d.missing.some((m) => m.includes("还有 1 条 user_message"))).toBe(true);
  });

  it("压根没写过盘的会话：点名它不适合进靶场，而不是产一份空 expect", () => {
    const d = draftFromEvents([user("读一下这个文件"), verify(true)]);
    expect(d.candidateChanges).toEqual([]);
    expect(d.missing.some((m) => m.includes("一次成功的写盘都没有"))).toBe(true);
  });
});

describe("renderDraft / draftDirFor（草稿的形状）", () => {
  it("verify 未知 ⇒ 不产 expect.candidate.json；验过 ⇒ 产，且文件名带 candidate", () => {
    const noVerify = renderDraft(draftFromEvents([user("t"), call("c1", "a.ts"), result("c1", true)]), "sess-1");
    expect(Object.keys(noVerify).sort()).toEqual(["DRAFT.md", "task.md"]);
    const verified = renderDraft(draftFromEvents([user("t"), call("c1", "a.ts"), result("c1", true), verify(true)]), "sess-1");
    expect(Object.keys(verified).sort()).toEqual(["DRAFT.md", "expect.candidate.json", "task.md"]);
    expect(JSON.parse(verified["expect.candidate.json"]!).mustPassVerify).toBe(true);
    // loadCase 只认 expect.json ⇒ 草稿就算躺在 cases 里也不会被当判据跑
    expect(Object.keys(verified)).not.toContain("expect.json");
    expect(verified["DRAFT.md"]).toContain("不是判据");
  });

  it("默认落点是 drafts/，不是 cases/", () => {
    expect(draftDirFor("/repo/fixtures/gym", "abc")).toBe("/repo/fixtures/gym/drafts/abc");
  });
});

describe("casePathProblem（草稿不许混进冻结面）", () => {
  const root = "/repo/fixtures/gym/cases";
  it("普通相对路径放行，逃逸与绝对路径点名", () => {
    expect(casePathProblem(root, "sum-clamp")).toBeNull();
    expect(casePathProblem(root, "a/b")).toBeNull();
    expect(casePathProblem(root, "../drafts/x")).toBe("逃出 cases 根目录");
    expect(casePathProblem(root, "/etc")).toBe("绝对路径");
  });

  it("loadGymIndex 遇到逃逸条目直接抛（fail-loud，不静默跳过）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gym-index-"));
    await writeFile(join(dir, "index.json"), JSON.stringify({ version: 1, cases: [{ id: "x", path: "../drafts/x" }] }), "utf8");
    await expect(loadGymIndex(dir)).rejects.toThrow("判据必须在冻结面之内");
    await mkdir(join(dir, "ok"), { recursive: true });
    await writeFile(join(dir, "index.json"), JSON.stringify({ version: 1, cases: [{ id: "ok", path: "ok" }] }), "utf8");
    expect((await loadGymIndex(dir)).cases.length).toBe(1);
  });
});
