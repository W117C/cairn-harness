/** 源码散文里引用的 `scripts/<file>` 必须真在盘上（或当场写明它已不在）。
 *  立这条的实测：core-only 迁移落地（`69fbb0d`）删掉 4 个被源码点名的脚本，留下 6 处引用——
 *  其中 3 处是**现在时祈使句**（照 `scripts/arch-boundary-check.ts`〔未入库〕的写法、供 `scripts/commercial-check.ts`〔已删 `69fbb0d`〕断言用），
 *  读的人（或模型）照做就会撞在一面不存在墙上；另 3 处是过去的读数出处。
 *  这是第 122 页「跨面耦合按指针语法分族」的第三个语法：`页:行号`（D-3 管）、`台账编号`（没人管）、`scripts/<file>`（这条管）。
 *
 *  判据一律纯函数（同 docs-check 的口径）：输入文件表 → 输出 findings，不触真实仓库；
 *  真实取料只发生在本模块导出的 `collectScriptRefs`，由下面的真仓用例消费。 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** 已删/不在盘的引用要就地承认：同一行带上「已删」或「未入库」字样即可放行（登记式豁免，不许静默）。 */
const ACK = /已删|未入库|不再存在/;
const REF = /scripts\/([A-Za-z0-9._-]+\.(?:ts|mts|mjs|tsx))/g;

export interface RefHit {
  file: string;
  line: number;
  target: string;
  /** 该引用指向的脚本是否在盘上。 */
  exists: boolean;
  /** 同行是否承认它不在（放行条件）。 */
  acknowledged: boolean;
}

/** 抽一行里的 `scripts/<file>` 引用（不去重：一行两处就报两处，漏计比双报贵）。 */
export function scriptRefs(line: string): string[] {
  return [...line.matchAll(REF)].map((m) => "scripts/" + m[1]);
}

/** 一条引用是否成立：目标在盘上，或同行写明「已删／未入库／不再存在」。 */
export function refIsLegit(target: string, line: string, exists: (p: string) => boolean): boolean {
  return exists(target) || ACK.test(line);
}

/** 扫一份文件表，给出所有不成立的引用。纯函数：**「在不在盘上」由调用点注入**，
 *  所以测试可以喂内存里的假表（判据一律纯函数，同 `docs-check` 的口径）。 */
export function findDeadScriptRefs(
  files: readonly { path: string; text: string }[],
  exists: (p: string) => boolean,
): RefHit[] {
  const out: RefHit[] = [];
  for (const f of files) {
    f.text.split("\n").forEach((line, i) => {
      for (const target of scriptRefs(line)) {
        const present = exists(target);
        const acknowledged = ACK.test(line);
        if (!present && !acknowledged) out.push({ file: f.path, line: i + 1, target, exists: present, acknowledged });
      }
    });
  }
  return out;
}

/** 取料面：`src/` 与 `scripts/` 下的源码文件。**不含 tests/**——本尺自己的用例里全是假引用字面量，
 *  把它们算进面里等于让判据自证（第 118 页那条假阳性同形）。 */
export function collectScriptRefs(root: string): { path: string; text: string }[] {
  const acc: { path: string; text: string }[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/\.(ts|tsx|mts|mjs)$/.test(name)) acc.push({ path: p.slice(root.length + 1), text: readFileSync(p, "utf8") });
    }
  };
  for (const top of ["src", "scripts"]) walk(join(root, top));
  return acc;
}
