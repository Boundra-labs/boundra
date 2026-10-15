import {
  DIMENSION_IDS,
  DIMENSIONS,
  MAX_QUESTIONS,
  type DimensionDef,
  type DimensionId,
  type PreferenceValues,
} from './config';
import { effectiveValues, selectAction, selectionKey, type PreferenceState } from './eligibility';

export interface RankingComponents {
  materiality: number;
  uncertainty: number;
  decisionFlip: number;
  friction: number;
  score: number;
}

export interface PlannedQuestion extends RankingComponents {
  dimension: DimensionId;
  text: string;
  alternatives: { id: string; label: string }[];
  /** Which action each answer can lead to; recorded as the question's action disagreement. */
  actionDisagreement: string;
}

const valueKey = (value: Partial<PreferenceValues>) =>
  JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
const sameValue = (a: Partial<PreferenceValues>, b: Partial<PreferenceValues>) =>
  valueKey(a) === valueKey(b);

/** Concrete values a dimension can take: each answer, plus the conservative UNKNOWN outcome. */
function outcomes(def: DimensionDef): Partial<PreferenceValues>[] {
  const values = def.alternatives.map((alt) => alt.value ?? def.conservativeValue);
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = valueKey(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function assignments(dimensions: DimensionId[]): Partial<PreferenceValues>[] {
  let result: Partial<PreferenceValues>[] = [{}];
  for (const id of dimensions) {
    const next: Partial<PreferenceValues>[] = [];
    for (const partial of result)
      for (const value of outcomes(DIMENSIONS[id])) next.push({ ...partial, ...value });
    result = next;
  }
  return result;
}

/**
 * Truth table (PRD §7.1, §13.2): for every combination of the other unresolved dimensions,
 * does varying this dimension change the selected action? The share of combinations where it
 * does maps to the 0–3 ordinal; 0 filters the dimension out entirely.
 */
export function decisionFlip(state: PreferenceState, dimension: DimensionId): number {
  const base = effectiveValues(state);
  const others = DIMENSION_IDS.filter(
    (id) => id !== dimension && state[id].status === 'UNRESOLVED',
  );
  const combos = assignments(others);
  let flips = 0;
  for (const combo of combos) {
    const actions = new Set(
      outcomes(DIMENSIONS[dimension]).map((value) =>
        selectionKey(selectAction({ ...base, ...combo, ...value })),
      ),
    );
    if (actions.size > 1) flips++;
  }
  if (flips === 0) return 0;
  const ratio = flips / combos.length;
  if (ratio >= 2 / 3) return 3;
  if (ratio >= 1 / 3) return 2;
  return 1;
}

export function rank(state: PreferenceState, dimension: DimensionId): RankingComponents {
  const def = DIMENSIONS[dimension];
  const flip = decisionFlip(state, dimension);
  return {
    materiality: def.materiality,
    uncertainty: def.uncertainty,
    decisionFlip: flip,
    friction: def.friction,
    score: def.materiality * def.uncertainty * flip - def.friction,
  };
}

function disagreement(state: PreferenceState, dimension: DimensionId): string {
  const def = DIMENSIONS[dimension];
  const base = effectiveValues(state);
  const others = DIMENSION_IDS.filter(
    (id) => id !== dimension && state[id].status === 'UNRESOLVED',
  );
  const combos = assignments(others);
  return def.alternatives
    .map((alt) => {
      const value = alt.value ?? def.conservativeValue;
      const actions = [
        ...new Set(combos.map((c) => selectionKey(selectAction({ ...base, ...c, ...value })))),
      ].sort((a, b) => a.localeCompare(b));
      return `${alt.id} -> ${actions.join(' | ')}`;
    })
    .join('; ');
}

/**
 * Next question, or null when no material dimension remains or the budget is spent.
 * Unasked dimensions keep defaults that never broaden authority.
 */
export function nextQuestion(state: PreferenceState, asked: number): PlannedQuestion | null {
  if (asked >= MAX_QUESTIONS) return null;
  let best: PlannedQuestion | null = null;
  for (const id of DIMENSION_IDS) {
    if (state[id].status !== 'UNRESOLVED') continue;
    const components = rank(state, id);
    if (components.decisionFlip === 0 || components.score <= 0) continue;
    if (best && components.score <= best.score) continue; // DIMENSION_IDS order breaks ties.
    const def = DIMENSIONS[id];
    best = {
      dimension: id,
      ...components,
      text: def.text,
      alternatives: def.alternatives.map(({ id: altId, label }) => ({ id: altId, label })),
      actionDisagreement: disagreement(state, id),
    };
  }
  return best;
}

export function applyAnswer(
  state: PreferenceState,
  dimension: DimensionId,
  alternativeId: string,
): PreferenceState {
  const def = DIMENSIONS[dimension];
  const alternative = def.alternatives.find((alt) => alt.id === alternativeId);
  if (!alternative) throw new Error(`Unknown alternative ${alternativeId} for ${dimension}`);
  if (state[dimension].status !== 'UNRESOLVED') throw new Error(`${dimension} already resolved`);
  return {
    ...state,
    [dimension]: alternative.value
      ? { status: 'ANSWERED', alternativeId }
      : { status: 'UNKNOWN', alternativeId },
  };
}

/** Dimensions that ended conservative because of UNKNOWN or an unanswered material question. */
export function narrowedDimensions(
  state: PreferenceState,
): { dimension: DimensionId; reason: string }[] {
  const narrowed: { dimension: DimensionId; reason: string }[] = [];
  for (const id of DIMENSION_IDS) {
    if (state[id].status === 'UNKNOWN')
      narrowed.push({
        dimension: id,
        reason: 'You were not sure, so the most conservative limit applies.',
      });
    else if (
      state[id].status === 'UNRESOLVED' &&
      sameValue(DIMENSIONS[id].defaultValue, DIMENSIONS[id].conservativeValue) &&
      decisionFlip(state, id) > 0
    )
      narrowed.push({
        dimension: id,
        reason: 'Not answered, so the most conservative limit applies.',
      });
  }
  return narrowed;
}
