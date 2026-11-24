import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (relativePath: string): string =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

describe("IM 缺省会话根接线", () => {
  it("不再把 explicitSessionsRoot(undefined) 注入 IM，缺省根由当前 workspace 显式导出", () => {
    const main = read("../src/main/index.ts");
    const imHost = read("../src/main/im-host.ts");
    const start = main.indexOf("const imDeps: DesktopImHostInput =");
    const end = main.indexOf("let imHost: ImHost | null", start);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const imDepsBlock = main.slice(start, end);
    expect(imDepsBlock).not.toContain("explicitSessionsRoot(undefined)");
    expect(imDepsBlock).toContain("sessionsRoot: async () => defaultSessionsRoot(workspace)");
    expect(imHost).toContain("export function defaultSessionsRoot(workspace: string): string");
    expect(imHost).toContain('join(workspace, ".agent", "sessions")');
  });
});
