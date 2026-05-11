import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { validateConfig, type ConfigSchema } from './config-schema-validator.js';

const MAX_OVERRIDE_BYTES = 16 * 1024;

export interface OverrideMergeResult {
  effective: Record<string, unknown>;
  snapshot: Record<string, unknown> | null;
}

// Whitelist + size cap + schema-validate. Returns merged effective config + raw snapshot
// (snapshot=null when no overrides given, so callers can store NULL in DB).
export function validateAndMergeOverrides(
  overrides: Record<string, unknown> | undefined,
  baseConfig: Record<string, unknown>,
  overridableFields: string[],
  configSchema: ConfigSchema,
): OverrideMergeResult {
  if (!overrides || Object.keys(overrides).length === 0) {
    return { effective: baseConfig, snapshot: null };
  }

  const serialized = JSON.stringify(overrides);
  if (serialized.length > MAX_OVERRIDE_BYTES) {
    throw new PayloadTooLargeException(
      `Override JSON exceeds ${MAX_OVERRIDE_BYTES} bytes (got ${serialized.length})`,
    );
  }

  const allowed = new Set(overridableFields);
  const invalid_keys = Object.keys(overrides).filter((k) => !allowed.has(k));
  if (invalid_keys.length) {
    throw new BadRequestException({
      message: 'Override keys not allowed by template',
      invalid_keys,
      allowed_keys: overridableFields,
    });
  }

  const effective: Record<string, unknown> = { ...baseConfig, ...overrides };
  const errors = validateConfig(effective, configSchema);
  if (errors.length) {
    throw new BadRequestException({
      message: 'Override produces invalid effective config',
      details: errors,
    });
  }

  return { effective, snapshot: overrides };
}
