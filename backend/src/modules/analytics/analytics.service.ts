import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { getRegistryEntry } from './business-outcomes/registry.js';

const TERMINAL_FAILURE_STATUSES = ['failed', 'warning'];
const RANGE_DAYS: Record<string, number | null> = { '7d': 7, '30d': 30, all: null };
const ALL_RANGE_EXEC_CAP = 1000;

export type OutcomeRange = '7d' | '30d' | 'all';

interface P95Row {
  p95: number | null;
}

interface TopAgentRow {
  agent_instance_id: string;
  name: string;
  template_id: string;
  runs: number;
  success_count: number;
  avg_duration_ms: number | null;
  total_cost_usd: string | number | null;
}

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(workspaceId: string) {
    const [
      totalAgents,
      activeAgents,
      execAgg,
      successCount,
      failedCount,
      p95Rows,
      latestFailures,
      topAgentsRaw,
    ] = await Promise.all([
      this.prisma.agentInstance.count({ where: { workspaceId } }),
      this.prisma.agentInstance.count({ where: { workspaceId, status: 'running' } }),
      this.prisma.execution.aggregate({
        where: { workspaceId },
        _count: { _all: true },
        _avg: { durationMs: true },
        _sum: {
          tokensInput: true,
          tokensOutput: true,
          estimatedCostUsd: true,
        },
      }),
      this.prisma.execution.count({ where: { workspaceId, status: 'success' } }),
      this.prisma.execution.count({
        where: { workspaceId, status: { in: TERMINAL_FAILURE_STATUSES } },
      }),
      this.prisma.$queryRaw<P95Row[]>`
        SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY "durationMs")::float AS p95
        FROM "Execution"
        WHERE "workspaceId" = ${workspaceId}
          AND "durationMs" IS NOT NULL
      `,
      this.prisma.execution.findMany({
        where: { workspaceId, status: { in: TERMINAL_FAILURE_STATUSES } },
        orderBy: { finishedAt: 'desc' },
        take: 5,
        include: { agentInstance: { select: { id: true, name: true, templateId: true } } },
      }),
      this.prisma.$queryRaw<TopAgentRow[]>`
        SELECT
          ai."id"          AS agent_instance_id,
          ai."name"        AS name,
          ai."templateId"  AS template_id,
          COUNT(e.*)::int  AS runs,
          COUNT(*) FILTER (WHERE e."status" = 'success')::int AS success_count,
          AVG(e."durationMs")::float AS avg_duration_ms,
          SUM(e."estimatedCostUsd")  AS total_cost_usd
        FROM "AgentInstance" ai
        JOIN "Execution" e ON e."agentInstanceId" = ai."id"
        WHERE ai."workspaceId" = ${workspaceId}
        GROUP BY ai."id"
        ORDER BY runs DESC
        LIMIT 5
      `,
    ]);

    const totalExecutions = execAgg._count._all;
    const successRate =
      totalExecutions > 0 ? Number(((successCount / totalExecutions) * 100).toFixed(2)) : 0;

    return {
      data: {
        total_agents: totalAgents,
        active_agents: activeAgents,
        total_executions: totalExecutions,
        success_executions: successCount,
        failed_executions: failedCount,
        success_rate: successRate,
        avg_duration_ms: execAgg._avg.durationMs ? Math.round(execAgg._avg.durationMs) : 0,
        p95_duration_ms: p95Rows[0]?.p95 ? Math.round(p95Rows[0].p95) : 0,
        total_tokens_input: execAgg._sum.tokensInput ?? 0,
        total_tokens_output: execAgg._sum.tokensOutput ?? 0,
        estimated_cost_usd: this.toNumber(execAgg._sum.estimatedCostUsd),
        latest_failures: latestFailures.map((e) => ({
          execution_id: e.id,
          agent_instance_id: e.agentInstanceId,
          agent_name: e.agentInstance.name,
          template_id: e.agentInstance.templateId,
          status: e.status,
          error_message: e.errorMessage,
          finished_at: e.finishedAt,
          duration_ms: e.durationMs,
        })),
        top_agents: topAgentsRaw.map((row) => {
          const runs = Number(row.runs);
          const success = Number(row.success_count);
          return {
            agent_instance_id: row.agent_instance_id,
            name: row.name,
            template_id: row.template_id,
            runs,
            success_rate:
              runs > 0 ? Number(((success / runs) * 100).toFixed(2)) : 0,
            avg_duration_ms: row.avg_duration_ms ? Math.round(row.avg_duration_ms) : 0,
            total_cost_usd: this.toNumber(row.total_cost_usd),
          };
        }),
      },
    };
  }

  async getAgentSummary(agentInstanceId: string, workspaceId: string) {
    const agent = await this.prisma.agentInstance.findFirst({
      where: { id: agentInstanceId, workspaceId },
    });
    if (!agent) throw new NotFoundException(`Agent ${agentInstanceId} not found`);

    const [agg, successCount, failedCount, recent] = await Promise.all([
      this.prisma.execution.aggregate({
        where: { workspaceId, agentInstanceId },
        _count: { _all: true },
        _avg: { durationMs: true },
        _sum: {
          tokensInput: true,
          tokensOutput: true,
          estimatedCostUsd: true,
        },
      }),
      this.prisma.execution.count({
        where: { workspaceId, agentInstanceId, status: 'success' },
      }),
      this.prisma.execution.count({
        where: {
          workspaceId,
          agentInstanceId,
          status: { in: TERMINAL_FAILURE_STATUSES },
        },
      }),
      this.prisma.execution.findMany({
        where: { workspaceId, agentInstanceId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          status: true,
          durationMs: true,
          startedAt: true,
          finishedAt: true,
          estimatedCostUsd: true,
        },
      }),
    ]);

    const total = agg._count._all;
    return {
      data: {
        agent_instance_id: agent.id,
        name: agent.name,
        template_id: agent.templateId,
        total_executions: total,
        success_executions: successCount,
        failed_executions: failedCount,
        success_rate:
          total > 0 ? Number(((successCount / total) * 100).toFixed(2)) : 0,
        avg_duration_ms: agg._avg.durationMs ? Math.round(agg._avg.durationMs) : 0,
        total_tokens_input: agg._sum.tokensInput ?? 0,
        total_tokens_output: agg._sum.tokensOutput ?? 0,
        estimated_cost_usd: this.toNumber(agg._sum.estimatedCostUsd),
        recent_executions: recent.map((e) => ({
          execution_id: e.id,
          status: e.status,
          duration_ms: e.durationMs,
          started_at: e.startedAt,
          finished_at: e.finishedAt,
          cost_usd: this.toNumber(e.estimatedCostUsd),
        })),
      },
    };
  }

  async getAgentBusinessOutcomes(
    agentInstanceId: string,
    workspaceId: string,
    range: OutcomeRange = '7d',
  ) {
    const agent = await this.prisma.agentInstance.findFirst({
      where: { id: agentInstanceId, workspaceId },
      select: { id: true, name: true, templateId: true },
    });
    if (!agent) throw new NotFoundException(`Agent ${agentInstanceId} not found`);

    const days = RANGE_DAYS[range] ?? null;
    const since = days !== null ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : undefined;

    const entry = getRegistryEntry(agent.templateId);
    if (!entry) {
      return {
        data: {
          agent_instance_id: agent.id,
          name: agent.name,
          template_id: agent.templateId,
          range,
          execution_count: 0,
          headline_metric: null,
          metrics: [],
          estimated_hours_saved: 0,
          estimated_basis: null,
          unsupported: true,
        },
      };
    }

    const executions = await this.prisma.execution.findMany({
      where: {
        workspaceId,
        agentInstanceId,
        status: 'success',
        ...(since ? { finishedAt: { gte: since } } : {}),
      },
      include: { output: true },
      orderBy: { finishedAt: 'desc' },
      take: days === null ? ALL_RANGE_EXEC_CAP : undefined,
    });

    const summed: Record<string, number> = {};
    let totalItems = 0;
    for (const exec of executions) {
      if (!exec.output?.outputJson) continue;
      const { items, metrics } = entry.extract(exec.output.outputJson);
      totalItems += items;
      for (const [k, v] of Object.entries(metrics)) {
        summed[k] = (summed[k] ?? 0) + v;
      }
    }

    const aggregated = entry.postAggregate(summed);
    const hoursSaved = Number(((totalItems * entry.format.manualMinutesPerItem) / 60).toFixed(2));

    const metricsList = Object.entries(entry.format.labels)
      .filter(([key]) => aggregated[key] !== undefined)
      .map(([key, label]) => ({
        key,
        label,
        value: aggregated[key],
        ...(entry.format.suffixes?.[key] ? { suffix: entry.format.suffixes[key] } : {}),
      }));

    const headlineMetric = metricsList.find((m) => m.key === entry.format.headlineKey) ?? metricsList[0] ?? null;

    return {
      data: {
        agent_instance_id: agent.id,
        name: agent.name,
        template_id: agent.templateId,
        range,
        execution_count: executions.length,
        headline_metric: headlineMetric,
        metrics: metricsList,
        estimated_hours_saved: hoursSaved,
        estimated_basis: entry.format.basis,
        unsupported: false,
      },
    };
  }

  private toNumber(value: unknown): number {
    if (value === null || value === undefined) return 0;
    const n = typeof value === 'number' ? value : Number(String(value));
    return Number.isFinite(n) ? Number(n.toFixed(4)) : 0;
  }
}
