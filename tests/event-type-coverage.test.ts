// 事件三面清单闸·前两面（2026-10-05 第 374 页，恢复评审 A10）。
//
// **为什么这一支曾消失**：删桌面层那一笔把三面清单闸一并删掉了，重入时只恢复了两面用的
// 取料口（`tests/event-registry.ts` 的 `knownTypes()`），`unionTypes()` 留了下来却**全仓零
// 消费者**——于是「往 `AgentEvent` 联合加一个新事件类型、忘了登记 `KNOWN_TYPES`」这件事
// 没有任何判据会红。本页把那张闸补回来。
//
// **现在还剩几层防线**（如实分层，不夸大）：
//   1. `KNOWN_TYPES` 的类型已从 `new Set([...])` 改成 `Record<AgentEvent["type"], true>`
//      ⇒ 漏登记现在是**编译期错误**，不需要任何判据（这一层是 2026-10-03 落的）。
//   2. 本页判的是**运行时那张表与联合成员逐项对齐**——防的是有人把 `Record<>` 改回 `Set<>`、
//      或改判据取料的那张表（防「尺坏了」而不是「码错了」）。
//   3. 第三面（渲染面 / `apps/desktop` 的投影）**本页不判**：按 ADR 0001 的范围裁决，
//      桌面层不是 v1 交付面、且不在任何根门的编译面与判卷面，在这里判它只会给一道
//      永远不跑的红。这一面是**已知缺口**，记在这里而不是假装已覆盖。
import { it, expect, describe } from "vitest";
import { knownTypes, unionTypes } from "./event-registry";

describe("事件三面清单·前两面：联合成员 ↔ KNOWN_TYPES 注册表", () => {
  it("两侧都取得到料且非空（防空转：一张尺量到 0 条也可能报全过）", () => {
    expect(knownTypes().length).toBeGreaterThan(10);
    expect(unionTypes().length).toBeGreaterThan(10);
  });

  it("联合成员与注册表逐项相等（漏登记、漏改联合、拼写漂移都会红）", () => {
    const u = [...unionTypes()].sort();
    const k = [...knownTypes()].sort();
    const onlyUnion = u.filter((t) => !k.includes(t));
    const onlyRegistry = k.filter((t) => !u.includes(t));
    expect(
      { onlyUnion, onlyRegistry },
      "联合里有而注册表没有：" + onlyUnion.join("、") + "｜注册表里有而联合里没有：" + onlyRegistry.join("、"),
    ).toEqual({ onlyUnion: [], onlyRegistry: [] });
  });

  it("注册表无重复项（重复登记会掩盖「漏了一个」这件事）", () => {
    const k = knownTypes();
    expect(k.length).toBe(new Set(k).size);
  });

  it("取料口 fail-loud：KNOWN_TYPES 换写法时当场抛，不许静默返回空数组", () => {
    // 这条钉的是「尺坏了要出声」：knownTypes() 的实现里找不到声明 / 不是对象字面量都抛。
    // 判卷面无法改盘上源码，所以这里判的是**这两只函数在真仓上不会静默退化**——
    // 若有人把 `Record<>` 改回 `new Set(`，knownTypes() 会抛，本页的调用点即刻变红而不是假绿。
    expect(() => knownTypes()).not.toThrow();
    expect(() => unionTypes()).not.toThrow();
  });
});

describe("第三面（渲染面）：已知缺口，不假装已覆盖", () => {
  it("投影面在 apps/desktop 下，而桌面层不在任何根门的判卷面（ADR 0001 范围裁决）", async () => {
    // 本用例是**缺口登记**，不是行为断言：它把「三面里第三面没人判」这件事写成会红的形状，
    // 万一哪天桌面层重新进入 v1 交付面、却仍没人补这张闸，改这一条就会提醒。
    // 现在它绿，是因为桌面投影文件确实存在（缺口是"没判"，不是"没有"）。
    const { existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    const proj = join(process.cwd(), "apps", "desktop", "src", "renderer", "projections.ts");
    expect(existsSync(proj), "桌面投影面已不在该路径 ⇒ 第三面缺口登记需要重写").toBe(true);
  });
});