// 「改之前先问波及谁」——影响面的**读端**工具。
//
// 为什么要它：M7 把影响图接在 write_file/edit_file **之后**（appendImpact → impact_report 事件），
// 于是模型只有在已经改完的那一刻才知道谁在调用它。而「这个改动会影响哪里」是仓库级理解的正面，
// 事前知道和事后知道差别不是体验而是返工：事前能一次改对调用方，事后只能等测试炸了再回头。
// 查询函数（upward / fileImpact / affectedFilesOf）早就有，缺的只是**模型够得着这一跳**
// ——与 spawn_agent、lsp 同族的「能力已发货、模型面不可见」缺陷。
//
// 注入纪律（同 obs_recall）：只由 agent-runner 在 impactAnalysis 开启时**同时**注入实例与规格，
// 不进静态工具表 ⇒ 关着的时候一次请求都不为该工具付字节。
import { defaultImpactCacheDir, fileImpact, upward, buildImpact, IMPACT_CONTEXT_FILES, IMPACT_CONTEXT_SYMBOLS_PER_FILE, type ImpactSite } from "../agent/impact/index.js";
import { assertNotAgentArea, assertRealContainment, resolveInWorkspace, ToolError, type Tool, type ToolResult } from "./base.js";

const FILES_CAP = IMPACT_CONTEXT_FILES;
const SYMS_CAP = IMPACT_CONTEXT_SYMBOLS_PER_FILE;

/** 调用点按文件汇聚的紧凑清单（与 contextNoteFor 同一套帽：宁少不炸上下文）。 */
function sitesNote(head: string, sites: ImpactSite[]): string {
  if (sites.length === 0) return head + "：无跨文件调用点（波及半径为 0）";
  const byFile = new Map<string, ImpactSite[]>();
  for (const s of sites) {
    const arr = byFile.get(s.file);
    if (arr) arr.push(s);
    else byFile.set(s.file, [s]);
  }
  const files = [...byFile.keys()];
  const shown = files.slice(0, FILES_CAP);
  const lines = [head + "：跨文件调用点 " + String(sites.length) + " 处，波及 " + String(files.length) + " 个文件"];
  for (const f of shown) {
    const arr = byFile.get(f)!;
    const syms = arr.slice(0, SYMS_CAP).map((s) => `${s.symbol}(L${String(s.line)})`).join(", ");
    lines.push("  " + f + ": " + syms + (arr.length > SYMS_CAP ? ` 等 ${String(arr.length)} 处` : ""));
  }
  if (files.length > shown.length) lines.push("  …另有 " + String(files.length - shown.length) + " 个文件未列出");
  return lines.join("\n");
}

export function createImpactQueryTool(cacheDir?: string): Tool {
  const dir = cacheDir ?? defaultImpactCacheDir();
  return {
    name: "impact_query",
    async run(args, ctx): Promise<ToolResult> {
      const symbol = typeof args.symbol === "string" ? args.symbol.trim() : "";
      const fileArg = typeof args.file === "string" ? args.file.trim() : "";
      if ((symbol === "") === (fileArg === "")) {
        throw new ToolError('impact_query: 参数恰好给一个——{"symbol":"fn"} 查谁在调用它，{"file":"src/x.js"} 查该文件全部符号的波及面');
      }
      if (fileArg !== "") {
        const abs = resolveInWorkspace(ctx.workspace, fileArg, "impact_query");
        assertNotAgentArea(fileArg, "impact_query");
        await assertRealContainment(ctx.workspace, abs, "impact_query");
        const r = await fileImpact(ctx.workspace, fileArg, dir);
        if (r === null) return { ok: false, output: "impact_query: 该文件不在影响图内（后缀不支持 / 未扫到 / 路径写错），先 glob 确认相对路径" };
        // 只列**真的被外面引用到**的符号：fileImpact 的 symbols 含函数内局部名（base/boosted…），
        // 照抄会让一屏摘要塞满无关名字——多花 token 还不给可执行信息。
        const refSyms = [...new Set(r.up.map((s) => s.symbol))].sort();
        const head = "[impact] " + r.file + (refSyms.length > 0
          ? "（被跨文件引用的符号 " + String(refSyms.length) + " 个：" + refSyms.slice(0, SYMS_CAP).join(", ")
            + (refSyms.length > SYMS_CAP ? " 等" : "") + "）"
          : "");
        return { ok: true, output: sitesNote(head, r.up) };
      }
      const graph = await buildImpact({ workspace: ctx.workspace, cacheDir: dir });
      const defined = graph.defs.get(symbol) ?? [];
      if (defined.length === 0 && (graph.refs.get(symbol) ?? []).length === 0) {
        return { ok: false, output: `impact_query: 图里没有符号 ${JSON.stringify(symbol)}（改名、未被引用、或不在已扫描的后缀内）` };
      }
      return { ok: true, output: sitesNote(`[impact] ${symbol} 的定义在 ${String(new Set(defined.map((d) => d.file)).size)} 个文件`, upward(graph, symbol)) };
    },
  };
}

/** 模型可见规格（与上面的实例一一对应；由 agent-runner 与实例同时注入）。
 *  刻意写短：工具面是按轮重送的固定成本，一句话讲清「什么时候用它而不是 grep」。 */
export const impactQuerySpec = {
  name: "impact_query",
  description: "查跨文件影响面（只读）：改一个符号或文件前问「谁在调用它」，比 grep 全仓准（走符号图）。",
  parameters: {
    type: "object",
    properties: {
      symbol: { type: "string", description: "要查调用点的符号名" },
      file: { type: "string", description: "要查波及面的文件（workspace 相对路径）" },
    },
  },
} as const;
