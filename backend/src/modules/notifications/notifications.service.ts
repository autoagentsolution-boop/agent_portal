import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(workspaceId: string, query: { status?: string; severity?: string }) {
    const notifications = await this.prisma.notification.findMany({
      where: {
        workspaceId,
        ...(query.status && { status: query.status }),
        ...(query.severity && { severity: query.severity }),
      },
      orderBy: { createdAt: 'desc' },
    });
    return { data: notifications, total: notifications.length };
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
