// 类型胶水：history-window.js 是手写 vanilla JS、不在 tsc 的 allowJs 面上，
// TS 侧（测试与验收脚本）此前只能按文本读它。这里只补声明、不改实现——
// 需要它的**行为**（例如「哪些事件类型会被分成卡片」只能问 projectUnits，不能猜文本）
// 时，有一份声明比复制一遍分组规则强：复制那份迟早与实现漂。
// 与同目录 window.d.ts 同一个用途。签名与实现不一致时这里编不过，是 fail-visible 而非静默。
import type { AgentEvent } from "../events";

/** 展示单元：user（一条用户消息）/ turn（模型正文 + 其后工具与验证）/ card（其余单事件）。 */
export interface HistoryUnit {
  key: string;
  kind: "user" | "turn" | "card";
  /** 该单元覆盖的事件下标。 */
  ids: number[];
}

export function projectUnits(events: readonly AgentEvent[]): HistoryUnit[];

export function windowRange(
  offsets: readonly number[],
  top: number,
  height: number,
  overscan?: number,
  max?: number,
): { start: number; end: number };

export function mountHistory(args: {
  container: HTMLElement;
  scroller: HTMLElement;
  units: readonly HistoryUnit[];
  renderUnit: (unit: HistoryUnit) => Element;
}): { refresh(): void; dispose(): void };
