/** 提示词 ↔ 工具面 可达性这把尺的判卷面（第 174 页，任务 #13）。
 *  动因：`BASE_SYSTEM` 是一份文本对四档，而 read-only 面只有 8 把工具——「改文件用 edit_file」这类句子
 *  对它是不可达承诺；同类事故（glob 逃生口 / maxFiles 死参数 / prune 附件 / verify 指向禁写面）已命中四次。
 *  判卷吃的是 `src/agent/prompt-surface.ts` 那份**共用谓词**，不在测试里再算一遍（规则 205/236）。 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  applyModeLineEdits,
  promptSurfaceFindings,
  toolNameTokens,
  unhitExemptions,
  type PromptSurfaceFinding,
} from "../src/agent/prompt-surface";
import { BASE_SYSTEM, systemPromptFor } from "../src/main/agent-runner";
import { GATES } from "../scripts/gate-manifest";
import {
  PROMPT_SURFACE_EXEMPT,
  allFaces,
  descriptionFaces,
  proseFaces,
  reminderFaces,
  tablesByMode,
} from "../scripts/prompt-surface-check";
import { EVIDENCE_TEXT } from "../src/agent/goal";
import { sessionToolSpecs } from "../src/agent/glm-session";
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

  it("存量水位：豁免表已清到 0（第 175 页拆完 per-mode 文本），要加长就得重新逐条带理由", () => {
    expect(PROMPT_SURFACE_EXEMPT, "这张表从第 175 页起是空的：新登记一根＝重新开一轮存量，须逐条写理由").toHaveLength(0);
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

describe("按档拆文本（第 175 页，任务 #16）", () => {
  const SRC = ["a1", "b1", "c1"].join("\n");

  it("applyModeLineEdits 只动指定的那几行，其余逐字沿用同一份源", () => {
    const r = applyModeLineEdits(SRC, { replacements: [{ prefix: "b", text: "B2" }], drops: ["c"] });
    expect(r.text).toBe("a1\nB2");
    expect(r.changed).toEqual({ dropped: 1, replaced: 1 });
  });

  it("落点 0 命中要抛：那一行的开头字变了 ⇒ 这一档的差异会静默消失", () => {
    expect(() => applyModeLineEdits(SRC, { replacements: [{ prefix: "b", text: "B2" }], drops: ["zzz"] })).toThrow(/落点没对上/u);
  });

  it("落点命中多行也要抛：前缀太松会把邻居一起换掉", () => {
    expect(() => applyModeLineEdits("a1\na2", { replacements: [{ prefix: "a", text: "X" }], drops: [] })).toThrow(/实换 2 行/u);
  });

  it("可写那三档拿到的还是同一份 BASE_SYSTEM（等价性由判卷钉），而 read-only 确实不同", () => {
    for (const m of ["default", "guided", "auto"] as const) expect(systemPromptFor(m), `${m} 档不该被改写`).toBe(BASE_SYSTEM);
    // 配对判据（规则 228）：只钉「三档相等」的话，「四档全等」这个退化也照样绿。
    expect(systemPromptFor("read-only")).not.toBe(BASE_SYSTEM);
    expect(systemPromptFor(undefined), "缺省（没给档）必须退回共用文本，不能抛").toBe(BASE_SYSTEM);
  });

  it("read-only 的文本不再点名它拿不到的那三把，而共用文本里它们还在（尺看得见）", () => {
    const ro = new Set(toolNameTokens(systemPromptFor("read-only"), TOOL_NAMES));
    for (const gone of ["edit_file", "write_file", "wait_for_agents"]) expect([...ro], `read-only 文本仍点名 ${gone}`).not.toContain(gone);
    const shared = new Set(toolNameTokens(BASE_SYSTEM, TOOL_NAMES));
    expect([...shared]).toContain("edit_file");
  });

  it("纪律编号 1–6 在 read-only 档也连续（断号会让模型以为后面的约束可省）", () => {
    const lines = systemPromptFor("read-only").split("\n");
    for (const n of [1, 2, 3, 4, 5, 6]) {
      expect(lines.filter((l) => l.startsWith(`${String(n)})`)), `纪律 ${String(n)} 那一行没了`).toHaveLength(1);
    }
    expect(lines.filter((l) => l.startsWith("编排")), "派活那一段对没有 spawn 面的档不适用").toHaveLength(0);
  });

  it("这一档的文本确实更短：每轮重送的静态段，省下的字节要印出来", () => {
    const before = Buffer.byteLength(BASE_SYSTEM, "utf8");
    const after = Buffer.byteLength(systemPromptFor("read-only"), "utf8");
    expect(after, `read-only 静态段 ${String(after)}B，未短于共用的 ${String(before)}B`).toBeLessThan(before);
    expect(before - after, "省的量小于 100 字节 ⇒ 像是只删了标点，编排段没落下去").toBeGreaterThanOrEqual(100);
  });

  it("覆盖档参与判定：缺席只在被声明的那几档里算，写错档名要抛", () => {
    const tables = { auto: ["edit_file", "verify"], read: ["verify"] } as Record<string, readonly string[]>;
    const hit = promptSurfaceFindings([{ name: "t", text: "改文件用 edit_file", modes: ["read"] }], tables, TOOL_NAMES, []);
    expect(hit.map((f: PromptSurfaceFinding) => `${f.kind}:${f.modes.join()}`)).toEqual(["odd:read"]);
    const clean = promptSurfaceFindings([{ name: "t", text: "改文件用 edit_file", modes: ["auto"] }], tables, TOOL_NAMES, []);
    expect(clean, "只发给在场档的文本不许报——否则拆开之后那些档会被牵连").toHaveLength(0);
    expect(() => promptSurfaceFindings([{ name: "t", text: "x", modes: ["nosuch"] }], tables, TOOL_NAMES, []),
      "覆盖档名字写错＝那一档的工具面读不到，不许读成「那一档没承诺」").toThrow(/不存在的档/u);
  });

  it("取料面由装配函数分组生成（不是手抄清单）：四档各属一面，且没有第五面", () => {
    const faces = proseFaces();
    const covered = faces.flatMap((f) => [...f.modes]).sort();
    expect(covered).toEqual(["auto", "default", "guided", "read-only"]);
    expect(faces.length, "面数＝不同文本的条数；今日现读是 2（共用一份 + read-only 自己一份）").toBe(2);
    for (const f of faces) expect(f.text).toBe(systemPromptFor(f.modes[0] as never));
  });

  it("接线：生产装配点把按档取的面交给 provider（行锚定，防同字面量冒领）", () => {
    const src = readFileSync(fileURLToPath(new URL("../src/main/agent-runner.ts", import.meta.url)), "utf8");
    const hits = src.match(/^ {6}provider: createProvider\(promptText, systemPromptFor\(opts\.mode\), modelSelection, \{$/gmu);
    expect(hits ?? [], "装配点还是硬传 BASE_SYSTEM ⇒ 拆完的文本没人消费（门会绿而这格没接线）").toHaveLength(1);
  });
});

describe("工具描述也是模型可见文本（第 176 页）", () => {
  const TABLES2 = { auto: ["edit_file", "verify", "write_file"], read: ["verify"] } as Record<string, readonly string[]>;
  const known = ["edit_file", "verify", "write_file", "run_shell"];

  it("namesOnly 只认名单：参数名／目录名不当工具承诺，名单里的名字照认", () => {
    expect(toolNameTokens("排除 node_modules，按 old_string 精确替换", known, { namesOnly: true })).toEqual([]);
    expect(toolNameTokens("批准前 write_file 会被拒绝", known, { namesOnly: true })).toEqual(["write_file"]);
    // 配对判据（规则 228）：同一串料走缺省判据时那两个蛇形就该被形状抓出来——
    // 否则「namesOnly 生效」与「这一面什么都不认」是同一种绿，分不开。
    expect(toolNameTokens("排除 node_modules，按 old_string 精确替换", known)).toEqual(["node_modules", "old_string"]);
  });

  it("描述面的缺席只在覆盖档里算；认不出名单外的名字是这一面的边界，要如实写", () => {
    const odd = promptSurfaceFindings(
      [{ name: "d", text: "批准前 write_file 会被拒绝", modes: ["read"], namesOnly: true }], TABLES2, known, []);
    expect(odd.map((f: PromptSurfaceFinding) => `${f.kind}:${f.token}:${f.modes.join()}`)).toEqual(["odd:write_file:read"]);
    const blind = promptSurfaceFindings(
      [{ name: "d", text: "先调 spawn_agent 再说", modes: ["read"], namesOnly: true }], TABLES2, known, []);
    expect(blind, "spawn_agent 不在名单里 ⇒ namesOnly 面认不出（这条是边界证人，不是缺陷）").toHaveLength(0);
  });

  it("真取料：每把工具自己的描述，不点名它那一档拿不到的工具", () => {
    const faces = descriptionFaces();
    const tables = tablesByMode();
    expect(faces.length, "描述面数＝四档工具面之和（现读 8＋20＋20＋20）").toBe(
      Object.values(tables).reduce((a, t) => a + t.length, 0),
    );
    for (const f of faces) {
      expect(f.namesOnly, `${f.name} 必须按名单判，否则参数名会淹掉真承诺`).toBe(true);
      expect(f.modes).toHaveLength(1);
    }
    expect(promptSurfaceFindings(faces, tables, TOOL_NAMES, []), "描述里点了别档才有的工具 ⇒ 红着点名").toHaveLength(0);
  });

  it("propose_plan：只读档不再点名写向那两把，可写档的原文案一字未动", () => {
    const roText = String(sessionToolSpecs({ mode: "read-only" }).specs.find((s) => s.function.name === "propose_plan")?.function.description ?? "");
    const defText = String(sessionToolSpecs({ mode: "default" }).specs.find((s) => s.function.name === "propose_plan")?.function.description ?? "");
    expect(roText, "只读档还在许诺 write_file（那一档没装配它）").not.toContain("write_file");
    expect(roText).not.toContain("run_shell");
    expect(roText, "换写法不等于删说明：这一档该说自己是什么").toContain("提交方案");
    expect(defText).toContain("write_file");
  });

  it("门真的把描述面喂进去（不是只喂系统文本）", () => {
    const all = allFaces();
    expect(all).toHaveLength(proseFaces().length + descriptionFaces().length + reminderFaces().length);
    expect(all.some((f) => f.name.startsWith("desc[read-only].")), "描述面没进门 ⇒ 上一条判卷只证明了它自己读了自己").toBe(true);
    expect(all.some((f) => f.name.startsWith("goalReminder[")), "续跑提醒没进门 ⇒ 那一族还是没人看").toBe(true);
  });

  it("续跑提醒取料：逐证据态各渲两份，且渲出来的不是空串（空面＝尺瞎了）", () => {
    const faces = reminderFaces();
    expect(Object.keys(EVIDENCE_TEXT).sort()).toEqual(["absent", "failed", "stale", "verified"]);
    expect(faces.length, "面数＝证据态数 × 2（hint 会**替换**默认指令那句，两种都得渲）").toBe(Object.keys(EVIDENCE_TEXT).length * 2);
    for (const f of faces) {
      expect(f.text.length, `${f.name} 渲染成空串 ⇒ 0 发现是假绿`).toBeGreaterThan(80);
      expect(f.text).toContain("goal 续跑");
      expect(f.modes).toEqual(["read-only", "default", "guided", "auto"]);
    }
  });

  it("续跑提醒里点到的工具，四档都得真拿得到（它逐轮重发，是模型唯一读到的指令）", () => {
    const tables = tablesByMode();
    const faces = reminderFaces();
    const tokens = new Set(faces.flatMap((f) => toolNameTokens(f.text, TOOL_NAMES)));
    expect([...tokens], "提醒里一个工具名都没认出来 ⇒ 多半是 goalReminder 不再提 verify，或取料坏了").toContain("verify");
    // **逐面**都要有 verify，不能只看并集：某一态的证据文案本身就带「verify」二字，
    // 只看并集时「收束条件那句被改掉」会被别的面替它作证（09-28 实测：这么写的第一版**变异存活**）。
    for (const f of faces) {
      expect(toolNameTokens(f.text, TOOL_NAMES), `${f.name} 这一份提醒没告诉模型该调 verify`).toContain("verify");
    }
    for (const t of tokens) {
      for (const m of ["read-only", "default", "guided", "auto"]) {
        expect(tables[m], `提醒让模型调 ${t}，但 ${m} 档的面上没有它`).toContain(t);
      }
    }
    expect(promptSurfaceFindings(faces, tables, TOOL_NAMES, [])).toHaveLength(0);
  });
});
