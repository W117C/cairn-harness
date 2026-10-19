// 自研 markdown 渲染器（spec ③「输出动效」的底座）。为什么自研：
//  ① 渲染层零新增依赖（打包纪律同源）；② assistant 正文此前是裸文本，是"不像产品"的最大单点；
//  ③ 流式安全：按已累计文本重解析，未闭合围栏按"开放代码块"渲染，不闪烁不跳变。
// 安全纪律：**没有 dangerouslySetInnerHTML**——全部走 React 文本节点转义；链接只放行 http(s)。
// 尺子纪律：正则一律 String.match/matchAll（第 408 页口径，消 RegExp.exec 撞名误报族）。
// 判卷面：parseBlocks 是纯函数（tests/markdown.test.ts）；渲染面由 render-structure.test.tsx 承接。
import { Fragment, memo, useEffect, useRef, useState } from "react";
import { Check, Copy, Image as ImageIcon } from "lucide-react";
import { STR } from "./strings";

export type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "code"; lang: string | null; content: string; open: boolean }
  | { type: "ul"; items: string[] }
  | { type: "tasklist"; items: { done: boolean; text: string }[] }
  | { type: "ol"; items: string[] }
  | { type: "quote"; text: string }
  | { type: "hr" }
  | { type: "table"; header: string[]; rows: string[][] }
  | { type: "image"; alt: string; src: string }
  | { type: "p"; text: string };

const FENCE = /^\s*```(.*)$/;
const HEADING = /^ {0,3}(#{1,4})\s+(.+?)\s*#*\s*$/;
const HR = /^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;
const UL = /^ {0,3}[-*+]\s+(.+)$/;
const OL = /^ {0,3}\d{1,9}[.)]\s+(.+)$/;
const QUOTE = /^ {0,3}>\s?(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}[\s:|:-]*\|?\s*$/;
// 独行图片（2026-10-18）：`![alt](src)` 单独成块；只放行 **https** 与 data:image——CSP 的
// img-src 只许 https 图源，http 图就算画个门闩、点了也加载不出来；http 让它回落成普通段落，
// 由裸 URL 自动链接兜住（点击走系统浏览器）。javascript:/file: 等同理回落，不静默丢字。
const IMAGE = /^\s*!\[([^\]\n]*)\]\(([^)\s]+)\)\s*$/;
const SAFE_IMG = /^(https:\/\/|data:image\/)/i;

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

/** 行 → 块的解析（唯一入口；流式与终稿走同一函数，行为一致）。 */
export function parseBlocks(src: string): Block[] {
  const lines = src.split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  const flushPara = () => {
    if (para.length > 0) {
      // 整行加粗自成段落 ⇒ 小节标题（阶段 2 · brief §二.3「我的判断 / 局限」形态：
      // 模型常用一行 **加粗** 当节标题。渲染面 h4 承接 secondary·13·600·上留 20px 样式；
      // 加粗后紧跟正文（同段落多行）不误判——只有"独行"才算节标题）。
      const single = para.length === 1 ? para[0]!.match(/^\*\*([^*\n]+)\*\*$/) : null;
      if (single !== null) blocks.push({ type: "heading", level: 4, text: single[1]! });
      else blocks.push({ type: "p", text: para.join("\n") });
      para = [];
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = line.match(FENCE);
    if (fence !== null) {
      flushPara();
      const lang = fence[1]!.trim();
      const body: string[] = [];
      let open = true;
      let j = i + 1;
      for (; j < lines.length; j++) {
        if (/^\s*```\s*$/.test(lines[j]!)) { open = false; break; }
        body.push(lines[j]!);
      }
      // 未闭合（流式中）必须吞到 EOF：i 若停在原地，围栏体会在下一轮被当段落**再渲染一遍**。
      i = open ? lines.length : j;
      blocks.push({ type: "code", lang: lang !== "" ? lang : null, content: body.join("\n"), open });
      continue;
    }
    const heading = line.match(HEADING);
    if (heading !== null) {
      flushPara();
      blocks.push({ type: "heading", level: heading[1]!.length, text: heading[2]! });
      continue;
    }
    if (HR.test(line)) { flushPara(); blocks.push({ type: "hr" }); continue; }
    const img = line.match(IMAGE);
    if (img !== null) {
      flushPara();
      if (SAFE_IMG.test(img[2]!)) {
        blocks.push({ type: "image", alt: img[1]!, src: img[2]! });
      } else {
        // 不能内嵌的图（http / javascript: 等）：去掉图片语法的 `!`，回落成普通链接——
        // 否则用户会看到「![明文](http://…)」或一个孤零零的 `!` + 链接。
        blocks.push({ type: "p", text: line.trim().replace(/^!/, "") });
      }
      continue;
    }
    const quote = line.match(QUOTE);
    if (quote !== null) {
      flushPara();
      const body: string[] = [quote[1]!];
      while (i + 1 < lines.length) {
        const m = lines[i + 1]!.match(QUOTE);
        if (m === null) break;
        body.push(m[1]!);
        i += 1;
      }
      blocks.push({ type: "quote", text: body.join("\n") });
      continue;
    }
    // 表格：本行含 | 且下一行是分隔行（:--- 形态）。两行都不够格就不当表格（宁缺不编）。
    if (line.includes("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]!)) {
      const header = splitRow(line);
      if (header.length >= 2) {
        flushPara();
        const rows: string[][] = [];
        let j = i + 2;
        while (j < lines.length && lines[j]!.includes("|") && !FENCE.test(lines[j]!)) {
          rows.push(splitRow(lines[j]!));
          j += 1;
        }
        i = j - 1;
        blocks.push({ type: "table", header, rows });
        continue;
      }
    }
    const ul = line.match(UL);
    if (ul !== null) {
      flushPara();
      const items: string[] = [ul[1]!];
      // 空行桥接（阶段 2 · 业主截图批）：模型常把列表项隔空行写——跳空行后仍是同型列表行
      // ⇒ 并入同一列表（否则每条各成独立的单元素列表）。
      let j = i + 1;
      while (j < lines.length) {
        const m = lines[j]!.match(UL);
        if (m !== null) { items.push(m[1]!); j += 1; continue; }
        if (lines[j]!.trim() !== "") break;
        let k = j;
        while (k < lines.length && lines[k]!.trim() === "") k += 1;
        if (k < lines.length && UL.test(lines[k]!)) { j = k; continue; }
        break;
      }
      i = j - 1;
      // 任务清单（2026-10-18）：整段列表项都是 `[ ]`/`[x]` 才算 tasklist；混排保持普通列表，
      // 不把用户“写了个方括号”的普通条目擅自改成勾选框。
      const tasks = items.map((it) => it.match(/^\[([ xX])\]\s+(\S.*)$/));
      if (tasks.every((m) => m !== null)) {
        blocks.push({ type: "tasklist", items: tasks.map((m) => ({ done: m![1]!.toLowerCase() === "x", text: m![2]! })) });
      } else {
        blocks.push({ type: "ul", items });
      }
      continue;
    }
    const ol = line.match(OL);
    if (ol !== null) {
      flushPara();
      // 有序列表同 UL 桥接。**序号修复的根髓**：条目隔空行时不再各成单元素 <ol>（全部显示 1.），
      // 并入同一列表后序号随 DOM 递增 ⇒ 1. 2. 3. 天然递增。
      const items: string[] = [ol[1]!];
      let j = i + 1;
      while (j < lines.length) {
        const m = lines[j]!.match(OL);
        if (m !== null) { items.push(m[1]!); j += 1; continue; }
        if (lines[j]!.trim() !== "") break;
        let k = j;
        while (k < lines.length && lines[k]!.trim() === "") k += 1;
        if (k < lines.length && OL.test(lines[k]!)) { j = k; continue; }
        break;
      }
      i = j - 1;
      blocks.push({ type: "ol", items });
      continue;
    }
    if (line.trim() === "") { flushPara(); continue; }
    para.push(line);
  }
  flushPara();
  return blocks;
}

// ---- 行内（code / bold / del / em / link；链接只放行 http(s)，其余当纯文本） ----
const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(~~[^~\n]+~~)|(\*[^*\n]+\*)|(\[[^\]\n]+\]\(https?:\/\/[^)\s\n]+\))|(https?:\/\/[^\s<>"'`]+)/g;

/** 裸 URL 尾部的标点不属于地址（中英文都剥）：`https://a.com/x。` / `…,` 之类。 */
const URL_TAIL = /[.,;:!?。，、；：！？)】》」』]+$/;

export function renderInline(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(INLINE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(text.slice(last, idx));
    const tok = m[0];
    if (tok.startsWith("`")) out.push(<code key={key++} className="md-icode">{tok.slice(1, -1)}</code>);
    else if (tok.startsWith("**")) out.push(<strong key={key++}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("~~")) out.push(<del key={key++}>{tok.slice(2, -2)}</del>);
    else if (tok.startsWith("*")) out.push(<em key={key++}>{tok.slice(1, -1)}</em>);
    else if (tok.startsWith("http")) {
      // 裸 URL（2026-10-18）：模型常直接贴地址；尾部标点留给正文，不进 href。
      const url = tok.replace(URL_TAIL, "");
      const tail = tok.slice(url.length);
      out.push(<a key={key++} href={url} target="_blank" rel="noreferrer">{url}</a>);
      if (tail !== "") out.push(tail);
    }
    else {
      const cut = tok.indexOf("](");
      const label = tok.slice(1, cut);
      const href = tok.slice(cut + 2, -1);
      out.push(<a key={key++} href={href} target="_blank" rel="noreferrer">{label}</a>);
    }
    last = idx + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// ---- 渲染 ----

/** 外部图片门（2026-10-18）：http(s) 图片默认**不发请求**——模型在正文里贴一个远程地址
 *  不应导致打开会话就向对方服务器暴露 IP。data:image 无网络出口，直接渲染。
 *  点击门闩后才创建 img（此时才发起请求）；失败面是浏览器的破图，不额外造错误。 */
function MarkdownImage(props: { alt: string; src: string }): React.JSX.Element {
  const [show, setShow] = useState(() => props.src.startsWith("data:image/"));
  let host = "";
  try { host = new URL(props.src).host; } catch { /* 非标准 URL：不显示主机 */ }
  return (
    <figure className="md-figure">
      {show ? (
        <img src={props.src} alt={props.alt} loading="lazy" referrerPolicy="no-referrer" />
      ) : (
        <button
          type="button"
          className="md-img-gate"
          title={STR.markdown.imageGateTip.replace("{host}", host)}
          aria-label={STR.markdown.imageGate}
          onClick={() => { setShow(true); }}
        >
          <ImageIcon size={12} />
          <span>{STR.markdown.imageGate}</span>
          {host !== "" && <span className="md-img-host">{host}</span>}
        </button>
      )}
    </figure>
  );
}

const CodeBlock = memo(function CodeBlock(props: { lang: string | null; content: string; onCopy?: (code: string) => Promise<boolean> | boolean | void }) {
  // 就地反馈（2026-10-18）：复制后只有远处 toast，按钮本身毫无变化——用户不确定点没点中。
  // 成功态 1.2s 后自还原；onCopy 缺席时不假装成功。
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);
  const flash = (): void => {
    setCopied(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1200);
  };
  const copy = (): void => {
    if (props.onCopy === undefined) return;
    // 2026-10-18：onCopy 可回报 Promise<boolean>（App 的剪贴板写入就是）；失败不亮「已复制」，
    // 失败面由 handler 自己上屏（error strip / toast）。void/true 的旧调用保持原语义。
    const r = props.onCopy(props.content);
    if (r instanceof Promise) {
      void r.then((ok) => { if (ok !== false) flash(); }, () => undefined);
      return;
    }
    if (r !== false) flash();
  };
  return (
    <div className="md-code">
      <div className="md-code-head">
        <span className="lang">{props.lang ?? "text"}</span>
        <button
          type="button"
          className="md-copy"
          aria-label={copied ? "已复制代码" : "复制代码"}
          onClick={copy}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          <span>{copied ? "已复制" : "复制"}</span>
        </button>
      </div>
      <pre><code>{props.content}</code></pre>
    </div>
  );
});

/** 流式追字光标（原型同款语义：跟在正文末尾行内，不是独立一行）。
 *  只往"能写字"的块里放（p/标题/引用/列表末项）；代码块、表格收尾时不放（写了也怪）。 */
function Caret() {
  return <span className="cursor" aria-hidden="true" />;
}

function BlockView(props: { block: Block; onCopy?: (code: string) => void; caret?: boolean }) {
  const b = props.block;
  const caret = props.caret === true ? <Caret /> : null;
  switch (b.type) {
    case "heading": {
      const Tag = (b.level === 1 ? "h1" : b.level === 2 ? "h2" : b.level === 3 ? "h3" : "h4") as "h1";
      return <Tag className={`md-h md-h${String(b.level)}`}>{renderInline(b.text)}{caret}</Tag>;
    }
    case "code":
      return <CodeBlock lang={b.lang} content={b.content} {...(props.onCopy !== undefined ? { onCopy: props.onCopy } : {})} />;
    case "tasklist":
      return (
        <ul className="md-tasks">
          {b.items.map((it, i) => (
            <li key={i} className={it.done ? "done" : undefined}>
              <span className="md-task-box" data-done={it.done} aria-hidden="true">{it.done ? <Check size={9} /> : null}</span>
              <span>{renderInline(it.text)}</span>
            </li>
          ))}
        </ul>
      );
    case "ul":
      return (
        <ul className="md-ul">
          {b.items.map((it, i) => (
            <li key={i}>{renderInline(it)}{caret !== null && i === b.items.length - 1 ? caret : null}</li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol className="md-ol">
          {b.items.map((it, i) => (
            <li key={i}>{renderInline(it)}{caret !== null && i === b.items.length - 1 ? caret : null}</li>
          ))}
        </ol>
      );
    case "quote":
      return <blockquote className="md-quote">{renderInline(b.text)}{caret}</blockquote>;
    case "hr":
      return <hr className="md-hr" />;
    case "image":
      return <MarkdownImage alt={b.alt} src={b.src} />;
    case "table":
      return (
        <div className="md-table-wrap">
          <table className="md-table">
            <thead><tr>{b.header.map((h, i) => <th key={i}>{renderInline(h)}</th>)}</tr></thead>
            <tbody>{b.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{renderInline(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      );
    case "p": {
      // 行内换行保留（2026-10-15 第十二遍，业主实测 18.06.40）：parse 层一直保留 \n（判卷钉
      // 「段落按空行聚合；行内换行保留」），但渲染曾把它折成空格——模型按「不要代码围栏」直吐
      // 的整份 HTML/SVG 因此糊成一大坨。逐行渲染、行间 <br/>，把换行如实还给读者。
      const lines = b.text.split("\n");
      return (
        <p className="md-p">
          {lines.map((ln, i) => (
            <Fragment key={i}>
              {i > 0 && <br />}
              {renderInline(ln)}
            </Fragment>
          ))}
          {caret}
        </p>
      );
    }
  }
}

export const Markdown = memo(function Markdown(props: { text: string; onCopy?: (code: string) => Promise<boolean> | boolean | void; caret?: boolean }) {
  const blocks = parseBlocks(props.text);
  const last = blocks.length - 1;
  return (
    <div className="md-body">
      {blocks.map((b, i) => (
        <BlockView key={i} block={b}
          {...(props.onCopy !== undefined ? { onCopy: props.onCopy } : {})}
          {...(props.caret === true && i === last ? { caret: true } : {})}
        />
      ))}
    </div>
  );
});
