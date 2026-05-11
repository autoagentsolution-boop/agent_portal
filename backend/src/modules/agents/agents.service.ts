import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { validateConfig, ConfigSchema } from '../../utils/config-schema-validator.js';
import { validateAndMergeOverrides } from '../../utils/overrides-validator.js';
import { N8nService } from '../n8n/n8n.service.js';
import type { N8nTriggerPayload } from '../n8n/dto/callback.dto.js';
import { CreateAgentDto, UpdateAgentDto, UpdateStatusDto } from './dto/create-agent.dto.js';

const STATUS_TRANSITIONS: Record<string, string[]> = {
  draft: ['running'],
  running: ['paused', 'error', 'archived'],
  paused: ['running', 'archived'],
  error: ['paused', 'running'],
  archived: [],
};

const RUNNABLE_STATUSES = new Set(['draft', 'running', 'paused']);

@Injectable()
export class AgentsService {
  private readonly logger = new Logger(AgentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly n8n: N8nService,
  ) {}

  async findAll(workspaceId: string, query: { status?: string; template_id?: string }) {
    const agents = await this.prisma.agentInstance.findMany({
      where: {
        workspaceId,
        ...(query.status && { status: query.status }),
        ...(query.template_id && { templateId: query.template_id }),
      },
      include: { template: { select: { id: true, name: true, category: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return { data: agents, total: agents.length };
  }

  async findOne(id: string, workspaceId: string) {
    const agent = await this.prisma.agentInstance.findFirst({
      where: { id, workspaceId },
      include: {
        template: true,
        integrations: { include: { integration: true } },
        executions: { orderBy: { createdAt: 'desc' }, take: 5 },
      },
    });
    if (!agent) throw new NotFoundException(`Agent ${id} not found`);
    return { data: agent };
  }

  async create(dto: CreateAgentDto, workspaceId: string, userId: string) {
    // Rule 1+2: template exists and active
    const template = await this.prisma.agentTemplate.findUnique({ where: { id: dto.template_id } });
    if (!template) throw new BadRequestException('Template not found');
    if (template.status !== 'active') throw new BadRequestException('Template is not active');

    const required = template.requiredIntegrationsJson as unknown as string[];
    const optional = template.optionalIntegrationsJson as unknown as string[];
    const allowed = new Set([...required, ...optional]);
    const allowedModes = template.allowedTriggerModesJson as unknown as string[];

    // Rule 3: all required integrations present
    const missing = required.filter((r) => !dto.selected_integrations.includes(r));
    if (missing.length) throw new BadRequestException(`Missing required integrations: ${missing.join(', ')}`);

    // Rule 4: no integrations outside allowed set
    const invalid = dto.selected_integrations.filter((i) => !allowed.has(i));
    if (invalid.length) throw new BadRequestException(`Integrations not allowed by template: ${invalid.join(', ')}`);

    // Rule 5: integrations exist in workspace
    const workspaceIntegrations = await this.prisma.integration.findMany({
      where: { workspaceId, integrationKey: { in: dto.selected_integrations } },
    });
    if (workspaceIntegrations.length !== dto.selected_integrations.length) {
      throw new BadRequestException('One or more integrations not found in workspace');
    }

    // Rule 6: trigger_mode allowed
    if (!allowedModes.includes(dto.trigger_mode)) {
      throw new BadRequestException(`trigger_mode must be one of: ${allowedModes.join(', ')}`);
    }

    // Rules 7+8+9: config schema validation
    const configErrors = validateConfig(
      dto.config as Record<string, unknown>,
      template.configSchemaJson as unknown as ConfigSchema,
    );
    if (configErrors.length) {
      throw new BadRequestException({ message: 'Config validation failed', details: configErrors });
    }

    const agent = await this.prisma.$transaction(async (tx) => {
      const created = await tx.agentInstance.create({
        data: {
          workspaceId,
          templateId: dto.template_id,
          name: dto.name,
          triggerMode: dto.trigger_mode,
          configJson: dto.config as object,
          createdById: userId,
        },
      });

      await tx.agentInstanceIntegration.createMany({
        data: workspaceIntegrations.map((i) => ({
          agentInstanceId: created.id,
          integrationId: i.id,
        })),
      });

      return created;
    });

    return { data: agent };
  }

  async update(id: string, dto: UpdateAgentDto, workspaceId: string) {
    const agent = await this.prisma.agentInstance.findFirst({ where: { id, workspaceId } });
    if (!agent) throw new NotFoundException(`Agent ${id} not found`);

    const updated = await this.prisma.agentInstance.update({
      where: { id },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.trigger_mode && { triggerMode: dto.trigger_mode }),
        ...(dto.config && { configJson: dto.config as object }),
      },
    });
    return { data: updated };
  }

  async updateStatus(id: string, dto: UpdateStatusDto, workspaceId: string) {
    const agent = await this.prisma.agentInstance.findFirst({ where: { id, workspaceId } });
    if (!agent) throw new NotFoundException(`Agent ${id} not found`);

    const allowed = STATUS_TRANSITIONS[agent.status] ?? [];
    if (!allowed.includes(dto.status)) {
      throw new BadRequestException(`Invalid transition: ${agent.status} → ${dto.status}`);
    }

    const updated = await this.prisma.agentInstance.update({ where: { id }, data: { status: dto.status } });
    return { data: updated };
  }

  async archive(id: string, workspaceId: string) {
    const agent = await this.prisma.agentInstance.findFirst({ where: { id, workspaceId } });
    if (!agent) throw new NotFoundException(`Agent ${id} not found`);
    if (agent.status === 'archived') return { data: agent };

    const updated = await this.prisma.agentInstance.update({ where: { id }, data: { status: 'archived' } });
    return { data: updated };
  }

  async runAgent(
    agentId: string,
    workspaceId: string,
    options: {
      triggerType?: 'manual' | 'retry' | 'schedule';
      overrides?: Record<string, unknown>;
    } = {},
  ) {
    const agent = await this.prisma.agentInstance.findFirst({
      where: { id: agentId, workspaceId },
      include: { template: true, integrations: { include: { integration: true } } },
    });
    if (!agent) throw new NotFoundException(`Agent ${agentId} not found`);
    if (!RUNNABLE_STATUSES.has(agent.status)) {
      throw new ConflictException(`Agent in status '${agent.status}' cannot be run`);
    }

    const triggerType = options.triggerType ?? 'manual';

    // Schedule never carries overrides — defaults only. Manual/retry can override.
    const incomingOverrides = triggerType === 'schedule' ? undefined : options.overrides;
    const { effective, snapshot } = validateAndMergeOverrides(
      incomingOverrides,
      agent.configJson as Record<string, unknown>,
      agent.template.overridableFieldsJson as unknown as string[],
      agent.template.configSchemaJson as unknown as ConfigSchema,
    );

    const execution = await this.prisma.execution.create({
      data: {
        workspaceId,
        agentInstanceId: agent.id,
        templateId: agent.templateId,
        status: 'running',
        triggerType,
        startedAt: new Date(),
        configOverrideJson: (snapshot ?? undefined) as object | undefined,
        effectiveConfigJson: effective as object,
      },
    });

    const payload: N8nTriggerPayload = {
      execution_id: execution.id,
      agent_instance_id: agent.id,
      template_id: agent.templateId,
      workspace_id: workspaceId,
      config: effective,
      selected_integrations: agent.integrations.map((ai) => ai.integration.integrationKey),
      input: { mode: 'test', items: [] },
      callback: {
        url: process.env.BACKEND_CALLBACK_URL ?? 'http://backend:4000/api/n8n/callback',
        secret: process.env.N8N_CALLBACK_SECRET ?? '',
      },
    };

    // Fire-and-forget: caller already has execution_id + status. If trigger fails,
    // background handler transitions execution to 'failed' so it doesn't sit in 'running'.
    this.n8n
      .triggerWorkflow(agent.template.n8nWebhookPath, payload)
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`n8n trigger failed executionId=${execution.id} err=${msg}`);
        void this.failExecutionAfterTriggerError(execution.id, agent.id, workspaceId, msg);
      });

    return { data: { execution_id: execution.id, status: execution.status } };
  }

  // Background remediation when n8n trigger fails (network/timeout/non-2xx).
  // Uses status-filtered updateMany so a late-arriving callback can still win the race.
  private async failExecutionAfterTriggerError(
    executionId: string,
    agentInstanceId: string,
    workspaceId: string,
    errorMsg: string,
  ): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const result = await tx.execution.updateMany({
          where: { id: executionId, status: 'running' },
          data: {
            status: 'failed',
            errorMessage: `n8n trigger failed: ${errorMsg}`.slice(0, 500),
            finishedAt: new Date(),
          },
        });
        if (result.count === 0) return; // callback raced ahead — accept terminal state
        await tx.notification.create({
          data: {
            workspaceId,
            agentInstanceId,
            executionId,
            severity: 'critical',
            type: 'trigger_failed',
            title: 'Agent run failed to start',
            message: errorMsg.slice(0, 500),
          },
        });
      });
    } catch (e: unknown) {
      this.logger.error(`failExecutionAfterTriggerError DB error executionId=${executionId} err=${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
