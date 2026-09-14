import { loadConfig } from "../src/config.js";

let failures = 0;
const expect = (cond, msg) => {
  if (!cond) {
    failures++;
    console.error("FAIL: " + msg);
  }
};

expect(loadConfig({}).timeout === 30000, "缺 timeout 用默认 30000（实得 " + loadConfig({}).timeout + "）");
expect(loadConfig({}).host === "localhost", "缺 host 用默认 localhost");
expect(loadConfig({ timeout: 5000 }).timeout === 5000, "显式 timeout 不被覆盖");

if (failures > 0) {
  console.error(failures + " 项断言失败");
  process.exit(1);
}
console.log("config-default: all ok");
