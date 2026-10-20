import { apiInternalUrl } from '@/lib/api-upstream';

/**
 * Same-origin proxy to the Boundra API. Sessions use a first-party `__Host-` cookie and every
 * state change is checked against `WEB_ORIGIN`, so the browser must reach the API through the
 * web origin. In a public Compose deployment Caddy routes `/api/*` straight to the API; this
 * handler covers `next dev`, the Compose stack and Render, where only the web app is exposed.
 *
 * The upstream is read per request (not baked in at build time like a rewrite), and only
 * `/api/v1/*` paths are forwarded. SDK and MCP clients' bearer API tokens pass through too.
 */
export const dynamic = 'force-dynamic';

const FORWARDED_REQUEST_HEADERS = [
  'accept',
  'authorization',
  'content-type',
  'cookie',
  'origin',
  'user-agent',
  'x-csrf-token',
  'x-forwarded-for',
];
// fetch() has already decoded the body, so its encoding and length no longer apply.
const DROPPED_RESPONSE_HEADERS = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'keep-alive',
  'set-cookie',
  'transfer-encoding',
]);

function unavailable() {
  return Response.json(
    {
      error: {
        code: 'DEPENDENCY_UNAVAILABLE',
        message: 'Boundra services are unavailable',
        recovery: 'Start the API, database and worker, then try again.',
      },
    },
    { status: 503 },
  );
}

async function proxy(request: Request) {
  const { pathname, search } = new URL(request.url);
  if (!pathname.startsWith('/api/v1/'))
    return Response.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 });

  const upstream = new URL(pathname + search, apiInternalUrl());
  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';

  let response: Response;
  try {
    response = await fetch(upstream, {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return unavailable();
  }

  const out = new Headers();
  response.headers.forEach((value, name) => {
    if (!DROPPED_RESPONSE_HEADERS.has(name)) out.set(name, value);
  });
  for (const cookie of response.headers.getSetCookie()) out.append('set-cookie', cookie);
  return new Response(response.status === 204 ? null : response.body, {
    status: response.status,
    headers: out,
  });
}

export { proxy as DELETE, proxy as GET, proxy as HEAD, proxy as PATCH, proxy as POST };
