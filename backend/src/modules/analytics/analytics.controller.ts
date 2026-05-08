import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';
import { AnalyticsService, type OutcomeRange } from './analytics.service.js';

const WORKSPACE_ID = 'workspace_demo';
const VALID_RANGES: ReadonlySet<OutcomeRange> = new Set(['7d', '30d', 'all']);

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

  @Get('agents/:id/business-outcomes')
  getAgentBusinessOutcomes(@Param('id') id: string, @Query('range') range?: string) {
    const r = (range ?? '7d') as OutcomeRange;
    if (!VALID_RANGES.has(r)) {
      throw new BadRequestException(`Invalid range "${range}". Use 7d | 30d | all.`);
    }
    return this.service.getAgentBusinessOutcomes(id, WORKSPACE_ID, r);
  }
}
