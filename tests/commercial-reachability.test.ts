// 「能力已发货但用户点不到 = 零价值」的机械检查（commercial-check D2e 的判据本体）。
// 回归动因：React 向导随归档删除后，D 段仍拿 `onboarded` 的数据缺省宣称「首启必弹向导」，
// 门是绿的而产品里没有这个行为——本模块把「有没有消费者」变成一条能判真伪的断言。
import { describe, expect, it } from "vitest";
import {
  WIZARD_DEFINERS, isShippedSource, wizardReachability, wizardUnverifiedNote,
} from "../scripts/lib/commercial-reachability";

const definerGroup = { path: "src/main/onboarding-groups.ts", text: "export const ONBOARDING_GROUPS = []" };
const definerSettings = { path: "src/main/settings.ts", text: "onboarded: false, // 缺省" };

describe("wizardReachability", () => {
  it("只有定义层（当前 HEAD 的真实形态）⇒ 不可达，不得算通过", () => {
    const r = wizardReachability([definerGroup, definerSettings]);
    expect(r.reachable).toBe(false);
    expect(r.consumers).toEqual([]);
  });

  it("渲染层引用 ONBOARDING_GROUPS ⇒ 可达并指出是哪个文件", () => {
    const r = wizardReachability([
      definerGroup, definerSettings,
      { path: "src/renderer/app.js", text: "for (const g of ONBOARDING_GROUPS) render(g)" },
    ]);
    expect(r.reachable).toBe(true);
    expect(r.consumers).toEqual(["src/renderer/app.js"]);
  });

  it("主进程读 settings 的 onboarded 决定弹不弹 ⇒ 也算可达", () => {
    const r = wizardReachability([
      definerGroup, definerSettings,
      { path: "src/main/index.ts", text: "if (!settings.onboarded) showWizard()" },
    ]);
    expect(r.reachable).toBe(true);
  });

  it("定义层自己写 ONBOARDING_GROUPS / onboarded 不算消费者（否则永远自证通过）", () => {
    expect(WIZARD_DEFINERS).toContain("src/main/onboarding-groups.ts");
    expect(wizardReachability([definerGroup]).reachable).toBe(false);
    expect(wizardReachability([definerSettings]).reachable).toBe(false);
  });

  it("空文件面不可达（读不到 shipped 源码时不得假装绿）", () => {
    expect(wizardReachability([]).reachable).toBe(false);
  });
});

describe("wizardUnverifiedNote", () => {
  it("未证文案说清缺的是哪一段、以及两条出路", () => {
    const note = wizardUnverifiedNote([]);
    expect(note).toContain("无消费者");
    expect(note).toContain("补向导");
    expect(note).toContain("归档");
  });
});

describe("isShippedSource（D2e 的面定义）", () => {
  it("发货壳三棵树内的 ts / js / html 都收进来", () => {
    for (const p of [
      "src/renderer/app.js", "src/renderer/index.html", "src/renderer/message-actions.js",
      "src/main/agent-runner.ts", "src/preload/index.ts",
    ]) expect(isShippedSource(p)).toBe(true);
  });

  it("面外一律不收：类型胶水 / 构建产物 / 依赖 / 内核 / 验收面 / 文档", () => {
    for (const p of [
      "src/renderer/window.d.ts", "out/renderer/index.html", "node_modules/x/index.js",
      "src/agent/orchestrator.ts", "scripts/commercial-check.ts", "tests/x.test.ts", "AGENTS.md",
    ]) expect(isShippedSource(p)).toBe(false);
  });

  it("Windows 分隔符归一后同样判定（别把路径写法当成「没有消费者」）", () => {
    expect(isShippedSource("src\\renderer\\app.js")).toBe(true);
  });

  it("正向对照：后长出来的渲染层模块进面后，消费者读得到", () => {
    // 写死清单年代的面里没有 message-actions.js ⇒ 真补了向导也会报「无消费者」，红得没有依据
    const r = wizardReachability([
      definerGroup, definerSettings,
      { path: "src/renderer/message-actions.js", text: "const g = ONBOARDING_GROUPS[0]" },
    ]);
    expect(r.consumers).toEqual(["src/renderer/message-actions.js"]);
  });
});
