// 半写尾行修复的判卷（2026-10-01 收口）：进程被硬杀在 write 中途 ⇒ 文件尾留半条 JSON。
// 读者侧一直按「尾部半写可丢」容错，写入侧此前没人补——下一次 append 会把它与下一条事件
// **拼成一条坏行**，新事件静默不可见。修复在新开句柄时做（跨进程续写的唯一入口）。
// 三条边界各钉一条：尾修好且响亮 / 中间坏行**不许**被这条修碰（重放仍要抛）/ 正常追加零打扰。
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeAllEventLogs, createEventLog, replay, type AgentEvent } from "../src/events";

let dir: string;
let path: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "events-tail-"));
  path = join(dir, "events.jsonl");
});
afterEach(async () => {
  await closeAllEventLogs();
  rmSync(dir, { recursive: true, force: true });
});

const EV = (n: number): AgentEvent => ({ type: "user_message", content: `第 ${n} 条` }) as AgentEvent;
const line = (n: number): string => JSON.stringify({ type: "user_message", content: `第 ${n} 条`, ts: n });

describe("repairPartialTail：硬杀后的续写", () => {
  it("半写尾行被裁掉并响亮告警；下一条事件独立成行，重放读得到（不修的话它会被拼成坏行而消失）", async () => {
    // 种子用裸 writeFileSync（绕开本进程的句柄缓存，模拟"上一个进程被杀"的现场）
    const goodPrefix = line(1) + "\n" + line(2) + "\n";
    const partial = '{"type":"tool_resu'; // 半条 JSON，无换行
    writeFileSync(path, goodPrefix + partial, "utf8");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const log = createEventLog(path);
      await log.append(EV(3));
      const warnText = warn.mock.calls.map((c) => String(c[0])).join("\n");
      expect(warnText).toContain("半写尾行");
      expect(warnText).toContain(`已丢弃未成行的 ${String(Buffer.byteLength(partial))} 字节`);

      const content = readFileSync(path, "utf8");
      expect(content.startsWith(goodPrefix), "已完整落盘的字节一个不许动").toBe(true);
      expect(content).not.toContain("tool_resu");
      const bodyLines = content.trimEnd().split("\n");
      expect(bodyLines).toHaveLength(3);
      expect((JSON.parse(bodyLines[2]!) as { content: string }).content).toBe("第 3 条"); // append 会盖 ts，按解析比

      const events = await replay(path);
      expect(events.map((e) => (e as { content: string }).content)).toEqual(["第 1 条", "第 2 条", "第 3 条"]);
    } finally {
      warn.mockRestore();
    }
  });

  it("正常文件（以换行收尾）零打扰：不告警、旧字节逐字不动、追加只加不改", async () => {
    const goodPrefix = line(1) + "\n";
    writeFileSync(path, goodPrefix, "utf8");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const log = createEventLog(path);
      await log.append(EV(2));
      expect(warn.mock.calls.map((c) => String(c[0])).join("\n")).not.toContain("半写尾行");
      const content = readFileSync(path, "utf8");
      expect(content.startsWith(goodPrefix)).toBe(true);
      expect((await replay(path)).length).toBe(2);
    } finally {
      warn.mockRestore();
    }
  });

  it("中间坏行**不动**：这条修只管尾部——重放仍会对中间坏行当场抛（不许被修安静地抹掉）", async () => {
    const midBad = line(1) + "\n" + "{broken\n" + line(2) + "\n";
    writeFileSync(path, midBad, "utf8");
    const log = createEventLog(path);
    await log.append(EV(3)); // 尾行是完整的换行结尾 ⇒ 修复不该触发、更不该碰中间
    const content = readFileSync(path, "utf8");
    expect(content.startsWith(midBad), "中间坏行逐字保留").toBe(true);
    const bodyLines = content.trimEnd().split("\n");
    expect((JSON.parse(bodyLines[bodyLines.length - 1]!) as { content: string }).content).toBe("第 3 条");
    await expect(replay(path)).rejects.toThrow(/坏行/u);
  });

  // ---- 2026-10-19：分支二打偏的真缺陷（半写的是**第一条**事件）----
  // 旧代码用 `scanned < TAIL_SCAN_CAP` 当循环条件，退出时分不清「扫完全文都没换行」与
  // 「扫到上限就收手」：小于一个 chunk（64KB）的文件一轮扫完，cut 仍是 null ⇒ 掉进分支二
  // 「补换行隔离」。那不是隔离，是把**尾部**坏行升级成**中间**坏行——replay 见到"坏行后面
  // 还有好行"会当场抛 midBadLineError ⇒ 会话永久打不开。而"第一个事件被硬杀"正是 headless
  // run 的常见形状（agent-runner 先 rm 日志再 createEventLog）。
  it("半写的是**第一条**事件（全文无换行）：裁到 0 而不是补换行——补换行会让会话永久打不开", async () => {
    const tornFirst = '{"type":"session_meta","kind":"si'; // 33 字节、无换行
    writeFileSync(path, tornFirst, "utf8");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const log = createEventLog(path);
      await log.append(EV(1));
      const warnText = warn.mock.calls.map((c) => String(c[0])).join("\n");
      // 裁掉并说清丢了多少字节；**不许**走那句「超过 1MB 无换行」（文件总共 33 字节）
      expect(warnText).toContain("半写尾行");
      expect(warnText).toContain(`已丢弃未成行的 ${String(Buffer.byteLength(tornFirst))} 字节`);
      expect(warnText, "全文已扫完 ⇒ 边界已知，不该拿上限当借口").not.toContain("无换行，放弃自动裁剪");

      const content = readFileSync(path, "utf8");
      expect(content, "没成行的尾段一个字节都不留").not.toContain("session_meta");
      const bodyLines = content.trimEnd().split("\n");
      expect(bodyLines).toHaveLength(1);
      expect((JSON.parse(bodyLines[0]!) as { content: string }).content).toBe("第 1 条");
      // 关键：会话**打得开**。修之前这里抛「有 1 条非尾部坏行（首在第 1 行）」。
      const events = await replay(path);
      expect(events.map((e) => (e as { content: string }).content)).toEqual(["第 1 条"]);
    } finally {
      warn.mockRestore();
    }
  });

  it("反向验证：把退出条件改回旧的 `scanned < CAP` 写法 ⇒ 上一条必须红（尺不是空转的）", async () => {
    // 专破上一条的坏输入：旧写法在"全文无换行"时 cut 保持 null ⇒ 走补换行分支 ⇒
    // 文件变成"坏行 + 好行"两行 ⇒ replay 抛。这里不 import 私有函数，直接用**同形状的
    // 现造文件**钉住那个后果：补了换行的两行文件必须被 replay 拒绝。
    const twoLines = '{"type":"session_meta","kind":"si\n' + line(1) + "\n";
    writeFileSync(path, twoLines, "utf8");
    await expect(replay(path), "补换行留下的『坏行+好行』必须被重放拒绝——这正是旧代码的后果").rejects.toThrow(/坏行/u);
    // 而修好之后（裁到 0）同一个现场是打得开的：两侧对照，证明尺量的是那条分界。
    writeFileSync(path, line(1) + "\n", "utf8");
    await expect(replay(path)).resolves.toHaveLength(1);
  });

  it("空文件 / 新建文件：无告警、正常写入", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const log = createEventLog(path);
      await log.append(EV(1));
      expect(warn.mock.calls.map((c) => String(c[0])).join("\n")).not.toContain("半写尾行");
      expect((await replay(path)).length).toBe(1);
    } finally {
      warn.mockRestore();
    }
  });
});
