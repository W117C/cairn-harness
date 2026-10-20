// SEMA Phase 1（方案：docs/sema-proposal.md §3.4/§5/§10）：Installer —— staging → installed → 激活指针。
//
// 可逆性对方案 §5 初稿做了**刻意收严**：版本目录不可变。installed/<id>/<version> 一经落盘拒绝覆写
// （重装必须 bump version），于是回滚 = 指针对换 + previous 版本文件仍在盘上——
// 没有就地覆写，就不存在需要快照的时刻，快照机制整个不用落地（§10 立了这笔偏离案）。
//
// 安装位是控制平面自管的 modules/installed/；「运行面装载」（src/ 生效、桌面面板挂载）的接线位
// 是 canary 观察期与自治分级（方案 §7 Phase 4），v1 不做（§11 立案）。
//
// installStaged 的顺序即安全序：先裁决（授权/人工档）→ 再查账（已注册 + 全门 pass）→ 后动文件
// → 最后切指针；动文件之后任何一步失败都清退本次部署，恢复原状。staging manifest 在安装前**重验**
// （staging 是不可信面的写入口，注册之后被改过也不许装进去）。
import { cp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseBundleManifest } from "./manifest";
import { adjudicateInstall } from "./permission-broker";
import { ModuleRegistry, type BundleEntry } from "./registry";

export class InstallRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstallRefusedError";
  }
}

export interface InstallStagedOptions {
  id: string;
  version: string;
  /** 发起安装的操作者；激活事件的账面 actor 记 approvedBy（有人工确认时）。 */
  actor: string;
  /** 授权面（bundle 权限词 + `<命名空间>.*` 通配）；取料面的接线在 Phase 2。 */
  grants: ReadonlySet<string>;
  /** 高危权限的人工确认者；包声明高危权限而缺省时拒装。 */
  approvedBy?: string;
  /** 高危命名空间名单；缺省 shell/net/fs（方案 §4）。 */
  highRiskNamespaces?: readonly string[];
}

export interface InstallOutcome {
  deployedTo: string;
  activeVersion: string;
}

export class Installer {
  constructor(private readonly registry: ModuleRegistry) {}

  async installStaged(opts: InstallStagedOptions): Promise<InstallOutcome> {
    const stagingDir = this.registry.stagingDir(opts.id, opts.version);
    const installedDir = join(this.registry.paths.installed, opts.id, opts.version);
    let manifest;
    try {
      manifest = parseBundleManifest(
        JSON.parse(await readFile(join(stagingDir, "manifest.json"), "utf8")) as unknown,
        this.registry.knownGates,
      );
    } catch (err) {
      throw new InstallRefusedError(
        `staging manifest 读不了/不合法（安装前重验）：${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (manifest.id !== opts.id || manifest.version !== opts.version) {
      throw new InstallRefusedError(
        `staging 路径与 manifest 身份不一致：${opts.id}@${opts.version} vs ${manifest.id}@${manifest.version}`,
      );
    }
    const adj = adjudicateInstall(manifest.permissions, opts.grants, opts.highRiskNamespaces);
    if (adj.missing.length > 0) {
      throw new InstallRefusedError(`未授权即拒装：${adj.missing.join("、")} 不在授权面——修法是补授权配置，不是逐次放行`);
    }
    if (adj.requiringApproval.length > 0 && opts.approvedBy === undefined) {
      throw new InstallRefusedError(`高危权限 ${adj.requiringApproval.join("、")} 需人工确认（approvedBy）才能安装`);
    }
    const index = await this.registry.readIndex();
    const v = index.bundles[opts.id]?.versions[opts.version];
    if (v === undefined) throw new InstallRefusedError(`${opts.id}@${opts.version} 未注册——先 registerStaged`);
    const notPassed = v.declaredGates.filter((gate) => v.gates[gate] !== "pass");
    if (notPassed.length > 0) {
      throw new InstallRefusedError(`${opts.id}@${opts.version} 未过全门（${notPassed.join("、")}）——未过验证的包不进安装序`);
    }
    let targetExists = true;
    try {
      await stat(installedDir);
    } catch {
      targetExists = false;
    }
    if (targetExists) {
      throw new InstallRefusedError(`安装位已存在——版本不可变，重装请 bump version：${installedDir}`);
    }
    await mkdir(dirname(installedDir), { recursive: true });
    await cp(stagingDir, installedDir, { recursive: true });
    try {
      const stagedBytes = await readFile(join(stagingDir, "manifest.json"));
      const installedBytes = await readFile(join(installedDir, "manifest.json"));
      if (!stagedBytes.equals(installedBytes)) throw new Error("manifest.json 字节不一致");
      if (manifest.entry !== undefined) {
        const entryStat = await stat(join(installedDir, manifest.entry));
        if (!entryStat.isFile()) throw new Error("entry 不是常规文件");
      }
    } catch (err) {
      await rm(installedDir, { recursive: true, force: true });
      throw new InstallRefusedError(`部署完整性校验失败，已清退本次部署：${err instanceof Error ? err.message : String(err)}`);
    }
    try {
      const entry = await this.registry.activate(opts.id, opts.version, opts.approvedBy ?? opts.actor);
      return { deployedTo: installedDir, activeVersion: entry.active?.version ?? opts.version };
    } catch (err) {
      await rm(installedDir, { recursive: true, force: true });
      throw err;
    }
  }

  /** 回滚 = 指针对换；前置：previous 版本的文件必须真的在盘上——指针不许指向缺失的文件。
   *
   *  `expectedPrevious` = 期望回退到的那个版本（观察期记录里的 previousVersion）。
   *  给了它就**只认它**：账本上的 previous 位在这期间被别人动过（又装过一版、又回滚过一次），
   *  而观察记录仍写着当初那个版本 ⇒ 无条件按账本回退会装上**另一个版本**，
   *  而记录里的 `rollbackTo` 仍写着当初那个 ⇒ **记录在撒谎**（说回退到了 A，实际装的是 B）。
   *  宁可不回退（退成 degraded、把实情说出来），也不装一个与记录不符的版本。 */
  async rollbackInstalled(id: string, actor: string, expectedPrevious?: string): Promise<BundleEntry> {
    const index = await this.registry.readIndex();
    const entry = index.bundles[id];
    if (entry?.active === undefined || entry.previous === undefined) {
      throw new InstallRefusedError(`${id} 没有 active+previous 可回滚`);
    }
    if (expectedPrevious !== undefined && entry.previous.version !== expectedPrevious) {
      throw new InstallRefusedError(
        `${id} 期望回退到 ${expectedPrevious}，但账本上的 previous 位现在是 ${entry.previous.version}`
          + "（期间被别的安装/回滚动过）——拒绝装一个与记录不符的版本",
      );
    }
    const prevDir = join(this.registry.paths.installed, id, entry.previous.version);
    try {
      await stat(prevDir);
    } catch {
      throw new InstallRefusedError(
        `回滚目标 ${id}@${entry.previous.version} 未部署在盘上（${prevDir}）——拒绝把指针切向缺失的文件`,
      );
    }
    return await this.registry.rollback(id, actor);
  }

  /** 清退：废弃超龄版本的 installed 文件移除并落 prune 事件；active/previous 位上的跳过
   *  （fold 那边还有一道同样的闸，这里先跳过是不依赖异常流做控制）。 */
  async pruneInstalled(now: Date, olderThanDays: number, actor: string): Promise<string[]> {
    const candidates = await this.registry.pruneCandidates(now, olderThanDays);
    const removed: string[] = [];
    for (const candidate of candidates) {
      const index = await this.registry.readIndex();
      const entry = index.bundles[candidate.id];
      if (entry?.active?.version === candidate.version || entry?.previous?.version === candidate.version) continue;
      const dir = join(this.registry.paths.installed, candidate.id, candidate.version);
      await rm(dir, { recursive: true, force: true });
      await this.registry.recordPrune(candidate.id, candidate.version, actor);
      removed.push(join("modules", "installed", candidate.id, candidate.version));
    }
    return removed;
  }
}
