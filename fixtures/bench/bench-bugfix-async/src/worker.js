import { drain } from "./queue.js";

// 跑完并把结果加总
export async function total(jobs, handler) {
  const out = await drain(jobs, handler);
  return out.reduce((a, b) => a + b, 0)
}
