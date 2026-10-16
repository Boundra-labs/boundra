'use client';

import { BASE_SEPOLIA_CHAIN_ID } from '@boundra/shared';
import type { ReactNode } from 'react';
import { injected, useConnect, useConnection, useSwitchChain } from 'wagmi';
import { isApiError } from '@/lib/api';
import { SignInOriginError, useSession, useSignIn, useSignOut, type Session } from '@/lib/session';
import { walletErrorMessage } from '@/lib/wallet-errors';
import { shortAddress } from './format';

type StepState = 'done' | 'active' | 'upcoming';

function Step({
  index,
  title,
  state,
  children,
}: {
  index: number;
  title: string;
  state: StepState;
  children?: ReactNode;
}) {
  return (
    <li className={`gate-step is-${state}`} aria-current={state === 'active' ? 'step' : undefined}>
      <span className="gate-step-mark" aria-hidden="true">
        {state === 'done' ? '✓' : index}
      </span>
      <div className="gate-step-body">
        <h2 className="gate-step-title">
          {title}
          <span className="visually-hidden">
            {state === 'done' ? ' (done)' : state === 'upcoming' ? ' (not started)' : ''}
          </span>
        </h2>
        {state === 'active' && children}
      </div>
    </li>
  );
}

function Problem({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="gate-problem">
      {children}
    </p>
  );
}

function signInProblem(error: unknown) {
  if (error instanceof SignInOriginError)
    return (
      <>
        Sign-in is set up for <a href={error.expectedOrigin}>{error.expectedOrigin}</a>. Open
        Boundra at that address to sign in.
      </>
    );
  if (isApiError(error, 'RATE_LIMITED'))
    return 'Too many sign-in attempts. Wait a minute, then try again.';
  return walletErrorMessage(error, 'signed');
}

/**
 * Every owner screen sits behind three checks, in order: a connected wallet, Base Sepolia, and
 * a signed-in session for that same wallet. Signing in is a message signature, not a
 * transaction, and never approves a mandate.
 */
export function AccessGate({ children }: { children: (session: Session) => ReactNode }) {
  const connection = useConnection();
  const connect = useConnect();
  const switchChain = useSwitchChain();
  const session = useSession();
  const signIn = useSignIn();
  const signOut = useSignOut();

  if (session.isPending || connection.status === 'reconnecting')
    return (
      <div className="gate-loading" role="status">
        Checking your wallet and session…
      </div>
    );

  if (session.isError)
    return (
      <section className="gate-card" aria-labelledby="gate-down">
        <h1 id="gate-down" className="gate-title">
          Boundra is unavailable right now
        </h1>
        <p className="gate-lede">
          {isApiError(session.error) && session.error.recovery
            ? session.error.recovery
            : 'The app could not reach its services. Nothing was signed or sent.'}
        </p>
        <button className="button" onClick={() => void session.refetch()}>
          Try again
        </button>
      </section>
    );

  const address = connection.address;
  const connected = connection.isConnected && Boolean(address);
  const onBaseSepolia = connection.chainId === BASE_SEPOLIA_CHAIN_ID;
  const current = session.data;

  if (current && connected && onBaseSepolia && current.address === address!.toLowerCase())
    return children(current);

  // Signed in, but the wallet now shows a different account than the session belongs to.
  if (current && connected && current.address !== address!.toLowerCase())
    return (
      <section className="gate-card" aria-labelledby="gate-mismatch">
        <h1 id="gate-mismatch" className="gate-title">
          Your wallet switched accounts
        </h1>
        <p className="gate-lede">
          You are signed in as <strong>{shortAddress(current.address)}</strong>, but your wallet is
          now using <strong>{shortAddress(address!)}</strong>. Switch back in your wallet, or sign
          out and sign in with this account.
        </p>
        <button
          className="button"
          disabled={signOut.isPending}
          onClick={() => signOut.mutate(current)}
        >
          {signOut.isPending ? 'Signing out…' : 'Sign out'}
        </button>
        {signOut.isError && <Problem>Could not sign out. Try again.</Problem>}
      </section>
    );

  const step = !connected ? 1 : !onBaseSepolia ? 2 : 3;
  const stateOf = (index: number): StepState =>
    index < step ? 'done' : index === step ? 'active' : 'upcoming';

  return (
    <section className="gate-card" aria-labelledby="gate-heading">
      <p className="gate-eyebrow">Base Sepolia testnet · Mock assets only</p>
      <h1 id="gate-heading" className="gate-title">
        {current ? 'Reconnect to continue' : 'Sign in to Boundra'}
      </h1>
      <p className="gate-lede">
        {current
          ? `You are signed in as ${shortAddress(current.address)}. Reconnect that wallet on Base Sepolia to continue.`
          : 'Three quick checks before you set any boundaries. None of them moves funds or approves a mandate.'}
      </p>

      <ol className="gate-steps">
        <Step index={1} title="Connect your wallet" state={stateOf(1)}>
          <p>Boundra reads your wallet address. Connecting never approves anything.</p>
          <button
            className="button"
            disabled={connect.isPending}
            onClick={() => connect.mutate({ connector: injected() })}
          >
            {connect.isPending ? 'Waiting for your wallet…' : 'Connect wallet'}
          </button>
          {connect.isError && <Problem>{walletErrorMessage(connect.error, 'connected')}</Problem>}
        </Step>

        <Step index={2} title="Use Base Sepolia" state={stateOf(2)}>
          <p>
            Boundra is a testnet prototype. Your wallet is on another network
            {connection.chainId ? ` (chain ${connection.chainId})` : ''}.
          </p>
          <button
            className="button"
            disabled={switchChain.isPending}
            onClick={() => switchChain.mutate({ chainId: BASE_SEPOLIA_CHAIN_ID })}
          >
            {switchChain.isPending ? 'Confirm in your wallet…' : 'Switch to Base Sepolia'}
          </button>
          {switchChain.isError && (
            <Problem>{walletErrorMessage(switchChain.error, 'changed')}</Problem>
          )}
        </Step>

        <Step
          index={3}
          title={current ? 'Signed in' : 'Sign in'}
          state={current ? 'done' : stateOf(3)}
        >
          <p>
            Sign a message to prove you own this wallet. It is not a transaction and costs no gas.
          </p>
          <button
            className="button"
            disabled={signIn.isPending}
            onClick={() => signIn.mutate(address!)}
          >
            {signIn.isPending ? 'Check your wallet…' : 'Sign in with wallet'}
          </button>
          {signIn.isError && <Problem>{signInProblem(signIn.error)}</Problem>}
        </Step>
      </ol>
    </section>
  );
}
