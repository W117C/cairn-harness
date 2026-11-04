// 过程带折叠（2026-11-02 业主截图）：一轮的最终答复落地后，**答复之前的一切**
// （思考记录 / 工具调用 / 过程旁白）收成一行；点开恢复原样。
//
// 缺陷本体（业主截图）：一轮里排着 5 条「思考记录」+ 4 簇「工具调用」，最后才是那句答复——
// 答复才是用户要读的东西，前面那 9 行把它埋了。每一行各自是折着的，但**行数还在**：
// 折了不等于少了。⇒ 这条折叠的单位是「一轮的过程带」，不是「一行」。
//
// 判据都在这里（纯投影，可判卷）：
//   · 最终答复 = 那一轮里**最后一条已落定且有正文**的助手行（live 行不算——它还在写）；
//   · 过程带 = 最终答复之前、用户消息之后的那几行；
//   · 收成一行只在**这一轮已经收束**时发生（后面没有新一轮，或本会话已停转）——
//     否则模型还在写，过程正在发生，不该被藏。
import type { StreamRow } from "./stream";

/** 过程带摘要（折叠行上给用户看的那几个数）。 */
export interface ProcessSummary {
  /** 工具调用次数。 */
  tools: number;
  /** 其中失败的次数。 */
  failures: number;
  /** 思考段数（有思考正文的助手行数）。 */
  thinks: number;
}

/** 这一轮的最终答复行下标；没有 ⇒ -1（没有答复就没有「答复之前」可折）。 */
export function finalAnswerIndex(rows: readonly StreamRow[]): number {
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]!;
    if (r.kind !== "assistant") continue;
    if (r.live === true) continue; // 还在流式写 ⇒ 不是终稿
    if (r.text.trim() === "") continue; // 空正文（只想过没说）不是答复
    return i;
  }
  return -1;
}

/** 过程带摘要：工具次数 / 失败次数 / 思考段数（不编数——只数行里有的东西）。 */
export function summarizeProcess(rows: readonly StreamRow[]): ProcessSummary {
  let tools = 0;
  let failures = 0;
  let thinks = 0;
  for (const r of rows) {
    if (r.kind === "tool") {
      tools += 1;
      if (r.ok === false) failures += 1;
      continue;
    }
    if (r.kind === "assistant" && r.thinking !== undefined && r.thinking !== "") thinks += 1;
  }
  return { tools, failures, thinks };
}
