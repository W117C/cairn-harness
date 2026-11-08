// 公开 CI 面必须等于 PUBLIC_GATES（L1）——它不跑内部台账门与发布认证门。
//
// 这一格守三件事：① CI 只调用 `pnpm verify`，不再内联第二份门名单；
// ② 公开门清单里的每一项都有真实 package.json script；③ 公开 CI 不拉全量历史
// （`fetch-depth: 0` 只为内部台账的 D-5 服务，公开树不应再为它付 128 MB）。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GATES, PUBLIC_GATES } from "../scripts/gate-manifest";

const ROOT = process.cwd();
const WF = readFileSync(join(ROOT, ".github", "workflows", "verify.yml"), "utf8");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};

describe("公开 CI 面 = PUBLIC_GATES", () => {
  it("CI 只跑一条 pnpm verify，不再手抄第二份门名单", () => {
    expect(WF).toContain("pnpm verify");
    expect(WF).not.toContain("--only=");
  });

  it("公开 CI 不拉全量历史（公开树已无 PROGRESS 台账依赖）", () => {
    expect(WF).not.toContain("fetch-depth: 0");
  });

  it("PUBLIC_GATES 每一项都是 GATES 成员且有真实 script", () => {
    expect(PUBLIC_GATES.length).toBeGreaterThanOrEqual(20);
    for (const name of PUBLIC_GATES) {
      expect(GATES, `公开门 ${name} 不在 GATES 里`).toContain(name);
      expect(pkg.scripts[name], `公开门 ${name} 没有 package.json script`).toBeTruthy();
    }
  });

  it("L1 集合里不出现内部台账门", () => {
    for (const retired of ["docs-check", "repo-hygiene-check", "evidence-typecheck-check"]) {
      expect(PUBLIC_GATES).not.toContain(retired);
    }
  });
});
