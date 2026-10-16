import { Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { answerSchema, intentSchema } from '@boundra/shared';
import { CurrentOwner, type AuthenticatedOwner } from '../common/request';
import { IntentsService } from './intents.service';

@ApiTags('intents')
@ApiCookieAuth('__Host-boundra_session')
@ApiHeader({ name: 'X-CSRF-Token', description: 'Required for POST requests', required: false })
@Controller('intents')
export class IntentsController {
  constructor(@Inject(IntentsService) private readonly intents: IntentsService) {}

  @Post()
  @ApiOperation({
    summary: 'Create an intent; returns the first clarification question if one is material',
  })
  @ApiBody({ schema: z.toJSONSchema(intentSchema) as object })
  create(@CurrentOwner() owner: AuthenticatedOwner, @Body() body: unknown) {
    return this.intents.create(owner, body);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Intent state, active question, eligible candidates and reasons' })
  get(@CurrentOwner() owner: AuthenticatedOwner, @Param('id') id: string) {
    return this.intents.view(owner, id);
  }

  @Post(':id/answers')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Answer the active question; candidates and next question are recomputed',
  })
  @ApiBody({ schema: z.toJSONSchema(answerSchema) as object })
  answer(
    @CurrentOwner() owner: AuthenticatedOwner,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.intents.answer(owner, id, body);
  }
}
