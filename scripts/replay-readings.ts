// 复跑面登记表（`replay:<id>`）——判卷读数的**可信赖面**，纯函数 + 零 IO，供 docs-check 与单测消费。
//
// 立这张表的理由不是"整齐"，是实测到的一类腐：文档里写着「下面这段可直接粘贴复跑」，
// 而那段 heredoc 永远不过编译（`node --import tsx -e` 的源码在 `.md` 里，tsc 看不见），
// 于是产品侧一次形状变更（`planBlocked: boolean` → `() => boolean`）就让判卷读数静默失效，
// **没有任何门知道**（2026-09-23 实跑：`TypeError: s.planBlocked is not a function`）。
// 搬进 `scripts/replay/*.ts` 后它进 tsc 覆盖面；本表再把"文档说有、盘上其实没有"这一格钉住。
//
// 判据挂在**机制**上，不挂在这张表的自陈上：`refs` / `inline` 由调用方从真实 `.md` 扫出来灌进来，
// 表里写什么不算数（借"怎么关"的表判"有没有开着"会让未登记项静默漏在机制外）。
export interface ReplayReading {
  /** 文档里写 `replay:<id>` 引用它。 */
  id: string;
  /** 仓库相对路径；必须真存在且真被 tsc 扫到。 */
  script: string;
  /** 一句话说明它回答哪个判卷读数（红的时候给人看的）。 */
  answers: string;
}

/** 现役复跑面。新增一条 = 同提交里既要有脚本，也要有引用它的那句文档（缺一侧即红）。 */
export const REPLAY_READINGS: readonly ReplayReading[] = [
  {
    id: "ask-density",
    script: "scripts/replay/ask-density.ts",
    answers: "judgment-layer §3.2 两档 ask 密度 + §3.3 risk 分布（§7 第 1 步的判卷读数）",
  },
  {
    id: "corpus-inventory",
    script: "scripts/replay/corpus-inventory.ts",
    answers: "judgment-layer 附录 B 定序读数（受管量 / 非 ASCII 占比 / 失败→重用的两种计数）",
  },
  {
    id: "verify-cause-mix",
    script: "scripts/replay/verify-cause-mix.ts",
    answers: "judgment-layer §9 第 0 步的分母，两个面各一行：verify 红命令 / shell 家族红拍里各有几条今天能被机器归因（P1-3 的 before/after 尺）",
  },
  {
    id: "gate-outcomes",
    script: "scripts/replay/gate-outcomes.ts",
    answers: "judgment-layer §7 第 2 步的分子：真语料里 gate 留痕的 layer × verdict 分布（有多少「人被问过、且答了」）",
  },
  {
    id: "join-lapse",
    script: "scripts/replay/join-lapse.ts",
    answers: "orchestration-design §3 W1b 的前置占比：真语料里「回合末还有在途 worker」的 run 数（那道闸会不会触发）",
  },
  {
    id: "latency",
    script: "scripts/replay/latency.ts",
    answers: "工具耗时分布 + 「一轮发几个调用」（§5 D8 并发只读工具的触发面；时间面要靠 append 盖的时钟戳）",
  },
  {
    id: "prompt-fixed-cost",
    script: "scripts/replay/prompt-fixed-cost.ts",
    answers: "生产系统提示的固定开销：每请求约多少 token、占实测输入多少（A/B 幅度要等噪声底，这一块不用）",
  },
  {
    id: "run-scorecard",
    script: "scripts/replay/run-scorecard.ts",
    answers: "能力 10 的 y 轴基线：每个 run 一行终态（一次绿 / 返工后绿 / 终局红 / 证据缺席 / 没改盘）+ 返工轮数",
  },
  {
    id: "stagnation-burn",
    script: "scripts/replay/stagnation-burn.ts",
    answers: "该不该把无进展阶梯（R1）接进主 loop 的分母：真语料里停滞出现几条流、落在代码红还是环境红上、与修复额度打满同不同流",
  },
  {
    id: "cascade-traffic",
    script: "scripts/replay/cascade-traffic.ts",
    answers: "该不该给级联升档（runCascade / orchestrator 的升档调用点）加 verify cause 的分母：语料里升档出现几次、红拍里环境因占比多少；零流量时判「不可测」而非「没花钱」",
  },
  {
    id: "prune-promise",
    script: "scripts/replay/prune-promise.ts",
    answers: "任务 #33 的优先级尺：压缩摘要里承诺「用 tool_result:index 回取」的条目，在语料里真被回取过几次（0 次 ⇒ §7.4 那条承诺是空头支票）",
  },
];

export interface ReplayFacts {
  registered: readonly ReplayReading[];
  /** 登记项里盘上不存在的脚本（由调用方 stat 后灌进来，保持本模块纯）。 */
  missingScripts: readonly string[];
  /** 各文档实际出现的 `replay:<id>` 引用。 */
  refs: readonly { file: string; ids: readonly string[] }[];
  /** 各文档实际出现的内联 heredoc 复跑块（`node --import tsx -e`）计数。 */
  inline: readonly { file: string; count: number }[];
  /** 盘上 `scripts/replay/` 里的实际文件（取料从**盘**出发，不从登记表出发）。
   *  缺省 = 不查这一格（既有调用方逐字不变）；新那一格由 `tests/replay-readings-registry.test.ts` 真扫盘灌进来。 */
  onDisk?: readonly ReplayOnDiskFile[];
}

/** 盘上一个复跑面/取料件的最小事实：路径（仓库相对）+ 源码文本（判"有没有人吃它"）。 */
export interface ReplayOnDiskFile {
  path: string;
  source: string;
}

export interface ReplayGaps {
  /** 文档写了 `replay:<id>` 但登记表没有 ⇒ 这句复跑无源，等于没尺。 */
  unregisteredRefs: string[];
  /** 登记了却没有任何文档引用 ⇒ 陈旧登记（要么写进文档，要么删表项）。 */
  unreferencedIds: string[];
  /** 登记项指向的脚本不在盘上（改名 / 删文件而忘撤表项）。 */
  missingScripts: string[];
  /** 有内联 heredoc 复跑块 ⇒ 新腐的入口（存量走 docs-check 的 LEGACY_WAIVERS，只降不升）。 */
  inlineBlocks: string[];
  /** 盘上有、表里没有，而且**没有任何已登记的面 import 它** ⇒ 孤儿（第五判据）。
   *  为什么判"没人吃它"而不是"全部要求登记"：`corpus.ts` 这类共用取料层本来就不该有 `replay:` 语义，
   *  一律要求登记会把取料件逼进登记表（那张表是"文档可复跑"的账，不是文件清单）。
   *  反向也成立：一个**新的、没人 import 也没登记**的面——正是我自己 #39 漏进的那一格。 */
  orphanScripts: string[];
}

const flatten = (xs: readonly (readonly string[])[]): string[] => [...new Set(xs.flat())];

/** 一个面的源码有没有引到 `./<base>`（含 `.js` 后缀写法）。 */
function importsBase(source: string, base: string): boolean {
  return new RegExp("[\"']\\./" + base + "(\\.js)?[\"']", "u").test(source);
}

export function replayGapsOf(f: ReplayFacts): ReplayGaps {
  const ids = new Set(f.registered.map((r) => r.id));
  const referenced = flatten(f.refs.map((r) => r.ids));
  const referencedSet = new Set(referenced);
  const onDisk = f.onDisk ?? [];
  const registeredScripts = new Set(f.registered.map((r) => r.script));
  const registeredSources = onDisk.filter((x) => registeredScripts.has(x.path));
  const baseOf = (p: string): string => p.slice(p.lastIndexOf("/") + 1).replace(/\.ts$/u, "");
  const orphans = onDisk
    .filter((x) => !registeredScripts.has(x.path))
    .filter((x) => !registeredSources.some((src) => importsBase(src.source, baseOf(x.path))))
    .map((x) => x.path)
    .sort();
  return {
    unregisteredRefs: [...new Set(referenced.filter((id) => !ids.has(id)))],
    unreferencedIds: [...ids].filter((id) => !referencedSet.has(id)),
    missingScripts: [...f.missingScripts],
    inlineBlocks: f.inline.filter((i) => i.count > 0).map((i) => i.file),
    orphanScripts: orphans,
  };
}

/** 引用标记与内联块的扫描形状（导出来给单测复用同一把尺，避免测试与门各写一份正则）。 */
export const REPLAY_REF = /replay:([a-z0-9][a-z0-9-]*)/g;
export const INLINE_REPLAY = /node --import tsx -e/g;

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/** 从一段 markdown 里切出**围栏代码块**的正文（不含围栏行本身）。
 *
 *  为什么要切：旧的 D-8 取料是拿 `INLINE_REPLAY` 全文匹配，于是正文里一句
 *  「我随后那条 `node --import tsx -e` 直接 import …」这种**引用**也被算成可粘贴复跑块
 *  ——2026-09-28 真跑 docs-check 报红的就是这一条（`PROGRESS.md` 全文只有那一处引用、0 个真块）。
 *  判据要问的是「文档教人粘的那一串」，不是「文档提到过那串」。改的是尺、不是文档：
 *  那句正文是对的，删它才是倒退。
 *
 *  形状按 CommonMark 定的最小子集：围栏行 ≤3 空格缩进、`` ` `` 或 `~` 至少三个、
 *  闭合围栏须同类且**不短于**开启的那条、其后无正文。未闭合的围块照样算进去
 *  （文档 fences 写坏时判据不该跟着瞎）。 */
export function fencedBlocksOf(text: string): string[] {
  const out: string[] = [];
  let open: { marker: string; body: string[] } | null = null;
  for (const line of text.split("\n")) {
    const m = FENCE.exec(line);
    if (open === null) {
      if (m !== null) open = { marker: m[1]!, body: [] };
      continue;
    }
    if (m !== null && m[1]![0] === open.marker[0] && m[1]!.length >= open.marker.length && m[2]!.trim() === "") {
      out.push(open.body.join("\n"));
      open = null;
      continue;
    }
    open.body.push(line);
  }
  if (open !== null) out.push(open.body.join("\n"));
  return out;
}

/** 一篇文档里「教人粘的内联复跑块」有几处（D-8 第四判据的取料）。
 *
 *  只在**围栏内**数。正文提到那条命令是叙述；围栏里才是读者要粘的东西。
 *  这不是把判据放松成「读不到 0 即绿」——见 tests/docs-check.test.ts 里那对对照支：
 *  同一篇文档、同一个反引号写法，一个在正文里（不算）、搬进围栏就算。 */
export function countInlineReplay(text: string): number {
  return fencedBlocksOf(text).reduce((n, block) => n + [...block.matchAll(INLINE_REPLAY)].length, 0);
}
