const ESC = String.fromCharCode(27);
const ANSI = new RegExp("[" + ESC + "\\[[0-9;]*m", "gu");
const samples = [
  "[map-check] 符号地图验收",
  "Duration 1.31s (transform 76%)",
  "[probe promise-recall] 红 1 条",
  "src/main/agent-runner.ts#handleAgentRun",
  ESC + "[32m通过" + ESC + "[39m",
];
for (const s of samples) console.log(JSON.stringify(s), "→", JSON.stringify(s.replace(ANSI, "")));
