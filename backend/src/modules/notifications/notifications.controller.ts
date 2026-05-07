import { Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { NotificationsService } from './notifications.service.js';

const WORKSPACE_ID = 'workspace_demo';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get()
  findAll(
    @Query()
    query: { status?: string; severity?: string; agent_instance_id?: string; limit?: string },
  ) {
    return this.service.findAll(WORKSPACE_ID, query);
  }

  @Get('count')
  count(@Query() query: { status?: string }) {
    return this.service.count(WORKSPACE_ID, query);
  }

  @Patch(':id/acknowledge')
  acknowledge(@Param('id') id: string) {
    return this.service.acknowledge(id, WORKSPACE_ID);
  }

  @Patch(':id/resolve')
  resolve(@Param('id') id: string) {
    return this.service.resolve(id, WORKSPACE_ID);
  }
}
