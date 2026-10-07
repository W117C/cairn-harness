/** 认证读数的"可引用性"这一格（第 334 页，任务 #41 的第一半）。
 *
 * 动因不是设计洁癖，是这一会话里**手工做了三次**同一件事：把 `/tmp/dsh-head-cert-<rev>/test.log`
 * 与 `summary.txt` 抄进 dated 工件目录，好在凭证页引用（有一次没抄，被 D-9 判红「读数在点名的
 * 取料面里找不到原文」）。而凭证页最爱引用的恰恰是**时间量**（墙钟、门耗时、杀锚用时），
 * 那些数只在「两端独占」时才成立——今天这件事靠人记住（规则 209/211 那一族）。
 * ⇒ 让被度量者自己把「这一趟的温度＋它打出来的读数」落成一份可入库的工件。
 *
 * 形状纪律：本模块**不碰盘、不起进程**，纯函数；取料（`spoken` 那些已经印出来的行、并发套数、
 * 收尾复核）由调用方交进来，且交的是**它已经算出来的那些值**——不在这份文件里再 parse 一遍 stdout。
 * 三态里最贵的「不可知」必须显式存在：判卷被 `--skip-test` 跳过时并发数取不到，
 * 那不能读成「0 ⇒ 独占 ⇒ 可引用」（规则 239/196）。 */

export type Citable = "citable" | "loaded" | "unknown";

/** 两端独占才算可引用。`measured` ＝ 这一趟真的跑了全量判卷（`--skip-test` 时并发面没有读数）。 */
export function citableOf(before: number, after: number, measured: boolean): Citable {
  if (!measured || before < 0 || after < 0) return "unknown";
  return before === 0 && after === 0 ? "citable" : "loaded";
}

const CITABLE_LINE: Record<Citable, string> = {
  citable: "温度＝两端独占 ⇒ **时间量可以引用**（墙钟／门耗时／杀锚用时）",
  loaded: "温度＝有别人在跑 ⇒ **时间量不可引用**，只能引用「这一趟慢」；条数与红名仍可用",
  unknown: "温度＝不可知（判卷没跑，或并发面取不到）⇒ 不许由 0 顶成「独占」，时间量一律不引用",
};
export function citableLine(c: Citable): string {
  return CITABLE_LINE[c];
}

/** 落盘的那份文档：头部是可判的三态、生成时刻与出处，正文是**认证自己打出来的那些行**（原样，不改写、不摘要）。 */
export function provenanceDoc(o: {
  rev: string;
  citable: Citable;
  drift: string | null;
  stamp: string;
  lines: readonly string[];
}): string {
  const head = [
    `# 认证读数 · rev ${o.rev.slice(0, 7)}`,
    `- 生成时刻=${o.stamp}（UTC。台账页按本地日期，跨零点时页号与这里差一天，不是写错了）`,
    `- ${citableLine(o.citable)}`,
    `- 收尾复核=${o.drift ?? "同一笔"}`,
    `- 判据：两端独占＝「起前 0 且跑完 0 且这一趟真跑了全量判卷」；本页引用时间量前先回看这一行`,
    ``,
    `## 认证打出来的读数（原样，未改写）`,
    ``,
    "```text",
  ];
  return head.join("\n") + "\n" + o.lines.join("\n") + "\n```\n";
}

/** 目录名里的时间戳：ISO `2026-10-03T15:55:51.022Z` ⇒ `2026-10-03-1555`。
 *  为什么也做成函数（第 334 页冒烟实测逼出来的）：第一版把 `.replace("T","-").slice(0,16)` 写在调用方，
 *  判卷只喂了"格式良好的串"，于是**冒号漏进目录名**（`head-cert-dfaa2d1-2026-10-03-15:55`）——
 *  只有真跑一次才看得见。精度到分钟就够（同一分钟内的两次复跑才会撞名，而那一趟的温度也不会差）。 */
export function provenanceStamp(iso: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/u.exec(iso);
  // 取不到形状也要有出路，但不能拼出一个含冒号的目录名（那是第一版的错）——写死一个可 grep 的假值名。
  return m === null ? "未知时刻" : `${m[1]}-${m[2]}${m[3]}`;
}

/** 落在哪：dated 工件目录，名字带 rev 与时间戳（同一笔复跑两次不许互相盖掉——
 *  负载那一趟与独占那一趟的差别恰恰是这份文件要留下的东西）。 */
export function provenancePath(root: string, rev: string, stamp: string): string {
  return [root, "outputs", `head-cert-${rev.slice(0, 7)}-${stamp}`, "provenance.md"].join("/");
}

/** 认证判决的输入面（第 426 页，任务 #14）。
 *  动因是**同一个疏忽连写三页**：第 421／423／425 页凭证都写「`HEADCERT_EXIT` 是 nohup 起的、没直取」，
 *  而门本来就已经算出那个码——只差没把它自己印进读数行（`spoken` 同时进 stdout、`summary.txt` 与 provenance，
 *  所以印一次三处都有）。按「重复疏忽要搬进工具」的口径，这一格不许再靠人记 `$?`。
 *  形状纪律：判决与那句读数**共用这一份函数**（调用方不许在外面再写一遍 `&&` 串——那是第二份事实源，
 *  也是本仓点名过多次的「构造面与验证面各算一遍」形状）。 */
export interface CertOutcome {
  /** 依赖是否补齐（借不到包＝这一趟不构成认证，不可归因于代码）。 */
  depsComplete: boolean;
  typecheckOk: boolean;
  /** `null` ＝ 这一趟按 `--skip-test` 跳过了全量判卷：这一维**既不算红也不算证过**（等级由「认证等级」那行说）。 */
  testStatus: number | null;
  /** 认证门面（`CERT_GATES`）里退出码非 0 的道数。 */
  gateRedCount: number;
  /** 判卷四面相对自己 HEAD 的在飞项数——非 0 就不是 HEAD-only 读数。 */
  dirtyJudged: number;
  /** 收尾复核发现树被切走 ⇒ **读数作废**：第三种态，既不是「HEAD 红」也不是绿。 */
  treeDrifted: boolean;
}

/** 逐维点名，读不出的维不许折进「一切正常」；`treeDrifted` 不在这里（它不是「红」，是作废）。 */
export function certFailingDims(o: CertOutcome): string[] {
  const out: string[] = [];
  if (!o.depsComplete) out.push("依赖不全");
  if (!o.typecheckOk) out.push("typecheck 非 0");
  if (o.testStatus !== null && o.testStatus !== 0) out.push(`判卷 exit=${String(o.testStatus)}`);
  if (o.gateRedCount > 0) out.push(`认证门面红 ${String(o.gateRedCount)} 道`);
  if (o.dirtyJudged !== 0) out.push(`判卷四面在飞 ${String(o.dirtyJudged)} 项`);
  return out;
}

export function certExitCode(o: CertOutcome): 0 | 1 {
  return certFailingDims(o).length === 0 && !o.treeDrifted ? 0 : 1;
}

/** 那一格读数：码 ＋ **这是谁的码** ＋ 为什么。
 *  点名归属不是啰嗦：汇总里已经有一行 `exit=1（退出码直接取）`，那是**跑进去的 test runner** 的码；
 *  两个码同屏而不说归属，凭证页就会把其中一个抄成另一个（第 425 页就是这么差点写错的）。 */
export function certExitCodeCell(o: CertOutcome): string {
  const who = "这是 head-cert 这道门自己的码，不是它跑进去的 test runner 的码";
  const code = certExitCode(o);
  if (code === 0) return `本次退出码=0（${who}）｜判决输入六维全过`;
  const dims = certFailingDims(o);
  if (o.treeDrifted) {
    return `本次退出码=1（${who}）｜读数作废（收尾复核发现树被切走）——这一格既不算「HEAD 红」也不算绿`
      + (dims.length > 0 ? `；同趟另有红的维：${dims.join("、")}` : "");
  }
  return `本次退出码=1（${who}）｜红的维：${dims.join("、")}`;
}
