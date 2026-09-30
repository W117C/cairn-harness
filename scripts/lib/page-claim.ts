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

/** 台账里已出现过的页号（标题行口径与 `docs-check` 一致：`### … · 第 NNN 页`）。
 *  **一份文本里重复的号要全部收下**——撞号史就藏在这些重复里，去重就把它读成"没人占过"。 */
export function pageNumbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/^### .{0,40}?· 第 (\d+) 页/gmu)) out.push(Number(m[1]));
  return out;
}

export function claimPage(input: {
  dir: string;
  taken: readonly number[];
  start?: number;
  ops: ClaimOps;
}): ClaimResult {
  const start = input.start ?? PAGE_CLAIM_START;
  try {
    input.ops.ensureDir(input.dir);
  } catch (e) {
    return { page: null, yielded: 0, cell: `号池目录建不出来（${(e as Error).message}）⇒ 这一格取不到，不是没有可用页号` };
  }
  const taken = [...input.taken];
  let yielded = 0;
  for (let attempt = 0; attempt < PAGE_CLAIM_MAX_ATTEMPTS; attempt += 1) {
    const listing = input.ops.list(input.dir);
    if (listing === null) {
      return { page: null, yielded, cell: `号池目录读不到（${input.dir}）⇒ 这一格取不到，不是没有可用页号` };
    }
    const candidate = nextFreePage([...taken, ...claimedPages(listing)], start);
    const outcome = input.ops.create(input.dir, String(candidate));
    if (outcome === "ok") {
      return {
        page: candidate,
        yielded,
        cell: `占号 ${String(candidate)}（已占面 ${String(taken.length)} 个＋号池 ${String(claimedPages(listing).length)} 个${yielded === 0 ? "" : `，让位 ${String(yielded)} 次`}）`,
      };
    }
    if (outcome === "error") {
      return { page: null, yielded, cell: `第 ${String(candidate)} 号建不出来（权限／设备）⇒ 这一格取不到` };
    }
    // exists：有人先占了。把这一号记进本地已占面，重新扫一遍再试——**必须重新 list**，
    // 否则另一个会话连占两号时我会把同一号发给两次。
    yielded += 1;
    taken.push(candidate);
  }
  return { page: null, yielded, cell: `让位 ${String(yielded)} 次仍没占到（超过帽 ${String(PAGE_CLAIM_MAX_ATTEMPTS)}）⇒ 这一格取不到，请人工看号池` };
}
