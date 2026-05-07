import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';

@Injectable()
export class IntegrationsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(workspaceId: string) {
    const integrations = await this.prisma.integration.findMany({ where: { workspaceId } });
    return { data: integrations, total: integrations.length };
  }

  private async getIntegration(id: string, workspaceId: string) {
    const integration = await this.prisma.integration.findFirst({ where: { id, workspaceId } });
    if (!integration) throw new NotFoundException(`Integration ${id} not found`);
    return integration;
  }

  async mockConnect(id: string, workspaceId: string) {
    await this.getIntegration(id, workspaceId);
    const updated = await this.prisma.integration.update({
      where: { id },
      data: { status: 'mock_connected', mockEnabled: true, lastTestedAt: new Date() },
    });
    return { data: updated };
  }

  async test(id: string, workspaceId: string) {
    const integration = await this.getIntegration(id, workspaceId);
    const tested = await this.prisma.integration.update({
      where: { id },
      data: { lastTestedAt: new Date() },
    });
    return {
      data: {
        status: 'success',
        message: `Mock connection to ${integration.name} is healthy.`,
        tested_at: tested.lastTestedAt,
      },
    };
  }

  async disconnect(id: string, workspaceId: string) {
    await this.getIntegration(id, workspaceId);
    const updated = await this.prisma.integration.update({
      where: { id },
      data: { status: 'not_connected', mockEnabled: false },
    });
    return { data: updated };
  }
}
