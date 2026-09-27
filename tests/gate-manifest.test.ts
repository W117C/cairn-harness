// 门表自身的护栏有没有人验收（第 146 页登记 `head-import-check` 时发现的空位）。
//
// `checkGateManifest` 是那道「scripts / GATES / EXEMPT 三张表不许各说各话」的机械护栏，
// 由 `scripts/gates.ts:118` 在跑门之前调用——**但此前没有任何判卷吃它**：
// 四种违例里今天真正走得到的只有两支（豁免表是空的 ⇒ 那两个分支零输入），
// 而"算得对不对"完全靠运气：谁把 `gates.has(name)` 那行改坏，门表会瞬间把所有正常脚本报成孤儿，
// 或反过来让一条新门悄悄不进 GATES（`provider:check` 就是这条历史上的实例）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { EXEMPT_SCRIPTS, GATES, checkGateManifest } from "../scripts/gate-manifest";

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")) as {
  scripts: Record<string, string>;
};

/** 拿真表当底子，只改要测的那一处（不在测试里重抄整张门表）。 */
const scriptsMinus = (name: string): Record<string, string> => {
  const copy = { ...pkg.scripts };
  delete copy[name];
  return copy;
};

describe("checkGateManifest：三张表的一致性护栏", () => {
  it("验收形态的脚本既不在 GATES 也不在豁免 ⇒ 报 orphan（漏登记的门＝从不运行的门）", () => {
    const v = checkGateManifest({ ...pkg.scripts, "brand-new-check": "node x.ts" });
    expect(v.map((x) => x.kind + ":" + x.name)).toContain("orphan-acceptance-script:brand-new-check");
  });

  it("「验收形态」按词根判，不按后缀：换后缀命名逃不掉；不含 check 的不算", () => {
    const v = checkGateManifest({ ...pkg.scripts, "foo-checker": "x", "bar:check2": "x", build: "tsc", start: "node y.ts" });
    const names = v.filter((x) => x.kind === "orphan-acceptance-script").map((x) => x.name);
    expect(names).toContain("foo-checker");
    expect(names).toContain("bar:check2");
    expect(names).not.toContain("build");
    expect(names).not.toContain("start");
  });

  it("已在 GATES 里的脚本不许被报成孤儿（把 gates.has 那行改坏 ⇒ 整张表瞬间全红）", () => {
    expect(checkGateManifest(pkg.scripts)).toEqual([]);
    // 牙齿：随便挑一道真门，它必须**同时**在 GATES 与 scripts 里，上面那条 0 违例才不是空话
    expect(GATES).toContain("test");
    expect(pkg.scripts.test).toBeTruthy();
  });

  it("GATES 列了而 package.json 没有同名 script ⇒ 报 gate-without-script（这道门一 spawn 就失败）", () => {
    const v = checkGateManifest(scriptsMinus("head-import-check"));
    expect(v.map((x) => x.kind + ":" + x.name)).toContain("gate-without-script:head-import-check");
  });

  it("豁免表里列了不存在的 script ⇒ 报陈旧豁免（脚本删了，豁免还挂着）", () => {
    const v = checkGateManifest(pkg.scripts, { "gone-check": "理由：这条门已经不再需要" });
    expect(v.map((x) => x.kind + ":" + x.name)).toContain("exempt-unknown-script:gone-check");
  });

  it("豁免必须带理由：空白理由不算豁免（豁免本身要可审计）", () => {
    const v = checkGateManifest(pkg.scripts, { "docs-check": "   " });
    expect(v.map((x) => x.kind + ":" + x.name)).toContain("exempt-without-reason:docs-check");
  });

  it("真表现读：豁免表当下为空 ⇒ 那两个分支只能靠上面两条合成输入走到（这里钉住「今天没有豁免」这个事实）", () => {
    expect(Object.keys(EXEMPT_SCRIPTS)).toEqual([]);
  });

  it("登记面：head-import-check 进了门表，且命令就是那把 0.26s 的尺（任务 #12）", () => {
    const i = GATES.indexOf("head-import-check");
    expect(i, "没登记进门表 ⇒ 这把尺又是一条从不运行的门").toBeGreaterThan(-1);
    expect(pkg.scripts["head-import-check"]).toContain("scripts/head-import-face.ts");
    // 位置也有讲究：它排在 test 之后不在末尾 ⇒ 半落库要在昂贵的 mutate-verify 之前就被发现
    expect(i).toBeLessThan(GATES.indexOf("mutate-verify"));
  });
});
