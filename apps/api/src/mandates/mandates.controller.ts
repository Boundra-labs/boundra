import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentOwner, type AuthenticatedOwner } from '../common/request';
import {
  approveSchema,
  authorizationCheckSchema,
  draftSchema,
  MandatesService,
} from './mandates.service';

@ApiTags('mandates')
@ApiCookieAuth('__Host-boundra_session')
@ApiHeader({
  name: 'X-CSRF-Token',
  description: 'Required for POST/PATCH requests',
  required: false,
})
@Controller()
export class MandatesController {
  constructor(@Inject(MandatesService) private readonly mandates: MandatesService) {}

  @Post('intents/:id/mandate-drafts')
  @ApiOperation({ summary: 'Draft a mandate revision with its structured preview' })
  @ApiBody({ schema: z.toJSONSchema(draftSchema) as object, required: false })
  create(
    @CurrentOwner() owner: AuthenticatedOwner,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.mandates.createDraft(owner, id, body);
  }

  @Get('mandate-drafts/:id')
  @ApiOperation({ summary: 'Mandate revision, preview, preview hash and status' })
  get(@CurrentOwner() owner: AuthenticatedOwner, @Param('id') id: string) {
    return this.mandates.get(owner, id);
  }

  @Patch('mandate-drafts/:id')
  @ApiOperation({ summary: 'Edit limits; creates a new revision that must be reviewed again' })
  @ApiBody({ schema: z.toJSONSchema(draftSchema) as object })
  revise(
    @CurrentOwner() owner: AuthenticatedOwner,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.mandates.revise(owner, id, body);
  }

  @Post('mandate-drafts/:id/approve')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Approve the exact previewed revision; returns the owner transactions to send',
  })
  @ApiBody({ schema: z.toJSONSchema(approveSchema) as object })
  approve(
    @CurrentOwner() owner: AuthenticatedOwner,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.mandates.approve(owner, id, body);
  }

  @Post('mandate-drafts/:id/authorization-check')
  @HttpCode(202)
  @ApiOperation({ summary: 'Queue on-chain verification of setMandate and funding' })
  @ApiBody({ schema: z.toJSONSchema(authorizationCheckSchema) as object, required: false })
  check(@CurrentOwner() owner: AuthenticatedOwner, @Param('id') id: string, @Body() body: unknown) {
    return this.mandates.requestAuthorizationCheck(owner, id, body);
  }
}
