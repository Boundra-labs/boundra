import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import type { NextConfig } from 'next';

loadEnv({ path: resolve(process.cwd(), '../../.env'), quiet: true });

const config: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: resolve(process.cwd(), '../..'),
  transpilePackages: ['@boundra/shared'],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};

export default config;
