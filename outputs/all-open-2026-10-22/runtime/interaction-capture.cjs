// 运行原有 smoke，仅在设置返回前追加截图；不改变断言、选择器、fixture 或产品文件。
const { readFileSync, writeFileSync } = require('node:fs');
const { resolve, dirname } = require('node:path');
const Module = require('node:module');
const path = resolve(__dirname, '../../../apps/desktop/scripts/interaction-smoke.cjs');
const original = readFileSync(path, 'utf8');
const needle = "  await pointerClick('.sp-back'); await pause();";
if (original.split(needle).length !== 2) throw new Error('设置截图锚点不唯一，停止而非改断言');
const source = original.replace(needle, "  await shot('07-settings');\n" + needle);
writeFileSync(resolve(__dirname, 'interaction-source.cjs'), source);
const runner = new Module(path, module);
runner.filename = path;
runner.paths = Module._nodeModulePaths(dirname(path));
runner._compile(source, path);
