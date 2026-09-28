/** `pnpm prompt-surface-check` —— 模型可见文本 ↔ 工具面 的可达性门（任务 #13）。
 *
 * fail-visible：逐条 ✅/❌ 打印实测读数；取料面为空直接红（真空通过是本仓最忌的假绿）。
 * 反向对照：`-- --self-test` 用两份合成文本证明这把尺**有分辨力**（dead 与 odd 各咬一处），
 * 而不是只证明它今天没红。
 */
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { systemPromptFor } from "../src/main/agent-runner";
import { TOOL_NAMES } from "../src/tools/base";
import { PERMISSION_MODES } from "../src/permissions/modes";
import { sessionToolSpecs } from "../src/agent/glm-session";
import { EVIDENCE_TEXT, goalReminder } from "../src/agent/goal";
import {
  promptSurfaceCell,
  promptSurfaceFindings,
  toolNameTokens,
  unhitExemptions,
  type PromptSurfaceExempt,
} from "../src/agent/prompt-surface";

/** 存量豁免：**空**。第 174 页登记过 3 条（edit_file／write_file／wait_for_agents @read-only），
 *  任务 #16 把那一档的文本拆开后（`systemPromptFor("read-only")`）三条一起失去存在理由。
 *  这张表要加长，必须是**新一轮登记**：逐条带理由、只准调低、过期即红（规则 238）。 */
export const PROMPT_SURFACE_EXEMPT: PromptSurfaceExempt = [];

export function tablesByMode(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const m of PERMISSION_MODES) out[m] = sessionToolSpecs({ mode: m }).specs.map((s) => s.function.name);
  return out;
}

/** 一把文本面：文本 + 它实际发给哪几档 + 认工具名时是否只认名单。 */
export type SurfaceFace = { name: string; text: string; modes: readonly string[]; namesOnly?: boolean };

/** 取料与生产端**共用同一个决策点**：文本面不是手抄清单，而是逐档调 `systemPromptFor`，
 *  再把「文本逐字相同」的那些档合并成一面（同一份文本对几档 ⇒ 那几档共用它，odd 才有意义）。
 *  好处是反过来的也成立：若有人把某一档的差异抹平，那些档会自动并成一面，共用文本对缺席档的承诺当场报 odd——
 *  不需要有人记得来改这份清单（`报数前先重测`／`判据要与生产端共用决策点`）。 */
export function proseFaces(): SurfaceFace[] {
  const byText = new Map<string, string[]>();
  for (const m of PERMISSION_MODES) {
    const text = systemPromptFor(m);
    const list = byText.get(text);
    if (list === undefined) byText.set(text, [m]);
    else list.push(m);
  }
  return [...byText.entries()].map(([text, modes]) => ({
    name: `systemPrompt[${modes.join(",")}]`,
    text,
    modes,
  }));
}

/** 第二类模型可见文本：**每把工具自己的 description**。它比散文更容易长出「指着别的能力」的句子——
 *  本笔就是靠它抓到现读的 `propose_plan`：缺省描述写「批准前 write_file/run_shell 会被权限层拒绝」，
 *  而只读档那两把连面都不在（那句等于让模型去理解一个它拿不到的能力）。
 *  取料逐调 `sessionToolSpecs({mode})`（生产端同一个决策点），面覆盖档＝那一档。
 *  判据按面选 `namesOnly`：描述里的蛇形多数是参数名/目录名（现读 `old_string`／`node_modules`），形状判据会把它们全报成死引用。 */
export function descriptionFaces(): SurfaceFace[] {
  const out: SurfaceFace[] = [];
  for (const m of PERMISSION_MODES) {
    for (const s of sessionToolSpecs({ mode: m }).specs) {
      out.push({ name: `desc[${m}].${s.function.name}`, text: String(s.function.description ?? ""), modes: [m], namesOnly: true });
    }
  }
  return out;
}

/** 第三类面：**goal 续跑提醒**——它是逐轮重发的动态文本，却和系统提示词一样是模型唯一能读到的指令。
 *  09-24 那次事故（join 文案命令模型去调一把不存在的工具）就在这一族里，而前两族都覆盖不到它。
 *  渲染取料：`goalReminder` 是纯函数，逐证据态 × hint 有无 各渲一份；
 *  objective 用**不含任何工具名**的合成目标——真人写的需求里出现工具词是用户的话，不是我们的承诺，
 *  把那种文本喂进来只会让门去管不属于它的东西。 */
export function reminderFaces(): SurfaceFace[] {
  const out: SurfaceFace[] = [];
  for (const evidence of Object.keys(EVIDENCE_TEXT)) {
    for (const withHint of [false, true]) {
      const body = goalReminder(
        { objective: "把这一件事做完，按验收口径交结果。", maxTurns: 20, maxUsd: 2 } as never,
        3, 0.42, evidence as never,
        withHint ? "上一轮按失败信息改完后重跑，再看证据态。" : undefined,
      );
      out.push({ name: `goalReminder[${evidence}${withHint ? "+hint" : ""}]`, text: body, modes: PERMISSION_MODES });
    }
  }
  return out;
}

/** 第四类面：**参数自己的描述**（schema 里每一处 `description`）。
 *  它比工具级 description 更细一格：模型看到的参数说明是逐字段写进规格里的，同样是指令。
 *  必须**递归**走树：现读 189 份里有 6 份在两层嵌套下（`spawn_agent.supervise.*`），
 *  只走顶层 `properties` 的那一版读到 183——这 6 份就是「为什么要递归」的证人，不是假想需求。
 *  一份都没取到要抛：`0 发现`在这一族里长得最像好消息（规则 242）。 */
export function paramFaces(): SurfaceFace[] {
  const out: SurfaceFace[] = [];
  for (const md of PERMISSION_MODES) {
    for (const s of sessionToolSpecs({ mode: md }).specs) {
      const hits: { path: string; text: string }[] = [];
      collectParamDescriptions(s.function.parameters, s.function.name, hits);
      for (const h of hits) out.push({ name: `params[${md}].${h.path}`, text: h.text, modes: [md], namesOnly: true });
    }
  }
  if (out.length === 0) throw new Error("参数描述面一份都没取到 ⇒ 走树坏了，这一格不能印 0");
  return out;
}

function collectParamDescriptions(node: unknown, path: string, out: { path: string; text: string }[]): void {
  if (typeof node === "string") return;
  if (Array.isArray(node)) { for (const item of node) collectParamDescriptions(item, path, out); return; }
  if (node === null || typeof node !== "object") return;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === "description" && typeof value === "string") { out.push({ path, text: value }); continue; }
    collectParamDescriptions(value, `${path}.${key}`, out);
  }
}

/** 参数说明**覆盖率**：逐把「有声明参数」的工具数它有几条**自己写着说明**的参数。
 *  只印、不拦。现读（2026-09-28 第 179 页）：18 把有参数的工具里 3 把一条说明都没有
 *  （`clarify`／`propose_plan`／`run_shell`），1 把不全（`write_file` 缺 `content`）。
 *  前三把刻意不补：`clarify` 的 1–4 问／2–4 选项写在**工具级描述**里且与校验器常量对上，
 *  `propose_plan` 的嵌套形状由 `items.required` 声明——再在参数级抄一遍就是第二份真相（规则 205）。
 *  判「有说明」只看参数自己那一格，不看子树：现读实测「直接说明」与「子树里有说明」两种口径**零个参数不同**
 *  （2026-09-28 探针：DIRECT_VS_NESTED_DIFFERENT=0）⇒ 子树那一支没有证人，就不写它（规则 243/257②）。
 *  为什么这一格不进退出码：判它得看真轨迹，而现读轨迹里没有"参数形状写错"这一类失败——
 *  共用 `scripts/replay/corpus.ts` 的取料扫 24 个 `.jsonl`：`tool_call` 301 次、`ok:false` 15 次，
 *  15 次里 0 次来自参数校验器（内容是环境红／命令红／worker 回传红，唯一次形状类是 `edit_file` 的
 *  「old_string 0 处匹配」——那是抄错内容，不是不知道字段含义，且那条回执当场给了下一步）。
 *  ⇒ 没有失败证据就把覆盖率做成红，等于用文案量代替行为量（规则 245）。
 *  有了带归因的跑批之后（任务：把这张表变成常驻读数）再决定升不升成闸。 */
export function paramProseCoverage(): { tool: string; declared: number; explained: number; missing: string[] }[] {
  const byTool = new Map<string, { declared: number; explained: number; missing: string[] }>();
  for (const md of PERMISSION_MODES) {
    for (const s of sessionToolSpecs({ mode: md }).specs) {
      const props = (s.function.parameters as Record<string, unknown>).properties as Record<string, unknown> | undefined;
      if (props === undefined) continue;
      const named = Object.keys(props);
      if (named.length === 0) continue;
      const missing: string[] = [];
      for (const key of named) {
        const v = props[key] as { description?: unknown } | null;
        if (typeof v?.description !== "string") missing.push(key);
      }
      // 同一把工具在多档各出现一次：规格同源，所以按名字去重（取第一次读数）。
      if (!byTool.has(s.function.name)) byTool.set(s.function.name, { declared: named.length, explained: named.length - missing.length, missing });
    }
  }
  return [...byTool.entries()]
    .map(([tool, v]) => ({ tool, declared: v.declared, explained: v.explained, missing: v.missing }))
    .sort((a, b) => a.tool.localeCompare(b.tool));
}

/** 四族面**只在这一处组成**：`main()` 与判卷读的都是同一份，加一族只改这一行。
 *  （原先 `main()` 自己 `[...system, ...descs, ...reminders]` 拼了一份，判卷读的是 `allFaces()` 那一份——
 *  两份列表就是规则 253 点名的「同一件事两把尺」：门实际扫的面可以悄悄比判卷看见的面少。） */
export type FaceFamily = "prose" | "desc" | "reminder" | "param";

export function faceFamilies(): Record<FaceFamily, SurfaceFace[]> {
  return { prose: proseFaces(), desc: descriptionFaces(), reminder: reminderFaces(), param: paramFaces() };
}

export function allFaces(): SurfaceFace[] {
  return Object.values(faceFamilies()).flat();
}

export function main(argv: string[] = process.argv.slice(2)): number {
  const selfTest = argv.includes("--self-test");
  const tables = tablesByMode();
  const fams = faceFamilies();
  const faces = Object.values(fams).flat();
  const counts = Object.entries(tables).map(([m, t]) => `${m}=${String(t.length)}`).join(" ");
  console.log(`[prompt-surface] 取料：系统文本 ${String(fams.prose.length)} 份（${fams.prose.map((f) => f.name).join("、")}）` +
    `｜工具描述 ${String(fams.desc.length)} 份（按档取规格面，namesOnly）` +
    `｜续跑提醒 ${String(fams.reminder.length)} 份（goalReminder 逐证据态渲染）` +
    `｜参数描述 ${String(fams.param.length)} 份（逐档递归走 schema，namesOnly）` +
    `｜工具面 ${counts}｜工具名单 ${String(TOOL_NAMES.length)} 个`);

  if (selfTest) return selfTestRun();

  const findings = promptSurfaceFindings(faces, tables, TOOL_NAMES, PROMPT_SURFACE_EXEMPT);
  const cell = promptSurfaceCell(findings);
  console.log(`  ${findings.length === 0 ? "✅" : "❌"} ${cell}`);
  for (const f of findings) {
    console.log(`  ❌ ${f.kind === "dead" ? "死引用" : "不可达承诺"}：${f.face} 里的 \`${f.token}\` 在 ${f.modes.join(",")} 档拿不到`);
  }
  // 豁免的账：先按**不豁免**跑一遍拿原始发现，再判每条豁免是不是真挡住了（同一份谓词，两处共用）。
  const raw = promptSurfaceFindings(faces, tables, TOOL_NAMES, []);
  const stale = unhitExemptions(PROMPT_SURFACE_EXEMPT, raw);
  console.log(`  ℹ️  存量豁免 ${String(PROMPT_SURFACE_EXEMPT.length)} 条，其中本次真命中 ${String(PROMPT_SURFACE_EXEMPT.length - stale.length)} 条（命中方清，只准调低）`);
  for (const e of stale) {
    console.log(`  ❌ 豁免过期：\`${e.token}@${e.mode}\` 已经不命中了 ⇒ 该条要从表里删掉（留着它就会放过同名的新问题）`);
  }
  // 反向读数：形状判据本身要有产出，否则「0 发现」可能只是尺坏了。
  // 这一行必须**按面自己的判据**取 token（与上面 findings 同一份谓词、同一组开关）——
  // 拿两种口径印读数，就是规则 253 点名的「同一件事两把尺，各自漂」。
  const tokens = [...new Set(faces.flatMap((f) => toolNameTokens(f.text, TOOL_NAMES, { namesOnly: f.namesOnly })))];
  console.log(`  ℹ️  文本里点到的工具名 ${String(tokens.length)} 个：${tokens.join(" ")}`);
  // 覆盖率那一格**只印不拦**（理由见 `paramProseCoverage` 的头注）：分母是「有声明参数的工具数」，
  // 而不是工具总数——`verify`／`automation_list` 没有参数，把它们算进分母会让覆盖率替形状报错。
  const cov = paramProseCoverage();
  const noProse = cov.filter((c) => c.explained === 0);
  const partial = cov.filter((c) => c.explained > 0 && c.explained < c.declared);
  console.log(`  ℹ️  参数说明覆盖（不计入退出码）：有参数的工具 ${String(cov.length)} 把，` +
    `一条说明都没有 ${String(noProse.length)} 把（${noProse.map((c) => c.tool).join(" ")}）` +
    `，不全 ${String(partial.length)} 把（${partial.map((c) => `${c.tool} ${String(c.explained)}/${String(c.declared)} 缺:${c.missing.join(",")}`).join("；")}）`);
  const newIssues = findings.length;
  console.log(newIssues === 0 && stale.length === 0 ? "[prompt-surface] 全部通过 ✅" : "[prompt-surface] 有要处理的格子 ❌");
  // 取料坏了也算红：一个工具名都没在文本里认出来 ⇒ 多半是面/名单没读到，而不是提示词突然不提工具了。
  if (tokens.length === 0) console.log("  ❌ 文本面一个工具名都没认出来 ⇒ 取料可疑，不许读成「没有承诺」");
  return newIssues === 0 && stale.length === 0 && tokens.length > 0 ? 0 : 1;
}

/** 合成料证明这把尺**能分辨**，不是只证明它今天没红（规则 222/226）。 */
function selfTestRun(): number {
  const tables = { auto: ["edit_file", "verify"], read: ["verify"] };
  const dead = promptSurfaceFindings([{ name: "t", text: "用 no_such_tool 去做" }], tables, TOOL_NAMES, []);
  const odd = promptSurfaceFindings([{ name: "t", text: "改文件用 edit_file" }], tables, TOOL_NAMES, []);
  // 负控的用料必须**都在合成面上**：上一版拿 `clarify` 当「都在面上」的例子，
  // 而它压根不在那两份合成表里 ⇒ 被判 dead，把负控自己变成了发现（尺没错，是我喂错了）。
  const clean = promptSurfaceFindings([{ name: "t", text: "先 verify 再把结论收在一句里" }], tables, TOOL_NAMES, []);
  const waived = promptSurfaceFindings([{ name: "t", text: "改文件用 edit_file" }], tables, TOOL_NAMES,
    [{ token: "edit_file", mode: "read", why: "test" }]);
  // 第 175 页（任务 #16）新增的第三轴：**一份文本可以只发给部分档**。这一面必须只看它覆盖的那几档，
  // 否则拆开之后那些档会被牵连报红（不拆的理由就没了），而把缺席档的承诺放过去又正好是这一格要抓的事。
  const scopedHit = promptSurfaceFindings([{ name: "t", text: "改文件用 edit_file", modes: ["read"] }], tables, TOOL_NAMES, []);
  const scopedClean = promptSurfaceFindings([{ name: "t", text: "改文件用 edit_file", modes: ["auto"] }], tables, TOOL_NAMES, []);
  // 第四轴（第 176 页）：**工具描述**也是模型可见文本，而它按 namesOnly 判——
  // 否则参数名／目录名（`old_string`／`node_modules`）会被整报成死引用，那面就再也读不出真承诺。
  // 这一对控件要另建合成面：`write_file` 必须在**别档**存在（缺了它就成了 dead，而真实现读的形状是 odd——
  // 上一版直接复用了 `tables`，于是控件把自己的形状写错了，红是尺抓到了我，不是我抓到了尺）。
  const dTables = { auto: ["edit_file", "verify", "write_file"], read: ["verify"] } as const;
  const descPromise = promptSurfaceFindings(
    [{ name: "d", text: "批准前 write_file 会被权限层拒绝", modes: ["read"], namesOnly: true }], dTables, TOOL_NAMES, []);
  const descParams = promptSurfaceFindings(
    [{ name: "d", text: "排除 node_modules，按 old_string 精确替换", modes: ["read"], namesOnly: true }], dTables, TOOL_NAMES, []);
  const lines = [
    [dead.some((f) => f.kind === "dead" && f.token === "no_such_tool"), "死引用那一档要能报出来"],
    [odd.some((f) => f.kind === "odd" && f.token === "edit_file" && f.modes.join() === "read"), "共用文本对缺席档要报不可达"],
    [clean.length === 0, "都在面上时不许造红（负控）"],
    [waived.length === 0, "豁免要真能消掉那一条"],
    [scopedHit.some((f) => f.kind === "odd" && f.modes.join() === "read"), "只发给缺席档的文本也要报（覆盖档由调用方给）"],
    [scopedClean.length === 0, "只发给在场档的文本不许报（覆盖档不是全局四档）"],
    [descPromise.some((f) => f.kind === "odd" && f.token === "write_file"), "描述里点了别档才有的工具要报（namesOnly 仍然认名单）"],
    [descParams.length === 0, "描述里的参数名／目录名不许当工具承诺（namesOnly 的意义）"],
  ] as const;
  let bad = 0;
  for (const [ok, what] of lines) {
    if (!ok) bad += 1;
    console.log(`  ${ok ? "✅" : "❌"} 自检：${what}`);
  }
  let threw = false;
  try { promptSurfaceFindings([{ name: "t", text: "x" }], {}, TOOL_NAMES, []); } catch { threw = true; }
  console.log(`  ${threw ? "✅" : "❌"} 自检：工具面一格都没取到时要抛，不许印 0`);
  if (!threw) bad += 1;
  let threwScope = false;
  try { promptSurfaceFindings([{ name: "t", text: "x", modes: ["nosuchmode"] }], tables, TOOL_NAMES, []); } catch { threwScope = true; }
  console.log(`  ${threwScope ? "✅" : "❌"} 自检：覆盖档写错名字要抛（不能把「读不到那一档」读成「那一档没承诺」）`);
  if (!threwScope) bad += 1;
  console.log(bad === 0 ? "[prompt-surface] --self-test 全造得红 ✅" : `[prompt-surface] --self-test 有 ${String(bad)} 条不红 ❌`);
  return bad === 0 ? 0 : 1;
}

// 入口判定：单测 import 本模块不得把门跑起来（同款写法见 scripts/no-progress-check.ts、model-surface-check.ts）。
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exit(main());
}
