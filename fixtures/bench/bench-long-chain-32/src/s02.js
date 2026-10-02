// 第 2 级流水线的一段：吃上一级的输出，吐给下一级
export function step2(v) {
  return v ^ (((i + 1) * 7) % 64);
}
