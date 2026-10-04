// CI 那份「快门面」与认证面（CERT_GATES）必须是**同一件事**。
// 起因：第 381 页本轮认证现读 `认证门面=23 道（跑到 23）`，而 `.github/workflows/verify.yml` 的注释与
// 步骤名仍写 22——那份名单是逐字点名的（不是引用 CERT_GATES），所以它会跟着门表演化而漂。
//
// 判卷写三层，缺一层就有洞：
//   ① 集合相等：认证有而 CI 没有＝CI 永远量不到那道门；CI 有而认证没有＝CI 跑了一件不被认证承认的事。
//   ② **标称数字**：注释/步骤名里写的那个数必须等于 CERT_GATES 条数（漂了就红——这条今天就是红的）。
//   ③ 空探针证人：解析必须真找到 `--only=` 那一行且解析出 ≥10 个名字。
//      否则 workflow 一改名（`--only` 换成别的写法、名单挪进行号），①②会同时变成「两边都空 ⇒ 相等」的恒真。
//      （本仓反复踩的那一格：一片 0 先怀疑取料，不是先报喜。）
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CERT_GATES } from "../scripts/gate-manifest";

const WF = readFileSync(join(process.cwd(), ".github", "workflows", "verify.yml"), "utf8");

/** 从 `--only=` 那一条 run 里取门名清单（取料面＝CI 那份名单，不在这里重算认证面）。 */
function ciGateNames(): string[] {
  const m = WF.match(/--only=([A-Za-z0-9:._,-]+)/u);
  if (!m) throw new Error("workflow 里找不到 --only= 那一行 ⇒ 这份判卷的取料面已经变了，别让它恒真");
  return m[1].split(",").map((s) => s.trim()).filter(Boolean);
}

/** CERT_GATES 的门名（复用清单自己产出的那份名字，不手抄）。 */
function certGateNames(): string[] {
  return CERT_GATES.map((g) => (typeof g === "string" ? g : g.name));
}

describe("CI 快门面 = 认证面（同一件事，不许两份名单各漂各的）", () => {
  const ci = ciGateNames();
  const cert = certGateNames();

  it("取料面不是空的：CI 名单解析出 ≥10 道、认证面解析出 ≥10 道（空探针证人）", () => {
    expect(ci.length, "CI 名单只解析出 " + String(ci.length) + " 道").toBeGreaterThanOrEqual(10);
    expect(cert.length, "CERT_GATES 只解析出 " + String(cert.length) + " 道").toBeGreaterThanOrEqual(10);
  });

  it("两份名单逐字相等（差集两头都要空，并点名缺哪道）", () => {
    const onlyCert = cert.filter((n) => !ci.includes(n));
    const onlyCi = ci.filter((n) => !cert.includes(n));
    expect({ 认证有而CI没有: onlyCert, CI有而认证没有: onlyCi }, "CI 快门面与 CERT_GATES 不同面").toEqual({
      认证有而CI没有: [],
      CI有而认证没有: [],
    });
  });

  it("workflow 里**今天还在生效的那两个标注**等于 CERT_GATES 条数（历史凭证原文不许被这条顶改）", () => {
    // 只钉「现在时的句子」：步骤名 `fast gates (cert face, N)` 与注释「CERT_GATES 那 N 道」。
    // 第三处「认证门面=22 道（跑到 22）｜绿 22 道」是**引用某一笔认证留档的历史读数**（带 TREE 出处），
    // 它当时是对的；把历史读数一起钉成今天的数，等于逼人改写证词——那是本仓明令禁止的形状。
    const live: number[] = [];
    const step = WF.match(/fast gates \(cert face, (\d{1,3})\)/u);
    expect(step, "步骤名里那个道数没解析到（改名了？这条判卷的取料面变了）").not.toBeNull();
    live.push(Number(step?.[1]));
    const claim = WF.match(/CERT_GATES 那 (\d{1,3}) 道/u);
    expect(claim, "注释里「CERT_GATES 那 N 道」没解析到（取料面变了）").not.toBeNull();
    live.push(Number(claim?.[1]));
    for (const n of live) {
      expect(n, "workflow 标称 " + String(n) + " 道，而 CERT_GATES 现读 " + String(cert.length) + " 道 ⇒ 标注漂了").toBe(cert.length);
    }
  });
});
