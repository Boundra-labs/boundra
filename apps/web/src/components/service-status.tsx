'use client';

import { useQuery } from '@tanstack/react-query';

export function ServiceStatus() {
  const status = useQuery({
    queryKey: ['platform-readiness'],
    queryFn: async () => {
      const response = await fetch('/status', { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error('Services are not ready');
      return response.json() as Promise<{ status: string }>;
    },
    refetchInterval: 15_000,
  });
  return (
    <div className="service-status" aria-live="polite">
      <span className={`status-dot ${status.isSuccess ? 'online' : ''}`} />
      {status.isPending
        ? 'Checking services…'
        : status.isSuccess
          ? 'API, database & worker connected'
          : 'Services unavailable · Start API, database & worker'}
    </div>
  );
}
