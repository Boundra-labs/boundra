'use client';

import { useState } from 'react';
import { isApiError } from '@/lib/api';
import {
  useApiTokens,
  useCreateApiToken,
  useRevokeApiToken,
  type NewApiToken,
} from '@/lib/api-tokens';
import { SignInOriginError } from '@/lib/session';
import { walletErrorMessage } from '@/lib/wallet-errors';
import { useOwnerSession } from './access-gate';

const timeText = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

function createProblem(error: unknown) {
  if (error instanceof SignInOriginError) return error.message;
  if (isApiError(error))
    return error.recovery ? `${error.message}. ${error.recovery}` : error.message;
  return walletErrorMessage(error, 'created');
}

/** The new token, shown once, with the MCP configuration that uses it. */
function NewToken({ created }: { created: NewApiToken }) {
  const [copied, setCopied] = useState(false);
  const origin = window.location.origin;
  const config = JSON.stringify(
    {
      mcpServers: {
        boundra: {
          command: 'node',
          args: ['/path/to/boundra/apps/mcp/dist/main.js'],
          env: { BOUNDRA_APP_URL: origin, BOUNDRA_API_TOKEN: created.token },
        },
      },
    },
    null,
    2,
  );
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(created.token);
      setCopied(true);
    } catch {
      // Clipboard access can be refused; the token stays selectable on the page.
    }
  };
  return (
    <div className="new-token" role="status">
      <p className="panel-heading">Your new API token</p>
      <p className="field-note">
        Copy it now: Boundra keeps only a fingerprint and cannot show it again. It works until{' '}
        {timeText(created.expiresAt)}.
      </p>
      <div className="token-value">
        <code className="mono" aria-label="API token">
          {created.token}
        </code>
        <button className="button button-quiet" type="button" onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <details className="token-config">
        <summary>Use it with Claude or another MCP client</summary>
        <pre className="mono">{config}</pre>
      </details>
    </div>
  );
}

/**
 * Lets the owner give an app or AI assistant an API token (SDK or MCP server), see the tokens
 * they gave out and revoke any of them. A token reads the account and prepares mandates; it can
 * never approve one, sign a transaction or move funds.
 */
export function ConnectApps() {
  const session = useOwnerSession();
  const tokens = useApiTokens();
  const create = useCreateApiToken();
  const revoke = useRevokeApiToken(session.csrfToken);
  const [created, setCreated] = useState<NewApiToken | null>(null);

  const start = async () => {
    setCreated(null);
    try {
      setCreated(await create.mutateAsync(session.address as `0x${string}`));
    } catch {
      // Shown below from the mutation's error.
    }
  };

  return (
    <div className="connect-page">
      <section className="panel" aria-labelledby="connect-heading">
        <p className="gate-eyebrow">Apps and AI assistants · Base Sepolia testnet</p>
        <h1 id="connect-heading" className="gate-title">
          Connect an app or AI assistant
        </h1>
        <p className="gate-lede">
          An API token lets an app built with the Boundra SDK, or an AI assistant through the
          Boundra MCP server, work with your account.
        </p>
        <ul className="review-list">
          <li>
            <strong>It can</strong> read your agent’s status and activity, set up goals, and draft
            mandates for you to review, including one for an agent of your own.
          </li>
          <li>
            <strong>It cannot</strong> approve a mandate, sign a transaction or move funds. You
            approve here and sign in your own wallet.
          </li>
        </ul>
        <div className="form-actions">
          <button
            className="button"
            type="button"
            disabled={create.isPending}
            onClick={() => void start()}
          >
            {create.isPending ? 'Waiting for your wallet…' : 'Create an API token'}
          </button>
        </div>
        <p className="field-note">
          Your wallet asks you to sign a message describing the token. It is not a transaction and
          costs no gas.
        </p>
        {create.isError && <p className="gate-problem">{createProblem(create.error)}</p>}
        {created && <NewToken created={created} />}
      </section>

      <section className="panel" aria-labelledby="tokens-heading">
        <h2 id="tokens-heading" className="panel-heading">
          Tokens you gave out
        </h2>
        {tokens.isPending ? (
          <p className="field-note">Loading…</p>
        ) : tokens.isError ? (
          <p className="gate-problem">
            Your tokens could not be loaded.{' '}
            <button className="text-link" type="button" onClick={() => void tokens.refetch()}>
              Try again
            </button>
          </p>
        ) : tokens.data.items.length === 0 ? (
          <p className="field-note">None. Apps and assistants have no access to your account.</p>
        ) : (
          <ul className="token-list">
            {tokens.data.items.map((token) => (
              <li key={token.id} className="token-item">
                <span>
                  Created {timeText(token.createdAt)} · last used {timeText(token.lastSeenAt)} ·
                  expires {timeText(token.expiresAt)}
                </span>
                <button
                  className="button button-quiet"
                  type="button"
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate(token.id)}
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
        {revoke.isError && (
          <p className="gate-problem">
            {isApiError(revoke.error) ? revoke.error.message : 'The token could not be revoked.'}{' '}
            Try again.
          </p>
        )}
      </section>
    </div>
  );
}
