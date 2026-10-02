// 长程真轨迹上的「无进展阶梯」离线回放尺（零花费，只读盘上事件流）。
//
// 为什么要这一把：`no-progress.ts` 昨天（`c5ab9ca`）才第一次有了生产消费者（`src/agent/loop.ts:297`），
// 而它接进去之后**没有在任何一条真轨迹上被问过"你会不会开口"**——既有覆盖全在 `fixtures/no-progress/`
// 的录制语料与 30 条单测上。仓里现成的真语料是 `outputs/eval-base-a|b/`（24 条真模型跑，
// 其中 B12-long-horizon 单条 27/28 个请求），所以先问盘上，不再花一次钱。
//
// 口径要说清（与生产端差在哪，写死在这里而不是留给读者猜）：
//  ⑴ 生产端是**每拍 verify 增量判**（`loop.ts:288` 在 verify 反射里算一次）；这里是**整条流判一次**。
//     三只信号都是**首个命中即返回**（`detectStuck`／`detectVerifyStagnation`／`detectAlternatingThrash`
//     都提前 return），所以整条流判出来的命中点 == 生产端最早可能开口的那个点，不早也不晚。
//  ⑵ 判据**逐字共用** `judgeNoProgressEvents`——门、单测、这把尺吃的是同一个函数。
//     自己再算一遍不叫接线（本仓第 4 形态的判据纪律）。
//  ⑶ 「阶梯该不该报」与「这条跑该不该绿」是两件事：红了但不是停滞的跑**不算漏报**。
//     所以这里只出三格能命名的读数：误报格（绿跑上开口了）、可达格（红跑里阶梯真报了的）、
//     以及**结构性不可达格**（R1 要 ≥2 拍 verify，一批语料里每趟只有 1 拍 ⇒ 这条分支根本没机会说话）。
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { judgeNoProgressEvents } from "../../src/agent/no-progress";

const dirs = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (dirs.length === 0) {
  console.error("用法：node --import tsx scripts/replay/longrun-ladder.ts <eval 目录> [...更多]");
  process.exit(2);
}

interface Row { id: string; requests: number; toolCalls: number; pass: boolean }

const readRows = (dir: string): Map<string, Row> => {
  const out = new Map<string, Row>();
  const p = join(dir, "readings.json");
  if (!existsSync(p)) return out;
  const arr = JSON.parse(readFileSync(p, "utf8")) as { r?: Row & { name?: string } }[];
  for (const item of Array.isArray(arr) ? arr : []) {
    const r = (item.r ?? item) as Row & { name?: string };
    const g = (item as { g?: { ok?: boolean } }).g;
    out.set(String(r.name ?? r.id), {
      id: String(r.name ?? r.id),
      requests: Number(r.requests ?? 0),
      toolCalls: Number(r.toolCalls ?? 0),
      pass: g?.ok === true,
    });
  }
  return out;
};

let fired = 0;
let scanned = 0;
const perRun: string[] = [];
const beatCounts: number[] = [];

for (const dir of dirs) {
  const rows = readRows(dir);
  const files = readdirSync(dir).filter((f) => f.endsWith(".events.jsonl")).sort();
  for (const f of files) {
    const events = readFileSync(join(dir, f), "utf8").trim().split("\n").filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    const v = judgeNoProgressEvents(events);
    scanned++;
    fired += v.action === "silent" ? 0 : 1;
    beatCounts.push(v.beats.length);
    const id = f.replace(/-rep\d+.*$/, "").replace(/\.events\.jsonl$/, "");
    const row = rows.get(id);
    const cmds = v.beats.map((b) => (b.named[0] ?? "").split(" → ")[0]);
    const target = v.beats.length < 2 ? "n/a(<2拍)" : cmds[0] === cmds[cmds.length - 1] ? "same" : "changed";
    perRun.push(
      `${dir.split("/").pop()}/${id} requests=${String(row?.requests ?? "?")} toolCalls=${String(row?.toolCalls ?? "?")} `
      + `ended=${row === undefined ? "未知" : row.pass ? "PASS" : "FAIL"} verifyBeats=${String(v.beats.length)} `
      + `ladder=${v.action} rules=${v.rules.join(",") || "-"} targetKept=${target}`,
    );
  }
}

for (const line of perRun) console.log(line);

const hist = new Map<number, number>();
for (const n of beatCounts) hist.set(n, (hist.get(n) ?? 0) + 1);
const minReq = perRun.filter((l) => /requests=\d+/.test(l)).map((l) => Number(l.match(/requests=(\d+)/)?.[1] ?? 0));
console.log("");
console.log(`[longrun-ladder] 扫描=${String(scanned)} 条 · 阶梯开口=${String(fired)} 条 · 整条流判据与生产端共用 judgeNoProgressEvents`);
console.log(`[longrun-ladder] verify 拍数分布 ${JSON.stringify([...hist.entries()].sort())}（R1 需要 ≥2 拍才可达）`);
if (minReq.length > 0) console.log(`[longrun-ladder] requests 极值 最小=${String(Math.min(...minReq))} 最大=${String(Math.max(...minReq))}（max 取自逐笔原始行，不是第一行）`);
