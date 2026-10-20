// 并发写入不许丢数据（2026-10-19 独立评审追出的两条 MEDIUM-HIGH）。
//
// ① `replaceRootFile` **一把锁都不拿**，而 `appendRootFile` 按路径串行 ⇒ 两者抢同一个文件时，
//    整写那一份把追加那笔**整个盖掉**，而两边都回执"已写入"。
//    实测：并发 `appendRootFile("APPENDED")` + `replaceRootFile("REPLACED")` ⇒ 盘上是 "REPLACED"。
//    原子写只保证"不写坏半个文件"，**不保证"不丢别人的那一笔"**——这是两件事。
//
// ② `remember` 的追加形态：读旧正文在**锁外**（`writeTopic` 的锁只护住"写"那一段）⇒
//    两个并发追加都读到同一份旧正文，后一个把前一个整个盖掉（两笔都回执"已写入"）。
//    实测：并发追加 FROM-A / FROM-B ⇒ 盘上只剩 FROM-B。
//
// 判据是**真并发**（两笔同时发起），不是顺序调用——顺序调用永远看不出这类丢写。
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendRootFile, initMemoryHome, projectMemoryDir, replaceRootFileIfMatches, rootFilePath } from "../src/agent/memory/store";
import { remember } from "../src/tools/remember";
import type { ToolContext } from "../src/tools";

let ws: string;
let home: string;
beforeEach(async () => {
  ws = await mkdtemp(join(tmpdir(), "lost-write-ws-"));
  home = await mkdtemp(join(tmpdir(), "lost-write-home-"));
  process.env.M2D_MEMORY_HOME = home;
  initMemoryHome(home);
});
afterEach(async () => {
  await rm(ws, { recursive: true, force: true });
  await rm(home, { recursive: true, force: true });
});
const ctx = (): ToolContext => ({ workspace: ws });

describe("根文件：追加与整写并发（不许丢那一笔）", () => {
  it("★并发 appendRootFile + 替换 ⇒ **两笔都在**（旧实现：整写那把没锁，追加那笔被静默盖掉）", async () => {
    // 替换是 CAS：expected 必须逐字等于当前内容。并发追加夹在中间 ⇒ 判据过期 ⇒ 替换**被拒**
    // （matched=false，一个字节都没写）；追加先落 ⇒ 替换排在它之后 ⇒ 追加也保住。
    // 两种时序下**两笔都在**——这就是 CAS 换来的确定性（旧实现是"谁后到谁赢"，且不报错）。
    const [cas] = await Promise.all([
      replaceRootFileIfMatches(ws, "architecture", "EXPECTED-OLD", "REPLACED-CONTENT"),
      appendRootFile(ws, "architecture", "APPENDED-CONTENT"),
    ]);
    const raw = await readFile(rootFilePath(ws, "architecture"), "utf8");
    expect(raw, "追加那笔被静默盖掉了 ⇒ 并发丢数据").toContain("APPENDED-CONTENT");
    // 替换要么被拒（判据过期），要么写进去了——两种都不许"既说成功又没写"
    if (cas.matched) expect(raw).toContain("REPLACED-CONTENT");
    else expect(raw).not.toContain("REPLACED-CONTENT");
  });

  it("替换的判据过期 ⇒ 拒（不写），而不是照着过期的判据整写", async () => {
    await appendRootFile(ws, "architecture", "CURRENT-CONTENT");
    const cas = await replaceRootFileIfMatches(ws, "architecture", "STALE-EXPECTED", "REPLACED");
    expect(cas.matched, "判据已经过期还判匹配 ⇒ 这不是 CAS").toBe(false);
    const raw = await readFile(rootFilePath(ws, "architecture"), "utf8");
    expect(raw).toContain("CURRENT-CONTENT");
    expect(raw).not.toContain("REPLACED");
  });

  it("两次并发追加 ⇒ 两笔都在（追加自己之间也不许互相覆盖）", async () => {
    await Promise.all([
      appendRootFile(ws, "architecture", "FIRST-CONTENT"),
      appendRootFile(ws, "architecture", "SECOND-CONTENT"),
    ]);
    const raw = await readFile(rootFilePath(ws, "architecture"), "utf8");
    expect(raw).toContain("FIRST-CONTENT");
    expect(raw).toContain("SECOND-CONTENT");
  });
});

describe("topic 追加：读-改-写整段在锁里", () => {
  it("★并发追加同一个 topic ⇒ 两笔都在（旧实现后一个把前一个整个盖掉）", async () => {
    const dir = projectMemoryDir(ws);
    const results = await Promise.all([
      remember.run({ scope: "project", kind: "memory", type: "project", topic: "concurrent", content: "FROM-A" }, ctx()),
      remember.run({ scope: "project", kind: "memory", type: "project", topic: "concurrent", content: "FROM-B" }, ctx()),
    ]);
    expect(results.every((r) => r.ok)).toBe(true); // 两笔都回执"已写入"——所以丢写更隐蔽
    const raw = await readFile(join(dir, "concurrent.md"), "utf8");
    expect(raw, "FROM-A 被盖掉了 ⇒ 并发丢数据").toContain("FROM-A");
    expect(raw, "FROM-B 被盖掉了 ⇒ 并发丢数据").toContain("FROM-B");
  });
});
