import { esc } from './dom.js';
import { parsePatchFiles } from './projections';

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
 *  就会一处改色一处不改（本仓的「同族只硬化一支」就是这么攒出来的）。
 *  opts.anchors：git 面板用的行锚点形态。行号与「评」按钮放在 `.ln` **外面**——
 *  下面的 highlightAllDiffs 会把 `.ln` 的 innerHTML 按 textContent 重写一遍，
 *  塞在里面就等于把按钮喂给 tokenizer 抹掉。删除行/文件头没有新文件侧行号 ⇒ 不给按钮
 *  （评论挂到一个不存在的行上，比不给入口更坏）。
 *  opts.comment === false：只给行号、不给入口——这一列的 worker 已收尾，评论它再也读不到。 */
export function diffHtml(text, opts = {}) {
  const src = String(text);
  if (!opts.anchors) {
    const lines = src.split('\n');
    let h = '<div class="diff">';
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      const c = ln.charAt(0);
      const cls = c === '+' ? 'add' : c === '-' ? 'del' : c === '@' ? 'hunk' : 'ctx';
      h += '<div class="ln ' + cls + '">' + esc(ln) + '</div>';
    }
    return h + '</div>';
  }
  let h = '<div class="diff diff-anchored">';
  for (const seg of parsePatchFiles(src)) {
    h += '<div class="pf">' + (seg.path ? esc(seg.path) : '(这份补丁没带文件名)') + '</div>';
    for (const l of seg.lines) {
      const c = l.text.charAt(0);
      const cls = c === '+' ? 'add' : c === '-' ? 'del' : c === '@' ? 'hunk' : 'ctx';
      const n = l.newLine;
      // opts.comment=false ⇒ 这一列已收尾（worker 读不到了）：给行号，但不给必然失败的入口
      const canCmt = n !== null && seg.path !== '' && opts.comment !== false;
      h += '<div class="ln-row"' + (canCmt ? ' data-line="' + String(n) + '" data-path="' + esc(seg.path) + '"' : '') + '>' +
        '<span class="lno">' + (n === null ? '' : String(n)) + '</span>' +
        '<div class="ln ' + cls + '">' + esc(l.text) + '</div>' +
        (canCmt
          ? '<button class="ln-cmt" type="button" data-cmt aria-controls="cmtPop" aria-haspopup="dialog" aria-expanded="false" title="评这一行">评</button>'
          : '') +
        '</div>';
    }
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
