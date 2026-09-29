// 第 219 页 · 模型可见文本里的**墙钟数字**必须由"真正控制它的那个常量"说话（#42）。
//
// 现读的这一族有四个成员，两种宽度：
//   `src/agent/verify.ts`、`src/tools/ripgrep.ts` ⇒ 插值（`timeoutMs / 1000`、`RG_TIMEOUT_MS / 1000`）✅
//   `src/tools/run_shell.ts`、`src/tools/glob.ts` ⇒ 正文里写死「60s」，帽在另一行/另一头 ❌（本笔已改成插值）
// 为什么值得钉：那句话是**模型做决策读**的（"再等一下"还是"换路"）。写死的数字在改帽之后就成假话，
// 而同一条纪律在 `cap-notice.ts` 那两支（条数帽／字节帽）里早已是"帽值必须当参数传进来"。
//
// 判据形状是**普查**而不是逐条 toContain：取料面按 `src/**/*.ts` 现走，新增站点自动进分母
// （规则 258：标签不许大于取料面；这里反过来——取料面长大了分母自己跟上）。
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** 只剥注释，不动字符串：本判据看的**就是**字符串里的写法，剥字符串等于把被度量者抹掉。
 *  整行 `//` 与块注释两类（`https://` 这种行内双斜杠不在剥之列——宁可少剥也不误伤正文）。 */
export function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

export interface TimeoutSite {
  file: string;
  line: number;
  text: string;
  /** 秒数那一格里直接写的是数字（=假话风险），而不是从常量算出来。 */
  hardcoded: boolean;
}

/** 站点＝正文里出现「超时（」的地方（这一族四支都这么起句）；hardcoded＝那个括号后紧跟数字。 */
export function timeoutSites(raws: readonly { file: string; src: string }[]): TimeoutSite[] {
  const out: TimeoutSite[] = [];
  for (const r of raws) {
    const lines = stripComments(r.src).split("\n");
    lines.forEach((text, i) => {
      if (!text.includes("超时（")) return;
      out.push({ file: r.file, line: i + 1, text: text.trim(), hardcoded: /超时（\s*[0-9]/.test(text) });
    });
  }
  return out;
}

/** 现读整棵 `src/`（测试数据不落工作区：只读，不写）。 */
function readSrcTree(dir = "src", depth = 0): { file: string; src: string }[] {
  if (depth > 8) return [];
  const out: { file: string; src: string }[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...readSrcTree(p, depth + 1));
    else if (e.isFile() && e.name.endsWith(".ts")) out.push({ file: p, src: readFileSync(p, "utf8") });
  }
  return out;
}

const all = readSrcTree();

describe("墙钟数字的单一来源：超时文案不许自己再写一遍数字", () => {
  it("分母先要在场：这一族在 src 里至少四支（否则下面那条「0 命中」是尺没接上）", () => {
    const sites = timeoutSites(all);
    expect(sites.length).toBeGreaterThanOrEqual(4);
    // 逐支点名，防止分母被不相干的「超时（」凑数：这四支都是会进模型可见输出的
    const files = new Set(sites.map((s) => s.file));
    for (const f of ["src/agent/verify.ts", "src/tools/ripgrep.ts", "src/tools/run_shell.ts", "src/tools/glob.ts"]) {
      expect(files.has(f)).toBe(true);
    }
  });

  it("现读普查：没有任何一支把秒数写死在正文里", () => {
    const bad = timeoutSites(all).filter((s) => s.hardcoded);
    expect(bad.map((s) => s.file + ":" + String(s.line) + " " + s.text)).toEqual([]);
  });

  it("负控：写死的形状必须被读到（空名单不等于尺有分辨力）", () => {
    const sites = timeoutSites([
      { file: "synthetic.ts", src: 'const a = "[error: run_shell 超时（60s），已强制终止]";\nconst b = "[error: x 超时（" + String(ms / 1000) + "s）]";' },
    ]);
    expect(sites.length).toBe(2);
    expect(sites.filter((s) => s.hardcoded).map((s) => s.line)).toEqual([1]);
  });

  it("负控二：注释里的「超时（60s）」不算站点（剥注释要真剥）", () => {
    const sites = timeoutSites([{ file: "synthetic.ts", src: "// 超时（60s）强杀\n/* 超时（99s） */\ncode" }]);
    expect(sites).toEqual([]);
  });
});
