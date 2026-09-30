export function buildReport(items: number[]): number {
  const base = mul(items.length, 2);
  const alias = add;
  return formatLabel(String(base)).length + alias(1, 2);
}
