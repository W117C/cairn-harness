// 落库面与门面对账的纯函数（任务 #47 ＋ #49；第 339 页）。
//
// 两格其实是同一件事的三个方向，都在问「我以为已经落库的那个世界，现在还在不在」：
//  · **#47**：路 A（`git commit -- <paths>`＝`--only`，提交完把真实 index 恢复原样）与路 D（临时 index）
//    都**不更新真实 index** ⇒ 我刚落库的内容在共享 index 里退化成旧版本，而隔壁一次 plain commit
//    （提交的就是 index）会让 HEAD 前进到一笔不含这些内容的树。第 336 页补实测：29 条滞后路径里 28 条归属我。
//  · **#49**：**门本体在飞时，门的打印面就不是 HEAD 那把尺**。第 337 页补实测：盘上 `docs-check` 比
//    HEAD 多一条 D-12（`git log -S D-12` 空 ⇒ 从没落库过），而两边退码一模一样＝0——"门绿"会取到假面。
//
// 为什么不自动修：这一格能安全自动的只有「把自己那批路径同步进 index」，而**判断哪批是我的**需要
// 知道「哪几笔是我落的」——本仓多会话共用一个 git 身份（作者名相同），author 字段分辨不出会话，
// 所以自动同步＝可能替别人改暂存面。尺只出声与点名，同步动作留在人（见 CLI 的 `--sync` 显式开关，
// 它只同步「被点名那一笔落库的路径 ∩ 已经确认 index 落后」的交集，且要求显式传 rev）。
//
// 取料纪律：`git ls-tree -r -z`／`git ls-files -s -z` **必须带 `-z`**——非 ASCII 路径在默认输出里会被
// 转义成带引号的八进制串（docs-check 在第 285 页为这一格付过账：中文证人全都不在集合里）。
export type DriftKind = "aligned" | "missingInIndex" | "staleInIndex" | "stagedNew";

export interface DriftCell {
  path: string;
  kind: DriftKind;
  headSha: string | null;
  indexSha: string | null;
}

export interface DriftReport {
  cells: DriftCell[];
  counts: Record<DriftKind, number>;
}

/** 把 HEAD 树与真实 index 两份 `path → blob sha` 清单收成四态。
 *  两侧都缺的路径不出现在结果里（那不可能，且真出现说明取料坏了——由调用方的分母自证去抓）。 */
export function classifyDrift(head: ReadonlyMap<string, string>, index: ReadonlyMap<string, string>): DriftReport {
  const cells: DriftCell[] = [];
  const paths = [...new Set([...head.keys(), ...index.keys()])].sort();
  for (const path of paths) {
    const h = head.get(path) ?? null;
    const i = index.get(path) ?? null;
    let kind: DriftKind;
    if (h !== null && i === null) kind = "missingInIndex";
    else if (h !== null && i !== null) kind = h === i ? "aligned" : "staleInIndex";
    else kind = "stagedNew"; // !h && i：别人新暂存的文件（正常在飞形态，不算滞后）
    cells.push({ path, kind, headSha: h, indexSha: i });
  }
  const counts: Record<DriftKind, number> = { aligned: 0, missingInIndex: 0, staleInIndex: 0, stagedNew: 0 };
  for (const c of cells) counts[c.kind]++;
  return { cells, counts };
}

/** 「那一笔落库的东西，现在有多少不在 index 上」——#47 的实际问题。
 *  只数**这笔动过的路径**，不把别人的暂存面算进来（那既不是我的账也不该我动）。 */
export function landedGap(revTouched: readonly string[], report: DriftReport): string[] {
  const bad = new Set(report.cells.filter((c) => c.kind === "missingInIndex" || c.kind === "staleInIndex").map((c) => c.path));
  return [...new Set(revTouched)].filter((p) => bad.has(p)).sort();
}

/** #49：门本体面里「盘上与 HEAD 不一致」的那些。`gateNames` 取自 `GATES`（**不手抄第二份门清单**——
 *  第 317 页那笔的全部教训就是手抄件会漂），匹配规则是「文件基名＝门名」，其余 scripts 面差异单列成 `other`。 */
/** 门本体面分三档，**不是两档**（第 345 页的教训形状：我在干净 HEAD 树里跑了一支只存在于暂存面的门，
 *  拿到 `ERR_MODULE_NOT_FOUND`，还把这件事读成了「仓的缺陷」）：
 *   · `gates`＝HEAD 里有这道门、盘上也改了 ⇒ 打印面 ≠ HEAD 那把尺，读数要写明取在哪棵树；
 *   · `absentInHead`＝盘上有、HEAD 里**根本没有这支文件** ⇒ 它不是"漂了"，是**这道门还没入库**，
 *     HEAD 侧不存在这道门的任何读数（把它并进 `gates` 会让人以为 HEAD 有一道红了/在飞的红门）；
 *   · `other`＝非门。
 *  `headScripts` 是必填的：拿不到 HEAD 的 scripts 面时，本尺宁可不要这一格，也不许把"取不到"
 *  读成"全都在 HEAD"（与 `onlyListsIn` 返回 null 同一口径）。 */
export interface GateFace {
  gates: string[];
  absentInHead: string[];
  other: string[];
}

export function gateFaceDiff(dirtyScripts: readonly string[], gateNames: readonly string[], headScripts: ReadonlySet<string>): GateFace {
  const names = new Set(gateNames);
  const gates: string[] = [];
  const absentInHead: string[] = [];
  const other: string[] = [];
  for (const p of new Set(dirtyScripts)) {
    const base = p.split("/").pop() ?? p;
    const stem = base.replace(/\.mjs$/, "").replace(/\.ts$/, "");
    if (!names.has(stem)) {
      other.push(p);
    } else if (headScripts.has(p)) {
      gates.push(p);
    } else {
      absentInHead.push(p);
    }
  }
  return { gates: gates.sort(), absentInHead: absentInHead.sort(), other: other.sort() };
}

/** 汇总行：四态相加＝分母（少一格就是量法坏了，规则 248/261 那一族）。 */
export function driftSummary(r: DriftReport): string {
  const t = r.counts;
  return `落库面对账：路径 ${String(r.cells.length)} 条 —— 一致 ${String(t.aligned)}，`
    + `index 缺 ${String(t.missingInIndex)}，index 更旧 ${String(t.staleInIndex)}，别人新暂存 ${String(t.stagedNew)}`;
}
