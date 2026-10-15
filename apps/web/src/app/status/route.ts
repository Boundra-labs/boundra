export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const baseUrl = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:3001';
    const response = await fetch(new URL('/api/v1/health/ready', baseUrl), {
      cache: 'no-store',
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) throw new Error('Dependency degraded');
    return Response.json({ status: 'ok', executionEnabled: false });
  } catch {
    return Response.json({ status: 'degraded', executionEnabled: false }, { status: 503 });
  }
}
