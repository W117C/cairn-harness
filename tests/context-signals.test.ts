// 「问题 → 位置」那两只正则的唯一出处（`src/agent/context-signals.ts`）。
//
// 立案动因：尺（`scripts/probe-locate-recall.ts`）从前逐字镜像生产端 `glm-session.ts` 的两只正则，
// 页上写着「改了那两行而不改这里，A 臂就撒谎」——那是靠注释守的不变量（本仓第三形态：判据在场、接线没有）。
// 本簇把两端接到同一支源串上，于是"撒谎"这一格结构上不存在了。
//
// 判卷两半各管一头：
// · 行为半：源串**语义不许漂**（用与旧字面量对拍的方式钉住长度档与扩展名档）；
// · 接线半：生产端与尺都必须从这里取（text pin 只在这一格用，因为它问的是"谁import了谁"）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MENTIONED_SOURCE, PATHISH_SOURCE, makeMentionedRe, makePathishRe } from "../src/agent/context-signals.js";

const tokens = (re: RegExp, text: string): string[] => text.match(re) ?? [];

describe("抽取语义不许漂（与历史字面量对拍）", () => {
  it("标识符：最短 4 个字符（1 + 3），三个字符的不算；下划线开头算", () => {
    const re = makeMentionedRe();
    expect([...new Set(tokens(re, "abc abcd _abc8 x1_y2"))].sort()).toEqual(["_abc8", "abcd", "x1_y2"]);
    expect(re.source).toBe(MENTIONED_SOURCE);
  });

  it("路径形状：扩展名最长 5 个字母 ⇒ 六字母后缀只吃到第五个（这一档能区分 {1,5} 与 {1,6}）", () => {
    const re = makePathishRe();
    expect(tokens(re, "see notes.yamlxy")).toEqual(["notes.yamlx"]);
    expect(tokens(re, "改 src/agent/map/build.ts 和 docs/a.md")).toEqual(["src/agent/map/build.ts", "docs/a.md"]);
  });

  it("两只 builder 出的都是全局正则（掉了 /g 时 .match 只回第一个，而「两次结果相同」那条抓不到）", () => {
    expect(makePathishRe().global, "非全局时只取到第一个 token，注入面会静默少一半输入").toBe(true);
    expect(makeMentionedRe().global).toBe(true);
  });

  it("同一实例连用两次结果相同（模块级实例之所以安全，前提就在这条）", () => {
    const re = makePathishRe();
    const text = "a.ts b.ts c.ts";
    expect(tokens(re, text)).toEqual(["a.ts", "b.ts", "c.ts"]);
    expect(tokens(re, text), "lastIndex 若被留在中间，第二次就会少一个").toEqual(["a.ts", "b.ts", "c.ts"]);
  });

  it("每次新建实例：builder 不返回同一个对象（共享可变 lastIndex 是下一颗雷）", () => {
    expect(makePathishRe() === makePathishRe()).toBe(false);
    expect(makeMentionedRe() === makeMentionedRe()).toBe(false);
  });
});

describe("两端确实共用这一支（镜像那一格不能回来）", () => {
  const sessionSrc = readFileSync(fileURLToPath(new URL("../src/agent/glm-session.ts", import.meta.url)), "utf8");
  const probeSrc = readFileSync(fileURLToPath(new URL("../scripts/probe-locate-recall.ts", import.meta.url)), "utf8");

  it("provider 那半：从 context-signals 取，且源串里不再留路径字面量（镜像回来就红）", () => {
    expect(sessionSrc).toContain('import { makeMentionedRe, makePathishRe } from "./context-signals";');
    expect(sessionSrc).toContain("e.content.match(makePathishRe())");
    expect(sessionSrc).toContain("lastUserContent(events).match(makeMentionedRe())");
    expect(sessionSrc, "provider 里又出现路径形状字面量 ⇒ 镜像复活，两端会各自漂").not.toContain("/[\\w./-]+\\.[a-z]{1,5}/g");
  });

  it("尺那半：从 context-signals 取，且不再自带标识符字面量", () => {
    expect(probeSrc).toContain('import { makeMentionedRe, makePathishRe } from "../src/agent/context-signals";');
    expect(probeSrc).toContain("const MENTIONED_RE = makeMentionedRe();");
    expect(probeSrc).toContain("const PATHISH_RE = makePathishRe();");
    expect(probeSrc, "尺里又出现标识符字面量 ⇒ A 臂的输入不再是生产端算出来的").not.toContain("/[A-Za-z_][A-Za-z0-9_]{3,}/g");
  });
});
