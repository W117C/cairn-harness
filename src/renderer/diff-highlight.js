import { esc } from './dom.js';

/* ============ diff 内置轻量 tokenizer（TS 为主，无外部依赖） ============
   按优先级分组匹配：注释 > 字符串 > 关键字 > 数字 > 函数调用 > 属性访问。
   只对 .diff .ln 生效，行首的 +/- 前缀与缩进原样保留 */
const TS_TOKENS =
  /(\/\/.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|((?:\b(?:abstract|as|async|await|break|case|catch|class|const|continue|declare|default|delete|do|else|enum|export|extends|false|finally|for|from|function|get|if|implements|import|in|instanceof|interface|keyof|let|namespace|new|null|of|private|protected|public|readonly|return|satisfies|set|static|super|switch|this|throw|true|try|type|typeof|undefined|var|void|while)\b))|((?:\b(?:0[xXbBoO][\da-fA-F_]+|\d+(?:\.\d+)?)\b))|((?:\b[a-zA-Z_$][\w$]*(?=\s*\()))|((?:\.\b[a-zA-Z_$][\w$]*\b))/g;
const TK_CLASS = ['', 'tk-com', 'tk-str', 'tk-kw', 'tk-num', 'tk-fn', 'tk-prop'];

function highlightDiffLine(line) {
  /* 行首 [空格][-+|! 前缀][空格] 原样保留，只对代码部分做 token */
  const preM = line.match(/^(\s*[-+!]?\s*)/);
  const pre = preM ? preM[1] : '';
  if (pre) line = line.slice(pre.length);
  let html = pre, last = 0;
  TS_TOKENS.lastIndex = 0;
  let m;
  while ((m = TS_TOKENS.exec(line))) {
    html += esc(line.slice(last, m.index));
    let cls = '';
    for (let g = 1; g <= 6; g++) if (m[g] !== undefined) { cls = TK_CLASS[g]; break; }
    html += cls === 'tk-com'
      ? '<span class="tk-com">' + esc(m[0]) + '</span>'   // 行注释吞到行尾
      : cls
        ? '<span class="' + cls + '">' + esc(m[0]) + '</span>'
        : esc(m[0]);
    if (cls === 'tk-com') { last = line.length; break; }
    last = m.index + m[0].length;
  }
  html += esc(line.slice(last));
  return html;
}

/** 文本 → `.diff` 行结构（按 +/-/@ 前缀着色）。
 *  唯一实现：消息流的工具输出与 git 面板的 worker 补丁都走这里——两处各写一份
 *  就会一处改色一处不改（本仓的「同族只硬化一支」就是这么攒出来的）。 */
export function diffHtml(text) {
  const lines = String(text).split('\n');
  let h = '<div class="diff">';
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const c = ln.charAt(0);
    const cls = c === '+' ? 'add' : c === '-' ? 'del' : c === '@' ? 'hunk' : 'ctx';
    h += '<div class="ln ' + cls + '">' + esc(ln) + '</div>';
  }
  return h + '</div>';
}

export function highlightAllDiffs(root) {
  const rows = (root || document).querySelectorAll('.diff .ln:not(.hunk)');
  rows.forEach(row => {
    if (row.dataset.tokenized) return;
    row.innerHTML = highlightDiffLine(row.textContent);
    row.dataset.tokenized = '1';
  });
}
