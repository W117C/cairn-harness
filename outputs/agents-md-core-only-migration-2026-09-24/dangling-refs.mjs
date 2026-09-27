import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** 必须 `-z`：默认的 git ls-files 会把非 ASCII 路径转成八进制转义并外加引号，
 *  于是 `readFileSync` 全部 ENOENT——第一次跑就是这样把 12 处引用读成 8 处（135 个"读不到"里
 *  绝大多数是中文文件名的页，不是真被删）。 */
const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const RE = /AGENTS\.md[^ ]{0,3}「([^」]{2,40})」/g;
const stub = readFileSync("AGENTS.md", "utf8");
const head = execFileSync("git", ["show", "HEAD:AGENTS.md"], { encoding: "utf8" });

const rows = [];
const unreadable = [];
for (const f of tracked) {
  if (!/\.(md|ts|tsx|js|mjs|cjs)$/.test(f)) continue;
  let txt;
  try {
    txt = readFileSync(f, "utf8");
  } catch (e) {
    unreadable.push(`${f} (${e.code})`);
    continue;
  }
  txt.split("\n").forEach((ln, i) => {
    for (const m of ln.matchAll(RE)) {
      const label = m[1];
      rows.push({
        at: `${f}:${i + 1}`,
        label,
        inStub: stub.includes(label),
        inHead: head.includes(label),
      });
    }
  });
}
const dangling = rows.filter((r) => !r.inStub);
if (unreadable.length > 0) {
  console.log(`❌ 取料面有 ${unreadable.length} 个文件读不到 ⇒ 下面的数是**下界**，不是总数：`);
  for (const u of unreadable.slice(0, 12)) console.log("   · " + u);
}
console.log(`引用总数 ${rows.length}｜stub 里已无该串 ${dangling.length}｜其中 HEAD 原文有（=真悬空）${dangling.filter((r) => r.inHead).length}`);
for (const r of dangling) console.log(`  ${r.inHead ? "悬空" : "本就无"}  ${r.at}  「${r.label}」`);
