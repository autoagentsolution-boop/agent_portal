export interface User {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string | null;
}

export interface SessionResponse {
  session: { id: string; userId: string; expiresAt: string } | null;
  user: User | null;
}

export interface FieldSchema {
  type: 'string' | 'number' | 'boolean' | 'select' | 'textarea' | 'array';
  label: string;
  required?: boolean;
  default?: unknown;
  min?: number;
  max?: number;
  enum?: string[];
  itemType?: 'string' | 'number';
  minItems?: number;
  maxItems?: number;
}

export type ConfigSchema = Record<string, FieldSchema>;

export interface AgentTemplate {
  id: string;
  name: string;
  category: string;
  description: string | null;
  taskScope?: string | null;
  limitationsJson?: string[];
  requiredIntegrationsJson: string[];
  optionalIntegrationsJson: string[];
  allowedTriggerModesJson: string[];
  configSchemaJson?: ConfigSchema;
  overridableFieldsJson?: string[];
  approvalRequired: boolean;
  costLevel: 'low' | 'medium' | 'high';
  status: string;
  n8nWebhookPath: string;
}

export type IntegrationStatus =
  | 'mock_connected'
  | 'connected'
  | 'not_connected'
  | 'error'
  | 'expired';

export interface IntegrationTestResult {
  status: 'success' | 'error';
  message: string;
  tested_at: string | null;
}

export interface Integration {
  id: string;
  workspaceId: string;
  integrationKey: string;
  name: string;
  category: string | null;
  status: IntegrationStatus;
  mockEnabled: boolean;
  lastTestedAt: string | null;
}

export type ExecutionStatus =
  | 'queued'
  | 'running'
  | 'success'
  | 'failed'
  | 'warning'
  | 'cancelled';

export type ExecutionTriggerType = 'manual' | 'retry' | 'schedule' | 'webhook' | string;

export interface ExecutionRow {
  id: string;
  status: ExecutionStatus;
  agentInstanceId: string;
  templateId: string;
  triggerType: ExecutionTriggerType;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  inputCount: number;
  outputCount: number;
  errorCount: number;
  tokensInput: number;
  tokensOutput: number;
  estimatedCostUsd: number | string;
  resultSummary: string | null;
  errorMessage: string | null;
  createdAt: string;
  configOverrideJson?: Record<string, unknown> | null;
  agentInstance?: { id: string; name: string };
  template?: { id: string; name: string };
}

export interface ExecutionDetail extends ExecutionRow {
  output?: { outputJson: unknown } | null;
  notifications?: Array<{ id: string; severity: string; type: string; title: string }>;
  agentInstance?: {
    id: string;
    name: string;
    configJson?: Record<string, unknown>;
    template?: AgentTemplate;
  };
  template?: AgentTemplate;
  n8nExecutionId?: string | null;
  effectiveConfigJson?: Record<string, unknown> | null;
}

export type AgentInstanceStatus =
  | 'draft'
  | 'running'
  | 'paused'
  | 'error'
  | 'archived';

export interface AgentInstance {
  id: string;
  name: string;
  status: AgentInstanceStatus;
  templateId: string;
  template?: { id: string; name: string; category: string };
  triggerMode: 'manual' | 'schedule' | 'webhook';
  integrationsUsedJson?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface RunResponse {
  execution_id: string;
  status: string;
}

export type NotificationSeverity = 'critical' | 'warning' | 'info' | 'success';
export type NotificationStatus = 'unread' | 'acknowledged' | 'resolved';

export interface Notification {
  id: string;
  workspaceId: string;
  agentInstanceId: string | null;
  executionId: string | null;
  severity: NotificationSeverity;
  type: string;
  title: string;
  message: string;
  status: NotificationStatus;
  createdAt: string;
  updatedAt: string;
  agentInstance?: { id: string; name: string; templateId: string } | null;
}

export interface AnalyticsLatestFailure {
  execution_id: string;
  agent_instance_id: string;
  agent_name: string;
  template_id: string;
  status: ExecutionStatus;
  error_message: string | null;
  finished_at: string | null;
  duration_ms: number | null;
}

export interface AnalyticsTopAgent {
  agent_instance_id: string;
  name: string;
  template_id: string;
  runs: number;
  success_rate: number;
  avg_duration_ms: number;
  total_cost_usd: number;
}

export interface AnalyticsSummary {
  total_agents: number;
  active_agents: number;
  total_executions: number;
  success_executions: number;
  failed_executions: number;
  success_rate: number;
  avg_duration_ms: number;
  p95_duration_ms: number;
  total_tokens_input: number;
  total_tokens_output: number;
  estimated_cost_usd: number;
  latest_failures: AnalyticsLatestFailure[];
  top_agents: AnalyticsTopAgent[];
}

export interface AnalyticsAgentRecentExecution {
  execution_id: string;
  status: ExecutionStatus;
  duration_ms: number | null;
  started_at: string | null;
  finished_at: string | null;
  cost_usd: number;
}

export interface AnalyticsAgentSummary {
  agent_instance_id: string;
  name: string;
  template_id: string;
  total_executions: number;
  success_executions: number;
  failed_executions: number;
  success_rate: number;
  avg_duration_ms: number;
  total_tokens_input: number;
  total_tokens_output: number;
  estimated_cost_usd: number;
  recent_executions: AnalyticsAgentRecentExecution[];
}

export type OutcomeRange = '7d' | '30d' | 'all';

export interface BusinessMetric {
  key: string;
  label: string;
  value: number;
  suffix?: string;
}

export interface BusinessOutcomes {
  agent_instance_id: string;
  name: string;
  template_id: string;
  range: OutcomeRange;
  execution_count: number;
  headline_metric: BusinessMetric | null;
  metrics: BusinessMetric[];
  estimated_hours_saved: number;
  estimated_basis: string | null;
  unsupported: boolean;
}
