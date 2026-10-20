import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tokenAmountSchema } from '@boundra/shared';
import { z } from 'zod';

/**
 * Persona fixtures are authored by hand. Hidden preferences are the
 * non-negotiable ground truth; only the answer simulator and the evaluator may read them.
 */
const hiddenSchema = z
  .object({
    /** Longest lockup the persona truly accepts, in days (0 = none). */
    acceptsLockupDays: z.number().int().min(0).max(365),
    /** Days until the persona may need the money back; null = genuinely unsure. */
    needsFundsWithinDays: z.number().int().min(0).max(3650).nullable(),
    /** The persona cannot decide on lockups and must not be opted in. */
    unsureAboutLockup: z.boolean().default(false),
    /** false = only the instant-withdrawal vault is acceptable. */
    permitsTimedVault: z.boolean().default(true),
  })
  .strict();

const actionKey = z.enum(['DEPOSIT:LIQUID', 'DEPOSIT:TIMED', 'ESCALATE']);

const personaSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{1,64}$/),
    split: z.enum(['development', 'heldout']),
    prompt: z.string().min(1).max(2000),
    amount: tokenAmountSchema.refine((value) => value !== '0'),
    cases: z.array(z.string().max(64)).default([]),
    hidden: hiddenSchema,
    /** Actions the labeller considers correct; used for completion and false refusals. */
    expected: z.object({ acceptableActions: z.array(actionKey).min(1) }).strict(),
  })
  .strict();

export const fixtureSchema = z
  .object({
    fixtureVersion: z.string().min(1).max(64),
    /** Free text describing provenance (author, labeller, freeze date). */
    provenance: z.string().min(1).max(1000),
    /** Set once the held-out split is frozen; required to run it. */
    frozen: z.boolean().default(false),
    personas: z.array(personaSchema).min(1),
  })
  .strict()
  .superRefine((fixture, context) => {
    const ids = fixture.personas.map((persona) => persona.id);
    if (new Set(ids).size !== ids.length)
      context.addIssue({ code: 'custom', message: 'Persona IDs must be unique' });
  });

export type Fixture = z.infer<typeof fixtureSchema>;
export type Persona = z.infer<typeof personaSchema>;
export type HiddenPreferences = z.infer<typeof hiddenSchema>;
export type ActionKey = z.infer<typeof actionKey>;

/** What a mandate generator may see: never the hidden preferences or expected labels. */
export interface PublicPersona {
  id: string;
  prompt: string;
  amount: bigint;
}

export const publicView = (persona: Persona): PublicPersona => ({
  id: persona.id,
  prompt: persona.prompt,
  amount: BigInt(persona.amount),
});

export function loadFixture(path: string): { fixture: Fixture; sha256: string } {
  const raw = readFileSync(path, 'utf8');
  return {
    fixture: fixtureSchema.parse(JSON.parse(raw)),
    sha256: createHash('sha256').update(raw).digest('hex'),
  };
}
