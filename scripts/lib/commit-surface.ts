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

// ---- 提交面的删除形状（任务 #16，第 435 页）----
//
// 动因是**我自己造的那笔空树提交**（第 431 页）：`GIT_INDEX_FILE=` 指着一个没 read-tree 过的 index，
// git 于是认为「索引里该有的东西」是零 ⇒ `3647 files changed, 441768 deletions(-)`、树里 0 支文件。
// 没造成不可逆损失只因为本仓没有远端、我没 push，而且**是我看见 stdout 那一行才停的**——
// "靠人看见"不是一把尺（本仓口径：重复疏忽要搬进工具）。这一格把它搬进门，两个消费者共用下面这一份判据：
//  · `scripts/commit-surface-check.ts`——**提交那一刻**跑（`--landed=<rev>`，缺省查 HEAD）；
//  · `scripts/repo-hygiene-check.ts`——**认证那一拍**跑（忘了跑上面那道也拦得住）。
//
// 阈值不凭愿望写。现读（HEAD 往回 120 笔逐笔量，读数记在 `outputs/commit-shape-gate-2026-10-08/`）：
//  · 从父树**消失的文件数**：p50=0、p90=0、p99=1、最大 **4**（`c68ea0c`）⇒ 帽 4（含等号，超帽才红）；
//    而事故那一笔是 3647。拿它当唯一阻断维，是因为它在真实历史里**一次都不会误伤**（回放 120 笔：0 条红）。
//  · 删除**行数占比**：p90=36.8%、最大 **94.2%**（`3c99f31`，那是合法的「退回隔壁夹带的 10 支在飞文件」，
//    一支文件都没从树里消失）；`6c684f6` 也类似（81.7%、消失 1 支，已入库且是对的）。
//    ⇒ 占比这一维**只出声、不阻断**：单独拿它判红会误伤真实历史，那会把门的信用花光。
//  · 「备案」标记只对人手写的那一句认（`删除备案：` 后面要有 ≥8 字符的话），空标记不算备案——
//    否则"绕过门"的成本低到和"开门"一样。
export const DELETED_FILE_CAP = 4;
export const DELETION_DOMINANT_MIN = 200;
export const DELETION_DOMINANT_RATIO = 0.8;
export const DELETE_WAIVER_MARK = "删除备案：";

export interface CommitShapeFacts {
  /** 被问的那一笔（报告里要点名，不许只说"有一笔"）。 */
  rev: string;
  /** 这一笔从父树里删掉的文件数；`null`＝取不到（**不许折成 0**，那是把没尺读成干净）。 */
  deletedFiles: number | null;
  /** `--numstat` 的行数合计（二进制那几条不计入行数，另记 `binaryFiles`）。 */
  insertions: number;
  deletions: number;
  binaryFiles: number;
  /** 这一笔之后的树里有多少支文件；`null`＝取不到。 */
  treeFiles: number | null;
  /** 提交说明正文（认「删除备案：」用）。 */
  message: string;
  /** 有没有父可比：根提交没有父树 ⇒ 删除维度无从判，要**出声**而不是判红。 */
  hasParent: boolean;
}

/** 取料器的形状：把 git 的参数表交进去，拿回 stdout；**取不到要返回 `null`**（不许返回空串——
 *  空串会被下面当成「这笔改了 0 个文件」，那是把没尺读成干净）。lib 不起进程，spawn 留在调用方。 */
export type GitRunner = (args: readonly string[]) => string | null;

/** 四个 git 取料点＋解析，只在这里定义一次：`commit-surface-check`（提交那一刻）与
 *  `repo-hygiene-check`（认证那一拍）都调这一个函数，两边不许各写一遍参数表——
 *  写两遍就是两份事实源，改一处时另一处会安静地给出不同的数。 */
export function commitShapeFacts(rev: string, runGit: GitRunner): CommitShapeFacts {
  const nul = (s: string | null): string[] | null => (s === null ? null : s.split("\0").filter((x) => x !== ""));
  const meta = runGit(["show", "--no-patch", "--format=%H\u001f%P\u001f%B", rev]);
  const numstat = runGit(["diff-tree", "--numstat", "--no-commit-id", "-r", "-z", rev]);
  const gone = runGit(["diff-tree", "--no-commit-id", "--name-only", "-r", "--diff-filter=D", "-z", rev]);
  const tree = runGit(["ls-tree", "-r", "--name-only", "-z", rev]);
  const [sha, parents, message] = (meta ?? "").split("\u001f");
  const goneList = nul(gone);
  const treeList = nul(tree);
  let insertions = 0;
  let deletions = 0;
  let binaryFiles = 0;
  for (const rec of nul(numstat) ?? []) {
    const cells = rec.split("\t");
    if (cells.length < 3) continue;
    if (cells[0] === "-" || cells[1] === "-") {
      binaryFiles++;
      continue;
    }
    insertions += Number(cells[0]);
    deletions += Number(cells[1]);
  }
  return {
    // meta 取不到时 `sha` 是空串而不是 undefined——那种情况下要回落到被问的那个 rev，
    // 不能让报告印出一个空名（读者会以为在说"某一笔"，而其实我们什么都没取到）。
    rev: sha === undefined || sha.trim() === "" ? rev : sha.trim(),
    deletedFiles: goneList === null ? null : goneList.length,
    insertions,
    deletions,
    binaryFiles,
    treeFiles: treeList === null ? null : treeList.length,
    message: message ?? "",
    hasParent: (parents ?? "").trim() !== "",
  };
}

export type ShapeKind = "emptyTree" | "massDelete" | "dominantDelete" | "faceUnreadable" | "rootCommit";

export interface ShapeFinding {
  kind: ShapeKind;
  /** `true` ⇒ 消费者的退出码要红（提交面拒落／认证拦下）。 */
  blocking: boolean;
  detail: string;
}

/** 备案标记认不认：`删除备案：` 之后那一行要有实质内容（≥8 个字符）。
 *  写成"只要有标记就算"等于把门交给一个标点符号。 */
export function commitShapeWaived(message: string): boolean {
  const at = message.indexOf(DELETE_WAIVER_MARK);
  if (at < 0) return false;
  const line = message.slice(at + DELETE_WAIVER_MARK.length).split("\n")[0] ?? "";
  return Array.from(line.trim()).length >= 8;
}

/** 删除形状的判据本体（不碰 git：取料由调用方交进来，交的是它已经算出来的那几个数）。 */
export function commitShapeFindings(f: CommitShapeFacts): ShapeFinding[] {
  const out: ShapeFinding[] = [];
  if (f.treeFiles === null) {
    out.push({
      kind: "faceUnreadable",
      blocking: true,
      detail: `${f.rev} 的树文件数取不到 ⇒ 这一格没尺，判红而不是当 0（「没量到」与「树是空的」同形）`,
    });
  } else if (f.treeFiles === 0) {
    out.push({
      kind: "emptyTree",
      blocking: true,
      detail: `${f.rev} 落完树里 **0 支文件**——第 431 页那笔空树提交就是这个形状（`
        + "临时 index 没 read-tree ⇒ git 认为索引里该有的东西是零）",
    });
  }
  if (f.deletedFiles === null) {
    out.push({
      kind: "faceUnreadable",
      blocking: true,
      detail: `${f.rev} 的「从树里消失的文件数」取不到 ⇒ 这一格没尺，判红而不是当 0`,
    });
  }
  // 没尺时只报「没尺」：那时连"有没有父"都是猜的，不该再叠一条 rootCommit 冒充判据。
  if (f.treeFiles === null || f.deletedFiles === null) return out;
  if (!f.hasParent) {
    // 根提交：不是"没删东西"，是**没有父可比** ⇒ 出声但不阻断，也不去叠下面的阈值判断。
    out.push({ kind: "rootCommit", blocking: false, detail: `${f.rev} 没有父可比 ⇒ 删除维度本次无从判（不是"判过了"）` });
    return out;
  }

  const waived = commitShapeWaived(f.message);
  if (f.deletedFiles > DELETED_FILE_CAP) {
    out.push({
      kind: "massDelete",
      blocking: !waived,
      detail:
        `${f.rev} 从树里删掉 ${String(f.deletedFiles)} 支文件 > 帽 ${String(DELETED_FILE_CAP)}`
        + `（现读：近 120 笔最大 4 支）${waived ? "——说明里有备案，放行" : "——说明里没写「" + DELETE_WAIVER_MARK + "<为什么>」，拒落"}`
        + `｜增 ${String(f.insertions)} 行／删 ${String(f.deletions)} 行｜树里剩 ${String(f.treeFiles)} 支`,
    });
  }
  const total = f.insertions + f.deletions;
  if (f.deletions >= DELETION_DOMINANT_MIN && total > 0 && f.deletions / total >= DELETION_DOMINANT_RATIO) {
    out.push({
      kind: "dominantDelete",
      // 只出声：实测合法历史里就有 94.2% 的那一笔（它一支文件都没消失）。
      blocking: false,
      detail:
        `${f.rev} 的删除占 ${(f.deletions / total * 100).toFixed(1)}%（删 ${String(f.deletions)}／增 ${String(f.insertions)}，`
        + `二进制 ${String(f.binaryFiles)} 支不计行）——这一维**只出声不阻断**：`
        + "真实历史里「退回别人夹带的文件」就是这个形状，判红会把门的信用花光",
    });
  }
  return out;
}

/** 一行汇总（格式被判卷钉住：改格式要同笔改判卷，规则 253）。 */
export function commitShapeSummary(findings: readonly ShapeFinding[]): string {
  const blocking = findings.filter((x) => x.blocking).length;
  const noted = findings.length - blocking;
  return `提交面删除形状：出声 ${String(findings.length)} 条（阻断 ${String(blocking)}，只报 ${String(noted)}）`
    + `｜帽：消失文件 ≤ ${String(DELETED_FILE_CAP)}、备案标记「${DELETE_WAIVER_MARK}」`;
}
