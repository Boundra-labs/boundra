'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { maxUint256, type Address, type Hash } from 'viem';
import { VAULTS } from '@/lib/acce-copy';
import { formatMockUsdc, parseMockUsdc } from '@/lib/amount';
import { vaultAbi } from '@/lib/contracts';
import { usePublicConfig } from '@/lib/public-config';
import { isBusy, useOwnerTransaction, type RevertExplainer } from '@/lib/transactions';
import { useVaultConditions, type VaultCondition } from '@/lib/vault-risk';
import { useOwnerSession } from './access-gate';
import { shortAddress } from './format';
import { TransactionStatus, TxLink } from './transaction-status';

const RISK_LEVEL = { NORMAL: 0, DEGRADED: 1 } as const;

const explainRiskChange: RevertExplainer = (name) =>
  ({
    OwnableUnauthorizedAccount:
      'Only the risk admin wallet can change vault conditions. Switch to it and try again.',
  })[name];

const describeCapacity = (capacity: bigint | null) =>
  capacity === null ? 'Unlimited' : formatMockUsdc(capacity);

/** True when the signed-in wallet is the deployment's risk admin (the vaults' on-chain owner). */
export function useIsRiskAdmin() {
  const session = useOwnerSession();
  const config = usePublicConfig();
  const admin = config.data?.contracts?.riskAdmin;
  return Boolean(admin && admin.toLowerCase() === session.address.toLowerCase());
}

/** The capacity the admin typed: null = unlimited; 0 is allowed and refuses every withdrawal. */
function readCapacity(limited: boolean, text: string) {
  if (!limited) return { ok: true as const, capacity: null };
  const parsed = parseMockUsdc(text);
  if (parsed.ok) return { ok: true as const, capacity: BigInt(parsed.baseUnits) };
  if (parsed.reason === 'ZERO') return { ok: true as const, capacity: 0n };
  return {
    ok: false as const,
    problem:
      parsed.reason === 'EMPTY'
        ? 'Enter a capacity, or choose unlimited withdrawals.'
        : 'Use a plain number like 100 or 12.5.',
  };
}

function VaultCard({
  vaultKey,
  address,
  condition,
  admin,
  account,
  onChanged,
}: {
  vaultKey: 'LIQUID' | 'TIMED';
  address: Address;
  condition: VaultCondition;
  admin: boolean;
  account: Address;
  onChanged: () => void;
}) {
  const id = useId();
  const name = VAULTS[vaultKey].name;
  const degraded = condition.risk === 'DEGRADED';
  const tx = useOwnerTransaction(account, explainRiskChange);
  const [limited, setLimited] = useState(false);
  const [capacityText, setCapacityText] = useState('');
  const [touched, setTouched] = useState(false);
  // The last confirmed change; kept after the buttons swap for the new state.
  const [notice, setNotice] = useState<{ text: string; hash: Hash } | null>(null);
  const capacity = readCapacity(limited, capacityText);
  // A public RPC endpoint can answer from a node a block or two behind the receipt, so keep
  // re-reading until the vault shows the confirmed risk level, for at most a minute, with the
  // buttons disabled meanwhile so the change is not sent twice.
  const [expected, setExpected] = useState<keyof typeof RISK_LEVEL | null>(null);
  const reread = useRef(onChanged);
  reread.current = onChanged;
  const shown = expected === null || condition.risk === expected;
  useEffect(() => {
    if (expected === null) return;
    if (shown) {
      setExpected(null);
      return;
    }
    const timer = setInterval(() => reread.current(), 2000);
    const stop = setTimeout(() => setExpected(null), 60_000);
    return () => {
      clearInterval(timer);
      clearTimeout(stop);
    };
  }, [expected, shown]);
  const busy = isBusy(tx.state) || expected !== null;

  const apply = async (level: keyof typeof RISK_LEVEL, value: bigint | null, text: string) => {
    setNotice(null);
    const state = await tx.send({
      address,
      abi: vaultAbi,
      functionName: 'setRiskState',
      args: [RISK_LEVEL[level], value ?? maxUint256],
    });
    if (state.phase !== 'confirmed') return;
    setNotice({ text, hash: state.hash });
    tx.reset();
    setTouched(false);
    onChanged();
    setExpected(level);
  };

  const option = (value: boolean, label: string, hint: string) => (
    <label className={`option${limited === value ? ' is-chosen' : ''}`}>
      <input
        type="radio"
        name={`${id}-capacity`}
        checked={limited === value}
        onChange={() => setLimited(value)}
      />
      <span className="option-text">
        <span>{label}</span>
        <small>{hint}</small>
      </span>
    </label>
  );

  return (
    <section className="panel vault-condition" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} className="panel-heading">
        {name}{' '}
        <span className={`pill ${degraded ? 'pill-warn' : 'pill-quiet'}`}>
          {degraded ? 'Degraded' : 'Normal'}
        </span>
      </h2>
      <dl className="funds">
        <div>
          <dt>New deposits</dt>
          <dd>{degraded ? 'Refused' : 'Accepted'}</dd>
        </div>
        <div>
          <dt>Withdrawal capacity</dt>
          <dd>{describeCapacity(condition.capacity)}</dd>
        </div>
        <div>
          <dt>Held for demo positions</dt>
          <dd>{formatMockUsdc(condition.totalPrincipal)}</dd>
        </div>
      </dl>

      {notice && (
        <p className="tx-status is-confirmed" role="status">
          {notice.text} (<TxLink hash={notice.hash} />)
        </p>
      )}

      {admin && (
        <form
          className="form risk-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            setTouched(true);
            if (!capacity.ok) return;
            void apply(
              'DEGRADED',
              capacity.capacity,
              degraded
                ? `${name}’s withdrawal capacity is now ${describeCapacity(capacity.capacity).toLowerCase()}.`
                : `${name} is now degraded.`,
            );
          }}
        >
          <fieldset className="field" disabled={busy}>
            <legend>
              {degraded ? 'Change the withdrawal capacity' : 'Simulate degraded conditions'}
            </legend>
            <div className="options">
              {option(false, 'Withdrawals unlimited', 'Only new deposits are refused.')}
              {option(
                true,
                'Limit total withdrawals',
                'Shared by every position in this vault; each withdrawal uses some of it.',
              )}
            </div>
            {limited && (
              <div className="field">
                <label htmlFor={`${id}-amount`}>Capacity</label>
                <div className="amount-input">
                  <input
                    id={`${id}-amount`}
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="100"
                    value={capacityText}
                    aria-invalid={touched && !capacity.ok}
                    aria-describedby={`${id}-amount-note`}
                    onChange={(event) => setCapacityText(event.target.value)}
                  />
                  <span aria-hidden="true">MockUSDC</span>
                </div>
                <p
                  id={`${id}-amount-note`}
                  className={touched && !capacity.ok ? 'field-error' : 'field-note'}
                >
                  {touched && !capacity.ok ? capacity.problem : '0 refuses every withdrawal.'}
                </p>
              </div>
            )}
          </fieldset>
          <div className="form-actions">
            <button className="button" type="submit" disabled={busy}>
              {degraded ? `Update ${name}’s capacity` : `Mark ${name} degraded`}
            </button>
            {degraded && (
              <button
                type="button"
                className="button button-quiet"
                disabled={busy}
                onClick={() =>
                  void apply('NORMAL', null, `${name} is back to normal, withdrawals unlimited.`)
                }
              >
                Restore {name} to normal
              </button>
            )}
          </div>
          <TransactionStatus state={tx.state} confirmedText="Vault condition changed." />
        </form>
      )}
    </section>
  );
}

/**
 * Demo risk fixtures (PRD §13.1): the risk admin's own wallet calls `setRiskState` on a mock
 * vault. The server holds no admin key; this page only prepares the transaction.
 */
export function RiskAdmin() {
  const session = useOwnerSession();
  const config = usePublicConfig();
  const admin = useIsRiskAdmin();
  const contracts = config.data?.contracts;
  const conditions = useVaultConditions(
    contracts ? { liquid: contracts.liquidVault, timed: contracts.timedVault } : undefined,
  );

  if (config.isPending || (contracts && conditions.isPending))
    return (
      <div className="gate-loading" role="status">
        Reading vault conditions…
      </div>
    );
  if (!contracts)
    return (
      <section className="gate-card">
        <h1 className="gate-title">Vaults are not configured</h1>
        <p className="gate-lede">This deployment has no reviewed contract manifest yet.</p>
      </section>
    );
  if (conditions.isError || !conditions.liquid || !conditions.timed)
    return (
      <section className="gate-card">
        <h1 className="gate-title">Vault conditions could not be read</h1>
        <p className="gate-lede">
          The network did not answer. Check your connection and try again.
        </p>
        <button className="button" onClick={() => void conditions.refetch()}>
          Try again
        </button>
      </section>
    );

  const cards = [
    { key: 'LIQUID' as const, address: contracts.liquidVault, condition: conditions.liquid },
    { key: 'TIMED' as const, address: contracts.timedVault, condition: conditions.timed },
  ];
  return (
    <div className="risk-page">
      <section className="panel" aria-labelledby="risk-heading">
        <p className="gate-eyebrow">Demo admin · Base Sepolia testnet</p>
        <h1 id="risk-heading" className="gate-title">
          Vault conditions
        </h1>
        <p className="gate-lede">
          Simulate protocol conditions on Boundra’s mock vaults. A change applies to every demo
          position in that vault, for every owner, and never moves anyone’s funds.
        </p>
        <p className="field-note">
          Degraded refuses new deposits, and agents treat it as a reason to re-evaluate. A capacity
          limit refuses withdrawals beyond it, owners’ own included.
        </p>
        {!admin && (
          <p className="gate-problem">
            Only the risk admin wallet ({shortAddress(contracts.riskAdmin)}) can change these. You
            can still see the current conditions.
          </p>
        )}
      </section>
      <div className="risk-vaults">
        {cards.map((card) => (
          <VaultCard
            key={card.key}
            vaultKey={card.key}
            address={card.address}
            condition={card.condition}
            admin={admin}
            account={session.address as Address}
            onChanged={() => void conditions.refetch()}
          />
        ))}
      </div>
    </div>
  );
}
