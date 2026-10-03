/** 第 331 页 顺带现读：面键是 `file#fn｜needle`，两条**同 file#fn 且 needle 都为空**的模型可见面会不会并成一格？
 *  若会，四态守恒那条断言就会被"同一函数里再加一句短句"打红，而报的是"归因坏了"。 */
import { claimWitnessFindings, type ClaimSite } from "../../scripts/probe-promise-recall.ts";
const mk = (mark: string, text: string): ClaimSite => ({
  file: "src/x.ts", fn: "same", mark, text, line: 1, audience: "model", runs: [], needle: "",
});
const f = claimWitnessFindings([mk("不支持", " 本轮不支持，跳过 "), mk("不认", " 不认识，已忽略 ")], []);
console.log(`分母 modelSites=${String(f.modelSites)}｜noNeedle=${String(f.noNeedle.length)}｜三态相加=${String(f.witnessed.length + f.unwitnessed.length + f.noNeedle.length)}`);
console.log(f.noNeedle.join("\n"));
