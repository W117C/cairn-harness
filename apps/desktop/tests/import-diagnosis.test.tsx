// v12 导入诊断卡判卷（ADR 0004 §4）：导入已有项目先给「支持 / 需要补充信息 / 当前不支持」三态诊断。
// 口径：① 三态 badge 恰为 ADR 原话；② 依据与下一步逐条来自 main 侧诊断（不另编结论）；
// ③ 卡上带项目名（诊断结论自身不带名字，防与当前激活项目混淆）；④ 非阻断——只有「知道了」一个动作。
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ProjectDiagnosis } from "../../../src/main/ipc-protocol";
import { ImportDiagnosisCard } from "../src/renderer/components/ImportDiagnosisCard";
import { STR } from "../src/renderer/strings";

function html(diagnosis: ProjectDiagnosis): string {
  return renderToStaticMarkup(<ImportDiagnosisCard name="演示项目" diagnosis={diagnosis} onDismiss={() => {}} />);
}

const supported: ProjectDiagnosis = {
  verdict: "supported",
  runKind: "static",
  form: "static-html",
  summary: "零依赖静态网页（入口 index.html）",
  reasons: ["根目录有入口页 index.html", "没有 package.json——不需要装依赖"],
};

const needsInfo: ProjectDiagnosis = {
  verdict: "needs-info",
  runKind: null,
  form: null,
  summary: "这个文件夹还差入口页：没找到能打开的网页",
  reasons: ["根目录只有样式与脚本，没有 .html 文件"],
  hint: "把页面命名成 index.html 放在根目录，或换一个文件夹。",
};

const unsupported: ProjectDiagnosis = {
  verdict: "unsupported",
  runKind: null,
  form: null,
  summary: "当前不支持这种项目形态",
  reasons: ["根目录有 package.json，但依赖里没有 vite——还不是受支持的构建形态"],
  hint: "先用受支持的模板新建一个项目。",
};

describe("导入诊断卡：三态文案", () => {
  it("badge 恰为 ADR 0004 §4 的三句原话（三态不许自造说法）", () => {
    expect(STR.importDiagnosis.verdict.supported).toBe("支持");
    expect(STR.importDiagnosis.verdict.needsInfo).toBe("需要补充信息");
    expect(STR.importDiagnosis.verdict.unsupported).toBe("当前不支持");
  });

  it("三态各挂各的调（ok / warn / no）并带上判定码", () => {
    expect(html(supported)).toContain('data-verdict="supported"');
    expect(html(supported)).toContain("is-ok");
    expect(html(needsInfo)).toContain("is-warn");
    expect(html(unsupported)).toContain("is-no");
  });
});

describe("导入诊断卡：结论与依据", () => {
  it("supported：摆结论与逐条依据；hint 缺席就不摆「下一步」", () => {
    const h = html(supported);
    expect(h).toContain("零依赖静态网页（入口 index.html）");
    expect(h).toContain("根目录有入口页 index.html");
    expect(h).toContain("没有 package.json——不需要装依赖");
    expect(h).not.toContain(STR.importDiagnosis.next);
  });

  it("needs-info / unsupported：hint 在场时摆「下一步」原话", () => {
    expect(html(needsInfo)).toContain(STR.importDiagnosis.next);
    expect(html(needsInfo)).toContain("把页面命名成 index.html 放在根目录，或换一个文件夹。");
    expect(html(unsupported)).toContain(STR.importDiagnosis.next);
    expect(html(unsupported)).toContain("先用受支持的模板新建一个项目。");
  });

  it("依据为空不摆空列表（不摆没有内容的「为什么」）", () => {
    const h = html({ ...supported, reasons: [] });
    expect(h).not.toContain(STR.importDiagnosis.why);
    expect(h).not.toContain("<ul");
  });

  it("卡上带项目名（结论自身不带名字，防与当前激活项目混淆）", () => {
    expect(html(supported)).toContain("演示项目");
  });
});

describe("导入诊断卡：非阻断", () => {
  it("只有一个动作——「知道了」（没有取消/阻止类按钮；诊断不拦登记与会话）", () => {
    const h = html(needsInfo);
    expect((h.match(/<button/g) ?? []).length).toBe(1);
    expect(h).toContain(STR.importDiagnosis.dismiss);
    expect(h).toContain(STR.importDiagnosis.aria);
  });
});
