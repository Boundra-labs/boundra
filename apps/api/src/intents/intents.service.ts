import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  ACCE_CONFIG_VERSION,
  applyAnswer,
  DESCRIPTOR_VERSION,
  detectConflicts,
  effectiveValues,
  evaluateCandidates,
  formatAmount,
  initialState,
  narrowedDimensions,
  nextQuestion,
  selectAction,
  type DimensionId,
  type PlannedQuestion,
  type PreferenceState,
} from '@boundra/acce';
import type { Prisma, Question } from '@boundra/database';
import { answerSchema, intentSchema } from '@boundra/shared';
import { ApiError, invalidState, notFound } from '../common/errors';
import { isUuid, parse, type AuthenticatedOwner } from '../common/request';
import { DatabaseService } from '../database.service';
import { CHAIN_GATEWAY, type ChainGateway } from '../chain/chain.gateway';
import { WORDING_PROVIDER, type QuestionText, type WordingProvider } from './wording.provider';

/** Rebuilds the clarification state from persisted questions (the single source of answers). */
export function stateFromQuestions(
  questions: Pick<Question, 'dimension' | 'status' | 'answerId'>[],
) {
  let state: PreferenceState = initialState();
  for (const question of questions) {
    if ((question.status === 'ANSWERED' || question.status === 'UNKNOWN') && question.answerId)
      state = applyAnswer(state, question.dimension as DimensionId, question.answerId);
  }
  return state;
}

@Injectable()
export class IntentsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(CHAIN_GATEWAY) private readonly chain: ChainGateway,
    @Inject(WORDING_PROVIDER) private readonly wording: WordingProvider,
  ) {}

  private get db() {
    return this.database.client;
  }

  async create(owner: AuthenticatedOwner, body: unknown) {
    const input = parse(intentSchema, body);
    const amount = BigInt(input.amount);
    const executor = await this.db.executor.findUnique({ where: { ownerId: owner.id } });
    const fundable = await this.chain.fundableBalance(owner.address, executor?.address ?? null);
    if (amount > fundable)
      throw new ApiError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'INSUFFICIENT_BALANCE',
        `Requested ${formatAmount(amount)} exceeds your fundable balance of ${formatAmount(fundable)}`,
        'Claim MockUSDC from the faucet or lower the amount.',
      );
    const state = initialState();
    const planned = nextQuestion(state, 0);
    // Wording may call a model; it happens before, never inside, the database transaction.
    const text = planned ? await this.wording.word(planned) : null;
    const intent = await this.db.$transaction(async (tx) => {
      const created = await tx.intent.create({
        data: {
          ownerId: owner.id,
          objective: input.objective,
          amount: input.amount,
          state: planned ? 'CLARIFYING' : this.finalState(state),
          descriptorVersion: DESCRIPTOR_VERSION,
          acceConfigVersion: ACCE_CONFIG_VERSION,
        },
      });
      if (planned && text)
        await tx.question.create({ data: questionData(created.id, 1, planned, text) });
      await tx.activityEvent.create({
        data: {
          ownerId: owner.id,
          intentId: created.id,
          type: 'INTENT_CREATED',
          payload: { amount: input.amount, questionsPlanned: planned ? 1 : 0 },
        },
      });
      return created;
    });
    return this.view(owner, intent.id);
  }

  async answer(owner: AuthenticatedOwner, intentId: string, body: unknown) {
    const input = parse(answerSchema, body);
    const intent = await this.load(owner, intentId);
    if (intent.state !== 'CLARIFYING')
      throw invalidState('This intent is not waiting for an answer');
    const questions = await this.db.question.findMany({
      where: { intentId },
      orderBy: { order: 'asc' },
    });
    const active = questions.find((q) => q.status === 'PENDING');
    if (!active || active.questionId !== input.questionId)
      throw new ApiError(
        HttpStatus.CONFLICT,
        'QUESTION_NOT_ACTIVE',
        'That question is no longer active',
      );
    const dimension = active.dimension as DimensionId;
    let state: PreferenceState;
    try {
      state = applyAnswer(stateFromQuestions(questions), dimension, input.alternativeId);
    } catch {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Unknown answer option');
    }
    const status = state[dimension].status === 'UNKNOWN' ? 'UNKNOWN' : 'ANSWERED';
    const planned = nextQuestion(state, questions.length);
    const text = planned ? await this.wording.word(planned) : null;
    await this.db.$transaction(async (tx) => {
      // Optimistic concurrency: a concurrent answer to the same intent loses here.
      const bumped = await tx.intent.updateMany({
        where: { id: intentId, version: intent.version, state: 'CLARIFYING' },
        data: {
          version: { increment: 1 },
          state: planned ? 'CLARIFYING' : this.finalState(state),
          preferences: serializeState(state),
        },
      });
      if (bumped.count !== 1)
        throw invalidState('The intent changed concurrently', 'Reload and try again.');
      await tx.question.update({
        where: { id: active.id },
        data: { answerId: input.alternativeId, status, answeredAt: new Date() },
      });
      const version = (await tx.preferenceRecord.count({ where: { intentId, dimension } })) + 1;
      await tx.preferenceRecord.create({
        data: {
          intentId,
          dimension,
          value: { alternativeId: input.alternativeId, status },
          source: 'ANSWER',
          version,
        },
      });
      if (planned && text)
        await tx.question.create({
          data: questionData(intentId, questions.length + 1, planned, text),
        });
      await tx.activityEvent.create({
        data: {
          ownerId: owner.id,
          intentId,
          type: 'QUESTION_ANSWERED',
          payload: {
            questionId: active.questionId,
            dimension,
            answer: input.alternativeId,
            status,
          },
        },
      });
    });
    return this.view(owner, intentId);
  }

  /** Clarification finished: a mandate can be drafted, or nothing eligible remains. */
  private finalState(state: PreferenceState) {
    return selectAction(effectiveValues(state)).action === 'ESCALATE'
      ? 'ESCALATED'
      : 'MANDATE_PENDING';
  }

  async load(owner: AuthenticatedOwner, intentId: string) {
    // Owner isolation: other owners' intents are indistinguishable from missing ones.
    const intent = isUuid(intentId)
      ? await this.db.intent.findFirst({ where: { id: intentId, ownerId: owner.id } })
      : null;
    if (!intent) throw notFound('Intent');
    return intent;
  }

  async view(owner: AuthenticatedOwner, intentId: string) {
    const intent = await this.load(owner, intentId);
    const questions = await this.db.question.findMany({
      where: { intentId },
      orderBy: { order: 'asc' },
    });
    const state = stateFromQuestions(questions);
    const values = effectiveValues(state);
    const selection = selectAction(values);
    const active = questions.find((q) => q.status === 'PENDING');
    return {
      id: intent.id,
      state: intent.state,
      objective: intent.objective,
      amount: {
        baseUnits: intent.amount.toFixed(0),
        display: formatAmount(BigInt(intent.amount.toFixed(0))),
      },
      chainId: intent.chainId,
      descriptorVersion: intent.descriptorVersion,
      acceConfigVersion: intent.acceConfigVersion,
      createdAt: intent.createdAt.toISOString(),
      question: active
        ? {
            questionId: active.questionId,
            order: active.order,
            dimension: active.dimension,
            text: active.text,
            alternatives: active.alternatives,
            wordingSource: active.wordingSource,
          }
        : null,
      answered: questions
        .filter((q) => q.status !== 'PENDING')
        .map((q) => ({
          questionId: q.questionId,
          order: q.order,
          dimension: q.dimension,
          text: q.text,
          answerId: q.answerId,
          status: q.status,
        })),
      questionsAsked: questions.length,
      selection,
      candidates: evaluateCandidates(values).map((c) => ({
        vault: c.vault,
        eligible: c.eligible,
        illustrativeYieldBps: c.illustrativeYieldBps,
        lockupSeconds: c.lockupSeconds.toString(),
        reasons: c.reasons,
      })),
      narrowed: narrowedDimensions(state),
      conflicts: detectConflicts(state),
    };
  }
}

function serializeState(state: PreferenceState): Prisma.InputJsonValue {
  return Object.fromEntries(
    Object.entries(state).map(([id, entry]) => [id, { ...entry }]),
  ) as Prisma.InputJsonValue;
}

function questionData(
  intentId: string,
  order: number,
  planned: PlannedQuestion,
  text: QuestionText,
) {
  return {
    intentId,
    questionId: `${intentId}:${order}`,
    order,
    dimension: planned.dimension,
    alternatives: text.alternatives,
    actionDisagreement: planned.actionDisagreement.slice(0, 1000),
    materiality: planned.materiality,
    uncertainty: planned.uncertainty,
    decisionFlip: planned.decisionFlip,
    friction: planned.friction,
    score: planned.score,
    text: text.text,
    wordingSource: text.source,
  } satisfies Prisma.QuestionUncheckedCreateInput;
}
