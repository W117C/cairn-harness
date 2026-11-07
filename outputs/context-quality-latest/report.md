# Context Quality Paired Evaluation

Generated: 2026-11-04T19:02:29.892Z

| Case | Arm | Hit | Tokens | Latency ms | Failed | Unknown |
|---|---|---:|---:|---:|---:|---|
| paraphrase-runbook | lexical | false | 0.0 | 0.151 | false | non-real-provider semantic quality |
| paraphrase-runbook | hybrid | true | 9.0 | 0.212 | false | non-real-provider semantic quality |
| compacted-tool-fact | history | true | 4.0 | 0.124 | false | non-real-provider semantic quality |
| compaction-success | sync | true | 17.0 | 1.048 | false | non-real-provider semantic quality |
| compaction-success | prediction | true | 17.0 | 0.038 | false | candidate-build-latency-excluded-from-request; non-real-provider semantic quality |
| compaction-failure | sync | false | 0.0 | 1.486 | true | summarizer-failed; non-real-provider semantic quality |
| compaction-failure | prediction | false | 0.0 | 1.320 | true | summarizer-failed; non-real-provider semantic quality |

## Summary

```json
{
  "total": 7,
  "hits": 4,
  "failed": 2,
  "byArm": {
    "lexical": {
      "total": 1,
      "hits": 0,
      "failed": 0,
      "avgReturnedTokens": 0,
      "avgLatencyMs": 0.15116700000000094
    },
    "hybrid": {
      "total": 1,
      "hits": 1,
      "failed": 0,
      "avgReturnedTokens": 9,
      "avgLatencyMs": 0.2115000000000009
    },
    "history": {
      "total": 1,
      "hits": 1,
      "failed": 0,
      "avgReturnedTokens": 4,
      "avgLatencyMs": 0.12412499999999937
    },
    "sync": {
      "total": 2,
      "hits": 1,
      "failed": 1,
      "avgReturnedTokens": 8.5,
      "avgLatencyMs": 1.2670834999999947
    },
    "prediction": {
      "total": 2,
      "hits": 1,
      "failed": 1,
      "avgReturnedTokens": 8.5,
      "avgLatencyMs": 0.6788540000000047
    }
  }
}
```
