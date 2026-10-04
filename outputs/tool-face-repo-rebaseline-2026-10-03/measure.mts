// 甲口径重基线：只量本仓（m0-agent-loop）自己的模型面，回答一个问题——
//   本仓 agent 的工具面，到底会不会大到 MODEL_SURFACE_TOTAL_CHAR_LIMIT（24_000）需要降配梯？
//
// 口径纪律（V1 读数教训的转写）：
//  · 只用本仓 src/ 的真函数（sessionToolSpecs / accountModelSurface / planSurfaceBudget / surfaceSpecChars）。
//  · 不引用官方 App 的 ~/.dsh/** 任何数字做动机或论据——那是另一套系统。
//  · MCP 载荷是**合成**的：本机没有任何已装插件（见 00-读数.md §2），没有真实 schema 可量。
//    所以本脚本报的是**断算术**（repo 自己的帽 vs repo 自己的边际成本），不是现场读数。
//
// 用法：node --import tsx outputs/tool-face-repo-rebaseline-2026-10-03/measure.mts
import { sessionToolSpecs, gateToolSpecs, isCoreSurfaceTool, type SessionPluginTool } from "../../src/agent/glm-session";
import {
  accountModelSurface, planSurfaceBudget, surfaceSpecChars, surfaceTierOf,
  MODEL_SURFACE_TOTAL_CHAR_LIMIT, MODEL_SURFACE_TIGHT_DESC_CHAR_CAP,
} from "../../src/agent/model-surface";
import { BASE_SYSTEM } from "../../src/agent/system-prompt";

const line = (s = "") => console.log(s);
const hr = (t: string) => line(`\n${"═".repeat(72)}\n${t}\n${"═".repeat(72)}`);

// core 身份必须取本仓的权威判据 `isCoreSurfaceTool`（= gateToolSpecs() 名字集减去定时五件），
// **不能**用「default 档的面自己」当 coreNames——那会把定时五件（实际分档 optional）也误判成 core，
// 于是降配梯永远不砍它们。本脚手第一版就是这么写的，§1 的 optional=0 立刻暴露了它。
const base = sessionToolSpecs({ mode: "default" });
const allNames = gateToolSpecs().map((s) => s.function.name);
const coreNames: ReadonlySet<string> = new Set(allNames.filter(isCoreSurfaceTool));

// ---------------------------------------------------------------- §1 基线
hr("§1 基线：本仓 default / auto 档，无插件无 MCP");
{
  for (const mode of ["default", "read-only"] as const) {
    const face = sessionToolSpecs({ mode });
    const acct = accountModelSurface({
      systemChars: BASE_SYSTEM.length, specs: face.specs, coreNames, volatileChars: 0,
    });
    line(`  ${mode.padEnd(10)} ${String(face.specs.length).padStart(3)} tools  ` +
         `${String(acct.toolSpecChars).padStart(6)} chars tools  ` +
         `${String(acct.systemChars).padStart(5)} system  ` +
         `总 ${String(acct.totalChars).padStart(6)} / ${MODEL_SURFACE_TOTAL_CHAR_LIMIT}  ` +
         `(${(acct.totalChars / MODEL_SURFACE_TOTAL_CHAR_LIMIT * 100).toFixed(1)}%)  ` +
         `≈${Math.round(acct.totalChars / 4)} tok`);
  }
  const cnt = { core: 0, pinned: 0, optional: 0 } as Record<string, number>;
  const byTier = { core: 0, pinned: 0, optional: 0 } as Record<string, number>;
  for (const s of base.specs) {
    const t = surfaceTierOf(s.function.name, coreNames);
    cnt[t] = (cnt[t] ?? 0) + 1;
    byTier[t] = (byTier[t] ?? 0) + JSON.stringify(s).length;
  }
  line(`  实际分档计数：core ${cnt.core} 件 / pinned ${cnt.pinned} 件 / optional ${cnt.optional} 件（optional = 定时五件）`);
  line(`  分档字符：core ${byTier.core} / pinned ${byTier.pinned} / optional ${byTier.optional}`);
  line(`  紧帽（降配时描述压到）${MODEL_SURFACE_TIGHT_DESC_CHAR_CAP} chars/件`);
  line(`  余量：${MODEL_SURFACE_TOTAL_CHAR_LIMIT - accountModelSurface({
    systemChars: BASE_SYSTEM.length, specs: base.specs, coreNames, volatileChars: 0,
  }).totalChars} chars`);
}

// ------------------------------------------------- §2 skill / automation 两块挂载件
hr("§2 两块「装不装看配置」的挂载件：体积各多少");
{
  const skillSpec = {
    type: "function" as const,
    function: {
      name: "skill",
      description: "触发已加载的插件 skill（调用名见系统提示的 skill 路由表：/plugin:name 或 /name）；" +
        "返回该 skill 的全文指令，按指令继续执行",
      parameters: { type: "object", properties: { name: { type: "string", description: "skill 调用名（/plugin:name 或 /name）" },
        args: { type: "string", description: "传给 skill 的参数原文（正文里的 $ARGUMENTS / $1 / $name 按此替换；无参数可省略）" } },
        required: ["name"] },
    },
  };
  line(`  skill 工具（pinned）：${surfaceSpecChars([skillSpec as never])} chars`);
  const { automationToolSpecs } = await import("../../src/agent/automation-surface");
  const auto = automationToolSpecs();
  line(`  automation 五件（${auto.map((a) => a.function.name).join("/")}）：` +
       `${surfaceSpecChars(auto)} chars，分档 optional`);
}

// ------------------------------------------------- §3 MCP 边际成本 → 断点算术
hr("§3 断点算术：装几个 MCP 工具才碰得到 24_000");
{
  // 合成载荷：desc 里带 descChars 字的长句；parameters 里带 n 个「描述性」属性，各 descChars 长。
  // 三档代表 MCP server 的常见量级；真 schema 无上界（raw inputSchema 直传，见 sessionToolSpecs 注释）。
  const mk = (i: number, descChars: number, nProps: number): SessionPluginTool => ({
    name: `mcp${String(i).padStart(2, "0")}_do_thing`,
    description: "对目标执行动作。".repeat(Math.max(1, Math.round(descChars / 10))),
    parameters: {
      type: "object",
      properties: Object.fromEntries(Array.from({ length: nProps }, (_, k) => [
        `p${k}`, { type: "string", description: "参数语义说明。".repeat(Math.max(1, Math.round(descChars / 10))) },
      ])),
    },
  });
  const head = accountModelSurface({
    systemChars: BASE_SYSTEM.length, specs: base.specs, coreNames, volatileChars: 0,
  }).totalChars;
  const sysChars = BASE_SYSTEM.length;
  const budget = MODEL_SURFACE_TOTAL_CHAR_LIMIT - head;
  line(`  裸 default 面已占 ${head} chars，余量 ${budget} chars`);
  line();
  line(`  ${"载荷档（desc+每属性）".padEnd(20)}${"单件 chars".padStart(10)}${"断点件数".padStart(10)}   ${"说明".padEnd(0)}`);
  const rows: { label: string; descChars: number; nProps: number }[] = [
    { label: "精简 (200/2)", descChars: 200, nProps: 2 },
    { label: "中等 (600/4)", descChars: 600, nProps: 4 },
    { label: "话痨 (2048/6)", descChars: 2048, nProps: 6 },
    { label: "极端 (2048/12)", descChars: 2048, nProps: 12 },
  ];
  for (const r of rows) {
    const one = mk(0, r.descChars, r.nProps);
    const per = surfaceSpecChars([{ type: "function", function: { name: one.name, description: one.description, parameters: one.parameters } }]);
    const n = Math.floor(budget / per);
    line(`  ${r.label.padEnd(20)}${String(per).padStart(10)}${String(n).padStart(10)}`);
  }
  line();
  line(`  对照：本仓单条 MCP 描述的装载期硬帽 = 2048 chars（MCP_DESCRIPTION_CHAR_LIMIT, src/agent/plugins/mcp.ts:32），`);
  line(`        但 parameters 是 server inputSchema **原文直传**（不翻译不裁剪）⇒ 单件体积实际上不封顶。`);
}

// --------------------------------- §4 碰帽那一刻，降配梯做了什么、代价多大
hr("§4 碰帽那一刻：降配梯的实际动作与前缀稳定性");
{
  const mk = (i: number, descChars: number, nProps: number): SessionPluginTool => ({
    name: `mcp${String(i).padStart(2, "0")}_do_thing`,
    description: "对目标执行动作，细节见 server 手册。".repeat(Math.max(1, Math.round(descChars / 18))),
    parameters: { type: "object", properties: Object.fromEntries(Array.from({ length: nProps }, (_, k) => [
      `p${k}`, { type: "string", description: "参数语义说明，请按 schema 填写。".repeat(Math.max(1, Math.round(descChars / 18))) }])) },
  });
  const sizes = [4, 6, 8, 10, 12];
  line(`  ${"MCP 件数".padStart(8)}${"超时 chars".padStart(12)}${"压描述".padStart(10)}${"丢工具".padStart(10)}${"unresolvable".padStart(14)}${"前缀保留".padStart(12)}`);
  for (const n of sizes) {
    const pluginTools = Array.from({ length: n }, (_, i) => mk(i, 600, 4));
    const face = sessionToolSpecs({ mode: "default", pluginTools });
    const plan = planSurfaceBudget({
      systemChars: BASE_SYSTEM.length, specs: face.specs, coreNames, volatileChars: 0,
    });
    const orig = JSON.stringify(face.specs).length;
    line(`  ${String(n).padStart(8)}${String(plan.account.overChars).padStart(12)}` +
         `${String(plan.shortened.length).padStart(10)}${String(plan.dropped.length).padStart(10)}` +
         `${String(plan.unresolvable).padStart(14)}` +
         `${String(plan.prefixStableChars).padStart(6)} / ${orig}`);
  }
  line();
  line("  读法：降配梯 = 梯级 A 先压 optional/pinned 的描述到 600，再梯级 B 从尾部整条丢 optional。");
  line("        两者都破坏前缀（压描述改中段、丢工具截尾）⇒ 每轮重算时 prompt cache 都要重排。");
}

// ------------------------------------------------- §5 volatile 侧：记忆 / skills / 地图
hr("§5 一处口径缺口：volatile 块在生产调用点根本不入账");
{
  const head = accountModelSurface({ systemChars: BASE_SYSTEM.length, specs: base.specs, coreNames, volatileChars: 0 }).totalChars;
  line(`  裸面（system + 工具）${head} chars，距 24_000 余 ${MODEL_SURFACE_TOTAL_CHAR_LIMIT - head} chars。`);
  line(`  但生产调用点（src/agent/glm-session.ts:882-888 的 planSurfaceBudget）**不传 volatileChars**`);
  line(`  ⇒ accountModelSurface 落到 volatileChars = 0（model-surface.ts:83）。`);
  line(`  帽的注释（model-surface.ts:5-8「固定面 + 易变 system 块的字符和」）与生产实参不一致：`);
  line(`  记忆块 / 已挂 skill 正文 / 代码地图 每轮都真发出去，却一点没进这把账。`);
  line(`  ⇒ 降配梯按「只算工具」的口径做决定，而真实每轮固定成本比它判的更高。`);
  line(`  这不是 P0 能覆盖的：P0 记的 declared/sent 两口径同样来自这把账。`);
}
