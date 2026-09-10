// M2e：SKILL.md / commands/*.md / agents/*.md 的 frontmatter 解析（CC 全量字段兼容面）。
// 只做 YAML 子集：key: value 标量、一层嵌套 map（metadata 等）、行内数组；解析失败返回空
// frontmatter + 保留原文（扩展内容是数据不是代码，永不因 frontmatter 缺陷炸加载器）。

export interface ParsedMarkdown {
  frontmatter: Record<string, unknown>;
  body: string;
}

function parseScalar(raw: string): unknown {
  const t = raw.trim();
  if (t === "" ) return "";
  if ((t.startsWith('"') && t.endsWith('"') && t.length >= 2) || (t.startsWith("'") && t.endsWith("'") && t.length >= 2)) {
    return t.slice(1, -1);
  }
  if (t === "true") return true;
  if (t === "false") return false;
  if (t === "null" || t === "~") return null;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (t.startsWith("[") && t.endsWith("]")) {
    const inner = t.slice(1, -1).trim();
    if (inner === "") return [];
    return inner.split(",").map((s) => String(parseScalar(s)));
  }
  return t; // description / allowed-tools 等保持字符串（CC 语义）
}

/** 解析 frontmatter（--- 包裹）；无 frontmatter 返回 { frontmatter: {}, body: 原文 }。 */
export function parseFrontmatter(text: string): ParsedMarkdown {
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---")) return { frontmatter: {}, body: normalized };
  const end = normalized.indexOf("\n---", 3);
  if (end < 0) return { frontmatter: {}, body: normalized };
  const rawFm = normalized.slice(3, end).replace(/^\n/, "");
  let body = normalized.slice(end + 4);
  if (body.startsWith("\n")) body = body.slice(1);
  const fm: Record<string, unknown> = {};
  // 一层嵌套：两空格缩进的行挂到最近父键下（CC metadata 等场景）
  let lastTop: string | null = null;
  for (const line of rawFm.split("\n")) {
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    const nested = /^\s{2,}([^:]+):\s?(.*)$/.exec(line);
    if (nested && lastTop !== null) {
      const cur = fm[lastTop];
      if (typeof cur === "object" && cur !== null && !Array.isArray(cur)) {
        (cur as Record<string, unknown>)[nested[1].trim()] = parseScalar(nested[2]);
      } else {
        const obj: Record<string, unknown> = {};
        obj[nested[1].trim()] = parseScalar(nested[2]);
        fm[lastTop] = obj;
      }
      continue;
    }
    const top = /^([^:\s][^:]*):\s?(.*)$/.exec(line);
    if (!top) continue;
    const key = top[1].trim();
    fm[key] = parseScalar(top[2]);
    lastTop = key;
  }
  return { frontmatter: fm, body };
}

/** frontmatter 里的 name/description 取值（缺省回退由调用方决定）。 */
export function fmString(fm: Record<string, unknown>, key: string): string | null {
  const v = fm[key];
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}
