/** 量一件事：D-9 会不会问「凭证页点名的那个**文件名**还在不在」。
 *  动因不是抽象的覆盖面，是我今天真的把一份证人日志用同名文件覆盖了（第 284 页第 6 项据此声称「原文留着」＝假话）。
 *  三条输入的形状是刻意的：一条数在面里（尺该沉默）、一条数压根不在（哨兵，尺必须咬）、
 *  一个不存在的文件名＋它顶着的那句「原文留着」（今天没有任何尺问过它）。 */
import { checkCredentialSources, credentialPages, credFaceFiles } from "/Users/ze/Downloads/deepseek harness/scripts/docs-check.ts";

const ROOT = "/Users/ze/Downloads/deepseek harness";
const DIR = "danger-codes-shape-284-2026-10-01";

const page = [
  "### 2026-10-01 · 第 900 页补 凭证：合成页，只为量 D-9 的文件名盲区",
  "",
  "点名目录 `outputs/" + DIR + "/head-cert-ec004fc.log`：本趟墙钟 209.91s（这一条面里有原文）",
  "另一趟的读数：本趟墙钟 99999.99s（这一条面里没有）",
  "第一版证人 `outputs/" + DIR + "/needles-first-version.log` 的原文留着（这个文件名在盘上根本不存在）",
  "",
].join("\n");

const pages = credentialPages(page);
const face = credFaceFiles(ROOT, DIR);
const res = checkCredentialSources(pages, () => face, {}, 0, 0, {});

const has = (re: RegExp) => res.findings.filter((f) => re.test(f.rule + " " + f.file + " " + f.detail)).length;
console.log(JSON.stringify({
  pagesReceived: pages.length,
  numbersExtracted: pages[0] ? pages[0].numbers : null,
  dirsExtracted: pages[0] ? pages[0].dirs : null,
  faceFiles: face ? face.length : null,
  findings: res.findings.map((f) => `${f.rule}｜${f.detail}`),
  哨兵_假读数被咬住: has(/99999\.99/u),
  真读数没被误咬: has(/209\.91/u),
  点名过的不存在文件名被咬住: has(/needles-first-version/u),
}, null, 2));
