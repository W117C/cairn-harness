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
      // 入口变小不等于主工作台变小：分别统计两条路由及其静态依赖的总量。
      const routeBytes = {};
      for (const [route, modulePath] of Object.entries({ main: "src/renderer/App.tsx", popout: "src/renderer/components/PopoutApp.tsx" })) {
        const root = chunks.find(chunk => Object.keys(chunk.modules).some(id => relative(process.cwd(), id) === modulePath));
        if (!root) throw new Error(`缺少路由模块：${modulePath}`);
        const names = new Set(initial);
        const collect = name => {
          if (names.has(name)) return;
          const chunk = byName.get(name);
          if (!chunk) throw new Error(`缺少依赖 chunk：${name}`);
          names.add(name);
          chunk.imports.forEach(collect);
        };
        collect(root.fileName);
        routeBytes[route] = [...names].reduce((sum, name) => sum + Buffer.byteLength(byName.get(name).code), 0);
      }
      const report = {
        initialBytes: [...initial].reduce((sum, name) => sum + Buffer.byteLength(byName.get(name).code), 0),
        initialChunks: [...initial],
        routeBytes,
        chunks: chunks.map((chunk) => ({
          file: chunk.fileName, entry: chunk.isEntry, initial: initial.has(chunk.fileName),
          imports: chunk.imports, dynamicImports: chunk.dynamicImports, bytes: Buffer.byteLength(chunk.code),
          modules: Object.entries(chunk.modules).map(([id, mod]) => ({ id: relative(process.cwd(), id), bytes: mod.renderedLength })).sort((a, b) => b.bytes - a.bytes),
        })),
      };
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, JSON.stringify(report, null, 2));
      // 预算面（2026-10-20 独立评审追出，LOW-MEDIUM）：旧形状只报 initialBytes、**不看它**
      // ⇒ 一次 3× 的首屏膨胀照样 exit 0（"量过了"读成"没变"）。
      // 帽取**现状上取整**（实测基线 517,956B，取料 outputs/desktop-performance-2026-10-20/
      // bundle-before.json）⇒ 帽 = 800,000B（≈1.5 倍）：站得住 today，又能逮住一次 3× 回归。
      // 可用环境变量调（真要临时抬帽时抬它，而不是把闸删掉）。
      const budget=Number(process.env.CAIRN_BUNDLE_INITIAL_BUDGET_BYTES??800000);
      const routeBudgets = {
        main: Number(process.env.CAIRN_BUNDLE_MAIN_BUDGET_BYTES ?? 600000),
        popout: Number(process.env.CAIRN_BUNDLE_POPOUT_BUDGET_BYTES ?? 400000),
      };
      if ([budget, ...Object.values(routeBudgets)].some(value => !Number.isFinite(value) || value <= 0)) throw new Error("JS 预算必须为有限正数");
      const overBudget=report.initialBytes>budget || Object.entries(routeBudgets).some(([route, cap]) => routeBytes[route] > cap);
      console.log(JSON.stringify({ initialBytes: report.initialBytes, chunks: report.initialChunks, budgetBytes: budget, routeBytes, routeBudgets, overBudget, output }));
      if(overBudget) {
        console.error(`[bundle-audit] 路由 JS 超预算：${JSON.stringify({ initial: report.initialBytes, routeBytes, budget, routeBudgets })}`);
        process.exitCode=1;
      }
    },
  }],
});
