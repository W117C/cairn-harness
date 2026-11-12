import { describe, expect, it } from "vitest";
// @ts-expect-error -- package.mjs is plain ESM without a declaration file.
import { buildReleaseManifest, checksumLines } from "../scripts/package.mjs";

describe("desktop package release manifest", () => {
  it("binds version, host, Electron, archive hash and dependency lock hash", () => {
    const manifest = buildReleaseManifest({
      version: "0.2.0",
      platform: "darwin",
      arch: "arm64",
      electronVersion: "44.9.1",
      archiveName: "Cairn.dmg",
      archiveSha256: "a".repeat(64),
      archiveBytes: 123,
      dependencyLockSha256: "b".repeat(64),
      sourceCommit: "c".repeat(40),
      sourceDirty: false,
    });
    expect(manifest).toEqual({
      schemaVersion: 1,
      version: "0.2.0",
      buildHost: { platform: "darwin", arch: "arm64" },
      electron: "44.9.1",
      signing: "ad-hoc",
      notarized: false,
      archive: { name: "Cairn.dmg", sha256: "a".repeat(64), bytes: 123 },
      runtimeLockSha256: "b".repeat(64),
      sourceCommit: "c".repeat(40),
      sourceDirty: false,
    });
  });

  it("writes checksum lines in shasum -c format", () => {
    expect(checksumLines([
      { name: "Cairn.dmg", sha256: "a".repeat(64) },
      { name: "release.json", sha256: "b".repeat(64) },
    ])).toBe(`${"a".repeat(64)}  Cairn.dmg\n${"b".repeat(64)}  release.json\n`);
  });
});
