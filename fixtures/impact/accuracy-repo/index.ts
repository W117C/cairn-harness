export { formatLabel } from "./strings.js";
export { add } from "./math.js";

export function summarize(items: string[]): string {
  return formatLabel(items.join(","));
}
