// 判卷 · 产品入口那条剧本通道（`createMockProvider`）的**轮边界**语义。
//
// 存在的理由（两条，方向相反，所以必须同时钉住）：
//  ① 不写哨兵的剧本必须**逐字保持历史语义**：一次 stream() 吐完整条。e2e、gate-check、
//     memory-check、各 demo 通道全都吃这一条——靶场那套「按 tool_call 切轮」的纪律要是漏到
//     这里，就会把「一轮里 N 条 remember ⇒ 合并成一次审批」劈成 N 轮（实测：`tests/memory-runner.test.ts`
//     的 writes 从 3 掉到 1）。那才是本仓最忌的形状：改一处口径，同族另一支静默换语义。
//  ② 写了哨兵要真能多出一轮来。没有这条，收束闸的返修那一拍（红 → 再要一轮去修 → 重验）
//     在产品入口的可重放通道上**结构不可达**：第二拍的前提是「上一拍之后又改过盘」，
//     而只有一次请求的会话永远给不出这一位（同靶场为同一件事立口径的理由，见 gym/script.ts 头注）。
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { createMockProvider } from "../src/providers/mock";
import type { ModelOutput } from "../src/providers";

const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true }).catch(() => {});
});

const say = (content: string): object => ({ type: "assistant_message", content });
const call = (id: string, name = "read_file"): object => ({ type: "tool_call", id, name, args: { path: id } });
const end = (): object => ({ type: "round_end" });

async function providerFor(lines: object[]): Promise<ReturnType<typeof createMockProvider>> {
  const dir = await mkdtemp(join(tmpdir(), "mock-rounds-"));
  dirs.push(dir);
  const path = join(dir, "s.jsonl");
  await writeFile(path, lines.map((o) => JSON.stringify(o)).join("\n") + "\n", "utf8");
  return createMockProvider(path);
}

/** 连拉 `pulls` 次 stream()：返回每次给几条，并把吐出来的东西全收住。 */
async function drain(provider: ReturnType<typeof createMockProvider>, pulls: number): Promise<{ perCall: number[]; all: ModelOutput[] }> {
  const perCall: number[] = [];
  const all: ModelOutput[] = [];
  for (let i = 0; i < pulls; i++) {
    const got: ModelOutput[] = [];
    for await (const o of provider.stream([] as never)) got.push(o);
    perCall.push(got.length);
    all.push(...got);
  }
  return { perCall, all };
}

describe("剧本轮边界：没写哨兵 = 一次请求吐完整条（历史语义，一字不改）", () => {
  it("一条哨兵都没有 ⇒ 第一次 stream() 就给完 7 条，之后恒空", async () => {
    const provider = await providerFor([say("先看"), call("c1"), say("改它"), call("c2"), say("再改"), call("c3"), say("收工")]);
    const { perCall, all } = await drain(provider, 3);
    expect(perCall, "无哨兵剧本被切开了 ⇒ 同族口径漏进产品入口，一轮里的多个 tool_call 会被劈成多轮").toEqual([7, 0, 0]);
    expect(all.map((o) => o.type)).toEqual([
      "assistant_message", "tool_call", "assistant_message", "tool_call", "assistant_message", "tool_call", "assistant_message",
    ]);
  });

  it("一轮里好几个 tool_call 的剧本照旧同轮吐完（会话沉淀的合并审批就靠这一条）", async () => {
    const provider = await providerFor([call("d1", "remember"), call("d2", "remember"), call("d3", "remember"), say("已沉淀 3 条")]);
    const { perCall } = await drain(provider, 2);
    expect(perCall).toEqual([4, 0]);
  });
});

describe("剧本轮边界：写了哨兵才切轮，且哨兵绝不吐给 loop", () => {
  it("哨兵把中间那个「没调工具的一轮」表达出来", async () => {
    const provider = await providerFor([call("c1"), say("我改完了"), end(), say("还在红，再改一处"), call("c2")]);
    const { perCall, all } = await drain(provider, 3);
    expect(perCall, "哨兵没收住这一轮 ⇒ 产品入口仍然只有一次请求，返修那一拍结构不可达").toEqual([2, 2, 0]);
    expect(all.some((o) => (o as { type: string }).type === "round_end"), "哨兵漏进了模型输出（落进 JSONL 就是一条假事件）").toBe(false);
    expect(all.map((o) => o.type)).toEqual(["tool_call", "assistant_message", "assistant_message", "tool_call"]);
  });

  it("末条哨兵之后的空轮：stream 产出为空，loop 据此收束", async () => {
    const provider = await providerFor([say("收工"), end()]);
    const { perCall } = await drain(provider, 3);
    expect(perCall).toEqual([1, 0, 0]);
  });
});
