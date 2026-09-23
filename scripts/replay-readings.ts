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
    answers: "judgment-layer §9 第 0 步的分母：verify 红里有几条今天能被机器归因（P1-3 的 before/after 尺）",
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
}

const flatten = (xs: readonly (readonly string[])[]): string[] => [...new Set(xs.flat())];

export function replayGapsOf(f: ReplayFacts): ReplayGaps {
  const ids = new Set(f.registered.map((r) => r.id));
  const referenced = flatten(f.refs.map((r) => r.ids));
  const referencedSet = new Set(referenced);
  return {
    unregisteredRefs: [...new Set(referenced.filter((id) => !ids.has(id)))],
    unreferencedIds: [...ids].filter((id) => !referencedSet.has(id)),
    missingScripts: [...f.missingScripts],
    inlineBlocks: f.inline.filter((i) => i.count > 0).map((i) => i.file),
  };
}

/** 引用标记与内联块的扫描形状（导出来给单测复用同一把尺，避免测试与门各写一份正则）。 */
export const REPLAY_REF = /replay:([a-z0-9][a-z0-9-]*)/g;
export const INLINE_REPLAY = /node --import tsx -e/g;
