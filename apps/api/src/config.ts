import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  API_HOST: z.string().default('127.0.0.1'),
  DATABASE_URL: z.url().refine((value) => /^postgres(ql)?:/.test(value)),
  WEB_ORIGIN: z.url().default('http://localhost:3000'),
  CHAIN_ID: z.coerce.number().pipe(z.literal(84532)).default(84532),
  WORKER_HEARTBEAT_MAX_AGE_MS: z.coerce.number().int().min(1000).default(45000),
});

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new Error(
      `Invalid API configuration: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
    );
  }
  return result.data;
}
