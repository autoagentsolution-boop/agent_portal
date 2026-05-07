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
  type: 'string' | 'number' | 'boolean' | 'select' | 'textarea';
  label: string;
  required?: boolean;
  default?: unknown;
  min?: number;
  max?: number;
  enum?: string[];
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
  approvalRequired: boolean;
  costLevel: 'low' | 'medium' | 'high';
  status: string;
  n8nWebhookPath: string;
}

export type IntegrationStatus = 'mock_connected' | 'connected' | 'not_connected' | 'error';

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
  agentInstance?: { id: string; name: string };
  template?: { id: string; name: string };
}

export interface ExecutionDetail extends ExecutionRow {
  output?: { outputJson: unknown } | null;
  notifications?: Array<{ id: string; severity: string; type: string; title: string }>;
  agentInstance?: {
    id: string;
    name: string;
    template?: { id: string; name: string; category: string };
  };
  template?: { id: string; name: string; category: string };
  n8nExecutionId?: string | null;
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
