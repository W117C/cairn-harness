/** AGENTS.md 命令面对账的判卷：与 `scripts/lib/agents-command-face.ts` 共用**同一份**谓词
 *  （本文件不许自己再写一遍正则，否则它就是一条会各自漂的抄件）。
 *  两态各钉一次：一致 ⇒ 不出声；只改一处 ⇒ 必须响。真仓面读的是**当前这棵树**，
 *  所以脏主树与干净 HEAD 树各算一次独立对账（两版今天都自洽：HEAD 是 m0-desktop，工作树是 cairn-desktop）。 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkAgentsCommandFace,
  filterInvocations,
  mentionedPaths,
  rootScriptInvocations,
} from "../scripts/lib/agents-command-face";

const ROOT = process.cwd();
const readIf = (rel: string): string | null => {
  try { return readFileSync(join(ROOT, rel), "utf8"); } catch { return null; }
};
const scriptsOf = (text: string | null): string[] => {
  if (text === null) return [];
  try { return Object.keys((JSON.parse(text) as { scripts?: Record<string, string> }).scripts ?? {}); } catch { return []; }
};

describe("合成面：两态各红一次（新尺必须先证明自己有分辨力）", () => {
  const okAgents = "Run with `pnpm --filter cairn-desktop test` and `pnpm mutate-verify`; see `src/agent/`.";
  const base = {
    agentsMd: okAgents,
    rootScripts: ["mutate-verify"],
    desktopPkgName: "cairn-desktop",
    desktopScripts: ["test"],
    exists: (rel: string) => rel === "src/agent",
  };

  it("一致的那一态：一条都不许多报", () => {
    expect(checkAgentsCommandFace(base)).toEqual([]);
  });

  it("改名只改一处 ⇒ filter-name 必须响（这条就是本尺存在的理由）", () => {
    const r = checkAgentsCommandFace({ ...base, desktopPkgName: "m0-desktop" });
    expect(r.map((f) => f.kind)).toEqual(["filter-name"]);
    expect(r[0]!.detail).toContain("改名只改了一处");
  });

  it("filter 脚本名在 desktop 包里查不到 ⇒ 响；根 scripts 查不到 ⇒ 响", () => {
    expect(checkAgentsCommandFace({ ...base, desktopScripts: [] }).map((f) => f.kind)).toEqual(["filter-script"]);
    expect(checkAgentsCommandFace({ ...base, rootScripts: [] }).map((f) => f.kind)).toEqual(["root-script"]);
  });

  it("点名的路径不在树里 ⇒ 响，且说出是哪条", () => {
    const r = checkAgentsCommandFace({ ...base, exists: () => false });
    expect(r.map((f) => f.kind)).toContain("path-missing");
    expect(r.some((f) => f.detail.includes("src/agent"))).toBe(true);
  });

  it("取不到 desktop 包名 ⇒ 不许静默通过（说不清就是未检，不是绿）", () => {
    const r = checkAgentsCommandFace({ ...base, desktopPkgName: null });
    expect(r.map((f) => f.kind)).toContain("desktop-pkg-missing");
  });

  it("两类排除各钉一次，并配一条同形状的反向证人", () => {
    const md = "`<repo>/.agent/sessions/`、`node_modules/vitest/vitest.mjs`、`tests/vitest.config.ts`、`a=b/c`、`--filter x/y`";
    expect(mentionedPaths(md)).toEqual(["tests/vitest.config.ts"]);
    expect(mentionedPaths("`src/agent/`")).toEqual(["src/agent"]);
  });

  it("家目录记法不是仓内路径：`~/.dsh` 不入面，而真仓内路径照收（反向证人）", () => {
    // 2026-10-05：AGENTS.md 的 GraphFlow 段写了 `~/.dsh`，旧实现按「含 /」收 ⇒ 判
    // path-missing。家目录天然不在本仓树里，要求它存在是把尺量错了对象。
    // 这一条同时钉住**排除没把判据掏空**：同形状的真仓内路径必须仍然被收进来。
    expect(mentionedPaths("`~/.dsh`")).toEqual([]);
    expect(mentionedPaths("`~/.dsh/plugins/graphflow`")).toEqual([]);
    expect(mentionedPaths("`~/.dsh`、`scripts/gates.ts`")).toEqual(["scripts/gates.ts"]);
    // 真漂移仍会被抓住：改名后文档里的旧路径必须出现在面上（否则反向守卫自己就失效了）。
    expect(mentionedPaths("`bin/m0.mjs`")).toEqual(["bin/m0.mjs"]);
  });

  it("命令抽取的形状：--filter 给对，裸 pnpm 不把开关当脚本", () => {
    expect(filterInvocations("`pnpm --filter cairn-desktop test`")).toEqual([{ name: "cairn-desktop", script: "test" }]);
    expect(rootScriptInvocations("`pnpm --filter x test` 与 `pnpm mutate-verify`")).toEqual(["mutate-verify"]);
  });
});

describe("真仓面：AGENTS.md 写出来的每条命令都指向这棵树里存在的东西", () => {
  const agents = readIf("AGENTS.md") ?? readIf("agents.md");

  it("AGENTS.md 取得到（取不到＝没尺，不是通过）", () => {
    expect(agents, "AGENTS.md 读不到 ⇒ 这条对账整格未检").not.toBeNull();
  });

  it("命令面自洽；不一致时报出的每一条都要指名道姓", () => {
    const desktop = readIf("apps/desktop/package.json");
    let name: string | null = null;
    try { name = (JSON.parse(desktop ?? "{}") as { name?: string }).name ?? null; } catch { name = null; }
    const findings = checkAgentsCommandFace({
      agentsMd: agents ?? "",
      rootScripts: scriptsOf(readIf("package.json")),
      desktopPkgName: name,
      desktopScripts: scriptsOf(desktop),
      exists: (rel) => existsSync(join(ROOT, rel)),
    });
    expect(findings, findings.map((f) => f.detail).join("；")).toEqual([]);
    // 反向证人：抽取到的东西非空 ⇒ 上面那条「相等于 []」不是因为在数空气
    expect(filterInvocations(agents ?? "").length).toBeGreaterThan(0);
    expect(mentionedPaths(agents ?? "").length).toBeGreaterThan(3);
  });
});
