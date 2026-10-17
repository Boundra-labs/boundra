'use client';

import { useQuery } from '@tanstack/react-query';

interface PlatformStatus {
  status: string;
  executionEnabled: boolean;
  release?: { web: string; api: string | null };
}

/**
 * Footer readiness from `/status`. "Connected" alone would overstate things while the worker is
 * not executing (monitor-only), so that case is said plainly: the agent will not act.
 */
export function ServiceStatus() {
  const status = useQuery({
    queryKey: ['platform-readiness'],
    queryFn: async () => {
      const response = await fetch('/status', { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error('Services are not ready');
      return response.json() as Promise<PlatformStatus>;
    },
    refetchInterval: 15_000,
  });
  const release = status.data?.release?.web;
  return (
    <div className="service-status" aria-live="polite">
      <span
        className={`status-dot ${status.isSuccess ? (status.data.executionEnabled ? 'online' : 'partial') : ''}`}
      />
      {status.isPending
        ? 'Checking services…'
        : status.isSuccess
          ? status.data.executionEnabled
            ? 'API, database & worker connected'
            : 'Connected · the agent is not executing transactions right now'
          : 'Services unavailable · Start API, database & worker'}
      {release && release !== 'dev' && <span className="service-release">Release {release}</span>}
    </div>
  );
}
