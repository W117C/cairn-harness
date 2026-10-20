// 可复现性判据：同一输入必须产出同一份**被判卷的东西**。
//
// 为什么单独立一层（不是洁癖）：本仓的真相源是事件流——「先记账后执行」、增量重放、靶场逐字段比对、
// 反事实 fork 全都建立在「重跑一次应当逐字一样」上。而 agent harness 这一类系统在业界出名的痛就是
// **跑不出两遍一样的**（评测因此只能靠多次取均值）。一旦 wall-clock 或随机数漏进**身份字段**，
// 破坏是静默的：功能测试全绿，判卷层开始飘。
//
// 本格的第一条活证据是 BLOCKED 待办 #56：D7 的快照路径把 `Date.now()` 编进了目录名 ⇒
// `changedFiles` 两次跑只差一串毫秒，`gym-check` B1「明卷两次跑逐字段一致」当场红 4 条。
// 注意它**不是** D7 的错，是「身份字段可以带时钟」这个漏洞没人守。
//
// 口径：
// - `ts`（事件上的可选时间戳）**只准用于观测**：任何人拿它参与投影/判定/身份，都算泄漏。
//   本仓今天没有任何代码读 `ts`——这条把「今天成立」钉成「一直成立」。
// - 已知的债走**会过期的白名单**：每条债必须真的命中，不命中就红（债偿了就要删条目，
//   否则白名单变成下一个漏洞的藏身处）。
//
// 叶子模块：零运行时依赖，门与测例共用同一只判据。

export interface FieldDiff {
  /** JSON 路径，如 `changedFiles[2]` 或 `output.summary`。 */
  path: string;
  left: string;
  right: string;
}

/** 两份结构逐字段比，返回差异路径（值截断，别把 100KB 塞进日志）。 */
export function diffJsonPaths(a: unknown, b: unknown, path = "", limit = 40): FieldDiff[] {
  const out: FieldDiff[] = [];
  const show = (v: unknown): string => {
    const s = typeof v === "string" ? v : JSON.stringify(v) ?? String(v);
    return s.length > 160 ? s.slice(0, 80) + "…" + s.slice(-40) : s;
  };
  const walk = (x: unknown, y: unknown, p: string): void => {
    if (out.length >= limit) return;
    if (Array.isArray(x) && Array.isArray(y)) {
      if (x.length !== y.length) out.push({ path: p + ".length", left: String(x.length), right: String(y.length) });
      for (let i = 0; i < Math.min(x.length, y.length); i++) walk(x[i], y[i], p + "[" + String(i) + "]");
      return;
    }
    if (x !== null && typeof x === "object" && y !== null && typeof y === "object") {
      const kx = x as Record<string, unknown>;
      const ky = y as Record<string, unknown>;
      for (const k of new Set([...Object.keys(kx), ...Object.keys(ky)])) walk(kx[k], ky[k], p === "" ? k : p + "." + k);
      return;
    }
    if (x !== y) out.push({ path: p === "" ? "<root>" : p, left: show(x), right: show(y) });
  };
  walk(a, b, path);
  return out;
}

const MS_EPOCH = /\b1[0-9]{12}\b/;

/** 这个值像不像「被编进身份的 wall-clock」：13 位毫秒时间戳。
 *  只认这一形态是故意的——先抓住真出过事的那一类，别一上来写一条读不懂的大网。 */
export function containsWallClock(v: unknown): boolean {
  if (typeof v === "number") return v >= 1e12 && v < 3e12;
  if (typeof v === "string") return MS_EPOCH.test(v);
  if (Array.isArray(v)) return v.some((x) => containsWallClock(x));
  return false;
}

/** 去掉只供观测的字段（`ts`），留下被判卷读的那一份。 */
export function stripObservation<T extends Record<string, unknown>>(event: T): T {
  const { ts: _ts, ...rest } = event;
  return rest as T;
}

/** 差异是否**只**在毫秒这一段（其余逐字相同）——这是「债可被吸收」的准确含义。 */
export function differsOnlyByWallClock(left: string, right: string): boolean {
  if (!MS_EPOCH.test(left) || !MS_EPOCH.test(right)) return false;
  return left.replace(new RegExp(MS_EPOCH.source, "g"), "<ms>") === right.replace(new RegExp(MS_EPOCH.source, "g"), "<ms>");
}

export interface IdentityDebt {
  id: string;
  /** 差异路径必须落在这个前缀里（如 `changedFiles[...]`）。 */
  pathPrefix: string;
  /** 清偿条件写在代码里：门会用它提醒人删条目。 */
  paidWhen: string;
  why: string;
}

/** 已知并登记的身份债。**登记 = 认领 + 到期条件**，不是免罪：
 *  命中几处会在门的读数里如实打印，#56 修好后这些条目就该删（分类器那条复查会指出没被用到的条目）。 */
export const IDENTITY_DEBTS: readonly IdentityDebt[] = [
  {
    id: "D7-snapshot-path-ms",
    pathPrefix: "changedFiles[",
    paidWhen: "快照路径不再含毫秒（BLOCKED 待办 #56 选 A：changedFiles 排除 .agent/snapshots/**；或选 B：snapshotIdOf 不含 Date.now()）",
    why: "D7 覆盖前快照的目录名带 Date.now()（`src/tools/snapshot.ts` 的 `snapshotIdOf`），两次跑必然差一串毫秒",
  },
  {
    // 同一条债的**另一半**，而且是更要紧的那半：毫秒不只进了判卷字段，还进了**模型每轮看到的文本**。
    // 实测（本轮 `replay-determinism-check`）：同一次覆盖两次跑，`ToolResult.output` 差一串毫秒
    // ⇒ 每次覆盖都让已发出的前缀多断一段（与 prefix-churn 那格同一族代价），且 e2e/靶面逐字段比对必红。
    id: "D7-snapshot-note-ms",
    pathPrefix: "result.",
    paidWhen: "快照提示与 snapshotId 都不含毫秒：提示里只给「同一会话内可复取的路径」（例如 callId + 相对路径），或 changedFiles/output 走 #56 的修法 A",
    why: "`snapshotNote(id)` 把含毫秒的路径拼进 write_file 的 output（模型可见文本），两次跑逐字不同",
  },
];

export interface DebtFinding {
  absorbed: string[];
  staleDebts: string[];
  leaks: FieldDiff[];
}

/** 把差异分类：被登记的债吸收 / 债已偿但条目还在 / 新泄漏。 */
export function classifyDivergence(diffs: readonly FieldDiff[], debts: readonly IdentityDebt[] = IDENTITY_DEBTS): DebtFinding {
  const absorbed: string[] = [];
  const leaks: FieldDiff[] = [];
  const hitDebts = new Set<string>();
  for (const d of diffs) {
    const debt = debts.find((x) => d.path.startsWith(x.pathPrefix) && differsOnlyByWallClock(d.left, d.right));
    if (debt) {
      hitDebts.add(debt.id);
      absorbed.push(debt.id);
      continue;
    }
    leaks.push(d);
  }
  return {
    absorbed: [...new Set(absorbed)],
    staleDebts: debts.filter((x) => !hitDebts.has(x.id)).map((x) => x.id),
    leaks,
  };
}

/** 一份读数是否可复现。
 *  `requireDebtHit` 只对「专门复查登记表」的那条判据开：一次普通的两次跑比对**不该**因为
 *  「这次没踩到那条债」而红——第一版我把这条全局打开，于是干净的 HEAD（根本没有快照代码）
 *  被读成红。一条会冤枉好状态的判据，比没有判据更糟。 */
export function reproducibleVerdict(finding: DebtFinding, opts: { requireDebtHit?: boolean } = {}): { ok: boolean; detail: string } {
  // 单一判定源：**说出来的一句话与放行/判红必须是同一个式子**。
  // 分成两处写时，「把复查对所有判据打开」这个变异只改到文案、改不到 ok ⇒ 针脚存活、门也骗过了测例。
  const staleProblem = opts.requireDebtHit === true && finding.staleDebts.length > 0;
  const ok = finding.leaks.length === 0 && !staleProblem;
  const bits: string[] = [];
  if (finding.leaks.length > 0) {
    bits.push("新泄漏 " + String(finding.leaks.length) + " 处：" +
      finding.leaks.slice(0, 3).map((l) => l.path + " " + l.left + " ≠ " + l.right).join("；"));
  }
  if (staleProblem) bits.push("登记的身份债没命中（该删条目了）：" + finding.staleDebts.join("、"));
  if (bits.length === 0) {
    bits.push("两次跑逐字段等值（吸收登记债 " + String(finding.absorbed.length) + " 处" +
      (opts.requireDebtHit === true ? "，命中 " + String(finding.absorbed.length) + " 条债" : "") + "）");
  }
  return { ok, detail: bits.join("｜") };
}
