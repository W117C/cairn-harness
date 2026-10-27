/** HTML/SVG 产物的**静态**自检：不连网、不起浏览器、只看字节。
 *
 *  为什么要有这一格（2026-10-16 读数）：agent 的 verify 面是全仓 TS 套件（typecheck + 三个判卷族），
 *  99 条全绿——可它一次都没看过用户要的那份 HTML。结果是「测试绿了，用户看到的东西仍然不好」：
 *  鹈鹕是否可辨、脚贴不贴踏板、循环跳不跳变，全都没有观察者。
 *
 *  这一格不假装能替代视觉检查（那要 render_image 多点采样 + 人眼/模型判），它只把**字节层**
 *  能确定的事实钉出来，且每条失败都点名文件与行号：
 *  ① 文件存在且非空；
 *  ② 单文件自洽：不引用外部资源（http(s)://、协议相对 //host）——零外部依赖是离线交付的硬要求；
 *  ③ 没有未替换的占位符（模板组装时的常见残留：__FOO__、{{foo}}）；
 *  ④ 引用的本地资源（同目录相对路径）确实存在；
 *  ⑤ 引用的协议形态合法（不把 javascript: 之类当本地文件查）。
 *
 *  用法：`node --import tsx scripts/html-artifact-check.ts <file.html> [more.html …]`
 *  退出码 0 = 全过；1 = 有失败（每条带 文件:行）；2 = 用法错（没有参数不假装干净）。 */
import { statSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { readTextFileSnapshotSync } from "./lib/file-snapshot";

interface Finding {
  file: string;
  line: number;
  what: string;
}

const findings: Finding[] = [];

/** 外部资源引用的两种写法（`//host` 是协议相对 URL，浏览器会走 http(s)）。 */
const EXTERNAL_URL = /(?:src|href)\s*=\s*["']\s*(?:https?:\/\/|\/\/)[^"']*["']/gi;
/** 模板残留：双下划线包一个全大写词、或双花括号变量。 */
const PLACEHOLDER = /(?:__[A-Z][A-Z0-9_]*__|\{\{[^}\s]+\}\})/g;
/** 本地资源引用（相对路径；锚点与协议形态由下面逐条排除）。 */
const LOCAL_REF = /(?:src|href)\s*=\s*["']([^"']+)["']/gi;

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === "\n") line++;
  return line;
}

function checkFile(abs: string, rel: string): void {
  let text: string;
  try {
    const snapshot = readTextFileSnapshotSync(abs);
    const st = snapshot.stat;
    if (st.size === 0) {
      findings.push({ file: rel, line: 1, what: "空文件——没有可交付的内容" });
      return;
    }
    text = snapshot.text;
  } catch (err) {
    findings.push({ file: rel, line: 1, what: "读不到：" + (err instanceof Error ? err.message : String(err)) });
    return;
  }

  for (const m of text.matchAll(EXTERNAL_URL)) {
    findings.push({
      file: rel,
      line: lineOf(text, m.index ?? 0),
      what: "引用外部资源（离线交付要求零外部依赖）：" + (m[0] ?? "").slice(0, 120),
    });
  }
  for (const m of text.matchAll(PLACEHOLDER)) {
    findings.push({
      file: rel,
      line: lineOf(text, m.index ?? 0),
      what: "疑似未替换的占位符：" + (m[0] ?? ""),
    });
  }
  // 本地资源存在性：只查相对路径，跳过锚点 / 带协议的 / 协议相对的（后两类已在上面两格里报过或不是文件）。
  for (const m of text.matchAll(LOCAL_REF)) {
    const raw = (m[1] ?? "").trim();
    if (raw === "" || raw.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("//")) continue;
    const target = resolve(dirname(abs), raw.split(/[?#]/u)[0] ?? "");
    try {
      if (!statSync(target).isFile()) {
        findings.push({ file: rel, line: lineOf(text, m.index ?? 0), what: "引用的本地文件不存在：" + raw });
      }
    } catch {
      findings.push({ file: rel, line: lineOf(text, m.index ?? 0), what: "引用的本地文件不存在：" + raw });
    }
  }
}

const args = process.argv.slice(2).filter((a) => a !== "");
if (args.length === 0) {
  console.error("用法：node --import tsx scripts/html-artifact-check.ts <file.html> [more.html …]");
  process.exit(2);
}
for (const a of args) {
  if (isAbsolute(a)) {
    console.error("只接受工作区相对路径（与其余判卷同口径）：" + a);
    process.exit(2);
  }
  checkFile(resolve(process.cwd(), a), a);
}

if (findings.length === 0) {
  console.log("html-artifact-check: " + String(args.length) + " 个产物全过（存在 / 零外部依赖 / 无占位符残留 / 本地引用齐）");
  process.exit(0);
}
console.error("html-artifact-check: " + String(findings.length) + " 处问题");
for (const f of findings) console.error("  " + f.file + ":" + String(f.line) + " — " + f.what);
process.exit(1);
