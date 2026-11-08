// 判卷：README 里那个「invoke 通道数」不许自己漂。
//
// 缺陷形状（PROGRESS 第 642 页 §5 登记的 P2）：README 自称「现读」却停在 50，而表长判据
// （apps/desktop/tests/channels.test.ts）钉的是另一个数。README 当时**没有任何东西**把这个数
// 和那张表连起来 ⇒ 「改表不改数当场红」是一句空话（改了表，README 不会红，只是继续撒谎）。
//
// 判卷断言的是**运行期事实**：数字从**判卷同一来源**现读——
// apps/desktop/tests/channels.test.ts 判的是 `Object.keys(INVOKE_CHANNELS).length`，
// 这里判的是同一个对象（同一个模块、同一份表），不是从源码里 grep 一个字面量，也不是抄
// 判卷文件里的期望值。所以：
//   ① README 写的数 == 运行时现读的表长（漂了就红）；
//   ② README 那个数旁边**必须**指着来源表与判据（不许退化成一句没来由的手抄数）；
//   ③ README 里只许有**一个** invoke 通道数（不许另抄第二份当影子事实）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { INVOKE_CHANNELS } from "../apps/desktop/src/main/channels";

const README = fileURLToPath(new URL("../README.md", import.meta.url));

describe("README 的 invoke 通道数与通道表钉在一起", () => {
  it("README 写的数 == 运行时现读的表长（判卷同一来源）", () => {
    // 现读：判卷用的就是这个对象（apps/desktop/tests/channels.test.ts 也 import 它）。
    const derived = Object.keys(INVOKE_CHANNELS).length;
    const text = readFileSync(README, "utf8");
    const stated = [...text.matchAll(/(\d+)\s*个\s*invoke\s*通道/g)].map((m) => Number(m[1]));
    // ③ 只许有一个 invoke 通道数：第二份就是影子事实，早晚漂。
    expect(stated).toHaveLength(1);
    // ① README 的数不许与表漂。
    expect(stated[0]).toBe(derived);
  });

  it("README 那个数指着来源表与判据（不许退化成手抄的孤立数字）", () => {
    const text = readFileSync(README, "utf8");
    // ② 来源表：那张表才是事实源；判据：桌面判卷的表长断言。
    expect(text).toContain("apps/desktop/src/main/channels.ts");
    expect(text).toContain("apps/desktop/tests/channels.test.ts");
    // 「现读」这两个字在原句里就是在承诺这件事——承诺不许悄悄改成别的口径。
    expect(text).toContain("现读");
  });
});
