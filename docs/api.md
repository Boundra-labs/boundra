# Boundra API

REST API under `/api/v1` (NestJS). The machine-readable contract is [openapi.json](./openapi.json), regenerated with `pnpm --filter @boundra/api openapi:export`; Swagger UI is served at `/api/docs` outside production. Base Sepolia testnet only; all token amounts are **base-unit strings** (MockUSDC has 6 decimals), never numbers.

## Sessions and request rules

1. `POST /auth/challenge {address}` returns an EIP-4361 (SIWE) message bound to the web origin, chain 84532 and a single-use nonce (5 minutes).
2. The wallet signs the message (`personal_sign`). `POST /auth/verify {message, signature}` consumes the nonce, sets the `__Host-boundra_session` cookie (HttpOnly, Secure, SameSite=Strict, 12 h) and returns `{address, csrfToken, expiresAt}`. Signing in never approves a mandate or transaction.
3. Every non-public route needs the cookie. Every `POST`/`PATCH` also needs the `Origin` header equal to `WEB_ORIGIN` and `X-CSRF-Token: <csrfToken>`. `GET /auth/session` re-issues the CSRF token after a page reload.
4. The owner is always taken from the session; addresses in request bodies are never used for authorization. Another owner's resources return `404`.

### API tokens (SDK and MCP clients)

Apps and AI assistants that are not the Boundra web app sign in with an API token instead of the cookie:

1. `POST /auth/challenge {address, client: "token"}` returns a SIWE message whose statement tells the owner what they are granting: an API token that can read their account and prepare mandates for review, and that cannot sign transactions or move funds.
2. The owner's wallet signs it. `POST /auth/verify {message, signature}` returns `{address, token, expiresAt}` and sets no cookie. The statement the owner signed decides the session kind, so an altered statement is rejected (`CHALLENGE_INVALID`).
3. Send `Authorization: Bearer <token>` on owner routes. No `Origin` or `X-CSRF-Token` is needed: a browser never attaches this header on its own, and CORS still admits only `WEB_ORIGIN`.
4. A token is never accepted as the cookie, and a cookie is never accepted as a token. A malformed or revoked bearer token is rejected even if a valid cookie is also present. Admin routes need the admin's browser session.
5. `POST /auth/logout` with the token revokes it. Tokens last `SESSION_TTL_HOURS`, like browser sessions.
6. In the web app (browser session only), `GET /auth/tokens` lists the owner's live tokens (`id`, `createdAt`, `expiresAt`, `lastSeenAt`; never values, which are stored only as hashes) and `POST /auth/tokens/:id/revoke` revokes one at once. The app's **Apps & AI** page (`/app/connect`) creates, shows once and revokes tokens.

The token acts as the owner in the API only. Everything that changes the chain (`createExecutor`, `setMandate`, funding, pause, revoke, withdrawals) still needs the owner's own wallet signature.

Serve web and API from one origin (Caddy in production; in development and the Compose stack the web app's `/api/v1/*` route handler forwards to `API_INTERNAL_URL`) so the cookie is first-party. Bodies are limited to 16 KB; login routes allow 10 requests/minute per client and other routes 120.

## Errors

```json
{
  "error": {
    "code": "STALE_PREVIEW",
    "message": "…",
    "recovery": "Reload the latest preview and review it again."
  }
}
```

`code` values are stable (`errorCodes` in `packages/shared`): `UNAUTHENTICATED`, `FORBIDDEN`, `CSRF_REJECTED`, `RATE_LIMITED`, `VALIDATION_FAILED` (with `details` paths), `NOT_FOUND`, `CHALLENGE_INVALID`, `SIGNATURE_INVALID`, `WRONG_CHAIN`, `EXECUTOR_NOT_REGISTERED`, `INSUFFICIENT_BALANCE`, `QUESTION_NOT_ACTIVE`, `STALE_PREVIEW`, `INVALID_STATE`, `DEPENDENCY_UNAVAILABLE`, `INTERNAL_ERROR`. Internals are never echoed.

## Owner journey

| Step               | Request                                                                                                  | Notes                                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Public config      | `GET /config/public`                                                                                     | Reviewed contract addresses, operator address, vault descriptors; `configured: false` without a manifest |
| Faucet, executor   | wallet → `faucet.claim()`, `factory.createExecutor()`                                                    | Direct contract calls; the API holds no keys                                                             |
| Register executor  | `POST /executors/register`                                                                               | Server reads `factory.executorOf(owner)` and verifies it; body is ignored                                |
| Intent             | `POST /intents {objective, amount, chainId: 84532}`                                                      | Rejects amounts above wallet + executor balance (`422 INSUFFICIENT_BALANCE`)                             |
| Clarify            | `POST /intents/:id/answers {questionId, alternativeId}`                                                  | One question at a time; `question` is null when done (`state: MANDATE_PENDING`)                          |
| Draft              | `POST /intents/:id/mandate-drafts {expiryDays?, maxDepositPerAction?, maxWithdrawPerAction?, operator?}` | Returns `tuple`, `preview`, `previewHash`; `ESCALATED` when nothing is eligible. `operator`: see below   |
| Edit               | `PATCH /mandate-drafts/:id {…}`                                                                          | Always a new revision; the old one is superseded                                                         |
| Approve            | `POST /mandate-drafts/:id/approve {previewHash}`                                                         | Must match the latest previewed revision; returns `ownerTransactions`                                    |
| Owner transactions | wallet → `setMandate(tuple)`, `approve(executor, amount)`, `fund(amount)`                                | Exactly as returned; amounts are exact                                                                   |
| Verify             | `POST /mandate-drafts/:id/authorization-check {txHash?}`                                                 | `202`; the worker sets `AUTHORIZED` only from confirmed chain state                                      |
| Monitor            | `GET /dashboard`, `GET /activity?before=&limit=`                                                         | Confirmed balances/positions; timeline with explorer links for real transactions only                    |
| Control            | wallet → `pause()`, `resume()`, `revoke()`, `recoverIdle()`, `ownerWithdraw()`                           | The worker observes the change and stops                                                                 |

**Choosing the agent (`operator`).** By default the mandate's operator is Boundra's agent (`OPERATOR_ADDRESS`). An owner who runs their own agent sends its address as `operator`. The preview then carries `operatorSource: "OWNER"` and, as its first notice, says that Boundra does not run or vouch for that agent; both are part of the hashed preview the owner approves. The operator may not be the owner, their executor, the zero address, a Boundra contract or the risk admin (`400 VALIDATION_FAILED`). Editing a draft keeps its operator unless the edit names another. A deployment without `OPERATOR_ADDRESS` runs no Boundra agent: `config/public` reports `operator: null` and every draft needs an `operator`. Boundra's worker keeps monitoring a mandate that names another agent (risk, expiry, escalation) but never transacts for it; it records `HOLD` with reason `OWNER_AGENT_<KIND>`.

Intent view fields: `state`, `question {questionId, dimension, text, alternatives, wordingSource}`, `answered[]`, `selection`, `candidates[] {vault, eligible, reasons}`, `narrowed[]`, `conflicts[]`. Drafts expose `status` (`PREVIEWED`, `APPROVED`, `AUTHORIZED`, `SUPERSEDED`, `REVOKED`, `EXPIRED`), `revision`, `tuple`, `preview` (with `plainSummary`, `notices`, testnet `labels`), `previewHash`, `mandateHash`, `onchainVersion`.

Activity types include `INTENT_CREATED`, `QUESTION_ANSWERED`, `MANDATE_PREVIEWED`, `MANDATE_APPROVED`, `AUTHORIZATION_CHECK_REQUESTED`, `MANDATE_AUTHORIZED`, `EXECUTOR_FUNDED`, `DECISION_HOLD`, `DECISION_ESCALATE`, `ACTION_PROPOSED`, `ACTION_REJECTED`, `ACTION_BROADCAST`, `ACTION_CONFIRMED`, `ACTION_FAILED`, `RISK_EVENT_OBSERVED`, `MANDATE_REVOKED`, `MANDATE_EXPIRED`, `MANDATE_SUPERSEDED`, `DEMO_RESET`. HOLD, ESCALATE and pre-broadcast rejections never carry a transaction hash.

## Admin and health

- `POST /admin/demo/reset {ownerAddress}` (wallets in `ADMIN_ADDRESSES`): closes that owner's open synthetic drafts/intents; chain evidence and history are untouched. Risk fixtures are triggered by the risk-admin wallet calling `setRiskState` directly.
- `GET /health/live`; `GET /health/ready` reports PostgreSQL, the worker heartbeat and `worker` mode (`observe_only`, `monitor_only`, `execute`). `executionEnabled` is true only in `execute` mode.

## Configuration

See `.env.example`. API-specific: `WEB_ORIGIN`, `SESSION_SECRET` (required in production; generated by `pnpm env:setup`), `ADMIN_ADDRESSES`, `DEPLOYMENT_MANIFEST_PATH`, `BASE_SEPOLIA_RPC_URL`, `CHAIN_CONFIRMATIONS`, `OPERATOR_ADDRESS` (public address only), `TRUST_PROXY`, rate limits and `LLM_*` (see [acce.md](./acce.md)).
