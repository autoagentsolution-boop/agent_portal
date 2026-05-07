import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    workspaceId: string,
    query: { status?: string; severity?: string; agent_instance_id?: string; limit?: string },
  ) {
    const limit = query.limit ? Math.max(1, Math.min(200, Number(query.limit))) : 100;
    const notifications = await this.prisma.notification.findMany({
      where: {
        workspaceId,
        ...(query.status && { status: query.status }),
        ...(query.severity && { severity: query.severity }),
        ...(query.agent_instance_id && { agentInstanceId: query.agent_instance_id }),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        agentInstance: { select: { id: true, name: true, templateId: true } },
      },
    });
    return { data: notifications, total: notifications.length };
  }

  async count(workspaceId: string, query: { status?: string }) {
    const total = await this.prisma.notification.count({
      where: {
        workspaceId,
        ...(query.status && { status: query.status }),
      },
    });
    return { data: { count: total } };
  }

  async acknowledge(id: string, workspaceId: string) {
    const notification = await this.prisma.notification.findFirst({ where: { id, workspaceId } });
    if (!notification) throw new NotFoundException(`Notification ${id} not found`);
    const updated = await this.prisma.notification.update({
      where: { id },
      data: { status: 'acknowledged' },
    });
    return { data: updated };
  }

  async resolve(id: string, workspaceId: string) {
    const notification = await this.prisma.notification.findFirst({ where: { id, workspaceId } });
    if (!notification) throw new NotFoundException(`Notification ${id} not found`);
    const updated = await this.prisma.notification.update({
      where: { id },
      data: { status: 'resolved' },
    });
    return { data: updated };
  }
}
