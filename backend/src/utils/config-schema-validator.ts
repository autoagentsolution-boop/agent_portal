export interface FieldSchema {
  type: 'string' | 'number' | 'boolean' | 'select' | 'textarea';
  label: string;
  required?: boolean;
  default?: unknown;
  min?: number;
  max?: number;
  enum?: string[];
}

export interface ConfigSchema {
  [key: string]: FieldSchema;
}

export interface ValidationError {
  field: string;
  message: string;
}

export function validateConfig(
  config: Record<string, unknown>,
  schema: ConfigSchema,
): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const [key, fieldSchema] of Object.entries(schema)) {
    const value = config[key];
    const hasValue = value !== undefined && value !== null && value !== '';

    if (fieldSchema.required && !hasValue) {
      if (fieldSchema.default === undefined) {
        errors.push({ field: key, message: `${fieldSchema.label} is required` });
        continue;
      }
    }

    const effectiveValue = hasValue ? value : fieldSchema.default;
    if (effectiveValue === undefined) continue;

    if (fieldSchema.type === 'number') {
      const num = Number(effectiveValue);
      if (isNaN(num)) {
        errors.push({ field: key, message: `${fieldSchema.label} must be a number` });
        continue;
      }
      if (fieldSchema.min !== undefined && num < fieldSchema.min) {
        errors.push({ field: key, message: `${fieldSchema.label} must be at least ${fieldSchema.min}` });
      }
      if (fieldSchema.max !== undefined && num > fieldSchema.max) {
        errors.push({ field: key, message: `${fieldSchema.label} must be at most ${fieldSchema.max}` });
      }
    }

    if (fieldSchema.type === 'boolean' && typeof effectiveValue !== 'boolean') {
      errors.push({ field: key, message: `${fieldSchema.label} must be a boolean` });
    }

    if (fieldSchema.enum && !fieldSchema.enum.includes(String(effectiveValue))) {
      errors.push({ field: key, message: `${fieldSchema.label} must be one of: ${fieldSchema.enum.join(', ')}` });
    }
  }

  return errors;
}
