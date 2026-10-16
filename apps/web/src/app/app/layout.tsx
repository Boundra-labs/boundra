import type { Metadata } from 'next';
import { AccessGate } from '@/components/app/access-gate';
import { AppShell } from '@/components/app/app-shell';
import '@/components/app/app.css';

export const metadata: Metadata = {
  title: 'Boundra app · Base Sepolia testnet',
  description: 'Set boundaries for your agent wallet on Base Sepolia.',
};

/** Every owner page shares the shell and sits behind the wallet + network + session gate. */
export default function OwnerLayout({ children }: LayoutProps<'/app'>) {
  return (
    <AppShell>
      <AccessGate>{children}</AccessGate>
    </AppShell>
  );
}
