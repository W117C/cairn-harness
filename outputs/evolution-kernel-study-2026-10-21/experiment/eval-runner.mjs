// 脚本化评价 runner（demo）：只证明 TCB 评价入口的配对协议，不调用模型。
// 输出一行 JSON；成本按版本人为设定，用来验证「配对 + 成本优先」的裁决路径。
const version = process.env.EVOLUTION_VERSION;
const task = JSON.parse(process.env.EVOLUTION_TASK_JSON ?? "{}");
if (process.env.EVOLUTION_DEMO_FAIL === "1") {
  console.error("scripted runner failure for " + String(task.id));
  process.exit(1);
}
console.log(JSON.stringify({
  ok: true,
  costUsd: version === "1.1.0" ? 1 : 0.5,
  tokens: 100,
  durationMs: 1000,
  artifactDigest: "sha256:" + "3".repeat(64),
  failureReason: null,
}));
