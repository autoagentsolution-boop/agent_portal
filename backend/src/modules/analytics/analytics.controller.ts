import { Controller, Get, Param } from '@nestjs/common';
import { AnalyticsService } from './analytics.service.js';

const WORKSPACE_ID = 'workspace_demo';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly service: AnalyticsService) {}

  @Get('summary')
  getSummary() {
    return this.service.getSummary(WORKSPACE_ID);
  }

  @Get('agents/:id')
  getAgentSummary(@Param('id') id: string) {
    return this.service.getAgentSummary(id, WORKSPACE_ID);
  }
}
