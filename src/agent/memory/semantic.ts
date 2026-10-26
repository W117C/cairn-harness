import { decayStrength } from "./strength";
import {
  RECALL_EXCERPT_MAX_CHARS,
  RECALL_MAX_TOPICS,
  RECALL_MIN_SCORE,
  WAKE_MIN_SCORE,
  clipByCodepoints,
  scoreRecallCandidates,
  selectRecall,
  type RecallInput,
  type RecallPick,
} from "./retrieval";

export interface EmbeddingProvider {
  id: string;
  embed(
    texts: readonly string[],
    options?: { signal?: AbortSignal },
  ): Promise<readonly (readonly number[])[]>;
}

export type HybridRecallMode = "lexical" | "hybrid" | "hybrid-fallback";

export interface HybridRecallOutcome {
  picks: RecallPick[];
  mode: HybridRecallMode;
  reason?: string;
}

export interface HybridRecallOptions {
  k?: number;
  nowISO?: string;
  embedding?: {
    provider: EmbeddingProvider;
    signal?: AbortSignal;
  };
}

const HYBRID_SEMANTIC_MIN = 0.62;
const DORMANT_SEMANTIC_MIN = 0.75;
const HYBRID_LEXICAL_WEIGHT = 0.65;
const HYBRID_SEMANTIC_WEIGHT = 0.35;

export function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length || left.length === 0) throw new Error("vector dimension mismatch");
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]!;
    const b = right[index]!;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  const denom = Math.sqrt(leftNorm) * Math.sqrt(rightNorm);
  if (!Number.isFinite(denom) || denom <= Number.EPSILON) throw new Error("vector norm must be finite and non-zero");
  return dot / denom;
}

function validateVectors(
  vectors: readonly (readonly number[])[],
  expectedCount: number,
): readonly (readonly number[])[] {
  if (vectors.length !== expectedCount) {
    throw new Error("embedding count mismatch: expected " + String(expectedCount) + ", got " + String(vectors.length));
  }
  const dimension = vectors[0]?.length ?? 0;
  if (dimension <= 0) throw new Error("embedding vector must not be empty");
  for (const vector of vectors) {
    if (vector.length !== dimension) throw new Error("vector dimension mismatch");
    let norm = 0;
    for (const value of vector) {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error("embedding values must be finite numbers");
      }
      norm += value * value;
    }
    if (!(norm > Number.EPSILON)) throw new Error("vector norm must be finite and non-zero");
  }
  return vectors;
}

function semanticText(candidate: RecallInput): string {
  return candidate.topic + "\n" + candidate.digest + "\n" + (candidate.body ?? "").slice(0, 4_000);
}

/**
 * Hybrid recall keeps exact lexical evidence as the backbone and adds bounded
 * semantic similarity for paraphrases. A configured but broken embedder falls
 * back to the exact lexical implementation and reports why.
 */
export async function selectRecallHybrid(
  query: string,
  candidates: readonly RecallInput[],
  opts: HybridRecallOptions = {},
): Promise<HybridRecallOutcome> {
  const k = opts.k ?? RECALL_MAX_TOPICS;
  if (!opts.embedding) {
    return { mode: "lexical", picks: selectRecall(query, candidates, { k, ...(opts.nowISO ? { nowISO: opts.nowISO } : {}) }) };
  }
  if (k <= 0 || candidates.length === 0) return { mode: "hybrid", picks: [] };

  const lexical = new Map(
    scoreRecallCandidates(query, candidates).map((row) => [row.topic, row]),
  );
  const texts = [query, ...candidates.map(semanticText)];
  let vectors: readonly (readonly number[])[];
  try {
    vectors = validateVectors(
      await opts.embedding.provider.embed(texts, opts.embedding.signal ? { signal: opts.embedding.signal } : {}),
      texts.length,
    );
  } catch (error) {
    return {
      mode: "hybrid-fallback",
      reason: (error instanceof Error ? error.message : String(error)).slice(0, 300),
      picks: selectRecall(query, candidates, { k, ...(opts.nowISO ? { nowISO: opts.nowISO } : {}) }),
    };
  }

  const queryVector = vectors[0]!;
  const rows: Array<{ pick: RecallPick; effective: number }> = [];
  candidates.forEach((candidate, index) => {
    if (candidate.body === null || candidate.body.trim() === "") return;
    const exact = lexical.get(candidate.topic);
    const lexicalScore = exact?.score ?? 0;
    let similarity: number;
    try {
      similarity = cosineSimilarity(queryVector, vectors[index + 1]!);
    } catch (error) {
      throw new Error("invalid candidate embedding for " + candidate.topic + ": " + (error instanceof Error ? error.message : String(error)));
    }
    const semanticScore = Math.max(0, Math.min(1, similarity));
    const lexicalNormalized = lexicalScore / (1 + lexicalScore);
    const combined = HYBRID_LEXICAL_WEIGHT * lexicalNormalized + HYBRID_SEMANTIC_WEIGHT * semanticScore;
    const dormant = candidate.stat?.dormant === true;
    const passes = dormant
      ? semanticScore >= DORMANT_SEMANTIC_MIN || lexicalScore >= WAKE_MIN_SCORE
      : semanticScore >= HYBRID_SEMANTIC_MIN || lexicalScore >= RECALL_MIN_SCORE;
    if (!passes) return;
    const strength = candidate.stat === undefined
      ? 1
      : decayStrength(
          candidate.stat.strength,
          candidate.stat.lastRetrieved,
          opts.nowISO ?? candidate.stat.lastRetrieved,
        );
    rows.push({
      pick: {
        topic: candidate.topic,
        type: candidate.type,
        headline: candidate.digest.replace(/\s+/gu, " ").trim().slice(0, 80),
        excerpt: clipByCodepoints(candidate.body.trim(), RECALL_EXCERPT_MAX_CHARS),
        matched: exact?.matched ?? [],
        score: combined,
        woke: dormant,
      },
      effective: combined * (0.5 + 0.5 * (Number.isFinite(strength) ? strength : 1)),
    });
  });

  rows.sort((left, right) =>
    right.effective - left.effective ||
    (left.pick.topic < right.pick.topic ? -1 : left.pick.topic > right.pick.topic ? 1 : 0));
  return { mode: "hybrid", picks: rows.slice(0, k).map((row) => row.pick) };
}

