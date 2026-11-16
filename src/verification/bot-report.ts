// Bot 侧的对照报告（生成物）：把「每个能力 + 证人 + 状态」摆成一张可复算的表。
//
// 为什么单独出一份：壁纸那边有 `standard-report`，bot 这边如果只在台账里散着写，
// 「bot 做完了」就永远只是一句话。这份报告要求每行**至少一个存在的证人文件**，
// 缺证人就记 `missing`——判据会红。
import { existsSync } from "node:fs";

export type BotVerdict = "covered" | "partial" | "out" | "missing";

export interface BotRow {
  id: string;
  capability: string;
  status: BotVerdict;
  /** 证人文件（仓库相对路径）；全部必须存在。 */
  witnesses: string[];
  /** 缺失的证人（status=missing 时列出）。 */
  missingWitnesses: string[];
  /** 对表里写的边界（没有就是 undefined）。 */
  note?: string;
}

export interface BotReport {
  rows: BotRow[];
  summary: { total: number; covered: number; partial: number; out: number; missing: number };
  verdict: "pass" | "incomplete";
}

export function buildBotReport(input: {
  items: { id: string; capability: string; status: string; evidence?: string[]; ours?: string }[];
  root?: string;
  exists?: (path: string) => boolean;
}): BotReport {
  const root = input.root ?? process.cwd() + "/";
  const exists = input.exists ?? ((p: string) => existsSync(`${root}${p}`));
  const rows: BotRow[] = input.items
    .filter((i) => i.id.startsWith("bot."))
    .map((item) => {
      const witnesses = item.evidence ?? [];
      const missingWitnesses = witnesses.filter((w) => !exists(w));
      const status: BotVerdict = missingWitnesses.length > 0
        ? "missing"
        : item.status === "covered" || item.status === "partial" || item.status === "out"
          ? item.status
          : "missing";
      return {
        id: item.id, capability: item.capability, status, witnesses, missingWitnesses,
        ...(item.ours === undefined ? {} : { note: item.ours }),
      };
    });
  const summary = {
    total: rows.length,
    covered: rows.filter((r) => r.status === "covered").length,
    partial: rows.filter((r) => r.status === "partial").length,
    out: rows.filter((r) => r.status === "out").length,
    missing: rows.filter((r) => r.status === "missing").length,
  };
  return { rows, summary, verdict: summary.missing === 0 && summary.partial === 0 ? "pass" : "incomplete" };
}
