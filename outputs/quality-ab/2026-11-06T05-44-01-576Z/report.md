# Quality gate A/B (deterministic scripted model)

Same scripted model, same tasks, same judge; only the harness differs.

| task | arm | final tests | claimed done | tokens | wall ms |
|---|---|---|---|---|---|
| T1-bugfix-add | baseline | fail | yes | 2940 | 6 |
| T1-bugfix-add | quality | pass | yes | 5240 | 144 |
| T2-feature-slug | baseline | fail | yes | 2940 | 2 |
| T2-feature-slug | quality | pass | yes | 5240 | 141 |
| T3-static-syntax | baseline | pass | yes | 2940 | 2 |
| T3-static-syntax | quality | pass | yes | 2940 | 27 |

`claimed done` = the model said the tests pass. `final tests` = the verifier's verdict on the final workspace.
