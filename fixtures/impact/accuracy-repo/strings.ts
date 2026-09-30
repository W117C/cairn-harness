export function formatLabel(s: string): string {
  return padLeft(s.trim(), 20);
}

function padLeft(s: string, n: number): string {
  return s.padStart(n);
}
