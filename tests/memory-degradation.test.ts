// 第 315 页：记忆注入断掉时不许再无痕——一道出口、三个消费者各配一条证人。
//
// 触发点在第 316 页换过一次，这里说清换成什么、为什么：
// · 从前用的是「`.agent/memory/lesson-<非法名>.md`」——一份坏文件名把整次注入抛出。
//   第 316 页把它逐份隔离掉了（坏的那一份只丢那一份），所以那个触发**已经不再降级**。
// · 现在用的是「记忆文本里有工作区外 @引用 ⇒ 走生产默认的决议落账 ⇒ 全局目录写不进去」。
//   这一条不落假想：三个调用点都只传 `{ workspace }`，persist 就是 `saveExternalRefDecision` 真写盘。
// · 顺带把全局记忆目录重定向到临时盘：本仓的规矩是测试数据既不落工作区也不落用户家目录
//   （见 tests/vitest.config.ts 里 PI_SCRATCH_DIR / M7_IMPACT_TAGS_DIR 那两段）。
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildMemoryInjectionSafe, memoryUnavailableText, EMPTY_MEMORY_INJECTION,
  type MemoryInjection,
} from "../src/agent/memory/inject";
import { globalMemoryDir, initMemoryHome, projectMemoryDir, projectAgentDir, writeTopic } from "../src/agent/memory/store";
import { EVIDENCE_LINE_PREFIX } from "../src/agent/memory/lessons";
import { buildWorkerSystemMessages } from "../src/agent/worker-prompt";
import { buildSidechatContext } from "../src/agent/sidechat";
import { composeTurnMessages } from "../src/agent/glm-session";
import { trackedExistingFiles } from "../scripts/lib/scan-scope";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

/** 「写不进去」是拿**真文件系统**造的：`blocker` 是个普通文件，它下面的目录建不出来 ⇒ ENOTDIR。
 *  不注入假回调——被验的那支是生产默认那条 persist。 */
const scratch = mkdtempSync(join(tmpdir(), "memdegrade-home-"));
writeFileSync(join(scratch, "blocker"), "我是文件，不是目录");
const blockedHome = join(scratch, "blocker", "memory");
const writableHome = join(scratch, "ok", "memory");
let prevEnvHome: string | undefined;
let prevHomeDir: string;
const useHome = (dir: string): void => {
  process.env.M2D_MEMORY_HOME = dir;
  initMemoryHome(dir);
};
beforeAll(() => {
  prevEnvHome = process.env.M2D_MEMORY_HOME;
  prevHomeDir = globalMemoryDir();
});
afterAll(() => {
  if (prevEnvHome === undefined) delete process.env.M2D_MEMORY_HOME;
  else process.env.M2D_MEMORY_HOME = prevEnvHome;
  initMemoryHome(prevHomeDir);
  rmSync(scratch, { recursive: true, force: true });
  for (const p of live) rmSync(p, { recursive: true, force: true });
});
const live: string[] = [];

/** 一份"有一条合规教训 ＋ 文本里带工作区外 @引用"的项目记忆。 */
async function refWorkspace(): Promise<string> {
  const workspace = mkdtempSync(join(tmpdir(), "memdegrade-"));
  const memdir = projectMemoryDir(workspace);
  mkdirSync(memdir, { recursive: true });
  writeFileSync(join(memdir, "MEMORY.md"), "# Memory Index\n");
  // `writeTopic` 是异步的：不 await 就等于"文件还没落地就开始注入"，正控会假落成空（实测踩过一次）。
  await writeTopic(memdir, "lesson-good", "feedback",
    "正文一条教训\n" + EVIDENCE_LINE_PREFIX + " session s1 / callId c1\n", new Date("2026-10-03").toISOString());
  writeFileSync(join(projectAgentDir(workspace), "ARCHITECTURE.md"),
    "# 架构\n\n本工作区允许读 @/etc/hosts 这一条外部引用。\n");
  live.push(workspace);
  return workspace;
}
const globalRoot = (workspace: string): string => join(workspace, "no-global");
/** provider 消息上的 content 是 `string | null`，别把它写成 `string | undefined`（会被判定成不兼容）。 */
const texts = (ms: readonly { content?: string | null }[]): string[] => ms.map((m) => m.content ?? "");

describe("记忆注入的降级面：断要断得看得见（第 315 页）", () => {
  it("真触发：外部引用的决议写不进全局目录 ⇒ 交回 unavailable，原因里带着失败的那条路径", async () => {
    useHome(blockedHome);
    const workspace = await refWorkspace();
    const r = await buildMemoryInjectionSafe({ workspace, globalRoot: globalRoot(workspace) });
    expect(r.unavailable, "写不进决议却一声不吭＝回到第 312 页那一格").not.toBeNull();
    expect(r.unavailable).toContain("blocker");
    expect(r.injection, "降级支必须交同一个空壳，不许三处调用点各造一份字面量").toEqual(EMPTY_MEMORY_INJECTION);
  });

  it("正控：同一个触发、家目录可写 ⇒ unavailable 为 null，且那条教训真进了 project 段（上一条不是因为『根本没有记忆』）", async () => {
    useHome(writableHome);
    const workspace = await refWorkspace();
    const r = await buildMemoryInjectionSafe({ workspace, globalRoot: globalRoot(workspace) });
    expect(r.unavailable, "正控落空＝上面那条反例测的是取料，不是降级").toBeNull();
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
    useHome(blockedHome);
    const workspace = await refWorkspace();
    const workerMsgs = await buildWorkerSystemMessages(
      { task: "t", context: { files: [] }, mode: "read" }, workspace);
    expect(texts(workerMsgs).some((t) => t.includes("本次记忆注入不可用")),
      "worker 侧仍然无痕：" + JSON.stringify(texts(workerMsgs).map((t) => t.slice(0, 24)))).toBe(true);
  });

  it("消费者② 旁路问答：同一形状（此前那里是 catch 里一句注释就算跳过）", async () => {
    useHome(blockedHome);
    const workspace = await refWorkspace();
    const sidechat = await buildSidechatContext({
      sidechatLogPath: join(workspace, "sidechat", "events.jsonl"),
      mainLogPath: join(workspace, "main.jsonl"),
      workspace,
    });
    expect(texts(sidechat.messages).some((t) => t.includes("本次记忆注入不可用"))).toBe(true);
  });

  it("消费者③ 主会话装配口：交给 memoryNote 这个入参的东西本身得带着原因", async () => {
    useHome(blockedHome);
    const workspace = await refWorkspace();
    const r = await buildMemoryInjectionSafe({ workspace, globalRoot: globalRoot(workspace) });
    expect(r.unavailable, "⑶ 的入参本身得是降级态").not.toBeNull();
    expect(r.unavailable).toContain("blocker");
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
    useHome(writableHome);
    const workspace = await refWorkspace();
    const workerMsgs = await buildWorkerSystemMessages({ task: "t", context: { files: [] } }, workspace);
    expect(texts(workerMsgs).join("\n")).not.toContain("本次记忆注入不可用");
    const sidechat = await buildSidechatContext({
      sidechatLogPath: join(workspace, "s.jsonl"), mainLogPath: join(workspace, "m.jsonl"), workspace,
    });
    expect(texts(sidechat.messages).join("\n")).not.toContain("本次记忆注入不可用");
  });

  it("同族出口守一条：`src/**` 里直接 `await buildMemoryInjection(` 的只剩 inject.ts（第四处想抄一份裸 try/catch 就得先过这条）", () => {
    const scope = trackedExistingFiles(ROOT, "src");
    const callers = scope.files
      .map((p) => ({ p, text: readFileSync(join(ROOT, p), "utf8") }))
      .filter((x) => /await buildMemoryInjection\s*\(/u.test(x.text))
      .map((x) => x.p)
      .filter((p) => !p.endsWith("memory/inject.ts"));
    expect(callers, "消费者必须走 `buildMemoryInjectionSafe`：" + callers.join(", ")).toEqual([]);
  });
});
