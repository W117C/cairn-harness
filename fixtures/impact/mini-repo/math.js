import { add, mul } from "./utils.js";

function compute(score) {
  const base = add(score, 1);
  const boosted = mul(base, 2);
  return boosted;
}

function topUp(value) {
  return add(value, 10);
}

export { compute, topUp };
