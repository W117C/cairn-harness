// 首启「设置检查」判卷：七组覆盖面来自主进程，渲染层不抄清单，只排版 + 给到设置页的入口。
//
// 这一批钉三件事：
//   ① **七组全有落点**——渲染层的落点表与服务端那份组清单**逐项对齐**。
//      服务端加了一组而渲染层没跟上 ⇒ 这里当场红（那正是"点不动的一格"的来处）。
//   ② 空清单 ⇒ 整块不渲染（不摆一个空壳：那比不摆更让人以为坏了）。
//   ③ **没有落点的组不许摆成可点的按钮**——点了会跳到不存在的分区＝点不动。
//
// 环境是 node（没有 DOM）⇒ 点击行为靠纯函数与渲染出的标记钉，不假装能点。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ONBOARDING_GROUPS, type OnboardingGroup } from "../../../src/main/onboarding-groups";
import { OnboardingChecklist, ONBOARDING_TARGET, groupByStep, onboardingTarget } from "../src/renderer/components/OnboardingChecklist";
import { destinationForSection } from "../src/renderer/navigation";
import { STR } from "../src/renderer/strings";

const groups = ONBOARDING_GROUPS as readonly OnboardingGroup[];

describe("首启设置检查：七组覆盖面", () => {
  it("① 渲染层的落点表与服务端的组清单**逐项对齐**：服务端加组而这边没跟上 ⇒ 立刻红", () => {
    // 反向证人：这张表不是空的、也不是随手多写——服务端每一组都要有落点。
    expect(Object.keys(ONBOARDING_TARGET).sort()).toEqual([...new Set(groups.map((g) => g.id))].sort());
    for (const g of groups) {
      expect(onboardingTarget(g.id), `组 ${g.id} 没有落点分区`).toBeDefined();
    }
  });

  it("①-反向：把一组的落点抽掉 ⇒ 那一组被认成「没有落点」（表与服务端不再对齐）", () => {
    // 专破它自己的坏输入：证明上面那条不是恒真（表与服务端确实在互相盯着）。
    const mutated = { ...ONBOARDING_TARGET } as Record<string, string | undefined>;
    delete mutated["provider"];
    expect(Object.keys(mutated).sort()).not.toEqual([...new Set(groups.map((g) => g.id))].sort());
  });

  it("② 空清单 ⇒ 整块不渲染（不是摆一个空壳）", () => {
    const html = renderToStaticMarkup(<OnboardingChecklist groups={[]} onOpen={() => undefined} onDone={() => undefined} />);
    expect(html).toBe("");
  });

  it("③ 没有落点的组**不摆成可点的按钮**（点不动的入口比不摆更糟）", () => {
    // 标记串取一个**不会与真文案撞**的（先前用「新组」，结果撞上「关于/更新组配置」里的「新组」两字
    // ⇒ 断言恒红。子串断言必须挑一个只有坏输入才有的标记）。
    const rogue = [{ id: "brand-new-group", label: "ZZROGUEMARK", step: 1, entry: "ZZROGUEMARK" }] as unknown as readonly OnboardingGroup[];
    expect(onboardingTarget("brand-new-group")).toBeUndefined();
    const html = renderToStaticMarkup(<OnboardingChecklist groups={rogue} onOpen={() => undefined} onDone={() => undefined} />);
    expect(html).toBe("");
    // 只剩「没有落点」的那组 ⇒ 整块不渲染（半截的清单比不摆更让人以为坏了）。
    const mixed = renderToStaticMarkup(
      <OnboardingChecklist groups={[...groups, rogue[0]!]} onOpen={() => undefined} onDone={() => undefined} />,
    );
    expect(mixed).not.toContain("brand-new-group");
    expect(mixed).not.toContain("ZZROGUEMARK");
  });

  it("七组按步号摆成四步，组内保持服务端给的顺序", () => {
    const steps = groupByStep(groups);
    expect(steps.map((s) => s.step)).toEqual([1, 2, 3, 4]);
    expect(steps.flatMap((s) => s.groups.map((g) => g.id))).toEqual(groups.map((g) => g.id));
    // 步号域是 1..4；出现别的步号 ⇒ 服务端与这里不再是同一份事实
    for (const s of steps) expect(s.step).toBeGreaterThanOrEqual(1);
    for (const s of steps) expect(s.step).toBeLessThanOrEqual(4);
  });

  it("渲染出的清单：每一组一个按钮，文案取服务端那份（渲染层不另抄一份）", () => {
    const html = renderToStaticMarkup(<OnboardingChecklist groups={groups} onOpen={() => undefined} onDone={() => undefined} />);
    for (const g of groups) {
      expect(html, `组 ${g.id} 的标题没上屏`).toContain(g.label);
      expect(html, `组 ${g.id} 的说明没上屏（title 承载）`).toContain(g.entry);
      expect(html, `组 ${g.id} 的说明没有可见文本`).toContain("onboard-entry");
    }
    // 四步 ⇒ 四行（分组由行距说，不给步号）
    expect(html.match(/onboard-step/g)?.length).toBe(4);
  });

  it("不摆中间标签：没有可见标题、没有步号（分组交给行距说）", () => {
    const html = renderToStaticMarkup(<OnboardingChecklist groups={groups} onOpen={() => undefined} onDone={() => undefined} />);
    // 可见的标题行与步号列都撤了——同一屏上方的建议行已经有一套编号，再来一套就是两列打架的编号。
    expect(html).not.toContain("onboard-t");
    expect(html).not.toContain("onboard-n");
    // 无障碍名仍要留（读屏要，屏幕上不要）
    expect(html).toContain('aria-label="设置检查"');
  });

  it("④ 有「完成，不再显示」出口；空清单仍不渲染（出口不能造出空壳）", () => {
    const html = renderToStaticMarkup(
      <OnboardingChecklist groups={groups} onOpen={() => undefined} onDone={() => undefined} />,
    );
    expect(html).toContain('class="onboard-done"');
    expect(html).toContain(STR.onboarding.done);
    expect(renderToStaticMarkup(
      <OnboardingChecklist groups={[]} onOpen={() => undefined} onDone={() => undefined} />,
    )).toBe("");
  });

  it("routes onboarding groups to durable destinations when appropriate", () => {
    expect(onboardingTarget("memory")).toBe("memory");
    expect(destinationForSection("memory")).toBe("memory");
    expect(destinationForSection("telemetry" as never)).toBeNull();
  });

  it("⑤ 关闭动作落 settings.onboarded=true；失败回滚；WorkbenchView 真接线", () => {
    const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
    const onboarding = read("../src/renderer/state/onboarding.ts");
    const state = read("../src/renderer/state/workbench.ts");
    const view = read("../src/renderer/panes/WorkbenchView.tsx");
    expect(onboarding).toContain("setSettings({ onboarded: true })");
    expect(onboarding).toContain("setOnboarded(true)");
    expect(onboarding).toContain("setOnboarded(false)"); // 写失败回滚，不能只隐藏不落盘
    expect(state).toContain("useOnboardingGroups(onboarded, setOnboarded, setLastError)");
    expect(state).toContain("dismissOnboarding,");
    expect(view).toContain("onDone={dismissOnboarding}");
    expect(read("../src/renderer/components/OnboardingChecklist.tsx")).toContain("onClick={props.onDone}");
  });
});

describe("首启七格排成清单，不是参差药丸堆（2026-11-01 第 894 页）", () => {
  const css = readFileSync(fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url)), "utf8");
  it("每一步的格子等宽并铺满整行（列数随本步格数，不留尾部空洞）", () => {
    const items = css.match(/\.onboard-items\s*\{[^}]*\}/)?.[0] ?? "";
    expect(items).not.toBe("");
    expect(items, "要按本步格数铺满：auto-flow column + 等分列").toContain("grid-auto-flow: column");
    expect(items).toMatch(/grid-auto-columns:\s*minmax\(0,\s*1fr\)/);
    // 反向：不许退回「固定列 + 内容自伸缩」——那正是 1/2/3/1 步数下每行缺右角的原因。
    expect(items).not.toContain("flex-wrap");
    expect(items).not.toMatch(/repeat\(auto-fit/);
  });

  it("格子自身不再按文字收宽（旧 max-width:260px 让每格宽度=文案长度）", () => {
    const item = css.match(/\.onboard-item\s*\{[^}]*\}/)?.[0] ?? "";
    expect(item).not.toContain("max-width: 260px");
    expect(item).toContain("min-width: 0");
  });

  it("完成出口看得出可以点（描边胶囊），但仍是次级动作", () => {
    const done = css.match(/\.onboard-done\s*\{[^}]*\}/)?.[0] ?? "";
    expect(done).toContain("border: 1px solid var(--hairline-strong)");
    expect(done, "不抢主位：不走品牌色相").not.toContain("accent-brand");
    expect(done).toContain("background: transparent");
  });
});
