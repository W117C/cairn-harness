// 桌面「运行诊断」（v34）：行投影 + About 入口。
// 关键口径：凭据一行**不照搬 CLI 文案**——CLI 只查环境变量，桌面还要算设置页已存的密钥；
// 直接搬会误报「四个 provider key 全部未设」。两条事实在 doctorRows 里合成一行。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { STR } from "../src/renderer/strings";
import { AboutSection, DoctorResultView } from "../src/renderer/components/settings-sections";
import { doctorReportText, doctorRows, doctorTarget, doctorVerdictText, type DoctorKeyStatus } from "../src/renderer/components/settings/doctor-view";
import type { DoctorCheck, DoctorReport } from "../../../src/main/doctor";

const check = (id: DoctorCheck["id"], ok: boolean, detail: string, hint?: string): DoctorCheck => ({
  id, ok, fatal: id === "node", detail, ...(hint !== undefined ? { hint } : {}),
});

const REPORT: DoctorReport = {
  checks: [
    check("node", true, "Node v24.19.0（engines >=20.11.0 <25）"),
    check("keys", false, "四个 provider key 全部未设", "export OPENAI_API_KEY=<key>；或 --provider demo 零凭据看流程"),
    check("tiers", true, "模型档位表 12 条"),
    check("sandbox", true, "沙箱可用"),
    check("workspace", true, "工作区可写"),
    check("settings", true, "设置文件可读"),
    check("sessions", true, "会话元数据可读"),
    check("search", false, "search.endpoint 未配（web_search 不可用；这是可选项）"),
    check("trust", true, "插件信任面 2 条决议"),
  ],
  verdict: "部分就绪",
  exitCode: 0,
};

const KEYS: DoctorKeyStatus = { available: true, stored: ["deepseek", "glm"], envActive: true, envProviders: ["glm"] };
const keysRow = (rows: ReturnType<typeof doctorRows>) => rows.find((r) => r.id === "keys")!;

describe("doctorRows（桌面口径的凭据行）", () => {
  it("环境变量与设置页已存两侧都报，不照搬 CLI 的「全部未设」", () => {
    const row = keysRow(doctorRows(REPORT, KEYS));
    expect(row.ok).toBe(true);
    expect(row.detail).toContain("环境变量在位：glm");
    expect(row.detail).toContain("设置页已存 2 家：deepseek、glm");
  });

  it("两侧都没有 ⇒ ✗，并指到 Provider 页", () => {
    const row = keysRow(doctorRows(REPORT, { available: true, stored: [], envActive: false }));
    expect(row.ok).toBe(false);
    expect(row.detail).toContain("环境变量与设置页都没有可用凭据");
    expect(row.hint).toContain("模型与 Provider");
  });

  it("密钥状态读不到 ⇒ 退回 doctor 原句并注明本次只查环境变量", () => {
    const row = keysRow(doctorRows(REPORT, null));
    expect(row.label).toBe("凭据（仅环境变量）");
    expect(row.detail).toContain("四个 provider key 全部未设");
    expect(row.detail).toContain("只查了环境变量");
  });

  it("其余检查原样映射：顺序、标签、提示", () => {
    const rows = doctorRows(REPORT, KEYS);
    expect(rows.map((r) => r.id)).toEqual(["node", "keys", "tiers", "sandbox", "workspace", "settings", "sessions", "search", "trust"]);
    expect(rows.find((r) => r.id === "node")?.label).toBe("Node");
    expect(rows.find((r) => r.id === "search")?.ok).toBe(false);
    expect(rows.find((r) => r.id === "search")?.label).toBe("联网搜索");
  });

  it("总档按上屏的行计数（凭据行换成桌面口径后不许与列表自相矛盾）", () => {
    const rows = doctorRows(REPORT, KEYS);
    expect(doctorVerdictText(REPORT, rows)).toBe("总档：部分就绪（1 项要处理）");
    const allPass: DoctorReport = { ...REPORT, checks: REPORT.checks.map((c) => ({ ...c, ok: true })), verdict: "就绪" };
    expect(doctorVerdictText(allPass, doctorRows(allPass, KEYS))).toBe("总档：就绪（9 项全过）");
  });
});

describe("AboutSection：运行诊断入口", () => {
  const html = renderToStaticMarkup(<AboutSection version="1.2.3" updateMsg={null} onCheckUpdate={() => undefined} />);

  it("按钮与「工程细节」在场；点击前不摆结果（不在面板打开时偷偷跑诊断）", () => {
    expect(html).toContain("运行诊断");
    // 第 1093 页：行标签已经是「运行诊断」，按钮不再复述同四个字；只留动作「运行」。
    expect((html.match(/运行诊断/g) ?? []).length).toBe(1);
    expect(html).toContain(">运行</button>");
    expect(html).toContain("工程细节");
    // 第 866 页：desc 原样复述了行标签（「工程细节」），已删——展开的 `<details>` 就是它的说明。
    expect(html).not.toContain("排查问题时对照日志使用的工程细节");
    expect(html).not.toContain('aria-label="诊断结果"');
  });

  it("接线：走 window.agent.doctor()，同时读 providerKeyStatus 合成凭据行", () => {
    // 第 1071 页：AboutSection 按区拆分至 settings/，诊断接线源文断言随段走（读新文件，不放宽）。
    const src = readFileSync(fileURLToPath(new URL("../src/renderer/components/settings/AboutSection.tsx", import.meta.url)), "utf8");
    expect(src).toContain("window.agent.doctor()");
    expect(src).toContain("window.agent.providerKeyStatus().catch(() => null)");
    // 第 1078 页：aria 收编进 STR 后源文只剩键——键形＋值锚（原意不放宽）。
    expect(src).toContain("aria-label={STR.about.diagnosisResultAria}");
    expect(STR.about.diagnosisResultAria).toBe("诊断结果");
    expect(src).toContain("const doctorRowsView = useMemo(() => doctor.status === \"ready\" ? doctorRows(doctor.report, doctor.keys) : [], [doctor]);");
    expect(src).toContain("const doctorVerdict = doctor.status === \"ready\" ? doctorVerdictText(doctor.report, doctorRowsView) : \"\";");
    // 第 803 页：复制报告走同一份行投影，不另拼一套。
    expect(src).toContain("doctorReportText({");
    expect(src).toContain("navigator.clipboard.writeText(text)");
    // 第 807 页：诊断包走同一份报告文本 + 主进程拼日志尾部。
    expect(src).toContain("window.agent.exportDiagnostics(text");
  });
});

describe("诊断失败项的「去修」落点", () => {
  it("只映射应用里真能改的项；环境/文件系统类的项不给假入口", () => {
    expect(doctorTarget("keys")).toBe("provider");
    expect(doctorTarget("sandbox")).toBe("permissions");
    expect(doctorTarget("search")).toBe("network");
    for (const id of ["node", "workspace", "settings", "sessions", "trust", "nope"]) {
      expect(doctorTarget(id)).toBeUndefined();
    }
  });

  it("失败的且可修的项渲染成按钮（带 data-doctor-id / aria-label）；通过的行仍是只读 div", () => {
    const rows = doctorRows(REPORT, { available: true, stored: [], envActive: false });
    const html = renderToStaticMarkup(<DoctorResultView rows={rows} onOpenSection={() => undefined} />);
    // 凭据失败 ⇒ 可点；联网搜索失败 ⇒ 可点。
    expect(html).toMatch(/<button[^>]*data-doctor-id="keys"[^>]*aria-label="凭据：到设置里处理"/);
    expect(html).toMatch(/<button[^>]*data-doctor-id="search"[^>]*aria-label="联网搜索：到设置里处理"/);
    // Node 通过（且本来也没有落点）⇒ 只读行。
    expect(html).toMatch(/<div[^>]*data-doctor-id="node"[^>]*class="ss-doctor-row ok"/);
    // 没有 onOpenSection ⇒ 失败行也不做按钮（不摆点了没反应的入口）。
    const readOnly = renderToStaticMarkup(<DoctorResultView rows={rows} />);
    expect(readOnly).not.toContain("<button");
    expect(readOnly).toContain('data-doctor-id="keys"');
  });

  it("AboutSection 把落点接到设置壳：传 setSection（源码接线见证）", () => {
    const panel = readFileSync(fileURLToPath(new URL("../src/renderer/components/SettingsPanel.tsx", import.meta.url)), "utf8");
    expect(panel).toContain("onOpenSection={setSection}");
  });
});

describe("诊断报告的可带走文本", () => {
  it("版本 / 生成时间 / 总档 / 逐行结果与提示都在，行序与屏上一致", () => {
    const rows = doctorRows(REPORT, { available: true, stored: [], envActive: false });
    const text = doctorReportText({
      version: "1.2.3",
      generatedAt: "2026-10-30T05:00:00.000Z",
      verdict: doctorVerdictText(REPORT, rows),
      rows,
    });
    expect(text).toContain("Cairn 诊断报告");
    expect(text).toContain("版本：1.2.3");
    expect(text).toContain("生成时间：2026-10-30T05:00:00.000Z");
    expect(text).toContain("总档：部分就绪（2 项要处理）");
    expect(text).toContain("[✗] 凭据：环境变量与设置页都没有可用凭据");
    expect(text).toContain("提示：到「模型与 Provider」保存一把密钥");
    expect(text).toContain("[✗] 联网搜索：search.endpoint 未配");
    expect(text.indexOf("[✓] Node")).toBeLessThan(text.indexOf("[✗] 凭据"));
    expect(text.endsWith("\n")).toBe(true);
  });

  it("版本读不到时写「未知」，不编造数字", () => {
    const rows = doctorRows(REPORT, KEYS);
    const text = doctorReportText({ version: null, generatedAt: "2026-10-30T05:00:00.000Z", verdict: "总档：就绪（9 项全过）", rows });
    expect(text).toContain("版本：未知");
  });
});
