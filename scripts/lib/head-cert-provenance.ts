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
