// M7 consolidate.ts + store.ts 强度账/索引读侧的判卷面：
// · 巩固只写 memory-stats.json，topic 正文与 MEMORY.md 一个字节都不动（canary）；
// · 衰减/休眠落账语义、陈账清理、损坏账本按空账继续；
// · 查重（同 type + 词集 Jaccard）与「合并条子」的措辞口径（只指 remember op=replace）。
import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MEMORY_INDEX,
  MEMORY_STATS_FILE,
  indexLine,
  listTopics,
  parseIndex,
  parseIndexLine,
  readStats,
  readTopicBody,
  updateStats,
  writeStats,
  writeTopic,
} from "../src/agent/memory/store";
import {
  DUPLICATE_JACCARD_MIN,
  consolidateMemoryDir,
  consolidationDigest,
} from "../src/agent/memory/consolidate";

const NOW = "2026-10-25T00:00:00.000Z";

async function freshDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "dsh-m7-"));
}

describe("store：索引读侧与强度账 IO", () => {
  it("parseIndexLine 与 indexLine 往返；digest 含「·」也不劈开（最后一段整段归 digest）", () => {
    const line = indexLine("deploy-policy", "project", NOW, "部署策略 · 超时阈值");
    const parsed = parseIndexLine(line);
    expect(parsed).toEqual({ topic: "deploy-policy", type: "project", modified: NOW, digest: "部署策略 · 超时阈值" });
  });
  it("parseIndex 只收认得出的行，非索引行不进条目表", () => {
    const raw = ["# 标题", "- topic-a · project · 2026-10-25T00:00:00.000Z · 摘要", "杂行"].join("\n");
    expect(parseIndex(raw).map((e) => e.topic)).toEqual(["topic-a"]);
  });
  it("readStats/writeStats 往返；缺失 = 空账；损坏 = onCorrupt + 空账（fail-visible 继续）", async () => {
    const dir = await freshDir();
    try {
      expect(await readStats(dir)).toEqual({});
      await writeStats(dir, { t: { topic: "t", hits: 2, lastRetrieved: NOW, strength: 0.5, dormant: true } });
      const back = await readStats(dir);
      expect(back["t"]).toEqual({ topic: "t", hits: 2, lastRetrieved: NOW, strength: 0.5, dormant: true });
      await rm(join(dir, MEMORY_STATS_FILE));
      await mkdir(dir, { recursive: true });
      const { writeFile } = await import("node:fs/promises");
      await writeFile(join(dir, MEMORY_STATS_FILE), "{oops", "utf8");
      const warns: string[] = [];
      const empty = await readStats(dir, (w) => warns.push(w));
      expect(empty).toEqual({});
      expect(warns.length).toBe(1);
      expect(warns[0]).toContain("损坏");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("updateStats：next=null 一个字节都不写；next 非空落盘", async () => {
    const dir = await freshDir();
    try {
      await writeStats(dir, { a: { topic: "a", hits: 1, lastRetrieved: NOW, strength: 1 } });
      const before = await readFile(join(dir, MEMORY_STATS_FILE), "utf8");
      await updateStats(dir, async () => ({ value: 1, next: null }));
      expect(await readFile(join(dir, MEMORY_STATS_FILE), "utf8")).toBe(before);
      const v = await updateStats(dir, async (stats) => {
        stats["b"] = { topic: "b", hits: 1, lastRetrieved: NOW, strength: 1 };
        return { value: stats["b"]!.hits, next: stats };
      });
      expect(v).toBe(1);
      expect((await readStats(dir))["b"]).toBeDefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("consolidateMemoryDir（睡眠 pass）", () => {
  it("新建账：强度 1、锚点取 modified；正文与索引 canary 逐字不变", async () => {
    const dir = await freshDir();
    try {
      await writeTopic(dir, "young-one", "project", "年轻条目正文", NOW);
      const beforeIndex = await readFile(join(dir, MEMORY_INDEX), "utf8");
      const beforeBody = await readTopicBody(dir, "young-one");
      const report = await consolidateMemoryDir({ dir, nowISO: NOW });
      expect(report.topics).toBe(1);
      expect(report.tracked).toBe(1);
      expect(report.dormantMarked).toEqual([]);
      const stats = await readStats(dir);
      expect(stats["young-one"]).toEqual({ topic: "young-one", hits: 0, lastRetrieved: NOW, strength: 1 });
      // 巩固绝不触碰用户可见文件（正文/索引 canary）。
      expect(await readFile(join(dir, MEMORY_INDEX), "utf8")).toBe(beforeIndex);
      expect(await readTopicBody(dir, "young-one")).toBe(beforeBody);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("又弱又久没用过的条目被标休眠；近期命中的不标", async () => {
    const dir = await freshDir();
    try {
      await writeTopic(dir, "old-weak", "project", "老旧条目", "2026-01-01T00:00:00.000Z");
      await writeTopic(dir, "old-but-hit", "project", "近期命中条目", "2026-01-01T00:00:00.000Z");
      // 预置账：两者都放了 300 天，但 old-but-hit 的锚点在昨天（近期命中过 ⇒ 衰减锚点新）。
      await writeStats(dir, {
        "old-weak": { topic: "old-weak", hits: 1, lastRetrieved: "2026-01-01T00:00:00.000Z", strength: 0.05 },
        "old-but-hit": { topic: "old-but-hit", hits: 4, lastRetrieved: "2026-10-24T00:00:00.000Z", strength: 0.9 },
      });
      const report = await consolidateMemoryDir({ dir, nowISO: NOW });
      expect(report.dormantMarked).toEqual(["old-weak"]);
      const stats = await readStats(dir);
      expect(stats["old-weak"]!.dormant).toBe(true);
      expect(stats["old-but-hit"]!.dormant).toBeUndefined();
      // 已休眠的再跑一遍不重复计（幂等）。
      const again = await consolidateMemoryDir({ dir, nowISO: NOW });
      expect(again.dormantMarked).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("已删 topic 的陈账不进新账（列表收敛）；纯读会话（无变化）不 touch 盘", async () => {
    const dir = await freshDir();
    try {
      // 陈账：ghost 已无对应文件。
      await writeStats(dir, { ghost: { topic: "ghost", hits: 9, lastRetrieved: "2020-01-01T00:00:00.000Z", strength: 0.01 } });
      const report = await consolidateMemoryDir({ dir, nowISO: NOW });
      expect(report.topics).toBe(0);
      expect(report.tracked).toBe(0);
      // 陈账清理触发写（1 > 0×2）⇒ 盘上账已收敛为空。
      expect(await readStats(dir)).toEqual({});
      // 再跑一遍：无变化、无陈账 ⇒ 不写（mtime/内容不变由 next=null 保证，这里用内容一致断言）。
      await consolidateMemoryDir({ dir, nowISO: NOW });
      expect(await readStats(dir)).toEqual({});
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("查重：同 type 近重复报对（≥阈值），不同 type 不报", async () => {
    const dir = await freshDir();
    try {
      await writeTopic(dir, "deploy-a", "project", "部署超时阈值策略：网关超时统一 30 秒，重试两次", NOW);
      await writeTopic(dir, "deploy-b", "project", "部署超时阈值策略：网关超时统一 30 秒，重试三次", NOW);
      await writeTopic(dir, "deploy-c", "reference", "部署超时阈值策略：网关超时统一 30 秒，重试两次", NOW);
      const report = await consolidateMemoryDir({ dir, nowISO: NOW });
      expect(report.duplicates.length).toBe(1);
      expect(report.duplicates[0]!.a).toBe("deploy-a");
      expect(report.duplicates[0]!.b).toBe("deploy-b");
      expect(report.duplicates[0]!.score).toBeGreaterThanOrEqual(DUPLICATE_JACCARD_MIN);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("consolidationDigest（合并条子）", () => {
  it("无重复 → 空串（指令逐字不变）；有重复 → 带层标注、只指 remember op=replace、不替模型下删令", () => {
    expect(consolidationDigest([{ scope: "project", report: { dir: "/x", topics: 2, tracked: 2, decayed: 0, dormantMarked: [], duplicates: [] } }])).toBe("");
    const digest = consolidationDigest([
      { scope: "project", report: { dir: "/x", topics: 2, tracked: 2, decayed: 0, dormantMarked: [], duplicates: [{ a: "deploy-a", b: "deploy-b", score: 0.82 }] } },
      { scope: "global", report: { dir: "/y", topics: 0, tracked: 0, decayed: 0, dormantMarked: [], duplicates: [] } },
    ]);
    expect(digest).toContain("[巩固报告·疑似重复主题]");
    expect(digest).toContain("项目层");
    expect(digest).toContain("deploy-a ↔ deploy-b");
    expect(digest).toContain("0.82");
    expect(digest).toContain("op=replace");
    expect(digest).not.toContain("全局层"); // 全局层无重复不点名
  });
});

describe("listTopics 不把强度账当主题", () => {
  it("memory-stats.json 不是 .md ⇒ 不进主题列表", async () => {
    const dir = await freshDir();
    try {
      await writeTopic(dir, "real", "project", "正文", NOW);
      await writeStats(dir, { real: { topic: "real", hits: 1, lastRetrieved: NOW, strength: 1 } });
      const topics = await listTopics(dir);
      expect(topics.map((t) => t.topic)).toEqual(["real"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
