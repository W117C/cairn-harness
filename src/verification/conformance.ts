// 把**真机读数**折算成「公开标准 → 达标/不达标」的对照报告（纯函数，无 IO）。
//
// 为什么要有它：「行业最高」如果只是散文，谁都能写。这里每一行都必须
// ①引用外部标准的条款；②给出阈值；③给出**从读数里算出来的**实测值；④给出判定。
// 读数缺了就是 `missing`，不许默认通过——那正是「读数没跑却报绿」的经典翻车法。
import { contrastRatio, type Rgb } from "../../apps/desktop/src/renderer/derived/wallpaper-contrast";

export type ConformanceVerdict = "pass" | "fail" | "missing";

export interface ConformanceRow {
  standard: string;
  clause: string;
  threshold: number;
  unit: string;
  measured: number | null;
  verdict: ConformanceVerdict;
  source: string;
}

/** `rgb(240 239 236)` / `rgb(240, 239, 236)` → Rgb；读不出 ⇒ null。 */
export function parseCssRgb(value: unknown): Rgb | null {
  if (typeof value !== "string") return null;
  const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(value);
  return m === null ? null : { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) };
}

/**
 * 某一臂的对比度：**优先用冒烟算好的 `worst`**（那是「最差格」，含壁纸底色与玻璃面叠加），
 * 没有才算「文字色 vs 画布色」。挑好看的报没有意义——判据要看最差格。
 */
export function worstContrastOf(arm: unknown): number | null {
  const a = arm as { text?: unknown; canvas?: unknown; worst?: unknown } | null | undefined;
  if (typeof a?.worst === "number" && Number.isFinite(a.worst)) return a.worst;
  const text = parseCssRgb(a?.text);
  const canvas = parseCssRgb(a?.canvas);
  if (text === null || canvas === null) return null;
  return contrastRatio(text, canvas);
}

export interface ConformanceInput {
  /** 真机冒烟读数（`outputs/<run>/readings.json` 的解析结果）。 */
  readings: { dark?: unknown; light?: unknown; negativeControl?: unknown } | null;
  /** 读数文件路径（写进报告，便于回查）。 */
  readingsPath: string;
  /** 对表统计。 */
  parity: { total: number; covered: number; partial: number; absent: number; out: number };
}

export function buildConformanceReport(input: ConformanceInput): ConformanceRow[] {
  const dark = worstContrastOf(input.readings?.dark);
  const light = worstContrastOf(input.readings?.light);
  const worst = dark === null || light === null ? null : Math.min(dark, light);
  const cspBlocked = (input.readings?.negativeControl as { cspViolations?: unknown } | null | undefined)?.cspViolations;

  return [
    {
      standard: "WCAG 2.2", clause: "SC 1.4.3 Contrast Minimum",
      threshold: 4.5, unit: "ratio", measured: worst === null ? null : Math.round(worst * 1000) / 1000,
      verdict: worst === null ? "missing" : worst >= 4.5 ? "pass" : "fail",
      source: input.readingsPath,
    },
    {
      standard: "CSP Level 3", clause: "越权取图必须被 CSP 拦下",
      threshold: 1, unit: "violations", measured: typeof cspBlocked === "number" ? cspBlocked : null,
      verdict: typeof cspBlocked !== "number" ? "missing" : cspBlocked >= 1 ? "pass" : "fail",
      source: input.readingsPath,
    },
    {
      standard: "本方对表", clause: "评分面 covered 比例",
      threshold: 1, unit: "ratio",
      measured: input.parity.covered + input.parity.partial + input.parity.absent === 0
        ? null
        : Math.round((input.parity.covered / (input.parity.covered + input.parity.partial + input.parity.absent)) * 1000) / 1000,
      verdict: input.parity.partial + input.parity.absent === 0 ? "pass" : "fail",
      source: "fixtures/parity/checklist.json",
    },
  ];
}

export function reportVerdict(rows: readonly ConformanceRow[]): "pass" | "fail" | "incomplete" {
  if (rows.some((r) => r.verdict === "fail")) return "fail";
  if (rows.some((r) => r.verdict === "missing")) return "incomplete";
  return "pass";
}
