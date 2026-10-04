// 能力 10「失败轨迹 → 回归样本」的**接线**判卷（2026-10-05）。
//
// 病灶（现读，非抄台账）：`src/agent/gym/draft.ts` 的通路是齐的——`draftFromEvents`/`renderDraft`
// 能把一条会话算成草稿，但 HEAD 上它们的**唯一**调用方是 `scripts/gym-draft.ts` 那支手工 CLI，
// 而它缺省 dry run、要 `--apply` 才写盘（`scripts/gym-draft.ts:75`），也不在 `package.json` 的脚本表里。
// 于是判卷/bench 每跑一片红，`fixtures/gym/drafts/` 仍然是 0 条
// （`outputs/eval-harness-face-2026-10-04/verdict.md` §4.2.1「通路齐备、样本为零」）。
// 这组测试钉的不是「算得对不对」（`tests/gym-draft.test.ts` 已钉），而是**这条跳真的会被走**：
// 摘掉 distill 里那句调用 ⇒ 第 1 条必须红（本仓纪律：接线要钉在消费端，不钉在函数导出上）。
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { AgentEvent } from "../src/events";
import type { Provider, ModelOutput } from "../src/providers";
import type { Tool } from "../src/tools/base";
import { writeDraftFromFailedSession, draftDirFor } from "../src/agent/gym/draft";
import { failureDigestFromEvents, runSessionEndDistill } from "../src/agent/memory/distill";
import { replay } from "../src/events";

const user = (content: string): AgentEvent => ({ type: "user_message", content });
const call = (id: string, name: string, path?: string): AgentEvent =>
  ({ type: "tool_call", id, name, args: path === undefined ? {} : { path } });
const result = (callId: string, ok: boolean, output = ""): AgentEvent => ({ type: "tool_result", callId, ok, output });
const verify = (ok: boolean, attempt = 1, maxAttempts = 3, cause?: string): AgentEvent =>
  ({ type: "verify_result", callId: "v" + String(attempt), ok, attempt, maxAttempts, results: [], ...(cause ? { cause } : {}) });

/** 一条**真失败**的轨迹：写坏一次 + 验证到上限仍红（cause=code ⇒ 归模型，不是环境红）。 */
const FAILING: AgentEvent[] = [
  user("把分页 size 修对并跑测试证明全绿\n"),
  call("c1", "write_file", "src/pagination.js"),
  result("c1", false, "EACCES"),
  call("c2", "edit_file", "src/pagination.js"),
  result("c2", true),
  call("c3", "run_shell", undefined),
  result("c3", true),
  verify(false, 3, 3, "code"),
];
/** 反向证人：全程顺利、验绿的轨迹。 */
const GREEN: AgentEvent[] = [
  user("把分页 size 修对并跑测试证明全绿\n"),
  call("c1", "edit_file", "src/pagination.js"),
  result("c1", true),
  verify(true, 1),
];

/** 造一个「自带靶场」的工作区：只有 `fixtures/gym/index.json` 在场，草稿才有落点。 */
async function gymWorkspace(): Promise<string> {
  const ws = await mkdtemp(join(tmpdir(), "gymdraft-wire-"));
  await mkdir(join(ws, "fixtures", "gym"), { recursive: true });
  await writeFile(join(ws, "fixtures", "gym", "index.json"), JSON.stringify({ version: 1, cases: [] }), "utf8");
  return ws;
}

async function writeLog(ws: string, name: string, events: AgentEvent[]): Promise<string> {
  const logPath = join(ws, name);
  await writeFile(logPath, events.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
  return logPath;
}

/** 会话结束沉淀轮的脚本化 provider：本判卷只关心它**副作用**（草稿落没落盘），不关心模型说了什么。 */
function quietProvider(): Provider {
  return {
    async *stream(): AsyncIterable<ModelOutput> {
      yield { type: "assistant_message", content: "无" };
    },
  };
}
const rememberTool: Tool = { name: "remember", async run() { return { ok: true, output: "（本判卷不调用）" }; } };

async function listDrafts(ws: string): Promise<string[]> {
  return (await readdir(join(ws, "fixtures", "gym", "drafts"), { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

describe("writeDraftFromFailedSession（失败轨迹 ⇒ 盘上草稿）", () => {
  it("① 喂一条失败轨迹产物：草稿真落盘，且 DRAFT.md 点名失败原因", async () => {
    const ws = await gymWorkspace();
    const logPath = await writeLog(ws, "sess-fail.jsonl", FAILING);
    const events = await replay(logPath);
    const out = await writeDraftFromFailedSession({
      events, caseId: "sess-fail", digest: failureDigestFromEvents(events), workspace: ws,
    });
    expect(out.skipped, JSON.stringify(out)).toBeNull();
    // 落点沿用 `draftDirFor` 那条既有规则（cases/ 之外、按会话 id 一目录）。
    expect(out.dir).toBe(draftDirFor(join(ws, "fixtures", "gym"), "sess-fail"));
    expect(await listDrafts(ws)).toEqual(["sess-fail"]);
    const names = (await readdir(join(ws, "fixtures", "gym", "drafts", "sess-fail"))).sort();
    expect(names).toEqual(["DRAFT.md", "expect.candidate.json", "task.md"]);
    const draftMd = await readFile(join(ws, "fixtures", "gym", "drafts", "sess-fail", "DRAFT.md"), "utf8");
    // 「点名失败原因」= 与沉淀侧**同一份**证据原文（不是另编一句）：工具名×笔数 + 验证失败笔数。
    expect(draftMd).toContain("write_file×1");
    expect(draftMd).toContain("1 次验证失败");
    expect(draftMd).toContain("其中 1 次达上限停止");
    // 题面在 task.md（`renderDraft` 的既有分工；DRAFT.md 只放清单与证据）。
    expect(await readFile(join(ws, "fixtures", "gym", "drafts", "sess-fail", "task.md"), "utf8")).toContain("把分页 size 修对并跑测试证明全绿");
    const expectJson = JSON.parse(await readFile(join(ws, "fixtures", "gym", "drafts", "sess-fail", "expect.candidate.json"), "utf8")) as { mustPassVerify: boolean; mustChangeFiles: string[] };
    expect(expectJson.mustPassVerify).toBe(false);
    expect(expectJson.mustChangeFiles).toEqual(["src/pagination.js"]); // 写失败那笔不进候选集
  });

  it("② 同一条轨迹跑两次 ⇒ 不重复堆草稿，也不盖掉人已补过的件", async () => {
    const ws = await gymWorkspace();
    const logPath = await writeLog(ws, "sess-twice.jsonl", FAILING);
    const events = await replay(logPath);
    const first = await writeDraftFromFailedSession({ events, caseId: "sess-twice", digest: failureDigestFromEvents(events), workspace: ws });
    expect(first.skipped).toBeNull();
    // 人在草稿里补了靶子（repo/ 一条文件）——自动面第二次不许把它抹掉。
    await mkdir(join(ws, "fixtures", "gym", "drafts", "sess-twice", "repo"), { recursive: true });
    await writeFile(join(ws, "fixtures", "gym", "drafts", "sess-twice", "repo", "a.js"), "// pristine\n", "utf8");
    const second = await writeDraftFromFailedSession({ events, caseId: "sess-twice", digest: failureDigestFromEvents(events), workspace: ws });
    expect(second.skipped).toBe("already-drafted");
    expect(second.dir).toBeNull();
    expect(await listDrafts(ws)).toEqual(["sess-twice"]);
    const names = (await readdir(join(ws, "fixtures", "gym", "drafts", "sess-twice"))).sort();
    expect(names).toEqual(["DRAFT.md", "expect.candidate.json", "repo", "task.md"]);
  });

  it("③ 反向证人：非失败轨迹不落草稿（成功轮不产尺子素材）", async () => {
    const ws = await gymWorkspace();
    const logPath = await writeLog(ws, "sess-green.jsonl", GREEN);
    const events = await replay(logPath);
    const digest = failureDigestFromEvents(events);
    expect(digest).toBe(""); // 共用谓词自己那一侧也钉住
    const out = await writeDraftFromFailedSession({ events, caseId: "sess-green", digest, workspace: ws });
    expect(out.skipped).toBe("not-a-failure");
    expect(out.dir).toBeNull();
    const seen = await readdir(join(ws, "fixtures", "gym")).catch(() => [] as string[]);
    expect(seen).toEqual(["index.json"]); // 连 drafts/ 都不该被造出来
  });

  it("③b 反向证人：只有环境红的轨迹也不产（cause=timeout 不是模型的失败）", async () => {
    const ws = await gymWorkspace();
    const events = await replay(await writeLog(ws, "sess-env.jsonl", [user("t"), verify(false, 1, 1, "timeout")]));
    const out = await writeDraftFromFailedSession({ events, caseId: "sess-env", digest: failureDigestFromEvents(events), workspace: ws });
    expect(out.skipped).toBe("not-a-failure");
  });

  it("④ 工作区没有靶场（fixtures/gym/index.json 缺席）⇒ 不落草稿：产品跑在别人的仓里不该撒文件", async () => {
    const ws = await mkdtemp(join(tmpdir(), "gymdraft-nogym-"));
    const events = await replay(await writeLog(ws, "sess-x.jsonl", FAILING));
    const out = await writeDraftFromFailedSession({ events, caseId: "sess-x", digest: failureDigestFromEvents(events), workspace: ws });
    expect(out.skipped).toBe("no-gym-workspace");
    expect(out.dir).toBeNull();
  });

  it("⑤ 会话 id 取不到（证据指针要求指得出哪条会话）⇒ 不产", async () => {
    const ws = await gymWorkspace();
    const events = await replay(await writeLog(ws, "sess-y.jsonl", FAILING));
    const out = await writeDraftFromFailedSession({ events, caseId: "", digest: failureDigestFromEvents(events), workspace: ws });
    expect(out.skipped).toBe("no-session-id");
  });
});

describe("接线：会话结束沉淀轮真的会走这一跳", () => {
  it("⑥ runSessionEndDistill 跑一条失败会话 ⇒ fixtures/gym/drafts/<会话 id> 真出现", async () => {
    const ws = await gymWorkspace();
    const logPath = await writeLog(ws, "sess-wired.jsonl", FAILING);
    const out = await runSessionEndDistill({
      enabled: true, logPath, workspace: ws,
      provider: quietProvider(), rememberTool, emit: async () => {},
    });
    expect(out.kind).toBe("no_content"); // 沉淀结局不因草稿而变（草稿不是判据，也不冒充记忆）
    expect(await listDrafts(ws)).toEqual(["sess-wired"]);
    const draftMd = await readFile(join(ws, "fixtures", "gym", "drafts", "sess-wired", "DRAFT.md"), "utf8");
    expect(draftMd).toContain("1 次验证失败");
  });

  it("⑦ 反向半边：同一条**顺利**会话经同一入口 ⇒ 一个草稿都不落", async () => {
    const ws = await gymWorkspace();
    const logPath = await writeLog(ws, "sess-wired-green.jsonl", GREEN);
    await runSessionEndDistill({ enabled: true, logPath, workspace: ws, provider: quietProvider(), rememberTool, emit: async () => {} });
    const seen = await readdir(join(ws, "fixtures", "gym"));
    expect(seen).toEqual(["index.json"]);
  });
});
