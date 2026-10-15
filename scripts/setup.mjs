import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const envPath = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envPath)) {
  console.log('.env already exists; left unchanged.');
} else {
  const password = randomBytes(24).toString('hex');
  const example = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  writeFileSync(envPath, example.replaceAll('replace-with-a-local-password', password), {
    mode: 0o600,
    flag: 'wx',
  });
  console.log('Created .env with a unique local database password.');
}
