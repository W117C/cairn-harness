// 第 32 级流水线的一段：吃上一级的输出，吐给下一级
export function step32(v) {
  return (v * 2 + 2) % 1000;
}
