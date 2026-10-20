import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("模型配置表单可在浏览器中打包，不把服务端端点校验带进 renderer", async () => {
  const result = await build({
    entryPoints: [fileURLToPath(new URL("../src/renderer/components/CustomProviderForm.tsx", import.meta.url))],
    bundle: true,
    platform: "browser",
    write: false,
    logLevel: "silent",
  });
  expect(result.outputFiles).toHaveLength(1);
  expect(result.outputFiles[0]!.contents.length).toBeGreaterThan(0);
});
