/** 模型可见文本 ↔ 工具面 的可达性（纯函数层：不 import 提示词、不碰盘、不起进程）。
 *
 * 存在的理由（任务 #13）：`BASE_SYSTEM` 是**一份文本对四档**（`agent-runner.ts` 只有一个消费点），
 * 而四档的装配面差得很远——现读 read-only 只有 8 把、其余三档 20 把。于是提示词里写「改已有文件用
 * `edit_file`」「派完先调 `wait_for_agents` 收队」这些句子时，read-only 会话里的模型根本拿不到那两把工具：
 * 它要么白调一次被权限层拒，要么照着说明去理解一个不存在的能力。同类事故已命中多次
 * （`glob` 那句「把 path 显式指进去」对它自制的 `--glob` 排除讲不通 / `maxFiles` 死参数 /
 *  prune 附件说 `read_file` 够不到 / verify 指向 `.agent/` 禁写面）——都是「文本承诺了一格，面上没有」。
 *
 * 两类发现分开，因为修法不同：
 *  - **dead**：名字在所有档的面上都不存在 ⇒ 文本在指一个不存在的能力（改名、写错、删了工具没删文案）。
 *  - **odd**：名字在某些档存在、某些档不存在，而文本是全档共用的 ⇒ 对缺席那一档是不可达承诺。
 */
export type PromptSurfaceFinding = {
  token: string;
  face: string;
  /** 缺席的档；dead 类为全部档。 */
  modes: string[];
  kind: "dead" | "odd";
};

/** 散文里「像工具名」的写法：
 *  ⑴ 蛇形（`edit_file`）——形状判，不需词表；
 *  ⑵ 已知工具名单里的裸名（`verify`、`clarify` 这类单词名）。
 *  只按形状判会漏掉单词名（现读 `BASE_SYSTEM` 的 4 个蛇形 token 之外还点了 `verify`/`clarify`），
 *  只按名单判会漏掉「名单里已经不存在的那个名字」——那正是 dead 类，所以两路都要。 */
export function toolNameTokens(prose: string, knownNames: readonly string[]): string[] {
  const out = new Set<string>();
  for (const t of prose.match(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/gu) ?? []) out.add(t);
  for (const n of knownNames) {
    if (n === "") continue;
    if (new RegExp(`(^|[^A-Za-z0-9_])${n}([^A-Za-z0-9_]|$)`, "u").test(prose)) out.add(n);
  }
  return [...out].sort();
}

/** 豁免只能由**命中方**清空：每条要写明为什么这一格可以留着（与 `gate-manifest` 的 EXEMPT 同一纪律）。
 *  键是 `token@mode`，因为同一把工具可以在某些档合理缺席。 */
export type PromptSurfaceExempt = readonly { token: string; mode: string; why: string }[];

export function promptSurfaceFindings(
  faces: readonly { name: string; text: string; modes?: readonly string[] }[],
  tablesByMode: Record<string, readonly string[]>,
  knownNames: readonly string[],
  exempt: PromptSurfaceExempt = [],
): PromptSurfaceFinding[] {
  const allModes = Object.keys(tablesByMode).sort();
  if (allModes.length === 0) throw new Error("工具面一格都没取到 ⇒ 不能把「没读到」读成「没有可达性问题」");
  const unionAll = new Set<string>(allModes.flatMap((m) => tablesByMode[m] ?? []));
  if (unionAll.size === 0) throw new Error("所有档的工具面都是空的 ⇒ 取料坏了，这一格不能印 0");
  const waived = new Set(exempt.map((e) => `${e.token}@${e.mode}`));
  const out: PromptSurfaceFinding[] = [];
  for (const face of faces) {
    // 一份文本可以只发给部分档（`systemPromptFor` 拆完之后就是这形状）。覆盖哪些档由**调用方从装配处取**，
    // 不在这里写死四档：写死了就等于假设「永远是一份文本对四档」，那正是这一格从前的错误前提。
    const scope = face.modes && face.modes.length > 0 ? [...face.modes].sort() : allModes;
    if (scope.some((m) => !(m in tablesByMode))) {
      throw new Error(`文本面 ${face.name} 声明了不存在的档 ⇒ 取料坏了（覆盖档必须来自工具面那张表）`);
    }
    for (const token of toolNameTokens(face.text, knownNames)) {
      // dead＝名字在**全局**任何档都没有 ⇒ 文本指着不存在的能力（改名／删文案），一条发现点名所有档。
      if (!unionAll.has(token)) {
        if (!waived.has(`${token}@*`)) out.push({ token, face: face.name, modes: allModes, kind: "dead" });
        continue;
      }
      // odd＝能力在别档有、在这份文本覆盖的这几档没有 ⇒ 改这一档的文本（与 dead 修法相反，故分两类）。
      const missingIn = scope.filter((m) => !(tablesByMode[m] ?? []).includes(token));
      for (const m of missingIn) {
        if (waived.has(`${token}@${m}`)) continue;
        out.push({ token, face: face.name, modes: [m], kind: "odd" });
      }
    }
  }
  return out;
}

/** 过期豁免：表里登了、这一轮却不再命中的那些。留着它就会**放过同名的新问题**——
 *  所以豁免只能由命中方清空（与 `gate-manifest` 的 EXEMPT 同一纪律，规则 238）。 */
export function unhitExemptions(
  exempt: PromptSurfaceExempt,
  rawFindings: readonly PromptSurfaceFinding[],
): PromptSurfaceExempt {
  return exempt.filter((e) => !rawFindings.some((f) => f.token === e.token && f.modes.includes(e.mode)));
}

/** 按档改共用文本的**唯一**做法：只换/删指定的那几行，其余行逐字沿用同一份源（规则 205：同一句话不许抄两份）。
 *  两处失败都当场抛，不留「看起来改了」的空档：
 *  ⑴ 某个落点一处没命中 ⇒ 那一行的开头字变了，这一档的差异会**静默消失**（模型继续读到别档的承诺）；
 *  ⑵ 某个落点命中多行 ⇒ 前缀写得太松，会把不该改的行一起换掉。
 *  返回 `changed`（删了几行、换了几行）是为了让调用方能把它当读数印出来，而不是只信"没抛"。 */
export function applyModeLineEdits(
  source: string,
  edits: { readonly replacements: readonly { prefix: string; text: string }[]; readonly drops: readonly string[] },
): { text: string; changed: { dropped: number; replaced: number } } {
  const lines = source.split("\n");
  const hitCount = (pred: (line: string) => boolean) => lines.filter((l) => pred(l)).length;
  const dropped = hitCount((l) => edits.drops.some((d) => l.startsWith(d)));
  const replaced = hitCount((l) => edits.replacements.some((r) => l.startsWith(r.prefix)));
  if (dropped !== edits.drops.length || replaced !== edits.replacements.length) {
    throw new Error(`按档改文本的落点没对上：该删 ${String(edits.drops.length)} 行实删 ${String(dropped)} 行` +
      `／该换 ${String(edits.replacements.length)} 行实换 ${String(replaced)} 行（0＝那一行的开头字变了，差异会静默消失）`);
  }
  const out: string[] = [];
  for (const line of lines) {
    if (edits.drops.some((d) => line.startsWith(d))) continue;
    const rep = edits.replacements.find((r) => line.startsWith(r.prefix));
    out.push(rep === undefined ? line : rep.text);
  }
  return { text: out.join("\n"), changed: { dropped, replaced } };
}

/** 读数行：门与判卷共用这一份措辞（规则 205：别在两边各拼一句）。 */
export function promptSurfaceCell(findings: readonly PromptSurfaceFinding[]): string {
  const dead = findings.filter((f) => f.kind === "dead");
  const odd = findings.filter((f) => f.kind === "odd");
  return `提示词可达性：dead ${String(dead.length)}（文本指着不存在的能力）／odd ${String(odd.length)}（共用文本对缺席那一档是不可达承诺）`;
}
