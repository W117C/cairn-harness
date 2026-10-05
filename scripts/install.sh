#!/usr/bin/env bash
# Cairn 安装（spec：docs/superpowers/specs/2026-10-06-productization-b1-design.md §1#3）。
# 前提：本仓库已 clone（本包 private，不发布 npm）。两步走：git clone → ./scripts/install.sh
# 收尾只打印三条下一步，不自动 npm link（README 已有 `npm link` 一条路）。
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v node >/dev/null 2>&1; then
  echo "[cairn] 未找到 node：先装 Node（版本区间见 package.json 的 engines）。" >&2
  exit 1
fi

# Node 版本按 package.json engines 判（单一事实源：区间从 engines 现读，不在这里抄第二份）。
# 安装期 tsx 还没装上，不能 import src/main/doctor.ts，故这里内联同一条比较规则
# （与 doctor.ts 的 parseEngines/nodeVersionOk 同构；本仓 engines 形态就是 ">=X.Y.Z <N"）。
node -e '
  const e = require("./package.json").engines.node;
  const m = e.trim().match(/^>=v?(\d+)\.(\d+)\.(\d+)\s*<(\d+)\s*$/);
  if (!m) { console.error("[cairn] engines.node 读不出来：" + e); process.exit(1); }
  const v = process.versions.node.split(".").map(Number);
  const cur = [v[0], v[1], v[2]], min = [+m[1], +m[2], +m[3]];
  const cmp = (a, b) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]);
  if (!(cmp(cur, min) >= 0 && v[0] < +m[4])) {
    console.error("[cairn] Node " + process.versions.node + " 不满足 engines（" + e + "）");
    process.exit(1);
  }
'

echo "[cairn] 装依赖（pnpm 在则 pnpm，否则 npm）……"
if command -v pnpm >/dev/null 2>&1; then
  pnpm install
else
  echo "[cairn] 未找到 pnpm，退回 npm install。"
  npm install
fi

echo
echo "[cairn] 装好了。下一步三条："
echo "  1) 零凭据看流程：./bin/cairn.mjs --provider demo --mode auto --workspace /tmp/cairn-demo \"随便写点什么\""
echo "  2) 真跑：export OPENAI_API_KEY=<你的 key> && ./bin/cairn.mjs \"你的任务\""
echo "  3) 自检：./bin/cairn.mjs --doctor"
