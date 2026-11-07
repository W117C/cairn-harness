// README 的静态工具数量与名单不许自己漂：事实源是运行期 `TOOLS` / `TOOL_NAMES`。
// 与 invoke 通道数那格同族：README 自称「现读」而没有任何判卷连接，就等于允许长期撒谎。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TOOLS } from "../src/tools";
import { TOOL_NAMES } from "../src/tools/base";

const README = fileURLToPath(new URL("../README.md", import.meta.url));
const text = () => readFileSync(README, "utf8");

describe("README 的工具面与运行期注册表钉在一起", () => {
  it("静态注册表的数量从运行期对象现读，且只写一次", () => {
    const stated = [...text().matchAll(/静态注册表\s*(\d+)\s*个/g)].map((m) => Number(m[1]));
    expect(stated, "README 有第二份静态工具数＝第二个会漂的事实源").toHaveLength(1);
    expect(stated[0]).toBe(Object.keys(TOOLS).length);
    // 反向证人：抽数的形状真在文本里；把它改坏就会读成 0 个，而不是悄悄通过。
    expect(/静态注册表\s*\d+\s*个/.test("静态注册表 15 个")).toBe(true);
  });

  it("工具名事实源含系统门 verify；README 点名它并且不把它算进静态注册表", () => {
    expect(TOOL_NAMES).toContain("verify");
    expect(Object.keys(TOOLS)).not.toContain("verify");
    expect(text()).toContain("`verify` — 系统验证门");
  });

  it("README 的工具段列出全部静态注册表实例", () => {
    const body = text();
    for (const name of Object.keys(TOOLS)) expect(body, `README 漏了 ${name}`).toContain(`\`${name}\``);
  });
});
