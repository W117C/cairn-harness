import { performance } from "node:perf_hooks";
const root = process.argv[2]!;
const spec = process.argv[3]!;
const reps = Number(process.argv[4] ?? "5");
const times: number[] = [];
for (let i = 0; i < reps; i += 1) {
  const t0 = performance.now();
  await import(root + spec + "?r=" + String(i));
  times.push(performance.now() - t0);
}
times.sort((a, b) => a - b);
console.log(`${spec}  中位 ${times[Math.floor(reps / 2)]!.toFixed(1)}ms  最小 ${times[0]!.toFixed(1)}ms  最大 ${times[reps - 1]!.toFixed(1)}ms  （${reps} 次：${times.map((t) => t.toFixed(0)).join("/")}）`);
