// 第 18 级流水线的一段：吃上一级的输出，吐给下一级
export function step18(v) {
  return v ^ (((i + 1) * 7) % 64);
}
