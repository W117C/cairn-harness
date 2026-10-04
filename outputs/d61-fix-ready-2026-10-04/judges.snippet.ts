// 建议新增的判卷（vitest 风格）——整段粘进 `tests/docs-check.test.ts` 末尾即可（本目录不落 tests/）。
//
// 基线：HEAD＝`58a29ffa`；`scripts/docs-check.ts` 工作树 blob＝`1439c2cc`（本轮 `git hash-object` 现取）。
// 配套的两份草案：`head-cert-dated-dir.patch`（#61① 正则截断）与 `ledger-seam.patch`（#61② 分页盲区）。
// **先打补丁再粘判卷**：`PAGE_HEAD_RE` 是补丁引入的导出，没打补丁时这个文件连 import 都过不了——
// 那不是判卷写坏了，是两态里「修之前必红」的那一态。
//
// 硬要求＝**两态各红一次**（规则 242/237：合成输入要显式两态不同形；只钉一种，将来换形状又成盲区）：
//   ⑴ 分页点：h2 页与 h3 页各钉一条（第 350 页现读：尺只认 `^### ` ⇒ 台账从第 308 页起几十页被并进「第 307 页」）；
//   ⑵ 证人形状：`<rev>-<date>-<HHMM>` 全名与普通 `outputs/<主题>-<date>/` 各钉一条（第 349 页那条 D-11 假红）；
//   ⑶ 一条「A 臂必须逐字复现门的读数」型哨兵（第 351 页第 3 条：探针不复现被度量方 ⇒ 全部差值作废）。
//
// ⚠️ 落库时要配变异锚点（本仓纪律：判卷与锚点同笔）。两枚既有针脚这一笔**不用复认**：
//   `cred-dir-date-pattern-month-locked` 的 `apply` 字面量 `[A-Za-z0-9._-]+-\d{4}-\d{2}-\d{2}` 在补丁后仍是文件里
//   第一处命中（新加的 `(?:-\d{4})?` 排在它后面）；`witness-face-narrowed-back-to-credential-pages` 咬的是调用点
//   `witnessPages = ledgerPages(ledgerText, ANY_PAGE_HEAD);`，两份补丁都没碰那一行。
//   真正欠的是**新锚点**：把 `PAGE_HEAD_RE` 改回 `/^### /u`、把 `(?:-\d{4})?` 摘掉，都必须有针脚咬住（#50 的债）。

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ANY_PAGE_HEAD,
  checkCredentialSources,
  checkWitnessPaths,
  CRED_UNNAMED_PAGE_CAP,
  CRED_WEAK_WITNESS_CAP,
  credentialPages,
  credFaceFiles,
  ledgerPages,
  ledgerWitnessRefs,
  PAGE_HEAD_RE,
  runDocsCheck,
  trackedFilesAtHead,
  UNSOURCED_CRED_PAGES,
  UNSOURCED_READINGS,
} from "../scripts/docs-check";

const REPO = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const ledgerText = (): string => readFileSync(join(REPO, "PROGRESS.md"), "utf8");

/* ── ⑴ 分页点：h2 页与 h3 页各钉一条 ───────────────────────────────────────
   合成页用台账的真实两态：`## 2026-09-30 · 第 N 页 …`（第 308 页起）与 `### …`（308 页以前）。
   两种坏法各对应一条：只钉 h3 ⇒ 页标题再换一级又没人响；只钉 h2 ⇒ 把 h3 缝收窄也没人响。 */
describe("分页点谓词 PAGE_HEAD_RE：h2 页与 h3 页各钉一条（#61②，第 350 页）", () => {
  const h3Page = (n: number, body: string): string => `### 2026-09-30 · 第 ${String(n)} 页 凭证：标题\n\n${body}\n`;
  const h2Page = (n: number, body: string): string => `## 2026-09-30 · 第 ${String(n)} 页 凭证：标题\n\n${body}\n`;

  it("h3 两页 ⇒ 两条页，各带各的证人（这一格是既有口径，收窄掉就红在这里）", () => {
    const pages = ledgerPages(h3Page(900, "原件 outputs/h3a-2026-09-30/a.log") + h3Page(901, "原件 outputs/h3b-2026-09-30/b.log"), ANY_PAGE_HEAD);
    expect(pages.map((p) => p.key)).toEqual(["第 900 页", "第 901 页"]);
    expect(pages.map((p) => p.refs)).toEqual([["outputs/h3a-2026-09-30/a.log"], ["outputs/h3b-2026-09-30/b.log"]]);
  });

  it("h2 两页 ⇒ 两条页（从前只认 `^### ` 时它们整段落进别人的体里，key 还是上一条 h3 的）", () => {
    const pages = ledgerPages(h2Page(902, "原件 outputs/h2a-2026-09-30/a.log") + h2Page(903, "原件 outputs/h2b-2026-09-30/b.log"), ANY_PAGE_HEAD);
    expect(pages.map((p) => p.key)).toEqual(["第 902 页", "第 903 页"]);
    expect(pages.map((p) => p.refs)).toEqual([["outputs/h2a-2026-09-30/a.log"], ["outputs/h2b-2026-09-30/b.log"]]);
    // 标题剥标记跟着认 2～3 级：`title` 进 D-9 的红话术，留着 `## ` 就是给读者看 markdown 记号
    expect(pages.every((p) => !p.title.startsWith("#"))).toBe(true);
  });

  it("跨页顶包那一格：h2 页点名的证人要红在 h2 页自己头上，不许被邻页的分母吃掉", () => {
    const text = h2Page(960, "原件 outputs/h2only-2026-09-30/a.log") + h3Page(961, "原件 outputs/h3only-2026-09-30/b.log");
    const w = checkWitnessPaths(ledgerPages(text, ANY_PAGE_HEAD), new Set<string>(), []);
    expect(w.findings.length).toBe(2);
    expect(w.refs).toBe(2);
    // 合并态这两条会一起写成同一个 key——第 349 页我写的「原件在 …」被报成「第 307 页 点名」就是这个形状
    expect(w.findings.map((f) => /第 \d+ 页/u.exec(f.detail)?.[0])).toEqual(["第 960 页", "第 961 页"]);
  });

  it("真仓哨兵：h2 那两千多行必须各自成页，第 350 页点名的证人要挂在「第 350 页」头上", () => {
    const pages = ledgerPages(ledgerText(), ANY_PAGE_HEAD);
    const mine = pages.filter((p) => p.key === "第 350 页");
    expect(mine.length, "台账第 350 页要独立成段").toBeGreaterThan(0);
    expect(
      mine.some((p) => p.refs.some((r) => r.includes("d11-page-seam-2026-10-04"))),
      "本页自己点名的证人必须算在本页头上（合并态它们整片挂在「第 307 页」身上）",
    ).toBe(true);
    // 伪页那一格：合并态「第 307 页」一条挂 118 条 refs（本轮现读），逐页化之后只剩它自己的两条
    for (const p of pages.filter((x) => x.key === "第 307 页")) {
      expect(p.refs.length, `第 307 页又在替别人挂账：${String(p.refs.length)} 条`).toBeLessThanOrEqual(2);
    }
  });

  it("接线：切页与剥标记都吃 `PAGE_HEAD_RE` 这一份，源文件里第二份 `/^### /u` 字面量不许回来", () => {
    const src = readFileSync(join(REPO, "scripts", "docs-check.ts"), "utf8");
    expect(/\.filter\(\(\[l\]\) => PAGE_HEAD_RE\.test\(l\)\)/u.test(src), "分页点没收成一份谓词").toBe(true);
    expect((src.match(/\/\^### \//gu) ?? []).length, "同一形状写两遍＝两个会各自漂的决策点（规则 348）").toBe(0);
    // 谓词自己两态：h2 **页标题**算缝，台账开头那些普通 `## ` 章节标题不算（`## 任务清单` 不是一页）
    expect(PAGE_HEAD_RE.test("## 2026-10-03 · 第 308 页：正文")).toBe(true);
    expect(PAGE_HEAD_RE.test("## 任务清单（全部完成）")).toBe(false);
    expect(PAGE_HEAD_RE.test("### 2026-09-30 · 第 307 页补 凭证（1/1）")).toBe(true);
  });
});

/* ── ⑵ 证人形状：`<rev>-<date>-<HHMM>` 与普通 dated 目录各钉一条 ────────────
   坏法（第 349 页现读）：`DATED_DIR_RE` 的捕获止于日期且**没有右边界** ⇒ 贪婪回溯把时刻四位留在捕获外，
   `ledgerWitnessRefs` 见后续字符不是 `/` 就走「目录点名」那一支 ⇒ ref＝截断名＋`/`＝一个从来没存在过的目录，
   而这形状偏偏是 `scripts/head-cert.ts` 自己产出的（`head-cert-<rev7>-<YYYY-MM-DD>-<HHMM>`）。 */
describe("dated 证人取料面：head-cert 的 `-HHMM` 目录名不许被截断（#61①，第 349/350 页）", () => {
  const FULL = "outputs/head-cert-55ce164-2026-10-04-0402/provenance.md";

  it("两种形状各钉一条：普通 `outputs/<主题>-<date>/` 与 `head-cert-<rev>-<date>-<HHMM>`", () => {
    // ① 既有形状（这一笔不许把它改坏）
    expect(ledgerWitnessRefs("取料：`outputs/topic-2026-09-30/a.log`，另一页裸目录 `outputs/topic-2026-10-01/`")).toEqual([
      "outputs/topic-2026-09-30/a.log",
      "outputs/topic-2026-10-01/",
    ]);
    // ② 认证原件那一格：全名必须完整进分母（旧尺在这一条红：它交回 `outputs/head-cert-55ce164-2026-10-04/`）
    expect(ledgerWitnessRefs(`原件在 \`${FULL}\``)).toEqual([FULL]);
    // ③ 第三态：没有时刻的普通形状照旧——`-HHMM` 是**可选**，不是新增必填段
    expect(ledgerWitnessRefs("原件在 `outputs/head-cert-55ce164-2026-10-04/provenance.md`")).toEqual([
      "outputs/head-cert-55ce164-2026-10-04/provenance.md",
    ]);
  });

  it("分组号不许漂：时刻那组必须是非捕获 `(?:…)`——写成捕获组的话 `m[2]` 成了 `0402`、文件名整段错位", () => {
    expect(ledgerWitnessRefs("见 `outputs/head-cert-55ce164-2026-10-04-0402/`（裸目录点名）")).toEqual([
      "outputs/head-cert-55ce164-2026-10-04-0402/",
    ]);
    expect(ledgerWitnessRefs(`见 \`${FULL}\``)).toEqual([FULL]);
    const src = readFileSync(join(REPO, "scripts", "docs-check.ts"), "utf8");
    // 派生关系还在（`WITNESS_REF` 从 `DATED_DIR_RE.source` 派生＝不在那里第二次写日期），不许改成第二份手抄实现
    expect(src.includes("new RegExp(DATED_DIR_RE.source"), "派生关系被改成手抄第二份实现").toBe(true);
  });

  it("D-9 那一半同一个形状：目录名完整 ⇒ 读数进「可比对」；被截断 ⇒ 退成「取不到」而红数照旧 0（假绿形状）", () => {
    const page = "### 2026-10-04 · 第 999 页 凭证：标题\n\n本趟墙钟 257.32s｜原件 " + FULL + "\n";
    const pages = credentialPages(page);
    expect(pages[0]?.dirs).toEqual(["head-cert-55ce164-2026-10-04-0402"]);
    const face = (dir: string) => (dir === "head-cert-55ce164-2026-10-04-0402" ? [{ name: "provenance.md", text: "本趟墙钟 257.32s" }] : null);
    const ok = checkCredentialSources(pages, face, {}, 0, 0, {});
    expect(ok.checked).toBe(1);
    expect(ok.unmatched).toBe(0);
    expect(ok.findings).toEqual([]);
    // 反向（正控，规则 242）：面上只有**截断名**那一格时，读数不许被算成已回查——它进「取不到」那一档
    const truncatedOnly = (dir: string) => (dir === "head-cert-55ce164-2026-10-04" ? [{ name: "x.log", text: "本趟墙钟 257.32s" }] : null);
    expect(checkCredentialSources(pages, truncatedOnly, {}, 0, 0, {}).unmatched).toBe(1);
  });

  it("D-11 两态：清单里是全名 ⇒ 0 红；清单里只有截断目录的邻居 ⇒ 恰好红一条（断言不是恒真）", () => {
    const pages = credentialPages("### 2026-10-04 · 第 999 页 凭证：标题\n\n原件 " + FULL + "\n");
    expect(checkWitnessPaths(pages, new Set([FULL]), []).findings).toEqual([]);
    const wrongFace = checkWitnessPaths(pages, new Set(["outputs/head-cert-55ce164-2026-10-04/provenance.md"]), []);
    expect(wrongFace.refs).toBe(1);
    expect(wrongFace.findings.length).toBe(1);
    expect(wrongFace.findings[0]?.detail).toContain(FULL);
  });
});

/* ── ⑶ A 臂哨兵：复刻被度量方的那一臂，第一件事是复现被度量方的读数 ─────────
   第 351 页第 3 条的实录：第一版三臂探针没立这条哨兵，`dirs` 抽法写错 ⇒ **同一个 A 臂**自报红 65，
   而门在同一份文本上报红 0。是「A 必须等于门」把那 65 判成**探针缺陷**，而不是「台账今天真有 65 条红」。
   ⇒ 本仓纪律：任何「另跑一臂」的判卷/探针，取料面与登记表都要**从尺 import**（不是抄字面量、不是抄口径描述），
     然后逐项等值断言；不相等就作废全部差值。 */
describe("A 臂哨兵：独立重跑的凭证对账面与证人点名面必须逐字等于门自己印的读数", () => {
  it("门（`runDocsCheck`）↔ 臂（`credentialPages`／`ledgerPages` ＋ 构造器）：D-9 八项、D-11 三项全部相等", () => {
    const face = runDocsCheck();
    const tracked = trackedFilesAtHead();
    expect(tracked, "取不到 HEAD 清单 ⇒ 未检，这一趟不构成读数").not.toBeNull();
    const text = ledgerText();
    const arm = checkCredentialSources(
      credentialPages(text),
      (dir) => credFaceFiles(REPO, dir),
      UNSOURCED_READINGS,
      CRED_UNNAMED_PAGE_CAP,
      CRED_WEAK_WITNESS_CAP,
      UNSOURCED_CRED_PAGES,
    );
    expect(arm.checked, "可比对读数：臂 ≠ 门").toBe(face.cred.checked);
    expect(arm.findings.length, "D-9 红数：臂 ≠ 门").toBe(face.cred.findings.length);
    expect(arm.unnamed).toBe(face.cred.unnamed);
    expect([...arm.unnamedPages].sort()).toEqual([...face.cred.unnamedPages].sort());
    expect([...arm.registeredPages].sort()).toEqual([...face.cred.registeredPages].sort());
    expect(arm.registeredReadings).toBe(face.cred.registeredReadings);
    expect(arm.unmatched).toBe(face.cred.unmatched);
    expect(arm.weak.length).toBe(face.cred.weak.length);
    expect(arm.weakUnjudged).toBe(face.cred.weakUnjudged);
    // D-11 同一口径（分面宽度由调用点决定，所以臂这里也要吃 `ANY_PAGE_HEAD`）
    const w = checkWitnessPaths(ledgerPages(text, ANY_PAGE_HEAD), tracked as Set<string>);
    expect(w.refs, "证人点名条数：臂 ≠ 门").toBe(face.witness?.refs);
    expect(w.pages, "点名页数：臂 ≠ 门").toBe(face.witness?.pages);
    expect(w.findings.length).toBe(face.witness?.findings.length);
  });
});
