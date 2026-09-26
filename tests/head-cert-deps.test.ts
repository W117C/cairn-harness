/** 认证一棵树之前的那道前置检查（第 84 页：我两次把**环境假红**读成代码红）。
 *  纯函数层：`declaredDeps` / `installedDeps` / `missingDeclaredDeps` / `certLevel`（第 119 页加的等级）。 */
import { spawnSync, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { certLevel, declaredDeps, headGateTableIntegrity, installedDeps, missingDeclaredDeps } from "../scripts/lib/head-cert-deps";

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

/** 第 134 页：认证一棵树时先跑 0.2 秒的 import 面自洽，把「typecheck 必红」的成因印在它前面。
 *  这里钉的是**接线**（同上面 certLevel 那条的形状）：判据本体有自己的 12 条用例与 4 条锚点，
 *  但"head-cert 有没有真的在认证那个 rev 上调它"只有这一条管。 */
describe("认证流程里的 import 面那一行（接线）", () => {
  const src = readFileSync(join(repoRoot, "scripts", "head-cert.ts"), "utf8");

  it("必须问被认证的 rev（TARGET），不是问 HEAD 字面量、也不是问盘", () => {
    expect(src.includes("collectHeadEdges(TARGET)")).toBe(true);
    expect(src.includes('collectHeadEdges("HEAD")')).toBe(false);
    expect(src.includes("collectHeadEdges()")).toBe(false);
  });

  it("取不到时必须出声「未取」，不许把空悬空当成自洽（规则 210 那一族）", () => {
    expect(src.includes("import 面未取")).toBe(true);
    expect(src.includes("不等于 import 面自洽")).toBe(true);
  });

  it("取到**空面**（文件 0 或边 0）与未取同处置：0 条 findings 正好像「自洽」（空载棘轮，规则 129/196）", () => {
    expect(src.includes("importFace.headFiles.size === 0 || importFace.edges.length === 0")).toBe(true);
    expect(src.includes("取到空面")).toBe(true);
  });
});

/** 第 136 页：门表本身在**那一笔**上完不完整。起因是想登记第 24 道门时看清了 HEAD 的门表
 *  ——37 道里 11 道连同名 script 都没有（桌面层的门名还留在表里，script 早被摘走）⇒「整表绿」在那一笔上
 *  不可能成立，而**没有任何观察者**：`gate-check` 拿盘上那份 manifest 比盘上那份 package.json，两边一起漂就一起绿。
 *  我自己还先踩了一次混口径：拿**盘上**已裁剪的 26 条去比 **HEAD** 的 scripts ⇒ 当场读出「一条不缺」。
 *  ⇒ 判据吃**文本**、两头同源，绝不吃 import 进来的活数组。 */
describe("headGateTableIntegrity：门表与 scripts 必须取自同一笔", () => {
  const manifest = (names: readonly string[]): string =>
    `export const GATES: readonly string[] = [\n${names.map((n) => `  "${n}",`).join("\n")}\n];`;
  const pkgWith = (names: readonly string[]): string =>
    JSON.stringify({ scripts: Object.fromEntries(names.map((n) => [n, "node x.ts"])) });

  it("齐的读空、缺的按表序指名", () => {
    const ok = headGateTableIntegrity(manifest(["typecheck", "test"]), pkgWith(["typecheck", "test"]));
    expect(ok).not.toBeNull();
    expect(ok?.gates).toEqual(["typecheck", "test"]);
    expect(ok?.withoutScript).toEqual([]);
    const bad = headGateTableIntegrity(manifest(["typecheck", "ipc:check", "build"]), pkgWith(["typecheck"]));
    expect(bad?.withoutScript).toEqual(["ipc:check", "build"]);
  });

  it("注释里的引号词不算门；真门名带行尾注释要照样收（少一位观察者就是静默失明）", () => {
    const src = [
      "export const GATES: readonly string[] = [",
      '  "typecheck",',
      '  // 这条门管的是 "build" 那一类，别照抄',
      '  "docs-check", // 文档预算（旧注释里写过 "ghost"）',
      "];",
    ].join("\n");
    const got = headGateTableIntegrity(src, pkgWith(["typecheck", "docs-check"]));
    expect(got?.gates).toEqual(["typecheck", "docs-check"]);
    expect(got?.withoutScript).toEqual([]);
  });

  it("三态：任一头没取到 / 数组读不出来 / 坏 JSON ⇒ null（没尺，不许读成「一条不缺」）", () => {
    expect(headGateTableIntegrity(null, pkgWith(["a"]))).toBeNull();
    expect(headGateTableIntegrity(manifest(["a"]), null)).toBeNull();
    expect(headGateTableIntegrity("const NOT_EXPORTED = 1;", pkgWith(["a"]))).toBeNull();
    expect(headGateTableIntegrity(manifest(["a"]), "{ not json")).toBeNull();
  });

  it("排版变了也别说「门表完整」：数组在、里面一条名字都没有 ⇒ 按 null 处置（0 道读起来比红更像绿）", () => {
    const hollowed = "export const GATES: readonly string[] = [\n  // 这一版把门名都写成注释了\n];";
    expect(headGateTableIntegrity(hollowed, pkgWith(["typecheck"]))).toBeNull();
    // 压成一行的排版同样不许冒充「齐的」：要么读得出东西，要么说没取到。
    expect(headGateTableIntegrity('export const GATES = ["typecheck", "test"];', pkgWith(["typecheck", "test"]))).toBeNull();
  });

  it("真表自证：HEAD 那份读得出东西，缺的那一撮必须是门表的子集", () => {
    const atHead = (p: string): string => execFileSync("git", ["show", "HEAD:" + p], { cwd: repoRoot, encoding: "utf8" });
    const got = headGateTableIntegrity(atHead("scripts/gate-manifest.ts"), atHead("package.json"));
    expect(got).not.toBeNull();
    expect(got?.gates).toContain("typecheck");
    expect(got?.gates).toContain("test");
    expect(got!.gates.length).toBeGreaterThan(20);
    for (const g of got!.withoutScript) expect(got!.gates).toContain(g);
  });
});

describe("认证流程里的门表那一行（接线）", () => {
  const src = readFileSync(join(repoRoot, "scripts", "head-cert.ts"), "utf8");

  it("两头都取自被认证的那一笔：绝不许 import 盘上那份活数组", () => {
    expect(src.includes("headGateTableIntegrity(gateSrc.status === 0 ? gateSrc.out : null, pkgText.out)")).toBe(true);
    expect(src.includes('run(MAIN, "git", ["show", TARGET + ":scripts/gate-manifest.ts"])')).toBe(true);
    expect(src.includes('from "./gate-manifest"')).toBe(false);
  });

  it("取不到时出声「门表未取」，不等于门表完整", () => {
    expect(src.includes("门表未取")).toBe(true);
    expect(src.includes("不等于门表完整")).toBe(true);
  });
});
