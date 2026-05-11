import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AgentsService } from '../agents/agents.service.js';
import type { N8nCallbackDto } from '../n8n/dto/callback.dto.js';
import {
  APPROVAL_APPROVED,
  APPROVAL_PENDING,
  APPROVAL_REJECTED,
  EMAIL_DRAFT_TEMPLATE_ID,
  type ApprovalDto,
} from './dto/approval.dto.js';

const NON_TERMINAL_STATUSES = ['queued', 'running'];

interface DraftRecord {
  approval_status?: string;
  [k: string]: unknown;
}

interface DraftDataBlob {
  drafts?: DraftRecord[];
  [k: string]: unknown;
}

interface DraftOutputJson {
  data?: DraftDataBlob;
  drafts?: DraftRecord[];
  [k: string]: unknown;
}

@Injectable()
export class ExecutionsService {
  private readonly logger = new Logger(ExecutionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => AgentsService))
    private readonly agents: AgentsService,
  ) {}

  async findAll(
    workspaceId: string,
    query: { agent_instance_id?: string; status?: string; limit?: string },
  ) {
    const take = query.limit ? Math.min(parseInt(query.limit), 200) : 50;
    const executions = await this.prisma.execution.findMany({
      where: {
        workspaceId,
        ...(query.agent_instance_id && { agentInstanceId: query.agent_instance_id }),
        ...(query.status && { status: query.status }),
      },
      include: {
        agentInstance: { select: { id: true, name: true } },
        template: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take,
    });
    return { data: executions, total: executions.length };
  }

  async findOne(id: string, workspaceId: string) {
    const execution = await this.prisma.execution.findFirst({
      where: { id, workspaceId },
      include: {
        output: true,
        agentInstance: { include: { template: true } },
        template: true,
        notifications: true,
      },
    });
    if (!execution) throw new NotFoundException(`Execution ${id} not found`);
    return { data: execution };
  }

  async retry(id: string, workspaceId: string) {
    const old = await this.prisma.execution.findFirst({ where: { id, workspaceId } });
    if (!old) throw new NotFoundException(`Execution ${id} not found`);
    const overrides = (old.configOverrideJson as Record<string, unknown> | null) ?? undefined;
    return this.agents.runAgent(old.agentInstanceId, workspaceId, {
      triggerType: 'retry',
      overrides,
    });
  }

  async applyApproval(
    executionId: string,
    workspaceId: string,
    dto: ApprovalDto,
    actorUserId: string | null,
  ) {
    const execution = await this.prisma.execution.findFirst({
      where: { id: executionId, workspaceId },
      include: { output: true, agentInstance: true },
    });
    if (!execution) throw new NotFoundException(`Execution ${executionId} not found`);
    if (execution.templateId !== EMAIL_DRAFT_TEMPLATE_ID) {
      throw new BadRequestException(
        `Approval only supported for ${EMAIL_DRAFT_TEMPLATE_ID} (got ${execution.templateId})`,
      );
    }
    if (!execution.output) {
      throw new BadRequestException('Execution has no output yet — cannot approve');
    }

    const current = (execution.output.outputJson as DraftOutputJson) ?? {};
    // Spec §12.2 wraps payload under `result.data` → stored as `outputJson.data`.
    // Older shape may have drafts at the top level — accept both.
    const draftsContainer: DraftDataBlob = current.data ?? current;
    const drafts: DraftRecord[] = Array.isArray(draftsContainer.drafts)
      ? [...draftsContainer.drafts]
      : [];
    if (drafts.length === 0) {
      throw new BadRequestException('Output contains no drafts');
    }

    const nextStatus = dto.action === 'approve' ? APPROVAL_APPROVED : APPROVAL_REJECTED;
    const targetIndices: number[] = [];

    if (dto.draftIndex !== undefined) {
      if (dto.draftIndex >= drafts.length) {
        throw new BadRequestException(
          `draftIndex ${dto.draftIndex} out of range (have ${drafts.length})`,
        );
      }
      targetIndices.push(dto.draftIndex);
    } else {
      drafts.forEach((d, i) => {
        if ((d?.approval_status ?? APPROVAL_PENDING) === APPROVAL_PENDING) targetIndices.push(i);
      });
    }

    if (targetIndices.length === 0) {
      throw new BadRequestException('No drafts in waiting_for_review state');
    }

    const transitioned: number[] = [];
    for (const i of targetIndices) {
      const draft = drafts[i] ?? {};
      if ((draft.approval_status ?? APPROVAL_PENDING) !== APPROVAL_PENDING) continue;
      drafts[i] = { ...draft, approval_status: nextStatus };
      transitioned.push(i);
    }

    if (transitioned.length === 0) {
      throw new BadRequestException('Selected drafts are no longer in waiting_for_review');
    }

    const nextJson: DraftOutputJson = current.data
      ? { ...current, data: { ...current.data, drafts } }
      : { ...current, drafts };

    const updated = await this.prisma.$transaction(async (tx) => {
      const out = await tx.executionOutput.update({
        where: { executionId: execution.id },
        data: { outputJson: nextJson as object },
      });
      await tx.auditLog.create({
        data: {
          workspaceId: execution.workspaceId,
          actorUserId: actorUserId ?? execution.agentInstance.createdById,
          entityType: 'execution',
          entityId: execution.id,
          action: dto.action === 'approve' ? 'draft_approved' : 'draft_rejected',
          afterJson: {
            template_id: execution.templateId,
            draft_indices: transitioned,
            note: dto.note ?? null,
          },
        },
      });
      return out;
    });

    return {
      data: {
        execution_id: execution.id,
        action: dto.action,
        transitioned_indices: transitioned,
        outputJson: updated.outputJson,
      },
    };
  }

  async updateFromCallback(payload: N8nCallbackDto) {
    const execution = await this.prisma.execution.findUnique({
      where: { id: payload.execution_id },
      include: { agentInstance: true },
    });
    if (!execution) {
      this.logger.warn(`callback for unknown execution_id=${payload.execution_id}`);
      throw new NotFoundException(`Execution ${payload.execution_id} not found`);
    }

    const m = payload.metrics ?? {};
    const finishedAt = payload.finished_at ? new Date(payload.finished_at) : new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      // DB-level CAS: only the first callback for this execution wins.
      // startedAt is preserved server-side; recompute durationMs from row's startedAt below.
      const cas = await tx.execution.updateMany({
        where: { id: execution.id, status: { in: NON_TERMINAL_STATUSES } },
        data: {
          status: payload.status,
          finishedAt,
          inputCount: m.input_count ?? 0,
          outputCount: m.output_count ?? 0,
          errorCount: m.error_count ?? 0,
          tokensInput: m.tokens_input ?? 0,
          tokensOutput: m.tokens_output ?? 0,
          estimatedCostUsd: m.estimated_cost_usd ?? 0,
          n8nExecutionId: payload.n8n_execution_id ?? null,
          resultSummary: payload.result?.summary ?? null,
          errorMessage: payload.error?.message ?? null,
        },
      });
      if (cas.count === 0) return { skipped: true } as const;

      const startedAt =
        execution.startedAt ?? (payload.started_at ? new Date(payload.started_at) : finishedAt);
      const durationMs = Math.max(0, finishedAt.getTime() - startedAt.getTime());
      await tx.execution.update({
        where: { id: execution.id },
        data: { durationMs, ...(execution.startedAt ? {} : { startedAt }) },
      });

      if (payload.result) {
        await tx.executionOutput.upsert({
          where: { executionId: execution.id },
          create: { executionId: execution.id, outputJson: payload.result as object },
          update: { outputJson: payload.result as object },
        });
      }

      if (payload.status === 'failed' || payload.status === 'warning') {
        await tx.notification.create({
          data: {
            workspaceId: execution.workspaceId,
            agentInstanceId: execution.agentInstanceId,
            executionId: execution.id,
            severity: payload.status === 'failed' ? 'critical' : 'warning',
            type: 'execution_result',
            title:
              payload.status === 'failed'
                ? `Execution failed: ${execution.agentInstance.name}`
                : `Execution warning: ${execution.agentInstance.name}`,
            message: payload.error?.message ?? payload.result?.summary ?? null,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          workspaceId: execution.workspaceId,
          actorUserId: execution.agentInstance.createdById,
          entityType: 'execution',
          entityId: execution.id,
          action: 'callback_received',
          afterJson: { status: payload.status, n8n_execution_id: payload.n8n_execution_id ?? null },
        },
      });
      return { skipped: false } as const;
    });

    if (result.skipped) {
      this.logger.warn(
        `idempotent skip executionId=${execution.id} alreadyTerminal incoming=${payload.status}`,
      );
    }
    return { received: true, skipped: result.skipped };
  }
}
