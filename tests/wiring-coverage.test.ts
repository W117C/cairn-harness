// 判卷 · `scripts/lib/wiring-coverage.ts`（「设置/调用方两半接线」的覆盖率棘轮）
//
// 存在的理由（PROGRESS 能力 34/35/36）：那一族 `X: over.x ?? (await store().get()).y` 每行有两个可坏方向，
// 而分辨力是**逐行突变**才量出来的——量完之后，下一个加开关的人不会重做那张表。
// 所以判据方向必须是"源码里有这行 ⇒ 必须有人守"，而不是"清单里写了几个就算几个"（规则 64）。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  coverWiring,
  extractAnchorNeedles,
  extractToggleWiring,
  type AnchorNeedle,
  type ToggleWiring,
} from "../scripts/lib/wiring-coverage";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const wiring = (src: string): ToggleWiring[] => extractToggleWiring(src);
const anchors = (src: string): AnchorNeedle[] => extractAnchorNeedles(src);

const ONE_LINE = `
async function f() {
  return await runAgent({
    autoVerify: over.autoVerify ?? (await store().get()).autoVerify,
  });
}
`;

describe("extractToggleWiring：只认那一个形状", () => {
  it("认出 `over.x ?? (await store().get()).y` 并给出两侧键名", () => {
    const found = wiring(ONE_LINE);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ key: "autoVerify", overrideKey: "autoVerify", settingsKey: "autoVerify" });
    expect(found[0]!.snippet).toContain("over.autoVerify ??");
    expect(found[0]!.line).toBeGreaterThan(1);
  });

  it("两侧键名不同也照认（planRequired ← planRequiredByDefault 就是这种）", () => {
    const found = wiring("const o = { planRequired: over.planRequired ?? (await store().get()).planRequiredByDefault };");
    expect(found[0]).toMatchObject({ key: "planRequired", settingsKey: "planRequiredByDefault" });
  });

  // 规则 79：注释里的示例不是代码。这条是"别把文档当被测面"的负控。
  it("注释里写的同样文字不算一行（按行正则判据会在这里假红）", () => {
    expect(wiring("// planRequired: over.planRequired ?? (await store().get()).planRequiredByDefault\n")).toEqual([]);
  });

  it("不是 `(await store())` 的右半边不算（别的 ?? 组合不归本判据管）", () => {
    expect(wiring("const o = { a: over.a ?? fallback.a };")).toEqual([]);
  });
});

describe("extractAnchorNeedles：从变异表文本里取针脚", () => {
  const TABLE = `
const MUTATIONS = [
  {
    id: "autoverify-ipc-settings-fallback-dropped",
    apply: (s) => s.replace("autoVerify: over.autoVerify ?? (await store().get()).autoVerify,", "autoVerify: over.autoVerify ?? false,"),
  },
  {
    id: "interpolated-needle",
    apply: (s) => s.replace(\`autoVerify: over.autoVerify ?? (await store().get()).autoVerify, \${x}\`, "y"),
  },
];
`;

  it("取到 id + 针脚 + 改法（空白归一化后与源码行可比）", () => {
    const got = anchors(TABLE).filter((a) => a.id === "autoverify-ipc-settings-fallback-dropped");
    expect(got).toHaveLength(1);
    expect(got[0]!.needle).toContain("over.autoVerify ??");
    expect(got[0]!.replacement).toContain("?? false");
  });

  // 带插值的模板字面量无法静态求值 ⇒ 如实"没看见"，而不是猜一个针脚出来。
  it("带插值的针脚不假装解析（宁可漏，也不编一条能匹配的针脚）", () => {
    expect(anchors(TABLE).some((a) => a.id === "interpolated-needle")).toBe(false);
  });
});

describe("coverWiring：两半各要有人守，豁免不许陈旧", () => {
  const w = wiring(ONE_LINE)[0]!;
  const settingsAnchor: AnchorNeedle = {
    id: "a-settings",
    needle: "autoVerify: over.autoVerify ?? (await store().get()).autoVerify,",
    replacement: "autoVerify: over.autoVerify ?? false,",
  };
  const overrideAnchor: AnchorNeedle = {
    id: "a-override",
    needle: "autoVerify: over.autoVerify ?? (await store().get()).autoVerify,",
    replacement: "autoVerify: (await store().get()).autoVerify,",
  };

  it("一条锚点都没有 ⇒ 两半各报一条问题（这就是新加开关却没人测的形状）", () => {
    const r = coverWiring([w], [], {});
    expect(r.problems).toHaveLength(2);
    expect(r.problems.join("\n")).toContain("设置界面的开关无人守");
    expect(r.problems.join("\n")).toContain("既没锚点也没署名");
  });

  it("只钉了读盘那半 ⇒ 仍报 override 那半缺；给了署名理由就不报", () => {
    expect(coverWiring([w], [settingsAnchor], {}).problems).toHaveLength(1);
    expect(coverWiring([w], [settingsAnchor], { autoVerify: "产品里没有调用者传它" }).problems).toEqual([]);
  });

  it("两半都有锚点时，署名表里的旧署名变成**陈旧**要报（逼人来删，别让它烂在这儿）", () => {
    const r = coverWiring([w], [settingsAnchor, overrideAnchor], { autoVerify: "以前没人传" });
    expect(r.problems).toEqual([]);
    expect(r.staleWaivers).toEqual(["autoVerify"]);
  });

  it("署名表指着一个已经不存在的键也不许静默通过（豁免表自己也会腐）", () => {
    const r = coverWiring([w], [settingsAnchor, overrideAnchor], { goneAway: "行删了忘撤署名" });
    expect(r.staleWaivers).toEqual(["goneAway"]);
  });
});

describe("真实现状：agent-runner 的每行两半接线都有锚点（棘轮本体）", () => {
  const runner = readFileSync(join(ROOT, "src/main/agent-runner.ts"), "utf8");
  const table = readFileSync(join(ROOT, "scripts/mutate-verify.mjs"), "utf8");
  const found = extractToggleWiring(runner);
  const needles = extractAnchorNeedles(table);

  // 尺本身可测（上一条 describe 已证），这里为 0 ⇒ 形状整体消失了：那也必须有人来改这条判据，
  // 不许它静默变成"恒真所以恒绿"（规则 74：读到 0 即绿的观测道要每次自证）。
  it("扫得到至少一行 —— 扫不到说明被测形状没了，该改判据而不是庆祝", () => {
    expect(found.length).toBeGreaterThan(0);
  });

  it("每行的两半各有一条锚点，且没有陈旧署名（空表 ⇒ 不再需要豁免）", () => {
    const r = coverWiring(found, needles, {});
    expect(r.problems, r.problems.join("\n")).toEqual([]);
    expect(r.staleWaivers).toEqual([]);
  });
});
