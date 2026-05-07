import type { AgentTemplate } from '../../lib/types';

export type TestStatus = 'idle' | 'running' | 'success' | 'failed' | 'skipped';

export interface WizardState {
  templateId: string | null;
  template: AgentTemplate | null;
  agentName: string;
  selectedIntegrations: string[];
  config: Record<string, unknown>;
  triggerMode: string | null;
  agentId: string | null;
  testExecutionId: string | null;
  testStatus: TestStatus;
  testError: string | null;
}

export type WizardAction =
  | { type: 'reset' }
  | { type: 'setTemplate'; templateId: string; template: AgentTemplate | null }
  | { type: 'setTemplateDetail'; template: AgentTemplate }
  | { type: 'setAgentName'; name: string }
  | { type: 'setIntegrations'; integrations: string[] }
  | { type: 'toggleIntegration'; key: string }
  | { type: 'setConfig'; config: Record<string, unknown> }
  | { type: 'setConfigField'; key: string; value: unknown }
  | { type: 'setTriggerMode'; mode: string }
  | { type: 'setAgentId'; agentId: string }
  | { type: 'setTestStatus'; status: TestStatus; executionId?: string | null; error?: string | null };

export const initialWizardState: WizardState = {
  templateId: null,
  template: null,
  agentName: '',
  selectedIntegrations: [],
  config: {},
  triggerMode: null,
  agentId: null,
  testExecutionId: null,
  testStatus: 'idle',
  testError: null,
};

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'reset':
      return initialWizardState;
    case 'setTemplate':
      if (state.templateId === action.templateId) return state;
      return {
        ...initialWizardState,
        templateId: action.templateId,
        template: action.template,
      };
    case 'setTemplateDetail': {
      const required = action.template.requiredIntegrationsJson ?? [];
      const defaults = buildConfigDefaults(action.template);
      return {
        ...state,
        template: action.template,
        selectedIntegrations: dedupe([...state.selectedIntegrations, ...required]),
        config: { ...defaults, ...state.config },
      };
    }
    case 'setAgentName':
      return { ...state, agentName: action.name };
    case 'setIntegrations':
      return { ...state, selectedIntegrations: action.integrations };
    case 'toggleIntegration': {
      const set = new Set(state.selectedIntegrations);
      if (set.has(action.key)) set.delete(action.key);
      else set.add(action.key);
      return { ...state, selectedIntegrations: [...set] };
    }
    case 'setConfig':
      return { ...state, config: action.config };
    case 'setConfigField':
      return { ...state, config: { ...state.config, [action.key]: action.value } };
    case 'setTriggerMode': {
      if (action.mode === 'schedule') return { ...state, triggerMode: action.mode };
      const { schedule_frequency: _drop, ...rest } = state.config;
      return { ...state, triggerMode: action.mode, config: rest };
    }
    case 'setAgentId':
      return { ...state, agentId: action.agentId };
    case 'setTestStatus':
      return {
        ...state,
        testStatus: action.status,
        testExecutionId: action.executionId !== undefined ? action.executionId : state.testExecutionId,
        testError: action.error !== undefined ? action.error : state.testError,
      };
    default:
      return state;
  }
}

function buildConfigDefaults(template: AgentTemplate): Record<string, unknown> {
  const schema = template.configSchemaJson ?? {};
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema)) {
    if (field.default !== undefined) out[key] = field.default;
  }
  return out;
}

function dedupe(arr: string[]): string[] {
  return [...new Set(arr)];
}
