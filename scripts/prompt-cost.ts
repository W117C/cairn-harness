// 每轮固定开销的**尺子**（2026-09-30 P1 立项）。
//
// 为什么要一把专门的尺：这个仓库量「测试绿不绿」「门过不过」「变异杀没杀」的尺子很多，
// 但「每一轮对话要付多少 token 的固定开销」这一格**从来没有过读数**——
// 而它是每轮都要付一次的钱：15 个工具的说明书 + 系统提示词在**每一轮**重送。
// 2026-09-30 实测（真模型、真任务）：
//   单行 bug 修复   7 轮  31,902 输入 token（缓存命中 74.6%）
//   跨 4 文件修复 16 轮  80,635 输入 token（缓存命中 82.0%）
//   其中第一轮 3,978 token 里有 2,281 是这块固定开销（57%）。
//
// 这把尺量的是**静态段**：模型每次请求都要重发的那部分。
// 它不量对话增长、不量工具返回、不量压缩——那些是别的格子的账。
//
// 用法：
//   node --import tsx scripts/prompt-cost.ts            # 四档面逐个报
//   node --import tsx scripts/prompt-cost.ts --json     # 机器可读（给回归对比用）
//   node --import tsx scripts/prompt-cost.ts --plugin-tools face.json  # 量一个含插件的真实面
//
// 退出码恒 0：它是尺子不是门（红了要拦谁也没想清楚）。哪天要拦，登记进 GATES 再谈。
import { sessionToolSpecs, OPTIONAL_TOOL_NAMES, type SessionPluginTool } from "../src/agent/session-provider";
import { AUTOMATION_TOOL_NAMES } from "../src/agent/automation-surface";
// 直接取生产按档发送的文本，避免为测量拉入整个 agent-runner 依赖链。
import { systemPromptFor } from "../src/agent/system-prompt";
import { PERMISSION_MODES, type PermissionMode } from "../src/permissions";

/** 估算 token：不引第三方分词器（本仓依赖面刻意小），按字符数 /3.6 折算。
 *  这个系数的口径来自实测反推：同一份静态段在真请求里量到的 input_tokens 与之同量级。
 *  它**只用于横向比较**（改前 vs 改后、这一档 vs 那一档），不当绝对值用——
 *  要绝对值请读事件流里的 `usage` 事件（那是厂商给的数）。 */
export const CHARS_PER_TOKEN = 3.6;
export const estTokens = (s: string): number => Math.round(s.length / CHARS_PER_TOKEN);

export interface FaceCost {
  mode: PermissionMode;
  tools: number;
  toolTokens: number;
  systemTokens: number;
  totalTokens: number;
  perTool: { name: string; tokens: number }[];
}

/** 某一档的模型可见工具面成本。`automation: false` = CLI 的取值（定时五件两面同摘）。
 *  `omit` = 这一 run 没开的能力（`RunOptions.goalArmed=false` ⇒ refine_goal，
 *  `autoMemory=false` ⇒ remember）。缺省按「两个都没开」算 = 最省的那一档。 */
export function faceCost(
  mode: PermissionMode,
  automation = false,
  omit?: readonly string[],
  /** 插件/MCP 注入面（`SessionPluginTool[]`，即 `sessionToolFace` 喂进来的那一份）。
   *  P0-b（2026-10-04 补）：这把尺此前只量首方面，`sessionToolSpecs({ mode })` 根本没接
   *  `pluginTools` ⇒ 「含插件真实面」量不出来，而那正是问题所在。不接这一参时行为逐字不变。 */
  pluginTools?: readonly SessionPluginTool[],
): FaceCost {
  const all = sessionToolSpecs({
    mode,
    ...(pluginTools && pluginTools.length > 0 ? { pluginTools } : {}),
  }).specs;
  // 「最省」= 四组可选面全摘（goal / memory / lsp / 子代理），与 runAgent 实际会摘的名单对齐。
  // 漏一组的后果不是少算，是**误导**：尺子会显示「还有 X 可省」，而 X 早就省掉了。
  const omitSet = new Set(
    omit ?? [
      ...OPTIONAL_TOOL_NAMES.goalTools,
      ...OPTIONAL_TOOL_NAMES.memoryTools,
      ...OPTIONAL_TOOL_NAMES.lspTools,
      ...OPTIONAL_TOOL_NAMES.subagentTools,
    ],
  );
  const specs = all
    .filter((s) => automation || !AUTOMATION_TOOL_NAMES.includes(s.function.name))
    .filter((s) => !omitSet.has(s.function.name));
  const perTool = specs
    .map((s) => ({ name: s.function.name, tokens: estTokens(JSON.stringify(s)) }))
    .sort((a, b) => b.tokens - a.tokens);
  const toolTokens = perTool.reduce((a, t) => a + t.tokens, 0);
  const systemTokens = estTokens(systemPromptFor(mode));
  return { mode, tools: specs.length, toolTokens, systemTokens, totalTokens: toolTokens + systemTokens, perTool };
}

/** 本仓插件的三个发现入口（`src/agent/plugins/discover.ts:271` + `src/main/agent-runner.ts:2525-2527`）。
 *  列在这里是给「今天到底有没有插件」一个**读数**而不是一句假设——2026-10-03 复核时，
 *  `~/.claude/plugins` 有 5 个条目，而它**不是**本仓的入口（那是 Claude Code 的目录约定）。
 *  只 stat + 数条目，不装载任何东西（不建信任库、不连 MCP）。 */
async function pluginRootState(): Promise<{ root: string; exists: boolean; entries: number }[]> {
  const { stat, readdir } = await import("node:fs/promises");
  const { join } = await import("node:path");
  // ⚠️ 工作区取 `M2B_WORKSPACE ?? cwd`，**与 session-provider.ts 的 `opts.workspace` 同一份来源**。
  // 第一版这里图省事写了 `PI_SCRATCH_DIR`，那是个临时目录不是工作区 ⇒ 把一个不存在的插件目录
  // 报成「12 个条目」。教训与本仓纪律同款：**读数工具自己取错根，输出的数字就是假的**，
  // 而且它不会报错。改根之后必须复跑核对，不能只看「跑通了」。
  const workspace = process.env.M2B_WORKSPACE ?? process.cwd();
  const roots = [
    { root: "M2E_USER_PLUGINS env", dir: process.env.M2E_USER_PLUGINS },
    { root: "<workspace>/.agent/plugins", dir: join(workspace, ".agent", "plugins") },
    { root: "M2E_LOOSE_SKILLS env", dir: process.env.M2E_LOOSE_SKILLS },
  ];
  const out = [];
  for (const r of roots) {
    if (!r.dir) { out.push({ root: r.root, exists: false, entries: 0 }); continue; }
    try {
      const st = await stat(r.dir);
      if (!st.isDirectory()) { out.push({ root: r.root, exists: false, entries: 0 }); continue; }
      out.push({ root: r.root, exists: true, entries: (await readdir(r.dir)).length });
    } catch { out.push({ root: r.root, exists: false, entries: 0 }); }
  }
  return out;
}

async function loadPluginTools(file: string): Promise<SessionPluginTool[]> {
  const { readFile } = await import("node:fs/promises");
  const raw: unknown = JSON.parse(await readFile(file, "utf8"));
  if (!Array.isArray(raw)) throw new Error("插件面文件必须是 SessionPluginTool[] 的 JSON 数组");
  return raw.map((t, i) => {
    const o = t as Record<string, unknown>;
    if (typeof o.name !== "string" || o.name === "") throw new Error(`第 ${String(i)} 件缺 name`);
    return {
      name: o.name,
      description: typeof o.description === "string" ? o.description : "",
      parameters: (typeof o.parameters === "object" && o.parameters !== null ? o.parameters : {}) as Record<string, unknown>,
      ...(o.grade !== undefined ? { grade: o.grade as never } : {}),
    };
  });
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const asJson = argv.includes("--json");
  const fileIdx = argv.indexOf("--plugin-tools");
  let pluginTools: SessionPluginTool[] | undefined;
  if (fileIdx >= 0) {
    const f = argv[fileIdx + 1];
    if (!f || f.startsWith("--")) {
      console.error("--plugin-tools 需要一个 JSON 文件路径（SessionPluginTool[]）");
      process.exit(2);
    }
    try { pluginTools = await loadPluginTools(f); }
    catch (e) { console.error("读插件面失败：" + (e instanceof Error ? e.message : String(e))); process.exit(2); }
  }
  const roots = await pluginRootState();
  // full = 两个可选能力都开着（挂满）；lean = 都没开（CLI 常见形状，摘掉 refine_goal/remember）。
  const faces = PERMISSION_MODES.map((m) => faceCost(m, false, [], pluginTools));
  const lean = PERMISSION_MODES.map((m) => faceCost(m, false, undefined, pluginTools));
  if (asJson) {
    process.stdout.write(JSON.stringify({
      charsPerToken: CHARS_PER_TOKEN,
      // `full` = 两个可选能力都开着时挂满；`lean` = 都没开时（CLI 的常见形状）。
      full: faces.map((f) => ({ mode: f.mode, tools: f.tools, totalTokens: f.totalTokens })),
      lean: lean.map((f) => ({ mode: f.mode, tools: f.tools, totalTokens: f.totalTokens })),
      // 插件面读数：这次量的是不是「含插件的真实面」。没传 --plugin-tools 时 pluginToolsIn=false
      // ⇒ 数字**不含插件**，不许被当成含插件读数引用。
      pluginToolsIn: pluginTools ? pluginTools.length : 0,
      pluginRoots: roots,
      faces,
    }, null, 2) + "\n");
    return;
  }
  console.log("== 每轮固定开销（静态段：工具说明书 + 系统提示词）==");
  console.log("估算口径：字符数 / " + String(CHARS_PER_TOKEN) + "（横向比较用；绝对值看事件流的 usage）");
  console.log("");
  console.log("  本仓插件发现入口（stat + 数条目，不装载）：");
  for (const r of roots) {
    console.log("    " + r.root.padEnd(28) + (r.exists ? String(r.entries) + " 个条目" : "不存在"));
  }
  console.log("  注：`~/.claude/plugins` **不是**本仓入口（那是 Claude Code 的目录约定）；");
  console.log("      本仓读的是上表三个，读不到它 ⇒ 那个目录里有多少东西都与本仓的面无关。");
  console.log("  本次测量" + (pluginTools
    ? "**含 " + String(pluginTools.length) + " 件插件/MCP 工具**（来自 --plugin-tools）。"
    : "**不含任何插件工具**（没传 --plugin-tools）——下面的数字只是首方面。"));
  console.log("");
  const base = faces.find((f) => f.mode === "default")!;
  console.log("  档位        挂满（goal+记忆都开）      最省（都没开）");
  for (const f of faces) {
    const l = lean.find((x) => x.mode === f.mode)!;
    console.log(
      "  " + f.mode.padEnd(10)
      + String(f.tools).padStart(2) + " 件 " + String(f.totalTokens).padStart(5) + " tok/轮"
      + "        "
      + String(l.tools).padStart(2) + " 件 " + String(l.totalTokens).padStart(5) + " tok/轮"
      + "   （省 " + String(f.totalTokens - l.totalTokens).padStart(4) + "）",
    );
  }
  console.log("");
  console.log("  最大面（" + base.mode + "）逐件：");
  for (const t of base.perTool) {
    const pct = ((100 * t.tokens) / base.toolTokens).toFixed(0);
    console.log("    " + t.name.padEnd(20) + String(t.tokens).padStart(5) + " tok  " + pct.padStart(3) + "%");
  }
  console.log("");
  console.log("  第一轮实测（跨 4 文件修复那次 3,978 tok）里，静态段占 "
    + ((100 * base.totalTokens) / 3978).toFixed(0) + "%（挂满）/ "
    + ((100 * lean.find((x) => x.mode === "default")!.totalTokens) / 3978).toFixed(0) + "%（最省）");
  console.log("");
  console.log("  说明：静态段**每一轮都要重送**，所以省下来的不是一次性的钱，是 × 轮数。");
}

await main();
