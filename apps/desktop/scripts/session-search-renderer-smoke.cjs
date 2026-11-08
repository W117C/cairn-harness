const path = require('node:path');
const root = path.resolve(__dirname, '..', '..', '..');
require(require.resolve('tsx/cjs', { paths: [root] }));
require(path.join(__dirname, 'session-search-renderer-smoke.ts'));
