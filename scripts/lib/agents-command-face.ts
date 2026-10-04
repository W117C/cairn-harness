/** AGENTS.md 的**命令面**对账：文档里写出来的每条命令，它指向的东西必须在这同一棵树里存在。
 *
 *  为什么单独一层：纯函数、不碰盘——取料（读 `AGENTS.md`、两份 `package.json`、路径是否存在）
 *  全部由调用方注入，这样判卷能拿合成输入把两态各钉一次（真机上这类尺最容易只测"对的那一态"）。
 *  动因不是抽象的"文档要新"：本仓在做一个 `m0 → cairn` 的改名（`bin/m0.mjs → bin/cairn.mjs` 未入库、
 *  `apps/desktop` 的包名与 AGENTS.md 的 `--filter` 同笔在改）。**只改一处的话今天没有任何一格会响**——
 *  这正是 2026-10-04 一天里第 344/353 页反复撞的"一处裁决、多处落笔"形状。
 *
 *  两类别名要排除，且必须显式说明为什么排（否则"排除了什么"就成了一条静默盲区）：
 *  ⑴ **占位符**：含 `<`／`>`／`$` 的记法（`<repo>/.agent/sessions/`、`$HOME`）不是路径，判它存在等于判一句话；
 *  ⑵ **安装产物**：首段是 `node_modules` 的记法——它被 `.gitignore` 挡着，跟踪面里根本没有，
 *      判它就是把"没装依赖的干净树"读成文档缺陷（与第 354 页那条「留档没记命令」不同，那是不出声；这里是出声出错的）。 */

export interface AgentsFaceInput {
  /** `AGENTS.md` 全文。 */
  agentsMd: string;
  /** 根 `package.json` 的 scripts 键集合。 */
  rootScripts: readonly string[];
  /** `apps/desktop/package.json` 的 name（取不到传 null ⇒ 这一格按"说不清"处理，不许默默通过）。 */
  desktopPkgName: string | null;
  /** desktop 包的 scripts 键集合（取不到传空数组，同上按说不清处理）。 */
  desktopScripts: readonly string[];
  /** 这棵树里某个相对路径是否存在（文件或目录）。 */
  exists: (rel: string) => boolean;
}

export interface AgentsFaceFinding {
  kind: "filter-name" | "filter-script" | "root-script" | "path-missing" | "desktop-pkg-missing";
  detail: string;
}

const PLACEHOLDER = /[<>$]/u;

/** 文档里的命令多半包在反引号里，`\S+` 会把收尾的 ` 与句末标点一起吃进来（实测过：script 变成 "test`"）。 */
const trimToken = (s: string): string => s.replace(/[`'"),;:。，；]+$/gu, "");

/** `pnpm --filter <name> <script>`：一次出现给一对（名字，脚本）。 */
export function filterInvocations(md: string): Array<{ name: string; script: string }> {
  const out: Array<{ name: string; script: string }> = [];
  for (const m of md.matchAll(/pnpm\s+--filter\s+(\S+)\s+(\S+)/gu)) {
    const name = trimToken(m[1] ?? "");
    const script = trimToken(m[2] ?? "");
    if (PLACEHOLDER.test(name) || PLACEHOLDER.test(script)) continue;
    out.push({ name, script });
  }
  return out;
}

/** 裸 `pnpm <script>`（不带 --filter）；`pnpm -r`／`pnpm --filter` 这类带开关的不算。 */
export function rootScriptInvocations(md: string): string[] {
  const out = new Set<string>();
  for (const m of md.matchAll(/pnpm\s+(?!-)([A-Za-z][\w:-]*)/gu)) {
    const s = trimToken(m[1] ?? "");
    if (s === "add" || s === "install" || s === "i" || s === "run" || s === "exec" || s === "dlx") continue;
    out.add(s);
  }
  return [...out].sort();
}

/** 反引号里、像**仓内**路径的记法：含 `/`、无空白、无占位符、不以 `node_modules` 开头。
 *
 *  **2026-10-05 修正一处假阳性**：`~/.dsh`、`~/.zshrc` 这类家目录记法天然**不在本仓树里**，
 *  而旧实现只按「含 `/`」收 ⇒ 一律判 `path-missing`。这条判据要守的是「AGENTS.md 点名的
 *  **仓内**路径要真存在」（防止改名只改一处、文档指向不存在的脚本），家目录不在它的面上：
 *  要求 `~/.dsh` 在仓库里存在是把尺量错了对象——它会逼着人把家目录路径从文档里删掉，
 *  而那正是读者需要的信息。
 *  排除家目录记法**不会**掏空这条判据：真正的仓内漂移（`bin/m0.mjs` 改名后文档没跟上）
 *  仍然照收，判卷里有一条反向守卫钉着这件事。 */
export function mentionedPaths(md: string): string[] {
  const out = new Set<string>();
  for (const m of md.matchAll(/`([^`\s]+)`/gu)) {
    const tok = (m[1] ?? "").replace(/^\.\/+/u, "");
    if (!tok.includes("/") || PLACEHOLDER.test(tok)) continue;
    if (tok.startsWith("node_modules/")) continue;
    if (tok.startsWith("~/") || tok === "~") continue; // 家目录不是仓内路径（见上方注释）
    if (tok.includes("=") || tok.includes("--")) continue; // 参数形状不是路径
    out.add(tok.replace(/\/+$/u, "") === "" ? tok : tok.replace(/\/+$/u, ""));
  }
  return [...out].sort();
}

export function checkAgentsCommandFace(i: AgentsFaceInput): AgentsFaceFinding[] {
  const out: AgentsFaceFinding[] = [];
  const desktopKnown = i.desktopPkgName !== null && i.desktopPkgName !== "";
  if (!desktopKnown) {
    out.push({ kind: "desktop-pkg-missing", detail: "取不到 apps/desktop/package.json 的 name ⇒ 「filter 名是否等于包名」这一格未检，不许当通过" });
  }
  for (const f of filterInvocations(i.agentsMd)) {
    if (desktopKnown && f.name !== i.desktopPkgName) {
      out.push({ kind: "filter-name", detail: `AGENTS.md 写 --filter ${f.name}，而 apps/desktop 的包名是 ${String(i.desktopPkgName)} ⇒ 改名只改了一处` });
    }
    if (!i.desktopScripts.includes(f.script)) {
      out.push({ kind: "filter-script", detail: `AGENTS.md 让人跑 pnpm --filter ${f.name} ${f.script}，但 desktop 包的 scripts 里没有 ${f.script}` });
    }
  }
  for (const s of rootScriptInvocations(i.agentsMd)) {
    if (!i.rootScripts.includes(s)) {
      out.push({ kind: "root-script", detail: `AGENTS.md 写 pnpm ${s}，但根 package.json 的 scripts 里没有这一项` });
    }
  }
  for (const p of mentionedPaths(i.agentsMd)) {
    if (!i.exists(p)) out.push({ kind: "path-missing", detail: `AGENTS.md 点名的 ${p} 在这棵树里不存在` });
  }
  return out;
}
