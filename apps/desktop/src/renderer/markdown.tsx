// 自研 markdown 渲染器（spec ③「输出动效」的底座）。为什么自研：
//  ① 渲染层零新增依赖（打包纪律同源）；② assistant 正文此前是裸文本，是"不像产品"的最大单点；
//  ③ 流式安全：按已累计文本重解析，未闭合围栏按"开放代码块"渲染，不闪烁不跳变。
// 安全纪律：**没有 dangerouslySetInnerHTML**——全部走 React 文本节点转义；链接只放行 http(s)。
// 尺子纪律：正则一律 String.match/matchAll（第 408 页口径，消 RegExp.exec 撞名误报族）。
// 判卷面：parseBlocks 是纯函数（tests/markdown.test.ts）；渲染面由 render-structure.test.tsx 承接。
import { memo } from "react";
import { Ic } from "./components/icons";

export type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "code"; lang: string | null; content: string; open: boolean }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "quote"; text: string }
  | { type: "hr" }
  | { type: "table"; header: string[]; rows: string[][] }
  | { type: "p"; text: string };

const FENCE = /^\s*```(.*)$/;
const HEADING = /^ {0,3}(#{1,4})\s+(.+?)\s*#*\s*$/;
const HR = /^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;
const UL = /^ {0,3}[-*+]\s+(.+)$/;
const OL = /^ {0,3}\d{1,9}[.)]\s+(.+)$/;
const QUOTE = /^ {0,3}>\s?(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}[\s:|:-]*\|?\s*$/;

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
      blocks.push({ type: "p", text: para.join("\n") });
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
      while (i + 1 < lines.length) {
        const m = lines[i + 1]!.match(UL);
        if (m === null) break;
        items.push(m[1]!);
        i += 1;
      }
      blocks.push({ type: "ul", items });
      continue;
    }
    const ol = line.match(OL);
    if (ol !== null) {
      flushPara();
      const items: string[] = [ol[1]!];
      while (i + 1 < lines.length) {
        const m = lines[i + 1]!.match(OL);
        if (m === null) break;
        items.push(m[1]!);
        i += 1;
      }
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
const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(~~[^~\n]+~~)|(\*[^*\n]+\*)|(\[[^\]\n]+\]\(https?:\/\/[^)\s\n]+\))/g;

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

const CodeBlock = memo(function CodeBlock(props: { lang: string | null; content: string; onCopy?: (code: string) => void }) {
  return (
    <div className="md-code">
      <div className="md-code-head">
        <span className="lang">{props.lang ?? "text"}</span>
        <button
          type="button"
          className="md-copy"
          aria-label="复制代码"
          onClick={() => props.onCopy?.(props.content)}
        >
          <Ic.copy size={12} />
          <span>复制</span>
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
    case "table":
      return (
        <div className="md-table-wrap">
          <table className="md-table">
            <thead><tr>{b.header.map((h, i) => <th key={i}>{renderInline(h)}</th>)}</tr></thead>
            <tbody>{b.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{renderInline(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      );
    case "p":
      return <p className="md-p">{renderInline(b.text)}{caret}</p>;
  }
}

export const Markdown = memo(function Markdown(props: { text: string; onCopy?: (code: string) => void; caret?: boolean }) {
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
