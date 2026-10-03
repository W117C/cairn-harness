/** 第 334 页 · 任务 #41 的第一半：认证那一趟的「温度」要落进工件，而不是靠人记。
 *  动因（本会话实测三次）：为了在页上引用墙钟/门耗时，我从 `/tmp/dsh-head-cert-<rev>/` 手工抄了
 *  三次 test.log／summary.txt 进 dated 工件目录；其中一次没抄，`docs-check` D-9 当场红
 *  （「读数在它点名的取料面里找不到原文」）。⇒ 引用得最多的那一格（时间量可不可信）恰恰最依赖记性。
 *  判据形状：三态分开、表→投影各钉一次、正文原样交回、接线钉在 `process.exit` 之前。 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { citableLine, citableOf, provenanceDoc, provenancePath, provenanceStamp } from "../scripts/lib/head-cert-provenance";

describe("认证读数的可引用性（#41）", () => {
  it("三态各自出声：两端独占／有别人在跑／取不到（不可知不许由 0 顶成独占）", () => {
    expect(citableOf(0, 0, true)).toBe("citable");
    expect(citableOf(1, 0, true), "起前有别人 ⇒ 那 90 秒里的秒数不干净").toBe("loaded");
    expect(citableOf(0, 2, true), "跑完有别人也算负载").toBe("loaded");
    expect(citableOf(-1, -1, false), "`--skip-test`：并发面根本没采 ⇒ unknown，不是 0").toBe("unknown");
    expect(citableOf(0, 0, false), "判卷没跑 ⇒ 「没有并发」这个读数本身不存在").toBe("unknown");
    expect(citableOf(0, -1, true), "只采到一端 ⇒ 不可知，不许拿那半个 0 说事").toBe("unknown");
  });

  it("温度行的极性与 citableOf 一一对应（loaded／unknown 绝不能被读成「可以引用」）", () => {
    const c = citableLine("citable");
    expect(c).toContain("可以引用");
    expect(c).not.toContain("不可引用");
    expect(citableLine("loaded")).toContain("不可引用");
    const u = citableLine("unknown");
    expect(u).toContain("不可知");
    expect(u, "把「取不到」写成 0 ⇒ 这正是本尺要防的那一侧").toContain("不引用");
  });

  it("正文是**原样交回**那些行：不吞行、不摘要、顺序不动；出处两格（rev 与收尾复核）都在头部", () => {
    const lines = ["第一行", "第二行 带 空格 与 |竖线| 与 全角：", "第三行"];
    const doc = provenanceDoc({ rev: "abc1234def5678", citable: "citable", drift: null, stamp: "2026-10-03-1555", lines });
    expect(doc).toContain("rev abc1234");
    expect(doc, "头部没有温度行＝这份工件回答不了「时间量能不能引用」，那它就没存在的理由").toContain("温度＝两端独占");
    expect(doc).toContain("收尾复核=同一笔");
    for (const l of lines) expect(doc.includes(l), `少一行 ⇒ 页上引的读数与工件就不一致：${l}`).toBe(true);
    expect(doc.indexOf("第一行") < doc.indexOf("第三行"), "顺序被打乱就不是「原样」").toBe(true);
    const bad = provenanceDoc({ rev: "x", citable: "unknown", drift: "读数作废：树被切走", stamp: "s", lines: [] });
    expect(bad).toContain("收尾复核=读数作废：树被切走");
    expect(bad, "一行读数都没有也要能落盘（空正文≠没写文件）").toContain("认证打出来的读数");
  });

  it("落盘路径带 rev 与分钟级时间戳（同一笔复跑两次不许互相盖掉——负载那趟与独占那趟的差就是要留的东西）", () => {
    const a = provenancePath("/repo", "abcdef1234567890", "2026-10-03-15-53");
    const b = provenancePath("/repo", "abcdef1234567890", "2026-10-03-16-40");
    expect(a).toContain(join("head-cert-abcdef1-2026-10-03-15-53", "provenance.md"));
    expect(a).not.toBe(b);
  });

  it("时间戳：分钟精度、结果里不许有冒号（第一版把这段写在调用方，冒号漏进目录名，只有真跑一次才看得见）", () => {
    expect(provenanceStamp("2026-10-03T15:55:51.022Z")).toBe("2026-10-03-1555");
    expect(provenanceStamp("2026-10-03T00:00:00.000Z")).toBe("2026-10-03-0000");
    for (const bad of ["", "not-a-date", "2026-10-03"]) {
      expect(provenanceStamp(bad), `取不到形状时不许把原串塞进路径：${JSON.stringify(bad)}`).toBe("未知时刻");
    }
    const p = provenancePath("/repo", "abcdef1234567890", provenanceStamp("2026-10-03T15:55:51.022Z"));
    expect(p, "目录名里带冒号＝后面所有 grep/脚本都要引号兜着，且不同平台会翻车").not.toContain(":");
    expect(p).toContain("head-cert-abcdef1-2026-10-03-1555");
  });

  it("头部自带生成时刻与时区口径（那串数字从前只长在目录名里，打开文件也要读得到它是 UTC）", () => {
    const doc = provenanceDoc({ rev: "abcdef1234", citable: "citable", drift: null, stamp: "2026-10-03-1614", lines: [] });
    const line = doc.split("\n").find((l) => l.startsWith("- 生成时刻="));
    expect(line, "头部没有生成时刻 ⇒ 页上引的秒数与本地日期差一天时，没人能判断这是跨零点还是抄错了出处").toBeDefined();
    expect(line).toContain("2026-10-03-1614");
    expect(line, "只写时刻不写口径＝本地与 UTC 两种读法都成立（本笔冒烟实测：目录名是 UTC 16:14，台账页已是次日凌晨）").toContain("UTC");
  });

  it("★接线：认证真把这份文档写出去，而且写在 `process.exit` 之前；失败要出声", () => {
    const src = readFileSync(join(fileURLToPath(new URL("../", import.meta.url)), "scripts", "head-cert.ts"), "utf8");
    // 跨行正则（真实换行＋缩进）：锚点表会把针脚字面原样抄一份，只写「含这串」会恒真（规则 236/426）。
    expect(src).toMatch(/\n\s*const citable = citableOf\(psBefore, psAfter, testStatus !== null\);/u);
    expect(src).toMatch(/\n\s*const stamp = provenanceStamp\(new Date\(\)\.toISOString\(\)\);/u);
    expect(src).toMatch(/\n\s*const p = provenancePath\(MAIN, TARGET, stamp\);/u);
    expect(src).toMatch(/\n\s*writeFileSync\(p, provenanceDoc\(\{ rev: TARGET, citable, drift, stamp, lines: spoken \}\), "utf8"\);/u);
    const w = src.search(/\n\s*writeFileSync\(p, provenanceDoc\(/u);
    const e = src.search(/\nprocess\.exit\(code\);/u);
    expect(w, "取不到写入那一行＝位置比不了，别说「在 exit 之前」").toBeGreaterThan(-1);
    expect(e, "取不到退出那一行＝同上").toBeGreaterThan(-1);
    expect(e > w, "写在 exit 之后＝永远不会落盘").toBe(true);
    expect(src, "落盘失败被 catch 掉不出声 ⇒ 这一趟的温度悄悄没了，页上还照着引用").toMatch(/\n\s*say\(`⚠️ provenance 落盘失败/u);
  });
});
