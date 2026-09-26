/** 锚点表被摘掉的那些行里，**被测面还在 HEAD 里发货**的是哪几条。
 *
 *  起因（现读，不是推测）：`834ba3a` 的提交说明写的是「worker 整支在 Seatbelt 之外」，
 *  但它把 `scripts/mutate-verify.mjs` 的**工作树版本**一起提交了 ⇒ 另一条线上「一次摘 160 条锚点」
 *  的在途改动顺手落库。第 114 页当时判「141 条配得上、19 条的被测面还在发货」，
 *  那个 19 是按**当天**的表算的；本探针按 HEAD 重算，并且把「盘上有」升级成「HEAD 里有人 import」。
 *
 *  三态口径（规则 92/119）：一律问 HEAD，不问盘——盘上的在途删除会被读成永久没了。
 *  取料面 = `git ls-tree -r HEAD` 里 `src|scripts|tests` 下的 .ts/.tsx/.mts。
 *
 *  跑法：`node --import tsx outputs/anchor-loss-shipped-face-2026-09-27/measure-anchor-loss.mts [prevRev]`
 *  （默认 prevRev = 7d82a90，即摘除发生前的最后一笔。） */
import { execFileSync } from "node:child_process";
import { basename, dirname, extname, join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..", "..");
const PREV = process.argv[2] ?? "7d82a90";

/** stderr 必须自己收着：execFileSync 在子进程**失败**时会把它的 stderr 转发到父进程，
 *  于是 `cat-file -e` 那 30 多次「文件不在 HEAD」的正常回答会打成一片 `fatal:` 噪声。
 *  不隔音的话读的人会把「没有这个文件」读成「探针出错了」——本探针恰好就是专门数"没有"的。 */
const git = (args: string[], withErr = false): string =>
  execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    stdio: withErr ? ["ignore", "pipe", "pipe"] : ["ignore", "pipe", "ignore"],
  });

const headTree = (): Map<string, string> => {
  const list = git(["ls-tree", "-r", "--name-only", "HEAD"], true)
    .split("\n")
    .filter((p) => /^(src|scripts|tests)\/.*\.(ts|tsx|mts)$/.test(p));
  const m = new Map<string, string>();
  for (const p of list) {
    try {
      m.set(p, git(["cat-file", "blob", "HEAD:" + p]));
    } catch {
      m.set(p, "");
    }
  }
  return m;
}

const inHead = (rel: string): boolean => {
  try {
    git(["cat-file", "-e", "HEAD:" + rel]);
    return true;
  } catch {
    return false;
  }
};

interface Anchor {
  id: string;
  src: string;
  test: string;
}

/** 锚点行的取法：`id:` 与 `src:`/`test:` 在同一对象里相邻三行（表本体是 mjs，不许 import，只能读文本）。 */
function parseAnchors(table: string): Anchor[] {
  const out: Anchor[] = [];
  const re = /id:\s*"([a-zA-Z0-9_.:-]+)"\s*,\s*\n\s*src:\s*"([^"]+)"(?:[^}]*?)test:\s*"([^"]+)"/g;
  for (const m of table.matchAll(re)) out.push({ id: m[1], src: m[2], test: m[3] });
  return out;
}

/** specifier → 仓内相对路径。TS 里 `./x` 常不带后缀，逐个后缀试；试不出来就返回 null（判"没边"而不是判"边坏了"）。 */
function resolveSpec(fromFile: string, spec: string, files: Map<string, string>): string | null {
  if (!spec.startsWith(".")) return null;
  const base = join(dirname(fromFile), spec);
  const rel = relative(".", base).split(/[\\/]+/).join("/");
  const exts = ["", ".ts", ".tsx", ".mts", ".js", ".mjs", "/index.ts", "/index.tsx"];
  for (const e of exts) {
    const cand = rel + e;
    if (files.has(cand)) return cand;
  }
  return null;
}

/** 谁 import 了 target（只看 HEAD 的 src/scripts/tests；返回引用者列表）。 */
function importersOf(target: string, files: Map<string, string>, self: boolean): string[] {
  const hit: string[] = [];
  const specRe = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;
  for (const [f, text] of files) {
    if (!self && f === target) continue;
    for (const m of text.matchAll(specRe)) {
      if (resolveSpec(f, m[1], files) === target) {
        hit.push(f);
        break;
      }
    }
  }
  return hit;
}

function main(): void {
  if (!inHead("scripts/mutate-verify.mjs")) {
    console.error("⚠️ HEAD 里没有 scripts/mutate-verify.mjs —— 读数无意义");
    process.exitCode = 1;
    return;
  }
  const prevTableRaw = git(["show", PREV + ":scripts/mutate-verify.mjs"]);
  const headTable = git(["show", "HEAD:scripts/mutate-verify.mjs"]);
  const files = headTree();

  const prev = parseAnchors(prevTableRaw);
  const headIds = new Set(parseAnchors(headTable).map((a) => a.id));
  // 表里也有不带 src/test 的行（两半配对锚点等），用 id 全集算总数，别只报解析到的那一子集。
  const idCount = (t: string): number => [...t.matchAll(/^\s{2,6}id:\s*"/gm)].length;

  const removed = prev.filter((a) => !headIds.has(a.id));
  const A: Anchor[] = [];
  const B: Anchor[] = [];
  const C: Anchor[] = [];
  const importedBy = new Map<string, string[]>();
  for (const a of removed) {
    if (!inHead(a.src)) {
      A.push(a);
      continue;
    }
    const imp = importersOf(a.src, files, false);
    importedBy.set(a.id, imp);
    (imp.length > 0 ? B : C).push(a);
  }

  console.log(`prev(${PREV}) 锚点行=`, idCount(prevTableRaw), "｜ HEAD 锚点行=", idCount(headTable));
  console.log(`带 src/test 的 prev 行=`, prev.length, "｜ 被摘=", removed.length);
  console.log(`  A 被测面已不在 HEAD（摘得对） =`, A.length);
  console.log(`  B HEAD 里仍被 import ⇒ 在发货但锚点归零 =`, B.length);
  console.log(`  C 仍在 HEAD 但零 import（该删没删，不是该测没测）=`, C.length);

  console.log("\n--- B：被测面在发货 ---");
  for (const a of B) {
    const testGone = inHead(a.test) ? "判卷还在" : "判卷也没了";
    console.log(`  ${a.id}  src=${a.src} 被 ${importedBy.get(a.id)!.length} 处 import（${testGone}）`);
  }
  console.log("\n--- C：零 import 的 src ---");
  for (const a of C) console.log(`  ${a.id}  src=${a.src}`);

  const doubleGone = B.filter((a) => !inHead(a.test));
  console.log(`\nB 里「被测面活着 + 判卷文件已不在 HEAD」=`, doubleGone.length);
}

main();
