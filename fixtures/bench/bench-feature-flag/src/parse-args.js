// 解析 argv（已去掉 node 与前两个参数）。目前只认 --name。
export function parseArgs(argv) {
  const out = { name: null, verbose: false, rest: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--name") out.name = argv[++i] ?? null;
    else out.rest.push(a);
  }
  return out
}
