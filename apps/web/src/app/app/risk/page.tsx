import type { Metadata } from 'next';
import { RiskAdmin } from '@/components/app/risk-admin';

export const metadata: Metadata = { title: 'Vault conditions · Boundra' };

export default function RiskPage() {
  return <RiskAdmin />;
}
