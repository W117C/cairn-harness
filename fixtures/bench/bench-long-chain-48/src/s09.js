// 第 9 级流水线的一段：吃上一级的输出，吐给下一级
export function step9(v) {
  return (v + Math.floor(v / 3) + 1) % 997;
}
