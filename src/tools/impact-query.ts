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
import { defaultImpactCacheDir, downward, fileImpact, upward, buildImpact, IMPACT_CONTEXT_FILES, IMPACT_CONTEXT_SYMBOLS_PER_FILE, IMPACT_MAX_FILES_CEILING, type ImpactSite } from "../agent/impact/index.js";
import { access } from "node:fs/promises";
import { MAX_FILES_DEFAULT, scanSourceFilesAll } from "../agent/map/build.js";
import { SUPPORTED_EXTS } from "../agent/map/parse.js";
import { assertNotAgentArea, assertRealContainment, resolveInWorkspace, ToolError, type Tool, type ToolResult } from "./base.js";

const FILES_CAP = IMPACT_CONTEXT_FILES;
const SYMS_CAP = IMPACT_CONTEXT_SYMBOLS_PER_FILE;

/** 两个方向共用同一套帽，但措辞不能混：up 回答「谁在调用我」，deps 回答「我在调用谁」。
 *  缺省 noun = up ⇒ 既有调用的输出字节逐字不变（有测锁）。 */
interface SiteNoun { item: string; group: string; none: string }
const UP_NOUN: SiteNoun = { item: "跨文件调用点", group: "波及", none: "：无跨文件调用点（波及半径为 0）" };
const DEP_NOUN: SiteNoun = { item: "引用的外部定义", group: "分布在", none: "：不引用任何定义在别处的符号（依赖面为 0）" };

/** 「在图外」的四种成因分开说（纯函数，可单测）。
 *  上一步只分出了「后缀不支持 / 盘上没有」两支，剩下那支原先是一句 either/or
 *  （"图按最近改动取有限个文件，或被 .gitignore 排除"）——可这两种成因的**下一步不同**：
 *  帽外是"下次改动就可能进图，现在直读"，被忽略是"图等不到它，直接换 grep/lsp"。
 *  说成 either/or 等于让模型自己猜该等还是该换。`pos` = 该文件在全量候选里按 mtime 排的位置，
 *  -1 = 压根没进候选集，null = 候选集重扫失败（不许假装有结论）。 */
export function graphAbsenceNote(rel: string, cap: number, pos: number | null): string {
  if (pos === null) {
    return `impact_query: ${rel} 存在且后缀受支持，但落在本次符号图外 ⇒ 波及半径未知（**不等于 0**）。` +
      "候选集重扫失败，说不出是哪一种成因；要看全量请直读该文件与其引用方（grep/lsp）";
  }
  if (pos < 0) {
    return `impact_query: ${rel} 在盘上、后缀受支持，却连候选集都没进 ⇒ 被 .gitignore 规则或噪声目录` +
      "（.git/node_modules/dist/out）永久排除，**重新建图也不会收它**；波及半径未知（**不等于 0**），" +
      "要查请直接用 grep/lsp 读它的引用方";
  }
  if (pos >= cap) {
    return `impact_query: ${rel} 在候选集第 ${String(pos + 1)} 位，而本次图只收录 ${String(cap)} 个` +
      `（帽按最近改动取）⇒ 被文件数帽挤掉，波及半径未知（**不等于 0**）；` +
      "要么直读该文件与其引用方（grep/lsp），要么调大 maxFiles 后重问";
  }
  return `impact_query: ${rel} 排在候选集第 ${String(pos + 1)} 位（帽内），却没进这张图 ⇒ 图是刚才那次构建的快照` +
    "（新建/刚改名，或该文件解析失败被跳过）；再问一次即可让它进图";
}

/** 「不在图内」的成因分开说，一共六种：后缀不支持 / 路径没有这个文件 / 帽外 / 没进候选集 /
 *  帽内却没进图（快照滞后）/ 候选集扫不动。后四种由 `graphAbsenceNote` 判（它能拿到位置与帽）。
 *  （2026-09-23 实测：本仓 436 个候选源码里 36 个在图外，支配性成因是**帽**而不是路径写错——
 *  旧文案把「未扫到」与「路径写错」混在一句里，模型照着去 glob 是白跑一轮。）
 *  这里只多一次 access + 一次候选集重扫，且只在缺席这条分支上付；帽用与建图同一个常量
 *  （`MAX_FILES_DEFAULT`），两边各写一个数字就会一处调、另一处静默说错话。
 *  「未知 ≠ 0」必须明写：面板侧早已钉死「缺席 ≠ 波及 0」，读端不该说反话。
 *  abs 由调用方解析好传进来（那边已经 resolveInWorkspace + 越界断言过，不重复解析也不重复设防）。 */
async function notInGraphNote(workspace: string, rel: string, abs: string, cap: number): Promise<string> {
  const ext = rel.includes(".") ? rel.slice(rel.lastIndexOf(".") + 1).toLowerCase() : "";
  if (!SUPPORTED_EXTS.includes(ext)) {
    return `impact_query: ${rel} 的后缀 .${ext} 不在符号图支持集内 ⇒ 波及半径未知（不等于 0）`;
  }
  const onDisk = await access(abs).then(() => true, () => false);
  if (!onDisk) return `impact_query: 该相对路径下没有文件 ⇒ 先 glob 确认（${rel}）`;
  return graphAbsenceNote(rel, cap, await graphCandidatePosition(workspace, rel));
}

/** `maxFiles` 的取值口径（纯函数）。非法值一律**点名拒绝**，不静默回落成缺省：
 *  「帽外」那条说明正教模型去调大它，若 0 / 小数 / 超上限被悄悄换成 400，
 *  模型会以为自己的取值生效了——与本工具其他参数同一不妥协口径。
 *  上界不是装饰：这一位现在由模型传，而建图是每文件一次 tree-sitter 解析（依据见
 *  `IMPACT_MAX_FILES_CEILING` 的实测注释）。 */
export function resolveMaxFiles(raw: unknown): number {
  if (raw === undefined) return MAX_FILES_DEFAULT;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1 || raw > IMPACT_MAX_FILES_CEILING) {
    throw new ToolError(
      `impact_query: maxFiles 必须是 1..${String(IMPACT_MAX_FILES_CEILING)} 的整数` +
        `（收到 ${typeof raw} ${String(raw)}）——缺省是 ${String(MAX_FILES_DEFAULT)}，要更全的图就报一个上限内的数`,
    );
  }
  return raw;
}

/** 该文件在**全量候选**（rg + 后缀过滤 + mtime 排序）里的位置：`-1` = 压根没进候选集，
 *  `null` = 扫不动（rg 不可用 / 工作区路径不能扫）。单独成一个导出函数，是为了让
 *  "扫不动"这一格有真观测者：测试把 workspace 指到一个不存在的路径，`rg` 以退出码 2 真失败
 *  ⇒ 走到 catch。这不是 mock，而是把同一句政策放到够得着的坐标上判。 */
export async function graphCandidatePosition(workspace: string, rel: string): Promise<number | null> {
  try {
    const all = await scanSourceFilesAll(workspace);
    return all.findIndex((f) => f.rel === rel);
  } catch {
    return null; // 不假装有结论：交回 null，由 graphAbsenceNote 如实说"分辨不出"
  }
}

/** 覆盖面自述（纯函数）：图被文件数帽挤过时，**成功**答案也要说清自己量了多大一块。
 *
 *  为什么阳性一侧也要说：本工具的**阴性**结论早就各自带分诊（"无跨文件调用点"、"图里没有这个符号"
 *  都会说"不等于 0"），但一个**成立**的答复原先只报结果不报覆盖面 ⇒ 模型看到"波及 1 个文件"就以为
 *  问全了，而这张图可能只收了仓库的一小截（2026-09-25 本仓实测：451 个候选只收 400）。
 *  这与 grep/glob 那条"阴性要说清扫描面"是同一条政策的后半句。
 *
 *  判据是**精确**的而非保守的：`applyFileCap` 只做 `slice(0, maxFiles)` ⇒ 「收录数 < 帽」⟺ 这一刀
 *  没切到东西（真全量，一字不许多，零回归）；只有「收录数 ≥ 帽」才可能有文件被挤在图外。
 *  措辞说"非全量"而不是"漏了 N 个"：挤掉多少个要重扫全量候选才知道，而这一格不值一次 rg。 */
export function coverageNote(files: number, cap: number): string {
  if (files < cap) return "";
  return `（覆盖度：本图收录 ${String(files)} 个文件＝帽 ${String(cap)} ⇒ 图非全量，` +
    "图里没有 ≠ 仓库里没有；要更全调大 maxFiles 后重问）";
}

/** 调用点按文件汇聚的紧凑清单（与 contextNoteFor 同一套帽：宁少不炸上下文）。 */
function sitesNote(head: string, sites: ImpactSite[], noun: SiteNoun = UP_NOUN): string {
  if (sites.length === 0) return head + noun.none;
  const byFile = new Map<string, ImpactSite[]>();
  for (const s of sites) {
    const arr = byFile.get(s.file);
    if (arr) arr.push(s);
    else byFile.set(s.file, [s]);
  }
  const files = [...byFile.keys()];
  const shown = files.slice(0, FILES_CAP);
  const lines = [head + "：" + noun.item + " " + String(sites.length) + " 处，" + noun.group + " " + String(files.length) + " 个文件"];
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
      const wantDeps = args.deps === true;
      if (wantDeps && fileArg === "") {
        throw new ToolError('impact_query: deps 只配合 file 使用——{"file":"src/x.js","deps":true} 列本文件引用的外部定义');
      }
      // 帽在这一处解析一次，之后**三个建图出口共用同一个值**（symbol 支 / file 支 / deps 支）。
      // 少接一支就是同族只硬化一支：那支会静默按缺省建图，而说明里的数字随之变成假话。
      const maxFiles = resolveMaxFiles(args.maxFiles);
      if (fileArg !== "") {
        const abs = resolveInWorkspace(ctx.workspace, fileArg, "impact_query");
        assertNotAgentArea(fileArg, "impact_query");
        await assertRealContainment(ctx.workspace, abs, "impact_query");
        if (wantDeps) {
          // 反向一跳：downward 早就有实现与单测，但模型面够不着 ⇒ 「跨模块理解依赖」只兑现了一半
          // （只有"谁在用我"，没有"我在用谁"）。图只建一次，不复用 fileImpact（它会再建一遍）。
          const graph = await buildImpact({ workspace: ctx.workspace, cacheDir: dir, maxFiles });
          const rel = fileArg.replace(/\\/g, "/");
          if (!graph.files.includes(rel)) return { ok: false, output: await notInGraphNote(ctx.workspace, rel, abs, maxFiles) };
          const depHead = "[impact] " + rel + " 引用的外部定义（我在调用谁）" + coverageNote(graph.files.length, maxFiles);
          return { ok: true, output: sitesNote(depHead, downward(graph, rel), DEP_NOUN) };
        }
        const r = await fileImpact(ctx.workspace, fileArg, dir, maxFiles);
        if (r === null) return { ok: false, output: await notInGraphNote(ctx.workspace, fileArg.replace(/\\/g, "/"), abs, maxFiles) };
        // 只列**真的被外面引用到**的符号：fileImpact 的 symbols 含函数内局部名（base/boosted…），
        // 照抄会让一屏摘要塞满无关名字——多花 token 还不给可执行信息。
        const refSyms = [...new Set(r.up.map((s) => s.symbol))].sort();
        const head = "[impact] " + r.file + (refSyms.length > 0
          ? "（被跨文件引用的符号 " + String(refSyms.length) + " 个：" + refSyms.slice(0, SYMS_CAP).join(", ")
            + (refSyms.length > SYMS_CAP ? " 等" : "") + "）"
          : "") + coverageNote(r.graphFiles, maxFiles);
        return { ok: true, output: sitesNote(head, r.up) };
      }
      const graph = await buildImpact({ workspace: ctx.workspace, cacheDir: dir, maxFiles });
      const defined = graph.defs.get(symbol) ?? [];
      const refSites = graph.refs.get(symbol) ?? [];
      if (defined.length === 0 && refSites.length === 0) {
        return { ok: false, output: `impact_query: 图里没有符号 ${JSON.stringify(symbol)}（改名、未被引用、或不在已扫描的后缀内）` };
      }
      if (defined.length === 0) {
        // 「谁调用它」要有个前提：**它得定义在这张图里**。没有定义时 `upward` 会把全部同名
        // 引用点原样吐出来（它就是这么定义的），于是 `describe` 这类外部/全局符号会得到
        // 「波及 179 个文件」——那是把「谁提到这个名字」冒充「改它会波及谁」，
        // 比回答不了更坏。缺席 ≠ 波及 0，同理「图内没有定义」也 ≠ 有一张影响面。
        const files = new Set(refSites.map((r) => r.file));
        return {
          ok: true,
          output: `[impact] ${symbol}：这张图里没有任何文件**定义**它 ⇒ 它是外部或全局符号` +
            `（定义在 node_modules、由环境注入，或定义它的那个文件被 ${String(maxFiles)} 帽/忽略规则挡在图外——` +
            `图内没有 ≠ 仓库里没有）。引用它的文件 ${String(files.size)} 个，但「改它会波及谁」这一问在此不适用；` +
            `要动它的行为请改调用处或直读它的来源`,
        };
      }
      const symHead = `[impact] ${symbol} 的定义在 ${String(new Set(defined.map((d) => d.file)).size)} 个文件` +
        coverageNote(graph.files.length, maxFiles);
      return { ok: true, output: sitesNote(symHead, upward(graph, symbol)) };
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
      deps: { type: "boolean", description: "配合 file：改列本文件引用的外部定义（我在调用谁）" },
      // 刻意只写这一句：规格是**每轮重送**的固定成本（帽 <600B 有测钉着），长解释留在
      // 真用到它的那条报错文案里（graphAbsenceNote 会报出实发的帽与出路）。
      maxFiles: { type: "number", description: `帽外时调大（缺省 ${String(MAX_FILES_DEFAULT)}）` },
    },
  },
} as const;
