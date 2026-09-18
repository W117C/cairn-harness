import { compute } from "./math.js";

export function grade(score: number): string {
  const value = compute(score);
  return value > 60 ? "pass" : "fail";
}
