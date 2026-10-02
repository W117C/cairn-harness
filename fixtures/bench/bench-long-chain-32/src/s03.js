// 第 3 级流水线的一段：吃上一级的输出，吐给下一级
export function step3(v) {
  return (v * 3 - i + 1) % 991;
}
