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
  /** PW：渲染层隔离读数（真机）。 */
  isolation?: unknown;
  /** OWASP A09：拿一个真会泄露的样本跑一遍脱敏，数还剩几次。 */
  redaction?: { occurrencesAfter: number } | null;
  /** WCAG 2.1.1：键盘能否走到可选文件并选中（真机 keyDown 事件）。 */
  keyboardPick?: { picked: boolean } | null;
  /** 冒烟里读到的实际 CSP 头（字符串）。 */
  csp?: string | null;
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
      standard: "CSP Level 3", clause: "硬化指令（object-src / base-uri / form-action）",
      threshold: 3, unit: "directives",
      measured: cspHardeningCount(input.csp),
      verdict: cspHardeningCount(input.csp) === null
        ? "missing"
        : cspHardeningCount(input.csp)! >= 3 ? "pass" : "fail",
      source: input.readingsPath,
    },
    {
      standard: "CSP Level 3", clause: "script-src 不含 unsafe-inline",
      threshold: 0, unit: "occurrences",
      measured: scriptUnsafeInline(input.csp),
      verdict: scriptUnsafeInline(input.csp) === null
        ? "missing"
        : scriptUnsafeInline(input.csp) === 0 ? "pass" : "fail",
      source: input.readingsPath,
    },
    {
      standard: "Electron 安全清单", clause: "contextIsolation / 无 nodeIntegration / sandbox / 无 node 全局",
      threshold: 4, unit: "checks",
      measured: isolationChecks(input.isolation),
      verdict: isolationChecks(input.isolation) === null
        ? "missing"
        : isolationChecks(input.isolation)! >= 4 ? "pass" : "fail",
      source: input.readingsPath,
    },
    {
      standard: "WCAG 2.2", clause: "SC 2.1.1 Keyboard（只用键盘选壁纸）",
      threshold: 1, unit: "flows",
      measured: input.keyboardPick === undefined || input.keyboardPick === null ? null : input.keyboardPick.picked ? 1 : 0,
      verdict: input.keyboardPick === undefined || input.keyboardPick === null
        ? "missing"
        : input.keyboardPick.picked ? "pass" : "fail",
      source: input.readingsPath,
    },
    {
      standard: "OWASP Top 10 2021", clause: "A09 敏感值不得进日志（脱敏后残留）",
      threshold: 0, unit: "occurrences",
      measured: input.redaction === undefined || input.redaction === null ? null : input.redaction.occurrencesAfter,
      verdict: input.redaction === undefined || input.redaction === null
        ? "missing"
        : input.redaction.occurrencesAfter === 0 ? "pass" : "fail",
      source: "scripts/standard-report.ts",
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

/** 三条隔离读数各算一项；读数缺失 ⇒ null（不是 0，也不是 3）。 */
export function isolationChecks(isolation: unknown): number | null {
  const i = isolation as { hasRequire?: unknown; hasProcess?: unknown; hasAgent?: unknown; hasNodeGlobals?: unknown } | null | undefined;
  if (i === null || i === undefined) return null;
  let ok = 0;
  if (i.hasRequire === "undefined") ok += 1;
  if (i.hasProcess === "undefined") ok += 1;
  if (i.hasAgent === "object") ok += 1;
  if (typeof i.hasNodeGlobals === "string" && !i.hasNodeGlobals.includes("object")) ok += 1;
  // 四项里 hasNodeGlobals 是加分项；阈值按前三项 + 没有 node 全局 = 4 项算
  return ok;
}

/** CSP 硬化指令清单：这三条在「只加载自己的资源」语境下是硬要求。 */
export const CSP_HARDENING = ["object-src 'none'", "base-uri 'none'", "form-action 'none'"] as const;

export function cspHardeningCount(csp: string | null | undefined): number | null {
  if (typeof csp !== "string" || csp.trim() === "") return null;
  return CSP_HARDENING.filter((d) => csp.includes(d)).length;
}

/** `script-src` 里有没有 `unsafe-inline`（有 ⇒ 1，没有 ⇒ 0；读不到 script-src ⇒ null）。 */
export function scriptUnsafeInline(csp: string | null | undefined): number | null {
  if (typeof csp !== "string") return null;
  const m = /script-src([^;]*)/.exec(csp);
  if (m === null) return null;
  return m[1]!.includes("unsafe-inline") ? 1 : 0;
}

export function reportVerdict(rows: readonly ConformanceRow[]): "pass" | "fail" | "incomplete" {
  if (rows.some((r) => r.verdict === "fail")) return "fail";
  if (rows.some((r) => r.verdict === "missing")) return "incomplete";
  return "pass";
}
