// 渲染层分层纪律的机器判卷（Phase 2 · 批 2.5）。
//
// 这份用例**不读仓里的真实渲染层**去判红线（那是 scripts/renderer-layer-check.ts 的活），
// 而是在**临时目录里造违规样本**，逐条钉「I1/I2/I3/I4 各自会红、会指出哪条规则、哪个文件:哪一行」。
// 为什么要单独造样本：门禁的判据若只看真实仓，绿的时候分不清是「判据没长牙」还是「真没犯规」。
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkAll, checkI1, checkI2, checkI3, checkI4, APP_TSX_LINE_CAP, RENDERER_FILE_LINE_CAP } from "../scripts/renderer-layer-check.js";

let root = "";
let renderer = "";

/** 在临时仓里造一个渲染层文件（相对渲染层根）。 */
function write(relative: string, content: string): string {
  const full = join(renderer, relative);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content, "utf8");
  return full;
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "cairn-layer-check-"));
  renderer = join(root, "apps", "desktop", "src", "renderer");
  mkdirSync(renderer, { recursive: true });
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("renderer-layer-check：四条不变量的机器面", () => {
  it("行数帽遵守已批准的 1200 / 900 上限", () => {
    expect(RENDERER_FILE_LINE_CAP).toBeLessThanOrEqual(1200);
    expect(APP_TSX_LINE_CAP).toBeLessThanOrEqual(900);
  });
  it("I1：components/** 与 panes/** import App.tsx ⇒ 红，并指出文件与行", () => {
    write("App.tsx", "export function App() { return null; }\n");
    const bad = write("components/Thing.tsx", [
      "import { App } from \"../App\";",
      "export function Thing() { return <App />; }",
    ].join("\n"));
    const v = checkI1([bad], root);
    expect(v.length).toBeGreaterThan(0);
    expect(v[0]!.rule).toBe("I1");
    expect(v[0]!.file).toContain("components/Thing.tsx");
    expect(v[0]!.line).toBe(1);
  });

  it("I1：state/** import App.tsx 不算 I1（那条只管组件层与面板层）", () => {
    const file = write("state/thing.ts", "import { App } from \"../App\";\nexport const x = App;\n");
    expect(checkI1([file], root)).toEqual([]);
  });

  it("I2：state/** import components/** ⇒ 红", () => {
    write("components/Button.tsx", "export const Button = 1;\n");
    const file = write("state/thing.ts", [
      "import { Button } from \"../components/Button\";",
      "export const x = Button;",
    ].join("\n"));
    const v = checkI2([file], root);
    expect(v.length).toBeGreaterThan(0);
    expect(v[0]!.rule).toBe("I2");
    expect(v[0]!.file).toContain("state/thing.ts");
    expect(v[0]!.line).toBe(1);
  });

  it("I2：state/** import 顶层纯模块不红", () => {
    const file = write("state/ok.ts", "import { toast } from \"../toast\";\nexport const x = toast;\n");
    expect(checkI2([file], root)).toEqual([]);
  });

  it("I3：derived/** 读时钟 / 取随机 / 写 async / 顶层 let ⇒ 都红", () => {
    const clock = write("derived/clock.ts", "export const t = (): number => Date.now();\n");
    const rand = write("derived/rand.ts", "export const r = (): number => Math.random();\n");
    const asy = write("derived/asy.ts", "export const f = async (): Promise<void> => { await Promise.resolve(); };\n");
    const mutable = write("derived/mutable.ts", "let counter = 0;\nexport const bump = (): number => ++counter;\n");
    for (const f of [clock, rand, asy, mutable]) {
      const v = checkI3([f], root);
      expect(v.length).toBeGreaterThan(0);
      expect(v[0]!.rule).toBe("I3");
      expect(v[0]!.file).toContain("derived/");
    }
  });

  it("I3：注释里写禁词不算犯规（判据只看代码）", () => {
    const file = write("derived/commented.ts", [
      "// 这里提一句 Date.now 是为了说明为什么不用它。",
      "/* new Date 也不写。 */",
      "export const x = 1;",
    ].join("\n"));
    expect(checkI3([file], root)).toEqual([]);
  });

  it("I3：derived/** import 未登记的运行时模块 ⇒ 红；type-only 不红", () => {
    mkdirSync(join(root, "src", "main"), { recursive: true });
    writeFileSync(join(root, "src", "main", "whatever.ts"), "export const thing = 1;\n", "utf8");
    const bad = write("derived/imp.ts", "import { thing } from \"../../../../../src/main/whatever\";\nexport const x = thing;\n");
    expect(checkI3([bad], root).some((v) => v.rule === "I3")).toBe(true);
    const typeOnly = write("derived/typeonly.ts", "import type { AgentEvent } from \"../../../../../src/main/ipc-protocol\";\nexport type X = AgentEvent;\n");
    expect(checkI3([typeOnly], root)).toEqual([]);
  });

  it("I4：超出行数帽 ⇒ 红，且报出实际行数与上限", () => {
    const long = write("derived/long.ts", Array.from({ length: RENDERER_FILE_LINE_CAP + 5 }, (_, i) => `const v${i} = ${i};`).join("\n"));
    const v = checkI4([long], root);
    expect(v.length).toBe(1);
    expect(v[0]!.rule).toBe("I4");
    expect(v[0]!.message).toContain(String(RENDERER_FILE_LINE_CAP));
  });

  it("合起来跑：一份干净样本零违规，一份脏样本逐条报错", () => {
    const clean = [
      write("App.tsx", "export function App() { return null; }\n"),
      write("components/ok.tsx", "export const C = 1;\n"),
      write("state/ok.ts", "export const s = 1;\n"),
      write("derived/ok.ts", "export const d = 1;\n"),
    ];
    expect(checkAll(clean, root)).toEqual([]);

    const dirty = [
      write("App.tsx", "export function App() { return null; }\n"),
      write("components/bad.tsx", "import { App } from \"../App\";\nexport const C = App;\n"),
      write("state/bad.ts", "import { C } from \"../components/bad\";\nexport const s = C;\n"),
      write("derived/bad.ts", "export const d = (): number => Date.now();\n"),
    ];
    const rules = new Set(checkAll(dirty, root).map((v) => v.rule));
    expect(rules.has("I1")).toBe(true);
    expect(rules.has("I2")).toBe(true);
    expect(rules.has("I3")).toBe(true);
  });
});
