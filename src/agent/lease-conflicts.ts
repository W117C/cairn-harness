/** 写租约 glob 相交判定（纯函数）：支持 ** / * / ?；无通配符 = 前缀目录语义（"src" 匹配 "src/**"）。
 *  双向匹配：任一方向命中即相交（A 声明 src/**，B 声明 src/todo.ts → 相交）。 */
/** B1 语义合并闸的判定内核（纯异步、可单测：不必真起 worker / git worktree）。
 *  hook 把「声明的 glob 集」映射成「实际波及的文件集」（agent-runner 用 impact 层接）。
 *  四条边界都是判据的一部分：
 *   ① 未接钩子 / 无声明 ⇒ []（零行为，既有 spawn 流程与事件字节不变）；
 *   ② 波及集为空 ⇒ 不报（宁漏不误伤：无跨文件调用点就不该拦并行）；
 *   ③ 钩子抛错 ⇒ []，并 **出声**（额外探测器不得炸掉 spawn，但静默降级等于把故障藏起来）；
 *   ④ 每个冲突最多列 6 个文件（审批卡是给人看的，全量清单在 impact_report 事件里）。 */
export async function semanticConflictsVia(
  hook: ((globs: string[]) => Promise<string[]>) | undefined,
  resources: readonly string[],
  workers: readonly { agentId: string; resources: readonly string[] }[],
): Promise<{ agentId: string; resource: string }[]> {
  if (!hook || resources.length === 0 || workers.length === 0) return [];
  const closure = async (globs: readonly string[]): Promise<Set<string> | null> => {
    try {
      return new Set(await hook([...globs]));
    } catch (err) {
      console.warn("[impact] 语义波及计算失败，本轮只按 glob 租约判定:", err instanceof Error ? err.message : String(err));
      return null;
    }
  };
  const mine = await closure(resources);
  if (!mine || mine.size === 0) return [];
  const out: { agentId: string; resource: string }[] = [];
  for (const w of workers) {
    const theirs = await closure(w.resources);
    if (!theirs || theirs.size === 0) continue;
    const shared = [...mine].filter((f) => theirs.has(f)).slice(0, 6);
    if (shared.length > 0) out.push({ agentId: w.agentId, resource: "波及 " + shared.join("、") });
  }
  return out;
}

export function globIntersects(a: string, b: string): boolean {
  if (a === b) return true;
  const ma = matchesGlob(a, b);
  const mb = matchesGlob(b, a);
  return ma || mb;
}

function matchesGlob(pattern: string, target: string): boolean {
  const re = globToRegExp(pattern);
  if (re.test(target)) return true;
  // 目录前缀语义：pattern 无通配符时按目录前缀匹配（src ↔ src/todo.ts）
  if (!/[*?]/.test(pattern)) {
    return target.startsWith(pattern.endsWith("/") ? pattern : pattern + "/");
  }
  return false;
}

function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
        if (glob[i + 1] === "/") i++; // ** 吞掉随后的 /
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if ("\\^$.|+()[]{}".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp("^" + re + "$");
}
