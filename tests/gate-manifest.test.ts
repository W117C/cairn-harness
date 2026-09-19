// 门禁清单漂移护栏的回归测试（清单即事实源的机械兜底）。
// 守的是：没有验收形态脚本被静默冷落，也没有 GATES 条目指向不存在的 script。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { checkGateManifest, EXEMPT_SCRIPTS, GATES, gateCommand } from "../scripts/gate-manifest";

describe("checkGateManifest（清单漂移护栏）", () => {
  it("检出孤儿验收脚本：*-check 既不在 GATES 也不在 EXEMPT", () => {
    const v = checkGateManifest({ "typecheck": "tsc", "brand-new-check": "node x.ts" });
    const hit = v.find((x) => x.kind === "orphan-acceptance-script" && x.name === "brand-new-check");
    expect(hit).toBeDefined();
  });

  it("检出孤儿验收脚本：*:check 形态同样纳入", () => {
    const v = checkGateManifest({ "typecheck": "tsc", "orphan:check": "node x.ts" });
    expect(v.some((x) => x.kind === "orphan-acceptance-script" && x.name === "orphan:check")).toBe(true);
  });

  it("GATES 内的验收脚本不算孤儿", () => {
    const v = checkGateManifest({ "typecheck": "tsc", "tools-check": "node x.ts" });
    expect(v.some((x) => x.name === "tools-check")).toBe(false);
  });

  it("非验收形态脚本（dev/start/agent）不要求进 GATES", () => {
    const v = checkGateManifest({ dev: "electron-vite dev", start: "electron .", agent: "node a.ts" });
    expect(v.filter((x) => x.kind === "orphan-acceptance-script")).toHaveLength(0);
  });

  it("GATES 列了不存在的 script → gate-without-script", () => {
    const v = checkGateManifest({});
    const hits = v.filter((x) => x.kind === "gate-without-script");
    expect(hits.map((h) => h.name)).toEqual([...GATES]);
  });

  it("EXEMPT 里的空白理由被拒（豁免必须可审计）", () => {
    // 通过临时构造无法覆盖常量，此处直接断言当前仓库 EXEMPT 无空白理由。
    for (const [name, reason] of Object.entries(EXEMPT_SCRIPTS)) {
      expect(reason.trim(), "EXEMPT_SCRIPTS[" + name + "] 必须有理由").not.toBe("");
    }
  });
});

describe("真实仓库清单一致性（当前 package.json）", () => {
  it("checkGateManifest(实际 scripts) === 空（无漂移）", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(checkGateManifest(pkg.scripts)).toEqual([]);
  });

  it("清单非空且无重复项", () => {
    expect(GATES.length).toBeGreaterThan(0);
    expect(new Set(GATES).size).toBe(GATES.length);
  });
});

describe("gateCommand（门的执行计划：pnpm run / 直跑）", () => {
  const scripts = { "tools-check": "node --import tsx scripts/tools-check.ts", "blank-check": "   " };
  const root = "/repo";

  it("缺省（非直跑）：门名原样交给 pnpm run，不改写命令", () => {
    const p = gateCommand("tools-check", { direct: false, scripts: {}, root });
    expect(p).toEqual({ cmd: "pnpm", args: ["run", "tools-check"] });
  });

  it("直跑：跑 package.json 的脚本正文，并把该仓 node_modules/.bin 顶到 PATH 前", () => {
    const p = gateCommand("tools-check", { direct: true, scripts, root });
    expect(p.cmd).toBe("/bin/sh");
    expect(p.args).toEqual(["-c", "node --import tsx scripts/tools-check.ts"]);
    expect(p.pathPrepend).toBe("/repo/node_modules/.bin");
  });

  it("直跑但 scripts 里没有这道门 ⇒ missingScript（调用方必须判红，不得当成无事发生）", () => {
    const p = gateCommand("never-registered", { direct: true, scripts, root });
    expect(p.missingScript).toBe(true);
    expect(p.cmd).toBe("");
  });

  it("直跑但脚本正文是空白 ⇒ 同样判 missingScript（空命令的退出码 0 就是静默跳门）", () => {
    expect(gateCommand("blank-check", { direct: true, scripts, root }).missingScript).toBe(true);
  });

  it("实际 scripts 表：GATES 每一条都能在直跑模式下取到非空正文（否则 --direct 第一天就漏门）", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      scripts: Record<string, string>;
    };
    const missing = GATES.filter((g) => gateCommand(g, { direct: true, scripts: pkg.scripts, root }).missingScript === true);
    expect(missing).toEqual([]);
  });
});
