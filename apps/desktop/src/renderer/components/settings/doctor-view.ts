// 桌面「运行诊断」的视图投影（2026-10-30 · v34）。
// 纯函数：把 DoctorReport 折成给人看的一行一项；**凭据一项按桌面口径重写**——
// CLI 的 keys 检查只查环境变量，桌面用户在设置页存的密钥不算在内，直接把原句搬上来会误报「全未设」。
// 界面用两侧事实合成：环境变量在位（envProviders）+ 设置页已存（stored）。
import type { DoctorCheck, DoctorReport } from "../../../../../../src/main/doctor";
import type { SectionId } from "../../app-controls";
import { STR } from "../../strings";

export interface DoctorKeyStatus {
  available: boolean;
  stored: readonly string[];
  envActive: boolean;
  envProviders?: readonly string[];
}

export interface DoctorRow {
  id: string;
  label: string;
  ok: boolean;
  fatal: boolean;
  detail: string;
  hint?: string;
}

const LABELS: Record<DoctorCheck["id"], string> = {
  node: STR.doctor.labelNode,
  keys: STR.doctor.labelKeys,
  tiers: STR.doctor.labelTiers,
  sandbox: STR.doctor.labelSandbox,
  workspace: STR.doctor.labelWorkspace,
  settings: STR.doctor.labelSettings,
  sessions: STR.doctor.labelSessions,
  search: STR.doctor.labelSearch,
  trust: STR.doctor.labelTrust,
};

function cut(check: DoctorCheck): DoctorRow {
  return {
    id: check.id,
    label: LABELS[check.id],
    ok: check.ok,
    fatal: check.fatal,
    detail: check.detail,
    ...(check.hint !== undefined ? { hint: check.hint } : {}),
  };
}

/** 报告 → 行；`keys` 为 null = 设置页密钥状态没读到，此时退回 doctor 原句并注明只查了环境变量。 */
export function doctorRows(report: DoctorReport, keys: DoctorKeyStatus | null): DoctorRow[] {
  return report.checks.map((check) => {
    if (check.id !== "keys") return cut(check);
    if (keys === null) {
      return { ...cut(check), label: STR.doctor.keysEnvOnly, detail: `${check.detail}${STR.doctor.keysReadFailNote}` };
    }
    const stored = [...keys.stored];
    const env = [...(keys.envProviders ?? [])];
    const ok = keys.envActive || stored.length > 0;
    const parts: string[] = [];
    if (env.length > 0) parts.push(STR.doctor.envActive + env.join("、"));
    if (stored.length > 0) parts.push(STR.doctor.storedCount.replace("{n}", String(stored.length)) + stored.join("、"));
    return {
      id: "keys",
      label: STR.doctor.labelKeys,
      ok,
      fatal: false,
      detail: ok ? parts.join("；") : STR.doctor.noCredentials,
      ...(ok ? {} : { hint: STR.doctor.keysHint }),
    };
  });
}

/** 总档一行：失败项数比 verdict 本身更能告诉用户「有几件事要处理」。
 *  计数以**上屏的行**为准——凭据行已换成桌面口径，若仍数报告里的 CLI 原行，
 *  会出现「列表只有一行红、总档说两项」的自相矛盾。 */
export function doctorVerdictText(report: DoctorReport, rows: readonly DoctorRow[]): string {
  const failing = rows.filter((r) => !r.ok).length;
  return failing === 0
    ? STR.doctor.verdictPass.replace("{verdict}", report.verdict).replace("{n}", String(rows.length))
    : STR.doctor.verdictFailing.replace("{verdict}", report.verdict).replace("{n}", String(failing));
}

/**
 * 「去修」落点：诊断行 → 设置分区（2026-10-30 · v37）。
 *
 * 为什么必须有这一格：诊断只说「哪里坏了」，用户还要自己在十几个设置分区里找能修它的那一页——
 * 找不到时，一份正确的诊断等于一句指责。这里只映射**真的能在应用里改**的项：
 *   · keys         → 模型与 Provider（存 key、选模型）
 *   · sandbox      → 权限与安全（档位 / 沙箱）
 *   · search       → 联网搜索（端点与密钥）
 * Node / 工作区 / 设置文件 / 会话数据不在应用里改（要动环境或文件系统）；插件信任面落在
 * 「插件」目的地页而不是设置分区（SettingsPanel 的 setSection 到不了），一并返回 undefined——
 * 宁可不给按钮，也不给一个点了没用的入口。
 */
const DOCTOR_TARGETS: Partial<Record<DoctorCheck["id"], SectionId>> = {
  keys: "provider",
  sandbox: "permissions",
  search: "network",
};

export function doctorTarget(id: string): SectionId | undefined {
  return Object.prototype.hasOwnProperty.call(DOCTOR_TARGETS, id)
    ? DOCTOR_TARGETS[id as DoctorCheck["id"]]
    : undefined;
}

/**
 * 诊断报告的可带走文本（2026-10-30 · 第 803 页）。
 * 为什么是纯函数：报告要能复制/贴进 issue，格式就不能靠 JSX 现拼；`generatedAt` 由调用方注入，
 * 判卷不赌时钟。行序与屏上一致（doctorRows 的顺序），总档取**上屏行**计数后的那一句。
 */
export function doctorReportText(input: {
  version: string | null;
  generatedAt: string;
  verdict: string;
  rows: readonly DoctorRow[];
}): string {
  const lines = [
    STR.doctor.reportTitle,
    STR.doctor.reportVersion + (input.version ?? STR.doctor.reportVersionUnknown),
    STR.doctor.reportGenerated + input.generatedAt,
    input.verdict,
    "",
  ];
  for (const row of input.rows) {
    lines.push(`${row.ok ? "[✓]" : "[✗]"} ${row.label}：${row.detail}`);
    if (row.hint !== undefined) lines.push(STR.doctor.reportHint + row.hint);
  }
  return lines.join("\n") + "\n";
}
