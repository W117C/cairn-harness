// edit_file 的 0 匹配提示（能力 2/5/9 的交叉点）：把「读错误 → 重读整文件 → 再改」压成一轮。
// 纪律：只定位不替换，且宁缺毋滥——找不到足够像的行就一个字都不加。
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { edit_file } from "../src/tools/edit_file";
import type { ToolContext } from "../src/tools/base";

let dir: string;
const SRC = [
  "// shipping 规则：满 freeOver 免运费，否则向上取整整公斤计价",
  "export function shippingCost(weightKg, freeOver, perKg) {",
  "  if (weightKg >= freeOver) return 0;",
  "  return Math.floor(weightKg) * perKg;",
  "}",
  "",
].join("\n");
const ctx = (): ToolContext => ({ workspace: dir, emit: async () => {} });
const miss = async (oldString: string, path = "src/shipping.js"): Promise<string> => {
  try {
    await edit_file.run({ path, old_string: oldString, new_string: "x" }, ctx());
    return "";
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "edit-hint-"));
  await mkdir(join(dir, "src"), { recursive: true });
  await writeFile(join(dir, "src", "shipping.js"), SRC, "utf8");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true }).catch(() => {});
});

describe("edit_file 0 匹配的最像位置提示", () => {
  it("缩进抄丢了：直接点出那一行，并说明是缩进问题", async () => {
    // 单行少缩进不算 0 匹配（indexOf 子串就命中了），所以要测**多行 old_string 的后续行缩进不对**
    // ——这才是真实的「抄丢缩进」形态：整块匹配不上，但首行在文件里逐字存在。
    const msg = await miss("  return Math.floor(weightKg) * perKg;\n        }");
    expect(msg).toContain("0 处匹配");
    expect(msg).toContain("第 4 行");
    expect(msg).toContain("缩进");
  });

  it("变量名记错（靶场长 case 的真实形态）：给出行号 + 原文 + 相似度", async () => {
    const msg = await miss("  return Math.floor(weightKg) * rate;");
    expect(msg).toContain("第 4 行");
    expect(msg).toContain("return Math.floor(weightKg) * perKg;");
    expect(msg).toContain("80%");
  });

  it("内容毫不相像时不硬编提示（假定位比没定位更坏）", async () => {
    const msg = await miss("  const zzzQqq = wwwEee();");
    expect(msg).toContain("0 处匹配");
    expect(msg).not.toContain("提示");
  });

  // 上一条测的是「完全不重合」，但阈值真正的分辨面在 0 < 重合度 < 0.5 这一段：
  // 只重合四分一行的措辞也算「像」的话，提示会把模型指向完全无关的一行去改。
  it("只重合四分一不算像（阈值 0.5 是硬闸）：不给提示", async () => {
    // want = {const, computeTotal, weightKg, perKgExtra}；文件最好的行只重合 weightKg ⇒ 0.25
    const msg = await miss("  const computeTotal = weightKg * perKgExtra;");
    expect(msg).toContain("0 处匹配");
    expect(msg).not.toContain("提示");
  });

  // 上一轮的 420 上界用短行测不到截断分支（那行才 37 字符）：真实仓库里超长行很常见，
  // 不截就会把一整行 400 字符原文塞进报错——失败路径反而是最大的 token 泄漏面。
  it("命中超长行时只抄 120 字符（截断带省略号，整条报错仍有界）", async () => {
    const ident = "aVeryLongIdentifier".repeat(20);
    await writeFile(join(dir, "src", "long.js"), `// placeholder\n  const ${ident} = weightKg * perKg;\n`, "utf8");
    const msg = await miss(`  const ${ident} = weightKg / perKg;`, "src/long.js");
    expect(msg).toContain("最像");
    expect(msg).toContain("…");
    expect(msg.length).toBeLessThan(420);
  });

  it("提示有界：整条报错不超过 420 字符（失败路径也不能把上下文撑爆）", async () => {
    const msg = await miss("  return Math.floor(weightKg) * " + "aVeryLongVariableNameThatKeepsGoing".repeat(12) + ";");
    expect(msg.length).toBeLessThan(420);
  });

  it("报错必须发生在写盘之前：任何提示都不伴随文件改动", async () => {
    await miss("  return Math.floor(weightKg) * rate;");
    expect(await readFile(join(dir, "src", "shipping.js"), "utf8")).toBe(SRC);
  });

  it("成功路径逐字不变（不加提示、不改口径）", async () => {
    const r = await edit_file.run({
      path: "src/shipping.js",
      old_string: "  return Math.floor(weightKg) * perKg;",
      new_string: "  return Math.ceil(weightKg) * perKg;",
    }, ctx());
    expect(r.ok).toBe(true);
    expect(r.output).toContain("已替换");
    expect(r.output).not.toContain("提示");
  });
});
