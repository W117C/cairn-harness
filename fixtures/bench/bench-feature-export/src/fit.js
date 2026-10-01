// 把一段文本按最大宽度折行。词之间在空格处断，长词不拆。
export function wrap(text, maxWidth) {
  const out = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line === "") line = word;
    else if (line.length + 1 + word.length <= maxWidth) line += " " + word;
    else { out.push(line); line = word; }
  }
  if (line !== "") out.push(line);
  return out;
}
