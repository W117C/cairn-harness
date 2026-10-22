// 实验构建：同一份当前源码，仅把 Stream 的三个 memo 包装换成普通组件。
// 不写源码、不覆盖产品 dist；用于检验缓存与耗时之间的因果关系。
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(resolve('package.json'));
const { build } = await import(require.resolve('vite'));
let replacements = 0;
await build({
  logLevel: 'warn',
  build: { outDir: resolve('../../outputs/desktop-polish-2026-10-21/control-renderer'), emptyOutDir: true },
  plugins: [{
    name: 'measure-stream-without-memo', enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('/renderer/components/Stream.tsx')) return;
      const result = code.replace(/memo\(function (ToolRow|UserRowView|AssistantRowView)\(/g, (_match, name) => {
        replacements++;
        return `(function ${name}(`;
      });
      if (replacements !== 3) throw new Error(`Expected 3 memo components, got ${replacements}`);
      return result;
    },
    buildEnd(error) { if (!error && replacements !== 3) throw new Error('Control did not replace all memo components'); },
  }],
});
console.log(JSON.stringify({ replacements }));
