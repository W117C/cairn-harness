/** 认证一棵树之前的那道前置检查（第 84 页：我两次把**环境假红**读成代码红）。
 *  纯函数层：`declaredDeps` / `installedDeps` / `missingDeclaredDeps` / `certLevel`（第 119 页加的等级）。 */
import { spawnSync, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { certLevel, declaredDeps, installedDeps, missingDeclaredDeps } from "../scripts/lib/head-cert-deps";

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const listWorktrees = (cwd: string): string[] =>
  execFileSync("git", ["worktree", "list", "--porcelain"], { cwd, encoding: "utf8" })
    .split("\n")
    .filter((l) => l.startsWith("worktree "));

const pkg = (fields: Record<string, Record<string, string>>): string => JSON.stringify(fields);

describe("declaredDeps：取料面", () => {
  it("dependencies + devDependencies + optionalDependencies 都算声明了", () => {
    const text = pkg({
      dependencies: { zod: "^3" },
      devDependencies: { typescript: "^5", vitest: "^5" },
      optionalDependencies: { fsevents: "2" },
    });
    expect(declaredDeps(text)).toEqual(["fsevents", "typescript", "vitest", "zod"]);
  });

  it("peerDependencies 不算——它可以合法不装，报出来是噪声（会把人推去装用不上的包）", () => {
    const text = pkg({ dependencies: { a: "1" }, peerDependencies: { react: ">=18" } });
    expect(declaredDeps(text)).toEqual(["a"]);
  });

  it("坏 JSON / 非对象 = 空清单（取料失败由调用方按『没尺』处理，不在这里编造依赖）", () => {
    expect(declaredDeps("{ not json")).toEqual([]);
    expect(declaredDeps('"a string"')).toEqual([]);
    expect(declaredDeps("{}")).toEqual([]);
  });
});

describe("installedDeps：与盘上清单对齐", () => {
  it("非包条目（以 . 开头）被剔掉，其余原样保留并排序", () => {
    expect(installedDeps(["zod", ".bin", ".package-lock.json", "@types", "typescript"])).toEqual(["@types", "typescript", "zod"]);
  });

  it("重复条目去重（同一包从两处 readdir 混进来时不许比出假差异）", () => {
    expect(installedDeps(["a", "a", "b"])).toEqual(["a", "b"]);
  });
});

describe("missingDeclaredDeps：只报『声明了而没装』那一格", () => {
  const headLike = pkg({ dependencies: { electron: "^44", zod: "^3" }, devDependencies: { typescript: "^5" } });

  it("主树（core-only，electron 已摘）的清单去认证仍含桌面层的 HEAD ⇒ 必须点名 electron", () => {
    expect(missingDeclaredDeps(headLike, ["zod", "typescript"])).toEqual(["electron"]);
  });

  it("作用域包按展开后的名字比：装了 `@types/node` 就不算缺", () => {
    const withScoped = pkg({ devDependencies: { "@types/node": "^22" } });
    expect(missingDeclaredDeps(withScoped, ["@types/node"])).toEqual([]);
    // 反向：只把 `@types` 这一层目录名当清单 ⇒ 假缺失（取料方必须展开，本用例钉住这个边界）
    expect(missingDeclaredDeps(withScoped, ["@types"])).toEqual(["@types/node"]);
  });

  it("只装不声明的不算缺失（别的会话留在树上的包，不许变成这道检查的噪声）", () => {
    expect(missingDeclaredDeps(pkg({ dependencies: { a: "1" } }), ["a", "leftover-from-someone-else"])).toEqual([]);
  });

  it("package.json 读不到 ⇒ 空，而**调用方**必须把空当『没尺』：这里给一条钉住语义的反向用例", () => {
    expect(missingDeclaredDeps("", ["anything"])).toEqual([]);
  });
});

describe("certLevel：半把尺不许冒充认证（第 119 页，起因是第 116/117 页我自己踩的那盏假灯）", () => {
  it("不跳测＝完整认证", () => {
    expect(certLevel(false, "")).toEqual({ level: "full", ok: true, label: "完整（typecheck ＋ 全量）" });
  });

  it(`跳测又没写理由 ⇒ ok=false（脚本据此 exit 2），文案点名要 --why`, () => {
    const r = certLevel(true, "   ");
    expect(r.level).toBe("half");
    expect(r.ok).toBe(false);
    expect(r.label).toContain("--why");
  });

  it("跳测但写了理由 ⇒ 放行，可文案必须自带『不构成全量绿』＋把理由印出来", () => {
    const r = certLevel(true, "只看 typecheck 那一条面");
    expect(r.ok).toBe(true);
    expect(r.label).toContain("不构成这棵树的全量绿");
    expect(r.label).toContain("只看 typecheck 那一条面");
  });

  // 反向钉：把 `ok` 写成恒真（`--skip-test` 又不要理由）时，上面第二条必须红。
  it("空白理由不许被当成『写了理由』（trim 这一步是判据，不是清洁工）", () => {
    expect(certLevel(true, "").ok).toBe(false);
    expect(certLevel(true, "\t\n ").ok).toBe(false);
  });

  // 纯函数钉不住接线（第 118 页的同一课）：这里**真跑一次 CLI** 钉住"脚本确实按 ok 退出 2"。
  // 放在 guard 之后 ⇒ 不建 worktree、不装依赖，秒级。
  it("真跑：`--skip-test` 不带 `--why` ⇒ 脚本 exit 2，且不建 worktree", () => {
    const before = listWorktrees(repoRoot).length;
    const r = spawnSync(process.execPath, ["--import", "tsx", "scripts/head-cert.ts", "--at=HEAD", "--skip-test"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    expect(r.status).toBe(2);
    expect(r.stdout + r.stderr).toContain("--why");
    expect(listWorktrees(repoRoot).length).toBe(before); // 抱怨之前不许先花两分钟建树
  });

  // 反向那一半（"完整认证也被逼着写 --why"）跑不了全量验证（那要建一棵真树），
  // 所以钉最小可疑点：条件必须来自 `flag("skip-test")`，写死 `true` 就等于把这条判据挂到所有人身上。
  it("guard 的输入必须来自命令行，不是写死的 true", () => {
    const src = readFileSync(join(repoRoot, "scripts/head-cert.ts"), "utf8");
    expect(src.includes('certLevel(flag("skip-test"), opt("why", ""))')).toBe(true);
    expect(src.includes("certLevel(true,")).toBe(false);
  });
});
