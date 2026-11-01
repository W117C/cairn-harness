import { describe, expect, it } from "vitest";
import {
  parsePluginImportRequest,
  parsePluginSource,
  samePluginSourceIdentity,
} from "../src/main/plugin-source";

function catalogSource() {
  return {
    kind: "catalog" as const,
    catalogId: "cairn",
    entryId: "demo-plugin",
    sourceUrl: "https://github.com/example/demo-plugin",
    revision: "2026-10-29.1",
  };
}

function gitSource() {
  return {
    kind: "git" as const,
    repositoryUrl: "https://github.com/example/demo-plugin.git",
    ref: "main",
    commit: "0123456789abcdef0123456789abcdef01234567",
  };
}

function localSource() {
  return {
    kind: "local" as const,
    sourcePath: "/tmp/demo-plugin",
  };
}

describe("plugin source validation", () => {
  it("accepts catalog, git, and local provenance", () => {
    expect(parsePluginSource(catalogSource())).toEqual(catalogSource());
    expect(parsePluginSource(gitSource())).toEqual(gitSource());
    expect(parsePluginSource(localSource())).toEqual(localSource());
  });

  it("rejects credential-bearing, non-HTTPS, private-IP, and custom-port Git URLs", () => {
    for (const repositoryUrl of [
      "ssh://github.com/example/demo",
      "git@github.com:example/demo.git",
      "https://user:secret@github.com/example/demo.git",
      "https://127.0.0.1/example/demo.git",
      "https://localhost/example/demo.git",
      "https://github.com:8443/example/demo.git",
    ]) {
      expect(() => parsePluginSource({ ...gitSource(), repositoryUrl })).toThrow(/URL|url|公开|HTTPS|https|IP|端口|credentials/i);
    }
  });

  it("rejects relative local paths and incomplete provenance", () => {
    expect(() => parsePluginSource({ ...localSource(), sourcePath: ".agent/plugins/demo" })).toThrow(/absolute|绝对/i);
    expect(() => parsePluginSource({ kind: "git", repositoryUrl: gitSource().repositoryUrl })).toThrow(/ref|commit/i);
    expect(() => parsePluginSource({ kind: "catalog", entryId: "Demo Plugin" })).toThrow(/catalog|catalogId|entryId/i);
  });

  it("validates renderer import requests without accepting package internals", () => {
    expect(parsePluginImportRequest({ kind: "catalog", entryId: "demo-plugin" })).toEqual({
      kind: "catalog",
      entryId: "demo-plugin",
    });
    expect(parsePluginImportRequest({ kind: "git", repositoryUrl: gitSource().repositoryUrl, ref: "main" })).toEqual({
      kind: "git",
      repositoryUrl: gitSource().repositoryUrl,
      ref: "main",
    });
    expect(parsePluginImportRequest({ kind: "local", sourcePath: "/tmp/demo-plugin" })).toEqual({
      kind: "local",
      sourcePath: "/tmp/demo-plugin",
    });
    expect(() => parsePluginImportRequest({
      kind: "catalog",
      entryId: "demo-plugin",
      packageUrl: "https://evil.example/plugin.tgz",
    })).toThrow(/packageUrl|target|digest/i);
  });

  it("matches only the same stable source identity", () => {
    expect(samePluginSourceIdentity(catalogSource(), { ...catalogSource(), revision: "new" })).toBe(true);
    expect(samePluginSourceIdentity(gitSource(), { ...gitSource(), commit: "f".repeat(40) })).toBe(true);
    expect(samePluginSourceIdentity(localSource(), localSource())).toBe(true);
    expect(samePluginSourceIdentity(gitSource(), localSource())).toBe(false);
  });
});
