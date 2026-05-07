import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { AgentsService } from './agents.service.js';
import { CreateAgentSchema, UpdateAgentSchema, UpdateStatusSchema } from './dto/create-agent.dto.js';

const WORKSPACE_ID = 'workspace_demo';

@Controller('agent-instances')
export class AgentsController {
  constructor(private readonly service: AgentsService) {}

  @Get()
  findAll(@Query() query: { status?: string; template_id?: string }) {
    return this.service.findAll(WORKSPACE_ID, query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id, WORKSPACE_ID);
  }

  @Post()
  create(@Body() body: unknown, @Req() req: any) {
    const dto = CreateAgentSchema.parse(body);
    const userId = req.user?.id ?? 'unknown';
    return this.service.create(dto, WORKSPACE_ID, userId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown) {
    const dto = UpdateAgentSchema.parse(body);
    return this.service.update(id, dto, WORKSPACE_ID);
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() body: unknown) {
    const dto = UpdateStatusSchema.parse(body);
    return this.service.updateStatus(id, dto, WORKSPACE_ID);
  }

  @Delete(':id')
  archive(@Param('id') id: string) {
    return this.service.archive(id, WORKSPACE_ID);
  }

  @Post(':id/run')
  run(@Param('id') id: string) {
    return this.service.runAgent(id, WORKSPACE_ID, { triggerType: 'manual' });
  }
}
