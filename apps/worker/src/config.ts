import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.url().refine((value) => /^postgres(ql)?:/.test(value)),
  CHAIN_ID: z.coerce.number().pipe(z.literal(84532)).default(84532),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(1000).max(30000).default(10000),
  WORKER_HEARTBEAT_MAX_AGE_MS: z.coerce.number().int().min(1000).default(45000),
});

export function readWorkerConfig() {
  const result = schema.safeParse(process.env);
  if (!result.success)
    throw new Error('Invalid worker configuration; check required environment variables');
  return result.data;
}
