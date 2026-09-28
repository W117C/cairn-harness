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
  faces: readonly { name: string; text: string }[],
  tablesByMode: Record<string, readonly string[]>,
  knownNames: readonly string[],
  exempt: PromptSurfaceExempt = [],
): PromptSurfaceFinding[] {
  const modes = Object.keys(tablesByMode).sort();
  if (modes.length === 0) throw new Error("工具面一格都没取到 ⇒ 不能把「没读到」读成「没有可达性问题」");
  const union = new Set<string>(modes.flatMap((m) => tablesByMode[m] ?? []));
  if (union.size === 0) throw new Error("所有档的工具面都是空的 ⇒ 取料坏了，这一格不能印 0");
  const waived = new Set(exempt.map((e) => `${e.token}@${e.mode}`));
  const out: PromptSurfaceFinding[] = [];
  for (const face of faces) {
    for (const token of toolNameTokens(face.text, knownNames)) {
      if (!union.has(token)) {
        if (!waived.has(`${token}@*`)) out.push({ token, face: face.name, modes, kind: "dead" });
        continue;
      }
      const missing = modes.filter((m) => !(tablesByMode[m] ?? []).includes(token));
      for (const m of missing) {
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

/** 读数行：门与判卷共用这一份措辞（规则 205：别在两边各拼一句）。 */
export function promptSurfaceCell(findings: readonly PromptSurfaceFinding[]): string {
  const dead = findings.filter((f) => f.kind === "dead");
  const odd = findings.filter((f) => f.kind === "odd");
  return `提示词可达性：dead ${String(dead.length)}（文本指着不存在的能力）／odd ${String(odd.length)}（共用文本对缺席那一档是不可达承诺）`;
}
