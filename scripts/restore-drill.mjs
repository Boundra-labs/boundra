#!/usr/bin/env node
/**
 * Restore drill (task-assignment §5): restores a backup into a separate, throwaway PostgreSQL
 * instance and proves it is usable, without touching the running database.
 *
 *   node scripts/restore-drill.mjs [path/to/boundra-<stamp>.dump]   (default: newest in BACKUP_DIR)
 *
 * Checks: the dump's SHA-256 matches its .sha256 file; pg_restore succeeds with no errors; every
 * table's row count matches the count recorded at backup time (exact, or within the recorded
 * range for tables written to during the dump); and Prisma's `migrate status` reports the
 * restored schema up to date. Writes <dump>.drill.json and exits non-zero on any failure. The
 * temporary instance is always removed.
 */
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const repo = resolve(import.meta.dirname, '..');
const IMAGE = 'postgres:17.9-alpine';
const started = Date.now();

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 1 << 28, ...options });
  if (result.status !== 0)
    throw new Error(
      `${command} ${args.slice(0, 3).join(' ')} failed: ${result.stderr || result.stdout}`,
    );
  return result.stdout.trim();
}

function newestDump(dir) {
  const dumps = existsSync(dir) ? readdirSync(dir).filter((f) => /^boundra-.*\.dump$/.test(f)) : [];
  if (dumps.length === 0) throw new Error(`No backups in ${dir}. Run pnpm db:backup first.`);
  return join(dir, dumps.sort().at(-1));
}

const dump = resolve(
  process.argv[2] ?? newestDump(resolve(repo, process.env.BACKUP_DIR ?? 'backups')),
);
const metadata = JSON.parse(readFileSync(dump.replace(/\.dump$/, '.json'), 'utf8'));
const checks = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`);
};

// 1. Integrity of the file itself.
const bytes = readFileSync(dump);
const expected = readFileSync(`${dump}.sha256`, 'utf8').split(/\s+/)[0];
const actual = createHash('sha256').update(bytes).digest('hex');
check('checksum matches', actual === expected, `${bytes.length} bytes`);

// 2. A separate PostgreSQL instance, never the running one.
const container = `boundra-restore-drill-${randomBytes(3).toString('hex')}`;
const password = randomBytes(18).toString('base64url');
const database = 'boundra_restore';
let report;
try {
  run('docker', [
    'run',
    '-d',
    '--rm',
    '--name',
    container,
    '-e',
    `POSTGRES_PASSWORD=${password}`,
    '-e',
    `POSTGRES_DB=${database}`,
    '-p',
    '127.0.0.1::5432',
    IMAGE,
  ]);
  const psql = (sql) =>
    run('docker', ['exec', container, 'psql', '-U', 'postgres', '-d', database, '-Atq', '-c', sql]);
  for (let i = 0; ; i++) {
    // pg_isready can pass during the image's init restart; a real query is the readiness test.
    const probe = spawnSync(
      'docker',
      ['exec', container, 'psql', '-U', 'postgres', '-d', database, '-Atqc', 'SELECT 1'],
      { encoding: 'utf8' },
    );
    if (probe.status === 0 && probe.stdout.trim() === '1') break;
    if (i > 120) throw new Error('restore instance did not start');
    await new Promise((r) => setTimeout(r, 500));
  }

  // 3. Restore; any error aborts.
  run(
    'docker',
    [
      'exec',
      '-i',
      container,
      'pg_restore',
      '-U',
      'postgres',
      '-d',
      database,
      '--no-owner',
      '--exit-on-error',
    ],
    { input: bytes },
  );
  check('pg_restore completed without errors', true);

  // 4. Row counts against what the backup recorded.
  const mismatches = [];
  for (const [table, recorded] of Object.entries(metadata.rowCounts)) {
    const restored = Number(psql(`SELECT count(*) FROM public."${table}"`));
    const [min, max] = Array.isArray(recorded) ? recorded : [recorded, recorded];
    if (restored < min || restored > max)
      mismatches.push(`${table}: ${restored}, recorded ${JSON.stringify(recorded)}`);
  }
  check(
    'row counts match the backup',
    mismatches.length === 0,
    mismatches.join('; ') || `${Object.keys(metadata.rowCounts).length} tables`,
  );
  const migrations = Number(
    psql('SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL'),
  );
  check('migrations recorded', migrations === metadata.migrations, `${migrations} applied`);

  // 5. The application's own migration tool sees an up-to-date schema.
  const port = run('docker', ['port', container, '5432/tcp']).split('\n')[0].split(':').at(-1);
  const status = spawnSync(
    process.execPath,
    [join(repo, 'packages/database/node_modules/prisma/build/index.js'), 'migrate', 'status'],
    {
      cwd: join(repo, 'packages/database'),
      encoding: 'utf8',
      env: {
        ...process.env,
        DATABASE_URL: `postgresql://postgres:${password}@127.0.0.1:${port}/${database}?schema=public`,
      },
    },
  );
  check(
    'prisma migrate status: up to date',
    status.status === 0 && /up to date/i.test(status.stdout),
    status.status === 0 ? undefined : (status.stdout + status.stderr).trim().split('\n').at(-1),
  );
} catch (error) {
  check('drill ran to completion', false, error.message.split('\n')[0]);
} finally {
  spawnSync('docker', ['rm', '-f', container], { encoding: 'utf8' });
  const ok = checks.every((c) => c.ok);
  report = {
    dump: basename(dump),
    backupCreatedAt: metadata.createdAt,
    drilledAt: new Date().toISOString(),
    restoreInstance: `${IMAGE} (separate container, removed afterwards)`,
    durationSeconds: Math.round((Date.now() - started) / 100) / 10,
    ok,
    checks,
  };
  writeFileSync(
    join(dirname(dump), basename(dump).replace(/\.dump$/, '.drill.json')),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(
    `${ok ? 'Restore drill passed' : 'Restore drill FAILED'} in ${report.durationSeconds}s`,
  );
  process.exitCode = ok ? 0 : 1;
}
