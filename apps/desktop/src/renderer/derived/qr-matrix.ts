// 二维码矩阵（byte 模式 · 纠错 M · 版本 1–10）——扫码登录面板自绘用。
//
// 为什么自己算：iLink 的 get_bot_qrcode 回的是**待编码文本**（weixin://qr/…），不是图片；
// 渲染层也没有二维码依赖。为一张码引第三方包不划算，这里按 ISO/IEC 18004 写一个
// 零依赖小实现：RS 纠错 + 8 种掩码择优 + 格式/版本信息，输出布尔矩阵交给 SVG。
//
// 范围如实：只做 byte 模式与 M 档、版本 1–10（足够 200 字节以内的登录载荷）；
// 超长直接抛错，不静默降级。

/** 纠错档 M 的 RS 分块表（版本 1–10）：[每块纠错码字, 组1块数, 组1数据码字, 组2块数, 组2数据码字]。 */
const RS_BLOCKS_M: readonly (readonly [number, number, number, number, number])[] = [
  [10, 1, 16, 0, 0], // v1
  [16, 1, 28, 0, 0], // v2
  [26, 1, 44, 0, 0], // v3
  [18, 2, 32, 0, 0], // v4
  [24, 2, 43, 0, 0], // v5
  [16, 4, 27, 0, 0], // v6
  [18, 4, 31, 0, 0], // v7
  [22, 2, 38, 2, 39], // v8
  [22, 3, 36, 2, 37], // v9
  [26, 4, 43, 1, 44], // v10
];

/** 对齐图形中心坐标（版本 1–10；v1 没有）。 */
const ALIGN_POSITIONS: readonly (readonly number[])[] = [
  [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
];

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if ((x & 0x100) !== 0) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) GF_EXP[i] = GF_EXP[i - 255];
}

const gfMul = (a: number, b: number): number => (a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]]);

/** 生成多项式 ∏(x - α^i)（GF(2) 上减法即加法），返回长度 n+1、首项为 1 的系数表。 */
function rsGenerator(n: number): number[] {
  let poly = [1];
  for (let i = 0; i < n; i += 1) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], GF_EXP[i]);
    }
    poly = next;
  }
  return poly;
}

/** RS 纠错码字（多项式除法取余）。 */
function rsEcc(data: readonly number[], ecLen: number): number[] {
  const gen = rsGenerator(ecLen);
  const buf = [...data, ...new Array<number>(ecLen).fill(0)];
  for (let i = 0; i < data.length; i += 1) {
    const coef = buf[i];
    if (coef === 0) continue;
    for (let j = 0; j < gen.length; j += 1) buf[i + j] ^= gfMul(gen[j], coef);
  }
  return buf.slice(data.length);
}

/** 字节流 → 数据码字（模式 0100 + 长度 + 载荷 + 终止符 + 填充）。 */
function dataCodewords(bytes: readonly number[], version: number, capacity: number): number[] {
  const bits: number[] = [];
  const push = (value: number, width: number): void => {
    for (let i = width - 1; i >= 0; i -= 1) bits.push((value >> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, version < 10 ? 8 : 16);
  for (const byte of bytes) push(byte, 8);
  const capacityBits = capacity * 8;
  for (let i = 0; i < 4 && bits.length < capacityBits; i += 1) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  const words: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let word = 0;
    for (let j = 0; j < 8; j += 1) word = (word << 1) | bits[i + j];
    words.push(word);
  }
  for (let pad = 0; words.length < capacity; pad += 1) words.push(pad % 2 === 0 ? 0xec : 0x11);
  return words;
}

export interface QrMatrix {
  /** 边长（模块数）。 */
  size: number;
  version: number;
  mask: number;
  /** modules[row][col]；true = 深色。 */
  modules: boolean[][];
}

const MASKS: readonly ((row: number, col: number) => boolean)[] = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

/** 候选矩阵的罚分（ISO/IEC 18004 §8.8.2 四条规则）。 */
function penalty(matrix: readonly boolean[][]): number {
  const size = matrix.length;
  let score = 0;
  const scoreRun = (run: number): void => {
    if (run >= 5) score += 3 + (run - 5);
  };
  for (let i = 0; i < size; i += 1) {
    let rowColor = matrix[i][0];
    let rowRun = 1;
    let colColor = matrix[0][i];
    let colRun = 1;
    for (let j = 1; j < size; j += 1) {
      if (matrix[i][j] === rowColor) rowRun += 1;
      else { scoreRun(rowRun); rowColor = matrix[i][j]; rowRun = 1; }
      if (matrix[j][i] === colColor) colRun += 1;
      else { scoreRun(colRun); colColor = matrix[j][i]; colRun = 1; }
    }
    scoreRun(rowRun);
    scoreRun(colRun);
  }
  for (let r = 0; r < size - 1; r += 1) {
    for (let c = 0; c < size - 1; c += 1) {
      const value = matrix[r][c];
      if (value === matrix[r][c + 1] && value === matrix[r + 1][c] && value === matrix[r + 1][c + 1]) score += 3;
    }
  }
  const patternA = [true, false, true, true, true, false, true, false, false, false, false];
  const patternB = [false, false, false, false, true, false, true, true, true, false, true];
  const hit = (cells: readonly boolean[]): boolean => {
    let a = true;
    let b = true;
    for (let i = 0; i < 11; i += 1) {
      if (cells[i] !== patternA[i]) a = false;
      if (cells[i] !== patternB[i]) b = false;
    }
    return a || b;
  };
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c + 11 <= size; c += 1) {
      const row: boolean[] = [];
      const col: boolean[] = [];
      for (let k = 0; k < 11; k += 1) { row.push(matrix[r][c + k]); col.push(matrix[c + k][r]); }
      if (hit(row)) score += 40;
      if (hit(col)) score += 40;
    }
  }
  let dark = 0;
  for (const row of matrix) for (const cell of row) if (cell) dark += 1;
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;
  return score;
}

/** 文本 → 二维码矩阵。超出版本 1–10 / M 档容量时抛错（不静默降级）。 */
export function qrMatrix(text: string): QrMatrix {
  const bytes = [...new TextEncoder().encode(text)];
  let version = 0;
  for (let v = 1; v <= 10; v += 1) {
    const [ecLen, g1, g1Data, g2, g2Data] = RS_BLOCKS_M[v - 1];
    const capacity = g1 * g1Data + g2 * g2Data;
    void ecLen;
    if (4 + (v < 10 ? 8 : 16) + bytes.length * 8 <= capacity * 8) { version = v; break; }
  }
  if (version === 0) throw new Error("二维码载荷太长（只支持版本 1–10 / 纠错 M）");
  const [ecLen, g1, g1Data, g2, g2Data] = RS_BLOCKS_M[version - 1];
  const capacity = g1 * g1Data + g2 * g2Data;
  const words = dataCodewords(bytes, version, capacity);
  const blocks: { data: number[]; ec: number[] }[] = [];
  let offset = 0;
  for (let i = 0; i < g1; i += 1) {
    const data = words.slice(offset, offset + g1Data);
    offset += g1Data;
    blocks.push({ data, ec: rsEcc(data, ecLen) });
  }
  for (let i = 0; i < g2; i += 1) {
    const data = words.slice(offset, offset + g2Data);
    offset += g2Data;
    blocks.push({ data, ec: rsEcc(data, ecLen) });
  }
  const bits: number[] = [];
  const maxData = Math.max(...blocks.map((b) => b.data.length));
  for (let i = 0; i < maxData; i += 1) {
    for (const block of blocks) if (i < block.data.length) for (let k = 7; k >= 0; k -= 1) bits.push((block.data[i] >> k) & 1);
  }
  for (let i = 0; i < ecLen; i += 1) {
    for (const block of blocks) for (let k = 7; k >= 0; k -= 1) bits.push((block.ec[i] >> k) & 1);
  }

  const size = 17 + version * 4;
  const base: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const reserved: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const mark = (row: number, col: number, dark: boolean): void => {
    base[row][col] = dark;
    reserved[row][col] = true;
  };
  const finder = (row: number, col: number): void => {
    for (let r = -1; r <= 7; r += 1) {
      for (let c = -1; c <= 7; c += 1) {
        const rr = row + r;
        const cc = col + c;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        const dark = r >= 0 && r <= 6 && c >= 0 && c <= 6
          && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
        mark(rr, cc, dark);
      }
    }
  };
  finder(0, 0);
  finder(0, size - 7);
  finder(size - 7, 0);
  for (let i = 8; i < size - 8; i += 1) {
    mark(6, i, i % 2 === 0);
    mark(i, 6, i % 2 === 0);
  }
  const align = ALIGN_POSITIONS[version - 1];
  for (const row of align) {
    for (const col of align) {
      if ((row === 6 && col === 6) || (row === 6 && col === size - 7) || (row === size - 7 && col === 6)) continue;
      for (let r = -2; r <= 2; r += 1) {
        for (let c = -2; c <= 2; c += 1) {
          mark(row + r, col + c, Math.max(Math.abs(r), Math.abs(c)) !== 1);
        }
      }
    }
  }
  // 格式信息区（先占位，掩码选完再写真值）与固定深色模块。
  for (let i = 0; i <= 8; i += 1) {
    if (i !== 6) { mark(8, i, false); mark(i, 8, false); }
  }
  for (let i = size - 8; i < size; i += 1) { mark(8, i, false); mark(i, 8, false); }
  mark(size - 8, 8, true);
  // 版本信息区（v7+）。
  if (version >= 7) {
    for (let i = 0; i < 18; i += 1) {
      mark(Math.floor(i / 3), i % 3 + size - 8 - 3, false);
      mark(i % 3 + size - 8 - 3, Math.floor(i / 3), false);
    }
  }

  // 数据按「两列一组、蛇形上行/下行」填进非保留模块。
  let bitIndex = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert += 1) {
      const row = upward ? size - 1 - vert : vert;
      for (let j = 0; j < 2; j += 1) {
        const col = right - j;
        if (reserved[row][col]) continue;
        base[row][col] = bitIndex < bits.length && bits[bitIndex] === 1;
        bitIndex += 1;
      }
    }
    upward = !upward;
  }

  const formatBits = (mask: number): number => {
    const data = (0b00 << 3) | mask; // 纠错档 M 的两位是 00
    let rest = data << 10;
    for (let i = 14; i >= 10; i -= 1) if (((rest >> i) & 1) !== 0) rest ^= 0x537 << (i - 10);
    return ((data << 10) | rest) ^ 0x5412;
  };
  const versionBits = (): number => {
    if (version < 7) return 0;
    let rest = version << 12;
    for (let i = 17; i >= 12; i -= 1) if (((rest >> i) & 1) !== 0) rest ^= 0x1f25 << (i - 12);
    return (version << 12) | rest;
  };

  let best: boolean[][] | null = null;
  let bestMask = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let mask = 0; mask < 8; mask += 1) {
    const candidate = base.map((row, r) => row.map((dark, c) => (reserved[r][c] ? dark : dark !== MASKS[mask](r, c))));
    const format = formatBits(mask);
    for (let i = 0; i < 15; i += 1) {
      const dark = ((format >> i) & 1) === 1;
      if (i < 6) candidate[i][8] = dark;
      else if (i < 8) candidate[i + 1][8] = dark;
      else candidate[size - 15 + i][8] = dark;
      if (i < 8) candidate[8][size - i - 1] = dark;
      else if (i === 8) candidate[8][7] = dark;
      else candidate[8][14 - i] = dark;
    }
    candidate[size - 8][8] = true;
    if (version >= 7) {
      const info = versionBits();
      for (let i = 0; i < 18; i += 1) {
        const dark = ((info >> i) & 1) === 1;
        candidate[Math.floor(i / 3)][i % 3 + size - 8 - 3] = dark;
        candidate[i % 3 + size - 8 - 3][Math.floor(i / 3)] = dark;
      }
    }
    const score = penalty(candidate);
    if (score < bestScore) { bestScore = score; best = candidate; bestMask = mask; }
  }
  if (best === null) throw new Error("二维码掩码选择失败");
  return { size, version, mask: bestMask, modules: best };
}

/** 矩阵 → SVG path（一格一条 M…h1v1h-1z；调用方给 viewBox 与配色）。 */
export function qrPath(matrix: QrMatrix, quiet = 4): string {
  let d = "";
  for (let r = 0; r < matrix.size; r += 1) {
    for (let c = 0; c < matrix.size; c += 1) {
      if (matrix.modules[r][c]) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
    }
  }
  return d;
}
