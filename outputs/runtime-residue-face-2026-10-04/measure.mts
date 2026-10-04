// 量「被 .gitignore 挡住的运行期残留面」：谁在长、长多快、我这轮有没有贡献。
import { readdirSync, statSync } from "node:fs";

const DAY = 86_400_000;
const fmt = (ms: number): string => new Date(ms).toISOString().slice(0, 16).replace("T", " ");

const roots = [
  "fixtures/todo-app/.agent/snapshots",
  ".agent/sessions",
  ".codegraph",
  ".worktrees/verify-013fb97/fixtures/todo-app/.agent/snapshots",
];
for (const r of roots) {
  let names: string[] = [];
  try {
    names = readdirSync(r);
  } catch {
    console.log(`${r}：目录不存在（结构性没有，不是"数出来 0"）`);
    continue;
  }
  const ms = names.map((n) => Number(/^(\d{13})--/u.exec(n)?.[1] ?? NaN)).filter(Number.isFinite);
  const days = new Map<string, number>();
  for (const m of ms) {
    const k = new Date(m).toISOString().slice(0, 10);
    days.set(k, (days.get(k) ?? 0) + 1);
  }
  const sorted = [...days.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const span = ms.length ? (Math.max(...ms) - Math.min(...ms)) / DAY : 0;
  console.log(
    `${r}：条目 ${String(names.length)}｜带 13 位毫秒前缀的 ${String(ms.length)}｜跨度 ${span.toFixed(2)} 天` +
      `｜最早 ${ms.length ? fmt(Math.min(...ms)) : "—"}｜最近 ${ms.length ? fmt(Math.max(...ms)) : "—"}`,
  );
  console.log(`  按天：${sorted.map(([k, v]) => `${k}=${String(v)}`).join(" ")}`);
  const st = names.length ? statSync(`${r}/${names.sort().pop()}`) : null;
  if (st) console.log(`  目录里最后一个条目的 mtime：${st.mtime.toISOString()}`);
}
