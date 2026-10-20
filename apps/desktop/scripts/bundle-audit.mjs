// 按 Vite 实际入口依赖闭包统计首屏 JS；write:false，不覆盖产品构建。
// 从仓库根：pnpm --filter cairn-desktop exec node scripts/bundle-audit.mjs <输出 JSON>
import { build } from "vite";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
const output = resolve(process.argv[2] ?? "bundle-audit.json");
await build({
  logLevel: "warn", build: { write: false },
  plugins: [{
    name: "cairn-bundle-audit",
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle).filter((item) => item.type === "chunk");
      const byName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
      const initial = new Set();
      const visit = (name) => {
        if (initial.has(name)) return;
        const chunk = byName.get(name);
        if (!chunk) return;
        initial.add(name);
        chunk.imports.forEach(visit);
      };
      chunks.filter((chunk) => chunk.isEntry).forEach((chunk) => visit(chunk.fileName));
      const report = {
        initialBytes: [...initial].reduce((sum, name) => sum + Buffer.byteLength(byName.get(name).code), 0),
        initialChunks: [...initial],
        chunks: chunks.map((chunk) => ({
          file: chunk.fileName, entry: chunk.isEntry, initial: initial.has(chunk.fileName),
          imports: chunk.imports, dynamicImports: chunk.dynamicImports, bytes: Buffer.byteLength(chunk.code),
          modules: Object.entries(chunk.modules).map(([id, mod]) => ({ id: relative(process.cwd(), id), bytes: mod.renderedLength })).sort((a, b) => b.bytes - a.bytes),
        })),
      };
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, JSON.stringify(report, null, 2));
      console.log(JSON.stringify({ initialBytes: report.initialBytes, chunks: report.initialChunks, output }));
    },
  }],
});
