import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const envPath = fileURLToPath(new URL('../.env', import.meta.url));
// Per-installation secrets, generated locally and never committed.
const generated = {
  SESSION_SECRET: () => randomBytes(32).toString('base64url'),
  ATTEMPT_ENCRYPTION_KEY: () => randomBytes(32).toString('hex'),
};

if (existsSync(envPath)) {
  const current = readFileSync(envPath, 'utf8');
  const missing = Object.keys(generated).filter(
    (key) => !new RegExp(`^${key}=.+`, 'm').test(current),
  );
  if (missing.length === 0) {
    console.log('.env already exists; left unchanged.');
  } else {
    const lines = missing.map((key) => `${key}=${generated[key]()}`).join('\n');
    appendFileSync(envPath, `${current.endsWith('\n') ? '' : '\n'}${lines}\n`);
    console.log(`.env already exists; added missing generated secrets: ${missing.join(', ')}.`);
  }
} else {
  const password = randomBytes(24).toString('hex');
  let example = readFileSync(new URL('../.env.example', import.meta.url), 'utf8').replaceAll(
    'replace-with-a-local-password',
    password,
  );
  for (const [key, make] of Object.entries(generated))
    example = example.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${make()}`);
  writeFileSync(envPath, example, { mode: 0o600, flag: 'wx' });
  console.log('Created .env with a unique local database password and generated secrets.');
}
