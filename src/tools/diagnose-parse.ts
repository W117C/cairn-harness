// 结构化诊断解析层：把 lint / typecheck / test 的原始输出切成可逐条消费的清单（纯函数、零 I/O）。
//
// 判卷拿**真实输出样本**钉格式：本仓两处真跑——tsc 的 `path(line,col): error TSxxxx: msg`
// 与 vitest 的 ` FAIL  file > suite > name` ＋ ` ❯ file:line:col`（样本取自真跑日志，
// 见 tests/diagnose.test.ts 的注释）；另两种（eslint stylish 表体、gcc/ruff 一族的
// `path:line:col: [severity:] msg [RULE]`）是各自工具的公开稳定格式，按规范形状钉。
//
// 解析不出的行**不猜**：工具那侧如实说「没解析出来」并把原文尾部带上——编一条带假行号的结构化
// 条目比不结构化更坏（模型会照着不存在的行号去改，这正是本仓「假信号」族里最贵的鼓励方向）。

export interface DiagnosticEntry {
  file: string;
  line?: number;
  col?: number;
  severity: "error" | "warning";
  rule?: string;
  message: string;
}

export interface Diagnostics {
  /** 有界（默认前 40 条）：截断与否单独报，不许把「只列了 40 条」读成「一共 40 条」。 */
  entries: DiagnosticEntry[];
  /** 命中的总条数（不受截断影响）。 */
  total: number;
  truncated: boolean;
}

export const DIAGNOSTIC_ENTRY_CAP = 40;

/** A：tsc / msbuild —— `path(line,col): error TS2820: msg`。 */
const RE_TSC = /^(.+?)\((\d+),(\d+)\):\s*(error|warning)\s+(\S+):\s*(.+)$/;
/** B：gcc/clang/ruff/shellcheck 一族 —— `path:line:col: [severity:] msg [RULE]`。
 *  路径段必须行首非空白：缩进行（eslint 表体、代码引用块）不走这条。 */
const RE_UNIX = /^(\S.*?):(\d+):(\d+):\s*(.*)$/;
/** C：eslint stylish 表体 —— `  12:5  error  msg  rule`（rule 可缺）。 */
const RE_STYLE_ROW = /^\s+(\d+):(\d+)\s+(error|warning)\s+(.+?)(?:\s{2,}(\S+))?\s*$/;
/** D1：vitest 失败头 —— ` FAIL  file > suite > name`。 */
const RE_VITEST_FAIL = /^\s*FAIL\s+(.+)$/;
/** D2：vitest 位置行 —— ` ❯ file:line:col`（行尾锚定：汇总行 `❯ file (28 tests)` 不匹配）。 */
const RE_LOC = /^\s*❯\s+(\S+):(\d+):(\d+)\s*$/;

/** 像不像路径。防的是把消息文本里的 `xx:12:5:` 当文件——没有这个门槛，散文行会产出幽灵条目。 */
const looksLikePath = (p: string): boolean =>
  p.length <= 400 && (/[\\/]/.test(p) || /\.[A-Za-z0-9]{1,8}$/.test(p));

/** ANSI 转义（CSI `\u001b[...m` 与 OSC 超链接）——**真实输出默认带色**：本器第一版在
 *  M2 留档的真 vitest 日志上整块失明（` FAIL ` 前后裹着 `\u001b[41m\u001b[1m`，532 个 ESC，
 *  命中 0 条）。工具输出的颜色不是"环境问题"，是常态（TTY / FORCE_COLOR / 各家 reporter），
 *  所以剥离放在解析入口，一处生效。 */
const ANSI_CSI_RE = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const ANSI_OSC_RE = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;

export function parseDiagnostics(text: string, cap: number = DIAGNOSTIC_ENTRY_CAP): Diagnostics {
  const lines = text.replace(ANSI_CSI_RE, "").replace(ANSI_OSC_RE, "").split("\n");
  const entries: DiagnosticEntry[] = [];
  let total = 0;
  const push = (e: DiagnosticEntry): void => {
    total += 1;
    if (entries.length < cap) entries.push(e);
  };
  let styleFile: string | null = null; // eslint stylish 的当前文件头
  let pendingFail: DiagnosticEntry | null = null; // 最近一条 FAIL：位置行只补给文件对得上的它
  let failWatch = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";

    const mFail = RE_VITEST_FAIL.exec(line);
    if (mFail !== null) {
      const body = mFail[1]!.trim();
      const sep = body.indexOf(" > ");
      const file = (sep === -1 ? body : body.slice(0, sep)).trim();
      if (looksLikePath(file)) {
        const entry: DiagnosticEntry = {
          file,
          severity: "error",
          message: sep === -1 ? "(未给出用例名)" : body.slice(sep + 3).trim(),
        };
        push(entry);
        pendingFail = entry;
        failWatch = 30; // 真实 Failed-block 里位置行离 FAIL 可达 ~18 行（AssertionError 的 diff 撑开）；新 FAIL 会重置，不会串台
        styleFile = null;
        continue;
      }
    }
    if (failWatch > 0) {
      const mLoc = RE_LOC.exec(line);
      if (mLoc !== null) {
        if (pendingFail !== null && mLoc[1] === pendingFail.file) {
          pendingFail.line = Number(mLoc[2]);
          pendingFail.col = Number(mLoc[3]);
        }
        continue;
      }
      failWatch -= 1;
      if (failWatch === 0) pendingFail = null;
    }

    const mTsc = RE_TSC.exec(line);
    if (mTsc !== null && looksLikePath(mTsc[1]!)) {
      push({
        file: mTsc[1]!,
        line: Number(mTsc[2]),
        col: Number(mTsc[3]),
        severity: mTsc[4] as "error" | "warning",
        rule: mTsc[5],
        message: mTsc[6]!,
      });
      styleFile = null;
      continue;
    }

    const mUnix = RE_UNIX.exec(line);
    if (mUnix !== null && looksLikePath(mUnix[1]!)) {
      let rest = (mUnix[4] ?? "").trim();
      let severity: "error" | "warning" = "error"; // 无 severity 记号的格式（ruff 等）只在失败行上产条目 ⇒ 按 error
      const sev = /^(error|warning|note)\b:?\s*/i.exec(rest);
      if (sev !== null) {
        if (sev[1]!.toLowerCase() === "note") continue; // note 是补充说明（gcc 的候选提示等），不是可执行条目
        severity = sev[1]!.toLowerCase() as "error" | "warning";
        rest = rest.slice(sev[0].length);
      }
      let rule: string | undefined;
      const rb = /\[([^[\]]{1,60})\]\s*$/.exec(rest);
      if (rb !== null) {
        rule = rb[1];
        rest = rest.slice(0, rb.index).trim();
      }
      push({
        file: mUnix[1]!,
        line: Number(mUnix[2]),
        col: Number(mUnix[3]),
        severity,
        ...(rule !== undefined ? { rule } : {}),
        message: rest,
      });
      styleFile = null;
      continue;
    }

    const row = RE_STYLE_ROW.exec(line);
    if (row !== null && styleFile !== null) {
      push({
        file: styleFile,
        line: Number(row[1]),
        col: Number(row[2]),
        severity: row[3] as "error" | "warning",
        ...(row[5] !== undefined ? { rule: row[5] } : {}),
        message: row[4]!.trim(),
      });
      continue;
    }
    if (row === null) {
      if (styleFile !== null && line.trim() !== "" && !/^\s/.test(line)) styleFile = null;
      // C 的文件头 = 无缩进非空行 + 下一行是表体（只看一行前瞻，不做全块状态机）。
      if (line.trim() !== "" && !/^\s/.test(line) && i + 1 < lines.length && RE_STYLE_ROW.test(lines[i + 1] ?? "")) {
        styleFile = line.trim();
      }
    }
  }
  return { entries, total, truncated: total > entries.length };
}
