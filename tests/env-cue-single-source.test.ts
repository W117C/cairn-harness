// 环境线索的**匹配器定义位点**普查（第 222 页 #44 立的那格）。
//
// 这一族的老形状是「同一判据 N 份副本、宽度各不同」（本仓第十三族）：`[exit code: 127]` 这一句
// 从前在三个地方各自写成正则（取料层的表、`verify-cause-mix` 的 exec 文案栏、`cascade-traffic` 的手抄名单），
// 而且只有两处行首锚定。折成一份之后，判据不能只剩"我记得改干净了"⇒ 要有一把现读的尺：
// **谁在定义这些匹配器**按文件数出来，多一处就红。
//
// 两条纪律带着（同 `timeout-text-single-source`）：
// ⑴ 尺必须自带**分母证人**——扫到了哪几个文件要点名，否则"0 处"与"尺没接上电"同形（规则 261）；
// ⑵ 空名单的另一半证明是**合成源负控**——把副本形状喂进去必须被读到（规则 306）。
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPLAY_DIR = fileURLToPath(new URL("../scripts/replay", import.meta.url));
const ALLOWED_OWNER = "corpus.ts";

/** 一条「在定义匹配器」的行：正则字面量出现在 `const X = /…/` 或 `{ re: /…/ }` 的右手边。
 *  只这样认是为了把**样本数据**排除掉——判卷与自检中合成的字符串里也带着这些句子的原文，
 *  那些不是第二份判据（把它们算进来，尺会把"有对照"读成"有副本"）。 */
function matcherDefLines(src: string): string[] {
  return src.split("\n").filter((line) => /(?:const\s+\w+\s*=\s*\/|\bre:\s*\/)/u.test(line));
}

function ownerFiles(token: string): string[] {
  const hits: string[] = [];
  for (const name of readdirSync(REPLAY_DIR).filter((f) => f.endsWith(".ts")).sort()) {
    const src = readFileSync(`${REPLAY_DIR}/${name}`, "utf8");
    if (matcherDefLines(src).some((line) => line.includes(token))) hits.push(name);
  }
  return hits;
}

describe("环境线索的匹配器定义位点：整族只有一份", () => {
  it("分母证人：真扫到了复跑面的文件并点名（否则『0 处』说明的是尺没接上电）", () => {
    const names = readdirSync(REPLAY_DIR).filter((f) => f.endsWith(".ts")).sort();
    expect(names.length, `复跑面只扫到 ${String(names.length)} 个文件`).toBeGreaterThanOrEqual(8);
    for (const must of ["corpus.ts", "verify-cause-mix.ts", "cascade-traffic.ts"]) {
      expect(names, `取料面漏了 ${must}`).toContain(must);
    }
  });

  it("127 与超时这两条只许在取料层那一份里定义", () => {
    expect(ownerFiles("\\[exit code: 127\\]"), "退出码 127 的匹配器又长出第二份").toEqual([ALLOWED_OWNER]);
    expect(ownerFiles("超时"), "超时那句的匹配器又长出第二份").toEqual([ALLOWED_OWNER]);
  });

  it("包管理器那一行由产品谓词说话：复跑面里一处定义都不许有", () => {
    // 它的正则在 `src/agent/verify.ts`（`PKG_MANAGER_OWN_ERROR_LINE`，本笔导出给尺），
    // 复跑面只 import——所以这一格的期望值是**空**，而空的可信度来自上面那条分母证人加下面的负控。
    expect(ownerFiles("ERR_PNPM"), "复跑面里不该再有第二条 ERR_PNPM 正则").toEqual([]);
  });

  it("合成负控：副本形状必须被读到（判据不是恒不成立）", () => {
    expect(matcherDefLines(`const T_PKG = /^[ \\t]*\\[?ERR_PNPM_[A-Z0-9_]+\\]?/m;`).length).toBe(1);
    expect(matcherDefLines('  { kind: "timeout", re: /^\\[error: [^\\n]*超时/mu },').length).toBe(1);
    // 样本数据不算定义位：这两行都带着同一句原文，但没人拿它当判据
    expect(matcherDefLines('output: "npm ERR 前面一行\\n[exit code: 127]"').length).toBe(0);
    expect(matcherDefLines('// 注释里引用了 [exit code: 127] 这一句').length).toBe(0);
  });

  it("尺的盲区自己讲出来：`includes(...)` 那种**字面串副本**它数不到", () => {
    // 本笔折掉的两处副本恰是这种形状（一处 `out.includes("[exit code: 127]")`、一处字符串数组）⇒ 这把尺看不见它们。
    // 说出来而不是留着让人误信「普查=只有一份」：那两处的证人是行为面上的跨面用例（一条输入、三个出口），
    // 规则 261——尺的"读不到"与"没有问题"不许同形。
    expect(matcherDefLines('  if (out.includes("[exit code: 127]")) return "toolchain-missing";').length).toBe(0);
    expect(matcherDefLines('const ENV_TEXTUAL = ["[exit code: 127]", "verify 命令超时"];').length).toBe(0);
  });
});
