// SEMA Phase 2（docs/sema-proposal.md §7 Phase 2 / §3.2 Construct / §4 L2）：进化平面 v1（人辅档）
// 的前门——模型驱动的侧「只产 proposal」，装不装由人拍板。
//
// 刻意只开两个动作：
//  - submitProposal：proposal 进账的唯一入口。只写 <root>/modules/staging/<id>/<version>/
//    （自进化平面唯一的写入口，路径约定归 registry），写完即 registerStaged 落账——门清单与
//    权限面从此定格在账本上，staging 之后被翻动也改不了这一轮跑的是哪几道门。
//  - installApprovedProposal：人工审批后的安装。v1 全量人工档：任何权限面（包括零权限包）都要
//    approvedBy，且不得是管线自己签自己；授权面从 GrantsStore 现读（§10 立案的取料面接线），
//    安装序原样复用 Phase 1 的 Installer（先裁决、再查账、后动文件、最后切指针）。
//
// v1 边界（方案 §7 Phase 2 → Phase 3 扩容）：kind 收 tool / content-pack / desktop-panel——
// desktop-panel 自 Phase 3 起进同一流水线（§3.5），其必需门（边界检查/桌面判卷）由调用方按 kind
// 注入（requiredGatesByKind，与 GATES 同款纪律：src 不抄名单）；service / plugin 的提案与装载
// 仍待后续阶段，不偷做。
// 「运行面装载」（installed → src/agent 生效、桌面挂载）不在本格：它的接线位是 canary 观察期与
// 自治分级（§7 Phase 4），v1 的「跑通」定义到「指针切上、账本可回滚」为止（§11 立案）。
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { GrantsStore } from "./grants";
import { canonicalRelPath, parseBundleManifest, type BundleKind, type BundleManifest } from "./manifest";
import { Installer, type InstallOutcome } from "./installer";
import { assertActor, type BundleEntry, type ModuleRegistry } from "./registry";

/** 产出管线身份戳：submitProposal 落盘时盖在 manifest.signedBy 上，提案不自带（§4 L1）。 */
export const EVOLUTION_PIPELINE_V1 = "evolution-plane-pipeline-v1";

/** 本流水线（人辅档）收的 kind（方案 §7 Phase 2＋Phase 3 扩容；service / plugin 仍不收）。 */
export const PIPELINE_KINDS: readonly BundleKind[] = ["tool", "content-pack", "desktop-panel"];

/** 膨胀护栏（§8「无限生成膨胀」的 v1 管线档）：文件数、单文件、总量三道帽。 */
const MAX_FILES = 256;
const MAX_FILE_BYTES = 1_048_576;
const MAX_TOTAL_BYTES = 8 * 1_048_576;

export class ProposalRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProposalRefusedError";
  }
}

export interface ProposalSubmission {
  /** 未经校验的 manifest 原文；契约校验在边界做（parseBundleManifest），不合法即拒。 */
  manifest: unknown;
  /** 包根相对路径 → utf8 文本；manifest.json 不在此列——它由 manifest 字段单一来源。 */
  files: unknown;
}

export interface ProposalReceipt {
  id: string;
  version: string;
  stagingDir: string;
  /** 落账后的 bundle 记录（门清单/权限面已定格）。 */
  record: BundleEntry;
}

export interface ApprovedInstall {
  /** 人工审批者；激活事件的账面 actor 记的就是这个人（Installer 的既有口径）。 */
  approvedBy: string;
  /** 高危命名空间名单；缺省 shell/net/fs（方案 §4）。 */
  highRiskNamespaces?: readonly string[];
}

export interface EvolutionPlaneOptions {
  registry: ModuleRegistry;
  /** 提交与安装动作的账面 actor；缺省 = 管线身份。 */
  actor?: string;
  /** 按 kind 的必需门（fail-closed：缺一即拒，submit 与 install 两头都查）。名单由调用方注入
   *  （scripts / tests 侧传 GATES 的子集），src 不抄名单——与 knownGates 同款纪律。
   *  Phase 3 产线形状：desktop-panel → ["desktop-boundary-check", "desktop-test"]（§3.5）。 */
  requiredGatesByKind?: Readonly<Partial<Record<BundleKind, readonly string[]>>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class EvolutionPlane {
  private readonly actor: string;
  private grants?: GrantsStore;

  constructor(private readonly opts: EvolutionPlaneOptions) {
    this.actor = opts.actor ?? EVOLUTION_PIPELINE_V1;
    assertActor(this.actor);
  }

  private get registry(): ModuleRegistry {
    return this.opts.registry;
  }

  /** grants.json 与 registry.jsonl 同住 modules/（控制平面自管的家当，§10 立案的取料面）。 */
  private grantsFace(): GrantsStore {
    return (this.grants ??= new GrantsStore(dirname(this.registry.paths.log)));
  }

  /** 提案进账：先全量校验、后落盘、manifest.json 最后写、registerStaged 定格——任何一步红，
   *  盘上不留本次提案的痕迹（拒绝即无痕）。 */
  async submitProposal(submission: ProposalSubmission): Promise<ProposalReceipt> {
    let manifest: BundleManifest;
    try {
      manifest = parseBundleManifest(submission.manifest, this.registry.knownGates);
    } catch (err) {
      throw new ProposalRefusedError(`manifest 契约不合法：${err instanceof Error ? err.message : String(err)}`);
    }
    if (!PIPELINE_KINDS.includes(manifest.kind)) {
      throw new ProposalRefusedError(
        `本流水线只收 ${PIPELINE_KINDS.join(" / ")} 提案（收到 ${manifest.kind}）——service / plugin 待后续阶段`,
      );
    }
    const requiredGates = this.opts.requiredGatesByKind?.[manifest.kind] ?? [];
    const missingRequired = requiredGates.filter((gate) => !manifest.gates.includes(gate));
    if (missingRequired.length > 0) {
      throw new ProposalRefusedError(
        `${manifest.kind} 包必需门未声明（缺了就不会跑，缺席当通过比跳过更坏）: ${missingRequired.join("、")}`,
      );
    }
    if (manifest.signedBy !== undefined) {
      throw new ProposalRefusedError("signedBy 是产出管线的身份戳，由进化平面落盘时自己盖，提案不得自带");
    }
    const files = this.validateFiles(submission.files, manifest);

    const stagingDir = this.registry.stagingDir(manifest.id, manifest.version);
    let occupied = true;
    try {
      await stat(stagingDir);
    } catch {
      occupied = false;
    }
    if (occupied) {
      throw new ProposalRefusedError(`staging 位已存在——版本不可变从 staging 起，重提请 bump version: ${stagingDir}`);
    }
    await mkdir(stagingDir, { recursive: true });
    try {
      // manifest.json 最后写：半途而废留下的是「没有 manifest 的 staging」，registerStaged 进不了
      // 账——不会出现「manifest 在而文件残」的可注册半成品。
      for (const [rel, content] of files) {
        const target = join(stagingDir, rel);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, content, "utf8");
      }
      const stamped = { ...manifest, signedBy: EVOLUTION_PIPELINE_V1 };
      await writeFile(join(stagingDir, "manifest.json"), JSON.stringify(stamped, null, 2) + "\n", "utf8");
      return { id: manifest.id, version: manifest.version, stagingDir, record: await this.registry.registerStaged(manifest.id, manifest.version, this.actor) };
    } catch (err) {
      // 落盘与进账两段都归本次提案所有（staging 位已核空），失败即清退，拒绝即无痕。
      await rm(stagingDir, { recursive: true, force: true });
      throw new ProposalRefusedError(`提案落盘/进账失败，已清退本次 staging：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** files 的边界校验：路径形状、manifest.json 单一来源、前缀冲突、膨胀帽、entry 自洽。 */
  private validateFiles(files: unknown, manifest: BundleManifest): Array<[string, string]> {
    if (!isRecord(files)) throw new ProposalRefusedError("files 必须是「包根相对路径 → utf8 文本」的对象");
    const keys = Object.keys(files).sort();
    if (keys.length > MAX_FILES) throw new ProposalRefusedError(`files 超帽：最多 ${MAX_FILES} 个文件（§8 膨胀护栏）`);
    const out: Array<[string, string]> = [];
    let totalBytes = 0;
    for (const key of keys) {
      let rel: string;
      try {
        rel = canonicalRelPath(key, "files 键");
      } catch (err) {
        throw new ProposalRefusedError(err instanceof Error ? err.message : String(err));
      }
      if (rel === "manifest.json") {
        throw new ProposalRefusedError("files 里不得出现 manifest.json——manifest 由提案的 manifest 字段单一来源");
      }
      const content = files[key];
      if (typeof content !== "string") throw new ProposalRefusedError(`files 值须为 utf8 文本: ${rel}`);
      const bytes = Buffer.byteLength(content, "utf8");
      if (bytes > MAX_FILE_BYTES) throw new ProposalRefusedError(`单文件超帽（${MAX_FILE_BYTES} 字节）: ${rel}`);
      totalBytes += bytes;
      out.push([rel, content]);
    }
    if (totalBytes > MAX_TOTAL_BYTES) throw new ProposalRefusedError(`files 总量超帽（${MAX_TOTAL_BYTES} 字节）——§8 膨胀护栏`);
    const keySet = new Set(keys);
    for (const rel of keys) {
      const segments = rel.split("/");
      for (let i = 1; i < segments.length; i++) {
        const ancestor = segments.slice(0, i).join("/");
        if (keySet.has(ancestor)) {
          throw new ProposalRefusedError(`files 里「${ancestor}」既是文件又是「${rel}」的目录前缀——同一相对路径不能两用`);
        }
      }
    }
    if (manifest.entry !== undefined && !keys.includes(manifest.entry)) {
      throw new ProposalRefusedError(`manifest.entry 声明了 ${manifest.entry}，但 files 里没有这个文件`);
    }
    return out;
  }

  /** 人工审批后的安装：v1 全量人工档（零权限包也要 approvedBy，自审批拒）。 */
  async installApprovedProposal(id: string, version: string, approval: ApprovedInstall): Promise<InstallOutcome> {
    try {
      assertActor(approval.approvedBy);
    } catch (err) {
      throw new ProposalRefusedError(`approvedBy 不合规（${err instanceof Error ? err.message : String(err)}）`);
    }
    if (approval.approvedBy === this.actor) {
      throw new ProposalRefusedError("人工审批不得由产出管线自己签（approvedBy = actor）——自审批不算审批");
    }
    const index = await this.registry.readIndex();
    const entry = index.bundles[id];
    const kind = entry?.kind;
    if (kind !== undefined && !PIPELINE_KINDS.includes(kind)) {
      throw new ProposalRefusedError(
        `本流水线只装 ${PIPELINE_KINDS.join(" / ")}（${id} 是 ${kind}）——service / plugin 走控制平面直连，不经进化平面`,
      );
    }
    // 必需门在安装前对**账本定格的门清单**再核一遍：注册之后策略收紧（requiredGatesByKind 加严）
    // 的存量 staged 包不许从旧口径溜过去——装的是账本里声明的门，不是提案纸面上的。
    const v = entry?.versions[version];
    if (kind !== undefined && v !== undefined) {
      const missingRequired = (this.opts.requiredGatesByKind?.[kind] ?? []).filter(
        (gate) => !v.declaredGates.includes(gate),
      );
      if (missingRequired.length > 0) {
        throw new ProposalRefusedError(
          `${id}@${version} 注册时未声明必需门（策略在其注册后加严 ⇒ 重提请 bump version）: ${missingRequired.join("、")}`,
        );
      }
    }
    const grants = await this.grantsFace().load();
    return await new Installer(this.registry).installStaged({
      id,
      version,
      actor: this.actor,
      grants,
      approvedBy: approval.approvedBy,
      ...(approval.highRiskNamespaces !== undefined ? { highRiskNamespaces: approval.highRiskNamespaces } : {}),
    });
  }
}
