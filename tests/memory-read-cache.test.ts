// 记忆读缓存判卷（H3，第 1330 页热路径清单）：记忆注入每请求 ~30 次文件读、
// 而记忆文件在两次模型请求之间几乎不变 ⇒ readOrNull 加 (mtimeMs,size) 键缓存。
// 判语义三格：二读必命中；写后必失效（mtime 刷新）；删除后不假命中。
// 反向锚点内嵌：写后若仍命中，第二条当场红（缓存陈旧 = 注入内容会造假）。
import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listTopics, readTopicBody, writeTopic, deleteTopic, memoryReadCacheStats } from "../src/agent/memory/store";

describe("记忆读缓存（mtime+size 键，写后失效）", () => {
  it("二读命中、写后失效、删后不假命中（三态递进）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cairn-mem-cache-"));
    try {
      await writeTopic(dir, "lesson-a", "lesson", "先读测试再改实现", "2026-11-19T00:00:00Z");
      const before = memoryReadCacheStats();
      await listTopics(dir);
      await readTopicBody(dir, "lesson-a");
      const afterFirst = memoryReadCacheStats();
      expect(afterFirst.misses).toBeGreaterThan(before.misses); // 首读：全 miss
      await listTopics(dir);
      await readTopicBody(dir, "lesson-a");
      const afterSecond = memoryReadCacheStats();
      expect(afterSecond.hits).toBeGreaterThan(afterFirst.hits); // 二读：命中
      // 写后失效：writeTopic 走 tmp+rename，mtime 刷新 ⇒ 再读必须 miss（内容取新的）
      await writeTopic(dir, "lesson-a", "lesson", "改过的教训正文", "2026-11-19T00:00:01Z");
      const s2 = memoryReadCacheStats();
      const body = await readTopicBody(dir, "lesson-a");
      const afterWrite = memoryReadCacheStats();
      expect(afterWrite.misses).toBeGreaterThan(s2.misses);
      expect(body).toBe("改过的教训正文"); // 取到的是新内容，不是缓存陈旧值
      // 删后不假命中
      await deleteTopic(dir, "lesson-a");
      expect(await readTopicBody(dir, "lesson-a")).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("跨实例一致性：两个调用方读同一文件，A 写后 B 读到新值（缓存按 stat 对账，不按实例清）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cairn-mem-cache2-"));
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "lesson-b.md"), "---\ntype: lesson\nmodified: 2026-11-19\n---\n旧\n");
      await readTopicBody(dir, "lesson-b");
      await writeFile(join(dir, "lesson-b.md"), "---\ntype: lesson\nmodified: 2026-11-20\n---\n新\n");
      // 直接改盘（绕过 writeTopic）：mtime 变了 ⇒ 缓存必须失效
      expect(await readTopicBody(dir, "lesson-b")).toContain("新");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
