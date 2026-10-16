import type { Metadata } from 'next';
import { OwnerApp } from '@/components/app/owner-app';
import '@/components/app/app.css';

export const metadata: Metadata = {
  title: 'Boundra app · Base Sepolia testnet',
  description: 'Set boundaries for your agent wallet on Base Sepolia.',
};

export default function AppPage() {
  return <OwnerApp />;
}
