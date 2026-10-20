/**
 * Where the web server reaches the API. A bare host:port (Render's private-network address) is
 * plain HTTP inside the private network.
 */
export function apiInternalUrl(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.API_INTERNAL_URL || 'http://127.0.0.1:3001';
  return /^https?:\/\//.test(value) ? value : `http://${value}`;
}
