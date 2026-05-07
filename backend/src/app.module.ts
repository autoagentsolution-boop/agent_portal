import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './auth/auth.module.js';
import { TemplatesModule } from './modules/templates/templates.module.js';
import { AgentsModule } from './modules/agents/agents.module.js';
import { IntegrationsModule } from './modules/integrations/integrations.module.js';
import { ExecutionsModule } from './modules/executions/executions.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { N8nModule } from './modules/n8n/n8n.module.js';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    HealthModule,
    TemplatesModule,
    AgentsModule,
    IntegrationsModule,
    ExecutionsModule,
    NotificationsModule,
    N8nModule,
  ],
})
export class AppModule {}
