// /goal 命令解析（2026-10-18）：斜杠说明一直写着“轮次/美元上限”，但此前只认目标原文。
// 语法：/goal [--turns N] [--usd X] <目标…>；参数只认正整数 / 非负小数，其它原样留在目标里。
export interface GoalCommand {
  objective: string;
  maxTurns?: number;
  maxUsd?: number;
}

export function parseGoalCommand(text: string): GoalCommand | null {
  if (!text.startsWith("/goal ")) return null;
  let rest = text.slice("/goal ".length).trim();
  let maxTurns: number | undefined;
  let maxUsd: number | undefined;
  const take = (re: RegExp): string | null => {
    const m = rest.match(re);
    if (m === null || m.index === undefined) return null;
    rest = `${rest.slice(0, m.index)} ${rest.slice(m.index + m[0].length)}`.trim();
    return m[1] ?? null;
  };
  const turns = take(/(?:^|\s)--turns\s+(\d+)(?=\s|$)/);
  if (turns !== null) maxTurns = Number(turns);
  const usd = take(/(?:^|\s)--usd\s+(\d+(?:\.\d+)?)(?=\s|$)/);
  if (usd !== null) maxUsd = Number(usd);
  return { objective: rest.replace(/\s+/g, " ").trim(), ...(maxTurns !== undefined ? { maxTurns } : {}), ...(maxUsd !== undefined ? { maxUsd } : {}) };
}
