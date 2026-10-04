// 更正证人：① 证人点名面在四笔上的真实条数（用尺自己的 ledgerWitnessRefs，整本取唯一集）
// ② 运行期残留那三个数（712／710／2、字节、条目 vs 文件）——第 352 页当时只在终端里跑过、没归档。
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join} from "node:path";
import { ledgerWitnessRefs } from "../../scripts/docs-check";

const revs = ["87407514", "6f85db7b", "013fb977", "58a29ffa"];
for (const r of revs) {
  const text = execFileSync("git", ["show", `${r}:PROGRESS.md`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const refs = new Set(ledgerWitnessRefs(text));
  console.log(`${r}：唯一 dated 引用 ${String(refs.size)} 条`);
}

const root = "fixtures/todo-app/.agent";
const files = (d: string): number => {
  let n = 0;
  for (const e of readdirSync(d, { withFileTypes: true })) {
    if (e.isDirectory()) n += files(join(d, e.name));
    else if (e.isFile()) n += 1;
  }
  return n;
};
const snap = readdirSync(join(root, "snapshots"));
let nestedFiles = 0;
for (const s of snap) {
  const st = statSync(join(root, "snapshots", s));
  nestedFiles += st.isDirectory() ? files(join(root, "snapshots", s)) : 1;
}
console.log(
  `残留面：条目 ${String(snap.length)}｜snapshots 里文件 ${String(nestedFiles)}` +
    `｜.agent 全树文件 ${String(files(root))}｜memory 里文件 ${String(files(join(root, "memory")))}`,
);
