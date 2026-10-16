'use client';

import type { Address } from 'viem';
import { formatMockUsdc } from '@/lib/amount';
import { useAccountReadiness, type AccountReadiness } from '@/lib/readiness';
import { useOwnerSession } from './access-gate';
import { AccountSetup } from './account-setup';
import { shortAddress } from './format';
import { StartIntent } from './start-intent';

function Aside({ readiness }: { readiness: AccountReadiness }) {
  return (
    <aside className="panel panel-quiet" aria-labelledby="how-heading">
      {readiness.ready && (
        <div className="account-summary">
          <h2 className="panel-heading">Your account</h2>
          <dl>
            <div>
              <dt>Executor</dt>
              <dd title={readiness.executor.registered!}>
                {shortAddress(readiness.executor.registered!)}
              </dd>
            </div>
            <div>
              <dt>Available</dt>
              <dd>{formatMockUsdc(readiness.usdc.total!)}</dd>
            </div>
          </dl>
        </div>
      )}
      <h2 id="how-heading" className="panel-heading">
        How it works
      </h2>
      <ol className="how-list">
        <li>
          <strong>Clarify.</strong> Up to five questions, and only when your answer changes what the
          agent may do. “I am not sure” always picks the more cautious limit.
        </li>
        <li>
          <strong>Review.</strong> You see the exact mandate: vault, amounts and expiry.
        </li>
        <li>
          <strong>Authorize.</strong> Nothing is enforced until you sign it with your wallet.
        </li>
      </ol>
      <p className="field-note">
        Base Sepolia testnet · MockUSDC and mock vaults · yields are illustrative only.
      </p>
    </aside>
  );
}

/** `/app`: one-time account setup until the owner is ready, then a new goal. */
export function OwnerHome({ initialGoal }: { initialGoal: string }) {
  const session = useOwnerSession();
  const owner = session.address as Address;
  const readiness = useAccountReadiness(owner);

  if (readiness.loading)
    return (
      <div className="gate-loading" role="status">
        Checking your account…
      </div>
    );

  if (!readiness.configured || readiness.failed)
    return (
      <section className="gate-card" aria-labelledby="home-unavailable">
        <h1 id="home-unavailable" className="gate-title">
          {readiness.failed
            ? 'Your account could not be read'
            : 'Boundra’s contracts are not configured yet'}
        </h1>
        <p className="gate-lede">
          {readiness.failed
            ? 'The chain or Boundra’s services did not answer. Nothing was sent.'
            : 'This server has no reviewed deployment, so balances, setup and new goals are unavailable.'}
        </p>
        {readiness.failed && (
          <button className="button" onClick={() => void readiness.refresh()}>
            Try again
          </button>
        )}
      </section>
    );

  return (
    <div className="flow">
      {readiness.ready ? (
        <StartIntent initialGoal={initialGoal} available={readiness.usdc.total} />
      ) : (
        <AccountSetup owner={owner} readiness={readiness} />
      )}
      <Aside readiness={readiness} />
    </div>
  );
}
