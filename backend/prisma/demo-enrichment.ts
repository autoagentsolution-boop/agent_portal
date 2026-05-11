import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
config({ path: path.resolve(__dirname, '..', '..', '.env') });

import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const WORKSPACE_ID = 'workspace_demo';
const ADMIN_EMAIL = 'admin@demo.local';
const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;

interface AgentSpec {
  id: string;
  templateId: string;
  name: string;
  status: 'running' | 'paused';
  selectedIntegrations: string[];
  config: Record<string, unknown>;
  history: { success: number; warning: number; failed: number };
  avgDurationMs: number;
  costPerExec: number;
}

const AGENTS: AgentSpec[] = [
  {
    id: 'demo-agent-sales-pipeline',
    templateId: 'gmail-lead-classifier',
    name: 'Sales Lead Pipeline',
    status: 'running',
    selectedIntegrations: ['gmail', 'slack'],
    config: { gmail_labels: ['Inbound Leads'], lead_score_threshold: 75, notify_slack: true },
    history: { success: 41, warning: 2, failed: 2 },
    avgDurationMs: 3800,
    costPerExec: 0.014,
  },
  {
    id: 'demo-agent-slack-weekly',
    templateId: 'slack-daily-summary',
    name: 'Weekly Slack Report',
    status: 'running',
    selectedIntegrations: ['slack'],
    config: { channel: 'product-updates', hours_back: 168 },
    history: { success: 11, warning: 1, failed: 0 },
    avgDurationMs: 5200,
    costPerExec: 0.018,
  },
  {
    id: 'demo-agent-ticket-router',
    templateId: 'ticket-triage-agent',
    name: 'Support Ticket Router',
    status: 'paused',
    selectedIntegrations: ['helpdesk', 'slack'],
    config: { max_tickets: 25, priority_threshold: 'high' },
    history: { success: 7, warning: 0, failed: 1 },
    avgDurationMs: 4100,
    costPerExec: 0.011,
  },
];

const SUCCESS_OUTPUTS: Record<string, () => Record<string, unknown>> = {
  'gmail-lead-classifier': () => ({
    items_processed: rand(8, 24),
    classifications: Array.from({ length: rand(3, 6) }, (_, i) => ({
      message_id: `msg_${cuid8()}`,
      lead_type: pick(['hot', 'warm', 'cold']),
      score: rand(50, 95),
      reason: 'Decision maker, urgent need indicated',
    })),
    summary: `${rand(3, 6)} hot leads identified out of ${rand(10, 20)} processed.`,
  }),
  'slack-daily-summary': () => ({
    items_processed: rand(15, 60),
    summary: 'Team discussed Q2 roadmap, several blockers raised on shipping deadline.',
    risks: ['Timeline slip on payments integration', 'Capacity gap in QA'],
    action_items: ['Sync with payments team', 'Hire contract QA for sprint 14'],
  }),
  'ticket-triage-agent': () => ({
    items_processed: rand(8, 22),
    tickets: Array.from({ length: rand(5, 10) }, () => ({
      id: `T-${rand(1000, 9999)}`,
      priority: pick(['low', 'medium', 'high', 'critical']),
      sentiment: pick(['neutral', 'frustrated', 'positive']),
      category: pick(['billing', 'auth', 'integration', 'data']),
    })),
    summary: `${rand(2, 5)} critical tickets escalated.`,
  }),
};

const ERROR_MESSAGES = [
  'n8n trigger failed: upstream timeout (504)',
  'Gmail integration token expired — refresh required',
  'Helpdesk API rate limit exceeded',
  'Workflow execution failed: invalid output schema',
];

function rand(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function cuid8() {
  return Math.random().toString(36).slice(2, 10);
}

async function main() {
  console.log('Enriching demo data...');

  const admin = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
  if (!admin) throw new Error(`Admin user ${ADMIN_EMAIL} not found — run base seed first.`);

  const integrations = await prisma.integration.findMany({ where: { workspaceId: WORKSPACE_ID } });
  const intByKey = new Map(integrations.map((i) => [i.integrationKey, i.id]));

  for (const spec of AGENTS) {
    await prisma.notification.deleteMany({ where: { agentInstanceId: spec.id } });
    await prisma.executionOutput.deleteMany({ where: { execution: { agentInstanceId: spec.id } } });
    await prisma.execution.deleteMany({ where: { agentInstanceId: spec.id } });
    await prisma.agentInstanceIntegration.deleteMany({ where: { agentInstanceId: spec.id } });

    await prisma.agentInstance.upsert({
      where: { id: spec.id },
      update: {
        name: spec.name,
        status: spec.status,
        triggerMode: 'manual',
        configJson: spec.config,
      },
      create: {
        id: spec.id,
        workspaceId: WORKSPACE_ID,
        templateId: spec.templateId,
        name: spec.name,
        status: spec.status,
        triggerMode: 'manual',
        configJson: spec.config,
        createdById: admin.id,
      },
    });

    for (const intKey of spec.selectedIntegrations) {
      const intId = intByKey.get(intKey);
      if (intId) {
        await prisma.agentInstanceIntegration.create({
          data: { agentInstanceId: spec.id, integrationId: intId },
        });
      }
    }

    const total = spec.history.success + spec.history.warning + spec.history.failed;
    const outcomes = [
      ...Array(spec.history.success).fill('success'),
      ...Array(spec.history.warning).fill('warning'),
      ...Array(spec.history.failed).fill('failed'),
    ].sort(() => Math.random() - 0.5);

    for (let i = 0; i < total; i++) {
      const status = outcomes[i];
      const startedAt = new Date(NOW - rand(1, 7) * DAY - rand(0, 23) * 60 * 60 * 1000);
      const duration = spec.avgDurationMs + rand(-1500, 2500);
      const finishedAt = new Date(startedAt.getTime() + duration);
      const items = rand(8, 24);

      const exec = await prisma.execution.create({
        data: {
          workspaceId: WORKSPACE_ID,
          agentInstanceId: spec.id,
          templateId: spec.templateId,
          status,
          triggerType: pick(['manual', 'schedule']),
          startedAt,
          finishedAt,
          durationMs: duration,
          inputCount: items,
          outputCount: status === 'failed' ? 0 : items,
          errorCount: status === 'failed' ? items : status === 'warning' ? rand(1, 3) : 0,
          tokensInput: rand(800, 2500),
          tokensOutput: rand(400, 1200),
          estimatedCostUsd: spec.costPerExec.toFixed(4),
          n8nExecutionId: `n8n_${cuid8()}`,
          resultSummary: status === 'failed' ? null : 'Run completed.',
          errorMessage: status === 'failed' ? pick(ERROR_MESSAGES) : null,
        },
      });

      if (status !== 'failed') {
        const outputBuilder = SUCCESS_OUTPUTS[spec.templateId];
        if (outputBuilder) {
          await prisma.executionOutput.create({
            data: { executionId: exec.id, outputJson: outputBuilder() },
          });
        }
      } else {
        await prisma.notification.create({
          data: {
            workspaceId: WORKSPACE_ID,
            agentInstanceId: spec.id,
            executionId: exec.id,
            severity: 'error',
            type: 'execution_failed',
            title: `${spec.name} failed`,
            message: exec.errorMessage,
            status: 'unread',
            createdAt: finishedAt,
          },
        });
      }
    }

    console.log(`  ${spec.name}: ${total} executions (status=${spec.status})`);
  }

  console.log('Demo enrichment complete.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
