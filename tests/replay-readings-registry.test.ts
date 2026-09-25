// D-8 的第五判据：盘上的复跑面必须登记——**取料从盘出发，不从登记表出发**。
//
// 病灶是我自己留下的（2026-09-25 读到）：任务 #39 装了 `scripts/replay/prune-promise.ts`，
// 但既没登记进 `REPLAY_READINGS`、文档里也没写过一句 `replay:prune-promise`。
// D-8 现有四条各挑一格（引用未登记 / 登记未引用 / 登记指向缺失脚本 / 内联 heredoc），
// 没有一条问「盘上有哪些面」⇒ 这种"两头都没登记"的面门**永远看不见**：
//   `replay-readings.ts` 文件头明写着「取料一律从真实文档扫（不读登记表自陈），否则未登记项会静默漏在机制外」，
//   而它自己只扫了文档那一侧，脚本那一侧没扫——判据挂在一种写法上（规则 122）。
// 反向哨兵（为什么不能简单"全部要求登记"）：`corpus.ts` 是共用取料层、不是面，
// 它没有 `replay:` 语义、也不该有。所以这一条判的是「**没人吃它**」：
// 未登记 + 没有任何同目录文件 import ⇒ 孤儿 ⇒ 红。corpus.ts 被 10 支面 import ⇒ 天然通过。
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { REPLAY_READINGS, replayGapsOf, type ReplayOnDiskFile } from "../scripts/replay-readings";

const REPLAY_DIR = join(__dirname, "..", "scripts", "replay");
const rel = (name: string): string => "scripts/replay/" + name;

async function onDisk(): Promise<ReplayOnDiskFile[]> {
  const names = (await readdir(REPLAY_DIR)).filter((f) => f.endsWith(".ts"));
  return Promise.all(
    names.map(async (n) => ({ path: rel(n), source: await readFile(join(REPLAY_DIR, n), "utf8") })),
  );
}

describe("D-8 第五判据：未登记且没人 import 的复跑面 = 孤儿（门此前看不见）", () => {
  it("纯函数：未登记、也没人吃它 ⇒ orphanScripts 点名它", () => {
    const gaps = replayGapsOf({
      registered: [{ id: "a", script: rel("a.ts"), answers: "x" }],
      missingScripts: [],
      refs: [{ file: "docs/x.md", ids: ["a"] }],
      inline: [{ file: "docs/x.md", count: 0 }],
      onDisk: [
        { path: rel("a.ts"), source: "export const a = 1;\n" },
        { path: rel("sneaky.ts"), source: "async function main() {}\nmain();\n" },
      ],
    });
    expect(gaps.orphanScripts).toEqual([rel("sneaky.ts")]);
  });

  it("反向一侧（不许把所有共用品都判成孤儿）：未登记但被已登记的面 import ⇒ 通过", () => {
    const gaps = replayGapsOf({
      registered: [{ id: "a", script: rel("a.ts"), answers: "x" }],
      missingScripts: [],
      refs: [{ file: "docs/x.md", ids: ["a"] }],
      inline: [{ file: "docs/x.md", count: 0 }],
      onDisk: [
        { path: rel("a.ts"), source: 'import { scan } from "./corpus";\nexport const a = scan;\n' },
        { path: rel("corpus.ts"), source: "export async function scan() {}\n" },
      ],
    });
    expect(gaps.orphanScripts).toEqual([]);
  });

  it("自证取料面：盘上真有没被 import 的孤儿时，这条判据必须点得出名（不是恒空）", () => {
    const gaps = replayGapsOf({
      registered: [],
      missingScripts: [],
      refs: [],
      inline: [],
      onDisk: [{ path: rel("only.ts"), source: "export const only = 1;\n" }],
    });
    expect(gaps.orphanScripts).toEqual([rel("only.ts")]);
  });

  it("真盘扫描：`scripts/replay/*.ts` 里不许存在未登记且没人 import 的面", async () => {
    const files = await onDisk();
    expect(files.length, "取料清单为空 ⇒ 这条判据是瞎的（目录读不到就要红，不许读成全绿）").toBeGreaterThan(0);
    const gaps = replayGapsOf({
      registered: REPLAY_READINGS,
      missingScripts: REPLAY_READINGS.filter((r) => !files.some((f) => f.path === r.script)).map((r) => r.script),
      refs: [],
      inline: [],
      onDisk: files,
    });
    expect(gaps.orphanScripts, "未登记又没人 import 的复跑面：" + gaps.orphanScripts.join(", ")).toEqual([]);
  });
});
