import { config } from 'dotenv';
import { resolve } from 'node:path';
import { defineConfig } from 'prisma/config';

config({ path: resolve(__dirname, '../../.env'), quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    // Generation/build does not open a connection; CLI migrations require DATABASE_URL.
    url: process.env.DATABASE_URL ?? 'postgresql://unused:unused@localhost:55432/boundra',
  },
});
