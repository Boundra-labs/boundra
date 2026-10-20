import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MandateTuple } from '@boundra/shared';
import { loadFixture, type ActionKey, type HiddenPreferences, type Persona } from './fixtures';
import { violations } from './runner/simulator';

/**
 * Checks the benchmark fixture against the labelling rubric in evaluation/fixtures/README.md.
 * It never runs a method: labels follow from the hidden preferences and case tags alone, so
 * no label can be tuned to what B0–B3 happen to output.
 */
const fixturesDir = resolve(__dirname, '../fixtures');
const BENCHMARK = 'boundra-personas-v1.json';
const { fixture, sha256 } = loadFixture(resolve(fixturesDir, BENCHMARK));
const split = (name: Persona['split']) => fixture.personas.filter((p) => p.split === name);

const CASE_TAGS = new Set([
  'same-prompt',
  'liquidity-need',
  'accepts-lockup',
  'near-miss-lockup',
  'vault-exclusion',
  'unsure',
  'irrelevant-uncertainty',
  'conflict',
  'misleading-description',
  'safe-no-trade',
  'indonesian',
]);
/** the release checklist and PRD §3.2: every one of these must appear in both splits. */
const REQUIRED_IN_EACH_SPLIT = [
  'same-prompt',
  'liquidity-need',
  'accepts-lockup',
  'unsure',
  'irrelevant-uncertainty',
  'conflict',
  'misleading-description',
  'safe-no-trade',
];

/** TimedVault breaks no non-negotiable preference (its 30-day lockup is truly accepted). */
const timedSafe = (h: HiddenPreferences) =>
  !h.unsureAboutLockup &&
  h.acceptsLockupDays >= 30 &&
  h.permitsTimedVault &&
  h.needsFundsWithinDays !== null &&
  h.needsFundsWithinDays >= 30;

const uncertain = (h: HiddenPreferences) => h.unsureAboutLockup || h.needsFundsWithinDays === null;
/** A known preference already rules TimedVault out, so any uncertainty cannot change the outcome. */
const timedRuledOutRegardless = (h: HiddenPreferences) =>
  (!h.unsureAboutLockup && h.acceptsLockupDays < 30) ||
  !h.permitsTimedVault ||
  (h.needsFundsWithinDays !== null && h.needsFundsWithinDays < 30);

/** The rubric: what a careful labeller accepts, from hidden preferences and case tags only. */
function rubric(persona: Persona): ActionKey[] {
  if (persona.cases.includes('safe-no-trade')) return ['ESCALATE'];
  const actions: ActionKey[] = [];
  if (timedSafe(persona.hidden)) actions.push('DEPOSIT:TIMED');
  actions.push('DEPOSIT:LIQUID');
  if (persona.cases.includes('unsure') || persona.cases.includes('conflict'))
    actions.push('ESCALATE');
  return actions;
}

const tags = (persona: Persona) => persona.cases.filter((c) => !c.startsWith('prompt-group:'));
const group = (persona: Persona) =>
  persona.cases.find((c) => c.startsWith('prompt-group:'))?.slice('prompt-group:'.length);

describe(`benchmark fixture ${BENCHMARK}`, () => {
  it('has 50 personas: 20 development and 30 held-out', () => {
    expect(fixture.fixtureVersion).toBe('boundra-personas-v1');
    expect(split('development')).toHaveLength(20);
    expect(split('heldout')).toHaveLength(30);
  });

  it('labels every persona by the rubric', () => {
    const disagreements = fixture.personas
      .filter((p) => {
        const expected = [...rubric(p)].sort();
        return (
          JSON.stringify([...p.expected.acceptableActions].sort()) !== JSON.stringify(expected)
        );
      })
      .map(
        (p) =>
          `${p.id}: labelled ${p.expected.acceptableActions.join(',')}, rubric ${rubric(p).join(',')}`,
      );
    expect(disagreements).toEqual([]);
  });

  it('agrees with the evaluator on when TimedVault is a mismatch', () => {
    for (const persona of fixture.personas) {
      const timed = { allowedVaults: 2, allocationTarget: persona.amount } as MandateTuple;
      const liquid = { allowedVaults: 1, allocationTarget: persona.amount } as MandateTuple;
      expect(violations(persona, timed).length === 0, persona.id).toBe(timedSafe(persona.hidden));
      expect(violations(persona, liquid), persona.id).toEqual([]);
    }
  });

  it('uses known case tags consistently with the hidden preferences', () => {
    for (const p of fixture.personas) {
      const h = p.hidden;
      for (const tag of tags(p)) expect(CASE_TAGS.has(tag), `${p.id}: ${tag}`).toBe(true);
      if (p.cases.includes('unsure'))
        expect(uncertain(h) && !timedRuledOutRegardless(h), p.id).toBe(true);
      if (p.cases.includes('irrelevant-uncertainty'))
        expect(p.cases.includes('unsure') || p.cases.includes('conflict'), p.id).toBe(false);
      if (uncertain(h) && timedRuledOutRegardless(h) && !p.cases.includes('safe-no-trade'))
        expect(p.cases, p.id).toContain('irrelevant-uncertainty');
      if (p.cases.includes('accepts-lockup')) expect(timedSafe(h), p.id).toBe(true);
      if (p.cases.includes('near-miss-lockup'))
        expect(h.acceptsLockupDays > 0 && h.acceptsLockupDays < 30, p.id).toBe(true);
      if (p.cases.includes('vault-exclusion')) expect(h.permitsTimedVault, p.id).toBe(false);
      if (p.cases.includes('conflict'))
        expect(h.acceptsLockupDays >= 30 && (h.needsFundsWithinDays ?? 0) < 30, p.id).toBe(true);
    }
  });

  it('covers every required case type in both splits', () => {
    for (const name of ['development', 'heldout'] as const) {
      const seen = new Set(split(name).flatMap(tags));
      for (const tag of REQUIRED_IN_EACH_SPLIT) expect(seen.has(tag), `${name}: ${tag}`).toBe(true);
    }
  });

  it('groups same-prompt personas with one prompt, one amount and different preferences', () => {
    const groups = new Map<string, Persona[]>();
    for (const p of fixture.personas) {
      const name = group(p);
      expect(Boolean(name), p.id).toBe(p.cases.includes('same-prompt'));
      if (name) groups.set(name, [...(groups.get(name) ?? []), p]);
    }
    for (const [name, members] of groups) {
      expect(members.length, name).toBeGreaterThanOrEqual(2);
      expect(new Set(members.map((p) => p.split)).size, name).toBe(1);
      expect(new Set(members.map((p) => `${p.prompt}|${p.amount}`)).size, name).toBe(1);
      expect(new Set(members.map((p) => JSON.stringify(p.hidden))).size, name).toBe(members.length);
    }
  });

  it('keeps held-out prompts out of the development split', () => {
    const development = new Set(split('development').map((p) => p.prompt.trim().toLowerCase()));
    const leaked = split('heldout').filter((p) => development.has(p.prompt.trim().toLowerCase()));
    expect(leaked.map((p) => p.id)).toEqual([]);
  });

  it('states the same amount in the prompt as in the amount field', () => {
    for (const p of fixture.personas) {
      const stated = /(\d[\d,]*(?:\.\d+)?)\s*MockUSDC/.exec(p.prompt)?.[1];
      if (!stated) continue;
      const [whole, fraction = ''] = stated.replaceAll(',', '').split('.');
      expect(BigInt(whole! + fraction.padEnd(6, '0')).toString(), p.id).toBe(p.amount);
    }
  });
});

describe('frozen fixtures', () => {
  const record = JSON.parse(readFileSync(resolve(fixturesDir, 'frozen.json'), 'utf8')) as Record<
    string,
    { sha256: string }
  >;

  it('match the hash recorded when they were frozen, so a frozen file cannot change silently', () => {
    const files = readdirSync(fixturesDir).filter(
      (f) => f.endsWith('.json') && f !== 'frozen.json',
    );
    for (const file of files) {
      const loaded =
        file === BENCHMARK ? { fixture, sha256 } : loadFixture(resolve(fixturesDir, file));
      if (loaded.fixture.frozen) expect(record[file]?.sha256, file).toBe(loaded.sha256);
      else expect(record[file], `${file} is not frozen but has a freeze record`).toBeUndefined();
    }
  });
});
