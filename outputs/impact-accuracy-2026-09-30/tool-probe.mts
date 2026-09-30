// 工具层兜底探针（第 240 页盲区的下一步）：模型实际拿到的 impact_query 输出——
// 私有函数（唯一调用者在同文件）vs 跨文件符号，各跑一次真工具实例，逐字取 output。
import { createImpactQueryTool } from "../../src/tools/impact-query.js";

const ROOT = "/Users/ze/Downloads/deepseek harness";
const tool = createImpactQueryTool();
const ctx = { workspace: ROOT };

for (const sym of ["insideScratchFace", "staleScratchTrees"]) {
  const r = await tool.run({ symbol: sym }, ctx);
  console.log(`\n===== impact_query {symbol:"${sym}"} ⇒ ok=${String(r.ok)} =====`);
  console.log(r.output);
}
