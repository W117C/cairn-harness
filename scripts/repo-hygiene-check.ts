/**
 * 仓库体量门（repo-hygiene）：两条面，各带分母。
 *
 * 这道门量的是**仓库自己长得多快**，不是代码对不对。它存在的动因是 2026-10-02 全量实测：
 *   · 已跟踪 2443 个文件，其中 `outputs/` **1449（59.3%）**；
 *   · `src/main/agent-runner.ts` **2761 行**、`src/agent/orchestrator.ts` **2564 行**（单类 45 方法）。
 *
 * 为什么这两件事要进门，而不是靠自觉：
 *   ① 取料（`outputs/`，实验日志）与源码同仓 ⇒ `git ls-files` 的信噪比掉到 41%，
 *      而 `docs-check` / 断言体检 / 变异选择子**都以 git 清单为取料面**——
 *      取料每多一个文件，这些门的扫描面与判卷面就多一份与自己无关的噪声。
 *   ② 巨型文件不只是难读：它是多会话并发的**冲突源**。本仓实测过
 *      「21 小时不动，合并冲突从 5 处涨到 13 处」，而巨型文件是那 13 处的主要候选。
 *
 * 两条纪律（沿用本仓既有口径，不是新发明）：
 *   · **范围必须是字段，不是数出来的差值**（规则 82）。占比必须与分子/分母一起打印——
 *     只印一个 `59.3%` 会被读成「其中有多少是源码」，而那件真事它答不了。
 *   · **每条核心判据配一条反向验证**。`--self-test` 用合成输入证明两条判据**都能转红**；
 *     一条判不出红的判据是摆设（`no-progress-check` 的 REDKINDS 同族做法）。
 *
 * 帽为什么取「当前实测值上取整」而不是理想值：帽拍一个理想值（比如取料占比 20%），
 * 这道门第一天就红，然后被当成噪声关掉——**一道永远红的门等于没有门**。
 * 正确次序是：先让门绿着站住（帽=现状上取整），再逐波降帽；每降一档要写清降到多少。
 *
 * 用法：`pnpm repo-hygiene-check`｜反向对照 `pnpm repo-hygiene-check -- --self-test`
 */
import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * ① 面：`outputs/`（取料）在已跟踪文件里的占比帽。
 *
 * 实测 2026-10-02：1449 / 2443 = 59.3% ⇒ 帽取 0.60。
 * 这个帽只封**新增**：本门不追溯、不删历史取料（那是别的会话的证据）。
 * 换句话说它判的是「占比还在不在涨」，不是「过去该不该提交这些」。
 */
export const OUTPUTS_SHARE_CAP = 0.6;

/**
 * ② 面：src 下单个 .ts 文件的行数帽。
 *
 * 实测 2026-10-02：最大 `src/main/agent-runner.ts` 2761 行 ⇒ 帽取 2800。
 * 第二名 2564（orchestrator）。帽高于现状，是为了让 W4 拆分之前这道门先绿着站住；
 * W4 落地后再把帽降到 2600 / 2400，**一次只降一档**（多会话并发下降太快会撞红在别人树上）。
 */
export const SRC_FILE_LINE_CAP = 2800;

// ---- 纯判据（可单测；IO 只发生在 main 里）----

export interface TrackedCounts {
  /** 已跟踪文件总数（分母）。 */
  total: number;
  /** 其中 `outputs/` 下的（分子）。 */
  outputs: number;
  /** 其余（源码 + 测试 + 脚本 + 文档）。分母减分子必须等于它——对不上就是取料面有洞。 */
  rest: number;
}

/** `git ls-files -z` 的 stdout ⇒ 路径清单。NUL 切分只在这里定义一次：
 *  下面两个取料点都走它，免得第二处又写回 `split("\n")`（下面那条实测教训的原样复发）。 */
function nulPaths(stdout: string): string[] {
  return stdout.split("\0").map((l) => l.trim()).filter((l) => l !== "");
}

/**
 * 从 `git ls-files` 的 stdout 算占比（纯函数）。
 *
 * **分隔符是 NUL（`-z`），不是换行**——这条是被实测打出来的，不是先见之明：
 * 初版按 `split("\n")` + `startsWith("outputs/")` 数，量到 1285/2443 = 52.6%；
 * 而 `git ls-files outputs` 那一支量到 1449。差的 **164 条全是中文名文件**——
 * git 默认对非 ASCII 路径做 C 风格引用，于是那一行长成 `"outputs/\345\223\252...md"`：
 * 开头是**引号**而不是 `o`，`startsWith("outputs/")` 一条都不收。
 *
 * 少算的那一半恰好是「中文取料目录」——也就是本门最该盯的那批。
 * 教训与本仓「范围得是字段」同族：**一个过滤器悄悄少收一半，比不过收更坏**，
 * 因为它照样印出一个像模像样的百分比。`-z` 让 git 输出原始字节，问题从根上不存在。
 */
export function trackedCounts(lsFilesOut: string): TrackedCounts {
  const files = nulPaths(lsFilesOut);
  const outputs = files.filter((f) => f === "outputs" || f.startsWith("outputs/")).length;
  return { total: files.length, outputs, rest: files.length - outputs };
}

export interface ShareVerdict {
  ok: boolean;
  share: number;
  detail: string;
}

/**
 * 面①判据：占比超帽即红。
 *
 * **分母为 0 时必须判红而不是放行**：取不到 git 清单时「没算出来」与「占比为 0」同形，
 * 放行等于把「没尺」读成「没问题」——这是本仓反复点名的同一族坑（规则 82/198）。
 */
export function outputsShareVerdict(counts: TrackedCounts, cap = OUTPUTS_SHARE_CAP): ShareVerdict {
  if (counts.total === 0) {
    return {
      ok: false,
      share: 0,
      detail: "已跟踪清单取不到（total=0）⇒ 这道门本次不成立，判红而不是当 0 放行",
    };
  }
  const share = counts.outputs / counts.total;
  const pct = (share * 100).toFixed(1);
  return {
    ok: share <= cap,
    share,
    detail:
      `outputs/ ${counts.outputs} / 已跟踪 ${counts.total} = ${pct}%` +
      `（其余 ${counts.rest}）｜帽 ${(cap * 100).toFixed(0)}%`,
  };
}

export interface FileSize {
  path: string;
  lines: number;
}

export interface OversizeVerdict {
  ok: boolean;
  offenders: FileSize[];
  detail: string;
}

/** 清单里最大的一支行数（空清单记 "n/a"，不给 `Math.max()` 传空展开）。 */
function maxLines(files: readonly FileSize[]): string {
  return files.length === 0 ? "n/a" : String(Math.max(...files.map((f) => f.lines)));
}

/** 面②判据：单文件超帽即红，**并点名是哪一支**（不点名就等于只说「有文件太大」）。 */
export function oversizedFiles(files: readonly FileSize[], cap = SRC_FILE_LINE_CAP): OversizeVerdict {
  const offenders = files.filter((f) => f.lines > cap).sort((a, b) => b.lines - a.lines);
  return {
    ok: offenders.length === 0,
    offenders,
    detail: offenders.length === 0
      ? `src 单文件全部 ≤ ${cap} 行（最大 ${maxLines(files)} 行 / ${files.length} 支）`
      : `超帽 ${offenders.length} 支：` + offenders.map((f) => `${f.path} ${f.lines} 行`).join("、"),
  };
}

/** 反向验证：两条判据都必须**能转红**（判不出红的判据是摆设）。合成输入，不碰真仓。 */
export interface SelfTest {
  id: string;
  ok: boolean;
  detail: string;
}

export function selfTests(): SelfTest[] {
  const out: SelfTest[] = [];

  // 面①：现状绿
  const nowGreen = outputsShareVerdict({ total: 2443, outputs: 1449, rest: 994 });
  out.push({
    id: "SH1-现状占比在帽内⇒绿",
    ok: nowGreen.ok && nowGreen.share > 0.59 && nowGreen.share < 0.60,
    detail: nowGreen.detail,
  });
  // 面①：占比涨过帽 ⇒ 必须红（反向验证）
  const grew = outputsShareVerdict({ total: 1000, outputs: 900, rest: 100 });
  out.push({
    id: "SH2-占比 90% 超帽 ⇒ 判红（反向验证）",
    ok: !grew.ok,
    detail: grew.detail,
  });
  // 面①：分母取不到 ⇒ 判红，不当 0 放行（第三态）
  const noScale = outputsShareVerdict({ total: 0, outputs: 0, rest: 0 });
  out.push({
    id: "SH3-取不到清单(total=0) ⇒ 判红不当 0 放行",
    ok: !noScale.ok,
    detail: noScale.detail,
  });
  // 面①：恰好压在帽上 ⇒ 绿（「超帽才红」，边界含等号）
  const atCap = outputsShareVerdict({ total: 100, outputs: 60, rest: 40 });
  out.push({ id: "SH4-恰好等于帽(60%) ⇒ 绿", ok: atCap.ok, detail: atCap.detail });

  // 面①：中文名取料必须被收进来（回归钉：初版按换行切+startsWith，164 条中文名全被漏掉，
  // 量出 52.6% 而真实是 59.3%。这条断言用**真实形状**的中文路径，且要求 NUL 分隔才数得出）。
  const cjk = trackedCounts(
    ["src/a.ts", "outputs/agents-md/01-孤儿面迁移.md", "outputs/ga/英文名.json", "docs/x.md"].join("\0") + "\0",
  );
  out.push({
    id: "SH4b-中文名取料被收进来（NUL 分隔 ⇒ 不受 C 风格引用影响）",
    ok: cjk.total === 4 && cjk.outputs === 2 && cjk.rest === 2,
    detail: `中文名那条：total=${cjk.total}（须 4）· outputs=${cjk.outputs}（须 2）· 其余=${cjk.rest}（须 2）`,
  });
  // 面①：分母自校验恒等式（分子 + 其余 = 总数）——这条守住「口径是一份不是两份」
  const selfConsistent = trackedCounts("a\0outputs/b\0outputs/c\0");
  out.push({
    id: "SH4c-分母自校验恒等：outputs + rest = total",
    ok: selfConsistent.outputs + selfConsistent.rest === selfConsistent.total && selfConsistent.outputs === 2,
    detail: `${selfConsistent.outputs} + ${selfConsistent.rest} = ${selfConsistent.total}`,
  });

  // 面②：现状绿
  const nowOk = oversizedFiles([
    { path: "src/main/agent-runner.ts", lines: 2761 },
    { path: "src/agent/orchestrator.ts", lines: 2564 },
  ]);
  out.push({ id: "SH5-现状最大文件在帽内 ⇒ 绿", ok: nowOk.ok, detail: nowOk.detail });
  // 面②：超帽 ⇒ 必须红**且点名并按大小序**（反向验证）
  const big = oversizedFiles([
    { path: "src/a.ts", lines: 2801 },
    { path: "src/b.ts", lines: 5000 },
    { path: "src/ok.ts", lines: 100 },
  ]);
  out.push({
    id: "SH6-超帽 ⇒ 判红且点名(src/b.ts 与 src/a.ts，按大小序)",
    ok: !big.ok && big.offenders.length === 2 && big.offenders[0]?.path === "src/b.ts",
    detail: big.detail,
  });
  // 面②：恰好等于帽 ⇒ 绿
  const atLineCap = oversizedFiles([{ path: "src/exact.ts", lines: 2800 }]);
  out.push({ id: "SH7-恰好 2800 行 ⇒ 绿（超帽才红）", ok: atLineCap.ok, detail: atLineCap.detail });

  return out;
}

// ---- IO 层（只在这里碰 git 与 fs）----

/** `git ls-files -z`：NUL 分隔 + 不做 C 风格引用（中文名路径原样返回，见 trackedCounts 的注释）。 */
function gitLsFiles(prefix?: string): string | null {
  const args = prefix === undefined
    ? ["ls-files", "-z"]
    : ["ls-files", "-z", "--", prefix];
  const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0 || typeof r.stdout !== "string") return null;
  return r.stdout;
}

function srcFileSizes(): { files: FileSize[]; unreadable: string[] } {
  const out = gitLsFiles("src");
  if (out === null) return { files: [], unreadable: [] };
  const files: FileSize[] = [];
  const unreadable: string[] = [];
  for (const rel of nulPaths(out)) {
    if (!rel.endsWith(".ts")) continue;
    try {
      const text = readFileSync(join(ROOT, rel), "utf8");
      // 行数口径：末尾有换行时最后一段不算一行（否则每个文件系统性多 1 行）
      const lines = text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
      files.push({ path: rel, lines });
    } catch {
      // 已跟踪但盘上读不到（别人未提交的删除）⇒ 记账并出声，不静默少判（规则 82）。
      unreadable.push(rel);
    }
  }
  return { files, unreadable };
}

async function main(): Promise<void> {
  if (process.argv.includes("--self-test")) {
    console.log("== 反向验证：证明两条判据都能转红（合成输入，不碰真仓）==");
    let bad = 0;
    for (const t of selfTests()) {
      if (!t.ok) bad++;
      console.log(`  ${t.ok ? "✅" : "❌"} ${t.id}`);
      console.log(`     ${t.detail}`);
    }
    console.log(bad === 0 ? "[repo-hygiene-check] 反向验证全过 ✅" : `[repo-hygiene-check] ❌ ${bad} 条判据造不红`);
    process.exit(bad === 0 ? 0 : 1);
  }

  console.log("== 仓库体量门（取料占比 + 单文件体量，各带分母）==");
  let failed = 0;

  // 面①
  const ls = gitLsFiles();
  if (ls === null) {
    console.log("  ❌ 面① git ls-files 取不到 ⇒ 这一面没尺，判红（不当 0 放行）");
    failed++;
  } else {
    const counts = trackedCounts(ls);
    const v = outputsShareVerdict(counts);
    if (!v.ok) failed++;
    console.log(`  ${v.ok ? "✅" : "❌"} 面① 取料占比 — ${v.detail}`);
    // 分母自校验：分子 + 其余 必须等于总数，不等就是取料面有洞（当场出声，不静默）
    if (counts.outputs + counts.rest !== counts.total) {
      console.log("  ❌ 面① 分母自校验失败：outputs + rest ≠ total ⇒ 取料面有洞");
      failed++;
    }
  }

  // 面②
  const { files, unreadable } = srcFileSizes();
  if (unreadable.length > 0) console.log(`  ⚠️ 面② 已跟踪但盘上读不到 ${unreadable.length} 支（未计入，等于没量到这一格）`);
  if (files.length === 0) {
    console.log("  ❌ 面② 取不到 src 下任何 .ts ⇒ 没尺，判红");
    failed++;
  } else {
    const v = oversizedFiles(files);
    if (!v.ok) failed++;
    console.log(`  ${v.ok ? "✅" : "❌"} 面② 单文件体量 — ${v.detail}`);
    if (!v.ok) for (const o of v.offenders) console.log(`     为什么要有这条：${o.path} ${o.lines} 行 > 帽 ${SRC_FILE_LINE_CAP}；见 docs/optimization-plan-2026-10-02.md W4`);
  }

  console.log(
    failed === 0
      ? `[repo-hygiene-check] 两面全绿 ✅（帽：取料 ≤ ${(OUTPUTS_SHARE_CAP * 100).toFixed(0)}%、src 单文件 ≤ ${SRC_FILE_LINE_CAP} 行；现状站住，后续逐波降帽）`
      : `[repo-hygiene-check] ❌ ${failed} 面红`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

// 入口判定：单测 import 本模块不得把门跑起来（照 scripts/no-progress-check.ts 的写法）。
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  void main();
}