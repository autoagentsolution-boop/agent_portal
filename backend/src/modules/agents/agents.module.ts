import { Module, forwardRef } from '@nestjs/common';
import { N8nModule } from '../n8n/n8n.module.js';
import { AgentsController } from './agents.controller.js';
import { AgentsService } from './agents.service.js';

@Module({
  imports: [forwardRef(() => N8nModule)],
  controllers: [AgentsController],
  providers: [AgentsService],
  exports: [AgentsService],
})
export class AgentsModule {}
