// 文档分层预算门（spec §6 的 D-1/D-3/D-5；spec 在
// docs/superpowers/specs/2026-09-19-doc-layer-budget-design.md）。
//
// 判据一律写成**纯函数**（本仓纪律：门禁判据要可测、可断言，且 BSD grep 的 `\b \s \|`
// 会静默返空，故不走 shell）。真实文件读取与 git 解析只在 main() 里发生。
//
// 已登记进 GATES。开门之日仓里已存在的存量违规逐条记在 LEGACY_WAIVERS 并写明理由（条数不抄进注释——
// 水位**只准调低**，不再被命中的条目会报成 stale 红，故豁免不会静默烂在这儿）。

export interface Finding {
  rule: "D-1" | "D-2" | "D-3" | "D-4" | "D-5" | "D-7" | "D-8" | "W";
  file: string;
  detail: string;
  /** 该判据的实测量纲值（D-1 = 字节，D-7 = 文件数）。有值时水位按"量"豁免；无值时按"条数"豁免。 */
  value?: number;
}

export interface DocFile {
  path: string;
  bytes: number;
}

export interface SourceFile {
  path: string;
  text: string;
}

/** D-1 预算：单一落点、**只准下调不准调高**（棘轮）。放宽属一次裁决，须立案。 */
export const DOC_BUDGETS: Readonly<Record<string, number>> = {
  "AGENTS.md": 8_000,
  "STATE.md": 6_000,
};

/** D-5 校验的对象文件（档案层无 rev 概念，不进这条判据）。 */
export const STATE_FILE = "STATE.md";

/** D-1：现行层字节预算。红必须带实测值——只说"超了"没法修。 */
export function checkBudget(files: readonly DocFile[], limits: Readonly<Record<string, number>> = DOC_BUDGETS): Finding[] {
  const out: Finding[] = [];
  for (const f of files) {
    const limit = limits[f.path];
    if (limit === undefined) continue; // 不在受管表内（archive/ 等）→ 不判
    if (f.bytes > limit) {
      out.push({
        rule: "D-1",
        file: f.path,
        value: f.bytes,
        detail: `实测 ${f.bytes}B > 预算 ${limit}B——瘦法只有「把结论迁进 archive」，不是放宽预算`,
      });
    } else if (f.bytes === 0) {
      out.push({ rule: "D-1", file: f.path, value: 0, detail: `实测 0B——空壳不是合规` });
    }
  }
  return out;
}

/** D-3：文档指针必须用标签锚点，不能用行号（重排即静默打断，且没有门会知道）。 */
const LINE_CITATION = /[\w./#-]+\.(?:md|markdown):[0-9]+/g;

/**
 * 行级豁免：`docs-check:allow <理由>`，**必须与命中同行且必须写理由**。
 * 有这条逃生舱，才没人去拆字符串绕判据（本仓 theme.ts 的 DARK_QUERY 拆行躲 grep 是已归档反面样例）。
 */
const ALLOW_MARK = /docs-check:allow[ \t]*(.*)$/;

export function checkLineCitations(sources: readonly SourceFile[]): Finding[] {
  const out: Finding[] = [];
  for (const s of sources) {
    const lines = s.text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const cites = [...line.matchAll(LINE_CITATION)];
      if (cites.length === 0) continue;
      const reason = ALLOW_MARK.exec(line)?.[1]?.trim() ?? "";
      if (reason !== "") continue;
      for (const c of cites) {
        out.push({
          rule: "D-3",
          file: s.path,
          detail: `第 ${String(i + 1)} 行 文档指针 ${c[0]} 用了行号——改成 ${c[0].replace(/:[0-9]+$/, "")}#<标签>` +
            `（行号会随重排漂掉）；确需保留则同行写 docs-check:allow <理由>`,
        });
      }
    }
  }
  return out;
}

/** rev 行：`rev: <7~40 位十六进制>`，允许反引号包裹与行尾空白。 */
const STATE_REV = /^\s*rev:\s*`?([0-9a-fA-F]{7,40})`?\s*$/m;
const ANY_REV = /^\s*rev:.*$/m;

/**
 * D-5：STATE.md 的 rev 必须是个真提交。
 * `shaExists` 注入成谓词（main() 交给自己跑 git 的实现）——纯函数不碰子进程，
 * 否则这条判据无法在单测里双向断言。
 */
export function checkStateRev(text: string, shaExists: (sha: string) => boolean): Finding[] {
  const m = STATE_REV.exec(text);
  if (!m) {
    const raw = ANY_REV.exec(text);
    const detail = raw
      ? `rev 行形状非法：${raw[0].trim()}（需 7~40 位十六进制 sha）`
      : "缺 rev 行——STATE.md 首部必须写 `rev: <sha>`";
    return [{ rule: "D-5", file: STATE_FILE, detail }];
  }
  const sha = m[1]!.toLowerCase();
  if (!shaExists(sha)) return [{ rule: "D-5", file: STATE_FILE, detail: `rev 指向不存在的提交：${sha}` }];
  return [];
}

/* ------------------------------------------------------------------ D-2 / D-4 / D-7 */

/** D-2 与 D-4 的适用面 = 被现行层指向的页。**按可达性定，不按"重不重要"定。** */
export const LIVE_PAGES: readonly string[] = [
  "AGENTS.md",
  STATE_FILE,
  "docs/README.md",
  "docs/CODE-WIKI.md",
  // core-only 迁移（2026-09-24）删掉了 `docs/ui-fact-baseline.md` ⇒ 条目同轮撤掉：
  // 留着的唯一效果是门每轮印一行「该页不存在⇒未受检」的假未检，把 4 项噪声当读数。
  // 该页若回归，条目与它的 [spec]/观测值纪律同轮补回。
];

/** 规格值免检：带比较符/预算字样的行是契约；`[spec]` / `[facts]` 是显式标记。 */
const SPEC_CONTEXT = /[≤≥<>]|\[spec\]|\[facts\]|上限|下限|阈值|至少|不超过|不得超过|不低于|预算/;
const OBSERVED_QUANTITY = /[0-9]+(?:[.,][0-9]+)?[ \t]*(?:ms\b|s\b|秒|分钟|KB\b|MB\b|k?tokens?\b)/i;

/**
 * D-2：现行层不许手抄观测值。判据刻意**不看**"实测/耗时"这类字样——真病灶那句
 * "~800s 的 test 门" 一个字都没带，按字样匹配会漏掉它（本仓实测漂了 13 倍）。
 */
export function checkObservedValues(pages: readonly SourceFile[]): Finding[] {
  const out: Finding[] = [];
  for (const p of pages) {
    if (!LIVE_PAGES.includes(p.path)) continue; // archive/、dated specs/、源码不受这条管
    const lines = p.text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (SPEC_CONTEXT.test(line)) continue;
      const m = OBSERVED_QUANTITY.exec(line);
      if (!m) continue;
      out.push({
        rule: "D-2",
        file: p.path,
        detail: `第 ${String(i + 1)} 行 手抄了观测值「${m[0].trim()}」——它会随宿主与负载漂；写「见 pnpm facts」指针，` +
          `确是规格值则同行标 [spec]`,
      });
    }
  }
  return out;
}

/** D-4：现行层禁"用追注代替改写"——那正是让文档永不收缩、真相要顺读全文的机制。 */
const APPEND_CORRECTION = /上面那句|已过期|不(?:再)?表示当前值|当日快照|改写即伪造|上一句|旧的?那句|追注/;

export function checkAppendOnlyCorrections(pages: readonly SourceFile[]): Finding[] {
  const out: Finding[] = [];
  for (const p of pages) {
    if (!LIVE_PAGES.includes(p.path)) continue; // 档案层就是这类字的归宿
    const lines = p.text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const m = APPEND_CORRECTION.exec(lines[i]!);
      if (!m) continue;
      out.push({
        rule: "D-4",
        file: p.path,
        detail: `第 ${String(i + 1)} 行 出现追注「${m[0]}」——现态页只整体重写，过期字随写消失（${STATE_FILE} 不是历史）；` +
          `要留当时的判断就挪进 archive/ 对应里程碑段`,
      });
    }
  }
  return out;
}

const DOC_BINARY = /^docs\/.*\.(?:png|jpe?g|gif|webp|tiff|bmp)$/i;

/** D-7：docs/ 不留二进制——图片会不会被读到取决于有没有人开多模态，预算不该由它决定。 */
export function checkDocBinaries(files: readonly string[]): Finding[] {
  const hits = files.filter((f) => DOC_BINARY.test(f));
  if (hits.length === 0) return [];
  return [{
    rule: "D-7",
    file: "docs",
    value: hits.length,
    detail: `docs/ 下残留 ${String(hits.length)} 个图片——证据图落 outputs/，历史图走 archive/；` +
      `现况与理由见 docs/README.md`,
  }];
}

/* ------------------------------------------------------------------ D-8 复跑面可信赖 */

/** D-8 的扫描面 = 这些页里的 `.md` 正文。**面之外的复跑命令不受本判据管**（说清范围，别让读者以为全仓都守）。 */
export const REPLAY_DOC_FILES: readonly string[] = ["AGENTS.md", "PROGRESS.md", "STATE.md"];

/**
 * D-8：自称「可直接粘贴复跑」的东西必须有源、必须真在盘上。
 * 病灶实测（2026-09-23）：文档里的 heredoc `node --import tsx -e` 永不过编译，产品侧一次形状变更
 * （`planBlocked: boolean` → `() => boolean`）就让那句复跑变成 TypeError，且没有门知道。
 * 四条判据各挑一格：① 引用了没登记的 `replay:<id>`（无源）；② 登记了没文档引用（陈旧登记）；
 * ③ 登记项指向的脚本不在盘上（改名/删文件忘撤表）；④ 仍有内联 heredoc 复跑块（须搬成脚本或立案豁免）。
 * 取料一律从**真实文档文本**扫（不读登记表自陈），否则未登记项会静默漏在机制外。
 */
export function checkReplay(
  docs: readonly SourceFile[],
  scriptExists: (rel: string) => boolean,
  registered: readonly ReplayReading[] = REPLAY_READINGS,
): Finding[] {
  const refs = docs.map((d) => ({ file: d.path, ids: [...d.text.matchAll(REPLAY_REF)].map((m) => m[1]!) }));
  const inline = docs.map((d) => ({ file: d.path, count: countInlineReplay(d.text) }));
  const gaps = replayGapsOf({ registered, missingScripts: registered.filter((r) => !scriptExists(r.script)).map((r) => r.script), refs, inline });
  const out: Finding[] = [];
  for (const r of refs) {
    for (const id of r.ids) {
      if (gaps.unregisteredRefs.includes(id)) {
        out.push({ rule: "D-8", file: r.file, detail: `引用 replay:${id} 但登记表里没有这一项——先把复跑脚本建出来并登记进 scripts/replay-readings.ts` });
      }
    }
  }
  for (const id of gaps.unreferencedIds) {
    out.push({ rule: "D-8", file: registered.find((r) => r.id === id)?.script ?? id, detail: `登记项 replay:${id} 没有任何文档引用——要么写进那页，要么删表项（登记表不许烂在这儿）` });
  }
  for (const s of gaps.missingScripts) {
    out.push({ rule: "D-8", file: s, detail: `登记项指向的复跑脚本不在盘上——文档里那句「可粘贴复跑」此刻是死的` });
  }
  for (const file of gaps.inlineBlocks) {
    const count = inline.find((i) => i.file === file)?.count ?? 0;
    out.push({ rule: "D-8", file, detail: `内联 heredoc 复跑块 ${String(count)} 处：它不过编译，形状一 drift 就静默失效 ⇒ 搬进 scripts/replay/*.ts 并登记，或在 LEGACY_WAIVERS 立案写明理由` });
  }
  return out;
}

/* ------------------------------------------------------------------ 存量豁免棘轮 */

export interface Waiver {
  /** 水位：带 value 的判据（D-1）= 允许的实测量；无 value 的判据（D-3）= 允许的命中条数。 */
  upTo: number;
  /** 必填理由——豁免本身可审计，空白即无效。 */
  reason: string;
}

export const waiverKey = (rule: Finding["rule"], file: string): string => rule + "|" + file;

/**
 * 本门登记进 GATES 之日（2026-09-19）已存在的违规，逐条带理由。
 * **只准调低、迁移提交（spec §8）整条删除**；一旦某条目不再被命中，waive() 会把它
 * 报成 stale 红——豁免不许静默烂在这儿。
 */
export const LEGACY_WAIVERS: Readonly<Record<string, Waiver>> = {};

/** 用存量水位筛掉老账，并挑出已不再被命中的豁免条目。 */
export function waive(
  findings: readonly Finding[],
  waivers: Readonly<Record<string, Waiver>> = LEGACY_WAIVERS,
): { kept: Finding[]; stale: string[] } {
  const byKey = new Map<string, Finding[]>();
  for (const f of findings) {
    const k = waiverKey(f.rule, f.file);
    const list = byKey.get(k);
    if (list) list.push(f);
    else byKey.set(k, [f]);
  }

  const kept: Finding[] = [];
  for (const [k, list] of byKey) {
    const wa = waivers[k];
    if (!wa || wa.reason.trim() === "") {
      kept.push(...list);
      continue;
    }
    if (list[0]!.value === undefined) {
      // 无量纲的判据：水位是**条数**，超出部分逐条留红并标出水位。
      list.forEach((f, i) => {
        if (i >= wa.upTo) kept.push({ ...f, detail: `超出存量豁免（第 ${String(i + 1)} 处 > 水位 ${String(wa.upTo)}）：${f.detail}` });
      });
      continue;
    }
    // 量纲判据：实测 ≤ 水位才豁免。空壳（0B）永不豁免——水位豁免的是存量违规的量，不是免死金牌。
    for (const f of list) {
      const v = f.value ?? 0;
      if (v === 0 || v > wa.upTo) kept.push({ ...f, detail: `${f.detail}；存量水位 ${String(wa.upTo)}（超出即新增违规）` });
    }
  }

  const stale: string[] = [];
  for (const k of Object.keys(waivers)) {
    if ((byKey.get(k) ?? []).length === 0) stale.push(k);
  }
  return { kept, stale };
}

/* ------------------------------------------------------------------ main() 之外，以上是纯判据 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { REPLAY_READINGS, REPLAY_REF, countInlineReplay, replayGapsOf, type ReplayReading } from "./replay-readings";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** D-3 的扫描面：只有代码里的文档指针会漂，故只走这三棵树。 */
const CITATION_DIRS = ["src", "scripts", "tests"];
const CODE_EXT = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
const SKIP_DIRS = new Set(["node_modules", ".git", ".worktrees", ".tmp", ".codegraph", ".pi", ".mimosa", "out", "dist"]);

/** 递归列出待扫源文件（跳过软链与非普通文件，防 socket 之类把门炸掉）。 */
export function listSourceFiles(root: string, dirs: readonly string[] = CITATION_DIRS): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // 目录不存在（如 tests/ 被裁）→ 该支为空，不判红
    }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue;
        walk(join(dir, e.name));
      } else if (e.isFile() && CODE_EXT.test(e.name)) {
        out.push(join(dir, e.name));
      }
    }
  };
  for (const d of dirs) walk(join(root, d));
  return out.sort();
}

/** 递归列出某棵子树里匹配的图片文件（返回相对路径，供 D-7 计数）。 */
export function listImagesUnder(root: string, sub: string): string[] {
  const out: string[] = [];
  const walk = (abs: string, rel: string) => {
    let entries;
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      const a = join(abs, e.name);
      const r = rel === "" ? e.name : rel + "/" + e.name;
      if (e.isDirectory()) walk(a, r);
      else if (e.isFile() && DOC_BINARY.test(r)) out.push(r);
    }
  };
  walk(join(root, sub), sub);
  return out.sort();
}

/** D-8 的取料：`docs/` 下递归所有 `.md` + REPLAY_DOC_FILES 里真实存在的根页。跳过软链，防 socket 之类把门炸掉。 */
export function listMarkdownDocs(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      const a = join(dir, e.name);
      const r = rel === "" ? e.name : rel + "/" + e.name;
      if (e.isDirectory()) walk(a, r);
      else if (e.isFile() && /\.md$/i.test(e.name)) out.push(r);
    }
  };
  walk(join(root, "docs"), "docs");
  for (const f of REPLAY_DOC_FILES) if (existsSync(join(root, f))) out.push(f);
  return out.sort();
}

function shaExistsViaGit(sha: string): boolean {
  try {
    execFileSync("git", ["rev-parse", "--verify", "--quiet", sha + "^{commit}"], { cwd: ROOT, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export function runDocsCheck(): { findings: Finding[]; skipped: string[]; waived: number } {
  const findings: Finding[] = [];
  const skipped: string[] = [];

  const budgetFiles: DocFile[] = [];
  for (const path of Object.keys(DOC_BUDGETS)) {
    const abs = join(ROOT, path);
    if (existsSync(abs)) budgetFiles.push({ path, bytes: statSync(abs).size });
    else skipped.push(`D-1 ${path} 不存在（迁移前属正常）——该文件未受检，不等于通过`);
  }
  findings.push(...checkBudget(budgetFiles));

  const sources: SourceFile[] = listSourceFiles(ROOT).map((abs) => ({
    path: relative(ROOT, abs).split("\\").join("/"),
    text: readFileSync(abs, "utf8"),
  }));
  findings.push(...checkLineCitations(sources));

  const stateAbs = join(ROOT, STATE_FILE);
  if (existsSync(stateAbs)) findings.push(...checkStateRev(readFileSync(stateAbs, "utf8"), shaExistsViaGit));
  else skipped.push(`D-5 ${STATE_FILE} 不存在（迁移前属正常）——rev 真伪未检，不等于通过`);

  const livePages: SourceFile[] = [];
  for (const path of LIVE_PAGES) {
    const abs = join(ROOT, path);
    if (existsSync(abs)) livePages.push({ path, text: readFileSync(abs, "utf8") });
    else skipped.push(`D-2/D-4 ${path} 不存在（迁移前属正常）——该页未受检，不等于通过`);
  }
  findings.push(...checkObservedValues(livePages));
  findings.push(...checkAppendOnlyCorrections(livePages));
  findings.push(...checkDocBinaries(listImagesUnder(ROOT, "docs")));

  // D-8：复跑面可信赖。扫描面为空 ⇒ 记未检，不记通过（"读到 0 即绿"是这类门的通病）。
  const replayDocs: SourceFile[] = listMarkdownDocs(ROOT).map((rel) => ({ path: rel, text: readFileSync(join(ROOT, rel), "utf8") }));
  if (replayDocs.length === 0) skipped.push("D-8 扫描面为空（docs/ 与根页里没找到 .md）——复跑面未受检，不等于通过");
  else findings.push(...checkReplay(replayDocs, (rel) => existsSync(join(ROOT, rel))));

  const { kept, stale } = waive(findings);
  return {
    findings: [
      ...kept,
      ...stale.map((k) => ({ rule: "W" as const, file: k, detail: "存量豁免条目已不再被命中——从 LEGACY_WAIVERS 删掉它（豁免不许静默留着）" })),
    ],
    skipped,
    waived: findings.length - kept.length,
  };
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;

if (invokedDirectly) {
  const { findings, skipped, waived } = runDocsCheck();
  const byRule = new Map<string, number>();
  for (const f of findings) {
    byRule.set(f.rule, (byRule.get(f.rule) ?? 0) + 1);
    console.log(`  ❌ ${f.rule} ${f.file}\n     ${f.detail}`);
  }
  for (const s of skipped) console.log("  ℹ️  跳过 " + s);
  if (waived > 0) console.log(`  ⚠️  存量豁免 ${String(waived)} 处（LEGACY_WAIVERS，只准调低；spec §8 迁移提交须整条删除）`);
  const summary = [...byRule].map(([r, n]) => `${r}=${String(n)}`).join(" ");
  if (findings.length === 0) {
    console.log(`docs-check: 受检项全绿${skipped.length ? "（另有 " + String(skipped.length) + " 项未检，见上）" : ""}`);
    if (skipped.length > 0) console.log("UNVERIFIED=" + String(skipped.length));
    process.exit(0);
  }
  console.log(`docs-check: ❌ ${String(findings.length)} 项违规 ${summary}（预算常量在本文件 DOC_BUDGETS，只准下调）`);
  process.exit(1);
}
