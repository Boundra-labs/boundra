export const dynamic = 'force-dynamic';

const RELEASE = process.env.BOUNDRA_RELEASE ?? 'dev';

/**
 * Same-origin readiness for the footer and for monitoring: the API's readiness (PostgreSQL and a
 * fresh worker heartbeat), the worker's activation mode and the running releases.
 */
export async function GET() {
  try {
    const baseUrl = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:3001';
    const response = await fetch(new URL('/api/v1/health/ready', baseUrl), {
      cache: 'no-store',
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) throw new Error('Dependency degraded');
    const ready = (await response.json()) as {
      release?: string;
      worker?: string;
      executionEnabled?: boolean;
    };
    return Response.json({
      status: 'ok',
      worker: ready.worker ?? 'unknown',
      executionEnabled: ready.executionEnabled === true,
      release: { web: RELEASE, api: ready.release ?? 'unknown' },
    });
  } catch {
    return Response.json(
      { status: 'degraded', executionEnabled: false, release: { web: RELEASE, api: null } },
      { status: 503 },
    );
  }
}
