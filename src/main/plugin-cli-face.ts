// `cairn --plugins` / `--trust-plugin` / `--decline-plugin` 的核（#7 那一半：CLI 交付面上的信任决议入口）。
//
// 判据本体全是纯函数（不碰盘、不起进程）；取料（扫面、读表、写决议）在 `src/cli.ts` 那一层做，
// 于是判卷能直接喂数据问「这一格有没有出声」，而不必真扫一次工作区。
//
// 三条硬约束（都在实现里，判卷逐格钉）：
//  ⑴ 列出的根**就是**这一次扫描用的那份（`roots` 由 `discoverPlugins` 用它自己那批变量填），
//     这里绝不重拼路径——「扫了哪些根」与「扫到了什么」分两处算迟早漂。
//  ⑵ 决议只经 `PluginRuntime.trustDecide` 那一个出口（桌面面板点批准走的是同一个方法），
//     本文件不 import `TrustStore`：给同一份表开第二个写点就是开第二条口径。
//  ⑶ 待信任条数由调用方用现成谓词（`pendingPlugins`）算好递进来，这里不数第二遍。
import { readFile } from "node:fs/promises";
import { parseTrustFile } from "../agent/plugins/trust";
import type { PluginScanRoots, PluginsManifest } from "../agent/plugins/types";
import { trustCountsText } from "./doctor";

/** CLI 那三条旗标对应的请求形状（`src/cli.ts` 解析 argv 产它，本模块只消费）。 */
export type PluginCliRequest = { mode: "list" } | { mode: "decide"; name: string; trusted: boolean };

export interface PluginFaceRow {
  /** 「插件」＝带 manifest 的容器；「散装 skill」＝一支 SKILL.md。两类样本共用同一道信任门。 */
  kind: string;
  name: string;
  scope: string;
  trust: string;
  root: string;
}

/** 清单面 → 行（插件与散装 skill 合成一张表，顺序＝发现顺序，不重排）。 */
export function pluginFaceRows(manifest: PluginsManifest): PluginFaceRow[] {
  return [
    ...manifest.plugins.map((p) => ({ kind: "插件", name: p.name, scope: p.scope, trust: p.trust, root: p.root })),
    ...manifest.looseSkills.map((l) => ({ kind: "散装 skill", name: l.name, scope: l.scope, trust: l.trust, root: l.root })),
  ];
}

/** 信任表那一份文件的三态：没有表（正常，一条决议都还没写过）／读得出／读不出。
 *  「读不出」不许折成「0 条」——那等于让机器上的毛病冒充干净（同 `--doctor` 的 trust 那一格）。 */
export type TrustCountsFace =
  | { state: "absent" }
  | { state: "ok"; trusted: number; declined: number }
  | { state: "unreadable" };

export async function readTrustCountsFile(filePath: string): Promise<TrustCountsFace> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // 表本身不在（ENOENT／ENOTDIR）＝一条决议都没写过；其余（权限、坏软链）＝读不出。两态分开。
    if (code === "ENOENT" || code === "ENOTDIR") return { state: "absent" };
    return { state: "unreadable" };
  }
  const parsed = parseTrustFile(raw);
  if (parsed === null) return { state: "unreadable" };
  return { state: "ok", trusted: parsed.trusted.length, declined: parsed.declined.length };
}

export interface PluginFaceContext {
  workspace: string;
  /** 扫描根：`null` ＝这份清单没带 `roots` 那一格（旧快照／手写夹具），必须明写「未记录」。 */
  roots: PluginScanRoots | null;
  rows: PluginFaceRow[];
  /** 待信任条数：调用方用 `pendingPlugins(manifest).length` 算好递进来。 */
  pending: number;
  trustFile: string;
  trust: TrustCountsFace;
}

const ROOT_LABELS: [keyof Omit<PluginScanRoots, "looseRoots">, string][] = [
  ["userPluginsDir", "用户级插件"],
  ["projectPluginsDir", "项目插件"],
  ["projectSkillsDir", "项目 skill"],
];

/** 列表那一拍的全部文字。 */
export function pluginFaceText(ctx: PluginFaceContext): string {
  const lines: string[] = ["插件与 skill 发现面（工作区 " + ctx.workspace + "）"];
  if (ctx.roots === null) {
    lines.push("  扫描根：未记录（这份清单不带 roots 那一格 ⇒ 这里不猜扫过哪几顶）");
  } else {
    lines.push("  扫描根：");
    for (const [key, label] of ROOT_LABELS) {
      const v = ctx.roots[key];
      lines.push("    " + label + "：" + (v === null ? "没给这一顶（没扫）" : v));
    }
    lines.push("    免信任散装：" + (ctx.roots.looseRoots.length === 0 ? "没给这一顶（没扫）" : ctx.roots.looseRoots.join("、")));
  }
  if (ctx.rows.length === 0) {
    lines.push("  发现面为空：给到的根里没有一支含 .claude-plugin 或 SKILL.md 的子目录");
  } else {
    lines.push("  名称｜种类｜作用域｜状态｜根");
    for (const r of ctx.rows) {
      lines.push("  " + r.name + "｜" + r.kind + "｜" + r.scope + "｜" + r.trust + "｜" + r.root);
    }
  }
  lines.push("  待信任 " + String(ctx.pending) + " 条：这一档只列出、不激活（钩子／MCP／skill 路由都不生效）");
  lines.push(
    ctx.trust.state === "ok"
      ? "  " + trustCountsText(ctx.trust.trusted, ctx.trust.declined) + "，表在 " + ctx.trustFile
      : ctx.trust.state === "absent"
        ? "  信任表还没写过（" + ctx.trustFile + "）"
        : "  信任表取不到条数：" + ctx.trustFile + "（读不出与「一条决议也没有」是两回事，这里不给数）",
  );
  lines.push("  批准：cairn --trust-plugin <名称>　拒绝：cairn --decline-plugin <名称>");
  lines.push("  决议按「绝对路径@内容指纹」记账：改过插件内容就得重新批一次。");
  return lines.join("\n") + "\n";
}

/** 决议那一拍的措辞。**失败必须写成「一条决议也没写下」**：批准没落地却报「已批准」，
 *  下一次装载仍然出卡，而人以为自己批过了——那是最难查的那种不一致。 */
export function pluginDecideText(name: string, trusted: boolean, ok: boolean, rows: readonly PluginFaceRow[]): string {
  if (!ok) {
    const names = rows.map((r) => r.name + "（" + r.scope + "、" + r.trust + "）").join("、");
    return (
      "[plugins] 「" + name + "」不在这次发现面里 ⇒ 一条决议也没写下。"
      + "名字要照这份抄：" + (rows.length === 0 ? "（发现面为空，先跑 --plugins 看扫了哪几顶根）" : names)
      + "\n"
    );
  }
  return "[plugins] 已" + (trusted ? "批准" : "拒绝") + "「" + name + "」，下一次装载起生效；内容改了会重新出这一条。\n";
}
