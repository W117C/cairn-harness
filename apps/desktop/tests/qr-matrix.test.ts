// 扫码登录的二维码矩阵判卷（2026-11-18 · v81 通道线）。
//
// iLink 回的是待编码文本（weixin://qr/…）而不是图片，所以码要在本地画。这台实现是
// 零依赖的 ISO/IEC 18004 小编码器——判卷钉三件事：
//   ① 版本选择与尺寸按容量表走（超长如实抛错，不静默降级）；
//   ② 金标矩阵逐格钉死（真机验证过：矩阵交给解码器能还原原文）；
//   ③ 结构位（三角定位、时序、固定深色模块）在位，路径方块数 = 深色模块数。
import { describe, expect, it } from "vitest";
import { qrMatrix, qrPath } from "../src/renderer/derived/qr-matrix";

/** 金标：`weixin://qr/abc`（v2 / mask 2）。这份矩阵由解码器（jsQR）回读验证过原文一致。 */
const GOLDEN = [
  "#######...#.####..#######",
  "#.....#..##.#####.#.....#",
  "#.###.#.#....#.#..#.###.#",
  "#.###.#.#.###.##..#.###.#",
  "#.###.#.#......##.#.###.#",
  "#.....#.#.###.....#.....#",
  "#######.#.#.#.#.#.#######",
  "........#.#...#.#........",
  "#.#####..#.#......#####..",
  "###.#..#########.#.#.##..",
  "..#.#.##...######.###..##",
  "###....###.###...####..##",
  "..#.#.##.####.##.##.#.###",
  "##.....#..#.....##...##..",
  "#.######...##..#..####.##",
  "#..##...#.##..#....##..#.",
  "#.....##..##...##########",
  "........##..#####...####.",
  "#######..##..##.#.#.#..##",
  "#.....#.#.#.##..#...#..#.",
  "#.###.#.#...#.##########.",
  "#.###.#.#.........#.#.#.#",
  "#.###.#.#.###..#.....##.#",
  "#.....#...##..####..##..#",
  "#######.##.#.....#..#.###",
];

const rowsOf = (text: string): string[] =>
  qrMatrix(text).modules.map((row) => row.map((dark) => (dark ? "#" : ".")).join(""));

describe("二维码矩阵", () => {
  it("版本按容量表选：短载荷 v1、登录文本 v2、200 字节 v10", () => {
    expect(qrMatrix("A")).toMatchObject({ version: 1, size: 21 });
    expect(qrMatrix("weixin://qr/abc")).toMatchObject({ version: 2, size: 25 });
    const big = qrMatrix("x".repeat(200));
    expect(big).toMatchObject({ version: 10, size: 57 });
    // 超出版本 1–10 / M 档容量：如实抛错，不静默截断。
    expect(() => qrMatrix("x".repeat(300))).toThrow(/太长/);
  });

  it("金标矩阵逐格一致（原文经解码器回读验证）", () => {
    const matrix = qrMatrix("weixin://qr/abc");
    expect(rowsOf("weixin://qr/abc")).toEqual(GOLDEN);
    expect(matrix.mask).toBe(2);
    expect(matrix.modules.flat().filter(Boolean)).toHaveLength(330);
  });

  it("结构位在位：三角定位、时序线、固定深色模块", () => {
    const { modules, size } = qrMatrix("weixin://qr/abc");
    // 三个 7×7 定位角。
    for (const [row, col] of [[0, 0], [0, size - 7], [size - 7, 0]] as const) {
      for (let r = 0; r < 7; r += 1) {
        for (let c = 0; c < 7; c += 1) {
          const border = r === 0 || r === 6 || c === 0 || c === 6;
          const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
          expect(modules[row + r][col + c], `定位角 ${row},${col} 的 ${r},${c}`).toBe(border || core);
        }
      }
    }
    // 时序线（第 6 行/列）深浅交替。
    for (let i = 8; i < size - 8; i += 1) {
      expect(modules[6][i]).toBe(i % 2 === 0);
      expect(modules[i][6]).toBe(i % 2 === 0);
    }
    // 固定深色模块。
    expect(modules[size - 8][8]).toBe(true);
  });

  it("qrPath 的方块数 = 深色模块数（不漏格不多格）", () => {
    const matrix = qrMatrix("微信扫码登录测试 · Cairn");
    const squares = (qrPath(matrix).match(/M\d+ \d+h1v1h-1z/g) ?? []).length;
    expect(squares).toBe(matrix.modules.flat().filter(Boolean).length);
  });
});
