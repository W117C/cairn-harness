/** 页号占号（第 243 页）。
 *
 *  动因：2026-09-30 一晚撞了三次（234／236／240），三次都不是有人不守规矩，而是**「现读最大＋1」这一读法在并发下必然竞态**：
 *  两个会话各自在 22:24、22:26 读到同一个最大值，隔两分钟写出同一页号。撞号只伤编号唯一性（内容无损），
 *  但每次都要靠事后补一笔"页号更正"声明来收拾，而那条声明本身又是台账上的一格噪声。
 *
 *  这一把尺的形状：**占号是一个原子动作，不是一个读法**。用 `mkdir` 的 EEXIST 语义（POSIX 原子）当占位符：
 *  谁先把 `.git/dsh-pages/<N>` 这个目录建出来，N 就归谁；建不出来就重新扫一遍再试。
 *  `.git` 是所有 worktree 共享的 ⇒ 号池跨树、跨会话，与 `dsh-tool-locks/` 同一个理由。
 *
 *  为什么不是"先读 HEAD 的页号再＋1"：那仍是读-改-写，两个会话都能读到同一份。
 *  为什么号池不放工作树文件：工作树每人一棵，写进去反而各占各的，还容易把别人的未提交内容卷走。 */
import { relative, resolve } from "node:path";

export const PAGE_CLAIM_START = 1;
/** 让位次数帽：超了就说明号池里有读不出/建不出的东西，宁可出声也不无限重试。 */
export const PAGE_CLAIM_MAX_ATTEMPTS = 50;

/** 下一个页号：**单调往上**（`max(已占) ＋ 1`，且不小于 `start`），不是"最小可用号"。
 *  写成最小可用会把手里的新会话发回 1——页号是历史序列，复用旧号（哪怕那一页已不在台账上）比撞新号更难查。
 *  脏值（非整数）不参与 max，否则一个 `NaN` 就把整条结论变成 `NaN`。 */
export function nextFreePage(taken: readonly number[], start: number = PAGE_CLAIM_START): number {
  let mx = start - 1;
  for (const n of taken) if (Number.isInteger(n) && n > mx) mx = n;
  return mx + 1;
}

/** `create` 的三态必须分开：`exists`＝别人先占了（要重新扫），`error`＝面取不到（要出声），
 *  这两种的修法相反（前者是正常竞争，后者是这台机器/权限的问题）。 */
export type CreateOutcome = "ok" | "exists" | "error";

export interface ClaimOps {
  /** 建号池目录（幂等）。抛错＝面取不到。 */
  ensureDir: (dir: string) => void;
  /** 列号池目录；`null`＝读不到（不存在或权限）。 */
  list: (dir: string) => string[] | null;
  /** 原子占位：`ok`＝占到了，`exists`＝已被占，`error`＝建不出来。 */
  create: (dir: string, name: string) => CreateOutcome;
}

export interface ClaimResult {
  /** 占到的页号；`null`＝这一格没量到（面取不到或让位次数用满），**不许当成"没有可用页号"**。 */
  page: number | null;
  /** 给人看的那一句：占到／让位 N 次后占到／取不到——三态不许同形（规则 261/262）。 */
  cell: string;
  /** 让位次数（每次 `exists` 计一次）。 */
  yielded: number;
}

/** 从号池目录名里取页号：只认纯数字目录名，别的（临时名、别人的文件）一律不算占位。 */
export function claimedPages(entries: readonly string[]): number[] {
  return entries.filter((n) => /^[0-9]+$/.test(n)).map((n) => Number(n));
}

/** 路径在不在那个根里面？**按目录边界比，不用裸前缀**（`/repo/.worktrees-backup/x` 带同一个前缀却不是自家人——
 *  与本仓 `insideScratchFace` 同一条规矩，第十族：前缀匹配要按位置枚举变体）。空根＝没取到，回 false 让调用方出声。 */
export function insideRepo(path: string, root: string): boolean {
  if (root === "" || path === "") return false;
  const rel = relative(resolve(root), resolve(path));
  return rel !== "" && !rel.startsWith("..") && !rel.startsWith("/");
}

/** 台账里已出现过的页号（标题行口径与 `docs-check` 一致：`### … · 第 NNN 页`）。
 *  **一份文本里重复的号要全部收下**——撞号史就藏在这些重复里，去重就把它读成"没人占过"。 */
export function pageNumbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/^### .{0,40}?· 第 (\d+) 页/gmu)) out.push(Number(m[1]));
  return out;
}

export function claimPage(input: {
  dir: string;
  /** **台账面**：页号取料（`pageNumbersIn` 之类）。调用方取不到料时要传 `null` 而不是 `[]`——
   *  `[]` 会被读成"这仓没人占过号"，那正是本仓反复点名的"取不到与没问题同形"（规则 261/262）。 */
  taken: readonly number[] | null;
  ops: ClaimOps;
}): ClaimResult {
  try {
    input.ops.ensureDir(input.dir);
  } catch (e) {
    return { page: null, yielded: 0, cell: `号池目录建不出来（${(e as Error).message}）⇒ 这一格取不到，不是没有可用页号` };
  }
  // `ledger` 固定取调用方那一份（不随让位变），`pool` 每次重新扫——两个面分开报数，
  // 否则让位过的号会在「已占面」里被算两次（台账＋号池各一份），那格就成了我自己造的虚高读数。
  const ledger = input.taken === null ? null : [...input.taken];
  const start = PAGE_CLAIM_START;
  let yielded = 0;
  for (let attempt = 0; attempt < PAGE_CLAIM_MAX_ATTEMPTS; attempt += 1) {
    const listing = input.ops.list(input.dir);
    if (listing === null) {
      return { page: null, yielded, cell: `号池目录读不到（${input.dir}）⇒ 这一格取不到，不是没有可用页号` };
    }
    const pool = claimedPages(listing);
    const candidate = nextFreePage([...(ledger ?? []), ...pool], start);
    const outcome = input.ops.create(input.dir, String(candidate));
    if (outcome === "ok") {
      return {
        page: candidate,
        yielded,
        cell: `占号 ${String(candidate)}（台账面 ${ledger === null ? "取不到" : `${String(ledger.length)} 个`}＋号池面 ${String(pool.length)} 个${yielded === 0 ? "" : `，让位 ${String(yielded)} 次`}）`,
      };
    }
    if (outcome === "error") {
      return { page: null, yielded, cell: `第 ${String(candidate)} 号建不出来（非 EEXIST 的失败：权限／设备／路径，errno 见调用侧）⇒ 这一格取不到，也**不算让位**，不重试` };
    }
    // exists：有人先占了。重新扫一遍再试——**必须重新 list**，否则另一个会话连占两号时我会把同一号发给两次。
    yielded += 1;
    // 号池目录若在 ensureDir 之后被人删掉，`create` 报的是 ENOENT 那一类；这里幂等地再补一次，
    // 让"池子被清过"退化成一次正常让位而不是 50 次撞帽（补不动的话，下一圈的 `list` 会自己报「读不到」）。
    try { input.ops.ensureDir(input.dir); } catch { /* 交给下一圈的 list/create 出声 */ }
  }
  return { page: null, yielded, cell: `让位 ${String(yielded)} 次仍没占到（让位次数用满，帽 ${String(PAGE_CLAIM_MAX_ATTEMPTS)}）⇒ 这一格取不到，请人工看号池` };
}
