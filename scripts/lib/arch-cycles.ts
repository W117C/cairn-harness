// 架构环判据的纯函数面（任务 A6／第 338 页）：**只算运行期 import 边**的强连通分量，并把「圈」分成三态。
//
// 为什么单独立这一支（不是"好看"，是有具体的失效形状要堵）：
//  · 全仓此前**没有任何** intra-src 无环判据（2026-10-03 技术审查 A6 现读：只算运行期 import 时圈数＝1；
//    把 `import type` 一起算会多出 4 个**假圈**）。今天不炸是因为跨圈符号都在函数体内被使用；
//    哪天有人在模块顶层用被圈住的那个符号，就是 ESM TDZ 运行时错——而 TDZ 只在跑到那一行时才炸，
//    判卷如果恰好没跑到那条路径，它会安静地躺在 HEAD 里。所以这一格要的是**结构闸**，不是行为证人。
//  · 三态而不是"有环就红"：现存那一圈是已登记的债（带页号出处）。**新圈要红，债被还掉也要红**
//    （登记表自己烂掉＝假存量，规则 209/235 那一族）——两态都由 classifyCycles 出声，不由人数。
//
// 取料纪律：边由调用方喂（脚本用 `fileSymbols().imports` ＋地图自己的 `resolveModuleSpecifier`），
// 这里不读盘、不起进程。为什么不复用 `buildGraph` 的邻接表：那张 `adj` 把**精确 import 边**与
// **同名全连兜底边**混在一起（rank.ts ⑴ 支：解析不到或对面没同名 def 就留给同名全连），
// 后者对"谁依赖谁"是假边——用它数圈会把同名不同实体当成互相依赖。
export interface CycleFinding {
  rule: "arch-cycle";
  detail: string;
}

/** 已登记的债：一条圈＝一组文件（无序，判据内部按字典序规范化后再比）。 */
export type CycleDebt = readonly string[];

/** 把一条边表收成「文件 → 它 import 的文件集合」。自环（自己 import 自己）结构性丢弃。 */
export function adjacencyOf(edges: readonly (readonly [string, string])[]): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const [from, to] of edges) {
    if (from === to) continue;
    if (!adj.has(from)) adj.set(from, new Set());
    adj.get(from)!.add(to);
  }
  return adj;
}

/** Tarjan 强连通分量，**迭代版**（不递归：本仓候选面 600＋，递归深度不是可以赌的东西）。
 *  返回的每个分量内部按字典序规范化，分量之间按「最小成员」排序 ⇒ 同一张图两次跑读数逐字相同。
 *  单节点不成圈（size===1 的直接排除；自环在 adjacencyOf 里已丢）。 */
export function stronglyConnectedComponents(
  nodes: readonly string[],
  adj: ReadonlyMap<string, Set<string>>,
): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const out: string[][] = [];
  let counter = 0;

  const sorted = [...new Set(nodes)].sort();
  for (const root of sorted) {
    if (index.has(root)) continue;
    // 每条帧代表一次"正在展开的递归调用"：it = 下一个要处理的邻居游标。
    const frames: { v: string; it: string[] }[] = [{ v: root, it: [...(adj.get(root) ?? [])].sort() }];
    index.set(root, counter); low.set(root, counter); counter++; stack.push(root); onStack.add(root);
    while (frames.length > 0) {
      const frame = frames[frames.length - 1]!;
      const next = frame.it.shift();
      if (next === undefined) {
        if ((low.get(frame.v) ?? 0) === (index.get(frame.v) ?? 0)) {
          const comp: string[] = [];
          let popped: string | undefined;
          do {
            popped = stack.pop();
            if (popped !== undefined) {
              onStack.delete(popped);
              comp.push(popped);
            }
            if (popped === frame.v) break;
          } while (popped !== undefined);
          if (comp.length >= 2) out.push(comp.sort());
        }
        frames.pop();
        // 子帧展开完了，把它的 low 交回父帧——迭代版 Tarjan 最容易漏的一步：
        // 漏了会把「后向边」读成「跨子树边」，于是**该合成的圈合成不出来**（症状是漏报，不是误报）。
        const parent = frames[frames.length - 1];
        if (parent) {
          const childLow = low.get(frame.v) ?? Number.POSITIVE_INFINITY;
          low.set(parent.v, Math.min(low.get(parent.v) ?? Number.POSITIVE_INFINITY, childLow));
        }
        continue;
      }
      if (!index.has(next)) {
        index.set(next, counter); low.set(next, counter); counter++;
        stack.push(next); onStack.add(next);
        frames.push({ v: next, it: [...(adj.get(next) ?? [])].sort() });
      } else if (onStack.has(next)) {
        low.set(frame.v, Math.min(low.get(frame.v) ?? Number.POSITIVE_INFINITY, index.get(next) ?? Number.POSITIVE_INFINITY));
      }
    }
  }
  return out.sort((a, b) => a[0].localeCompare(b[0]));
}

export interface CycleVerdict {
  /** 与登记表对上的圈（债，允许存在，但要印出来）。 */
  allowed: string[][];
  /** 盘上有、登记表里没有 ⇒ 红。 */
  fresh: string[][];
  /** 登记了但盘上已经不是圈 ⇒ 也红（登记表不许空转／假存量）。 */
  stale: string[];
  /** 分母自证：三态各自的条数相加是否等于「圈总数＋登记条数」里该有的形状。 */
  total: number;
  debt: number;
}

const norm = (c: readonly string[]): string => [...c].sort().join(" → ");

/** 成员串的拼法＝唯一事实源。判卷要断这句就调它，别把整句抄进断言里：
 *  抄进断言的那一刻起，改这串的渲染要动两处，而 prose-needle-scan 会把这一格报成顶包候选。 */
export const cycleMembersLabel = (c: readonly string[]): string => c.join(" → ");

/** 把「盘上数到的圈」与「已登记的债」对账。三态分开印，且**两向都要有牙**：
 *  新圈要出声（抓"有人加了环"），登记的那条没了也要出声（抓"登记表自己烂掉"）。 */
export function classifyCycles(found: readonly string[][], debt: readonly CycleDebt[]): CycleVerdict {
  const foundKeys = new Map(found.map((c) => [norm(c), c]));
  const debtKeys = new Set(debt.map(norm));
  const allowed: string[][] = [];
  const fresh: string[][] = [];
  for (const [k, c] of [...foundKeys.entries()].sort()) {
    (debtKeys.has(k) ? allowed : fresh).push(c);
  }
  const stale = debt.map(norm).filter((k) => !foundKeys.has(k));
  return { allowed, fresh, stale, total: found.length, debt: debt.length };
}

/** 汇总面：一条人读的出声行，三态相加＝分母（少一格就是量法坏了，规则 248/261 那一族）。 */
export function cycleSummary(v: CycleVerdict): string {
  return `环对账：圈 ${String(v.total)} 条 —— 登记债 ${String(v.allowed.length)}，新圈 ${String(v.fresh.length)}，`
    + `登记已失效 ${String(v.stale.length)}｜登记面 ${String(v.debt)} 条`;
}

/** 把三态收成判据条目（空数组＝这一格绿）。 */
export function cycleFindings(v: CycleVerdict): CycleFinding[] {
  const out: CycleFinding[] = [];
  for (const c of v.fresh) {
    out.push({ rule: "arch-cycle", detail: `新增运行期 import 环（未登记）：${cycleMembersLabel(c)} ⇒ 顶层使用圈内符号会撞 ESM TDZ；要么断圈，要么带页号出处登记成债` });
  }
  for (const s of v.stale) {
    out.push({ rule: "arch-cycle", detail: `登记的环已不在盘上（${s}）⇒ 该从名单删掉，登记不删就是假存量` });
  }
  return out;
}
