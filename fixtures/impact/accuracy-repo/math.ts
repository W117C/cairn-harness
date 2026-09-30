export function add(a: number, b: number): number {
  return a + b;
}

export function mul(a: number, b: number): number {
  return clamp(a * b, 0, 100);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
