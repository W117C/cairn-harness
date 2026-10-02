/* 仓库地图（模型的全局视图）的覆盖面自述与降级出声——待办 #33。
   第 201 页查明的两半：地图吃同一顶 mtime 帽（帽本身已随 #21 笔1 修好），但
   ① 正文一字不自述，② 任何失败只走 `console.debug` ⇒ 模型读到"这轮没有地图"，
   与"这仓库没有结构"**同形**（规则 261：尺的「读不到」与「没有问题」不许同形）。
   判卷形状：真 `buildMap` 打在合成工作区上（行为证人），加一条**接线**证人——
   地图文本要真的进到发出去的那次请求里，而不是只活在纯函数里。 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildMap, mapInjectText, type MapBuilder, type MapBuildResult } from "../src/agent/map/build";
import { MAX_FILES_DEFAULT } from "../src/agent/map/cap";
import { createGlmSessionProvider } from "../src/agent/glm-session";
import { createEventLog, type EventLog } from "../src/events";

const TMP: string[] = [];
let cache = "";
const dirs: string[] = [];

async function mkChain(n: number): Promise<string> {
  // f0 最新、fN-1 最旧（mtime 依次递减）⇒ "谁在帽内"确定，不赌毫秒精度
  const ws = await mkdtemp(join(tmpdir(), "map-cover-"));
  TMP.push(ws);
  for (let i = 0; i < n; i++) {
    const p = join(ws, `f${String(i)}.ts`);
    await writeFile(p, i === 0 ? "export function seed(x) { return x + 1; }\n" : `import { seed } from "./f0";\nexport function u${String(i)}(x) { return seed(x); }\n`, "utf8");
    const t = new Date(Date.UTC(2026, 0, 1 + (n - 1 - i)));
    const { utimes } = await import("node:fs/promises");
    await utimes(p, t, t);
  }
  return ws;
}

function fakeBuilder(result: Partial<MapBuildResult>): MapBuilder {
  const full: MapBuildResult = {
    text: "", tokens: 0, ok: true, fromTagsCache: 0, parsed: 0, fromRenderCache: false, fingerprint: "fp",
    cap: MAX_FILES_DEFAULT, graphFiles: 10, candidates: 10, retrievedFiles: 0, ...result,
  };
  return { build: async () => full };
}

async function firstRequest(mapBuilder: MapBuilder): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "map-wire-"));
  TMP.push(dir);
  const log: EventLog = createEventLog(join(dir, "events.jsonl"));
  await log.append({ type: "user_message", content: "TASK" });
  await log.close?.();
  const seen: string[] = [];
  const provider = createGlmSessionProvider(join(dir, "events.jsonl"), {
    workspace: dir, system: "SYSTEM", mapBuilder,
    transport: async function* (messages) {
      seen.push(messages.map((m) => `${m.role}:${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`).join("\n"));
      yield { type: "assistant_message", content: "ok" };
    },
  });
  for await (const _ of provider.stream([])) { /* drain */ }
  expect(seen.length, "前提：真的发出过一次请求").toBeGreaterThan(0);
  return seen[0] ?? "";
}

describe("地图的覆盖面自述（与影响面共用一把尺）", () => {
  afterAll(async () => { for (const d of TMP) await rm(d, { recursive: true, force: true }).catch(() => {}); });

  it("地图非全量时正文带同一句覆盖面自述", async () => {
    cache = await mkdtemp(join(tmpdir(), "map-cover-cache-"));
    TMP.push(cache);
    const ws = await mkChain(6);
    const built = await buildMap({ workspace: ws, tagsCacheDir: join(cache, "p"), maxFiles: 2, maxInputTokens: 128_000 });
    expect(built.ok, `前提：这张图建起来了（error=${String(built.error ?? "")}）`).toBe(true);
    expect(built.cap).toBe(2);
    expect(built.graphFiles).toBe(2);
    expect(built.candidates, "分母要来自帽前那份全量候选").toBe(6);
    const injected = mapInjectText(built) ?? "";
    expect(injected).toContain("另有 4 个候选文件没进这张图");
    expect(injected.startsWith(built.text), "自述是**追加**在正文之后，不改正文本身").toBe(true);
  });

  it("收全时注入文本与地图正文逐字相同（反向对照）", async () => {
    const ws = await mkChain(3);
    const built = await buildMap({ workspace: ws, tagsCacheDir: join(cache, "q"), maxInputTokens: 128_000 });
    expect(built.ok).toBe(true);
    expect(built.candidates).toBe(3);
    expect(built.graphFiles).toBe(3);
    expect(mapInjectText(built), "缺省帽已是安全阀 ⇒ 正常仓库不该多一个字").toBe(built.text);
  });

  it("地图降级要出声，并且不许被读成「仓库没有结构」", async () => {
    // 真失败：工作区不存在 ⇒ rg 以退出码 2 失败 ⇒ buildMap 走内部 catch（不是 mock）
    const built = await buildMap({ workspace: join(tmpdir(), "map-cover-不存在-xyz"), tagsCacheDir: join(cache, "z"), maxInputTokens: 128_000 });
    expect(built.ok).toBe(false);
    expect(built.text).toBe("");
    const line = mapInjectText(built) ?? "";
    expect(line).toContain("仓库地图本次不可用");
    expect(line).toContain("不代表仓库没有结构");
    expect(line, "原因要带出来，否则模型无从判断该等还是该换工具").toContain("rg");
  });
});

describe("接线：那两句要真的发出去", () => {
  it("会话首请求里带着地图的自述行与降级行（装配面有观察者）", async () => {
    const degraded = await firstRequest(fakeBuilder({ ok: false, text: "", error: "impact: tree-sitter unavailable" }));
    expect(degraded).toContain("仓库地图本次不可用");
    const partial = await firstRequest(fakeBuilder({ text: "MAP-BODY", graphFiles: 2, cap: 2, candidates: 9 }));
    expect(partial).toContain("MAP-BODY");
    expect(partial).toContain("另有 7 个候选文件没进这张图");
    const full = await firstRequest(fakeBuilder({ text: "MAP-BODY", graphFiles: 9, cap: MAX_FILES_DEFAULT, candidates: 9 }));
    expect(full).toContain("MAP-BODY");
    expect(full).not.toContain("覆盖度");
    // 第三个出口：构建器**抛出来**（不是它自己 ok:false 的降级）。两个出口都要出声，
    // 否则"摘掉 ok:false 那一支"与"摘掉 catch 那一支"只有一把尺会红（同族：三支各装一次自述）。
    const thrown = await firstRequest({ build: async () => { throw new Error("boom-map-face"); } });
    expect(thrown).toContain("仓库地图本次不可用");
    expect(thrown).toContain("boom-map-face");
    // 关掉地图（`map:false`）时零行为：连"不可用"这句都不该出现
    const dir = await mkdtemp(join(tmpdir(), "map-wire-off-"));
    TMP.push(dir);
    const offLog = createEventLog(join(dir, "events.jsonl"));
    await offLog.append({ type: "user_message", content: "TASK" });
    await offLog.close?.();
    const seen: string[] = [];
    const provider = createGlmSessionProvider(join(dir, "events.jsonl"), {
      workspace: dir, system: "SYSTEM", map: false,
      transport: async function* (messages) {
        seen.push(messages.map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? ""))).join("\n"));
        yield { type: "assistant_message", content: "ok" };
      },
    });
    for await (const _ of provider.stream([])) { /* drain */ }
    expect(seen[0] ?? "").not.toContain("仓库地图");
  });
});
