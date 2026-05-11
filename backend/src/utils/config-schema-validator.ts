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
    const hasValue =
      value !== undefined &&
      value !== null &&
      value !== '' &&
      !(Array.isArray(value) && value.length === 0);

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

    if (fieldSchema.type === 'array') {
      if (!Array.isArray(effectiveValue)) {
        errors.push({ field: key, message: `${fieldSchema.label} must be an array` });
        continue;
      }
      const itemType = fieldSchema.itemType ?? 'string';
      for (let i = 0; i < effectiveValue.length; i++) {
        const item = effectiveValue[i];
        if (itemType === 'string' && typeof item !== 'string') {
          errors.push({ field: key, message: `${fieldSchema.label}[${i}] must be a string` });
        }
        if (itemType === 'number' && typeof item !== 'number') {
          errors.push({ field: key, message: `${fieldSchema.label}[${i}] must be a number` });
        }
      }
      if (fieldSchema.minItems !== undefined && effectiveValue.length < fieldSchema.minItems) {
        errors.push({
          field: key,
          message: `${fieldSchema.label} requires at least ${fieldSchema.minItems} item${fieldSchema.minItems === 1 ? '' : 's'}`,
        });
      }
      if (fieldSchema.maxItems !== undefined && effectiveValue.length > fieldSchema.maxItems) {
        errors.push({
          field: key,
          message: `${fieldSchema.label} accepts at most ${fieldSchema.maxItems} item${fieldSchema.maxItems === 1 ? '' : 's'}`,
        });
      }
      continue;
    }

    if (fieldSchema.enum && !fieldSchema.enum.includes(String(effectiveValue))) {
      errors.push({ field: key, message: `${fieldSchema.label} must be one of: ${fieldSchema.enum.join(', ')}` });
    }
  }

  return errors;
}
