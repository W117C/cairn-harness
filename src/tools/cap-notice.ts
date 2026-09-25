// 数量型上限（条/个）的截断提示——与 `base.ts::truncationNotice`（字节型上限）分成两支。
//
// 为什么必须分：`truncationNotice(n)` 里的 n 是 **KB**，而 grep 的帽是「前 100 条命中」、
// glob 的帽是「前 100 个文件」。直接复用就会对模型说「输出超过 100KB 上限」——
// 而实测那次的输出只有几 KB。量纲说错不是措辞问题：模型看到"字节超了"会按"再读一段就有"决策
// （翻页 / read_file），可真实情况是**条数帽**，唯一出路是收窄查询——这正是本仓反复点名的
// 「文案把模型指去做不到的动作」。同族先例：`middleTruncationNotice` 为"掐中间"单开一支，
// 理由逐字相同（两种语义混一个名字，读提示的人只能猜）。
//
// #51：`src/tools/base.ts` 不在飞时把这支搬去与 `truncationNotice` / `middleTruncationNotice` 并排
// ——同族两支不该长期分居两处。
/**
 * @param noun 计数单位（"条命中" / "个文件"），进文案以便与字节帽区分。
 * @param limit 帽值（列出了多少的上限）。
 * @param omitted 因帽而未列出的数量——**必须报出来**：只说"被截断了"的模型会以为已经看全，
 *                或原样重跑同一条宽查询（`grep` 预算分支同一条纪律）。
 */
export function countCapNotice(noun: string, limit: number, omitted: number): string {
  return `[truncated: 上限是 ${String(limit)} ${noun}（条数帽，不是字节数），还有 ${String(omitted)} ${noun} 未列出——收窄 pattern/path 再查]`;
}

/**
 * 字节型上限（`read_file` 50KB / `lsp` 32KB）的截断提示。
 *
 * 与 `base.ts::truncationNotice` 的差别只有一件事，但那件事是给模型做决策用的：
 * 那句原文只说"超上限、已截断"，**不说少了多少**⇒ 模型无从判断自己是看全了还是漏了一大段，
 * 常见后果是原样重跑同一条宽查询（第 66 页 `countCapNotice` 立的就是同一条纪律）。
 *
 * `nextStep` 由调用方给，不在这里写死：同一句"下一步"在不同消费者身上成立与否不一样
 * （`read_file` 能 `offset/limit` 分批读，`lsp` 没有分页——第 66 页那句 glob 的"把 path 显式指进去"
 * 对它自制的 `--glob` 就是一次假承诺）。
 */
export function byteCapNotice(limitKB: number, omittedBytes: number, nextStep: string): string {
  return `[truncated: 输出超过 ${String(limitKB)}KB 上限，已截断（还有 ${String(omittedBytes)} 字节未显示；${nextStep}）]`;
}
