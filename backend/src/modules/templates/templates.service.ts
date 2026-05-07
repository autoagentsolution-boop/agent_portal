import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';

@Injectable()
export class TemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    const templates = await this.prisma.agentTemplate.findMany({
      where: { status: 'active' },
      select: {
        id: true,
        name: true,
        category: true,
        description: true,
        requiredIntegrationsJson: true,
        optionalIntegrationsJson: true,
        allowedTriggerModesJson: true,
        approvalRequired: true,
        costLevel: true,
        status: true,
        n8nWebhookPath: true,
      },
    });
    return { data: templates, total: templates.length };
  }

  async findOne(id: string) {
    const template = await this.prisma.agentTemplate.findUnique({ where: { id } });
    if (!template) throw new NotFoundException(`Template ${id} not found`);
    return { data: template };
  }
}
