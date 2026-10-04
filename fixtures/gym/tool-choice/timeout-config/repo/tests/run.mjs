import { DEFAULTS, resolveTimeout, writeTimeout } from "../src/timeout.js";

let failures = 0;
const expect = (cond, msg) => {
  if (!cond) {
    failures++;
    console.error("FAIL: " + msg);
  }
};

// 配置里 timeout 按**秒**写：5 秒 = 5000 毫秒。
expect(resolveTimeout({ timeout: 5 }) === 5000,
  "timeout=5（秒）应解析为 5000 毫秒（实得 " + resolveTimeout({ timeout: 5 }) + "）");
expect(resolveTimeout({ timeout: 0.25 }) === 250,
  "timeout=0.25（秒）应解析为 250 毫秒（实得 " + resolveTimeout({ timeout: 0.25 }) + "）");
expect(resolveTimeout({ timeout: 30 }) === 30_000,
  "timeout=30（秒）应解析为 30000 毫秒（实得 " + resolveTimeout({ timeout: 30 }) + "）");

// 缺省仍应是 30000 毫秒，且**不经过秒→毫秒换算**。
expect(resolveTimeout({}) === DEFAULTS.timeoutMs,
  "缺 timeout 应回落缺省 30000（实得 " + resolveTimeout({}) + "）");
expect(resolveTimeout({ timeout: "" }) === DEFAULTS.timeoutMs,
  "空 timeout 应回落缺省 30000（实得 " + resolveTimeout({ timeout: "" }) + "）");

// 写回同样按毫秒存一个数（单位自洽即可，测试只钉「写进去能原样读回」）。
expect(resolveTimeout(writeTimeout({}, 1234)) === 1234,
  "writeTimeout 写出的值应能被 resolveTimeout 原样读回");

if (failures > 0) {
  console.error(failures + " 项断言失败");
  process.exit(1);
}
console.log("timeout-config: all ok");