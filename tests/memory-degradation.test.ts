// 第 315 页：记忆注入断掉时不许再无痕——一道出口、三个消费者各配一条证人。
//
// 起因是现读到的一个**真触发**（不是假想）：`<memdir>/lesson-<非法名>.md` 这种文件名（中文、空格…）
// 过不了 `validateTopic`，`lessonsSection` 读到它就把整次注入抛出 ⇒ 从前三个调用点各自 `try/catch`
// （两处空 catch、一处 console.debug）⇒ **同批那条合规教训一起消失，而模型与操作者都不知道**。
// 本文件判的是"消失得看得见"；至于"该不该只丢那一份"（逐份隔离）是下一格的决定，不混在这里。
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  buildMemoryInjectionSafe, memoryUnavailableText, EMPTY_MEMORY_INJECTION,
  type MemoryInjection,
} from "../src/agent/memory/inject";
import { projectMemoryDir, writeTopic } from "../src/agent/memory/store";
import { EVIDENCE_LINE_PREFIX } from "../src/agent/memory/lessons";
import { buildWorkerSystemMessages } from "../src/agent/worker-prompt";
import { buildSidechatContext } from "../src/agent/sidechat";
import { composeTurnMessages } from "../src/agent/glm-session";
import { trackedExistingFiles } from "../scripts/lib/scan-scope";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

/** 造一份"有一坏 + 有一好"的记忆目录：合规那份走真 `writeTopic`（往返形状不由我手抄），
 *  坏的那份只能手写文件名——`writeTopic` 自己会拒这种名字，这正是这个触发点的来历。 */
async function workspaceWith(badName: string | null): Promise<{ workspace: string; memdir: string }> {
  const workspace = mkdtempSync(join(tmpdir(), "memdegrade-"));
  const memdir = projectMemoryDir(workspace);
  mkdirSync(memdir, { recursive: true });
  writeFileSync(join(memdir, "MEMORY.md"), "# Memory Index\n");
  // `writeTopic` 是异步的：不 await 就等于"文件还没落地就开始注入"，正控会假落成空（实测踩过一次）。
  await writeTopic(memdir, "lesson-good", "feedback",
    "正文一条教训\n" + EVIDENCE_LINE_PREFIX + " session s1 / callId c1\n", new Date("2026-10-03").toISOString());
  if (badName !== null) {
    writeFileSync(join(memdir, badName),
      "---\ntype: feedback\nmodified: 2026-10-03T00:00:00.000Z\n---\n\n正文一条教训\n" +
      EVIDENCE_LINE_PREFIX + " session s1 / callId c1\n");
  }
  return { workspace, memdir };
}
const globalRoot = (workspace: string): string => join(workspace, "no-global");
/** provider 消息上的 content 是 `string | null`，别把它写成 `string | undefined`（会被判定成不兼容）。 */
const texts = (ms: readonly { content?: string | null }[]): string[] => ms.map((m) => m.content ?? "");

describe("记忆注入的降级面：断要断得看得见（第 315 页）", () => {
  it("真触发：一份不合规矩的 lesson 文件名 ⇒ 交回 unavailable，并点名是哪一份（不再只说『注入失败』）", async () => {
    const { workspace } = await workspaceWith("lesson-中文命名.md");
    const r = await buildMemoryInjectionSafe({ workspace, globalRoot: globalRoot(workspace) });
    expect(r.unavailable, "有坏文件却不吭声＝回到第 312 页那一格").not.toBeNull();
    expect(r.unavailable).toContain("lesson-中文命名");
    expect(r.injection, "降级支必须交同一个空壳，不许三处各造一份字面量").toEqual(EMPTY_MEMORY_INJECTION);
  });

  it("正控：同一套路径只放合规文件 ⇒ unavailable 为 null，且那条教训真进了 project 段（上一条不是因为『根本没有记忆』）", async () => {
    const { workspace } = await workspaceWith(null);
    const r = await buildMemoryInjectionSafe({ workspace, globalRoot: globalRoot(workspace) });
    expect(r.unavailable).toBeNull();
    expect(r.injection.project, "正控落空＝上面那条反例测的是取料，不是降级").not.toBeNull();
    expect(r.injection.project ?? "").toContain("lesson-good");
  });

  it("措辞有界：原因段截到 200 字，整段有上限（这条线上「外界文本有界」也包括我们自己写的话）", () => {
    const long = memoryUnavailableText("E".repeat(5_000));
    const why = /原因：([^）]*)）/u.exec(long)?.[1] ?? "";
    expect(why.length, "原因段没截＝一份超长异常把整块预算吃掉").toBeLessThanOrEqual(200);
    expect(long.length).toBeLessThan(400);
    expect(long).toContain("不代表这个工作区没有沉淀");
  });

  // 三个消费者各一条独立用例：合在一条里，三枚锚点就会全红在同一条 ⇒ 其中两枚没有分辨力。
  it("消费者① worker 任务书：同一个触发下，那句说明出现在 system 块里（从前那里是空 catch）", async () => {
    const { workspace } = await workspaceWith("lesson-坏 名字.md");
    const workerMsgs = await buildWorkerSystemMessages(
      { task: "t", context: { files: [] }, mode: "read" }, workspace);
    expect(texts(workerMsgs).some((t) => t.includes("本次记忆注入不可用")),
      "worker 侧仍然无痕：" + JSON.stringify(texts(workerMsgs).map((t) => t.slice(0, 24)))).toBe(true);
  });

  it("消费者② 旁路问答：同一形状（此前那里是 catch 里一句注释就算跳过）", async () => {
    const { workspace } = await workspaceWith("lesson-坏 名字.md");
    const sidechat = await buildSidechatContext({
      sidechatLogPath: join(workspace, "sidechat", "events.jsonl"),
      mainLogPath: join(workspace, "main.jsonl"),
      workspace,
    });
    expect(texts(sidechat.messages).some((t) => t.includes("本次记忆注入不可用"))).toBe(true);
  });

  it("消费者③ 主会话装配口：交给 memoryNote 这个入参的东西本身得带着原因", async () => {
    const { workspace } = await workspaceWith("lesson-坏 名字.md");
    const r = await buildMemoryInjectionSafe({ workspace, globalRoot: globalRoot(workspace) });
    expect(r.unavailable, "⑶ 的入参本身得是降级态").not.toBeNull();
    expect(r.unavailable).toContain("lesson-坏 名字");
  });

  it("落位纪律：那句说明排在『记忆该出现的位置』，不许挪到尾部（前缀缓存按前缀匹配，尾部追加才不动前面几段）", () => {
    const note = memoryUnavailableText("boom");
    const msgs = composeTurnMessages({
      system: "S",
      memory: { project: null, global: null } as Pick<MemoryInjection, "project" | "global">,
      memoryNote: note,
      skills: "SKILLS",
      history: [{ role: "user", content: "H" }],
    });
    const at = texts(msgs).findIndex((t) => t.includes("本次记忆注入不可用"));
    expect(at, "声明了要出声却没落位").toBeGreaterThan(0);
    const skillsAt = texts(msgs).findIndex((t) => t.includes("SKILLS"));
    expect(at, "说明落在 skills 之后＝记忆那一段的位置被换掉了").toBeLessThan(skillsAt);
    expect(msgs[0]!.content).toBe("S");
  });

  it("反向对照：正常那批一个字都不许多（缺省零行为——否则每轮都往上下文里塞一句『不可用』的假话）", async () => {
    const { workspace } = await workspaceWith(null);
    const workerMsgs = await buildWorkerSystemMessages({ task: "t", context: { files: [] } }, workspace);
    expect(texts(workerMsgs).join("\n")).not.toContain("本次记忆注入不可用");
    const sidechat = await buildSidechatContext({
      sidechatLogPath: join(workspace, "s.jsonl"), mainLogPath: join(workspace, "m.jsonl"), workspace,
    });
    expect(texts(sidechat.messages).join("\n")).not.toContain("本次记忆注入不可用");
  });

  it("同族出口守一条：`src/**` 里直接 `await buildMemoryInjection(` 的只剩 inject.ts 自己（第四处想抄一份裸 try/catch 就得先过这条）", () => {
    const scope = trackedExistingFiles(ROOT, "src");
    const callers = scope.files
      .map((p) => ({ p, text: readFileSync(join(ROOT, p), "utf8") }))
      .filter((x) => /await buildMemoryInjection\s*\(/u.test(x.text))
      .map((x) => x.p)
      .filter((p) => !p.endsWith("memory/inject.ts"));
    expect(callers, "消费者必须走 `buildMemoryInjectionSafe`：" + callers.join(", ")).toEqual([]);
  });
});
