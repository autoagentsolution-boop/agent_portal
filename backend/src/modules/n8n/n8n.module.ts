import { Module, forwardRef } from '@nestjs/common';
import { ExecutionsModule } from '../executions/executions.module.js';
import { N8nController } from './n8n.controller.js';
import { N8nService } from './n8n.service.js';

@Module({
  imports: [forwardRef(() => ExecutionsModule)],
  controllers: [N8nController],
  providers: [N8nService],
  exports: [N8nService],
})
export class N8nModule {}
