/** 提示词 ↔ 工具面 可达性这把尺的判卷面（第 174 页，任务 #13）。
 *  动因：`BASE_SYSTEM` 是一份文本对四档，而 read-only 面只有 8 把工具——「改文件用 edit_file」这类句子
 *  对它是不可达承诺；同类事故（glob 逃生口 / maxFiles 死参数 / prune 附件 / verify 指向禁写面）已命中四次。
 *  判卷吃的是 `src/agent/prompt-surface.ts` 那份**共用谓词**，不在测试里再算一遍（规则 205/236）。 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  promptSurfaceFindings,
  toolNameTokens,
  unhitExemptions,
  type PromptSurfaceFinding,
} from "../src/agent/prompt-surface";
import { GATES } from "../scripts/gate-manifest";
import {
  PROMPT_SURFACE_EXEMPT,
  proseFaces,
  tablesByMode,
} from "../scripts/prompt-surface-check";
import { TOOL_NAMES } from "../src/tools/base";

const TABLES = { auto: ["edit_file", "verify", "clarify"], read: ["verify", "clarify"] } as const;
const face = (text: string) => [{ name: "t", text }];

describe("toolNameTokens：两路都要（形状 + 名单）", () => {
  it("蛇形按形状认，单词名按名单认——只留一路就会漏掉一半", () => {
    const toks = toolNameTokens("先 verify，再用 edit_file 打补丁，no_such_thing 也算", ["verify", "clarify"]);
    expect(toks).toContain("verify");
    expect(toks).toContain("edit_file");
    expect(toks).toContain("no_such_thing");
    expect(toks, "不该把普通英文词当工具名").not.toContain("先");
  });

  it("名字必须是整词：`verified_file` 不算 `verify` 被提到", () => {
    expect(toolNameTokens("这条 verified_file 只是文件名", ["verify"])).not.toContain("verify");
  });
});

describe("promptSurfaceFindings：两类发现分开", () => {
  it("面上完全没有 ⇒ dead，且点名所有档", () => {
    const f = promptSurfaceFindings(face("用 ghost_tool 收队"), TABLES, [], []);
    expect(f).toHaveLength(1);
    expect(f[0]?.kind).toBe("dead");
    expect(f[0]?.modes.sort()).toEqual(["auto", "read"]);
  });

  it("某些档缺席 ⇒ odd，且只报缺席的那一档（不牵连都在的那一档）", () => {
    const f = promptSurfaceFindings(face("改文件用 edit_file"), TABLES, [], []);
    expect(f).toHaveLength(1);
    expect(f[0]?.kind).toBe("odd");
    expect(f[0]?.modes).toEqual(["read"]);
  });

  it("负控：名字在每一档都在 ⇒ 一条都不许报", () => {
    expect(promptSurfaceFindings(face("先 verify 再收尾"), TABLES, [], [])).toHaveLength(0);
  });

  it("豁免要真能消掉那一条，其他档不许跟着被消", () => {
    const exempt = [{ token: "edit_file", mode: "read", why: "test" }];
    expect(promptSurfaceFindings(face("改文件用 edit_file"), TABLES, [], exempt)).toHaveLength(0);
    const three = { ...TABLES, third: ["verify"] } as Record<string, readonly string[]>;
    const still = promptSurfaceFindings(face("改文件用 edit_file"), three, [], exempt);
    expect(still.map((x: PromptSurfaceFinding) => x.modes.join())).toContain("third");
  });

  it("取料坏了要抛，不许印 0：一档都没有、或所有档都是空面", () => {
    expect(() => promptSurfaceFindings(face("x"), {}, [], [])).toThrow(/都没取到/u);
    expect(() => promptSurfaceFindings(face("x"), { auto: [], read: [] }, [], [])).toThrow(/空的/u);
  });

  it("过期豁免只报「已不命中」的那几条，命中的不许被误报", () => {
    const raw = promptSurfaceFindings(face("改文件用 edit_file"), TABLES, [], []);
    const exempt = [
      { token: "edit_file", mode: "read", why: "真挡着" },
      { token: "ghost_tool", mode: "auto", why: "已经不命中了" },
    ];
    expect(unhitExemptions(exempt, raw).map((e) => e.token)).toEqual(["ghost_tool"]);
  });
});

describe("现读：真面、真文本、真注册", () => {
  it("真取料：四档面非空，文本里认得出工具名（0 个＝尺瞎了，不是没问题）", () => {
    const tables = tablesByMode();
    expect(Object.keys(tables).sort()).toEqual(["auto", "default", "guided", "read-only"]);
    for (const m of Object.keys(tables)) expect((tables[m] ?? []).length, `${m} 档工具面为空`).toBeGreaterThan(0);
    const tokens = [...new Set(proseFaces().flatMap((f) => toolNameTokens(f.text, TOOL_NAMES)))];
    expect(tokens.length, "BASE_SYSTEM 里一个工具名都没认出来 ⇒ 多半是面/名单没读到").toBeGreaterThan(0);
    expect(tokens).toContain("edit_file");
  });

  it("存量水位：豁免表只准调低（09-28 现读 3 条），且每条本次都要真命中", () => {
    expect(PROMPT_SURFACE_EXEMPT.length).toBeLessThanOrEqual(3);
    const tables = tablesByMode();
    const raw = promptSurfaceFindings(proseFaces(), tables, TOOL_NAMES, []);
    expect(unhitExemptions(PROMPT_SURFACE_EXEMPT, raw), "有不命中的豁免留在表里＝会放过同名的新问题").toHaveLength(0);
    expect(promptSurfaceFindings(proseFaces(), tables, TOOL_NAMES, PROMPT_SURFACE_EXEMPT), "新出现的不可达承诺要红着说").toHaveLength(0);
  });

  it("接线：这道门真的进了默认门表，也真的有 script（防孤儿、防只写脚本不登记）", () => {
    expect(GATES).toContain("prompt-surface-check");
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")) as
      { scripts?: Record<string, string> };
    expect(pkg.scripts?.["prompt-surface-check"] ?? "").toContain("scripts/prompt-surface-check.ts");
  });
});
