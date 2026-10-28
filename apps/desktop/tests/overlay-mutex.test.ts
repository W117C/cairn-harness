// 浮层互斥（2026-10-28 · 第 752 页）：同一处锚点上的两个浮层**不许同屏叠放**。
//
// 缺陷本体（真机复现，真实 renderer + 真实 dist）：
// 模型菜单（`ModelPicker`）与用量环浮层（`UsageMeter`）是**两个独立的 open 态**——
// 模型菜单的 `open` 在 `ModelPicker` 自己身上，Composer 的 `menu` 槽（attach/perm/meter）
// 不知道它。于是：模型菜单开着时点用量环 ⇒ 用量浮层开起来，**模型菜单仍在** ⇒
// 两个浮层同屏，几何上真的重叠（用量浮层盖住模型菜单右半），命中测试落在用量浮层上。
//
// 规格 §4.10.1 的层级只有两档、§3.11 的控件度量也只认一套；「同一个角上两个浮层叠着」
// 不是任何一档的形状——Composer 自己的注释（`Composer.tsx` 的浮层外点注释）早就记过
// 同族事故：「斜杠菜单开着再点模型菜单，两个弹层同屏叠放」，那次只修了斜杠那一对。
//
// 判据：
//   ① 纯函数层：互斥判定口径（两个浮层族的名字 → 谁能开、开了另一个要不要让路）；
//   ② 接线层：模型菜单的开合**与用量环共用一个互斥闸**（不许各开各的）；
//   ③ 真机层：模型菜单开着点用量环 ⇒ 只剩一个浮层在屏上。
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readRendererFile } from "./helpers/app-surface";

const composer = readRendererFile("components/Composer.tsx");
const picker = readRendererFile("components/ModelPicker.tsx");

describe("浮层互斥 · 纯函数层", () => {
  it("锚点带：模型与用量在右带、附件与权限在左带（读面用）", async () => {
    const mod = await import("../src/renderer/overlay-mutex");
    expect(mod.overlayLayersAt("composer-right")).toEqual(["model", "meter"]);
    expect(mod.overlayLayersAt("composer-left")).toEqual(["attach", "perm"]);
  });

  it("一个槽一次只装一个层 ⇒ 任何两个不同的层互斥", async () => {
    const mod = await import("../src/renderer/overlay-mutex");
    expect(mod.layersExclusive("model", "meter")).toBe(true);
    expect(mod.layersExclusive("model", "attach")).toBe(true);
    expect(mod.layersExclusive("meter", "attach")).toBe(true);
    expect(mod.layersExclusive("model", "model")).toBe(false);
  });

  it("换层 ⇒ 目标接管；同层再点 ⇒ 关掉", async () => {
    const mod = await import("../src/renderer/overlay-mutex");
    expect(mod.nextOverlay("none", "model")).toBe("model");
    expect(mod.nextOverlay("meter", "model")).toBe("model");
    expect(mod.nextOverlay("model", "model")).toBe("none");
    expect(mod.nextOverlay("none", "meter")).toBe("meter");
  });
});

describe("浮层互斥 · 接线层", () => {
  it("模型菜单的开合挂在 Composer 的浮层槽上（不再是它自己那份 open 态）", () => {
    // ModelPicker 仍是受控件形态，但**开合真相在 Composer**：给了 `open` 就以外部为准，
    // 没给（嵌用面）才退回内部态（旧行为不变）。
    expect(picker).toContain("const controlled = props.open !== undefined;");
    expect(picker).toContain("const open = controlled ? props.open === true : internalOpen;");
    expect(picker).toContain("props.onOpenChange(next);");
    // 触发钮的 toggle 走受控出口（不再自己 toggle 一个 Composer 不知道的态）。
    expect(picker).toContain("setOpen(!open)");
    expect(picker).not.toContain("setOpen((v) => !v)");
  });

  it("Composer 侧只有**一个**浮层状态真相（不再是各组件各一份）", () => {
    // 浮层槽的逻辑住在 composer-overlays.ts（Composer 已近行数帽 I4，浮层槽有自己的家）。
    expect(composer).toContain("useComposerOverlaySlot()");
    expect(composer).toContain("open={overlayLayer === \"model\"}");
    expect(composer).toContain("onOpenChange={setModelOpen}");
    expect(composer).toContain("onOpenChange={setMeterOpen}");
    // 浮层槽模块提供四个层的开合出口。
    const slot = readRendererFile("composer-overlays.ts");
    expect(slot).toContain("setModelOpen");
    expect(slot).toContain("setAttachOpen");
    expect(slot).toContain("setPermOpen");
    expect(slot).toContain("setMeterOpen");
  });
});
describe("浮层互斥 · 真机层（取料面）", () => {
  const evidence = fileURLToPath(new URL("../outputs/overlay-mutex-752/checks.json", import.meta.url));
  const hasMeasured = existsSync(evidence);
  const measured = (hasMeasured ? JSON.parse(readFileSync(evidence, "utf8")) : []) as {
    name: string; ok: boolean; detail: unknown;
  }[];

  it("真机脚本存在（量两个浮层是否同屏 + 几何是否重叠）", () => {
    const smoke = readFileSync(fileURLToPath(new URL("../scripts/overlay-mutex-smoke.cjs", import.meta.url)), "utf8");
    expect(smoke).toContain("mp-pop");
    expect(smoke).toContain("overlay-mutex-");
  });

  it.skipIf(!hasMeasured)("真机读数：模型菜单开着点用量环 ⇒ 只有一个浮层在屏上", () => {
    const byName = (needle: string) => measured.find((c) => c.name.includes(needle));
    expect(byName("只剩一个浮层")?.ok).toBe(true);
    expect(byName("不重叠")?.ok).toBe(true);
    expect(byName("反向同样互斥")?.ok).toBe(true);
    expect(byName("模型菜单仍能自己开、自己关")?.ok).toBe(true);
  });
});
