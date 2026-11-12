// P1 主界面重做：文案目录判卷。
// ① 值非空、无占位符（TODO/待定/英文占位）；② 无开发者禁词（自查清单第 2/3 条的机器判卷）；
// ③ 重做面组件源文扫描：字符串字面量里出现 CJK 即红（文案必须来自 STR；注释里可以有中文）。
import { readFileSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { STR } from "../src/renderer/strings";

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) collectStrings(v, out);
  else if (value !== null && typeof value === "object") for (const v of Object.values(value)) collectStrings(v, out);
  return out;
}

const ALL = collectStrings(STR);

describe("STR 文案目录", () => {
  it("值全部非空字符串、无占位符", () => {
    expect(ALL.length).toBeGreaterThan(50);
    for (const s of ALL) {
      expect(s.trim().length).toBeGreaterThan(0);
      expect(s).not.toMatch(/TODO|待定|FIXME|placeholder|XXX/i);
    }
  });

  it("无开发者禁词（RunRequest / attachments / IPC / JSONL / sidecar / worktree / canonical / realpath / 绝对路径）", () => {
    const banned = /RunRequest|attachments|IPC|JSONL|sidecar|worktree|canonical|realpath|绝对路径/;
    for (const s of ALL) expect(s, `文案含禁词：${s}`).not.toMatch(banned);
  });
});

/** 重做面组件源文扫描（随各任务逐步收编；P1-2/P1-3 把侧栏三件套收编；P2 收编空屏与输入区四件；
 *  App 待 P2/P3 全量迁移后收）。
 *  规则：剥注释（// 行注释与块注释）后，字符串字面量（"…" '…' `…`）里出现 CJK 即红。 */
const REWORKED_FILES: readonly string[] = [
  "src/renderer/sessions-view.ts",
  "src/renderer/components/Sidebar.tsx",
  "src/renderer/components/AddProjectMenu.tsx",
  "src/renderer/components/NewProjectDialog.tsx",
  "src/renderer/components/QuickStarts.tsx",
  "src/renderer/components/Composer.tsx",
  "src/renderer/components/ModelPicker.tsx",
  "src/renderer/components/PermissionMenu.tsx",
  "src/renderer/components/ImportDiagnosisCard.tsx",
  // 2026-11-11 工作状态面板收编（第 1063 页）：清单 aria 与空态文案进 STR；
  // 同页删去不可达的「非运行空态」分支（visible 门保证 todos=null 时必 running）。
  "src/renderer/components/WorkStatusPanel.tsx",
  // 2026-11-12 通用段收编（第 1075 页）：选项表 / 行标签 / aria / 开关词进 STR.general
  //（值一字不改；判据侧 design-minimal、settings-section-titles、settings-ui、text-size-setting 同步升级 STR 形感知）。
  "src/renderer/components/settings/GeneralSection.tsx",
  // 2026-11-12 快捷键段/权限与安全段收编（第 1076 页）：值一字不改；两段的标题/行标签判据走同一套 STR 形解析。
  "src/renderer/components/settings/ShortcutsSection.tsx",
  "src/renderer/components/settings/PermissionsSection.tsx",
  // 2026-11-12 模型与 Provider 段收编（第 1077 页）：段与其纯函数资产（provider-assets）一起收，
  // 状态行/搜索/识图三族文案只有一个出口（STR.provider），值一字不改。
  "src/renderer/components/settings/ProviderSection.tsx",
  "src/renderer/components/settings/provider-assets.ts",
  // 2026-11-12 关于与更新段收编（第 1078 页）：版本/许可证/更新/偏好备份/运行诊断/工程细节六区，
  // 含许可证三态、诊断回执与两枚确认卡——值一字不改。
  "src/renderer/components/settings/AboutSection.tsx",
  // 2026-11-11 检查器收编（第 1064 页）：三 Tab 名 / 撤销钮 / ＋菜单 / 关闭钮 /
  // 计划态 chip 与 diff 加载文案进 STR.inspector（值一字不改，模板走 .replace）。
  "src/renderer/components/Inspector.tsx",
  // 2026-11-11 速查表收编（第 1065 页）：3 组标题 + 28 what 描述 + 13 核心 label
  // 进 STR.shortcut / STR.shortcutTable（值一字不改；键位字面量不含 CJK，不在收编范围）。
  "src/renderer/shortcuts.ts",
  // 2026-11-07 设置面整批收编（上一批复查批遗留项）：以下 14 个文件的用户可见文案
  // 全部收进 STR（值面不变，源文不写裸中文）；此后面不再回退。
  "src/renderer/components/SettingsPanel.tsx",
  "src/renderer/components/settings/LspStatusRow.tsx",
  "src/renderer/components/settings/PersonalizationSection.tsx",
  "src/renderer/components/settings/EvolveSection.tsx",
  "src/renderer/components/settings/EvolvePanel.tsx",
  "src/renderer/components/settings/integration-ui.tsx",
  "src/renderer/components/settings/doctor-view.ts",
  "src/renderer/components/settings/usage-dashboard-data.ts",
  "src/renderer/components/settings/SubagentsSection.tsx",
  "src/renderer/components/settings/MigrationSection.tsx",
  "src/renderer/components/settings/NetworkSection.tsx",
  "src/renderer/components/settings/HooksSection.tsx",
  "src/renderer/components/settings/UsageSection.tsx",
  "src/renderer/components/settings/McpSection.tsx",
];

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => {
      const at = line.indexOf("//");
      if (at < 0) return line;
      // 只剥「注释起点不在字符串里」的近似行——本仓这些文件的行注释都在行尾且字符串不含 //
      return line.slice(0, at);
    })
    .join("\n");
}

describe("重做面组件不写裸中文", () => {
  it("字符串字面量里无 CJK（文案一律走 STR）", () => {
    for (const rel of REWORKED_FILES) {
      const src = stripComments(readFileSync(fileURLToPath(new URL("../" + rel, import.meta.url)), "utf8"));
      const literals = [
        ...src.matchAll(/"([^"\n]*)"/g),
        ...src.matchAll(/'([^'\n]*)'/g),
        ...src.matchAll(/`([^`]*)`/g),
      ].map((m) => m[1] ?? "");
      const offenders = literals.filter((t) => /[\u4e00-\u9fff]/.test(t));
      expect(offenders, `${rel} 里有裸中文文案：${offenders.join(" | ")}`).toEqual([]);
    }
  });
});

// 死键审计（2026-11-11 · 第 1061 页）：1085 个 STR 叶子逐个 cross-check src+tests 消费，
// 21 个零消费键逐条人工核实为「功能被取代 / 状态不可达 / 从未接线」，无一属「功能活着但丢了接线」。
// 反复活＋正对照：绿不许靠删空整个命名空间换来。
describe("STR 死键族不许复活（第 1061 页）", () => {
  const dead: readonly (readonly [string, string])[] = [
    ["work", "todoDone"], ["work", "todoPending"],
    ["sidebar", "sessionRenameTip"], ["sidebar", "sessionEmptyTitle"], ["sidebar", "notYet"],
    ["footer", "appearanceTip"],
    ["errors", "folderOnly"],
    ["sessionProject", "noProject"],
    ["composer", "attachRecentSub"], ["composer", "attachOutsideTag"],
    ["composer", "meterCtx"], ["composer", "meterCtxRemaining"], ["composer", "meterCtxRemainingValue"],
    ["modelPicker", "demoPlayback"], ["modelPicker", "goSettings"], ["modelPicker", "effortGroupAria"],
    ["shortcut", "prevSession"], ["shortcut", "nextSession"],
    ["design", "inspectorNoPlans"], ["design", "inspectorNoTimeline"],
    ["update", "manifestSaved"],
  ];

  it("21 个零消费键全部缺席", () => {
    const ns = STR as unknown as Record<string, Record<string, unknown>>;
    for (const [n, k] of dead) expect(ns[n]?.[k], `${n}.${k} 复活了`).toBeUndefined();
  });

  it("正对照：各命名空间的活兄弟键仍在", () => {
    expect(STR.work.process).toBeTruthy();
    expect(STR.sidebar.pinned).toBeTruthy();
    expect(STR.footer.appearance).toBeTruthy();
    expect(STR.errors.diagnoseFailed).toBeTruthy();
    expect(STR.sessionProject.assign).toBeTruthy();
    expect(STR.composer.attachOutsideTip).toBeTruthy();
    expect(STR.composer.meterCtxDetail).toBeTruthy();
    expect(STR.composer.attachRecent).toBeTruthy();
    expect(STR.modelPicker.effortAria).toBeTruthy();
    expect(STR.modelPicker.manage).toBeTruthy();
    expect(STR.shortcut.newTask).toBeTruthy();
    expect(STR.design.inspectorNoChanges).toBeTruthy();
    expect(STR.update.manifestLabel).toBeTruthy();
  });
});

/**
 * 第 1172 页：把第 1061 页那次「一次性审计」变成常驻棘轮。
 * 旧法按词边界搜叶子名（confirm 命中 ConfirmDialog、rename 命中 renameSessionById）
 * ⇒ 11 个零消费键被误判成「活着」。这里按**真实消费形状**扫：
 *   ① `STR.<完整点路径>`；② 整命名空间传对象（如 `toolFailureSummary(f, STR.toolGroup)`；
 *   ③ 引号里的完整点路径（strValue 动态查找）。三者都没有 ⇒ 静态死键。
 * 取料面 = 渲染层全部 .ts/.tsx（除 strings*.ts 自身），剥注释后拼接；目录在调用时枚举，
 * 新文件自动进面。数组叶子整体算一个（quickStarts.fallback / empty.greetingX 由整组引用）。
 */
function strLeafPaths(value: unknown, prefix: string[], out: string[]): void {
  if (typeof value === "string" || Array.isArray(value)) { out.push(prefix.join(".")); return; }
  if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) strLeafPaths(v, prefix.concat(k), out);
  }
}

function productSourceFace(): { corpus: string; files: number } {
  const root = fileURLToPath(new URL("../src/renderer", import.meta.url));
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name.startsWith(".") || ["node_modules", "dist", "dist-electron", "vendor"].includes(name)) continue;
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(name) || /^strings(-[a-z]+)?\.ts$/.test(name)) continue;
      files.push(full);
    }
  };
  walk(root);
  const strip = (src: string): string => src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").map((line) => { const at = line.indexOf("//"); return at < 0 ? line : line.slice(0, at); }).join("\n");
  return { corpus: strip(files.map((f) => readFileSync(f, "utf8")).join("\n")), files: files.length };
}

describe("STR 零消费键常驻棘轮（第 1172 页）", () => {
  it("全表叶子都有真实消费形状；死键数为 0", () => {
    const leafPaths: string[] = [];
    strLeafPaths(STR, [], leafPaths);
    expect(leafPaths.length, "取不到叶子说明扫描器坏了，不许空跑成绿").toBeGreaterThan(1200);
    const { corpus, files } = productSourceFace();
    expect(files, "渲染层取料面为空，不许空跑成绿").toBeGreaterThan(200);
    const namespaceObjects = new Set(
      [...corpus.matchAll(/STR\.([A-Za-z0-9_]+)(?![A-Za-z0-9_.])/g)].map((m) => m[1] ?? ""),
    );
    const dead = leafPaths.filter((p) =>
      !corpus.includes("STR." + p)
      && !namespaceObjects.has(p.split(".")[0] ?? "")
      && !corpus.includes('"' + p + '"')
      && !corpus.includes("'" + p + "'"));
    expect(dead, "零消费 STR 键：" + dead.join(" | ")).toEqual([]);
    // 防空转：面里确实存在「整命名空间传对象」与逐键两种形状，否则规则被收窄也能绿。
    expect(corpus).toContain("STR.toolGroup)");
    expect(corpus).toContain("STR.removeProject.confirm");
    expect(corpus).toContain("STR.common.remove");
  });
});
