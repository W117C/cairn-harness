import { randomUUID } from "node:crypto";
import { lstat, mkdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  deletePluginSecrets,
  pluginUserConfigDir,
  readPluginSecretKeys,
  readPluginUserConfig,
  writePluginUserConfig,
} from "../agent/plugins/secrets";
import { parsePluginManifest, userConfigValuesErrors } from "../agent/plugins/manifest";
import type { TrustStore } from "../agent/plugins/trust";
import { pluginFingerprintEx } from "../agent/plugins/trust";
import { pluginInstallPaths } from "./plugin-install-jobs";
import { assertPluginRoot, preparePluginRoot } from "./plugin-path-safety";
import type {
  InstalledPluginRecord,
  PluginInstallRegistryPort,
  PluginInstallScope,
} from "./plugin-install-registry";

interface OperationBase {
  readonly pluginDataRoot: string;
  readonly userPluginsDir?: string;
  readonly registry: PluginInstallRegistryPort;
  readonly entryId: string;
  readonly scope: PluginInstallScope;
  readonly workspace: string | null;
  readonly now?: () => number;
  readonly assertIdle?: () => Promise<void> | void;
}

export interface SetPluginEnabledInput extends OperationBase {
  readonly enabled: boolean;
}

export interface ConfigureInstalledPluginInput extends OperationBase {
  readonly values: Record<string, string>;
}

export interface UninstallPluginInput extends OperationBase {
  readonly trust: TrustStore;
  readonly deleteSecrets?: (plugin: string, keys: readonly string[]) => Promise<void>;
}

function timestamp(now: (() => number) | undefined): string {
  return new Date((now ?? Date.now)()).toISOString();
}

async function requireDirectory(path: string, label: string): Promise<void> {
  const stat = await lstat(path).catch(() => null);
  if (stat === null) throw new Error(`${label} does not exist`);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`${label} must be a real directory`);
  }
}

async function pathExists(path: string): Promise<boolean> {
  return await lstat(path).then(() => true, () => false);
}

async function prepareOperationRoots(
  input: OperationBase,
  paths: ReturnType<typeof pluginInstallPaths>,
): Promise<void> {
  if (input.scope === "project") {
    const workspace = input.workspace as string;
    await preparePluginRoot(workspace, paths.disabledRoot);
    await preparePluginRoot(workspace, paths.activeRoot);
    return;
  }
  await preparePluginRoot(dirname(paths.activeRoot), paths.activeRoot);
  await preparePluginRoot(input.pluginDataRoot, paths.disabledRoot);
}

async function assertOperationRoots(
  input: OperationBase,
  paths: ReturnType<typeof pluginInstallPaths>,
): Promise<void> {
  if (input.scope === "project") {
    const workspace = input.workspace as string;
    await assertPluginRoot(workspace, paths.disabledRoot);
    await assertPluginRoot(workspace, paths.activeRoot);
    return;
  }
  await assertPluginRoot(dirname(paths.activeRoot), paths.activeRoot);
  await assertPluginRoot(input.pluginDataRoot, paths.disabledRoot);
}

export async function setPluginEnabled(input: SetPluginEnabledInput): Promise<InstalledPluginRecord> {
  await input.assertIdle?.();
  const record = await input.registry.get(input.entryId, input.scope, input.workspace);
  if (record === null) throw new Error(`plugin is not installed: ${input.entryId}`);
  const paths = pluginInstallPaths({
    pluginDataRoot: input.pluginDataRoot,
    ...(input.userPluginsDir === undefined ? {} : { userPluginsDir: input.userPluginsDir }),
    scope: input.scope,
    workspace: input.workspace,
  });
  const source = join(record.enabled ? paths.activeRoot : paths.disabledRoot, input.entryId);
  const target = join(input.enabled ? paths.activeRoot : paths.disabledRoot, input.entryId);
  await requireDirectory(source, "installed plugin package");
  if (record.enabled === input.enabled) return record;
  if (input.enabled) {
    const fingerprint = await pluginFingerprintEx(source);
    if (fingerprint.bounded || fingerprint.fp !== record.fingerprint) {
      throw new Error("installed plugin content fingerprint no longer matches the registry");
    }
  }
  if (await pathExists(target)) throw new Error(`plugin target already exists: ${target}`);

  await prepareOperationRoots(input, paths);
  await rename(source, target);
  const next: InstalledPluginRecord = {
    ...record,
    enabled: input.enabled,
    updatedAt: timestamp(input.now),
  };
  try {
    await input.registry.upsert(next);
  } catch (err) {
    await rename(target, source).catch(() => undefined);
    throw err;
  }
  return next;
}

export async function configureInstalledPlugin(
  input: ConfigureInstalledPluginInput,
): Promise<InstalledPluginRecord> {
  await input.assertIdle?.();
  const record = await input.registry.get(input.entryId, input.scope, input.workspace);
  if (record === null) throw new Error(`plugin is not installed: ${input.entryId}`);
  const paths = pluginInstallPaths({
    pluginDataRoot: input.pluginDataRoot,
    ...(input.userPluginsDir === undefined ? {} : { userPluginsDir: input.userPluginsDir }),
    scope: input.scope,
    workspace: input.workspace,
  });
  const packageRoot = join(record.enabled ? paths.activeRoot : paths.disabledRoot, record.entryId);
  await requireDirectory(packageRoot, "installed plugin package");
  const manifest = await parsePluginManifest(packageRoot);
  const fields = manifest.userConfigFields;
  const allowed = new Set(fields.map((field) => field.key));
  const unknown = Object.keys(input.values).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw new Error(`unknown plugin config fields: ${unknown.join(", ")}`);

  const configDir = pluginUserConfigDir(input.pluginDataRoot, manifest.name);
  const existing = await readPluginUserConfig({
    dir: configDir,
    plugin: manifest.name,
    fields,
  });
  const merged: Record<string, string> = { ...existing.values, ...input.values };
  const invalidTypes = userConfigValuesErrors(fields, merged);
  if (invalidTypes.length > 0) throw new Error(invalidTypes.join("；"));
  const missingRequired = fields
    .filter((field) => field.required)
    .filter((field) => (merged[field.key] ?? "").trim() === "")
    .map((field) => field.key);
  if (missingRequired.length > 0) {
    throw new Error(`required plugin config is missing: ${missingRequired.join(", ")}`);
  }
  const written = await writePluginUserConfig({
    plugin: manifest.name,
    fields,
    values: merged,
    dir: configDir,
  });
  if (!written.ok) throw new Error(written.error ?? "plugin config write failed");
  return record;
}

export async function uninstallPlugin(input: UninstallPluginInput): Promise<{ ok: true }> {
  await input.assertIdle?.();
  const record = await input.registry.get(input.entryId, input.scope, input.workspace);
  if (record === null) throw new Error(`plugin is not installed in the registry: ${input.entryId}`);
  const paths = pluginInstallPaths({
    pluginDataRoot: input.pluginDataRoot,
    ...(input.userPluginsDir === undefined ? {} : { userPluginsDir: input.userPluginsDir }),
    scope: input.scope,
    workspace: input.workspace,
  });
  await assertOperationRoots(input, paths);
  const activePath = join(paths.activeRoot, input.entryId);
  const sourceRoot = record.enabled ? paths.activeRoot : paths.disabledRoot;
  const source = join(sourceRoot, input.entryId);
  const existed = await pathExists(source);
  const configDir = pluginUserConfigDir(input.pluginDataRoot, record.manifestName);
  const configExisted = await pathExists(configDir);
  if (configExisted) await requireDirectory(configDir, "installed plugin config");
  const secretKeys = configExisted
    ? await readPluginSecretKeys(configDir, record.manifestName)
    : [];
  const previousTrust = existed
    ? await input.trust.status(source, record.fingerprint)
    : "pending";
  let transactionRoot: string | null = null;
  let tombstone: string | null = null;
  let configTransactionRoot: string | null = null;
  let configTombstone: string | null = null;
  let registryRemoved = false;

  try {
    if (existed) {
      await requireDirectory(source, "installed plugin package");
      transactionRoot = join(dirname(sourceRoot), ".cairn-plugin-transactions", `uninstall-${randomUUID()}`);
      await preparePluginRoot(dirname(sourceRoot), transactionRoot);
      tombstone = join(transactionRoot, "package");
      await rename(source, tombstone);
    }
    if (configExisted) {
      configTransactionRoot = join(
        input.pluginDataRoot,
        ".cairn-plugin-config-transactions",
        `uninstall-${randomUUID()}`,
      );
      await mkdir(dirname(configTransactionRoot), { recursive: true, mode: 0o700 });
      await mkdir(configTransactionRoot, { recursive: false, mode: 0o700 });
      configTombstone = join(configTransactionRoot, "config");
      await rename(configDir, configTombstone);
    }
    if (existed) await input.trust.forget(source);
    await input.registry.remove(input.entryId, input.scope, input.workspace);
    registryRemoved = true;
    await (input.deleteSecrets ?? deletePluginSecrets)(record.manifestName, secretKeys);
  } catch (err) {
    if (registryRemoved) {
      await input.registry.upsert(record).catch(() => undefined);
    }
    if (configTombstone !== null) {
      await mkdir(dirname(configDir), { recursive: true, mode: 0o700 }).catch(() => undefined);
      await rename(configTombstone, configDir).catch(() => undefined);
    }
    if (tombstone !== null) {
      await rename(tombstone, source).catch(() => undefined);
      if (previousTrust !== "pending") {
        await input.trust.decide(source, previousTrust === "trusted", record.fingerprint)
          .catch(() => undefined);
      }
    }
    if (transactionRoot !== null) {
      await rm(transactionRoot, { recursive: true, force: true }).catch(() => undefined);
    }
    if (configTransactionRoot !== null) {
      await rm(configTransactionRoot, { recursive: true, force: true }).catch(() => undefined);
    }
    throw err;
  }
  if (transactionRoot !== null) {
    await rm(transactionRoot, { recursive: true, force: true }).catch(() => undefined);
  }
  if (configTransactionRoot !== null) {
    await rm(configTransactionRoot, { recursive: true, force: true }).catch(() => undefined);
  }
  return { ok: true };
}
