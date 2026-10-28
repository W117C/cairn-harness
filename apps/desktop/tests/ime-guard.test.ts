// IME 组字守卫（2026-10-28）：中文组字途中的一次回车**归 IME**，应用不得消费。
//
// 缺陷本体（真机复现，PROGRESS 第 749 页）：此前只有「发送」那条 Enter 路径带组字守卫，
// 斜杠菜单与 @mention 菜单的 Enter 分支没有 ⇒ 拼音组字期间按 Enter，菜单把**正在组字的
// 半成品**当成「选中了第 0 项」，输入框里的字被改写成 `/compact `——用户正在写的字被系统改掉。
//
// 三层判据（缺一层就留了让它复发的缝）：
//   ① 纯函数层：守卫口径（isComposing / nativeEvent.isComposing / keyCode 229 / 引用旗）；
//   ② 接线层：Composer 的 Enter 分支**全部**走这一处守卫（不是"某一条路径有"）；
//   ③ 真机层：真实 renderer 里 dispatch compositionstart + Enter(isComposing)，
//      断言输入框里的字**没被改写**、菜单**没被吃掉**。
//
// ③ 由 `apps/desktop/scripts/ime-guard-smoke.cjs` 产出读数（`outputs/ime-guard-<n>/`），
//    本文件只钉前两层 + 读第三层的取料面。
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isCompositionEnter } from "../src/renderer/ime";
import { appSurfaceFiles, readRendererFile } from "./helpers/app-surface";

const composer = readRendererFile("components/Composer.tsx");
const smoke = readFileSync(fileURLToPath(new URL("../scripts/ime-guard-smoke.cjs", import.meta.url)), "utf8");

/** 去行注释与块注释——判「代码里有没有」时，注释里的字样不算数。 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

describe("IME 组字守卫 · 纯函数层", () => {
  it("三条旗任一为真 ⇒ 这次 Enter 归 IME", () => {
    expect(isCompositionEnter({ isComposing: true }, null)).toBe(true);
    expect(isCompositionEnter({ nativeEvent: { isComposing: true } }, null)).toBe(true);
    expect(isCompositionEnter({ keyCode: 229 }, null)).toBe(true);
  });

  it("引用旗（compositionstart/end 驱动）为真时同样归 IME", () => {
    expect(isCompositionEnter({}, { current: true })).toBe(true);
    // 引用旗与事件旗**取或**：任一为真即归 IME（合成事件的旗在部分路径上缺失）。
    expect(isCompositionEnter({ isComposing: true }, { current: false })).toBe(true);
    expect(isCompositionEnter({ nativeEvent: { isComposing: true } }, { current: false })).toBe(true);
  });

  it("普通回车（无任何旗）不归 IME —— 守卫不能把正常 Enter 一起吃掉", () => {
    expect(isCompositionEnter({}, null)).toBe(false);
    expect(isCompositionEnter({ isComposing: false, keyCode: 13 }, null)).toBe(false);
    expect(isCompositionEnter({ nativeEvent: { isComposing: false } }, { current: false })).toBe(false);
    expect(isCompositionEnter(null, null)).toBe(false);
    expect(isCompositionEnter(undefined, undefined)).toBe(false);
  });

  it("keyCode 229 只在组字时出现；普通回车是 13", () => {
    expect(isCompositionEnter({ keyCode: 13 }, null)).toBe(false);
    expect(isCompositionEnter({ keyCode: 229 }, null)).toBe(true);
  });
});

describe("IME 组字守卫 · 接线层", () => {
  it("Composer 用的是共用的守卫函数，不是自己抄一份 flag 判断", () => {
    expect(composer).toContain('import { isCompositionEnter } from "../ime";');
    expect(composer).toContain("isCompositionEnter(e, composing)");
  });

  it("守卫在**所有** Enter 分支之前：斜杠菜单、@mention 菜单、发送三条路径共用一处", () => {
    // 守卫位置：onKeyDown 处理器里第一条 Enter 判定——三条路径都在它之后。
    // 窗口取到「处理器的闭合」为止（`}}` 收尾），不用固定字符数——固定窗口会随代码增长而失效。
    const startAt = composer.indexOf("onKeyDown={(e) => {");
    expect(startAt).toBeGreaterThan(-1);
    const endAt = composer.indexOf("}}", startAt);
    const handler = composer.slice(startAt, endAt);
    const guardAt = handler.indexOf("isCompositionEnter(e, composing)");
    expect(guardAt).toBeGreaterThan(-1);
    // 守卫**必须**早于三条 Enter 分支各自的 preventDefault。
    const slashEnter = handler.indexOf('if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey))');
    const mentionEnter = handler.indexOf('if (e.key === "Enter" || e.key === "Tab")');
    const sendEnter = handler.indexOf('if (e.key !== "Enter" || e.shiftKey || e.altKey) return;');
    expect(slashEnter).toBeGreaterThan(-1);
    expect(mentionEnter).toBeGreaterThan(-1);
    expect(sendEnter).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(slashEnter);
    expect(guardAt).toBeLessThan(mentionEnter);
    expect(guardAt).toBeLessThan(sendEnter);
  });

  it("发送路径的旧守卫已被共用守卫取代（不留两份口径）", () => {
    // 旧写法 `if (composing.current) return;` 在发送分支里；现在由共用守卫统一处理。
    // 保留它也无妨（同一口径），但**不能**只有它——斜杠/mention 分支也要被守卫罩住。
    const startAt = composer.indexOf("onKeyDown={(e) => {");
    const handler = composer.slice(startAt, composer.indexOf("}}", startAt));
    const guardCount = handler.split("isCompositionEnter(e, composing)").length - 1;
    expect(guardCount).toBe(1); // 一处守卫罩住全部路径（不是每条分支各抄一遍）
  });

  it("全仓只有一个组字判定口径：别的组件不许自己抄 isComposing 判断消费 Enter", () => {
    // 反向锚：渲染层里除 ime.ts 外，不该再出现裸的 `isComposing` 消费判断。
    // 读**面**（全部渲染层源文件），不是单文件——只读一个文件会让否定断言空过。
    //
    // ⚠️ 匹配前**去注释**：注释里提到 `nativeEvent.isComposing` 是在解释历史，
    // 不是在消费它。拿注释当证据会逼着人改注释来骗过门——本仓已吃过这个亏
    // （「注释当线索不当证据」）。去注释的已知限制：字符串字面量里含 `//` 时会截断，
    // 但本条要匹配的两种写法不会出现在 URL 之类的字面量里。
    const offenders: string[] = [];
    for (const rel of appSurfaceFiles()) {
      if (rel === "ime.ts") continue;
      const src = stripComments(readRendererFile(rel));
      if (src.includes("nativeEvent.isComposing") || /\.isComposing\s*===\s*true/.test(src)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("IME 组字守卫 · 真机层（取料面）", () => {
  const outDir = fileURLToPath(new URL("../outputs/ime-guard-749", import.meta.url));
  const evidence = `${outDir}/checks.json`;
  const hasMeasured = existsSync(evidence);
  const measured = (hasMeasured ? JSON.parse(readFileSync(evidence, "utf8")) : []) as {
    name: string; ok: boolean; detail: unknown;
  }[];

  it("真机脚本存在且断言了「组字期间 Enter 不改写输入框」", () => {
    expect(smoke).toContain("compositionstart");
    expect(smoke).toContain("isComposing");
    expect(smoke).toContain("ime-guard-");
  });

  // 真机读数是**实测产物**（真实 renderer + 真实 dist）。缺席时按本仓既有约定
  // （cds-parity 判卷的 `it.skipIf(!hasMeasured)`）skip 并明说「跳过 ≠ 通过」——
  // 缺证据是「没验」，不是「验过没过」。
  it.skipIf(!hasMeasured)("真机读数在场：组字回车后输入框原文不变、菜单未被吃掉", () => {
    const guard = measured.find((c) => c.name.includes("组字"));
    expect(guard).toBeDefined();
    expect(guard?.ok).toBe(true);
  });

  it.skipIf(!hasMeasured)("真机读数里两条对照都在：组字被挡、非组字仍走菜单", () => {
    const byName = (needle: string) => measured.find((c) => c.name.includes(needle));
    expect(byName("不被斜杠菜单吃掉")?.ok).toBe(true);
    expect(byName("不发消息")?.ok).toBe(true);
    expect(byName("守卫只挡组字那一次")?.ok).toBe(true);
  });

  it.skipIf(!hasMeasured)("候选确认顺序（compositionend 先于 keydown）也不发送半成品拼音", () => {
    // 这一条是「只维护 composition 引用」那个口径的漏网处：Chromium 的「回车确认候选词」
    // 是 compositionend **先于** keydown ⇒ 引用已复位 ⇒ 只看引用会漏挡 ⇒ 半成品拼音被发出去。
    const byName = (needle: string) => measured.find((c) => c.name.includes(needle));
    expect(byName("候选确认顺序")?.ok).toBe(true);
  });
});
