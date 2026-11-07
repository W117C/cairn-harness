// read_doc（2026-11-06 业主「完善工具层」第二批）判卷面：
//  ① docx/xlsx：自建 zip 夹具（stored 成员，零依赖 zip 写入器 ~30 行）判真链路——
//     段落换行/制表/共享字符串/单元格值/行帽；
//  ② pdf：未压缩内容流夹具（Tj/TD/ET 操作符 + 转义 + 八进制），判文本层提取与行界；
//  ③ 阴性各说清：不是文档/zip 但非 Office/空文本层 pdf（扫描件）/加密 pdf/不存在/是目录。
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync, deflateSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { extractPdfText, read_doc } from "../src/tools/read_doc";
import { ToolError } from "../src/tools";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const ctx = (dir: string) => ({ workspace: dir });

/** 零依赖 zip 写入器：local header + 数据 + central directory + EOCD。 */
function makeZip(files: Record<string, string>, deflate = false, methodOverride?: number): Buffer {
  const nameOf = (s: string): Buffer => Buffer.from(s, "utf8");
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const plain = Buffer.from(content, "utf8");
    const data = deflate ? deflateRawSync(plain) : plain;
    const method = methodOverride ?? (deflate ? 8 : 0);
    const n = nameOf(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(plain.length, 22);
    local.writeUInt16LE(n.length, 26);
    localParts.push(local, n, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(plain.length, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, n);
    offset += local.length + n.length + data.length;
  }
  const cd = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, cd, eocd]);
}

describe("read_doc docx/xlsx", () => {
  it("docx：段落换行 + 制表 + 实体解码", async () => {
    const dir = await mkdtemp(join(tmpdir(), "read-doc-"));
    dirs.push(dir);
    const xml =
      "<?xml version=\"1.0\"?><w:document xmlns:w=\"x\"><w:body>" +
      "<w:p><w:r><w:t>第一段：A&amp;B</w:t><w:tab/><w:t>列二</w:t></w:r></w:p>" +
      "<w:p><w:r><w:t>第二段</w:t></w:r></w:p>" +
      "</w:body></w:document>";
    await writeFile(join(dir, "sample.docx"), makeZip({ "word/document.xml": xml }));
    const r = await read_doc.run({ path: "sample.docx" }, ctx(dir));
    expect(r.ok).toBe(true);
    expect(r.output).toContain("第一段：A&B\t列二");
    expect(r.output).toContain("第二段");
    expect(r.output).toContain("[read_doc] docx");
  });

  it("xlsx：共享字符串 + 数字单元格 + 首表 TSV", async () => {
    const dir = await mkdtemp(join(tmpdir(), "read-doc-"));
    dirs.push(dir);
    const shared = "<?xml version=\"1.0\"?><sst><si><t>名称</t></si><si><t>价格</t></si></sst>";
    const sheet =
      "<?xml version=\"1.0\"?><worksheet><sheetData>" +
      "<row><c t=\"s\"><v>0</v></c><c t=\"s\"><v>1</v></c></row>" +
      "<row><c t=\"s\"><v>0</v></c><c><v>42</v></c></row>" +
      "</sheetData></worksheet>";
    const workbook = "<?xml version=\"1.0\"?><workbook><sheets><sheet name=\"Sheet1\"/></sheets></workbook>";
    await writeFile(join(dir, "sample.xlsx"), makeZip({
      "xl/workbook.xml": workbook,
      "xl/worksheets/sheet1.xml": sheet,
      "xl/sharedStrings.xml": shared,
    }));
    const r = await read_doc.run({ path: "sample.xlsx" }, ctx(dir));
    expect(r.ok).toBe(true);
    expect(r.output).toContain("名称\t价格");
    expect(r.output).toContain("名称\t42");
    expect(r.output).toContain("[read_doc] xlsx");
  });

  it("zip 成员使用了不支持的压缩方式时点名", async () => {
    const dir = await mkdtemp(join(tmpdir(), "read-doc-"));
    dirs.push(dir);
    await writeFile(join(dir, "bad.zip"), makeZip({ "word/document.xml": "<x/>" }, false, 9));
    await expect(read_doc.run({ path: "bad.zip" }, ctx(dir))).rejects.toThrow(/不支持的压缩方式/);
  });

  it("按工作簿顺序读取首个标签，路径取其关系目标", async () => {
    const dir = await mkdtemp(join(tmpdir(), "read-doc-"));
    dirs.push(dir);
    const sheet = (value: string) => `<worksheet><sheetData><row><c t="inlineStr"><is><t>${value}</t></is></c></row></sheetData></worksheet>`;
    await writeFile(join(dir, "reordered.xlsx"), makeZip({
      "xl/workbook.xml": `<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name='First' r:id='rId2'/><sheet name='Second' r:id='rId1'/></sheets></workbook>`,
      "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/><Relationship Target="/xl/worksheets/sheet2.xml" Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/></Relationships>`,
      "xl/worksheets/sheet1.xml": sheet("second-tab-value"),
      "xl/worksheets/sheet2.xml": sheet("first-tab-value"),
    }));
    const result = await read_doc.run({ path: "reordered.xlsx" }, ctx(dir));
    expect(result.output).toContain("first-tab-value");
    expect(result.output).not.toContain("second-tab-value");
  });

  it("限制正文解压大小，同时跳过无关的压缩媒体", async () => {
    const dir = await mkdtemp(join(tmpdir(), "read-doc-"));
    dirs.push(dir);
    const large = "x".repeat(9 * 1024 * 1024);
    await writeFile(join(dir, "expanded.docx"), makeZip({ "word/document.xml": `<w:p>${large}</w:p>` }, true));
    await expect(read_doc.run({ path: "expanded.docx" }, ctx(dir))).rejects.toThrow(/解压.*上限/);
    await writeFile(join(dir, "media.docx"), makeZip({
      "word/document.xml": "<w:p>正文</w:p>",
      "word/media/image.bin": large,
    }, true));
    await expect(read_doc.run({ path: "media.docx" }, ctx(dir))).resolves.toMatchObject({
      ok: true, output: expect.stringContaining("正文"),
    });
  });

  it("行帽：>500 行截断出声", async () => {
    const dir = await mkdtemp(join(tmpdir(), "read-doc-"));
    dirs.push(dir);
    const rows = Array.from({ length: 501 }, (_, i) => `<row><c><v>${String(i)}</v></c></row>`).join("");
    const sheet = `<worksheet><sheetData>${rows}</sheetData></worksheet>`;
    const workbook = "<workbook/>";
    await writeFile(join(dir, "big.xlsx"), makeZip({
      "xl/workbook.xml": workbook,
      "xl/worksheets/sheet1.xml": sheet,
    }));
    const r = await read_doc.run({ path: "big.xlsx" }, ctx(dir));
    expect(r.output).toContain("行数超 500");
  });
});

describe("read_doc pdf", () => {
  it("限制累计解压大小，超限时给出明确错误", async () => {
    const dir = await mkdtemp(join(tmpdir(), "read-doc-"));
    dirs.push(dir);
    const content = deflateSync("BT (hello) Tj ET" + " ".repeat(6 * 1024 * 1024));
    const stream = Buffer.concat([
      Buffer.from(`<< /Length ${content.length} /Filter /FlateDecode >>\nstream\n`),
      content,
      Buffer.from("\nendstream\n"),
    ]);
    await writeFile(join(dir, "expanded.pdf"), Buffer.concat([Buffer.from("%PDF-1.4\n"), stream, stream, stream]));
    await expect(read_doc.run({ path: "expanded.pdf" }, ctx(dir))).rejects.toThrow(/解压.*上限/);
  });

  it("未压缩内容流：Tj 文本 + TD 行界 + 转义与八进制", async () => {
    const dir = await mkdtemp(join(tmpdir(), "read-doc-"));
    dirs.push(dir);
    // 内容流：两行文本；第一行含 \( \) 转义，第二行含八进制 \101（=A）。
    const content = "BT (first \\(paren\\) line) Tj TD (octal \\101 tail) Tj ET";
    const pdf = "%PDF-1.4\n1 0 obj\n<< /Length " + String(content.length) + " >>\nstream\n" + content + "\nendstream\nendobj\n%%EOF";
    await writeFile(join(dir, "sample.pdf"), pdf, "latin1");
    const r = await read_doc.run({ path: "sample.pdf" }, ctx(dir));
    expect(r.ok).toBe(true);
    expect(r.output).toContain("first (paren) line");
    expect(r.output).toContain("octal A tail");
  });

  it("扫描件（无文本层）明说；加密 pdf 拒；不是文档拒", async () => {
    const dir = await mkdtemp(join(tmpdir(), "read-doc-"));
    dirs.push(dir);
    const imageOnly = "%PDF-1.4\n1 0 obj\n<< /Length 8 >>\nstream\nrawbytes\nendstream\nendobj\n%%EOF";
    await writeFile(join(dir, "scan.pdf"), imageOnly, "latin1");
    const scan = await read_doc.run({ path: "scan.pdf" }, ctx(dir));
    expect(scan.ok).toBe(false);
    expect(scan.output).toContain("没有可提取的文本层");
    await writeFile(join(dir, "locked.pdf"), "%PDF-1.4\n/Encrypt\n%%EOF", "latin1");
    await expect(read_doc.run({ path: "locked.pdf" }, ctx(dir))).rejects.toThrow(/加密 PDF/);
    // 证人钉到函数本体：「先解除加密再读」这句可行动出口住在 extractPdfText 的入口闸
    // （2026-11-07 承诺清单账，台账第 1040 页）。
    expect(() => extractPdfText(Buffer.from("%PDF-1.4\n/Encrypt\n%%EOF", "latin1"))).toThrow(/先解除加密再读/);
    await writeFile(join(dir, "notes.txt"), "plain");
    await expect(read_doc.run({ path: "notes.txt" }, ctx(dir))).rejects.toBeInstanceOf(ToolError);
  });
});

describe("read_doc 边界", () => {
  it("缺 path/文件不存在/是目录，各有可行动文案", async () => {
    const dir = await mkdtemp(join(tmpdir(), "read-doc-"));
    dirs.push(dir);
    await expect(read_doc.run({}, ctx(dir))).rejects.toThrow(/path 参数必须是非空字符串/);
    await expect(read_doc.run({ path: "nope.pdf" }, ctx(dir))).rejects.toThrow(/文件不存在/);
    await mkdir(join(dir, "sub"));
    await expect(read_doc.run({ path: "sub" }, ctx(dir))).rejects.toThrow(/是目录不是文件/);
    // zip 但非 Office：明说支持面
    await writeFile(join(dir, "archive.zip"), makeZip({ "readme.txt": "hello" }));
    await expect(read_doc.run({ path: "archive.zip" }, ctx(dir))).rejects.toThrow(/不是 docx\/xlsx/);
  });
});
