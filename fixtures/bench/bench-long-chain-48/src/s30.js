// 第 30 级流水线的一段：吃上一级的输出，吐给下一级
export function step30(v) {
  return v ^ (((i + 1) * 7) % 64);
}
