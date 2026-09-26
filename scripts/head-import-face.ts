/** HEAD 的 import 面自洽检查：**只问 HEAD，不问盘**，也不需要第二棵认证树。
 *
 * 立尺的实测（2026-09-27，第 131 页）：`cb70297`「产品面：把 core-only 的内核接成一条真能用的 m0 命令」
 * 把**消费者**提交了、把它新建的模块留下了未跟踪状态 ⇒ HEAD 里 5 个相对模块悬空
 * （`src/main/{provider-runtime,run-request,run-attachments}.ts`、`src/providers/capabilities.ts`
 * ＋ `glm-session` 少一个 `SessionTransport` 导出），干净树 `head-cert` 跑出
 * **typecheck 8 条错、vitest 34 个判卷文件红**，而**主树同一时刻 236 files / 2701 tests 全绿**。
 * ⇒ 这是「HEAD 红着而主树绿」那一族最贵的一次：主树的判卷永远看不见它，
 * 而唯一能看见的手段（认证树整跑）要 69 秒。
 *
 * 本尺把这 69 秒压成 ~1 秒，且**不需要工作树**：
 * 取料 = `git ls-tree -r HEAD` ＋ `git grep <HEAD>` 直接读提交对象 ⇒ 别人在盘上的未提交改动
 * 不可能把这条红盖掉（那正是上面那次事故的成因）。
 *
 * 三态（规则 92/119）：悬空模块**盘上有** ＝「漏 `git add`」；盘上也没有 ＝「表写错路径或模块被删而引用没跟着改」。
 * 两者后果不同（前者补一笔就好，后者要找删它的提交），所以分开印、分开豁免。 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const FACES = ["src", "scripts", "tests"] as const;

const git = (args: readonly string[]): string | null => {
  try {
    return execFileSync("git", [...args], {
      cwd: ROOT, encoding: "utf8", maxBuffer: 128 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
};

/** TS 里 `./x` 常不带后缀；`/index.ts` 也算一种落点。 */
const EXT_CANDIDATES = ["", ".ts", ".tsx", ".mts", ".js", ".mjs", "/index.ts", "/index.tsx"] as const;

/** 而 `./x.js` 这种 ESM 写法指向的其实是 `x.ts`。
 *  第一版只做"加后缀"不做"换后缀" ⇒ `src/tools/index.ts` 那批 `.js` 写法全被判成悬空（47 条假红里的一大族）。 */
const SUFFIX_SWAP: readonly [string, readonly string[]][] = [
  [".js", [".ts", ".tsx", ".mts"]],
  [".mjs", [".mts", ".ts"]],
];

/** specifier → 仓内相对路径。非相对（裸包名）返回 null：本尺只管仓内边。 */
export function resolveRelativeSpec(fromFile: string, spec: string, headFiles: ReadonlySet<string>): string | null {
  if (!spec.startsWith(".")) return null;
  const rel = relative(".", join(dirname(fromFile), spec)).split(/[\\/]+/).join("/");
  for (const e of EXT_CANDIDATES) if (headFiles.has(rel + e)) return rel + e;
  for (const [from, to] of SUFFIX_SWAP) {
    if (!rel.endsWith(from)) continue;
    const stem = rel.slice(0, -from.length);
    for (const e of to) if (headFiles.has(stem + e)) return stem + e;
  }
  return rel + ".ts"; // 都没命中：给出最可能的形状，交给"盘上有没有"分诊
}

export interface DanglingImport {
  /** 解析后应当存在、但 HEAD 里没有的那个路径（相对仓根）。 */
  target: string;
  /** 引用它的文件（HEAD 里的相对路径），最多留 3 个够定位。 */
  importers: string[];
  /** 盘上有没有（＝是不是"漏 add"这一类）。 */
  onDisk: boolean;
}

/** 纯判据：喂 HEAD 的文件表 ＋ 从 `git grep` 抽出的 (文件, specifier) 边 ⇒ 悬空边。
 *  `existsOnDisk` 注入 ⇒ 单测能造两态。 */
export function findDanglingImports(
  edges: readonly { from: string; spec: string }[],
  headFiles: ReadonlySet<string>,
  existsOnDisk: (rel: string) => boolean,
): DanglingImport[] {
  const byTarget = new Map<string, string[]>();
  for (const e of edges) {
    const t = resolveRelativeSpec(e.from, e.spec, headFiles);
    if (t === null || headFiles.has(t) || e.from === t) continue;
    byTarget.set(t, [...(byTarget.get(t) ?? []), e.from]);
  }
  return [...byTarget.entries()]
    .map(([target, importers]) => ({ target, importers: [...new Set(importers)].slice(0, 3), onDisk: existsOnDisk(target) }))
    .sort((a, b) => b.importers.length - a.importers.length || a.target.localeCompare(b.target));
}

/** 存量豁免（**只准带理由**；不再悬空即 stale 红）。形状照 `docs-check` 的 `LEGACY_WAIVERS`。 */
export const HEAD_DANGLING_WAIVERS: Readonly<Record<string, string>> = {
  "src/main/provider-runtime.ts": "第 131 页：`cb70297` 提交了消费者没提交新文件；等作者补 add（盘上有）",
  "src/main/run-request.ts": "第 131 页：同上（盘上有）",
  "src/main/run-attachments.ts": "第 131 页：同上（盘上有）",
  "src/providers/capabilities.ts": "第 131 页：同上（盘上有）",
};

export interface HeadImportFinding {
  kind: "dangling" | "stale-waiver";
  target: string;
  detail: string;
}

/** 出 finding（不出声）：名单外的悬空即红；名单里不再命中的也要红（不许静默烂着）。 */
export function checkHeadImportFace(
  dangling: readonly DanglingImport[],
  waivers: Readonly<Record<string, string>> = HEAD_DANGLING_WAIVERS,
): HeadImportFinding[] {
  const out: HeadImportFinding[] = [];
  const hit = new Set<string>();
  for (const d of dangling) {
    if (waivers[d.target] !== undefined) { hit.add(d.target); continue; }
    out.push({
      kind: "dangling",
      target: d.target,
      detail: `HEAD 里 ${d.importers.join("、")} import 了它，而它不在 HEAD ⇒ `
        + (d.onDisk ? "**漏 `git add`**（盘上有但未入库）" : "**盘上也没有**（引用写错，或模块被删而引用没跟着改）"),
    });
  }
  for (const t of Object.keys(waivers)) {
    if (!hit.has(t)) out.push({ kind: "stale-waiver", target: t, detail: `已不再悬空 ⇒ 从 HEAD_DANGLING_WAIVERS 删掉（${waivers[t]}）` });
  }
  return out;
}

/** 只认"这行本身就是一条 import/export"的形状。
 *  第二版没这一道 ⇒ 判卷里那些假源码字符串（`const fake = 'import { a } from "./todo";'`）被当成真边，
 *  凭空多出十几条悬空（与第 125 页 `from "…"` 一律当 import 那族假阳性同一个病）。
 *  代价：写在多行模板字面量**开头**的假 import 仍会漏进来 ⇒ 靠豁免表逐条带理由收口。 */
const IMPORT_LINE = /^\s*(?:import|export)\b|=\s*(?:await\s+)?import\(|\brequire\(/;

/** 真取料：一次 `git ls-tree` ＋ 一次 `git grep`（读提交对象，不碰工作区）。
 *  `at` 可指到任意 rev ⇒ 能拿"事故当时那一笔"自证这把尺咬得住（见 `--at` 用法）。 */
export function collectHeadEdges(at: string = "HEAD"): { headFiles: Set<string>; edges: { from: string; spec: string }[] } | null {
  const listed = git(["ls-tree", "-r", "--name-only", at]);
  if (listed === null) return null;
  const headFiles = new Set(listed.split("\n").filter((p) => /^(src|scripts|tests)\/.*\.(ts|tsx|mts)$/.test(p)));
  const grepped = git(["grep", "-I", "-n", "-E", "(from|import)[[:space:]]*\\(?[\"'][^\"']+[\"']", at, "--", ...FACES]);
  if (grepped === null) return null;
  const prefix = at + ":";
  const edges: { from: string; spec: string }[] = [];
  for (const line of grepped.split("\n")) {
    if (!line.startsWith(prefix)) continue;
    const m = /^([^:]+):(\d+):(.*)$/.exec(line.slice(prefix.length));
    if (m === null) continue;
    const from = m[1]!;
    if (!headFiles.has(from) || !IMPORT_LINE.test(m[3]!)) continue;
    for (const s of m[3]!.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) edges.push({ from, spec: s[1]! });
  }
  return { headFiles, edges };
}

/** 用法：`node --import tsx scripts/head-import-face.ts [--at=<rev>] [--no-waivers]`
 *   · `--at=cb70297` 拿事故当时那一笔自证；`--no-waivers` 把存量也印出来（只看，不判）。 */
function main(): void {
  const arg = (name: string, dflt: string): string => {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
    return hit === undefined ? dflt : hit.slice(name.length + 3);
  };
  const at = arg("at", "HEAD");
  const waivers = process.argv.includes("--no-waivers") ? {} : HEAD_DANGLING_WAIVERS;
  const got = collectHeadEdges(at);
  if (got === null) {
    console.error("head-import-face：git 取不到 " + at + " ⇒ 没尺，不判（exit 2）");
    process.exit(2);
  }
  const dangling = findDanglingImports(got.edges, got.headFiles, (rel) => existsSync(join(ROOT, rel)));
  const findings = checkHeadImportFace(dangling, waivers);
  const waived = dangling.filter((d) => waivers[d.target] !== undefined);
  console.log(`head-import-face（${at}）：文件 ${String(got.headFiles.size)} 个｜import 边 ${String(got.edges.length)} 条`
    + `｜悬空 ${String(dangling.length)}（已豁免 ${String(waived.length)}）`);
  for (const f of findings) console.log(`  ❌ ${f.kind} ${f.target} — ${f.detail}`);
  if (findings.length === 0) { console.log("head-import-face: ✅ import 面自洽（或在内存量已逐条带理由）"); return; }
  console.log(`head-import-face: ❌ ${String(findings.length)} 项（豁免表在本文件 HEAD_DANGLING_WAIVERS，只准带理由登记）`);
  process.exit(1);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) main();
