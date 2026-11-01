import { createHash } from "node:crypto";

/** 内容指纹（16 位十六进制）——candidate / episode / playbook / playbook-store 四处的 id 都由它派生。
 *  第 939 页：这份实现原先是四份各自手抄的（`digestOf` 一模一样，但各在各的文件里）。
 *  长度或算法只要有一处改了，跨模块的 id 就对不上：episode 的 id、playbook 条目的 digest、
 *  store 的 legacyId 会静默失配（按 id 查不到，但不报错）。所以只留这一份。 */
export function digestOf(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}
