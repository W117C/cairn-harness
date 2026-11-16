// 记忆面板（面板族最后一面）：把三层记忆的规模摆成人能看的行。
//
// 只做**形状**，不碰 IO：调用方把各层数出来的数字给进来，这里只负责折算成行与合计。
// 口径：
//  ① 三层固定都在（project / team / member）——没内容也要出 0 行，不许「没显示＝没有」；
//  ② 成员层按 id 排序，每个成员一行（没有记忆的成员也出 0，便于看出「这人还没记过」）；
//  ③ 合计与每行必须是同一批数字（`total.topics` 等于各行之和），判据会核这个恒等式。
import type { MemoryScopeName } from "./scope";

export interface MemoryLayerStat {
  scope: MemoryScopeName;
  /** 该层目录（面板要点名，方便人对文件）。 */
  dir: string;
  /** 主题数（一个 dir 一条记忆算一个主题）。 */
  topics: number;
  /** 字节数（目录下所有文件之和）。 */
  bytes: number;
  /** 成员层才有：成员 id。 */
  memberId?: string;
}

export interface MemoryPanelView {
  rows: MemoryLayerStat[];
  total: { topics: number; bytes: number };
  /** 三层是否都出现过（缺层要点名，不许静默）。 */
  missingScopes: MemoryScopeName[];
}

export function memoryPanelView(input: {
  project: Omit<MemoryLayerStat, "scope">;
  team: Omit<MemoryLayerStat, "scope">;
  members: (Omit<MemoryLayerStat, "scope" | "memberId"> & { memberId: string })[];
}): MemoryPanelView {
  const rows: MemoryLayerStat[] = [
    { scope: "project", ...input.project },
    { scope: "team", ...input.team },
    ...[...input.members]
      .sort((a, b) => (a.memberId < b.memberId ? -1 : a.memberId > b.memberId ? 1 : 0))
      .map((m) => ({ scope: "member" as const, ...m })),
  ];
  const total = rows.reduce((acc, r) => ({ topics: acc.topics + r.topics, bytes: acc.bytes + r.bytes }), { topics: 0, bytes: 0 });
  const present = new Set(rows.map((r) => r.scope));
  const missingScopes = (["project", "team", "member"] as MemoryScopeName[]).filter((s) => !present.has(s));
  return { rows, total, missingScopes };
}

/** 面板上的一行字（判卷与 UI 共用一套格式，免得两边各写一份）。 */
export function memoryRowText(row: MemoryLayerStat): string {
  const who = row.memberId === undefined ? "" : ` ${row.memberId}`;
  return `${row.scope}${who} · ${String(row.topics)} 个主题 · ${String(row.bytes)} B`;
}
