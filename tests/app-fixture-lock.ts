// 共享靶子 `fixtures/todo-app` 的跨 worker 互斥锁。
//
// 为什么需要：根套件默认**文件级并行**（tests/vitest.config.ts），而三支判卷共用这一棵树：
//   · gated-tools / runner-gates 会把 `src/todo.ts` 改写成 bug 版再重置；
//   · replay-faces 断言「跑前跑后整棵树逐字节不变」。
// 三者必须落在同一个临界区里；其余 400+ 文件照常并行。此前是把**整张表**串行来换这份互斥，
// 分臂实测：串行整表 258.9s；并行批（这三支排除）79.2s、它们串行 6.5s。改成锁之后整表三跑
// 69.5/78.6/72.2s，口径见 tests/vitest.config.ts 的注释。
//
// 载具是仓库根的 `.tmp/app-fixture.lock`（`.tmp/` 被 .gitignore 忽略，且**不在靶子树里**——
// 放进 `fixtures/todo-app/.agent/` 会被 replay-faces 的整树哈希算进去，锁自己的存在就会让断言红）。
// 锁里写持有者 pid：持有进程已消失时，等待者直接接管，不必等到超时——崩溃的 worker 不该
// 把后面整张表拖住 10 分钟（那是「一道门永远红」的另一种写法）。
import { mkdir, open, readFile, stat, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LOCK_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "..", ".tmp", "app-fixture.lock");
/** 等锁上限：三支串行的实际耗时是秒级；给足余量吸收并发负载，但绝不无限等。 */
const WAIT_TIMEOUT_MS = 5 * 60_000;
const RETRY_MS = 20;

function alive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** 拿锁；返回的函数只释放**自己**那把（锁被判死后别人接管时，不能替新持有者解锁）。 */
export async function acquireAppFixtureLock(): Promise<() => Promise<void>> {
  await mkdir(dirname(LOCK_PATH), { recursive: true });
  const started = Date.now();
  for (;;) {
    try {
      const handle = await open(LOCK_PATH, "wx");
      await handle.writeFile(String(process.pid), "utf8");
      await handle.close();
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        const owner = (await readFile(LOCK_PATH, "utf8").catch(() => "")).trim();
        if (owner !== String(process.pid)) return;
        await unlink(LOCK_PATH).catch(() => undefined);
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      // 锁里没有 pid（刚建成、还没来得及写）时按「活着」处理：等下一拍再看，别去删。
      // 但空了 60s 还没人写 = 持有者在 open 与 write 之间死了，接管，别让整张表等满 5 分钟。
      const ownerText = (await readFile(LOCK_PATH, "utf8").catch(() => "")).trim();
      const owner = Number.parseInt(ownerText, 10);
      if (!Number.isInteger(owner)) {
        const createdAt = await stat(LOCK_PATH).then((info) => info.mtimeMs).catch(() => 0);
        if (createdAt !== 0 && Date.now() - createdAt > 60_000) {
          await unlink(LOCK_PATH).catch(() => undefined);
          continue;
        }
      } else if (owner !== process.pid && !alive(owner)) {
        await unlink(LOCK_PATH).catch(() => undefined);
        continue;
      }
      if (Date.now() - started > WAIT_TIMEOUT_MS) {
        throw new Error("等 fixtures/todo-app 的跨文件锁超时（" + LOCK_PATH + "）：另一支持锁的判卷没有收尾");
      }
      await new Promise((done) => setTimeout(done, RETRY_MS));
    }
  }
}
