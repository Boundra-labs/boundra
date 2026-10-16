'use client';

import type { ReactNode } from 'react';
import { BrandMark } from '@/components/brand-mark';
import { ServiceStatus } from '@/components/service-status';
import { useSession, useSignOut } from '@/lib/session';
import { shortAddress } from './format';

function AccountMenu() {
  const session = useSession();
  const signOut = useSignOut();
  const current = session.data;
  if (!current) return null;
  return (
    <div className="app-account">
      <span className="app-account-address" title={current.address}>
        <span className="status-dot online" aria-hidden="true" />
        {shortAddress(current.address)}
      </span>
      <button
        className="button button-quiet"
        disabled={signOut.isPending}
        onClick={() => signOut.mutate(current)}
      >
        {signOut.isPending ? 'Signing out…' : 'Sign out'}
      </button>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-inner">
          <a className="brand" href="/" aria-label="Boundra home">
            <BrandMark className="brand-mark" />
            <span className="wordmark">boundra</span>
          </a>
          <span className="testnet-badge">TESTNET</span>
          <AccountMenu />
        </div>
      </header>
      <main className="app-main">{children}</main>
      <footer className="app-footer">
        <ServiceStatus />
        <span>Base Sepolia · MockUSDC · Mock vaults. No real funds or investment returns.</span>
      </footer>
    </div>
  );
}
