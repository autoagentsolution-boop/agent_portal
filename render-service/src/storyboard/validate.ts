import { ZodError } from 'zod';
import { StoryboardV2 } from './schema-v2.ts';

export interface ValidationIssue {
  path: string;
  message: string;
}

export class StoryboardValidationError extends Error {
  readonly issues: ValidationIssue[];
  constructor(issues: ValidationIssue[]) {
    super(`StoryboardV2 validation failed:\n${issues.map((i) => `  - ${i.path}: ${i.message}`).join('\n')}`);
    this.name = 'StoryboardValidationError';
    this.issues = issues;
  }
}

const pathStr = (p: (string | number)[]): string => {
  if (p.length === 0) return '<root>';
  return p
    .map((seg, i) => (typeof seg === 'number' ? `[${seg}]` : i === 0 ? String(seg) : `.${seg}`))
    .join('');
};

export const parseStoryboardV2 = (raw: unknown) => {
  const result = StoryboardV2.safeParse(raw);
  if (result.success) return result.data;
  const issues: ValidationIssue[] = (result.error as ZodError).issues.map((iss) => ({
    path: pathStr(iss.path as (string | number)[]),
    message: iss.message,
  }));
  throw new StoryboardValidationError(issues);
};

export const isV2 = (raw: unknown): boolean =>
  typeof raw === 'object' &&
  raw !== null &&
  (raw as { schemaVersion?: unknown }).schemaVersion === 'v2';
