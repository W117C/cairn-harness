/* `fixtures/bench/README.md` ↔ 磁盘靶子的配平判卷（能力 10：把「文档说的条数」与「盘上真条数」钉成一把尺）。
 *
 * 为什么要这把尺（2026-10-04 现读）：README 末笔是 `0553b057`（2026-10-01），落后两笔／3 天，而它**不在任何门眼里**——
 * `scripts/docs-check.ts` 的文档面只吃 `docs/**` ＋三份根文件＋`src|scripts|tests/`，**不含 `fixtures/**`**。
 * 于是「为什么是 12 条」这类框架句和三条已入库的长任务靶子（`bench-long-horizon-30`／`bench-long-chain-32`／
 * `bench-long-chain-48`，入库于 `f6619891`、`0f8438df`）可以各错各的、没人喊：README 里那格一个字都没有，
 * 分类表还写着「4（B1 / B4 / B5）」（声明 4 只列 3）与「12 条里的 4/4/4/1」（加总 13）。
 * 补这个门盲区最便宜的方式就是这一把：只读盘、只读文本——不联网、不跑真模型、不碰 `outputs/` 里会漂的读数。
 *
 * 另一侧的真缺陷本轮**只登记不修**（`package.json` 与 `scripts/loop-eval.ts` 都在别的会话手里）：
 * `package.json:52` 的 `bench` 写死 `--tasks fixtures/bench/tasks.json`，而 `scripts/loop-eval.ts:60-63` 的
 * `pick()` 取**首个** `--tasks` ⇒ 命令行追加无效，三份长任务清单在全仓没有任何消费者。
 * 那条只写进 README 的「诚实标注」；这把尺判的是**语料↔文档**配平，不判跑器接线（免得替别人手里那两支抢先定性）。
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// ── PURE-BEGIN（负控与「订正前会红」的证人脚本按 PURE-BEGIN／PURE-END 两行标记原样抽出下面这些纯函数，
//    逐字复用同一把尺；这段里不许出现 vitest／fs／process，否则抽出去就跑不动）─────────────────────────

/** 一份 `tasks*.json` 的原文 → 里面点名的靶子目录名（`seed.path` 的最后一段）。坏 JSON 直接抛，不静默给空集。 */
export function seedDirsFromTaskFileText(text: string): string[] {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error("清单顶层不是数组");
  const out: string[] = [];
  for (const t of parsed) {
    const path = (t as { seed?: { path?: unknown } })?.seed?.path;
    if (typeof path !== "string" || path === "") throw new Error("任务缺 seed.path");
    out.push(path.split("/").filter((x) => x !== "").pop()!);
  }
  return out;
}

/** 同一份原文 → 任务 id 列表（配平按目录名，语料条数与 id 全集按这里）。 */
export function taskIdsFromTaskFileText(text: string): string[] {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error("清单顶层不是数组");
  return parsed.map((t) => {
    const id = (t as { id?: unknown })?.id;
    if (typeof id !== "string" || id === "") throw new Error("任务缺 id");
    return id;
  });
}

/** readdir 的输出 → 靶子目录名集合（`bench-*`）；清单文件名另算一支，两者都从同一次列目录里取。 */
export function seedDirsFromListing(entries: string[]): string[] {
  return entries.filter((e) => /^bench-[a-z0-9._-]+$/u.test(e)).sort();
}

/** readdir 的输出 → 任务清单文件名集合（`tasks*.json`）。新增一份清单就自动进配平，不必改这把尺。 */
export function manifestFilesFromListing(entries: string[]): string[] {
  return entries.filter((e) => /^tasks.*\.json$/u.test(e)).sort();
}

/** 方向一：盘上有、清单里没人引用 ⇒ 孤儿靶子（跑了没人收的死数据）。 */
export function orphanTargets(dirs: string[], referenced: string[]): string[] {
  const ref = new Set(referenced);
  return dirs.filter((d) => !ref.has(d));
}

/** 方向二：清单指了、盘上没有 ⇒ 悬空引用（跑到一半 ENOENT，或靶子被删而清单没跟着改）。 */
export function danglingRefs(dirs: string[], referenced: string[]): string[] {
  const onDisk = new Set(dirs);
  return referenced.filter((d) => !onDisk.has(d));
}

export interface TableRowBlock {
  header: string[];
  rows: string[][];
}

/** 取标题匹配 `headingRe` 的那节里的第一张 markdown 表；表头＝分隔行上面那行，数据行＝下面那些。 */
export function tableUnder(readme: string, headingRe: RegExp): TableRowBlock | null {
  const lines = readme.split(/\r?\n/u);
  const start = lines.findIndex((l) => /^#{2,6}\s/u.test(l) && headingRe.test(l));
  if (start < 0) return null;
  const cellsOf = (line: string): string[] =>
    line.replace(/^\|/u, "").replace(/\|$/u, "").split("|").map((c) => c.trim());
  let header: string[] | null = null;
  const rows: string[][] = [];
  let seenSeparator = false;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (/^[-:\s|]+$/u.test(line) && line.includes("|")) {
      seenSeparator = true;
      continue;
    }
    if (line.startsWith("|")) {
      if (seenSeparator) rows.push(cellsOf(line));
      else header = cellsOf(line);
      continue;
    }
    if (seenSeparator && line.trim() !== "") break; // 表已结束（后面的正文／下一节）
  }
  if (header === null && rows.length === 0) return null;
  return { header: header ?? [], rows };
}

/** 逐条表的数据行数（第一格是反引号 id 才算一行，表头与分隔行天然不算）。 */
export function perTaskRowCount(readme: string): number {
  return perTaskTableRows(readme).length;
}

export function perTaskTableRows(readme: string): string[][] {
  const t = tableUnder(readme, /逐条/u);
  if (t === null) throw new Error("README 里找不到「逐条」那张表");
  return t.rows.filter((r) => /^`[^`]+`$/u.test(r[0] ?? ""));
}

/** 逐条表第一格 → id（去掉反引号）。 */
export function tableIds(readme: string): string[] {
  return perTaskTableRows(readme).map((r) => (r[0] ?? "").replace(/`/gu, ""));
}

/** 逐条表第二格 → 种子目录名（文档里把靶子名抄错也算悬空，这里取出来给调用方比盘）。 */
export function tableSeedDirs(readme: string): string[] {
  return perTaskTableRows(readme).map((r) => (r[1] ?? "").replace(/`/gu, ""));
}

export interface CategoryRow {
  label: string;
  declared: number | null;
  ids: string[];
  raw: string;
}

/** 分类表第二列「3（B1 / B4 / B5）」→ 声明条数 ＋ 点名的 id；没点名 ⇒ ids 为空（订正前的病根之一）。 */
export function categoryRows(readme: string): CategoryRow[] {
  const t = tableUnder(readme, /为什么是/u);
  if (t === null) throw new Error("README 里找不到「为什么是」那张分类表");
  return t.rows.map((r) => {
    const raw = r[1] ?? "";
    const m = /^(\d+)\s*[（(]([^）)]*)[）)]/u.exec(raw);
    if (m !== null) {
      return {
        label: r[0] ?? "",
        declared: Number(m[1]),
        ids: (m[2] ?? "").split("/").map((x) => x.trim()).filter((x) => x !== ""),
        raw,
      };
    }
    const bare = /^(\d+)$/u.exec(raw);
    return { label: r[0] ?? "", declared: bare === null ? null : Number(bare[1]), ids: [], raw };
  });
}

/** 「声明 4 个却只列 3 个」这一格：声明数必须等于括号里点名的 id 个数。 */
export function declaredVsListed(rows: CategoryRow[]): string[] {
  const bad: string[] = [];
  for (const r of rows) {
    if (r.declared === null) {
      bad.push(`${String(r.label)}：条数列读不出数字（原文「${r.raw}」）`);
      continue;
    }
    if (r.ids.length === 0) bad.push(`${String(r.label)}：声明 ${String(r.declared)} 条却没点名是哪几条`);
    else if (r.ids.length !== r.declared) {
      bad.push(`${String(r.label)}：声明 ${String(r.declared)} 个却只列了 ${String(r.ids.length)} 个（${r.ids.join(" / ")}）`);
    }
  }
  return bad;
}

/** 各行声明数加总必须等于磁盘条数（订正前的另一格：4+4+4+1=13，而句子写着 12）。 */
export function declaredSum(rows: CategoryRow[], total: number): string | null {
  if (rows.some((r) => r.declared === null)) return "分类表有读不出数字的行";
  const sum = rows.reduce((acc, r) => acc + (r.declared ?? 0), 0);
  return sum === total ? null : `分类表条数加总 ${String(sum)} ≠ 磁盘 ${String(total)} 条`;
}

/** 分类表点名的 id（前缀，如 `B1`／`L30`）与清单 id 前缀全集双向配平。 */
export function categoryVsManifests(rows: CategoryRow[], taskIds: string[]): { extra: string[]; missing: string[] } {
  const prefix = (id: string): string => id.split("-")[0] ?? id;
  const listed = new Set(rows.flatMap((r) => r.ids.map(prefix)));
  const declared = new Set(taskIds.map(prefix));
  return {
    extra: [...listed].filter((x) => !declared.has(x)).sort(),
    missing: [...declared].filter((x) => !listed.has(x)).sort(),
  };
}

/** 带日期的实测行（`2026-10-01`）是**历史读数**，不作当前条数断言 ⇒ 豁免。这是这把尺的已知缺口：
 *  写个假日期就能绕过，靠上面三条等式（行数／加总／id 全集）兜住，不靠这里。 */
const DATED_READING = /20\d{2}-\d{2}-\d{2}/u;

/** 「框架句」的位置词：这些词后面紧跟的「N 条」说的就是**语料总条数**，必须等于磁盘目录数。 */
const FRAMING = /(?:为什么是|每轮|全套|整套|一轮|全部|这|共|合计|总计)\s*\*{0,2}\s*$/u;

/**
 * README 里的「N 条」类具体条数，分两档比磁盘读数：
 * ① 标题行／框架句里的 ⇒ 断的是**语料总数**，必须等于 `corpusCount`（过期 3 天留下的就是这一格：
 *    「为什么是 12 条」「12 条逐条」，而盘上 15 条）；
 * ② 其余位置的 ⇒ 只要落在磁盘条数集合里即可（语料总数 ∪ 每份清单各自的条数；
 *    两份数字都由调用方现读盘喂进来，这里不硬编码 12／15）。
 * ③ 带日期的实测行豁免（历史读数，见上）。
 */
export function staleCountClaims(readme: string, corpusCount: number, perManifestCounts: number[]): string[] {
  const allowed = new Set([corpusCount, ...perManifestCounts]);
  const out: string[] = [];
  const lines = readme.split(/\r?\n/u);
  for (const [i, line] of lines.entries()) {
    if (DATED_READING.test(line)) continue;
    const isHeading = /^#{1,6}\s/u.test(line);
    for (const m of line.matchAll(/(\d+)\s*条/gu)) {
      const n = Number(m[1]);
      const framed = isHeading || FRAMING.test(line.slice(0, m.index));
      if (framed ? n !== corpusCount : !allowed.has(n)) {
        out.push(`第 ${String(i + 1)} 行「${m[0]}」与磁盘条数不符（${framed ? "框架句，断的是语料总数" : "正文条数"}；盘上读数：${String(corpusCount)} 条语料／清单各 ${[...allowed].sort((a, b) => a - b).join("／")}）：${line.trim().slice(0, 48)}`);
      }
    }
  }
  return out;
}

/** 四份清单的文件名都要在 README 里点名（订正前漏的就是这一格：新清单入库、文档只字未提）。 */
export function undocumentedManifests(manifestFiles: string[], readme: string): string[] {
  return manifestFiles.filter((f) => !readme.includes(f));
}

// ── PURE-END ──────────────────────────────────────────────────────────────────────────────

const BENCH_URL = new URL("../fixtures/bench/", import.meta.url);
const readBench = (name: string): string => readFileSync(fileURLToPath(new URL(name, BENCH_URL)), "utf8");

// 现读盘：一次列目录同时给出靶子集合与清单集合（谁都不是硬编码进来的那份清单）。
const listing = readdirSync(fileURLToPath(BENCH_URL));
const diskDirs = seedDirsFromListing(listing);
const manifestFiles = manifestFilesFromListing(listing);
const manifestTaskCounts = manifestFiles.map((f) => seedDirsFromTaskFileText(readBench(f)).length);
const allSeedRefs = manifestFiles.flatMap((f) => seedDirsFromTaskFileText(readBench(f)));
const allTaskIds = manifestFiles.flatMap((f) => taskIdsFromTaskFileText(readBench(f)));
const corpusCount = allTaskIds.length;
const readme = readBench("README.md");

describe("目录 ↔ 清单双向配平（现读 fixtures/bench）", () => {
  it("清单集合与靶子集合都非空，且条数对得上（空集会让双向配平恒真）", () => {
    expect(diskDirs.length, `磁盘靶子数：${String(diskDirs.length)}`).toBeGreaterThan(0);
    expect(manifestFiles.length, `清单份数：${manifestFiles.join("／")}`).toBeGreaterThanOrEqual(1);
    expect(corpusCount).toBe(allSeedRefs.length);
    expect(new Set(allSeedRefs).size).toBe(allSeedRefs.length);
  });

  it("方向一·无孤儿：盘上每个 bench-* 靶子都被某份清单引用", () => {
    expect(orphanTargets(diskDirs, allSeedRefs), "盘上有靶子没进任何清单 ⇒ 跑不到的死数据").toEqual([]);
  });

  it("方向二·无悬空：清单引用的靶子都在盘上", () => {
    expect(danglingRefs(diskDirs, allSeedRefs), "清单指向盘上没有的靶子 ⇒ 跑到一半 ENOENT").toEqual([]);
  });

  it("两支合流：两个集合相等 ⇒ 目录数＝清单总条数（把现读数字留在报错里）", () => {
    expect([...diskDirs].sort(), "靶子目录集合").toEqual([...new Set(allSeedRefs)].sort());
    expect(diskDirs.length, `目录 ${String(diskDirs.length)} ↔ 清单 ${String(corpusCount)}`).toBe(corpusCount);
  });

  it("每份清单各自非空（被清空的清单会让总条数悄悄变小而双向配平照绿）", () => {
    for (const [i, f] of manifestFiles.entries()) {
      expect(manifestTaskCounts[i], `清单 ${f} 读出 0 条`).toBeGreaterThan(0);
    }
  });
});

describe("README 那张逐条表：行数＝清单总条数，id 与种子一字不差", () => {
  it(`行数 ${String(perTaskRowCount(readme))} 等于清单总条数 ${String(corpusCount)}`, () => {
    expect(perTaskRowCount(readme)).toBe(corpusCount);
  });

  it("表里的 id 两个方向都配平（表里多出来的／清单里有而表里漏的）", () => {
    const inTable = new Set(tableIds(readme));
    const declared = new Set(allTaskIds);
    const missing = [...declared].filter((x) => !inTable.has(x)).sort();
    const extra = [...inTable].filter((x) => !declared.has(x)).sort();
    expect(missing, "清单里有、表里没写（订正前漏的正是那三条长任务靶子）").toEqual([]);
    expect(extra, "表里有、清单里根本没有 ⇒ 文档编了一条不存在的任务").toEqual([]);
  });

  it("表里的种子目录名都在盘上（文档把靶子名抄错＝同一种悬空）", () => {
    const onDisk = new Set(diskDirs);
    expect(tableSeedDirs(readme).filter((d) => !onDisk.has(d))).toEqual([]);
  });

  it("四份清单的文件名都在 README 里点名（新增清单却不写文档这条要出声）", () => {
    expect(undocumentedManifests(manifestFiles, readme)).toEqual([]);
  });
});

describe("分类表自洽（订正前错在两处：声明 4 只列 3／4+4+4+1=13≠12）", () => {
  const rows = categoryRows(readme);

  it("每一行的「条数」等于它括号里点名的 id 个数", () => {
    expect(declaredVsListed(rows), "分类表：声明数与点名数不一致").toEqual([]);
  });

  it("各行条数加总等于磁盘总条数", () => {
    expect(declaredSum(rows, corpusCount)).toBeNull();
  });

  it("各行点名的 id 并集与清单双向配平", () => {
    const v = categoryVsManifests(rows, allTaskIds);
    expect(v.missing, "分类表漏了清单里的靶子").toEqual([]);
    expect(v.extra, "分类表点名了清单里不存在的东西").toEqual([]);
  });
});

describe("README 不许留与磁盘不符的「N 条」", () => {
  it(`现读：磁盘语料 ${String(corpusCount)} 条，清单各 ${manifestTaskCounts.join("／")} 条 ⇒ README 的「N 条」都要落在这份读数里`, () => {
    expect(staleCountClaims(readme, corpusCount, manifestTaskCounts), "README 有过期的具体条数").toEqual([]);
  });

  it("框架句那一档判的是语料总数，不是清单条数（订正前的病：盘上 15 条而标题写 12 条）", () => {
    expect(corpusCount).toBeGreaterThan(Math.max(...manifestTaskCounts));
    expect(staleCountClaims("## 为什么是 12 条、四类", corpusCount, manifestTaskCounts)).toHaveLength(1);
  });
});

/* 负控：这把尺要先证明自己有分辨力——每个等式各打一遍「故意错一个」的合成副本，确认它真的会红，
 * 并同时给一个「改对了的副本照旧绿」的反向证人（否则红可能是解析器坏了，不是文档错了）。
 * 合成副本**由数据数组现生成**，不用 `.replace()` 打补丁：上一版就是这么把两支负控打空的——
 * 替换目标恰好是数组最后一行（没有尾随换行）⇒ `replace` 静默不命中，"删一行"却没少读数，
 * 而另一支把没在文本里点过的清单名当成"已点名"来删 ⇒ 它判的从来不是那条等式。
 * 合成输入全在内存与 `mkdtemp`（工作区外）；仓内真文件一个字节都不动。 */
describe("负控：合成副本上的每条等式都会红", () => {
  interface SynthRow { id: string; dir: string; state: string }
  interface SynthCat { label: string; declared: number; ids: string[] }

  const SYN_ROWS: SynthRow[] = [
    { id: "B1-bugfix-crossfile", dir: "bench-bugfix-crossfile", state: "3 / 2 / 1" },
    { id: "B2-feature-export", dir: "bench-feature-export", state: "1 / 0 / 1" },
    { id: "L30-long-horizon", dir: "bench-long-horizon-30", state: "30 / 0 / 30" },
    { id: "L32-long-chain", dir: "bench-long-chain-32", state: "1 / 0 / 1" },
  ];
  const SYN_CATS: SynthCat[] = [
    { label: "bug 修复", declared: 1, ids: ["B1"] },
    { label: "加功能", declared: 1, ids: ["B2"] },
    { label: "长任务", declared: 2, ids: ["L30", "L32"] },
  ];
  const SYN_MANIFESTS = ["tasks.json", "tasks-long30.json"];
  const SYN_TOTAL = SYN_ROWS.length; // 4 条，全部由上面这份数据现生成，不硬编码第二份
  const SYN_IDS = SYN_ROWS.map((r) => r.id);
  const SYN_DIRS = SYN_ROWS.map((r) => r.dir);
  // 两份合成清单各 2 条 ⇒ 喂给 staleCountClaims 的「清单条数」集合是 [2, 2]（同样不硬编码 12／15）
  const SYN_MANIFEST_COUNTS = [SYN_TOTAL / 2, SYN_TOTAL / 2];

  /** 生成一份**自洽**的合成 README；每个负控只动下面四个入参里的一个维度。 */
  function synthReadme(
    rows: SynthRow[] = SYN_ROWS,
    cats: SynthCat[] = SYN_CATS,
    corpusWord = `${String(SYN_TOTAL)} 条`,
    manifestNames: string[] = SYN_MANIFESTS,
  ): string {
    return [
      `## 为什么是 ${corpusWord}、三类`,
      "",
      "| 类别 | 条数 | 考什么 |",
      "|---|---|---|",
      ...cats.map((c) => `| ${c.label} | ${String(c.declared)}（${c.ids.join(" / ")}） | x |`),
      "",
      `## ${corpusWord}逐条`,
      "",
      "| id | 种子（`seed.path`） | 种子态 | 靶心 |",
      "|---|---|---|---|",
      ...rows.map((r) => `| \`${r.id}\` | \`${r.dir}\` | ${r.state} | x |`),
      "",
      `清单：${manifestNames.join("／")}。`,
      "",
    ].join("\n");
  }

  /** 一把尺的自洽副本上，所有等式都必须**闭嘴**（这就是"解析器不是恒红"的证人）。 */
  function everyEquationSilent(text: string, corpusCount: number, taskIds: string[]): string[] {
    const cats = categoryRows(text);
    return [
      ...declaredVsListed(cats),
      ...(declaredSum(cats, corpusCount) === null ? [] : [String(declaredSum(cats, corpusCount))]),
      ...(() => {
        const v = categoryVsManifests(cats, taskIds);
        return [...v.extra, ...v.missing];
      })(),
      ...staleCountClaims(text, corpusCount, SYN_MANIFEST_COUNTS),
      ...undocumentedManifests(SYN_MANIFESTS, text),
    ];
  }

  it("正向证人：自洽的合成副本让每条等式都闭嘴（解析器不是恒红）", () => {
    const whole = synthReadme();
    expect(categoryRows(whole)).toHaveLength(3);
    expect(perTaskRowCount(whole)).toBe(SYN_TOTAL);
    expect(tableIds(whole)).toEqual(SYN_IDS);
    expect(tableSeedDirs(whole)).toEqual(SYN_DIRS);
    expect(everyEquationSilent(whole, SYN_TOTAL, SYN_IDS)).toEqual([]);
  });

  it("负控一·表行数写错：合成副本少一行 ⇒ 行数当场与总条数分家，且缺的是谁被点名", () => {
    const dropped = synthReadme(SYN_ROWS.slice(0, SYN_TOTAL - 1));
    expect(perTaskRowCount(synthReadme())).toBe(SYN_TOTAL);
    expect(perTaskRowCount(dropped)).toBe(SYN_TOTAL - 1);
    expect(perTaskRowCount(dropped) === SYN_TOTAL, "删掉一行却没少读数 ⇒ 这条解析是假尺").toBe(false);
    // 同一份删行副本上，id 双向配平那一支也点名缺了谁（两个方向各查一次）
    const inTable = new Set(tableIds(dropped));
    expect(SYN_IDS.filter((x) => !inTable.has(x))).toEqual(["L32-long-chain"]);
    expect([...inTable].filter((x) => !SYN_IDS.includes(x))).toEqual([]);
    // 反向证人：删掉的那一行补回去 ⇒ 读数与等式一起回到闭嘴（不是恒红）
    const healed = synthReadme(SYN_ROWS.slice(0, SYN_TOTAL - 1).concat([SYN_ROWS[SYN_TOTAL - 1]!]));
    expect(perTaskRowCount(healed)).toBe(SYN_TOTAL);
    expect(everyEquationSilent(healed, SYN_TOTAL, SYN_IDS)).toEqual([]);
  });

  it("负控二·「N 条」过期：框架句抄回旧条数 ⇒ 只有框架句那一支出声", () => {
    const stale = synthReadme(SYN_ROWS, SYN_CATS, `${String(SYN_TOTAL - 1)} 条`);
    const hits = staleCountClaims(stale, SYN_TOTAL, SYN_MANIFEST_COUNTS);
    expect(hits).toHaveLength(2); // 两处框架句：「为什么是…」＋「…逐条」标题
    for (const h of hits) expect(h).toContain("框架句");
    expect(staleCountClaims(synthReadme(), SYN_TOTAL, SYN_MANIFEST_COUNTS)).toEqual([]);
    // 磁盘读数换档，尺必须跟着换档（同一句文本、不同分母 ⇒ 结论相反，免得尺钉的是写死的 15）
    expect(staleCountClaims(stale, SYN_TOTAL - 1, SYN_MANIFEST_COUNTS)).toEqual([]);
    // 豁免只留给带日期的实测行；同一句不带日期就必须红（免得豁免成后门）
    expect(staleCountClaims(`实测（2026-10-01）：那批 ${String(SYN_TOTAL - 1)} 条里 5 条改过判卷面`, SYN_TOTAL, [])).toEqual([]);
    expect(staleCountClaims(`那批 ${String(SYN_TOTAL - 1)} 条里 5 条改过判卷面`, SYN_TOTAL, [])).toHaveLength(2);
  });

  it("负控三·「声明 4 只列 3」：点名数与声明数分家 ⇒ 那一支出声，加总支同向出声", () => {
    // HEAD 的第 22 行形状：长任务声明的个数比它括号里点名的多一个
    const underListed = synthReadme(SYN_ROWS, SYN_CATS.map((c) => (c.label === "长任务" ? { ...c, declared: c.ids.length + 1 } : c)));
    const cats = categoryRows(underListed);
    const bad = declaredVsListed(cats);
    expect(bad).toHaveLength(1);
    expect(String(bad[0])).toContain("长任务");
    expect(declaredVsListed(categoryRows(synthReadme()))).toEqual([]);
    // 加总那一支读到的分母也跟着虚高（1+1+3=5 ≠ 4）——两支都咬得住，但不是同一句话
    expect(String(declaredSum(cats, SYN_TOTAL))).toContain("加总 5");
  });

  it("负控四·加总与 id 全集：长任务整行退回 1（L30） ⇒ 点名支闭嘴、加总支与 id 支各红一次", () => {
    // HEAD 的第 25／27 行形状：那一类只写 1（B12），三条新靶子在文档里一个字没有
    const shrunk = synthReadme(SYN_ROWS, SYN_CATS.map((c) => (c.label === "长任务" ? { label: c.label, declared: 1, ids: ["L30"] } : c)));
    const cats = categoryRows(shrunk);
    expect(declaredVsListed(cats)).toEqual([]); // 声明 1、点名 1 ⇒ 这一支不该误报（分辨力：只咬加总与缺名）
    expect(String(declaredSum(cats, SYN_TOTAL))).toContain("加总 3");
    expect(categoryVsManifests(cats, SYN_IDS).missing).toEqual(["L32"]);
    expect(categoryVsManifests(cats, SYN_IDS).extra).toEqual([]);
    // 反向证人：分母换成 3（真把 L32 从语料里删掉那种改动）⇒ 加总支闭嘴，只剩 id 支还出声
    expect(declaredSum(cats, 3)).toBeNull();
    expect(categoryVsManifests(cats, SYN_IDS.filter((x) => x !== "L32-long-chain")).missing).toEqual([]);
    expect(declaredSum(categoryRows(synthReadme()), SYN_TOTAL)).toBeNull();
  });

  /* 负控五～负控七：把「少一个目录／多一条任务」这类副本**落成盘**（mkdtemp，工作区外），
   * 再用真仓那同一条流水线读回来——三档各只动一个维度，另外两维必须闭嘴，
   * 免得某一支恒红替别人报错。真仓一个字节都不动，跑完即 rmSync。 */
  interface SynthTask { id: string; dir: string }
  const SYN_TASKS: Record<string, SynthTask[]> = {
    "tasks.json": [
      { id: SYN_IDS[0]!, dir: SYN_DIRS[0]! },
      { id: SYN_IDS[1]!, dir: SYN_DIRS[1]! },
    ],
    "tasks-long30.json": [
      { id: SYN_IDS[2]!, dir: SYN_DIRS[2]! },
      { id: SYN_IDS[3]!, dir: SYN_DIRS[3]! },
    ],
  };

  /** 落盘 → 列目录 → 读清单：取料走的是判卷正文同一批纯函数，不在这里另算一遍。 */
  function corpusFrom(root: string, dirs: string[], manifests: Record<string, SynthTask[]>) {
    for (const d of dirs) mkdirSync(join(root, d), { recursive: true });
    for (const [name, tasks] of Object.entries(manifests)) {
      writeFileSync(join(root, name), JSON.stringify(tasks.map((t) => ({ id: t.id, seed: { kind: "dir", path: `fixtures/bench/${t.dir}` }, verifier: { command: "node --test tests/*.test.js" } }))));
    }
    const entries = readdirSync(root);
    const manifestFiles = manifestFilesFromListing(entries);
    const diskDirs = seedDirsFromListing(entries);
    const refs = manifestFiles.flatMap((f) => seedDirsFromTaskFileText(readFileSync(join(root, f), "utf8")));
    const ids = manifestFiles.flatMap((f) => taskIdsFromTaskFileText(readFileSync(join(root, f), "utf8")));
    const counts = manifestFiles.map((f) => seedDirsFromTaskFileText(readFileSync(join(root, f), "utf8")).length);
    return { diskDirs, refs, ids, manifestFiles, counts };
  }

  it("负控五·配平的合成副本（落盘再读回）：三支等式一起闭嘴", () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-bench-parity-ok-"));
    try {
      const c = corpusFrom(root, SYN_DIRS, SYN_TASKS);
      expect(c.diskDirs).toEqual([...SYN_DIRS].sort());
      // 清单读回来的先后是「列目录再排序」的产物，不是这里的不变量 ⇒ 按集合比，不赌顺序
      expect([...c.ids].sort()).toEqual([...SYN_IDS].sort());
      expect(c.counts).toEqual([2, 2]);
      expect(orphanTargets(c.diskDirs, c.refs)).toEqual([]);
      expect(danglingRefs(c.diskDirs, c.refs)).toEqual([]);
      const text = synthReadme(SYN_ROWS, SYN_CATS, `${String(SYN_TOTAL)} 条`, c.manifestFiles);
      expect(perTaskRowCount(text)).toBe(c.ids.length);
      expect(staleCountClaims(text, c.ids.length, c.counts)).toEqual([]);
      expect(undocumentedManifests(c.manifestFiles, text)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("负控六·目录↔清单两个方向：盘上少一个被引用的目录 ⇒ 只有悬空支红；多一个没人引用的目录 ⇒ 只有孤儿支红", () => {
    const rootA = mkdtempSync(join(tmpdir(), "dsh-bench-parity-missing-"));
    const rootB = mkdtempSync(join(tmpdir(), "dsh-bench-parity-orphan-"));
    try {
      // 副本 A：把被引用的 L32 目录从盘上抹掉 ⇒ 方向二出声、方向一闭嘴
      const a = corpusFrom(rootA, SYN_DIRS.filter((d) => d !== SYN_DIRS[3]!), SYN_TASKS);
      expect(orphanTargets(a.diskDirs, a.refs), "少一个目录不制造孤儿").toEqual([]);
      expect(danglingRefs(a.diskDirs, a.refs), "清单指着盘上没有的靶子").toEqual([SYN_DIRS[3]]);
      expect(a.diskDirs.length === a.ids.length, "目录数与清单条数必须当场分家").toBe(false);
      // 副本 B：多建一个谁都没引用的目录 ⇒ 方向一出声、方向二闭嘴
      const b = corpusFrom(rootB, [...SYN_DIRS, "bench-nobody-refs-me"], SYN_TASKS);
      expect(orphanTargets(b.diskDirs, b.refs), "盘上有靶子没进任何清单").toEqual(["bench-nobody-refs-me"]);
      expect(danglingRefs(b.diskDirs, b.refs), "多一个目录不制造悬空").toEqual([]);
      expect(b.diskDirs.length === b.ids.length, "目录数与清单条数必须当场分家").toBe(false);
    } finally {
      rmSync(rootA, { recursive: true, force: true });
      rmSync(rootB, { recursive: true, force: true });
    }
  });

  it("负控七·清单多一条任务（目录也建了）：双向配平照旧绿，只有行数那一条红", () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-bench-parity-extra-"));
    try {
      const extra: SynthTask = { id: "L48-long-chain", dir: "bench-long-chain-48" };
      const c = corpusFrom(root, [...SYN_DIRS, extra.dir], {
        ...SYN_TASKS,
        "tasks-long30.json": [...SYN_TASKS["tasks-long30.json"]!, extra],
      });
      expect(c.ids).toHaveLength(SYN_TOTAL + 1);
      // 配平两支都不该误报——这一维只有「表行数＝清单总条数」看得见
      expect(orphanTargets(c.diskDirs, c.refs)).toEqual([]);
      expect(danglingRefs(c.diskDirs, c.refs)).toEqual([]);
      expect(perTaskRowCount(synthReadme()) === c.ids.length, "文档少抄一行却判不出 ⇒ 行数那条是假尺").toBe(false);
      expect(perTaskRowCount(synthReadme())).toBe(SYN_TOTAL);
      // 补上那一行后，行数与框架句一起回到闭嘴（反向证人）
      const healed = synthReadme([...SYN_ROWS, { id: extra.id, dir: extra.dir, state: "1 / 0 / 1" }], SYN_CATS, `${String(c.ids.length)} 条`, c.manifestFiles);
      expect(perTaskRowCount(healed)).toBe(c.ids.length);
      expect(staleCountClaims(healed, c.ids.length, c.counts)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("负控八·清单文件名点名：README 少写一份清单名 ⇒ 只有点名那一支出声", () => {
    const whole = synthReadme();
    expect(undocumentedManifests(SYN_MANIFESTS, whole)).toEqual([]);
    const added = [...SYN_MANIFESTS, "tasks-chain48.json"];
    const hits = undocumentedManifests(added, whole);
    expect(hits).toEqual(["tasks-chain48.json"]); // 只点名真缺的那一份，不连带误报已点名的两份
    expect(undocumentedManifests(added, synthReadme(SYN_ROWS, SYN_CATS, `${String(SYN_TOTAL)} 条`, added))).toEqual([]);
  });
});
