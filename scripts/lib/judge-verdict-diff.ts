/** 两棵树的**判卷结论**对账（纯函数，供 `tests/judge-verdict-diff.test.ts` 消费）。不碰盘、不起进程。
 *
 * 为什么要有（第 83 页的账）：我每次报"全量绿"，跑的都是主树——而主树带着别人的未提交改动。
 * HEAD 上那 5 条已提交红灯里有 3 条是我造的，全靠事后开隔离树才发现（规则 97/181/184）。
 * 本模块把这件事挪到提交前：**同一套判卷面，在 HEAD 树与主树里各跑一次，按文件比结论**，
 * 并把差异归到四种成因上——其中只有一种是"会随我这次提交进 HEAD 的新红"。
 *
 * 口径：结论取每个 test 文件的 `✓ / ❯ / ×` 行与 `FAIL <file> >` 头；两侧文件名取相对路径（两棵树同布局）。
 */

export type Verdict = "绿" | "红";

export interface FileVerdict {
  file: string;
  verdict: Verdict;
  /** 该文件括号里的计数原文（如 `15 tests | 1 failed`），只为让读数能自证，不参与判定。 */
  counts: string;
}

const ANSI = /\x1b\[[0-9;]*m/g;

/** 剥 ANSI：本仓多次因 vitest 输出带色而读出假数（AGENTS「验收一律 TERM=dumb」同源）。 */
export function stripAnsi(text: string): string {
  return text.replace(ANSI, "");
}

/** 从一份 vitest 全量输出里抽「每个 test 文件的结论」。
 *  判红有三个独立来源，任一命中即红（缺一会漏计）：
 *  ① 文件行的状态符是 `×`/`❯`；② 文件行括号里出现 `N failed`（N>0）；③ 出现 `FAIL <file> >` 头。
 *  只认 ① 会漏掉 vitest 用 `❯` 汇总的写法；只认 ② 会漏掉 0 用例就崩的文件。 */
export function parseFileVerdicts(rawLog: string): Map<string, FileVerdict> {
  const text = stripAnsi(rawLog);
  const out = new Map<string, FileVerdict>();
  // 文件名必须止于 `.test.ts`：vitest 还会打 `❯ tests/x.test.ts:139:117` 这种**栈行**，
  // 用 `[^\s(]+` 会把 `:139:117` 一起收进来，造出一个不存在的键、把对账污染成"只在某一侧有"。
  const fileLine = /^\s*(✓|×|❯|✗)\s+(tests\/[^\s(]+?\.test\.ts)\s*(?:\(([^)]*)\))?/;
  for (const line of text.split("\n")) {
    const m = fileLine.exec(line);
    if (m !== null) {
      const marker = m[1]!;
      const counts = (m[3] ?? "").trim();
      const failedCount = /(\d+)\s+failed/.exec(counts);
      const red = marker === "×" || marker === "❯" || marker === "✗" || (failedCount !== null && Number(failedCount[1]) > 0);
      const file = m[2]!;
      const prev = out.get(file);
      // 同一个文件可能先出 `❯`(describe 汇总) 再出 `✓`：任一行红就算红（漏计比误报贵）。
      out.set(file, { file, verdict: (red || prev?.verdict === "红") ? "红" : "绿", counts: counts || prev?.counts || "" });
      continue;
    }
    const fail = /^\s*FAIL\s+(tests\/[^\s>]+?\.test\.ts)/.exec(line);
    if (fail !== null) {
      const file = fail[1]!;
      const prev = out.get(file);
      out.set(file, { file, verdict: "红", counts: prev?.counts ?? "（只见到 FAIL 头）" });
    }
  }
  return out;
}

export interface DiffRow {
  file: string;
  kind: "只在 HEAD 红" | "只在盘上红" | "两棵都红" | "只在 HEAD 有" | "只在盘上有" | "两棵都绿";
  headCounts: string;
  diskCounts: string;
}

/** 对账。**只报有差异的**（"两棵都绿"不进结果，除非调用方要计数）。 */
export function diffVerdicts(head: ReadonlyMap<string, FileVerdict>, disk: ReadonlyMap<string, FileVerdict>): DiffRow[] {
  const rows: DiffRow[] = [];
  const files = [...new Set([...head.keys(), ...disk.keys()])].sort();
  for (const file of files) {
    const h = head.get(file);
    const d = disk.get(file);
    // **颜色优先于存在性**：只在盘上有的文件如果是红的，它同样会随提交进 HEAD——
    // 先判"只在盘上有"就会把它归进"未入库的新判卷面，正常"那一句，等于给它发了假通过票。
    if (h === undefined || d === undefined) {
      if (d !== undefined) {
        rows.push(d.verdict === "红"
          ? { file, kind: "只在盘上红", headCounts: "（HEAD 里没有这个文件）", diskCounts: d.counts }
          : { file, kind: "只在盘上有", headCounts: "—", diskCounts: d.counts });
      } else if (h !== undefined) {
        rows.push(h.verdict === "红"
          ? { file, kind: "只在 HEAD 红", headCounts: h.counts, diskCounts: "（盘上已没有这个文件）" }
          : { file, kind: "只在 HEAD 有", headCounts: h.counts, diskCounts: "—" });
      }
      continue;
    }
    if (h.verdict === "红" && d.verdict === "红") { rows.push({ file, kind: "两棵都红", headCounts: h.counts, diskCounts: d.counts }); continue; }
    if (h.verdict === "红" && d.verdict === "绿") { rows.push({ file, kind: "只在 HEAD 红", headCounts: h.counts, diskCounts: d.counts }); continue; }
    if (h.verdict === "绿" && d.verdict === "红") { rows.push({ file, kind: "只在盘上红", headCounts: h.counts, diskCounts: d.counts }); continue; }
  }
  return rows;
}

export function greenCount(head: ReadonlyMap<string, FileVerdict>, disk: ReadonlyMap<string, FileVerdict>): number {
  let n = 0;
  for (const [file, h] of head) if (h.verdict === "绿" && disk.get(file)?.verdict === "绿") n++;
  return n;
}

/** 一句差异的**读法**（写死在这里，是为了让每个桶的修法与"下一步做什么"绑在同一个事实源上）。 */
export const HOW_TO_READ: Readonly<Record<DiffRow["kind"], string>> = {
  "只在 HEAD 红": "主树里被未提交改动垫住了 ⇒ 这条红是**已提交**的账（谁的字？`git log -S` 找），不是我这次造的；" +
    "另一种情形是该文件在主树已消失（删除也会把它「垫绿」）⇒ 同样不是我的账，但要确认那笔删除是否带着锚点一起摘。",
  "只在盘上红": "**这条会随提交进 HEAD** ⇒ 要么是我改坏的，要么是别人未提交的实现/删除造成的；必须逐条归因后才能提交。" +
    "（HEAD 里根本没有这个文件的新判卷面，红了也算在这一桶——颜色优先于存在性。）",
  "两棵都红": "两棵树都拦不住 ⇒ 与本次改动无关的存量红（通常是那条已提交红灯）。",
  "只在 HEAD 有": "这份判卷面在 HEAD 里是绿的、在主树已不在盘上＝在途删除（第 79 页那族）；随那笔入库，指向它的锚点也要一起摘。",
  "只在盘上有": "新写的判卷面还没入库且它是绿的 ⇒ HEAD 上暂时没有它的观测者，正常（提交后两侧会齐）。",
  "两棵都绿": "无差异，不进结果。",
};
