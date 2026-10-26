import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  selectRecallHybrid,
  type EmbeddingProvider,
} from "../src/agent/memory/semantic";
import { selectRecall, type RecallInput } from "../src/agent/memory/retrieval";
import { buildMemoryInjection } from "../src/agent/memory/inject";
import { writeTopic } from "../src/agent/memory/store";

const NOW = "2026-10-27T00:00:00.000Z";

function candidate(topic: string, digest: string, body: string): RecallInput {
  return { topic, type: "project", digest, body };
}

function fakeEmbedder(table: ReadonlyArray<{ includes: string; vector: readonly number[] }>): EmbeddingProvider {
  return {
    id: "fixture",
    async embed(texts) {
      return texts.map((text) => {
        const row = table.find((entry) => text.includes(entry.includes));
        return row?.vector ?? [0, 1];
      });
    },
  };
}

describe("selectRecallHybrid", () => {
  it("recovers a paraphrase that lexical recall misses", async () => {
    const candidates = [
      candidate("prod-runbook", "production failure runbook", "check the gateway health endpoint"),
      candidate("style-guide", "naming conventions", "use descriptive identifiers"),
    ];
    const lexical = selectRecall("deploy outage", candidates, { nowISO: NOW });
    expect(lexical.map((pick) => pick.topic)).not.toContain("prod-runbook");

    const outcome = await selectRecallHybrid("deploy outage", candidates, {
      nowISO: NOW,
      embedding: {
        provider: fakeEmbedder([
          { includes: "deploy outage", vector: [1, 0] },
          { includes: "production failure", vector: [0.98, 0.2] },
        ]),
      },
    });

    expect(outcome.mode).toBe("hybrid");
    expect(outcome.picks.map((pick) => pick.topic)).toContain("prod-runbook");
  });

  it("preserves lexical recall when no embedder is configured", async () => {
    const candidates = [
      candidate("deploy-timeout", "deploy timeout gateway retry", "retry twice"),
      candidate("style-guide", "naming conventions", "use descriptive identifiers"),
    ];
    const lexical = selectRecall("deploy timeout gateway retry", candidates, { nowISO: NOW });
    const outcome = await selectRecallHybrid("deploy timeout gateway retry", candidates, { nowISO: NOW });
    expect(outcome.mode).toBe("lexical");
    expect(outcome.picks).toEqual(lexical);
  });

  it("falls back visibly when the configured embedder fails", async () => {
    const candidates = [
      candidate("deploy-timeout", "deploy timeout gateway retry", "retry twice"),
      candidate("style-guide", "naming conventions", "use descriptive identifiers"),
    ];
    const outcome = await selectRecallHybrid("deploy timeout gateway retry", candidates, {
      nowISO: NOW,
      embedding: {
        provider: {
          id: "broken",
          async embed() {
            throw new Error("embedding service unavailable");
          },
        },
      },
    });

    expect(outcome.mode).toBe("hybrid-fallback");
    expect(outcome.reason).toContain("embedding service unavailable");
    expect(outcome.picks.map((pick) => pick.topic)).toEqual(["deploy-timeout"]);
  });

  it("rejects malformed vectors and falls back instead of inventing similarity", async () => {
    const candidates = [candidate("deploy-timeout", "deploy timeout gateway retry", "retry twice")];
    const outcome = await selectRecallHybrid("deploy timeout gateway retry", candidates, {
      nowISO: NOW,
      embedding: {
        provider: {
          id: "bad-shape",
          async embed(texts) {
            return texts.map(() => [Number.NaN, 0]);
          },
        },
      },
    });
    expect(outcome.mode).toBe("hybrid-fallback");
    expect(outcome.reason).toContain("finite");
    expect(outcome.picks.map((pick) => pick.topic)).toEqual(["deploy-timeout"]);
  });
});

describe("hybrid memory injection", () => {
  it("writes hybrid provenance and selects a paraphrase-only topic", async () => {
    const root = await mkdtemp(join(tmpdir(), "memory-hybrid-"));
    try {
      const workspace = join(root, "ws");
      const globalRoot = join(root, "global");
      const memory = join(workspace, ".agent", "memory");
      await mkdir(memory, { recursive: true });
      await mkdir(globalRoot, { recursive: true });
      await writeTopic(
        memory,
        "prod-runbook",
        "project",
        "production failure runbook\ncheck gateway health before retrying",
        NOW,
      );

      const result = await buildMemoryInjection({
        workspace,
        globalRoot,
        queryText: "deploy outage",
        embedding: {
          provider: fakeEmbedder([
            { includes: "deploy outage", vector: [1, 0] },
            { includes: "production failure", vector: [0.98, 0.2] },
          ]),
        },
      });

      expect(result.retrieval).toEqual({ mode: "hybrid" });
      expect(result.recall).toContain("prod-runbook");
      expect(result.project).toContain("[RECALL");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps lexical injection and exposes a visible fallback reason", async () => {
    const root = await mkdtemp(join(tmpdir(), "memory-hybrid-fallback-"));
    try {
      const workspace = join(root, "ws");
      const globalRoot = join(root, "global");
      const memory = join(workspace, ".agent", "memory");
      await mkdir(memory, { recursive: true });
      await mkdir(globalRoot, { recursive: true });
      await writeTopic(
        memory,
        "deploy-timeout",
        "project",
        "deploy timeout gateway retry\nretry twice after checking the gateway",
        NOW,
      );

      const result = await buildMemoryInjection({
        workspace,
        globalRoot,
        queryText: "deploy timeout gateway retry",
        embedding: {
          provider: {
            id: "broken",
            async embed() {
              throw new Error("provider 401");
            },
          },
        },
      });

      expect(result.recall).toEqual(["deploy-timeout"]);
      expect(result.retrieval.mode).toBe("hybrid-fallback");
      expect(result.retrieval.reason).toContain("provider 401");
      expect(result.project).toContain("hybrid-fallback");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

