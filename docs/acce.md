# ACCE and agent policy — Person 2

Action-Conditioned Counterfactual Elicitation asks only questions whose answer can change which action the agent may take. Everything that decides authority is deterministic (`packages/acce`, `apps/worker/src/orchestration/decision.ts`); a language model may only reword text, and every model output is validated with a deterministic fallback.

## Configuration v1 (frozen per evaluation run)

Vault descriptors (`DESCRIPTOR_VERSION = v1`): LiquidVault — lockup 0, illustrative 300 bps; TimedVault — lockup 2,592,000 s (30 days), no early exit, illustrative 600 bps. Yield figures are fixture metadata; vaults hold principal 1:1.

| Dimension                    | Alternatives                                | M   | U   | Friction | Default (unanswered) | UNKNOWN     | Enforcement                           |
| ---------------------------- | ------------------------------------------- | --- | --- | -------- | -------------------- | ----------- | ------------------------------------- |
| `max_lockup_seconds`         | `no_lockup`, `up_to_30_days`, `unsure`      | 3   | 3   | 0        | 0 (conservative)     | 0           | on-chain `maxLockupSeconds`           |
| `withdrawal_latency_seconds` | `within_1_day`, `not_for_30_days`, `unsure` | 3   | 3   | 1        | 0 (conservative)     | 0           | eligibility excludes lockup vaults    |
| `permitted_vaults`           | `any_reviewed`, `liquid_only`, `unsure`     | 1   | 1   | 3        | any reviewed         | Liquid only | on-chain `allowedVaults`              |
| `leverage`                   | `no_leverage`, `leverage_ok`, `unsure`      | 3   | 1   | 1        | none                 | none        | structural: no leveraged vault exists |

Amount comes from the intent and expiry from reviewed defaults; neither is an ACCE question (PRD §7.1).

## Algorithm

1. **Eligibility** per deposit candidate with reasons: not permitted, lockup above tolerance, withdrawal latency above the liquidity need, leverage.
2. **Selection** (PRD §7.2): TimedVault only if eligible **and** the owner explicitly accepted its lockup for yield; otherwise LiquidVault; nothing eligible → ESCALATE.
3. **DecisionFlip** by truth table: for every combination of answers to the other unresolved dimensions, does varying this dimension change the selected action? The share of combinations where it does maps to 1–3; 0 drops the dimension.
4. **Score** `= Materiality × Uncertainty × DecisionFlip − Friction`; the highest positive score is asked next, ties by dimension order; stop when no positive score remains or after 5 questions.
5. `unsure` resolves to the conservative value and is shown as _narrowed_; contradictory explicit answers (accepting a lockup but needing funds sooner) are narrowed and explained. Nothing is ever a silent opt-in.

Examples (tested): refusing a lockup → 1 question, LiquidVault; accepting a lockup → liquidity question → TimedVault only if the money is not needed for 30 days; unsure → 1 question, LiquidVault, narrowed; leverage is never asked.

## Mandate draft

The builder emits exactly the executor tuple: only the selected vault in `allowedVaults`, `maxLockupSeconds` equal to that vault's lockup, deposit cap/budget/allocation target equal to the amount (a smaller owner cap means one partial allocation, explained in the preview), withdrawal cap covering the whole position, owner as beneficiary, expiry 7 days by default or lockup + 2 days for TimedVault (maximum 60). The preview lists every limit, its enforcement and testnet labels; `previewHash` is keccak256 of its canonical JSON and approval must present it.

## Agent decisions (worker)

| Situation                                                          | Decision                                                                        |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Paused                                                             | HOLD                                                                            |
| Position, vault NORMAL                                             | HOLD (monitoring)                                                               |
| Position, vault DEGRADED, unlocked, capacity > 0, withdraw allowed | WITHDRAW `min(principal, capacity, maxWithdrawPerAction)` to the owner          |
| Position, DEGRADED, locked / zero capacity / withdraw not allowed  | ESCALATE (blocks new deposits, not recovery)                                    |
| Allocation completed (also after an exit)                          | HOLD — never re-deposit                                                         |
| Vault DEGRADED, no position                                        | HOLD — no new deposit                                                           |
| Idle funds below the planned deposit                               | HOLD (awaiting funding)                                                         |
| Otherwise                                                          | DEPOSIT `min(target, per-action cap, remaining budget)` into the selected vault |

Revoked, expired or replaced mandates change status and stop all decisions. Every proposal passes `prepareAction` (chain guard) and is recorded with its policy check before the operator execution service simulates, signs and sends it.

## Language model use

`packages/llm`: disabled by default (reviewed templates, labelled `TEMPLATE`). With `LLM_PROVIDER=anthropic` and `LLM_API_KEY`, the default model is `claude-opus-5-5` (`LLM_MODEL` to change), structured output, low effort, server-side refusal fallback, a 20 s deadline (`LLM_DEADLINE_MS`), at most 3 attempts and an hourly token budget (`LLM_MAX_TOKENS_PER_HOUR`). The model rewords a planned question (same alternative IDs and order) or restates preview facts. Outputs adding numbers, vaults, protocols, addresses, links or guarantees are rejected; the template is used and the reason is recorded in the activity log.

## Evaluation

B0–B3 share this builder and action set; see [evaluation/README.md](../evaluation/README.md). Any change to the table above or the selection rule requires a new config version and must not happen after a held-out run.
