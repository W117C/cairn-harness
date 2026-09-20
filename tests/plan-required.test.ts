// plan 模式（用户武装的「先批后写」）判卷。立项理由见 spec §1 P1/P2：
// 武装前只有模型自愿调用 propose_plan 才会落下写禁（markPlanProposed 在 src 里唯一的生产调用者
// 就是那件工具本身），而同一句 `proposed && !approved` 被抄在五处 —— 加一个用户开关若漏改任一处，
// 结果不是「开关不生效」这么温和，而是「未批 plan 期间 remember 能写、write_file 不能写」这种
// 同轮双口径（autonomy.ts 自己的注释：同一轮里两种口径就是这条规则的漏洞形状）。
// 故本文件先锁「副本没了」，再锁「武装后每一路口径一致」。
import { readdirSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  approvePlan,
  checkPermission,
  enterPlanRunScope,
  getPlanState,
  markPlanProposed,
  planGateBlocks,
  resetPlanState,
  runWithPlanScope,
} from "../src/permissions";
import { evaluate, newAutonomySession } from "../src/permissions/autonomy";
import { DEFAULT_SETTINGS, SettingsStore } from "../src/main/settings";
import type { ToolName } from "../src/tools/base";

beforeEach(() => {
  resetPlanState();
});

function walkSources(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkSources(p, out);
    // 渲染层是 vanilla .js，不扫它就等于给"手写副本"留了一个免检面（同族：零引用扫描也吃过这一口）
    else if (/\.(ts|js)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe("J1 · 判据只有一份（P2 的复发闸）", () => {
  it("src/ 里除唯一谓词外不得再出现 proposed && approved 的手写比较（含 .js 与反写顺序）", () => {
    // 覆盖面就是这条断言的全部意义：曾只扫 src/permissions + src/main 的 .ts，
    // 而注释写的是「锁 src 内」——守卫覆盖面小于它的声称 = 潜伏的假绿（审查 C5）。
    const files = walkSources(join(__dirname, "..", "src"));
    const copies = files
      .filter((f) => !f.endsWith(join("src", "permissions", "index.ts")))
      .filter((f) =>
        readFileSync(f, "utf8")
          .split("\n")
          .some((l) => l.includes("proposed") && l.includes("approved") && l.includes("&&")),
      )
      .map((f) => f.slice(f.indexOf("src")));
    expect(copies).toEqual([]);
  });

  it("唯一谓词三态齐备：required 单独成立、proposed 单独成立、approved 关掉一切", () => {
    expect(planGateBlocks({ required: true, proposed: false, approved: false })).toBe(true);
    expect(planGateBlocks({ required: false, proposed: true, approved: false })).toBe(true);
    expect(planGateBlocks({ required: false, proposed: false, approved: false })).toBe(false);
    expect(planGateBlocks({ required: true, proposed: true, approved: true })).toBe(false);
  });
});

describe("J2 · 用户武装后每一路口径一致", () => {
  it("武装即写禁：连 auto 档也拦写向，只读与门工具不受影响", () => {
    runWithPlanScope(() => {
      expect(getPlanState()).toEqual({ required: true, proposed: false, approved: false });
      for (const mode of ["read-only", "default", "auto"] as const) {
        expect(checkPermission(mode, "write_file")).toBe("deny");
        expect(checkPermission(mode, "run_shell")).toBe("deny");
      }
      expect(checkPermission("auto", "read_file")).toBe("allow");
      expect(checkPermission("auto", "propose_plan")).toBe("allow"); // 交方案这条路必须一直开着
      expect(checkPermission("auto", "verify")).toBe("allow");
    }, true);
  });

  it("批准后放行；未武装时行为与武装前逐字相同（零回归）", () => {
    runWithPlanScope(() => {
      expect(checkPermission("auto", "write_file")).toBe("deny");
      approvePlan();
      expect(checkPermission("auto", "write_file")).toBe("allow");
    }, true);
    runWithPlanScope(() => {
      expect(checkPermission("auto", "write_file")).toBe("allow");
      expect(checkPermission("default", "write_file")).toBe("ask");
    });
  });

  it("模型自己提交方案不得顺手把用户的闸关掉（required 在 markPlanProposed 后保留）", () => {
    runWithPlanScope(() => {
      markPlanProposed();
      expect(getPlanState().required).toBe(true);
    }, true);
  });

  it("权限管线（evaluate）同一口径：写向被拒，未标 readOnlyHint 的 MCP 按写处理，带注解的只读放行", () => {
    runWithPlanScope(() => {
      const s = newAutonomySession("auto");
      s.planBlocked = planGateBlocks(getPlanState());
      const write = evaluate("write_file", { path: "a.ts", content: "x" }, s);
      expect(write.verdict).toBe("deny");
      expect(write.verdict === "deny" && write.reason).toContain("方案门"); // 拒因要点名是这道门，不是别的闸顺手拦住
      expect(evaluate("mcp__srv__do" as ToolName, {}, s, { annotated: false }).verdict).toBe("deny");
      expect(evaluate("mcp__srv__peek" as ToolName, {}, s, { annotated: true, readOnly: true }).verdict).toBe("approve");
      expect(evaluate("read_file", { path: "a.ts" }, s).verdict).toBe("approve");
    }, true);
  });
});

describe("J3 · 武装是 run 级的，不跨 run 串台", () => {
  it("外层未武装 ⇒ 内层 required 只活在自己的作用域", () => {
    runWithPlanScope(() => {
      expect(checkPermission("auto", "write_file")).toBe("allow");
      const inner = runWithPlanScope(() => checkPermission("auto", "write_file"), true);
      expect(inner).toBe("deny");
      expect(getPlanState()).toEqual({ required: false, proposed: false, approved: false });
      expect(checkPermission("auto", "write_file")).toBe("allow");
    });
  });

  it("enterPlanRunScope(true) 武装当前 run；缺省调用回到未武装", () => {
    enterPlanRunScope(true);
    expect(getPlanState().required).toBe(true);
    expect(checkPermission("auto", "write_file")).toBe("deny");
    enterPlanRunScope();
    expect(getPlanState().required).toBe(false);
    expect(checkPermission("auto", "write_file")).toBe("allow");
  });
});

// 设置页那一行（index.html 的 .set-switch[data-setting="planRequiredByDefault"]）经统一 binder 调
// setSettings({key: value})，而 SettingsStore.set 有一张**手写键白名单**：不在名单里的键整块 patch
// 被丢 ⇒ 开关看着能动、重启就没了（「字段收下即丢」）。这条泛化成对所有布尔键的机械判卷，
// 于是以后每加一个设置项都自动被这张闸管着，不用为它单写一条测。
describe("J4 · settings 白名单不许吞掉任何一个布尔键", () => {
  let dir = "";
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "plan-required-settings-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("DEFAULT_SETTINGS 里每个布尔键都能经 set() 翻面并读回", async () => {
    const store = new SettingsStore(join(dir, "settings.json"));
    await store.get();
    const boolKeys = Object.keys(DEFAULT_SETTINGS).filter((k) => typeof (DEFAULT_SETTINGS as unknown as Record<string, unknown>)[k] === "boolean");
    expect(boolKeys.length).toBeGreaterThan(0);
    expect(boolKeys).toContain("planRequiredByDefault"); // 用户入口的真值来源，缺省必须是 false
    expect(DEFAULT_SETTINGS.planRequiredByDefault).toBe(false);
    const dropped: string[] = [];
    for (const key of boolKeys) {
      const flipped = !(DEFAULT_SETTINGS as unknown as Record<string, boolean>)[key];
      const next = await store.set({ [key]: flipped });
      if ((next as unknown as Record<string, boolean>)[key] !== flipped) dropped.push(key + "→set");
      const reloaded = await new SettingsStore(join(dir, "settings.json")).get();
      if ((reloaded as unknown as Record<string, boolean>)[key] !== flipped) dropped.push(key + "→盘");
      await store.set({ [key]: !flipped }); // 复位，避免互相污染
    }
    expect(dropped).toEqual([]);
  });
});
