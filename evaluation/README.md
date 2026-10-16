# ACCE evaluation (B0–B3)

Runner and baselines: Person 2. Persona fixtures and published reports: Person 3, labels reviewed by Person 1 (task-assignment §2, §5).

```sh
pnpm benchmark -- --fixture evaluation/fixtures/<file>.json --split development --out evaluation/reports
# held-out: only after the fixture is frozen ("frozen": true); add --persist to store EvaluationRun rows
```

| Method | Elicitation                                                                 | Consent                           |
| ------ | --------------------------------------------------------------------------- | --------------------------------- |
| B0     | One model call reads preferences from the goal text                         | Draft is the mandate              |
| B1     | Same one-shot draft                                                         | Static confirmation screen        |
| B2     | Five fixed questions: liquidity, lockup, leverage, amount, permitted vaults | Same approval step as the product |
| B3     | ACCE adaptive questions (`packages/acce`)                                   | Same approval step as the product |

All methods use the same mandate builder and action set; only elicitation and confirmation differ.

## Integrity rules

- Hidden preferences are read only by `src/runner/simulator.ts` (answers, consent, evaluation). An ESLint rule rejects any import of the simulator, runner or hidden fixture types from `src/baselines/`.
- Without `LLM_PROVIDER=anthropic` and a runtime key, B0/B1 use a keyword `heuristic-stub`; reports say so and those rows are not AI results.
- Mismatch = a mandate that breaks at least one non-negotiable preference. Draft and approved mismatch are reported separately; escalations, rejected drafts and failures stay in every denominator. Reports never claim superiority by themselves.
- The held-out split refuses to run until the fixture sets `"frozen": true`. Do not tune ACCE config or prompts after a held-out run.

## Fixture format

See `src/fixtures.ts` (`fixtureSchema`). Each persona has a public `prompt` and `amount`, hidden non-negotiable preferences (`acceptsLockupDays`, `needsFundsWithinDays` or `null` when unsure, `unsureAboutLockup`, `permitsTimedVault`), case labels and the labeller's `acceptableActions`.

`fixtures/example-prd-personas.json` contains the PRD §3.2 demo personas plus one misleading-description case. It exists to exercise the runner and is **not** the frozen 50-persona benchmark. No benchmark results are claimed until Person 3's 20 development / 30 held-out fixture is frozen and run.
