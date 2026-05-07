import type { ConfigSchema } from '../../lib/types';
import type { WizardState } from './wizard-types';

export interface FieldError {
  field: string;
  message: string;
}

export function validateConfigClient(
  config: Record<string, unknown>,
  schema: ConfigSchema | undefined,
): FieldError[] {
  if (!schema) return [];
  const errors: FieldError[] = [];

  for (const [key, field] of Object.entries(schema)) {
    const raw = config[key];
    const hasValue = raw !== undefined && raw !== null && raw !== '';
    const effective = hasValue ? raw : field.default;

    if (field.required && !hasValue && field.default === undefined) {
      errors.push({ field: key, message: `${field.label} is required` });
      continue;
    }
    if (effective === undefined) continue;

    if (field.type === 'number') {
      const num = Number(effective);
      if (Number.isNaN(num)) {
        errors.push({ field: key, message: `${field.label} must be a number` });
        continue;
      }
      if (field.min !== undefined && num < field.min) {
        errors.push({ field: key, message: `${field.label} must be at least ${field.min}` });
      }
      if (field.max !== undefined && num > field.max) {
        errors.push({ field: key, message: `${field.label} must be at most ${field.max}` });
      }
    }

    if (field.type === 'boolean' && typeof effective !== 'boolean') {
      errors.push({ field: key, message: `${field.label} must be a boolean` });
    }

    if (field.enum && !field.enum.includes(String(effective))) {
      errors.push({ field: key, message: `${field.label} must be one of: ${field.enum.join(', ')}` });
    }
  }

  return errors;
}

export function canAdvance(step: number, state: WizardState): boolean {
  switch (step) {
    case 1:
      return Boolean(state.templateId && state.template);
    case 2:
      return state.agentName.trim().length > 0;
    case 3: {
      const required = state.template?.requiredIntegrationsJson ?? [];
      return required.every((k) => state.selectedIntegrations.includes(k));
    }
    case 4:
      return validateConfigClient(state.config, state.template?.configSchemaJson).length === 0;
    case 5:
      return Boolean(state.triggerMode);
    case 6:
      return (
        state.testStatus === 'success' ||
        state.testStatus === 'failed' ||
        state.testStatus === 'skipped'
      );
    default:
      return true;
  }
}
