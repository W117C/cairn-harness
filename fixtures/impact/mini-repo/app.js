import { compute } from "./math.js";
import { add } from "./utils.js";

function main() {
  const result = compute(42);
  return add(result, 1);
}

main();

export { main };
