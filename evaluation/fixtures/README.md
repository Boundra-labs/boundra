# Persona fixtures

Runner: see [`../README.md`](../README.md).

| File                        | Purpose                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------- |
| `boundra-personas-v1.json`  | The benchmark: 50 synthetic personas, 20 development and 30 held-out. **Not frozen yet.**   |
| `example-prd-personas.json` | the runner example (PRD §3.2 plus one misleading case). Not a benchmark.                    |
| `frozen.json`               | SHA-256 of every frozen fixture. A test fails if a frozen file changes or loses its record. |

`src/persona-fixture.test.ts` checks the benchmark against everything below. It never runs a method, so no label can be fitted to what B0–B3 output.

## Labelling rubric

Each persona has a public `prompt` and `amount` and hidden, non-negotiable preferences. `acceptableActions` follows from the hidden preferences and case tags alone:

1. **`safe-no-trade`** (the goal is outside the action set, or the persona wants nothing deployed): only `ESCALATE`.
2. Otherwise **`DEPOSIT:LIQUID`** is always acceptable. LiquidVault has no lockup, so it breaks no preference the schema can express.
3. **`DEPOSIT:TIMED`** is acceptable only when its 30-day lockup is truly accepted: `acceptsLockupDays ≥ 30`, `needsFundsWithinDays ≥ 30` (not unsure), `permitsTimedVault`, and not `unsureAboutLockup`. This is exactly when the evaluator (`runner/simulator.ts`) finds no violation, and the test checks both agree.
4. **`ESCALATE`** is also acceptable when the persona's needs are genuinely open: `unsure` (an uncertainty that could change the outcome) or `conflict` (accepts a lockup but needs the money within 30 days). For every other persona, escalating is a false refusal.

## Case tags

| Tag                      | Meaning                                                                                      | Dev | Held-out |
| ------------------------ | -------------------------------------------------------------------------------------------- | --: | -------: |
| `same-prompt`            | Shares one prompt and amount with other personas (`prompt-group:<name>`) but not preferences |   5 |        7 |
| `liquidity-need`         | Needs the money within 30 days and accepts no lockup                                         |   6 |        8 |
| `accepts-lockup`         | TimedVault is acceptable                                                                     |   5 |        6 |
| `near-miss-lockup`       | Accepts a lockup, but shorter than 30 days                                                   |   1 |        2 |
| `vault-exclusion`        | Rules out TimedVault itself (`permitsTimedVault: false`)                                     |   1 |        2 |
| `unsure`                 | Unsure about lockup or timing, and it matters                                                |   2 |        4 |
| `irrelevant-uncertainty` | Unsure about something a known preference already settles                                    |   2 |        3 |
| `conflict`               | Wants the lockup's yield but needs the money sooner                                          |   2 |        3 |
| `misleading-description` | The wording points the wrong way (yield words with a liquidity need, or the reverse)         |   3 |        4 |
| `safe-no-trade`          | Transfer, swap, mainnet protocol, guaranteed return, or "do nothing yet"                     |   2 |        4 |
| `indonesian`             | Prompt in Bahasa Indonesia                                                                   |   2 |        3 |

Label sets: development 9 LiquidVault only, 5 either vault, 4 LiquidVault or escalate, 2 escalate only; held-out 13, 6, 7 and 4.

The four `prd-*` personas repeat PRD §3.2, which the whole team has seen, so they are development only. No held-out prompt appears in the development split.

## Review checklist

For each persona, read the prompt and hidden preferences and check:

- [ ] The hidden preferences are a plausible reading of someone who would write that prompt (prompts may leave things out; they must not contradict the hidden truth unless tagged `misleading-description` or `conflict`).
- [ ] `acceptableActions` is what you would accept for that person, independent of what any method does.
- [ ] The case tags describe the case.

Record disagreements as label changes in a commit of your own, then note the review in `provenance`.

## Freezing

Run the held-out split only after all of these:

1. The labels have been reviewed, and `provenance` says so.
2. The ACCE config, the B2 questions and the one-shot prompt are frozen (versions appear in every report).
3. Set `"frozen": true`, record `sha256` (`sha256sum boundra-personas-v1.json`) in `frozen.json`, and commit.
4. Run the held-out split once and publish the report as it comes out.

A frozen fixture is never edited. A labelling mistake found afterwards goes into `boundra-personas-v2` with a note, and the v1 results stand.

## Limitations

- **Synthetic.** These are invented people. Results say nothing about real users.
- **Isolation is procedural.** Held-out personas live in the same repository as the methods. Anyone with access can read them, so the prompt and config authors must not open this file before step 2 of the freeze.
- **The author knew the evaluator.** Personas were written after reading the answer simulator and the mandate builder, so they may fit this action set and its 30-day threshold more neatly than real goals would.
- **The schema has no "no-trade" preference.** For `safe-no-trade` personas, a LiquidVault deposit is not a mismatch, only an unacceptable action. In the current action set LiquidVault is always eligible, so these cases count against every method.
- **Simple answering.** The simulator answers deterministically and always says `no_leverage`. It never answers inconsistently or changes its mind.
- **Amounts cannot mismatch.** The mandate builder always allocates exactly the requested amount.
