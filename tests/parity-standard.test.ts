// 「行业最高」的可判标准（本仓自定，业主可改阈值/口径）。
//
// 为什么要这一支：形容词没法判。这里把「比对表」变成**机器可读 + 有证人**的清单：
//  ① 每条能力有状态（covered / partial / absent / out）；
//  ② 覆盖分 = (covered + 0.5×partial) / 范围内条目数，必须 ≥ 清单里的阈值（现 0.8）；
//  ③ 每条 covered/partial 的 evidence 必须**真实存在**，且被某个测试/冒烟文件点名——
//     「说自己有」不算证据，得有一份能跑的证人；
//  ④ absent 条目必须列出来（不许悄悄消失）；out 条目必须写清范围外理由。
//
// 这条判据不评价「做得好不好」，它只保证：清单里每一条「有」都对得上一份可跑的证人。
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type Status = "covered" | "partial" | "absent" | "out";
interface Item {
  id: string;
  capability: string;
  reference: string;
  ours: string;
  status: Status;
  evidence: string[];
  outOfScopeReason?: string;
}
interface Checklist { version: number; threshold: number; items: Item[] }

const root = fileURLToPath(new URL("..", import.meta.url));
const checklist = JSON.parse(readFileSync(`${root}fixtures/parity/checklist.json`, "utf8")) as Checklist;

describe("对表标准可判", () => {
  it("条目 id 唯一、状态取值合法、out 必须写理由", () => {
    const ids = checklist.items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of checklist.items) {
      expect(["covered", "partial", "absent", "out"]).toContain(item.status);
      if (item.status === "out") expect((item.outOfScopeReason ?? "").length).toBeGreaterThan(8);
      if (item.status !== "out") expect(item.outOfScopeReason).toBeUndefined();
    }
  });

  it("每条 covered/partial 的证人文件真实存在", () => {
    for (const item of checklist.items) {
      if (item.status !== "covered" && item.status !== "partial") continue;
      expect(item.evidence.length, `${item.id} 没有证人`).toBeGreaterThan(0);
      for (const path of item.evidence) {
        expect(existsSync(`${root}${path}`), `${item.id} 点名的证人不存在：${path}`).toBe(true);
      }
    }
  });

  it("覆盖分 ≥ 阈值（absent 只许出现在已知且列明的格子上）", () => {
    const inScope = checklist.items.filter((i) => i.status !== "out");
    const score = inScope.reduce((sum, i) => sum + (i.status === "covered" ? 1 : i.status === "partial" ? 0.5 : 0), 0);
    const ratio = score / inScope.length;
    expect(ratio, `覆盖分 ${ratio.toFixed(3)} 低于阈值 ${String(checklist.threshold)}`).toBeGreaterThanOrEqual(checklist.threshold);
    // 棘轮（与仓里其他水位同一条纪律）：现读高出阈值一截 ⇒ 阈值必须跟着上调。
    // 留着「阈值追不上现读」会让这条尺慢慢变成摆设；这条红会逼着下一批把数写实。
    expect(ratio - checklist.threshold, `现读 ${ratio.toFixed(3)} 已明显高于阈值 ${String(checklist.threshold)}：按棘轮上调`).toBeLessThanOrEqual(0.05);
    // absent 的条目必须是**明确列出来的能力面**（这条防「悄悄把没做的删掉」：
    // 删掉会让 inScope 变小、覆盖分变高——但那不是做完了，是尺变短了）。
    expect(new Set(checklist.items.filter((i) => i.status === "absent").map((i) => i.id))).toEqual(
      new Set(["bot.member-dispatch-ui", "bot.group-chat", "bot.secrets-cards"]),
    );
  });
});
