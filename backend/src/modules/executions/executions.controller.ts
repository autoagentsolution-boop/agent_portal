import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ExecutionsService } from './executions.service.js';
import { ApprovalSchema } from './dto/approval.dto.js';

const WORKSPACE_ID = 'workspace_demo';

@Controller('executions')
export class ExecutionsController {
  constructor(private readonly service: ExecutionsService) {}

  @Get()
  findAll(@Query() query: { agent_instance_id?: string; status?: string; limit?: string }) {
    return this.service.findAll(WORKSPACE_ID, query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id, WORKSPACE_ID);
  }

  @Post(':id/retry')
  retry(@Param('id') id: string) {
    return this.service.retry(id, WORKSPACE_ID);
  }

  @Patch(':id/approval')
  approval(@Param('id') id: string, @Body() body: unknown, @Req() req: { user?: { id?: string } }) {
    const dto = ApprovalSchema.parse(body);
    const actorUserId = req.user?.id ?? null;
    return this.service.applyApproval(id, WORKSPACE_ID, dto, actorUserId);
  }
}
