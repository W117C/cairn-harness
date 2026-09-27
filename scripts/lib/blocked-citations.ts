// 「按编号引用 BLOCKED.md 台账」这件事的可解析性（第 150 页，任务 #2/#6 的内容半）。
//
// 为什么要有（都是实测，见 outputs/blocked-queue-deleted-2026-09-26/ 与第 122 页）：
//   `14d2736`（"工作树整体入库"）把 `BLOCKED.md` 从 **127,023 B / 1,187 行 / 67 个标题**换成 296 B 的桌面层 stub，
//   而四棵活树里有 **14 处按编号引用**（`裁决 3`、`D-2`、`#56`…）在指它 ⇒ 落库那天 14 处同时变死。
//   没有任何一把尺喊过：`docs-check` 的 D-3 只认 `页:行号` 形状（真源码里 `BLOCKED.md:<行>` 实测 **0 处**），
//   `DOC_BUDGETS` 是"只准下调"的帽（删到 296 B 天然在帽内）⇒ **同一类跨面耦合，换了指针语法就没有门**（规则 213）。
//
// 本层只做判卷能吃的纯函数：取料面与归一口径与那支探针一致（`measure-citations.mts`），
// 探针继续当复跑面，两份实现由判卷判"同一输入 ⇒ 同一批命中"，抄本之间不许各漂一份（第十三族）。
export interface CitationHit {
  file: string;
  line: number;
  id: string;
}
export interface LedgerSource {
  name: string;
  path: string;
}

/** 引用面＝四棵活树。`outputs/` 那层是 dated 档案，按 `docs-check.ts` 的口径不进账（报下界不报上界）。 */
export const CITATION_ROOTS: readonly string[] = ["src", "scripts", "tests", "docs"];
export const CITATION_EXTS: readonly string[] = [".ts", ".tsx", ".mjs", ".mts", ".md"];
/** 「BLOCKED」之后 40 字内出现带编号的指向才算引用：裁决 N / 裁决记录 §N / 待办 #N / #N / D-N / 备案 N。 */
export const CITE = /BLOCKED[^\n]{0,40}?(裁决记录\s*§?\s*\d+|裁决\s*\d+|待办\s*#\d+|#\d+|D-\d+|备案\s*[0-9①-⑨]+)/g;

/** 台账落点集合。`BLOCKED.md` 是第一落点（今天的队列面）；恢复件是第二落点——
 *  被删的原文此刻只活在 git 对象与这份档案里，而引用要能落到**读得到**的东西上（任务 #6：点名≠看得见）。
 *  将来台账按提案回到 `BLOCKED.md`，本集合不用改（多一处查得到不是坏事）。 */
export const LEDGER_SOURCES: readonly LedgerSource[] = [
  { name: "BLOCKED.md", path: "BLOCKED.md" },
  { name: "恢复件（第 150 页）", path: "outputs/blocked-ledger-recovered-2026-09-27/BLOCKED-ledger-1187.txt" },
];

/** 编号归一：`待办 #56` 的键是 `#56`（把前缀一起吃会造出必然查不到的假死引用，第 122 页自纠过）；
 *  空白全删——「裁决 3」与「裁决3」是写法差，不是查不到。 */
export function normId(raw: string): string {
  return raw.replace(/^待办\s+/, "").replace(/\s+/g, " ").trim();
}
export const normKey = (s: string): string => s.replace(/\s+/g, "");

/** 扫一批文件文本 ⇒ 引用命中 + 被剔出的规则名命中（剔出要说得出口径，不许手删）。 */
export function scanCitations(entries: readonly { path: string; text: string }[]): {
  cites: CitationHit[]; dropped: CitationHit[];
} {
  const cites: CitationHit[] = [];
  const dropped: CitationHit[] = [];
  for (const e of entries) {
    if (e.path.endsWith("BLOCKED.md")) continue; // 台账自己不算引用面
    e.text.split("\n").forEach((line, i) => {
      for (const m of line.matchAll(new RegExp(CITE.source, "g"))) {
        const hit: CitationHit = { file: e.path, line: i + 1, id: normId(m[1]) };
        // 同一处命中里出现 `docs-check` ⇒ 那个 `D-N` 是文档预算规则名（D-1…D-8），不是台账编号。
        if (/D-\d+/.test(m[0]) && /docs-check/.test(m[0])) dropped.push(hit);
        else cites.push(hit);
      }
    });
  }
  return { cites, dropped };
}

/** 引用 ⇒ 落点解析：每个编号在哪几处台账里查得到。 */
export function resolveCitations(cites: readonly CitationHit[], ledgers: readonly { name: string; text: string }[]): {
  ids: string[]; resolved: Map<string, string[]>; dead: { id: string; uses: number; where: string[] }[];
} {
  const ids = [...new Set(cites.map((c) => c.id))].sort();
  const normed = ledgers.map((l) => ({ name: l.name, text: normKey(l.text) }));
  const resolved = new Map<string, string[]>();
  const dead: { id: string; uses: number; where: string[] }[] = [];
  for (const id of ids) {
    const key = normKey(id);
    const hits = cites.filter((c) => c.id === id);
    const where = normed.filter((l) => l.text.includes(key)).map((l) => l.name);
    if (where.length === 0) dead.push({ id, uses: hits.length, where: hits.map((c) => c.file + ":" + String(c.line)) });
    else resolved.set(id, where);
  }
  return { ids, resolved, dead };
}

export interface CitationViolation {
  kind: "dead-pointer" | "empty-face" | "ledger-missing";
  detail: string;
}

/** 三态：一个台账落点都读不到＝没尺；引用面为空＝没尺（都不许读成"全部可解析"，规则 222）；
 *  有引用查不到落点＝死指针，逐条点名到 `文件:行`。 */
export function citationViolations(
  cites: readonly CitationHit[],
  dead: readonly { id: string; uses: number; where: string[] }[],
  ledgersRead: readonly string[],
): CitationViolation[] {
  const out: CitationViolation[] = [];
  for (const s of LEDGER_SOURCES) {
    if (!ledgersRead.includes(s.path)) {
      out.push({ kind: "ledger-missing", detail: "台账落点读不到：" + s.path + " ⇒ 本面判据不成立（不能读成「引用都活着」）" });
    }
  }
  if (ledgersRead.length === 0) return out;
  if (cites.length === 0) {
    out.push({ kind: "empty-face", detail: "引用面 0 处：要么引用被删了，要么取料面坏掉 ⇒ 两种都不算「全部可解析」" });
  }
  for (const d of dead) {
    out.push({ kind: "dead-pointer", detail: `${d.id}｜用 ${String(d.uses)} 次｜查不到落点：${d.where.join("、")}` });
  }
  return out;
}
