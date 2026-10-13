// 剧本「轮」的装配期哨兵（`round_end`）——**一份实现，两个消费者**。
//
// 消费者：`providers/mock.ts`（演示通道与生产入口的剧本）与 `agent/gym/script.ts`
// （靶场与 `loop-eval --scripted=` 的剧本）。两边都要能表达「这一轮到这儿结束、会话还没完」，
// 否则长在轮界上的机制（收束闸补拍、拍红后再要一轮去修、逐轮上下文增长/压缩）在
// **只有一次请求**的通道上结构不可达——不是量得准不准，是根本没有样本。
// 2026-10-13（第 470 页）之前这份切轮实现只住在 mock 侧，靶场侧按 tool_call 切轮
// ⇒「跑过 shell 之后模型收工」那一拍在 `--scripted=` 面上写不出来，而它正是
// `autoVerifyRepair` 唯一的对象。抽到本模块是为了两处**逐字同一份**切轮口径，而不是抄第二份。
//
// 两条口径要分清（它们服务不同的剧本纪律，不是可以随手统一的两个写法）：
//  · **带哨兵**的剧本：一轮 = 到下一个哨兵为止（哨兵吃掉、不吐给 loop）；没有哨兵就取到末尾。
//    真 provider 一轮可以发好几个 tool_call（会话沉淀就是「一轮里 N 条 remember ⇒ 合并成一次审批」）
//    ⇒ 边界只由哨兵决定，不按 tool_call 切。
//  · **不带哨兵**的剧本：靶场 `takeRound` 沿用旧口径（到第一个 tool_call 为止）——那是靶场
//    自己的记账纪律；mock 对无哨兵剧本是「整条一次给完」。两种旧行为都逐字不变。
import type { ModelOutput } from "./index.js";

/** 装配期哨兵：剧本用它说「这一轮到这儿结束，但会话还没完」。
 *  它**不是模型输出**：切轮时吃掉、绝不吐给 loop（吐出去就是一条假事件，会落 JSONL 与所有投影面）。
 *  剧本纪律：哨兵跟在它要收的那一条输出**之后**。 */
export const ROUND_END = "round_end";
export type RoundMarker = { readonly type: typeof ROUND_END };
export type ScriptItem = ModelOutput | RoundMarker;
export const isRoundEnd = (item: ScriptItem): item is RoundMarker => item.type === ROUND_END;

/** 纯函数：从 cursor 起取一轮 = 到下一个哨兵为止（吃掉哨兵，不含它）；没有哨兵就取到剧本末尾。 */
export function takeMarkedRound(
  script: readonly ScriptItem[],
  cursor: number,
): { outputs: ModelOutput[]; next: number } {
  const outputs: ModelOutput[] = [];
  let i = cursor;
  for (; i < script.length; i++) {
    const item = script[i]!;
    if (isRoundEnd(item)) {
      i += 1; // 哨兵吃掉：本轮到此结束
      break;
    }
    outputs.push(item);
  }
  return { outputs, next: i };
}
