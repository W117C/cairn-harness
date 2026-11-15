// 真机证据的「保质期」章（2026-11-15，第 1199 页）——被判卷消费的 outputs 读数共用这一份规格。
//
// 为什么证据要带章：旧 values.json 配旧构建会一直绿，而真机早已变了（第 1053 页输入卡
// 提亮后 cds 判卷仍按旧值通过，2026-11-15 抓到）。两个字段各堵一个洞：
//   · rendererDigest：量完之后源有没有再变（判卷侧用 tests/helpers/renderer-evidence.ts 复算）；
//   · buildFresh：先改源、没重建就跑探针（量到旧 dist、摘要却按新源写）。
// 摘要规格（判卷侧必须逐字同规格）：递归 src/renderer，取 .css/.ts/.tsx，跳过点目录；
// 按 POSIX 相对路径排序；每条 update(路径)、"\0"、内容 sha256、"\n"。
const { createHash } = require("node:crypto");
const { readdirSync, readFileSync, statSync } = require("node:fs");
const { join, relative, sep } = require("node:path");

function rendererDigest(root) {
  const files = [];
  const walk = (dir) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (ent.name.startsWith(".")) continue;
      const abs = join(dir, ent.name);
      if (ent.isDirectory()) walk(abs);
      else if (/\.(css|ts|tsx)$/.test(ent.name)) files.push(abs);
    }
  };
  walk(root);
  const rows = files
    .map((abs) => [relative(root, abs).split(sep).join("/"), abs])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const h = createHash("sha256");
  for (const [rel, abs] of rows) {
    h.update(rel);
    h.update("\0");
    h.update(createHash("sha256").update(readFileSync(abs)).digest("hex"));
    h.update("\n");
  }
  return h.digest("hex");
}

function newestMtime(dir, re) {
  let newest = 0;
  const walk = (d) => {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      const abs = join(d, ent.name);
      if (ent.isDirectory()) walk(abs);
      else if (re.test(ent.name)) newest = Math.max(newest, statSync(abs).mtimeMs);
    }
  };
  walk(dir);
  return newest;
}

function buildState(rendererRoot, distRoot) {
  const srcMtime = newestMtime(rendererRoot, /\.(css|ts|tsx)$/);
  const distMtime = newestMtime(distRoot, /\.(css|js|html)$/);
  return {
    buildFresh: srcMtime <= distMtime,
    srcMtime: new Date(srcMtime).toISOString(),
    distMtime: new Date(distMtime).toISOString(),
  };
}

/** 把一次真机读数组包成带保质期章的 JSON（判卷侧读 envelope.checks）。 */
function evidenceEnvelope(checks, rendererRoot, distRoot) {
  return {
    checks,
    rendererDigest: rendererDigest(rendererRoot),
    generatedAt: new Date().toISOString(),
    ...buildState(rendererRoot, distRoot),
  };
}

module.exports = { rendererDigest, newestMtime, buildState, evidenceEnvelope };
