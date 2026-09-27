/**
 * AGENTS.md 从 194 行瘦到 19 行时，哪些「与桌面无关的判卷纪律」会一起消失？
 *
 * 本探针只回答一件事：**每条规矩现在靠什么活着**——靠 AGENTS.md 那段文字，还是靠代码里的
 * 出现处（门 / 断言 / 逃生舱）。两者都没有的那一类，才是改写时会静默丢掉的东西。
 *
 * 只读：不改任何文件。跑法（仓根）：
 *   TERM=dumb node --import tsx outputs/agents-md-core-only-migration-2026-09-24/guardian-probe.mts
 *
 * 三态（不许把「没扫到」读成「没问题」）：
 *   ① 取料面为空 / 一条规矩的候选文件数为 0 ⇒ 没尺，红着退出；
 *   ② 规矩在 stub 与代码里都 0 命中 ⇒ 「已丢」，红着退出（这就是本页要量的东西）；
 *   ③ 有命中 ⇒ 正常出数。
 */

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

interface Rule {
  /** 编号只在本次读数内引用，不落进别的页。 */
  id: string;
  /** HEAD 版 AGENTS.md 里那条规矩的说法（人读）。 */
  claim: string;
  /** 这条规矩是否与桌面层有关：false = 桌面没了它照样成立。 */
  desktopOnly: boolean;
  /** 代码侧出现处的搜索词（任一命中即算「代码里还写着」）。 */
  tokens: string[];
}

/** 取料面：只走 tracked 文件（未跟踪的在飞页会让"这条还有没人守"的读数假绿）。
 *  两面必须分开：**散文里提过 ≠ 有门在守**（PROGRESS.md 会提到任何词，把它算进机检面
 *  就等于把「没人守」读成「有人守」——本探针要量的正是这件事）。 */
const MECHANISM_PREFIXES = ["scripts/", "src/", "tests/"];
const MECHANISM_FILES = ["package.json"];
const PROSE_FILES = ["PROGRESS.md", "docs/README.md", "docs/CODE-WIKI.md"];

const RULES: Rule[] = [
  { id: "A1", claim: "门禁清单即事实源，本文件与任务书一律不写死门数（写死即漂移磁铁）", desktopOnly: false, tokens: ["gate-manifest", "GATES"] },
  { id: "A2", claim: "未证 ≠ 通过：DSH_STRICT_UNVERIFIED / UNVERIFIED= 汇总", desktopOnly: false, tokens: ["DSH_STRICT_UNVERIFIED", "UNVERIFIED="] },
  { id: "A3", claim: "主树被别的会话占着时跑 pnpm gates --direct（换执行器、门清单不变）", desktopOnly: false, tokens: ["--direct", "DSH_GATE_DIRECT"] },
  { id: "A4", claim: "跑验收一律 TERM=dumb（ANSI 序列会让摘要正则假红）", desktopOnly: false, tokens: ["TERM=dumb", "TERM", "dumb"] },
  { id: "A5", claim: "直连 vitest 必带 --config（注入 PI_SCRATCH_DIR 兜底 + exclude .worktrees）", desktopOnly: false, tokens: ["PI_SCRATCH_DIR", ".worktrees"] },
  { id: "A6", claim: "fixtures/mock 与 todo-app/tests 是判卷文件，sha256 冻结在 scripts/frozen-sha256.json，改它们等于作弊", desktopOnly: false, tokens: ["frozen-sha256"] },
  { id: "A7", claim: "判据有缺陷 → 写 BLOCKED.md 要求换判据，不许改代码去绕", desktopOnly: false, tokens: ["BLOCKED.md"] },
  { id: "A8", claim: "shell grep 的 \\b \\s \\| 三个 GNU 扩展在 BSD grep 静默返回空（本仓误判 4 次）", desktopOnly: false, tokens: ["BSD grep", "静默返回空", "GNU"] },
  { id: "A9", claim: "门禁判据一律写在 JS 侧；命令行排查一律 grep -E", desktopOnly: false, tokens: ["JS 侧", "grep -E"] },
  { id: "A10", claim: "改过被变异锚点钉住的实现，提交前跑 mutate-needles-check 并归零（0 命中的读法是「突变未生效」）", desktopOnly: false, tokens: ["mutate-needles-check", "突变未生效"] },
  { id: "A11", claim: "提交前相交检查：工作树对 HEAD 有 diff 且不是你刚写的 ⇒ 别人的原子单元，只追加不改写", desktopOnly: false, tokens: ["相交检查", "别人的原子单元", "原子单元"] },
  { id: "A12", claim: "构建假红陷阱：宿主 safe-delete 计数器，逃生舱 CODEBUDDY_SAFE_DELETE_BULK_STATE_DIR= 只用于构建/门禁", desktopOnly: false, tokens: ["CODEBUDDY_SAFE_DELETE_BULK_STATE_DIR"] },
  { id: "A13", claim: "agent-plan.md 原则上只读，改它要走总册 §3.7 的 diff→Review→批准", desktopOnly: false, tokens: ["agent-plan"] },
  { id: "A14", claim: "当日快照不得回改；现行层禁「用追注代替改写」（docs-check D-4）", desktopOnly: false, tokens: ["D-4", "追注"] },
  { id: "A15", claim: "macOS 路径必须 realpath（/tmp 实为 /private/tmp），否则规则静默失效", desktopOnly: false, tokens: ["realpathSync", "/private/tmp"] },
  { id: "A16", claim: "不变量由 N 处写法共同成立时，变异要一次废 N 支", desktopOnly: false, tokens: ["一次废", "N 支"] },
  { id: "A17", claim: "渲染层是手写 vanilla，无 React/Tailwind/shadcn 运行时", desktopOnly: true, tokens: ["renderer", "vanilla"] },
  { id: "A18", claim: "沙箱门按宿主自动选分支并显式打印（fail-visible），反向通道 --force-available / --bogus-root（HEAD 那句把 ipc/panels 两支捆在一起，那两支属桌面）", desktopOnly: false, tokens: ["force-available", "--bogus-root"] },
  { id: "A19", claim: "底栏 #eventCount 是裸整数、#tokenTotal 会缩写成 1.5k ⇒ 对 token 不写裸数字断言", desktopOnly: true, tokens: ["eventCount", "tokStr"] },
  { id: "A20", claim: "右栏五面板唯一数据源 = projectPanelData，渲染层不得挂演示常量", desktopOnly: true, tokens: ["projectPanelData", "panelEmptyHTML"] },
  { id: "A21", claim: "Electron 拒载 Chromium 沙箱的宿主必须 --no-sandbox --disable-gpu", desktopOnly: true, tokens: ["--no-sandbox", "--disable-gpu"] },
];

interface Hit {
  file: string;
  line: number;
  text: string;
  /** 这条出现处是**注释**（只是把规矩抄在源码里）还是**代码/断言**（真的按它办事）。
   *  不分这一格，"代码里搜到了"就会把"只活在注释里"读成"有门守着"——那是同一族的假绿。 */
  side: "注释" | "断言" | "代码";
}

const COMMENT_LINE = /^(?:\/\/|\/\*|\*)/;
const ASSERT_LINE = /expect\(|assert\.|assertion|\bthrow\b|process\.exit\(/;

/** 在给定语料里逐行找 token；返回命中处（最多每文件 2 条，防爆量）。 */
function findHits(corpus: Map<string, string>, tokens: string[]): Hit[] {
  const out: Hit[] = [];
  for (const [file, text] of corpus) {
    let perFile = 0;
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      const ln = lines[i]!;
      if (!tokens.some((t) => ln.includes(t))) continue;
      const t = ln.trim();
      const side: Hit["side"] = COMMENT_LINE.test(t) ? "注释" : ASSERT_LINE.test(t) ? "断言" : "代码";
      out.push({ file, line: i + 1, text: t.slice(0, 120), side });
      perFile += 1;
      if (perFile >= 2) break;
    }
  }
  return out;
}

function trackedFiles(): string[] {
  // `-z` 不是风格问题：默认输出会把非 ASCII 路径转义成 `"...\345\270\202.md"`，
  // 那种串 readFileSync 必 ENOENT ⇒ 中文文件名的页整批静默离开取料面。
  const raw = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" });
  return raw.split("\0").filter((p) => p.length > 0);
}

/** 自检（每次跑都注入，且投两个来源）：
 *  ① 合成语料里放一条必然存在的标记 ⇒ 必须命中；
 *  ② 合成语料里放一条永不存在的标记 ⇒ 必须 0 命中。
 *  任一不符 ⇒ 本探针自己红，别把"扫不到"当成"没有债"。 */
function selfCheck(): string[] {
  const errs: string[] = [];
  const fake = "__never_exists_probe_marker_7f3c__";
  const synth = new Map<string, string>([
    ["a.ts", "const x = 1;\n// SENTINEL_LINE for probe self-check\n"],
    ["b.ts", `// ${fake}\n`],
    ["c.ts", "function t() {\n  expect(SENTINEL_LINE).toBe(1);\n}\n"],
  ]);
  const hitSentinel = findHits(synth, ["SENTINEL_LINE"]);
  if (hitSentinel.length < 2) errs.push(`自检①：合成语料里那条标记应至少被扫到 2 处，实测 ${String(hitSentinel.length)} ⇒ 取料函数坏了（读数为 0 不成立）`);
  const sides = new Set(hitSentinel.map((h) => h.side));
  if (!sides.has("注释") || !sides.has("断言")) errs.push(`自检②：注释/断言分侧失效，实测侧集合 ${[...sides].join(",")} ⇒ "只剩注释" 这一格会读错`);
  const hitFake = findHits(synth, [fake]);
  if (hitFake.length !== 1) errs.push(`自检③：不存在的标记应命中 1 次（就在合成语料里），实测 ${String(hitFake.length)} ⇒ 命中判定坏了`);
  const hitAbsent = findHits(new Map<string, string>([["d.ts", "nothing here\n"]]), ["SENTINEL_LINE"]);
  if (hitAbsent.length !== 0) errs.push("自检④：空语料却报命中 ⇒ 判据恒真");
  return errs;
}

function main(): number {
  const self = selfCheck();
  if (self.length > 0) {
    for (const e of self) console.log(`  ❌ 自检 ${e}`);
    console.log("guardian-probe: ❌ 自检未过，读数不可信");
    return 1;
  }

  const tracked = trackedFiles();
  const read = (p: string): string | null => {
    const abs = join(ROOT, p);
    if (!existsSync(abs)) return null; // tracked 但盘上已删（在飞）：不进取料面，下面单独点名
    try {
      return readFileSync(abs, "utf8");
    } catch {
      return null; // 二进制/权限
    }
  };

  const mechanism = new Map<string, string>();
  const prose = new Map<string, string>();
  for (const p of tracked) {
    if (!/\.(ts|tsx|js|mjs|cjs|json|md)$/.test(p)) continue;
    const text = read(p);
    if (text === null) continue;
    if (MECHANISM_PREFIXES.some((pre) => p.startsWith(pre)) || MECHANISM_FILES.includes(p)) mechanism.set(p, text);
    else if (PROSE_FILES.includes(p)) prose.set(p, text);
  }

  // stub 单独一支：AGENTS.md 的「现在还在不在文字里」按盘上算，不按 HEAD 算。
  const stub = new Map<string, string>();
  const stubText = read("AGENTS.md") ?? "";
  if (stubText.length > 0) stub.set("AGENTS.md", stubText);

  if (mechanism.size === 0) {
    console.log("  ❌ 机检面为空（scripts/src/tests 一个都没读到）⇒ 没尺，不是没问题");
    return 1;
  }

  console.log(`取料：tracked ${String(tracked.length)} 个文件｜机检面 ${String(mechanism.size)} 个｜散文面 ${String(prose.size)} 个｜stub ${String(stub.size)} 个`);
  console.log(`stub 现量：${String(stubText.length)} 字节 / ${String(stubText.split("\n").length)} 行\n`);

  const lost: string[] = [];
  const rows: string[] = [];
  for (const r of RULES) {
    const codeHits = findHits(mechanism, r.tokens);
    const stubHits = findHits(stub, r.tokens);
    const proseHits = findHits(prose, r.tokens);
    const asserted = codeHits.filter((h) => h.side !== "注释").length;
    const state =
      stubHits.length > 0 && asserted > 0 ? "stub 有 + 有非注释出现"
        : stubHits.length > 0 ? "stub 有（仅文字）"
          : asserted > 0 ? "stub 无｜机制非注释 " + String(asserted) + " 处"
            : codeHits.length > 0 ? "stub 无｜机制只剩注释" : "三面都没有";
    if (!r.desktopOnly && asserted === 0) lost.push(`${r.id}｜${state}｜${r.claim}`);
    rows.push(`${r.id} [${r.desktopOnly ? "桌面专属" : "桌面无关"}] ${state}｜机制 断言/代码 ${String(asserted)}・注释 ${String(codeHits.length - asserted)}｜散文 ${String(proseHits.length)}｜${r.claim}`);
    for (const h of codeHits.slice(0, 2)) rows.push(`      · ${h.side} ${h.file}:${String(h.line)}  ${h.text}`);
  }
  for (const line of rows) console.log(line);

  const desktopIndependent = RULES.filter((r) => !r.desktopOnly).length;
  console.log(`\n桌面无关规矩 ${String(desktopIndependent)} 条，其中机制面「断言/代码」零出现 ${String(lost.length)} 条（= 只剩注释或全无，抄在源码里的字不算守）`);
  if (lost.length > 0) {
    console.log("  ⚠️  下面这些**没有非注释的机制在按它办事** ⇒ 改写 AGENTS.md 时必须逐条决定「搬进 stub」还是「点名作废」：");
    for (const l of lost) console.log(`    - ${l}`);
    console.log("guardian-probe: ❌ 有待裁决条目（本探针的判据就是它）");
    return 2;
  }
  console.log("guardian-probe: ✅ 桌面无关的每条规矩都至少有一处非注释的机制出现");
  return 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
