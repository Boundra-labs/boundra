import type { Metadata } from 'next';
import { ConnectApps } from '@/components/app/connect-apps';

export const metadata: Metadata = { title: 'Apps and AI assistants · Boundra' };

export default function ConnectPage() {
  return <ConnectApps />;
}
