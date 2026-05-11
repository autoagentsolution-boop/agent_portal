import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from project root (two levels above prisma/seed.ts: prisma/ -> backend/ -> root)
config({ path: path.resolve(__dirname, '..', '..', '.env') });

import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  emailAndPassword: { enabled: true },
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:4000',
});

const templates = [
  {
    id: 'gmail-lead-classifier',
    name: 'Gmail Lead Classifier',
    category: 'Sales',
    description: 'Classify inbound lead emails and assign lead score.',
    taskScope: 'Classifies lead emails into hot, warm, cold, not relevant.',
    limitationsJson: ['Does not send emails automatically.', 'Does not update CRM records in demo mode.'],
    requiredIntegrationsJson: ['gmail'],
    optionalIntegrationsJson: ['slack', 'google_sheet'],
    allowedTriggerModesJson: ['manual', 'schedule'],
    configSchemaJson: {
      gmail_label: { type: 'string', label: 'Gmail Label', required: true, default: 'Leads' },
      lead_score_threshold: { type: 'number', label: 'Lead Score Threshold', required: true, default: 70, min: 0, max: 100 },
      notify_slack: { type: 'boolean', label: 'Notify Slack', required: false, default: false },
    },
    overridableFieldsJson: ['lead_score_threshold', 'notify_slack'],
    outputContractJson: {
      items_processed: 'number',
      classifications: 'array',
      summary: 'string',
    },
    n8nWebhookPath: '/webhook/gmail-lead-classifier',
    approvalRequired: false,
    costLevel: 'low',
  },
  {
    id: 'email-draft-responder',
    name: 'Email Draft Responder',
    category: 'Communication',
    description: 'Generate email draft replies for review.',
    taskScope: 'Creates draft email replies — does not send automatically.',
    limitationsJson: ['Does not send emails. Only creates drafts for human review.'],
    requiredIntegrationsJson: ['gmail'],
    optionalIntegrationsJson: ['slack'],
    allowedTriggerModesJson: ['manual'],
    configSchemaJson: {
      tone: { type: 'string', label: 'Reply Tone', required: true, default: 'professional', enum: ['professional', 'friendly', 'concise'] },
      max_length: { type: 'number', label: 'Max Reply Length (words)', required: false, default: 150, min: 50, max: 500 },
    },
    overridableFieldsJson: ['tone', 'max_length'],
    outputContractJson: {
      items_processed: 'number',
      drafts: 'array',
      summary: 'string',
    },
    n8nWebhookPath: '/webhook/email-draft-responder',
    approvalRequired: true,
    costLevel: 'medium',
  },
  {
    id: 'slack-daily-summary',
    name: 'Slack Daily Summary',
    category: 'Productivity',
    description: 'Summarize Slack messages and create action items.',
    taskScope: 'Reads Slack channel messages and generates a daily summary with action items.',
    limitationsJson: ['Read-only access to Slack. Does not post messages.'],
    requiredIntegrationsJson: ['slack'],
    optionalIntegrationsJson: [],
    allowedTriggerModesJson: ['manual', 'schedule'],
    configSchemaJson: {
      channel: { type: 'string', label: 'Slack Channel', required: true, default: 'general' },
      hours_back: { type: 'number', label: 'Hours to Look Back', required: true, default: 24, min: 1, max: 168 },
    },
    overridableFieldsJson: ['hours_back'],
    outputContractJson: {
      items_processed: 'number',
      summary: 'string',
      risks: 'array',
      action_items: 'array',
    },
    n8nWebhookPath: '/webhook/slack-daily-summary',
    approvalRequired: false,
    costLevel: 'low',
  },
  {
    id: 'google-sheet-data-checker',
    name: 'Google Sheet Data Checker',
    category: 'Data Quality',
    description: 'Validate rows from a Google Sheet data source.',
    taskScope: 'Checks each row for missing or invalid fields and reports issues.',
    limitationsJson: ['Read-only. Does not modify sheet data.'],
    requiredIntegrationsJson: ['google_sheet'],
    optionalIntegrationsJson: [],
    allowedTriggerModesJson: ['manual', 'schedule'],
    configSchemaJson: {
      sheet_id: { type: 'string', label: 'Sheet ID', required: true, default: '' },
      required_columns: { type: 'string', label: 'Required Columns (comma-separated)', required: true, default: 'name,email,phone' },
    },
    overridableFieldsJson: ['required_columns'],
    outputContractJson: {
      rows_checked: 'number',
      invalid_rows: 'number',
      issues: 'array',
      summary: 'string',
    },
    n8nWebhookPath: '/webhook/google-sheet-data-checker',
    approvalRequired: false,
    costLevel: 'low',
  },
  {
    id: 'ticket-triage-agent',
    name: 'Ticket Triage Agent',
    category: 'Support',
    description: 'Classify support tickets by priority, sentiment and category.',
    taskScope: 'Reads open tickets from helpdesk and assigns priority, sentiment, and category.',
    limitationsJson: ['Does not resolve or close tickets. Classification only.'],
    requiredIntegrationsJson: ['helpdesk'],
    optionalIntegrationsJson: ['slack'],
    allowedTriggerModesJson: ['manual', 'schedule'],
    configSchemaJson: {
      max_tickets: { type: 'number', label: 'Max Tickets per Run', required: true, default: 20, min: 1, max: 100 },
      priority_threshold: { type: 'string', label: 'Escalate Above Priority', required: false, default: 'high', enum: ['low', 'medium', 'high', 'critical'] },
    },
    overridableFieldsJson: ['max_tickets', 'priority_threshold'],
    outputContractJson: {
      items_processed: 'number',
      tickets: 'array',
      summary: 'string',
    },
    n8nWebhookPath: '/webhook/ticket-triage-agent',
    approvalRequired: false,
    costLevel: 'low',
  },
];

const integrations = [
  { integrationKey: 'gmail', name: 'Gmail', category: 'Communication' },
  { integrationKey: 'slack', name: 'Slack', category: 'Communication' },
  { integrationKey: 'google_sheet', name: 'Google Sheets', category: 'Productivity' },
  { integrationKey: 'helpdesk', name: 'Helpdesk', category: 'Support' },
  { integrationKey: 'notion', name: 'Notion', category: 'Productivity' },
  { integrationKey: 'hubspot', name: 'HubSpot', category: 'CRM' },
];

async function main() {
  console.log('Seeding database...');

  const workspace = await prisma.workspace.upsert({
    where: { id: 'workspace_demo' },
    update: {},
    create: { id: 'workspace_demo', name: 'Demo Workspace' },
  });
  console.log('Workspace:', workspace.name);

  const adminEmail = 'admin@demo.local';
  const adminPassword = 'demo1234';
  const existing = await prisma.user.findUnique({
    where: { email: adminEmail },
    include: { accounts: true },
  });
  let userId: string;
  if (existing) {
    userId = existing.id;
    const credAccount = existing.accounts.find((a) => a.providerId === 'credential');
    if (!credAccount) {
      const ctx = await auth.$context;
      const hashed = await ctx.password.hash(adminPassword);
      await prisma.account.create({
        data: {
          accountId: existing.id,
          providerId: 'credential',
          userId: existing.id,
          password: hashed,
        },
      });
      console.log('Restored missing credential account for:', adminEmail);
    } else {
      console.log('User exists, skipping signup:', adminEmail);
    }
    await prisma.user.update({
      where: { id: userId },
      data: { emailVerified: true },
    });
  } else {
    const signUp = await auth.api.signUpEmail({
      body: { email: adminEmail, password: adminPassword, name: 'Demo Admin' },
    });
    userId = signUp.user.id;
    await prisma.user.update({
      where: { id: userId },
      data: { emailVerified: true },
    });
    console.log('User created:', adminEmail);
  }

  for (const template of templates) {
    await prisma.agentTemplate.upsert({
      where: { id: template.id },
      update: template,
      create: template,
    });
  }
  console.log('Templates seeded:', templates.length);

  for (const integration of integrations) {
    await prisma.integration.upsert({
      where: { id: `${integration.integrationKey}_demo` },
      update: {},
      create: {
        id: `${integration.integrationKey}_demo`,
        workspaceId: workspace.id,
        ...integration,
        status: 'mock_connected',
        mockEnabled: true,
        lastTestedAt: new Date(),
      },
    });
  }
  console.log('Integrations seeded:', integrations.length);

  console.log('Seed complete.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
