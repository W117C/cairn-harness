// 文档分层预算门（spec §6 的 D-1/D-3/D-5；spec 在
// docs/superpowers/specs/2026-09-19-doc-layer-budget-design.md）。
//
// 判据一律写成**纯函数**（本仓纪律：门禁判据要可测、可断言，且 BSD grep 的 `\b \s \|`
// 会静默返空，故不走 shell）。真实文件读取与 git 解析只在 main() 里发生。
//
// 已登记进 GATES。开门之日仓里已存在的存量违规逐条记在 LEGACY_WAIVERS 并写明理由（条数不抄进注释——
// 水位**只准调低**，不再被命中的条目会报成 stale 红，故豁免不会静默烂在这儿）。

export interface Finding {
  rule: "D-1" | "D-2" | "D-3" | "D-4" | "D-5" | "D-7" | "D-8" | "D-9" | "D-10" | "D-11" | "W";
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

/** D-10（第 279 页）：台账里的**源码**行号引用必须追得到一个存在的东西。
 *  动因是普查：PROGRESS.md 里 167 条去重引用中 74 条追不到——66 条只写了裸文件名（`agent-runner.ts:1563`），
 *  8 条路径在 HEAD 里根本没有（`src/main/index.ts:198` 属桌面层删除后的残留）。D-3 只管 `.md` 的行号指针，
 *  源码侧此前无人看。**"行号还在总行数范围内"不算证人**（文件只会长），所以这条只判一件事：追不追得到。
 *  存量按**集合**登记（不是数量）——数量水位拦不住"修一条又添一条"的净零交换。 */
const SOURCE_LINE_CITATION = /[A-Za-z0-9_./-]+\.(?:ts|mts|mjs|js|json):[0-9]+/g;

/** 第 279 页普查快照（写于行号约定之前的存量；理由共用一条，见下）。
 *  名单不是手抄的：由本条判据第一次跑出来的 74 项 D-10 输出去重后生成（证人
 *  `outputs/doc-line-citations-2026-10-01/docs-check-279-census.log`），且与独立探针数的 74 同值。 */
export const LEGACY_SOURCE_CITATIONS: readonly string[] = [
  "agent-runner.ts:1379", "agent-runner.ts:1488", "agent-runner.ts:1563", "agent-runner.ts:1570",
  "agent-runner.ts:1572", "agent-runner.ts:41", "agent-runner.ts:852", "agent-runner.ts:94",
  "agent-runner.ts:976", "app.js:4", "command-shape.test.ts:14", "docs-check.test.ts:156",
  "docs-check.ts:115", "docs-check.ts:136", "docs-check.ts:215", "economics.ts:165",
  "evidence.ts:142", "gate-manifest.ts:12", "gate-manifest.ts:39", "gates.ts:163",
  "glm-session.ts:429", "glm-session.ts:549", "glm-session.ts:630", "glm-session.ts:638",
  "glm-session.ts:834", "head-cert-deps.test.ts:523", "head-cert.ts:210", "head-cert.ts:248",
  "impact-query.ts:188", "impact/index.ts:356", "impact/index.ts:64", "index.ts:105",
  "index.ts:243", "judge-input-face.ts:21", "lease-conflicts.ts:25", "ledger.ts:321",
  "loop.ts:233", "loop.ts:397", "loop.ts:421", "loop.ts:462",
  "main/agent-runner.ts:782", "model-surface-check.ts:307", "model-surface.ts:84", "mutate-gates.ts:720",
  "mutate-verify.mjs:10455", "mutate-verify.mjs:382", "mutate-verify.mjs:5317", "mutate-verify.mjs:9882",
  "net.test.ts:53", "orchestrator-join.ts:234", "orchestrator.ts:184", "orchestrator.ts:318",
  "orchestrator.ts:627", "orchestrator.ts:630", "permissions/autonomy.ts:345", "permissions/index.ts:127",
  "plan-state.ts:18", "prefix-churn-check.ts:708", "prune-batching.test.ts:132", "prune-batching.test.ts:133",
  "replay-determinism-check.ts:65", "replay-determinism-check.ts:99", "ripgrep.ts:91", "sandbox.ts:170",
  "scheduler.ts:599", "settings-handlers.ts:78", "settings.ts:122", "settings.ts:123",
  "settings.ts:124", "solpi-runtime.ts:111", "src/main/index.ts:198", "supervise-contract.ts:71",
  "tests/m3b.test.ts:276", "tests/permission-mode-guided.test.ts:103",
];
export const LEGACY_SOURCE_CITATION_REASON =
  "第 279 页普查时台账里已存在的引用（写于行号约定之前）；只准调低，不再命中即报 stale";

export function checkSourceLineCitations(
  ledgerText: string,
  tracked: ReadonlySet<string>,
  legacy: readonly string[] = LEGACY_SOURCE_CITATIONS,
): Finding[] {
  const out: Finding[] = [];
  const seen = new Set<string>();
  for (const m of ledgerText.matchAll(SOURCE_LINE_CITATION)) {
    const cite = m[0];
    if (seen.has(cite)) continue;
    seen.add(cite);
    const path = cite.slice(0, cite.lastIndexOf(":"));
    if (tracked.has(path)) continue;
    if (legacy.includes(cite)) continue;
    out.push({
      rule: "D-10",
      file: LEDGER_FILE,
      detail: `引用 ${cite} 追不到：` +
        (path.includes("/") ? "HEAD 里没有这个文件（改名或删掉了）" : "只写裸文件名、没有目录，读者无从定位") +
        `——改成 HEAD 里真存在的路径（更好的写法是 ` + "`path#符号`" + `，行号会随重排漂）`,
    });
  }
  for (const k of legacy) {
    if (!seen.has(k)) {
      out.push({ rule: "D-10", file: LEDGER_FILE, detail: `存量登记的 ${k} 在台账里已不再命中（那行引用被改了或那段没了），该删——登记不删就是假存量（理由曾写：${LEGACY_SOURCE_CITATION_REASON.slice(0, 24)}）` });
    }
  }
  return out;
}

/** HEAD 跟踪清单取不到时**交 null**，不交空集合（第 279 页：空集合会让每一条引用都被读成死指针，
 *  假红淹没真信号）；调用方把 null 记成"未检"。
 *  第 285 页把它导出：普查「台账点名的证人文件在不在 HEAD 里」的探针要用**同一份取料面**——
 *  从前 `cred-face.mts` 自己抄了一份读面，接口一改就静默烂掉（规则 345），这次不再犯第二遍。 */
export function trackedFilesAtHead(): Set<string> | null {
  try {
    // ⚠️ 必须 `-z`：默认的 `ls-tree --name-only` 会把**非 ASCII 路径**转义成一串带引号的八进制
    // （现读：本仓 HEAD 里 164 条这样，全在 `outputs/<主题>-日期/01-中文标题.md` 那一族）。
    // 从前这里按 `\n` 切，于是每一条中文证人都不在集合里 ⇒ D-10/D-11 把**已入库的**工件读成追不到（假红），
    // 而目录点名那条折 `dirs` 的正则也因为行首多了个引号而整条落空。取料面的形状要按真机量（规则 237）。
    const out = execFileSync("git", ["ls-tree", "-r", "--name-only", "-z", "HEAD"], { cwd: ROOT, encoding: "utf8" });
    const lines = out.split(String.fromCharCode(0)).filter((l) => l !== "");
    return lines.length === 0 ? null : new Set(lines);
  } catch {
    return null;
  }
}

/** D-11（第 285 页）：台账点名的 **dated 证人工件**必须在 HEAD 里追得到。
 *  动因是同一天两起同族事故：
 *  ① 第 281 页凭证引的三份日志没随页入库 ⇒ 主树 docs-check 绿、干净树判卷红（规则 346），
 *     也就是这条洞的**唯一现存检测器是一次 210s 的全量认证**；
 *  ② 第 284 页声称「第一版 `needles-before.log` 的原文留着」，而那份日志早被同名跑批覆盖 ⇒ D-9 只抽**目录**、
 *     文件名根本不进它的取料面（现跑证人 `outputs/witness-filename-blindspot-2026-10-01/probe.log`：
 *     假读数被咬 1、真读数没被误咬 0、点名的不存在文件名被咬 0）。
 *  ⇒ 这一条把检测成本从一趟认证降到 docs-check 的秒级，且**不新增子进程**：与 D-10 共用同一次 `trackedFilesAtHead()`。
 *  取值域按真机形状量（规则 237）：dated 目录里的文件名**带中文**，普查第一版把字符集限成 ASCII，
 *  于是那 35 条「缺失」几乎全是我自己截断出来的假红——所以这里的切断判据是「标点与空白」，不是字符白名单。 */
/** dated 目录名（`<主题>-YYYY-MM-DD`）的**唯一一份**形状。第 285 页：`ledgerWitnessRefs` 刚写出来时自己抄了一遍
 *  这个正则，于是锚点 `cred-dir-date-pattern-month-locked` 的针脚从 1 处变 2 处（`--check-needles` 当场报『待复认』），
 *  而 `replace` 只改第一处 ⇒ 那条锚点会咬到新写的这一支上、把 D-9 那一支放过去（规则 217/255：针脚跟着实现走，
 *  两处同字面量就是两处会各自漂的决策点）。取值域只在一处决定，两个消费者共用同一支正则。 */
const DATED_DIR_RE = /outputs\/([A-Za-z0-9._-]+-\d{4}-\d{2}-\d{2})/gu;
/** 在 dated 目录之外再吃一层「目录里的文件名」；形状从 `DATED_DIR_RE` 派生，不在这里第二次写日期。 */
const WITNESS_REF = new RegExp(DATED_DIR_RE.source + "(\\/[^\\s`]*)?", "g");
/** 中文散文里点名之后紧跟的标点要把路径切断（真机形状：`…/01-xxx.md`后面直接跟。」）。 */
const REF_BOUNDARY = /[\s、，。（）()【】[\]「」『』《》｜;；:：!！?？,]+/u;

/** 台账里所有 dated 工件点名：目录以 `/` 结尾，文件是完整相对路径；去重、排序，模式串（含 `*?{}`）跳过。
 *  导出是因为普查与判卷都要吃**同一份**抽法——第 284 页那条教训（规则 345）说的就是「探针自己抄一份构造器」。 */
export function ledgerWitnessRefs(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(WITNESS_REF)) {
    const dir = m[1]!;
    const tail = m[2] ?? "";
    if (tail === "") { out.add(`outputs/${dir}/`); continue; }
    const name = (tail.slice(1).split(REF_BOUNDARY)[0] ?? "").replace(/[.,_:-]+$/gu, "");
    if (name === "") { out.add(`outputs/${dir}/`); continue; }
    if (/[*?{}]/u.test(name)) continue;
    out.add(`outputs/${dir}/${name}`);
  }
  return [...out].sort();
}

/** 第 285 页普查登记的存量（名单不是手抄的：由 `ledgerWitnessRefs` 第一次跑出来的 miss 集合生成，
 *  证人 `outputs/witness-path-census-285-2026-10-01/classify.log`，逐条带「在盘否／同目录有没有别的文件」的分类）。 */
/** 上线时的现读存量＝2 条（证人 `outputs/witness-path-census-285-2026-10-01/classify2.log`：
 *  第 259 页点名的 `selector-uniqueness-2026-09-30/diagnose.mts` 与 `sequencer-dynamic-2026-10-01/probe-prod.mts`，
 *  两支都在盘上、只是从没随页入库）⇒ 修法取**补档**而不是登记：表交空，帽天然就是 0。
 *  这张表仍留着（并配双向判卷），因为「一条真补不了的旧账」迟早会出现——没有登记位就会退化成拆闸。
 *
 *  第 290 页补⑴：D-11 的取值域换成整本台账，于是把**整目录已不在盘上**的 12 条老账登记进来
 *  （名单不是手抄的：`outputs/witness-wide-face-census-289-2026-10-01/classify-current.log` 修 `-z` 之后那一段，
 *  逐条标着「无盘」；日期全在 2026-09-12～09-23，是那阵子清 scratch 目录时一起没的）。
 *  这 12 条**没有补档的可能**（原件不在盘上，也不在任何一个提交里），所以登记是唯一诚实的处置；
 *  帽只准调低——一旦哪份原件被找回并入库，这条就必须从表里删掉（判卷里有 stale 那一格守着）。 */
export const LEGACY_WITNESS_REFS: readonly string[] = [
  "outputs/agent-landscape-gap-analysis-2026-09-18/",
  "outputs/agent-review-2026-09-15/",
  "outputs/code-review-report-2026-09-12/",
  "outputs/code-review-worktree-2026-09-14/",
  "outputs/fix-brief-2026-09-14/",
  "outputs/fix-log-2026-09-12/",
  "outputs/m7-closure-constraints-2026-09-18/",
  "outputs/mimosa-triage-2026-09-13/",
  "outputs/optimization-log-2026-09-12/",
  "outputs/permission-guided-mode-2026-09-23/",
  "outputs/replay-face-gate-2026-09-23/",
  "outputs/verify-cause-denominator-2026-09-23/",
];
export const LEGACY_WITNESS_REF_REASON =
  "补不了的证人点名才登记（页已入库且工件确实拿不到）；只准调低，不再命中即报 stale";

/** D-11：凭证页点名的每一条 dated 工件，必须能在 HEAD 里追到。
 *  取值域＝凭证页（不是整本台账）：判据讲的是「凭证页引的证人随没随页落库」，铺宽到整本会把我自己
 *  那条 09-26 时代的老账（现读 61 条 miss）算进来——那是另一件事，别混进这一笔（规则 345 的分面宽度）。 */
export function checkWitnessPaths(
  pages: readonly CredPage[],
  tracked: ReadonlySet<string>,
  legacy: readonly string[] = LEGACY_WITNESS_REFS,
): { findings: Finding[]; refs: number; pages: number } {
  const out: Finding[] = [];
  // 目录点名判「HEAD 里有没有这个 dated 目录的任何一件工件」——先把清单折成目录集合，别每条点名线性扫全表。
  const dirs = new Set<string>();
  for (const p of tracked) {
    const m = /^outputs\/([^/]+)\/.*/u.exec(p);
    if (m) dirs.add(`outputs/${m[1]}/`);
  }
  const seenRefs = new Set<string>();
  let namingPages = 0;
  for (const p of pages) {
    if (p.refs.length > 0) namingPages++;
    for (const ref of p.refs) {
      seenRefs.add(ref);
      if (legacy.includes(ref)) continue;
      if (ref.endsWith("/") ? dirs.has(ref) : tracked.has(ref)) continue;
      out.push({
        rule: "D-11",
        file: LEDGER_FILE,
        detail: `${p.key} 点名 ${ref}，但 HEAD 里追不到` +
          (ref.endsWith("/") ? "（那个 dated 目录一件工件都没入库）" : "") +
          "——证人要与页同笔落库；这一格若由本笔未提交的工件造成，提交即归零，别当成旧账登记掉",
      });
    }
  }
  for (const k of legacy) {
    if (!seenRefs.has(k)) {
      out.push({ rule: "D-11", file: LEDGER_FILE, detail: `存量登记的 ${k} 已不再被任何凭证页点名（那段点名被改了或删了），该删——登记不删就是假存量` });
    }
  }
  return { findings: out, refs: seenRefs.size, pages: namingPages };
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

/**
 * D-5 的第二张面：台账（`PROGRESS.md`）里的每一句「凭证 @`abc1234`」都该指得到一笔真提交。
 * 为什么单独一张：`STATE_FILE` 那条面在 `STATE.md` 迁移前**整条不跑**（印的是「未检 ≠ 通过」），
 * 于是这仓里几百条 sha 引用一个证人都没有——写错一位、压笔后悬空、拿簇内坐标当已落库，全靠人眼。
 * 现读（第 227 页）：`PROGRESS.md` 抽到 230 个候选 token，其中 227 可达；不可达的 3 个全是
 * 判卷夹具的 sha256 前缀 ⇒ 带理由登记在下面，而不是放宽判据。
 */
export const LEDGER_FILE = "PROGRESS.md";

/** 不是提交的 sha 形 token（逐条带理由；**只准调低**，不再命中即报 stale——与 LEGACY_WAIVERS 同规矩）。 */
export const LEDGER_NON_REV: Readonly<Record<string, string>> = {
  "3edc934": "第 2 页「判卷 sha256 三件套与冻结基线逐字一致」里的内容哈希前缀，不是提交",
  "9179db7": "同上（同一行的第二个哈希）",
  "e253aae": "同上（同一行的第三个哈希）",
};

/**
 * 台账里的短 sha 候选：独立成词的 7 位十六进制。
 * 前缀排除 `=` 是**形状修法**而不是豁免：`--budget-ms=2400000` 这类数字会假阳（现读到的唯一一例），
 * 而"某次调用的参数值"永远不可能是一笔提交。
 */
export function ledgerRevTokens(text: string): { sha: string; line: number }[] {
  const seen = new Map<string, number>();
  const lines = text.split("\n");
  lines.forEach((l, i) => {
    for (const m of l.matchAll(/(?:^|[^0-9a-zA-Z=])([0-9a-f]{7})(?![0-9a-zA-Z])/gu)) {
      const sha = m[1]!.toLowerCase();
      if (!seen.has(sha)) seen.set(sha, i + 1);
    }
  });
  return [...seen.entries()].map(([sha, line]) => ({ sha, line })).sort((a, b) => (a.sha < b.sha ? -1 : 1));
}

/** `resolve` 注入（main() 交给一次 `git cat-file --batch-check`）：返回 null 表示"读不到/对不上号"。 */
export function ledgerRevFace(
  text: string,
  resolve: (toks: readonly string[]) => Map<string, boolean> | null,
): { findings: Finding[]; skipped: string | null; checked: number } {
  const toks = ledgerRevTokens(text);
  const found = new Set(toks.map((t) => t.sha));
  const out: Finding[] = [];
  // 豁免也要有人看着：不再命中的那条留着，下一位读者就会以为还有假阳要绕。
  for (const [sha, why] of Object.entries(LEDGER_NON_REV)) {
    if (!found.has(sha)) out.push({ rule: "D-5", file: LEDGER_FILE, detail: `豁免名单里的 ${sha} 已不再命中，该删（理由曾写：${why}）` });
  }
  if (toks.length === 0) {
    return { findings: out, skipped: `D-5 ${LEDGER_FILE} 一个 sha 候选都没抽到 ⇒ 台账 sha 面未检，不等于通过`, checked: 0 };
  }
  const map = resolve(toks.map((t) => t.sha));
  if (map === null) {
    return { findings: out, skipped: `D-5 git 读不到可达性（或返回行数对不上 ${String(toks.length)}）⇒ 台账 ${String(toks.length)} 条 sha 引用未检，不等于通过`, checked: toks.length };
  }
  for (const t of toks) {
    if (map.get(t.sha) === true) continue;
    if (t.sha in LEDGER_NON_REV) continue;
    out.push({ rule: "D-5", file: LEDGER_FILE, detail: `第 ${String(t.line)} 行引用的 sha 指向不存在的提交：${t.sha}` });
  }
  return { findings: out, skipped: null, checked: toks.length };
}

/* ------------------------------------------------------------------ D-9 凭证页 ↔ 取料面 */

/**
 * D-9：凭证页里那些"认证了多少条、墙钟多少秒"的读数，必须能在**该页自己点名的取料面**里找到原文。
 * 立这条的现读（第 228 页）：26 张能对上目录的凭证页里，严格式共抽到 93 个读数，
 * 4 个在它点名的目录里找不到原文（第 155 页 3 个、第 207 页 1 个）。
 * 三档不许同形：页没点名目录＝**未检**（迁移前的约定，不红）；点了名但目录/文件读不到＝**取不到**（也不红，但要说）；
 * 读得到而数对不上＝**红**（规则 249/211：凭证的等级取决于它能不能被回查）。
 */
export const CREDLEDGER_FILE = "PROGRESS.md";

/** 页里登记过、但取料面已无法回查的读数（逐条带理由，**只准调低**；不再命中即报 stale）。 */
export const UNSOURCED_READINGS: Readonly<Record<string, string>> = {
  "第 155 页|241": "2026-09-27 那趟 head-cert 的 `Test Files 241`；日志当时只落在 /tmp，没随页入库 ⇒ 数不必撤（它是当轮实测），但今天无法回查",
  "第 155 页|2847": "同上（`Tests 2847`）",
  "第 155 页|9.7": "同上（并行分片那一跑的墙钟）",
  "第 207 页|7.0": "第 207 页那句 `real 7.0` 出自当轮 stdout，未归档成 dated 工件",
  /* 第 275 页：新增四式（可比对／证人无身份行／未点名页／弱证）后按现读登记的存量。
     ⚠️ 这三条 `124` 的实情不是"日志丢了"，而是**页在引用一条被更正的旧声称**——
     第 265 页正文原文就写着「那几笔凭证都引了 `docs-check exit=0（可比对 124 个读数、红 0）`，而同一趟里『页未点名取料目录』从 29 涨到 35、可比对一动不…」，
     第 262 页也自己交代「本页落笔时只写了裸文件名，D-9 于是整页一个字没查，『可比对 124 个读数、红 0』对我这页并不成立」。
     ⇒ 抽取端分不出"我在断言这个数"与"我在引用一句被我判为假的断言"，这是**这条尺的已知边界**（不是漏洞的豁免口）：
       新页若真要把这种引用句写进正文，就照这里逐条登记并写清是哪一页的哪句被更正。 */
  "第 233 页|84": "第 233 页第 6 项那句 `可比对 84 个读数（红 0）` 出自当轮 stdout，那趟的门日志住在 /tmp 没随页入库 ⇒ 数是当轮实测，今天无法回查",
  "第 262 页|124": "引用被更正的旧声称（该页自己写明『D-9 当时整页一个字没查，可比对 124 对我这页并不成立』）⇒ 面上没有它的原文是正确形状",
  "第 264 页|124": "同上：第 264 页引的是那几笔凭证当时那句被第 265 页判为假的 `可比对 124 个读数、红 0`",
  "第 265 页|124": "同上：第 265 页正文就是这次更正的现场，`124` 出现在被指为假的那句引文里，不是本页现读",
};

/** 只认**严格式**：这三类的原文一定在日志里（`Test Files N passed`／`real Xs`／`针脚体检：N 条`…），
 *  散文里的数字（"17 处"、"帽 10"）不在本面射程内——把它们算进来＝拿语义猜测当判据。
 *  `Test Files`／`Tests` 后面必须是 `\s+` 而不是一个空格：**vitest 的汇总行按列对齐，实测印成
 *  `Test Files  1 passed (1)`、`Tests  102 passed (102)`（两个空格）**，写死一个空格 ⇒ 真机汇总抽不到数，
 *  那一格只能靠回查端的裸数位边界偶然兜住（第 265 页现读：已点名面里 4 条读数是这么"找到"的）。 */
export const CRED_NUMBER_RES: readonly RegExp[] = [
  /Test Files\s+(\d+) passed/u,
  /Tests\s+(\d+) passed/u,
  /\breal ([0-9]+(?:\.[0-9]+)?)/u,
  /本次耗时 ([0-9]+(?:\.[0-9]+)?)s/u,
  // 第 267 页：认证趟自己报的墙钟进对账面——凭证页里那句「本趟墙钟 X.XXs」从此有原文可对，
  // 而不是只有我手抄的那一行。现读存量＝0（台账里这句话还不存在），所以这一档不产生新红。
  /本趟墙钟 ([0-9]+(?:\.[0-9]+)?)s/u,
  /针脚体检：(\d+) 条/u,
  /跑了 (\d+)\/\d+ 条/u,
  /* 第 275 页：门自己那一行的四个数。动因不是抽象的"覆盖面广一点"，是我这两天**三次把这一行的分母写成推的**：
     第 273 页凭证先写 `证人无身份行 106 → 111`（现读 110）、第 274 页凭证先写 `可比对 214 → 222｜无身份行 110 → 116`
     （现读 221／114）。这四种句式**一定**在日志里逐字出现（就是 `docs-check` 自己印那一行），
     所以它们与上面七式同属"原文一定在面上"的严格族；纳进来之后，"我引了几处所以分母涨几"这种句子会当场红。
     ⚠️ 只认**右值**那一形（`… N 个读数`／`… N 对`／`… N 页`）：箭头左侧的历史值（`207 → 214` 里的 207）
     多是别的趟的留档，其日志未必在本页点名的目录里——把它们也抽进来就是拿语义猜测当判据（本文件上面那段注释的同一条纪律），
     而存量探针实测到的 5 条缺口已经全是"引用被更正的旧声称／当时没归档"那两类，见下面登记表逐条理由。 */
  /可比对 (\d+) 个读数/u,
  /证人无身份行 (\d+) 对/u,
  /未点名页 (\d+) 页/u,
  /弱证 (\d+) 对/u,
];

export interface CredPage {
  key: string;
  title: string;
  dirs: string[];
  numbers: string[];
  /** 这一页**自己提到**的提交号（7 位前缀，取自整段体里出现的 hex token）。
   *  口径要偏宽：只用来**放行**（证人身份在集合里＝强证），不用来制造红——
   *  写死几种句式会让「页换了措辞」变成一条假弱证。 */
  shas: string[];
  /** 这一页正文里点名的 dated 工件（目录以 `/` 结尾、文件为完整相对路径）。
   *  第 285 页 D-11 的取值域：**判据是「凭证页引的证人随没随页落库」⇒ 分面就按凭证页取**，
   *  不铺到整本台账（规则 345 的另一半：分面宽度按判据选，铺宽了存量代价是别人的旧账，不是我的）。
   *  抽法共用 `ledgerWitnessRefs`——同一条正则只有一份实现。 */
  refs: string[];
}

/** 凭证页＝标题含「凭证」的那几段；`key` 取「第 NNN 页」，比整条标题稳（改措辞不该让豁免失效）。
 *  第 290 页补⑴：标题谓词做成参数——D-11 的取值域从「凭证页」换成**整本台账**，而段落的切法与抽法必须还是同一份
 *  （规则 348：同一形状写第二遍，就是两个会各自漂的决策点；规则 345：分面宽度按判据选，这里判据变成
 *  「台账任何一页点名的证人都要追得到」，所以宽度跟着换，实现不换）。 */
export const CREDENTIAL_HEAD = (head: string): boolean => head.includes("凭证");
export const ANY_PAGE_HEAD = (): boolean => true;

export function ledgerPages(text: string, headFilter: (head: string) => boolean = CREDENTIAL_HEAD): CredPage[] {
  const lines = text.split("\n");
  const heads = lines.map((l, i) => [l, i] as const).filter(([l]) => /^### /u.test(l));
  const out: CredPage[] = [];
  heads.forEach(([head, start], n) => {
    if (!headFilter(head)) return;
    const end = n + 1 < heads.length ? heads[n + 1]![1] : lines.length;
    const body = lines.slice(start, end).join("\n");
    /* 取料目录名里的日期是 `YYYY-MM-DD`，**不能把月份写死**：
       这一行从前是 `[A-Za-z0-9._-]+-2026-09-\d{2}` ⇒ 跨过 9 月之后，凡是点名 `outputs/<主题>-2026-10-XX/` 的凭证页
       都抽不到目录，于是整页被判成「未点名取料目录＝未检」——门照印「红 0」，而它对**新月份的凭证一个字都没查**（第 257 页现读）。
       既有判卷清一色喂 `-2026-09-30` 的假件，所以这个盲区是结构上注定的（规则 237/242：计数尺要先喂真机、合成输入要显式两态不同形）。 */
    const dirs = [...new Set([...body.matchAll(DATED_DIR_RE)].map((m) => m[1]!))].sort();
    const numbers = new Set<string>();
    for (const re of CRED_NUMBER_RES) {
      for (const m of body.matchAll(new RegExp(re.source, "gu"))) numbers.add(m[1]!);
    }
    const key = /第 \d+ 页/u.exec(head)?.[0] ?? head.slice(0, 16);
    // 页提到的提交号：段体内所有 7～40 位 hex token（含 `本笔（\`sha\`）`、`@\`sha\``、`TREE=<sha>` 各种写法）。
    const shas = [...new Set([...body.matchAll(/\b([0-9a-f]{7,40})\b/gu)].map((m) => m[1]!.slice(0, 7)))].sort();
    out.push({ key, title: head.replace(/^### /u, ""), dirs, numbers: [...numbers].sort(), shas, refs: ledgerWitnessRefs(body) });
  });
  return out;
}

/** D-9 的老取值域：只看凭证页（读数是终态，只有凭证页承诺逐字可回查）。 */
export function credentialPages(text: string): CredPage[] {
  return ledgerPages(text, CREDENTIAL_HEAD);
}

/** 回查端与抽取端共用**同一把谓词**（第 266 页，替换从前那支只按裸数位边界的 `hasNumber`）：
 *  ⑴ 先剥 ANSI——入库日志带色，真机字节是 `Tests ^[[22m ^[[1m^[[32m101 passed`，转义序列正好夹在关键词与数字之间：
 *     严格式贴不住、而裸数位照样命中 ⇒ 两端各说各话（第 265 页把这 6 条误归因成「靠散文顶住」，现读推翻）。
 *  ⑵ 只认 `CRED_NUMBER_RES` 的整句形状——与凭证页抽读数用的是同一张表；面上别处出现这个数**不算**原文
 *     （从前算：散文里一句「帽 10」就能替读数 10 作证，规则 242/262）。
 *  剥色共用 `lib/vitest-summary` 那份：本仓曾有三门各自内建、漂过一次（那文件的头注释就是证人）。
 *  数位边界这一半由集合的精确成员关系给：面上只有 `2410` 时，读数 `241` 不在集合里（前身的 `includes` 退化仍会红）。 */
export function sourcedReadings(face: string): Set<string> {
  const out = new Set<string>();
  const clean = stripAnsi(face);
  for (const re of CRED_NUMBER_RES) for (const m of clean.matchAll(new RegExp(re.source, "gu"))) out.add(m[1]!);
  return out;
}

/** 取料面按**文件**交给这一格（从前只交一整块拼起来的文本）：弱证那一档要问的是「这行原文出自哪个文件」，
 *  拼完就问不出来了（第 269 页）。 */
export interface CredFaceFile {
  name: string;
  text: string;
}

/** 一个工件属于**哪一趟**：只认 `head-cert` 自己印的两行结构化形状，不按子串、不认散文里的 sha。
 *  第 268 页的教训——子串身份判据会被我自己的探针日志（它原样印出台账 sha）冒充证人。 */
export const CRED_RUN_SHA_RES: readonly RegExp[] = [
  /目标提交：([0-9a-f]{7,40})/u,
  /已核：TREE=([0-9a-f]{7,40})/u,
];
export function credRunShas(text: string): string[] {
  const clean = stripAnsi(text);
  const out = new Set<string>();
  for (const re of CRED_RUN_SHA_RES) for (const m of clean.matchAll(new RegExp(re.source, "gu"))) out.add(m[1]!.slice(0, 7));
  return [...out].sort();
}

/** 弱证＝读数在页点名的面里**确有原文**，但那几行原文所在文件的身份行不属于本页提到的任何一趟。
 *  现读登记（第 269 页，`identity.mts` 扫全仓 durable 面的第一把读数）：**只准调低**。
 *  存量两种责任都要在这里说清，否则帽会被读成「全是缺陷」：
 *  ① 合法跨趟引用（页里明说「上一笔同结构认证」，但没写那一笔的 sha——第 226 页 `real 158.55s`）；
 *  ② 真错指（页声称认证 `10bf910`，面上唯一的日志写着 `目标提交：3b3d001`——第 255 页的 `256`／`3356`）。
 *  前者要靠补 sha 把它变强证，后者要么补工件要么更正那一页——都不许靠调大帽解决。
 *  历次降帽（每一次都要同笔动那支钉着本行数字的锚点，规则 229）：
 *  8（第 269 页第一次登记）→ **0**（第 270 页：三处页里补上被引用那一趟的提交号、一处更正 `10bf910` 那句 sha，
 *  弱证清零）。同页还把判据收紧了一格：「面上既有别趟原文、也有没印身份的原文」改判为**无从判**——
 *  那 3 对本来就不该算缺陷（判卷日志与 needles 日志压根不印提交号）。 */
export const CRED_WEAK_WITNESS_CAP = 0;
/** 「写了凭证却没点名取料目录」这一档从前是一个混数：里面既有**还能补点名**的页（工件其实还在盘上），
 *  也有**当年工件就没入库**的页（今天补不了，只能登记）。两样的责任不同，混在一个数里就既不能行动也不能结案
 *  （规则 239/300：三态分开印；第 268 页 `sweep.mts` 现读证实：未点名 9 页／19 条读数在 814 份 dated 文件里 0 证人）。
 *  所以这里拆两态：
 *  ⑴ **可行动**＝既没点名、又没登记 ⇒ 进 `unnamedPages`，受 `CRED_UNNAMED_PAGE_CAP` 管，超出即红；
 *  ⑵ **已登记**＝在 `UNSOURCED_CRED_PAGES` 里 ⇒ 离开帽那一档，但每页必须带理由，且一旦这页真的点名的目录就报 stale。
 *  历次降帽（每一次都要同笔改那支钉着本行数字的锚点，规则 229）：11（第 265 页点名自己三页）→ 9（第 268 页点名第 167、257 页）
 *  → **0**（第 271 页：剩下 9 页逐页登记不可回查，可行动那一态清零）。 */
export const CRED_UNNAMED_PAGE_CAP = 0;

/** 已登记「工件当年没随页入库、今天无法回查」的凭证页。**按页**记（key＝`第 NNN 页`），逐页带理由，只准调低：
 *  每登记一页都要有现读撑着（`outputs/cred-unrecoverable-sweep-2026-10-01/sweep.log`），不是拿来躲红的。
 *  登记只声明"这一页的回查不成立"，**不声明**页里那些数是错的——它们是当轮实测，只是没了来源。 */
export const UNSOURCED_CRED_PAGES: Readonly<Record<string, string>> = {
  "第 155 页": "2026-09-27 那趟（`241`／`2847`／`9.7`）：汇总与墙钟只落 /tmp，没随页入库。2026-10-01 `sweep.mts` 扫 814 份 dated 文件 ⇒ `2847`、`9.7` 零证人；`241` 只在别趟（`1c40df7`）的汇总里同值出现，不算本页原文。",
  "第 158 页": "2026-09-27 那趟（`2367.1`／`879`）：同上，两条在 dated 面里 0 证人。登记只声明无来源，不声明数错。",
  "第 160 页": "2026-09-27 那趟（`241`／`2867`）：`2867` 0 证人；`241` 只有别趟同值。认证树锁那一笔的汇总日志没入库。",
  "第 161 页": "2026-09-28 那趟（`241`／`2883`）：`2883` 0 证人；`241` 只有别趟同值。",
  "第 163 页": "2026-09-28 那趟（`241`／`2904`）：`2904` 0 证人；`241` 只有别趟同值。",
  "第 164 页": "2026-09-28 那趟（`241`／`2911`）：`2911` 0 证人；`241` 只有别趟同值。清场读数那一笔的日志未入库。",
  "第 165 页": "2026-09-28 那趟（`1054.4`／`241`／`2912`）：`1054.4`、`2912` 0 证人；`241` 只有别趟同值。判卷提速那一笔只留了会话时间戳。",
  "第 166 页": "2026-09-28 那趟（`21479.7`）：一条 `real`，0 证人——`--no-optional-locks` 那把尺的跑批日志当年没入库。",
  "第 168 页": "2026-09-28 那趟（`241`／`2922`）：本笔认证 `03af5f5`，而盘上唯一同值的汇总属 `1c40df7`（第 268 页 `dir-hunt` 曾把它当候选，正是数值巧合）。",
  /* 第 275 页新增的一格，理由必须写成实情而不是「日志丢了」：**证人其实在盘上**。
     `59` 的原文在 `outputs/credential-source-audit-2026-09-30/docs-check-with-d9.txt`，
     但 D-9 只看**本页点名的目录**，而第 228 页一个都没点——它是「D-9 把凭证页与它自己点名的取料面对账」那笔的落地页，
     标题里的「凭证」二字是在**说这件事**，被『标题含凭证』这条页选择判据误收成凭证页。
     ⇒ 登记成不可回查是这条尺当下的边界代价；收窄选择判据（让非凭证页不再受管）另立任务，不混进这一笔。 */
  "第 228 页": "同号两段（落地页『#46 落地：D-9 把凭证页…』与『第 228 页补 凭证』）共用一个 key：落地页不点名目录，那句 59 的原文在 credential-source-audit-2026-09-30 里但不在它点名的面上",
};
/** 登记页的理由最低长度——空串或一句话敷衍（「没了」）等于没登记；这条是登记表自己的棘轮。 */
export const CRED_PAGE_WAIVER_MIN_REASON_CHARS = 24;

/** 弱证的一行：页 key＋读数＋顶上它的那几个文件（含那些文件自己声明的趟号）。 */
export interface CredWeakWitness {
  key: string;
  num: string;
  files: string[];
  runs: string[];
}

/** D-9 取料面的**唯一构造器**（第 284 页）。
 *  为什么必须存在：`outputs/cred-face-coverage-2026-10-01/cred-face.mts` 从前自己抄了一份"读面"的写法
 *  （返回拼好的整块字符串），第 269 页把面改成按文件之后，那份副本**静默烂掉**——本仓没人重跑它，
 *  直到第 284 页现跑才炸（`x.list.map is not a function`）。
 *  ⇒ 接口漂移只有"共用构造器"拦得住；在探针头上写一句"与门一致"不算（同族教训：注释不是实现）。
 *  口径与从前逐字相同：非递归、排除 `.mjs`（那是探针脚本自己，不进面）、读不到的文件交空文本而不是把文件丢掉。 */
export function credFaceFiles(root: string, dir: string): CredFaceFile[] | null {
  const abs = join(root, "outputs", dir);
  if (!existsSync(abs)) return null;
  try {
    return readdirSync(abs).filter((f) => !f.endsWith(".mjs")).map((f) => {
      let text = "";
      try { text = readFileSync(join(abs, f), "utf8"); } catch { text = ""; }
      return { name: f, text };
    });
  } catch { return null; }
}

export function checkCredentialSources(
  pages: readonly CredPage[],
  readFace: (dir: string) => CredFaceFile[] | null,
  waivers: Readonly<Record<string, string>> = UNSOURCED_READINGS,
  cap: number = CRED_UNNAMED_PAGE_CAP,
  weakCap: number = CRED_WEAK_WITNESS_CAP,
  /** 登记表在**调用点**注入（不在这里给默认值）：单元测试要能拿空表跑，否则每加一页登记都会给所有合成面报一轮"该删"。 */
  pageWaivers: Readonly<Record<string, string>> = {},
): { findings: Finding[]; checked: number; unmatched: number; unnamed: number; unnamedPages: string[]; registeredPages: string[]; registeredReadings: number; weak: CredWeakWitness[]; weakUnjudged: number } {
  const out: Finding[] = [];
  const seenKeys = new Set<string>();
  const unnamedPageKeys = new Set<string>();
  const registeredPageKeys = new Set<string>();
  const weak: CredWeakWitness[] = [];
  let checked = 0;
  let unmatched = 0;
  let unnamed = 0;
  let registeredReadings = 0;
  let weakUnjudged = 0;
  /* 页 key 到页实例的计数（第 275 页）：`key` 只取「第 NNN 页」，而**同一个号可以有两段**——
     第 228 页既有「#46 落地：D-9 把凭证页与它自己点名的取料面对账」（标题里有『凭证』二字，是在**说这件事**）
     又有「第 228 页补 凭证」。选择判据故意宽（凭证页的标题写法有十来种，收窄会漏掉真页——现测：严格式『第 NNN 页[补]凭证』只收 44／62 段），
     代价就是 key 会撞。从前这里用一只 `Set` 记"这个 key 点过名"，于是**同号的另一页一点名，登记就被判成"该删"**——
     那是在替另一页说话。改成计数：只有**该 key 下每一页都点了名**，登记才算过期。 */
  const keyTotal = new Map<string, number>();
  const keyNamed = new Map<string, number>();
  for (const p of pages) {
    if (p.numbers.length === 0) continue;
    keyTotal.set(p.key, (keyTotal.get(p.key) ?? 0) + 1);
    if (p.dirs.length > 0) keyNamed.set(p.key, (keyNamed.get(p.key) ?? 0) + 1);
  }
  for (const p of pages) {
    if (p.numbers.length === 0) continue;
    // 未检的两档（页没点名／点了名但读不到）也要把该页的豁免记成"仍然用得上"——
    // 否则第 155 页那种迁移前的老页会同时落进"未检"和"豁免已不再命中"，两句话互相打脸。
    const unverifiable = (): void => { for (const n of p.numbers) seenKeys.add(`${p.key}|${n}`); };
    if (p.dirs.length === 0) {
      // 两态分开：登记过的进『已登记』，没登记的才是"能补而没补"，只有后者受帽管。
      if (p.key in pageWaivers) {
        registeredPageKeys.add(p.key);
        registeredReadings += p.numbers.length;
      } else {
        unnamedPageKeys.add(p.key);
        unnamed += p.numbers.length;
      }
      unverifiable();
      continue;
    }
    const blobs = p.dirs.map(readFace);
    if (blobs.every((b) => b === null)) { unmatched += p.numbers.length; unverifiable(); continue; }   // 取不到＝未检，也不红
    /* 按文件算一份"这个文件里有哪些读数、它属于哪一趟"，页内多条数共用。
       从前这里只拼一整块文本 ⇒ 能问出「数在不在面上」，问不出「是谁替这个数作的证」（第 269 页）。
       读数集合取各文件的并集，与从前拼块再抽的差别只在**跨文件边界的拼接形状**上：那种匹配本就不算原文。 */
    const perFile = p.dirs
      .map((d, i) => ({ dir: d, list: blobs[i] }))
      .flatMap((x) => (x.list === null
        ? []
        : x.list.map((f) => ({ where: `${x.dir}/${f.name}`, nums: sourcedReadings(f.text), runs: credRunShas(f.text) }))));
    const found = new Set<string>(perFile.flatMap((f) => [...f.nums]));
    for (const num of p.numbers) {
      checked++;
      const waiverKey = `${p.key}|${num}`;
      const sourced = found.has(num);
      const waived = waiverKey in waivers;
      // 取料面已经能顶住的那条，豁免就成了多余登记——留着的代价是"下一位读者以为这数仍查不到"。
      if (waived && sourced) seenKeys.add(waiverKey + "|已入库");
      if (sourced) {
        const witnesses = perFile.filter((f) => f.nums.has(num));
        const identified = witnesses.filter((f) => f.runs.length > 0);
        if (identified.some((f) => f.runs.some((r) => p.shas.includes(r)))) {
          // 强证：本页那一趟的工件里就有这句原文——别处再有什么不算数，这一格不再往下问。
        } else if (identified.length === 0 || witnesses.length > identified.length) {
          // 两种"判不了"：面上压根没有身份行；或者既有别趟的原文、也有没印身份的原文——
          // 后者不能算弱证：那条没身份的日志（判卷日志、needles 日志）本来就是本页最可能的出处，
          // 拿一份带身份行的别趟日志去指控它，是这条尺的过度主张（第 270 页现读：8 对里有 3 对是这个形状）。
          weakUnjudged++;
        } else {
          weak.push({
            key: p.key, num,
            files: identified.map((f) => f.where),
            runs: [...new Set(identified.flatMap((f) => f.runs))].sort(),
          });
        }
        continue;
      }
      if (waived) { seenKeys.add(waiverKey); continue; }
      out.push({ rule: "D-9", file: CREDLEDGER_FILE, detail: `${p.key}（${p.title.slice(0, 28)}）里的读数「${num}」在它点名的取料面里找不到原文：${p.dirs.join("、")}` });
    }
  }
  for (const k of Object.keys(waivers)) {
    if (seenKeys.has(k + "|已入库")) {
      out.push({ rule: "D-9", file: CREDLEDGER_FILE, detail: `豁免 ${k} 已被取料面顶住，该删（理由曾写：${waivers[k]}）` });
      continue;
    }
    if (!seenKeys.has(k)) out.push({ rule: "D-9", file: CREDLEDGER_FILE, detail: `豁免里的 ${k} 已不再命中，该删（理由曾写：${waivers[k]}）` });
  }
  // 页级登记的两半：登记要真带来"这页不用回查了"，也要真退回——**该 key 下每一页都自己点名了目录**，登记才该删（第 275 页：同号两页时旧写法会替另一页说话）。
  for (const [key, reason] of Object.entries(pageWaivers)) {
    const total = keyTotal.get(key) ?? 0;
    const named = keyNamed.get(key) ?? 0;
    if (total > 0 && named === total) {
      out.push({ rule: "D-9", file: CREDLEDGER_FILE, detail: `登记 ${key} 已被它自己点名的取料目录顶住，该删（理由曾写：${reason.slice(0, 40)}）` });
      continue;
    }
    if (!registeredPageKeys.has(key)) {
      out.push({ rule: "D-9", file: CREDLEDGER_FILE, detail: `登记的 ${key} 在台账里已不再命中（没有读数或整段没了），该删` });
      continue;
    }
    if (reason.trim().length < CRED_PAGE_WAIVER_MIN_REASON_CHARS) {
      out.push({ rule: "D-9", file: CREDLEDGER_FILE, detail: `登记的 ${key} 理由只有 ${String(reason.trim().length)} 字（< ${String(CRED_PAGE_WAIVER_MIN_REASON_CHARS)}）⇒ 登记必须写清"当年为什么查不到"，空话等于没登记` });
    }
  }
  // 帽只在这一格**超出**时出声：等于现读不算红（登记＝承认存量，涨一格才算新账）。
  if (unnamedPageKeys.size > cap) {
    out.push({ rule: "D-9", file: CREDLEDGER_FILE,
      detail: `凭证页未点名取料目录 ${String(unnamedPageKeys.size)} 页 > 帽 ${String(cap)}（CRED_UNNAMED_PAGE_CAP，只准调低）⇒ 这是**可行动**那一态：既没点名 ` +
        `outputs/<主题>-YYYY-MM-DD/、又没进 UNSOURCED_CRED_PAGES 登记。新写的凭证页必须点名，工件确实没入库的要在登记表里写理由。最近的几页：${[...unnamedPageKeys].slice(-5).join("、")}` });
  }
  // 弱证同理：数量超出登记的那一格才红——「数对上了但证人属于别趟」是新账，旧账要么补 sha 要么更正页。
  if (weak.length > weakCap) {
    out.push({ rule: "D-9", file: CREDLEDGER_FILE,
      detail: `弱证 ${String(weak.length)} 对 > 帽 ${String(weakCap)}（CRED_WEAK_WITNESS_CAP，只准调低）⇒ 这些数在页点名的面里确有原文，可那几行出自**别的一趟**：`
        + weak.slice(0, 5).map((w) => `${w.key}｜读数 ${w.num}←${w.files.join("、")}（那一趟＝${w.runs.join("、")}）`).join("；")
        + `。修法只有两种：页里把被引用那一趟的提交号写出来，或把本页自己那趟的日志入库。` });
  }
  return { findings: out, checked, unmatched, unnamed, unnamedPages: [...unnamedPageKeys], registeredPages: [...registeredPageKeys], registeredReadings, weak, weakUnjudged };
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
import { stripAnsi } from "./lib/vitest-summary";

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

/** 一次 spawn 解完整批短 sha（230 个 token 实测 <0.05s）。
 *  为什么不复用上面那只逐个 `rev-parse` 的：那是一笔一 spawn，台账面会把这道**亚秒档门**顶到秒级，
 *  还会让"门的单价"由取料面条数决定（第 226 页刚把门面买成 20 道，别在这里偷偷加价）。
 *  行数与入参条数对不上 ⇒ 返回 null（宁缺不编：错位会把可达的读成不可达）。 */
function resolveRevsViaGit(toks: readonly string[]): Map<string, boolean> | null {
  if (toks.length === 0) return new Map();
  let out: string;
  try {
    out = execFileSync("git", ["cat-file", "--batch-check=%(objecttype)"], {
      cwd: ROOT, input: toks.map((t) => t + "^{commit}").join("\n") + "\n", encoding: "utf8",
    });
  } catch {
    return null;
  }
  const lines = out.split("\n").filter((l) => l !== "");
  if (lines.length !== toks.length) return null;
  const map = new Map<string, boolean>();
  toks.forEach((t, i) => map.set(t, lines[i]!.trim() === "commit"));
  return map;
}

export function runDocsCheck(): {
  findings: Finding[]; skipped: string[]; waived: number; ledgerChecked: number;
  // 形状从被调用方派生，不在这儿第二次枚举：第 265 页加 `unnamedPages` 时这里漏改，vitest 全绿而 tsc 红
  // （`Property 'unnamedPages' does not exist`）——两份字段清单就是两次会漂的账。
  cred: ReturnType<typeof checkCredentialSources>;
  // 第 285 页 D-11：`null` ＝ 取不到 HEAD 跟踪清单（未检）。它跟「点名 0 条」是两件事，别混成一种绿。
  witness: ReturnType<typeof checkWitnessPaths> | null;
} {
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

  // D-5 第二张面：台账里的 sha 引用（`STATE.md` 不在的那天，这一格照样有 200+ 条可检）。
  let ledgerChecked = 0;
  let ledgerTracked: Set<string> | null = null;
  let credPages: CredPage[] = [];
  let witnessPages: CredPage[] = [];
  const ledgerAbs = join(ROOT, LEDGER_FILE);
  if (existsSync(ledgerAbs)) {
    const ledgerText = readFileSync(ledgerAbs, "utf8");
    const face = ledgerRevFace(ledgerText, resolveRevsViaGit);
    findings.push(...face.findings);
    ledgerChecked = face.checked;
    if (face.skipped !== null) skipped.push(face.skipped);
    // 凭证页只构造一次给 D-9；D-11 从第 290 页补⑴ 起吃**整本台账**（同一份 `ledgerPages`，只是标题谓词不同）。
    credPages = credentialPages(ledgerText);
    witnessPages = ledgerPages(ledgerText, ANY_PAGE_HEAD);
    // D-10（第 279 页）：台账里的源码行号引用要**追得到东西**。取不到 HEAD 清单时报"未检"，
    // 不许拿空集合当判据（那会把每一条引用都读成死指针——假红的量足以淹掉真信号）。
    // 第 285 页：同一份清单也喂 D-11 ⇒ 这一笔**没有新增子进程**，门还是那一次 `git ls-tree`。
    ledgerTracked = trackedFilesAtHead();
    if (ledgerTracked === null) skipped.push("D-10/D-11 " + LEDGER_FILE + " 的引用面未检（取不到 HEAD 跟踪清单），不等于通过");
    else findings.push(...checkSourceLineCitations(ledgerText, ledgerTracked));
  } else {
    skipped.push(`D-5 ${LEDGER_FILE} 不存在 ⇒ 台账 sha 面整条未检，不等于通过`);
  }

  // D-9：凭证页的读数 ↔ 它自己点名的取料面（`outputs/<主题>-日期/` 里除脚本外的全部文件）。
  const cred = checkCredentialSources(
    credPages,
    (dir) => credFaceFiles(ROOT, dir),
    UNSOURCED_READINGS,
    CRED_UNNAMED_PAGE_CAP,
    CRED_WEAK_WITNESS_CAP,
    UNSOURCED_CRED_PAGES,
  );
  findings.push(...cred.findings);

  // D-11（第 285 页上线，第 290 页补⑴ 把取值域换成整本台账）：台账点名的 dated 证人必须追得到 HEAD——
  // 同一次 `git ls-tree`，与 D-10 共用取料面，不新增子进程。
  const witness = ledgerTracked === null ? null : checkWitnessPaths(witnessPages, ledgerTracked);
  if (witness !== null) findings.push(...witness.findings);

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
    ledgerChecked,
    cred,
    witness,
  };
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;

if (invokedDirectly) {
  const { findings, skipped, waived, ledgerChecked, cred, witness } = runDocsCheck();
  const byRule = new Map<string, number>();
  for (const f of findings) {
    byRule.set(f.rule, (byRule.get(f.rule) ?? 0) + 1);
    console.log(`  ❌ ${f.rule} ${f.file}\n     ${f.detail}`);
  }
  for (const s of skipped) console.log("  ℹ️  跳过 " + s);
  // 分母要印出来：抽到 0 条与"全绿"不许同形（规则 261），豁免数也不许藏在源码里。
  console.log(`  台账 sha 面：抽到 ${String(ledgerChecked)} 条候选｜非提交形而带理由豁免 ${String(Object.keys(LEDGER_NON_REV).length)} 条`);
  // 三个分母各说各的口径（规则 262）：可比对／页没点名（未检）／点了名但目录读不到（取不到）。
  // 「未检」要能归到页：只有条数没人知道是哪几页 ⇒ 第 265 页补上按页的第四档与帽。
  console.log(`  凭证对账面：可比对 ${String(cred.checked)} 个读数（红 ${String(cred.findings.length)}）`
    + `｜页未点名取料目录 ${String(cred.unnamed)} 个＝未检｜未点名页 ${String(cred.unnamedPages.length)} 页（帽 ${String(CRED_UNNAMED_PAGE_CAP)}，只准调低）`
    + `｜点名但目录读不到 ${String(cred.unmatched)} 个＝取不到｜登记不可回查 ${String(Object.keys(UNSOURCED_READINGS).length)} 条`
    + `｜弱证 ${String(cred.weak.length)} 对（帽 ${String(CRED_WEAK_WITNESS_CAP)}，只准调低）｜证人无身份行 ${String(cred.weakUnjudged)} 对＝这一格无从判`
    + `｜已登记不可回查 ${String(cred.registeredPages.length)} 页／${String(cred.registeredReadings)} 条`);
  // D-11 的三态（规则 239）：未检（取不到 HEAD 清单）／点名条数／红。红 0 与「压根没点名」也不同形。
  console.log(witness === null
    ? "  证人点名面（整本台账）：未检（取不到 HEAD 跟踪清单），不等于通过"
    : `  证人点名面（整本台账）：${String(witness.pages)} 页点名 ${String(witness.refs)} 条 dated 工件（红 ${String(witness.findings.length)}）`
      + `｜登记 ${String(LEGACY_WITNESS_REFS.length)} 条（帽，只准调低）`);
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
