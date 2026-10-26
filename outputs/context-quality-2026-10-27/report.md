# Context Quality Paired Evaluation

Generated: 2026-10-26T18:07:17.725Z

| Case | Arm | Hit | Tokens | Latency ms | Failed | Unknown |
|---|---|---:|---:|---:|---:|---|
| paraphrase-runbook | lexical | false | 0.0 | 0.186 | false | non-real-provider semantic quality |
| paraphrase-runbook | hybrid | true | 9.0 | 0.244 | false | non-real-provider semantic quality |
| compacted-tool-fact | history | true | 4.0 | 0.137 | false | non-real-provider semantic quality |
| compaction-success | sync | true | 17.0 | 1.048 | false | non-real-provider semantic quality |
| compaction-success | prediction | true | 17.0 | 0.038 | false | candidate-build-latency-excluded-from-request; non-real-provider semantic quality |
| compaction-failure | sync | false | 0.0 | 0.289 | true | summarizer-failed; non-real-provider semantic quality |
| compaction-failure | prediction | false | 0.0 | 1.000 | true | summarizer-failed; non-real-provider semantic quality |

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
      "avgLatencyMs": 0.1861250000000041
    },
    "hybrid": {
      "total": 1,
      "hits": 1,
      "failed": 0,
      "avgReturnedTokens": 9,
      "avgLatencyMs": 0.24416699999997604
    },
    "history": {
      "total": 1,
      "hits": 1,
      "failed": 0,
      "avgReturnedTokens": 4,
      "avgLatencyMs": 0.13691699999998264
    },
    "sync": {
      "total": 2,
      "hits": 1,
      "failed": 1,
      "avgReturnedTokens": 8.5,
      "avgLatencyMs": 0.66808300000001
    },
    "prediction": {
      "total": 2,
      "hits": 1,
      "failed": 1,
      "avgReturnedTokens": 8.5,
      "avgLatencyMs": 0.519062500000004
    }
  }
}
```
