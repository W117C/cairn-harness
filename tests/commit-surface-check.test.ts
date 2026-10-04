// 落库面/门面对账的判卷（#47 ＋ #49，第 339 页）。
// 判据本体是纯函数，这里全喂合成输入；CLI 有取料与写动作 ⇒ 只用**读源文**钉接线，绝不 import 它。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { classifyDrift, driftSummary, gateFaceDiff, landedGap, type DriftReport } from "../scripts/lib/commit-surface.js";
import { GATES } from "../scripts/gate-manifest.js";

const cliSrc = readFileSync(fileURLToPath(new URL("../scripts/commit-surface-check.ts", import.meta.url)), "utf8");
const map = (entries: [string, string][]): Map<string, string> => new Map(entries);

describe("classifyDrift：四态分开印，谁也不许替谁闭嘴", () => {
  it("两侧一致 ⇒ 只有 aligned 出声（别的态必须为 0）", () => {
    const r = classifyDrift(map([["a.ts", "s1"], ["b.ts", "s2"]]), map([["a.ts", "s1"], ["b.ts", "s2"]]));
    expect(r.counts).toEqual({ aligned: 2, missingInIndex: 0, staleInIndex: 0, stagedNew: 0 });
  });
  it("HEAD 有、index 没有 ⇒ missingInIndex（路 A／路 D 落库后新文件就是这个形状）", () => {
    const r = classifyDrift(map([["x.log", "s1"]]), map([]));
    expect(r.cells[0]?.kind).toBe("missingInIndex");
    expect(r.counts.missingInIndex).toBe(1);
  });
  it("两侧都有但 blob 不同 ⇒ staleInIndex（台账那种「index 里是旧版」）", () => {
    const r = classifyDrift(map([["PROGRESS.md", "new"]]), map([["PROGRESS.md", "old"]]));
    expect(r.cells[0]?.kind).toBe("staleInIndex");
    expect(r.cells[0]?.headSha).toBe("new");
    expect(r.cells[0]?.indexSha).toBe("old");
  });
  it("index 有、HEAD 没有 ⇒ stagedNew，且**不算滞后**（别人在飞的暂存面不是我的债）", () => {
    const r = classifyDrift(map([]), map([["bin/cairn.mjs", "s1"]]));
    expect(r.cells[0]?.kind).toBe("stagedNew");
    expect(r.cells[0]?.headSha).toBeNull();
    const drift = r.counts.missingInIndex + r.counts.staleInIndex;
    expect(drift).toBe(0);
  });
  it("同一份路径两侧同 sha ⇒ 与「只有 HEAD 有」给出不同答案（防恒真：尺不能对全部输入同答）", () => {
    const same = classifyDrift(map([["a.ts", "s"]]), map([["a.ts", "s"]]));
    const gone = classifyDrift(map([["a.ts", "s"]]), map([]));
    expect(same.cells[0]?.kind).not.toBe(gone.cells[0]?.kind);
  });
  it("分母自证：四态相加＝逐格数；空清单不报「全对齐」", () => {
    const r = classifyDrift(map([["a", "1"], ["b", "2"], ["c", "3"]]), map([["a", "1"], ["b", "9"]]));
    const sum = Object.values(r.counts).reduce((s, n) => s + n, 0);
    expect(sum).toBe(r.cells.length);
    expect(r.counts).toEqual({ aligned: 1, missingInIndex: 1, staleInIndex: 1, stagedNew: 0 });
    const empty = classifyDrift(map([]), map([]));
    expect(empty.cells).toEqual([]);
    expect(driftSummary(empty)).toContain("路径 0 条");
  });
  it("逐格按路径排序（对账要能被 diff，顺序不稳定就等于读数不稳定）", () => {
    const r = classifyDrift(map([["z.ts", "1"], ["a.ts", "1"]]), map([]));
    expect(r.cells.map((c) => c.path)).toEqual(["a.ts", "z.ts"]);
  });
});

describe("landedGap：只数那一笔动过的路径", () => {
  const report: DriftReport = classifyDrift(
    map([["mine.ts", "h1"], ["theirs-stale.ts", "h2"], ["aligned.ts", "h3"]]),
    map([["mine.ts", "i1"], ["theirs-stale.ts", "i2"], ["aligned.ts", "h3"]]),
  );
  it("我这一笔动过、index 落后 ⇒ 点名（有面无它不出声＝漏报）", () => {
    expect(landedGap(["mine.ts"], report)).toEqual(["mine.ts"]);
  });
  it("别人落后的路径不许混进来（有面它必须闭嘴＝误报）", () => {
    expect(landedGap(["aligned.ts"], report)).toEqual([]);
  });
  it("重复路径去重、结果排序", () => {
    expect(landedGap(["mine.ts", "mine.ts"], report)).toEqual(["mine.ts"]);
  });
  it("取到 0 条路径时返回空，而调用方要单独出声（空手不等于对齐，见接线判卷）", () => {
    expect(landedGap([], report)).toEqual([]);
  });
});

describe("gateFaceDiff：门本体面分三档（HEAD 里有／HEAD 里没这支／非门）", () => {
  const HEAD = (ps: string[]) => new Set(ps);
  it("基名等于门名且 HEAD 里有 ⇒ 进门那一档；`.mjs` 也认", () => {
    const r = gateFaceDiff(
      ["scripts/docs-check.ts", "scripts/mutate-verify.mjs"],
      ["docs-check", "mutate-verify"],
      HEAD(["scripts/docs-check.ts", "scripts/mutate-verify.mjs"]),
    );
    expect(r.gates).toEqual(["scripts/docs-check.ts", "scripts/mutate-verify.mjs"]);
    expect(r.absentInHead).toEqual([]);
    expect(r.other).toEqual([]);
  });
  it("**HEAD 里没这门 ⇒ 单列，不混进「门在飞」**（第 345 页：混起来会让人以为 HEAD 有一道红门，而在干净树里跑它是 ERR_MODULE_NOT_FOUND）", () => {
    const r = gateFaceDiff(["scripts/repo-hygiene-check.ts"], ["repo-hygiene-check"], HEAD([]));
    expect(r.absentInHead).toEqual(["scripts/repo-hygiene-check.ts"]);
    expect(r.gates).toEqual([]);
  });
  it("同一支门在 HEAD 里有／没有 ⇒ 两档各一条，且**两半互斥**（同一份输入换 head 面，门的归属必须变）", () => {
    const p = "scripts/next-page.ts";
    const inHead = gateFaceDiff([p], ["next-page"], HEAD([p]));
    const notInHead = gateFaceDiff([p], ["next-page"], HEAD([]));
    expect(inHead.gates).toEqual([p]);
    expect(inHead.absentInHead).toEqual([]);
    expect(notInHead.gates).toEqual([]);
    expect(notInHead.absentInHead).toEqual([p]);
  });
  it("不是门的差异单列，不撑大门那一档（否则一次注释改动都会喊门在飞）", () => {
    const r = gateFaceDiff(["scripts/lib/commit-surface.ts"], ["docs-check"], HEAD(["scripts/lib/commit-surface.ts"]));
    expect(r.gates).toEqual([]);
    expect(r.absentInHead).toEqual([]);
    expect(r.other).toEqual(["scripts/lib/commit-surface.ts"]);
  });
  it("非门且 HEAD 里也没有 ⇒ 仍进 other（HEAD 面只管门的分档，不许把非门挪进 absentInHead 造出第二份账）", () => {
    const r = gateFaceDiff(["scripts/probe-new.ts"], ["docs-check"], HEAD([]));
    expect(r.other).toEqual(["scripts/probe-new.ts"]);
    expect(r.absentInHead).toEqual([]);
  });
  it("真仓事实源：GATES 里的名字确实能匹配到 `scripts/<名字>.ts` 那一族（名单没被换成手抄件）", () => {
    expect(GATES.length).toBeGreaterThan(20);
    const r = gateFaceDiff(["scripts/docs-check.ts"], GATES, HEAD(["scripts/docs-check.ts"]));
    expect(r.gates).toEqual(["scripts/docs-check.ts"]);
  });
  it("空清单 ⇒ 三档都空（不许凭空报出「门在飞」）", () => {
    expect(gateFaceDiff([], GATES, HEAD([]))).toEqual({ gates: [], absentInHead: [], other: [] });
  });
  it("分母守恒：三档相加＝去重后的输入条数；且**基名命中**这条旧行为原样钉住（根目录下的同名件也算门）", () => {
    const input = ["scripts/docs-check.ts", "scripts/repo-hygiene-check.ts", "scripts/lib/x.ts", "docs-check.ts"];
    const r = gateFaceDiff(input, ["docs-check", "repo-hygiene-check"], HEAD(["scripts/docs-check.ts"]));
    // 分档按**基名**（`gateFaceDiff` 一直如此）：`docs-check.ts` 也算门名命中，但它不在 HEAD 那一份里
    // ⇒ 进 absentInHead。这一格顺手把旧行为钉住，免得将来有人改成按全路径匹配时静默换口径。
    expect(r.gates).toEqual(["scripts/docs-check.ts"]);
    expect(r.absentInHead).toEqual(["docs-check.ts", "scripts/repo-hygiene-check.ts"]);
    expect(r.other).toEqual(["scripts/lib/x.ts"]);
    expect(r.gates.length + r.absentInHead.length + r.other.length).toBe(new Set(input).size);
  });
});

describe("driftSummary：一行说清四态，且相加＝分母", () => {
  it("读数逐字（规则 253：这行是给人的，但格式被判卷钉住，改格式要同笔改判卷）", () => {
    const r = classifyDrift(map([["a", "1"], ["b", "2"], ["c", "3"]]), map([["a", "1"], ["b", "9"]]));
    expect(driftSummary(r)).toBe("落库面对账：路径 3 条 —— 一致 1，index 缺 1，index 更旧 1，别人新暂存 0");
  });
});

describe("CLI 的接线（读源文，不 import 有取料与写动作的那支）", () => {
  it("取料两处都带 `-z`（中文/非 ASCII 路径在默认输出里会被转义成八进制串而整批读不到）", () => {
    expect(cliSrc).toMatch(/ls-tree", "-r", "-z", "HEAD"/u);
    expect(cliSrc).toMatch(/ls-files", "-s", "-z"/u);
    expect(cliSrc).toMatch(/diff-tree[^"]*", "--no-commit-id", "--name-only", "-r", "-z"/u);
  });
  it("门清单吃 `GATES`，不手抄第二份；且 HEAD 面是**取来的**、不是默认「HEAD 里都有」", () => {
    expect(cliSrc).toMatch(/import \{ GATES \} from "\.\/gate-manifest\.js";/u);
    expect(cliSrc).toMatch(/gateFaceDiff\(dirtyScripts, GATES, headScripts\)/u);
    expect(cliSrc).toMatch(/ls-tree", "-r", "--name-only", "-z", "HEAD", "--", "scripts"/u);
    expect(cliSrc).not.toMatch(/const GATE_NAMES\s*=\s*\[/u);
  });
  it("「HEAD 里没这门」那一档要真的出声（不然后一格又靠人记得）", () => {
    expect(cliSrc).toMatch(/face\.absentInHead\.length > 0/u);
    expect(cliSrc).toMatch(/还没入库/u);
  });
  it("缺省只读；写动作只在显式 `--sync` 分支里，且作用域是「该笔动过 ∩ index 落后」", () => {
    expect(cliSrc).toMatch(/const doSync = flag\("sync"\) !== null;/u);
    expect(cliSrc).toMatch(/if \(doSync\) \{\n\s*for \(const p of gap\) \{/u);
    expect(cliSrc).toMatch(/update-index", "--add", "--cacheinfo"/u);
    // 写路径只有一处：把非分支内出现的次数算出来（多于 1 处＝存在自动同步的旁路）。
    expect((cliSrc.match(/update-index/gu) ?? []).length).toBe(1);
  });
  it("`--landed` 取到 0 条要单独喊「取不到」，不许读成「没滞后」（空手不是绿）", () => {
    expect(cliSrc).toMatch(/取到 0 条路径 ⇒ 这一格取不到，不当成"没滞后"/u);
  });
  it("未知参数当场拒收（尺不许吞错参数再给一个好读的 0）", () => {
    expect(cliSrc).toMatch(/不认识参数/u);
    expect(cliSrc).toMatch(/process\.exit\(2\);/u);
  });
  it("分母自证失败时明写「不可引用」，而不是继续报数", () => {
    expect(cliSrc).toMatch(/分母自证失败[\s\S]{0,40}不可引用/u);
  });
});
