import { Controller, Get, Param, Post } from '@nestjs/common';
import { IntegrationsService } from './integrations.service.js';

const WORKSPACE_ID = 'workspace_demo';

@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly service: IntegrationsService) {}

  @Get()
  findAll() {
    return this.service.findAll(WORKSPACE_ID);
  }

  @Post(':id/mock-connect')
  mockConnect(@Param('id') id: string) {
    return this.service.mockConnect(id, WORKSPACE_ID);
  }

  @Post(':id/test')
  test(@Param('id') id: string) {
    return this.service.test(id, WORKSPACE_ID);
  }

  @Post(':id/disconnect')
  disconnect(@Param('id') id: string) {
    return this.service.disconnect(id, WORKSPACE_ID);
  }
}
