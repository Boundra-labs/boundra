import type { RunReport } from './run';

const pct = (value: { count: number; denominator: number; rate: number | null }) =>
  `${value.count}/${value.denominator}${value.rate === null ? '' : ` (${(value.rate * 100).toFixed(1)}%)`}`;

/** Human-readable report. It states its own limits and never claims superiority. */
export function toMarkdown(report: RunReport): string {
  const stub = Object.values(report.methods).some((m) => m.generators.includes('heuristic-stub'));
  const lines = [
    `# Boundra benchmark — ${report.split} split`,
    '',
    `- Fixture: \`${report.fixtureVersion}\` (sha256 \`${report.fixtureSha256.slice(0, 16)}…\`), frozen: ${report.frozen}`,
    `- Provenance: ${report.provenance}`,
    `- Versions: ACCE config \`${report.versions.acceConfig}\`, descriptors \`${report.versions.descriptors}\`, one-shot prompt \`${report.versions.prompt}\``,
    `- Provider: ${report.provider.name}${report.provider.model ? ` (${report.provider.model})` : ''}`,
    `- Generated: ${report.generatedAt}`,
    '',
    '> Synthetic personas; results do not describe real users. Mismatch = a mandate that breaks at least one non-negotiable preference. Escalations and rejected drafts stay in every denominator.',
  ];
  if (stub)
    lines.push(
      '>',
      '> **B0/B1 used the keyword `heuristic-stub`, not a language model** (no provider configured or the provider failed). These rows are not AI results.',
    );
  lines.push(
    '',
    '| Method | Draft mismatch | Approved mismatch | Completion | Acceptable action | False refusal | No mandate | Questions (mean / median) | Tokens in / out |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  );
  for (const [method, m] of Object.entries(report.methods))
    lines.push(
      `| ${method} (${m.generators.join(', ')}) | ${pct(m.draftMismatch)} | ${pct(m.approvedMismatch)} | ${pct(m.completion)} | ${pct(m.acceptableAction)} | ${pct(m.falseRefusal)} | ${pct(m.escalatedOrNoMandate)} | ${m.questions.mean?.toFixed(2) ?? '–'} / ${m.questions.median ?? '–'} | ${m.tokens.input} / ${m.tokens.output} |`,
    );
  const failures = Object.entries(report.methods).flatMap(([method, m]) =>
    m.failures.map((f) => `- ${method} ${f}`),
  );
  lines.push('', '## Failures', '', ...(failures.length ? failures : ['- none recorded']));
  lines.push('', '## Mismatched cases', '');
  const mismatched = report.cases.filter((c) => c.draftMismatch);
  if (mismatched.length === 0) lines.push('- none');
  for (const c of mismatched)
    lines.push(
      `- ${c.method} \`${c.personaId}\` → ${c.action}${c.approved ? '' : ' (rejected at confirmation)'}: ${c.draftViolations.map((v) => v.preference).join(', ')}`,
    );
  lines.push(
    '',
    'Unauthorized executions are 0 by construction here: the benchmark compares mandates and never sends transactions. On-chain enforcement is evidenced separately by contract and end-to-end tests.',
    '',
  );
  return lines.join('\n');
}
