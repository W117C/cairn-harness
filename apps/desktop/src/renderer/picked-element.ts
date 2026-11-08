// 浏览器元素选择的**载荷与短标签**（2026-11-03 业主）：
//   原来选中的元素被拼成「选择器：<整串> + HTML 片段：<整段>」塞进输入框——一条消息还没写，
//   输入区先被两段机器文本占满；用户删改其中一行又会让选择器/片段对不上。
//   现在输入区只放一枚可整枚移除的 chip（短标签），完整载荷留在状态里，发送时自动拼到消息前。
//
// 纯函数/纯类型，不 import React，也不碰 window：drafts（状态层）与 Composer（组件层）共用同一份。

export interface PickedElement {
  /** 页面内 CSS 选择器（完整串，用于发给模型定位）。 */
  selector: string;
  /** 选中元素的 HTML 片段（可能为空：某些选择器拿不到 outerHTML）。 */
  snippet: string;
  /** 元素所在页面 URL。 */
  url: string;
  /** 输入区 chip 上的短标签（如 `ellipse` / `ellipse#bodyShade` / `页面元素`）。 */
  label: string;
}

export interface PickedElementSignal extends PickedElement {
  /** 递增序号：连续选同一个元素也要再入一枚（与 injectedText 的 seq 同式）。 */
  seq: number;
}

/** 短标签：优先 `标签名#id`，其次标签名，最后退回「页面元素」。
 *  只从片段/选择器里读**结构**，不把整段选择器搬上 chip——那正是要收掉的东西。 */
export function pickedElementLabel(selector: string, snippet: string): string {
  const text = snippet.trim();
  const tag = /^<\s*([a-zA-Z][\w:-]*)/.exec(text)?.[1]?.toLowerCase() ?? null;
  const id = tag === null ? null : /\bid="([^"]+)"/.exec(text)?.[1] ?? null;
  if (tag !== null) return id === null ? `<${tag}>` : `<${tag}#${id}>`;
  const last = selector.split(">").pop()?.trim() ?? "";
  const name = /^([a-zA-Z][\w:-]*)/.exec(last)?.[1]?.toLowerCase() ?? null;
  return name === null ? "页面元素" : `<${name}>`;
}

/** 发送时拼到消息前的那一段（完整载荷只在这里出现，不占输入框）。 */
export function pickedElementContext(elements: readonly PickedElement[]): string {
  return elements.map((e) => {
    const lines = [`浏览器中选中的页面元素（${e.url}）：`, `选择器：${e.selector}`];
    if (e.snippet !== "") lines.push(`HTML 片段：${e.snippet}`);
    return lines.join("\n");
  }).join("\n\n");
}
