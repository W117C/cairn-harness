// 记忆作用域过滤判卷（ADR 0015 §五 S1 的第二步：从「声明」到「检索过滤」）。
//
// 判的是什么：
//   ① 缺席作用域 = project（既有记忆升级后不被读成「团队共享」）；
//   ② 允许集缺席 = 不过滤（老调用方逐字不变）；空允许集 = 什么都读不到（不是全读）；
//   ③ 过滤器真的接在 `selectRecall` 上：被排除的候选不会出现在结果里；
//   ④ 认不出的作用域值按 project 处理，不猜成更宽的 team。
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildMemoryInjection } from "../src/agent/memory/inject";
import { writeTopic } from "../src/agent/memory/store";

const NOW = "2026-11-16T00:00:00.000Z";
import { filterByScope, memberMemoryDir, scopeAllowed, scopeDirs, scopeOf, scopesForAgent } from "../src/agent/memory/scope";
import { selectRecall, type RecallInput } from "../src/agent/memory/retrieval";
import { selectRecallHybrid } from "../src/agent/memory/semantic";

const entry = (over: Partial<RecallInput> & { topic: string }): RecallInput => ({
  type: "project", digest: "wallpaper contrast floor", body: "wallpaper contrast floor 4.5", ...over,
} as RecallInput);

const candidates: RecallInput[] = [
  entry({ topic: "a-project" }),                       // 缺席 scope ⇒ project
  entry({ topic: "b-team", scope: "team" }),
  entry({ topic: "c-member", scope: "member" }),
];

describe("记忆作用域", () => {
  it("缺席 = project；认不出也按 project（不猜成 team）", () => {
    expect(scopeOf(undefined)).toBe("project");
    expect(scopeOf("team")).toBe("team");
    expect(scopeOf("member")).toBe("member");
    expect(scopeOf("随便写的")).toBe("project");
  });

  it("允许集缺席 = 全放行；空允许集 = 全挡（空集合不是全读）", () => {
    expect(scopeAllowed("member", undefined)).toBe(true);
    expect(scopeAllowed("member", [])).toBe(false);
    expect(filterByScope(candidates, undefined)).toHaveLength(3);
    expect(filterByScope(candidates, [])).toHaveLength(0);
    expect(filterByScope(candidates, ["project"]).map((c) => c.topic)).toEqual(["a-project"]);
    expect(filterByScope(candidates, ["team", "member"]).map((c) => c.topic)).toEqual(["b-team", "c-member"]);
  });

  it("过滤器接在 selectRecall 上：被排除的候选不会入选，顺序不被重排", () => {
    const query = "wallpaper contrast floor";
    const all = selectRecall(query, candidates, { k: 3 }).map((p) => p.topic);
    expect(all.length).toBe(3);
    const onlyTeam = selectRecall(query, candidates, { k: 3, scopes: ["team"] }).map((p) => p.topic);
    expect(onlyTeam).toEqual(["b-team"]);
    expect(selectRecall(query, candidates, { k: 3, scopes: [] })).toEqual([]);
  });

  it("混合召回（lexical 路径）把 scopes 透传下去", async () => {
    const outcome = await selectRecallHybrid("wallpaper contrast floor", candidates, { k: 3, scopes: ["member"] });
    expect(outcome.mode).toBe("lexical");
    expect(outcome.picks.map((p) => p.topic)).toEqual(["c-member"]);
  });
});

describe("作用域目录解析", () => {
  it("成员私有目录：只收合法 id，路径不再拼接别的段", () => {
    expect(memberMemoryDir("/home/mem", "m1")).toBe("/home/mem/members/m1");
    for (const bad of ["../逃", "a/b", "a.b", "", "x".repeat(65)]) {
      expect(() => memberMemoryDir("/home/mem", bad)).toThrow(/成员 id/);
    }
  });

  it("三档目录：没给成员就只给 project/team（不猜成员的路径）", () => {
    const withoutMember = scopeDirs("/home/mem", "/ws/.agent/memory");
    expect(withoutMember.map((d) => d.scope)).toEqual(["project", "team"]);
    const withMember = scopeDirs("/home/mem", "/ws/.agent/memory", "m1");
    expect(withMember).toEqual([
      { scope: "project", dir: "/ws/.agent/memory" },
      { scope: "team", dir: "/home/mem" },
      { scope: "member", dir: "/home/mem/members/m1" },
    ]);
  });
});

describe("运行身份 → 允许集", () => {
  it("成员线程读三档；其余读 project/team（集合由身份推，模型不能自己指定）", () => {
    expect(scopesForAgent("member:m1")).toEqual(["project", "team", "member"]);
    expect(scopesForAgent("worker-a")).toEqual(["project", "team"]);
    expect(scopesForAgent(undefined)).toEqual(["project", "team"]);
    // 形似但不是成员的 id 不给成员档（前缀必须精确）
    expect(scopesForAgent("member")).toEqual(["project", "team"]);
    expect(scopesForAgent("members:m1")).toEqual(["project", "team"]);
  });
});

describe("作用域接进注入层（运行期过滤）", () => {
  it("scopes=[project] ⇒ 全局层的条目不会被召回；不给 scopes ⇒ 两层的都能召回", async () => {
    const root = await mkdtemp(join(tmpdir(), "cairn-memory-scope-"));
    try {
      const workspace = join(root, "ws");
      const globalRoot = join(root, "global");
      const projMemory = join(workspace, ".agent", "memory");
      await mkdir(projMemory, { recursive: true });
      await mkdir(globalRoot, { recursive: true });
      await writeTopic(projMemory, "proj-topic", "project", "wallpaper contrast floor is 4.5 to 1\nproject fact", NOW);
      await writeTopic(globalRoot, "glob-topic", "project", "wallpaper contrast floor measured on device\nglobal fact", NOW);

      const both = await buildMemoryInjection({ workspace, globalRoot, queryText: "wallpaper contrast floor" });
      expect(both.project).toContain("proj-topic");
      expect(both.global).toContain("glob-topic");

      const projectOnly = await buildMemoryInjection({
        workspace, globalRoot, queryText: "wallpaper contrast floor", scopes: ["project"],
      });
      expect(projectOnly.project).toContain("proj-topic");
      expect(projectOnly.global ?? "").not.toContain("glob-topic");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
