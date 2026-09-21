// 事件类型清单的三面一致性闸。
//
// 起因（2026-09-21，同一条通道上连着撞三次）：新加一个 AgentEvent 类型时，
// **只有穷尽 switch 会自己开口**（sidechat 的 renderProjectionLine 当场编译失败），
// 另外三面都是"按类型白名单取料"的静默面，缺一个成员不报错、不红、只是少做一件事：
//   - worker-projection.withAgentId 不收 ⇒ 子流事件以父会话事件的形态落进主转录；
//   - renderer 的 EVENT_LABELS 不收 ⇒ 卡片标题退回原始英文类型名（界面在说谎）；
//   - compaction.serializeConversation 不收 ⇒ 压缩把这条读数连同旧事件一起忘掉。
// 这张闸只管三份**清单**互相对齐：注册表 ↔ 联合 ↔ 界面接料面。
// 第一、第三面没有通用判定，别在注释里假装有门：withAgentId 有 worker-attribution.test.ts +
// 每类型一根锚点，compaction 至今靠人记——要泛化成「新类型必须进白名单」，得先答上
// 「worker 到底会发哪些类型」，而那个集合目前没人写过（写错即造假豁免）。
//
// 口径故意做得很小：能判的是「卡片型事件必须有地方接住它」，
// 而不是「每个投影面都要认得每个类型」（多数类型本就不该进摘要，逼出来的只是一堆假豁免）。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { projectUnits } from "../src/renderer/history-window.js";

const ROOT = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const EVENTS = "src/events/index.ts";
const APP = "src/renderer/app.js";

/** 事件类型注册表（append 时拒未知类型的那一份）。 */
function knownTypes(): string[] {
  const src = read(EVENTS);
  const start = src.indexOf("const KNOWN_TYPES = new Set([");
  if (start < 0) throw new Error(`${EVENTS} 里找不到 KNOWN_TYPES —— 改名了要同步这张闸`);
  const body = src.slice(start, src.indexOf("]);", start));
  return [...body.matchAll(/^\s*"([a-z_]+)",$/gm)].map((m) => m[1]);
}

/** 联合类型里的成员名 → 各自声明的 `type` 字面量。 */
function unionTypes(): string[] {
  const src = read(EVENTS);
  const start = src.indexOf("export type AgentEvent =");
  if (start < 0) throw new Error(`${EVENTS} 里找不到 AgentEvent 联合`);
  const body = src.slice(start, src.indexOf(";", src.indexOf("RunErrorEvent", start)));
  const names = [...body.matchAll(/\|\s*([A-Za-z]+Event)\b/g)].map((m) => m[1]);
  const out: string[] = [];
  const unresolved: string[] = [];
  for (const n of names) {
    const i = src.indexOf(`export interface ${n} `);
    const lit = i < 0 ? null : src.slice(i, i + 1200).match(/\btype:\s*"([a-z_]+)"/)?.[1] ?? null;
    if (lit === null) unresolved.push(n);
    else out.push(lit);
  }
  if (unresolved.length > 0) {
    throw new Error(`AgentEvent 成员解析不出 type 字面量（拒绝当成"没有这个类型"）：${unresolved.join(", ")}`);
  }
  return out;
}

/** 渲染层：卡片标题表 + 卡片 switch 里已经单独接住的类型。 */
function rendererSurface() {
  const app = read(APP);
  const li = app.indexOf("const EVENT_LABELS = {");
  if (li < 0) throw new Error(`${APP} 里找不到 EVENT_LABELS —— 改名了要同步这张闸`);
  const labelBlock = app.slice(li, app.indexOf("};", li));
  const labeled = new Set([...labelBlock.matchAll(/([a-z_]+):\s*["']/g)].map((m) => m[1]));

  const si = app.indexOf("switch (e.type) {");
  if (si < 0) throw new Error(`${APP} 里找不到卡片渲染的 switch (e.type)`);
  const cased = new Set(
    [...app.slice(si, app.indexOf("\n  }", si)).matchAll(/case\s+["']([a-z_]+)["']\s*:/g)].map((m) => m[1]),
  );
  return { labeled, cased };
}

/** 哪些类型会被分组器当成独立卡片（按 projectUnits 的行为判，不按文本猜）。 */
function cardTypes(known: string[]): Set<string> {
  const out = new Set<string>();
  for (const t of known) {
    // 只喂 {type}：projectUnits 分组只看 type 与 agent_id，不需要合法 payload。
    if (projectUnits([{ type: t } as never]).some((u) => u.kind === "card")) out.add(t);
  }
  return out;
}

describe("事件类型清单三面一致", () => {
  const known = knownTypes();
  const cards = cardTypes(known);
  const { labeled, cased } = rendererSurface();

  it("注册表与联合类型同集合（多一个少一个都算漂移）", () => {
    const u = unionTypes();
    expect(u.length).toBeGreaterThan(20); // 解析塌成空集时，下面两条差集会同时假绿
    expect(u.filter((t) => !known.includes(t))).toEqual([]);
    expect(known.filter((t) => !u.includes(t))).toEqual([]);
  });

  it("每个卡片型事件都有地方接住它：EVENT_LABELS 或卡片 switch 的单独 case", () => {
    // 这条就是今天 turn_truncated 撞的那件事：加了类型、落了盘、上了上下文，
    // 但界面上它以英文类型名出现——没有任何门看着这件事。
    const bare = [...cards].filter((t) => !labeled.has(t) && !cased.has(t));
    expect(bare, "这些类型会渲染成卡片，却没有标签也没有单独 case ⇒ 标题退回英文类型名").toEqual([]);
  });

  it("EVENT_LABELS 里没有死条目（不为非卡片类型留标签）", () => {
    const dead = [...labeled].filter((t) => !cards.has(t));
    expect(dead, "标签表里的类型不会被分成卡片 ⇒ 这一条永远不会被读到，删掉或说明").toEqual([]);
  });

  it("卡片集是注册表的真子集，且分组器不会把任何已知类型吞掉", () => {
    expect([...cards].every((t) => known.includes(t))).toBe(true);
    // 吞掉 = projectUnits 一条单元都不给（只有 usage/session_meta 允许，它们显式 return）
    const dropped = known.filter((t) => projectUnits([{ type: t } as never]).length === 0);
    expect(dropped).toEqual(["usage", "session_meta"]);
  });
});
